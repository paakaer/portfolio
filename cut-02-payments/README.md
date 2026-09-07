# Marketplace payments when you cannot charge at checkout

**Stripe Connect, auth-then-capture, and what breaks when the money moves days
after the order.**

A write-up. There are a thousand Stripe tutorials; this is not one. It is the set
of decisions and failure modes from running Connect in production for a
marketplace where **the order is not confirmed when the customer pays.**

---

## The problem the tutorials skip

Every Connect tutorial charges at checkout. That works when the seller is a
warehouse. It does not work when the seller is a restaurant that has not yet
looked at the order.

The real sequence is:

```
  diner submits          → we must hold the money, not take it
  restaurant sees it     → minutes later. or twenty minutes later.
  restaurant accepts     → NOW take the money
  restaurant declines    → release it, in full, immediately
  restaurant never looks → ??? ← this is the interesting one
```

So the primitive is not a charge. It is an **authorisation hold**, captured or
voided later by an event that may never arrive. That single change turns a
two-call integration into a distributed-systems problem, and everything below
follows from it.

---

## Decision 1 — Direct charges: the restaurant is the merchant of record

Connect offers destination charges, separate charges and transfers, and direct
charges. We use **direct charges on the connected account**.

The money never touches our balance. The restaurant's name is on the diner's card
statement. The restaurant owns the chargeback, the refund, and the relationship.

**Why it is the right call for this market:** an Italian restaurant already has a
commercialista, a P.IVA, and a fiscal regime it understands. Becoming the merchant
of record on their behalf means becoming a party to their tax position, and the
"we handle payments for you" model is exactly what makes the incumbent
delivery platforms expensive. Direct charges keep us a tool rather than an
intermediary.

**What it costs us:** we cannot see the money. Reporting, reconciliation, and any
dispute view must be built against the connected account's data, not our own
balance. Every API call needs the account context, and getting that wrong is a
cross-tenant bug rather than a 400.

**Where it bit:** with a zero platform fee, the natural implementation passes
`application_fee_amount: 0`. Don't — omit the parameter entirely. Any fee above
zero also changes what we are selling for tax purposes, which is a
commercialista question before it is an engineering one.

---

## Decision 2 — Authorise, then capture. Never charge at submit.

`capture_method: 'manual'` on the PaymentIntent. The diner's bank holds the funds;
nothing is taken until we say so.

Three constraints fall out of this immediately, and each one is a design decision
you cannot defer:

**Auth holds expire.** Roughly seven days on most cards, and expiry is not an
event you control. If you have not captured by then, the hold evaporates — and if
you were relying on capture-later to collect, you have handed over food for free.

**The capture window has to be shorter than the auth window.** We void
proactively at **six days**, one day inside Stripe's expiry, because being the
party that cancels is much better than discovering a PaymentIntent silently
transitioned to `canceled` on someone else's schedule.

**Pre-payment only makes sense near the fulfillment date.** A card hold placed for
an order five weeks out will expire before the food exists. So card payment is
gated to a **five-day horizon**; beyond it, the order falls back to cash. That is
not a policy choice, it is arithmetic about the auth window.

---

## Decision 3 — The gate is server-side, layered, and fails to cash

Whether an order can be paid by card is re-derived **on the server at submit**.
The client never asserts it. Five layers, and any failure falls back to cash:

| Layer | Check |
|---|---|
| 1 | Is online payment enabled for this tenant at all? |
| 2 | Does the connected account actually have card capability *active*? |
| 3 | Is card configured for **this order type**? (pickup vs delivery differ) |
| 4a | Can we reach the operator to tell them an order arrived? |
| 4b | **Has operator notification been failing?** |
| 5 | Is fulfillment inside the five-day horizon? |

**Layer 4 is the one worth stealing.** Taking a diner's money for an order the
restaurant will never see is worse than not taking it. So the payment gate reads
the recent operator-notification history, and if the last three notifications all
failed, it **breaks the circuit and falls back to cash.**

That is a payments decision made on messaging-infrastructure health, which sounds
like a layering violation and is not: the thing we are actually gating is "can
this order be fulfilled", and an unreachable operator means no.

Fail-to-cash rather than fail-closed is deliberate. A broken card path should cost
us a card payment, never an order.

---

## Failure mode 1 — Capture is not a function call, it is an outbox

The naive implementation captures inline when the operator taps *accept*. That
call can fail: network, Stripe, a PaymentIntent in an unexpected state. And it
fails at exactly the moment the operator is holding a phone in a kitchen and has
already started cooking.

So capture is **enqueued, not called**. A `capture_outbox` row with:

- `status`: `pending | captured | failed | exhausted`
- `attempts` against a max of 5
- `next_attempt_at`, on exponential backoff: **30s, 60s, 120s, 240s, then 1h**

The outcome of one attempt is a **pure function** returning a discriminated union
— `captured`, `already_captured`, `pi_canceled`, `retryable_error`, `exhausted` —
and the executor maps that to database writes. Testing every capture path then
needs no Stripe at all.

`already_captured` matters more than it looks. Retries, redelivered webhooks and
a double-tapping operator all converge on capturing something already captured.
It must be a **success**, not an error, or your retry loop fights itself.

---

## Failure mode 2 — The sweep that must not void the wrong thing

A background sweep voids holds that should not stand: orders the operator
declined, and orders approaching the six-day expiry.

The dangerous line in that sweep is which order states it voids. It voids
`cancelled` and `declined`. It very deliberately does **not** void `completed`.

**A fulfilled order still sitting in `authorized` has a stuck capture, not a
stale hold.** Voiding it means the food went out the door and nobody paid. That
one exclusion is the difference between a sweep that cleans up and a sweep that
gives away inventory, and it is a single array in a file nobody reads twice.

---

## Failure mode 3 — Webhook idempotency, and the ordering nobody mentions

Stripe redelivers. Events arrive out of order. Both are normal, and both are
silent.

**The ledger.** A `stripe_event` table keyed on the event id. Two endpoints
(subscriptions and Connect) share it, because Stripe event ids are globally
unique — one ledger, no coordination.

**The ordering that matters.** Check, apply, and record all happen **inside one
transaction**, in that order:

```
  BEGIN
    seen? → skip
    apply the change
    record the event id
  COMMIT
```

A crash after applying but before recording leaves the event *un-recorded*, so
Stripe's redelivery re-applies it. That is safe **only because every apply is a
guarded, idempotent UPDATE** — advancing a status strictly from one state to
another, never a blind write. Record-then-apply looks equivalent and is not: a
crash between them loses the update permanently, and nothing ever retries it.

**Two different webhook secrets.** Subscriptions and Connect are separate Stripe
endpoints with separate signing secrets. Swapping the values makes both fail
signature verification with a 400 that looks exactly like a forged request. The
signature is the trust boundary on both — verified before any parsing.

---

## Failure mode 4 — Connect events carry no tenant

This is the one that is genuinely dangerous in a multi-tenant system.

A Connect webhook has an `account` field and no tenant. There is no session, no
Host header, no authenticated context. So the handler cannot run tenant-scoped —
it runs as the **privileged, cross-tenant role**, which means the tenant boundary
is no longer being enforced by the database. It is being enforced by the code you
are about to write.

Two rules make that survivable:

1. **The tenant comes from the connected account id, never from the payload.**
   A compromised connected account can then only ever touch its own tenant's
   orders.
2. **Every statement carries an explicit `tenant_id` predicate.** Orders are
   matched on `(tenant_id, payment_intent_id)` — never on the PaymentIntent id
   alone, even though it is unique. Without that predicate the privileged
   connection is a cross-tenant write primitive.

The regression test worth writing asserts that an event for tenant A's account
**cannot** move tenant B's order, even when the ids would otherwise match.

---

## Failure mode 5 — The stamp that loses its race

We stamp the PaymentIntent id onto the order when we create the intent. That
write is best-effort, and Stripe's webhook can arrive first.

So the handler correlates on the stamped id **and falls back** to an order id
carried in the PaymentIntent metadata — then stamps the id, so later events take
the fast path. The metadata is still tenant-bounded by rule 1 above, so the
fallback does not widen the blast radius.

The general shape: **anything you write locally "just before" an external system
calls you back is a race you have already lost.** Give the callback a second way
to find its row.

---

## What I would tell someone starting this

1. **Decide merchant of record first.** It determines your tax position, your
   dispute handling, and your reporting. It is not an implementation detail and
   it is expensive to reverse.
2. **If you cannot charge at checkout, you are building an outbox.** Accept that
   on day one rather than discovering it after the first inline capture fails in
   a kitchen.
3. **Model the states you will not act on.** `completed` + `authorized` is not a
   state anyone designs; it is the state that gives away food.
4. **Write the idempotency test before the happy path.** Redelivery is not an
   edge case, it is Tuesday.
5. **A payment gate is an order-fulfillment gate.** Ask what happens if the
   money arrives and the order does not.

---

## What is not here

- **No repo.** This one is a write-up on purpose. Connect needs live credentials,
  a funded account, and a connected test account to run; a demo repo would rot
  into an embarrassment within weeks. The multi-tenant and menu-ingestion cuts
  are the runnable ones.
- **No second payment rail.** I researched Satispay and did not build it. Notes
  on running two rails in one order flow would be invented, and inventing them is
  the one thing this format cannot survive.
- **No dispute or refund flow.** Direct charges put both on the restaurant. That
  was the point, but it means I have not built either.
