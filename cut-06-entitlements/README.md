# quadro

**Per-tenant feature gating that a billing tier seeds but does not govern.**

A *quadro elettrico* is the fuse box: one panel, one switch per circuit, and
nothing turns on because the electricity company felt like it. That is the design.

The other half of multi-tenancy. Its sibling
[`condominio`](../cut-01-multitenant/) answers *can tenant A see tenant B's data*.
This one answers *what has tenant A actually got switched on* — which is the
question your customers are paying you to answer, and the one where a plausible
wrong answer turns off a working business.

Extracted from a production platform. MIT.

```bash
bun install
bun run db:up
bun run db:migrate
bun run demo      # seven subscription events; watch which ones change nothing
bun test
```

---

## The one-line rule

```
live(tenant, feature) = tenant_features.enabled
```

Not the tier. Not the subscription status. Not the maturity level. Not the
payment processor's entitlements. **One field, written only when somebody
decides something.**

Every alternative looks reasonable in isolation, and every one of them can change
*without a human deciding anything*: a card expires, a webhook is redelivered,
someone edits a maturity level in an admin panel. Each would then silently take a
working restaurant's storefront apart, at 7pm on a Friday, for a reason nobody
present can diagnose.

---

## Two facts, deliberately separated

Most feature-flag systems conflate these, and the conflation is the bug.

| | **Enablement** | **Maturity** |
|---|---|---|
| Scope | per tenant | global |
| Means | *this tenant has it on* | *how finished it is* |
| Role | **the runtime gate** | **advisory only** |
| Values | boolean | `alpha · beta · mature · deprecated` |
| Changed by | an operator, or a tier change | a developer, in a release |

Maturity drives what the admin UI *warns* about when a human reaches for a
switch — "this may break your storefront", "no new enablements, this is going
away". It never appears in the resolution.

**Why the separation is load-bearing:** a tenant deliberately running an alpha
feature in production is how you get real feedback. Fold maturity into the gate
and a developer marking something `alpha` in a release switches off a customer
they have never heard of. Deprecation gets the same treatment — it **blocks new
enablements and disables nothing**, because deprecation is meant to stop the
bleeding, not to take a capability away from someone mid-service.

---

## Governed vs. the operator's own

Every flag declares whether a billing tier may write it.

```ts
{ key: 'delivery',  governed: true  }   // a tier may write this
{ key: 'crossSell', governed: false }   // billing never touches it, either way
```

**`GOVERNED_KEYS` is the blast radius of your entire billing integration.** It is
the exact set of things a webhook can change without a human, so keeping it small
is not tidiness — there is a test asserting it stays a minority of the registry,
and if it ever becomes most of them, billing has quietly taken over the product.

**Baseline capability is deliberately ungoverned.** `onlineOrdering` — the switch
that decides whether a restaurant can trade at all — appears in no tier. That
means no billing event, including a downgrade, can reach it by any path. Governing
a flag you never intend a tier to withdraw buys you nothing and hands billing a
weapon.

A billing dashboard that lists an ungoverned key as an entitlement is silently
ignored, and there is a test for that too.

---

## The invariant

> **A tier CHANGE writes the governed flags. Nothing else ever writes them.**

Not a renewal. Not a payment failure. Not a cancellation. Not a redelivered
webhook. Not a reactivation onto the same tier.

That single restriction is what makes "tiers by default, but I can override" work
at all. Run `bun run demo` and read which events say `WROTE`:

```
  1b. provisioned              baseline set by provisioning, ungoverned
  2.  subscribes to Start      WROTE   fill mode — only unset flags
  3.  operator flips two       (by hand: crossSell, and delivery)
  4a. monthly renewal          no-op   same tier, nothing to write
  4b. card declined            no-op   record-only, nothing disabled
  4c. webhook redelivered      no-op   same tier, nothing to write
  5.  upgrades to Pro          WROTE   governed flags rewritten
  6.  downgrades to Start      WROTE   analytics, delivery, onlinePayments ← withdrawn
  7.  cancels                  no-op   record-only, nothing disabled
```

The bug this prevents is subtle and expensive: an operator's manual flip
mysteriously reverting **once a month, on the billing anniversary**, which is
about the hardest reproduction schedule a support ticket can have.

### Two seed modes, and why the first one exists

- **`fill`** — the tenant's *first* subscription. Only flags never explicitly set
  are written (`ON CONFLICT DO NOTHING`). Tenants who predate billing are
  hand-configured, and their first checkout must not reset them.
- **`overwrite`** — a genuine tier-to-tier change. Every governed flag is written,
  **including an explicit `false`**, which is what actually withdraws a paid
  feature. Emitting only the *granted* keys — the obvious implementation — leaves
  the higher tier's flags on for a tenant now paying less, and nothing ever turns
  them off.

---

## Never read the processor's entitlements at runtime

Stripe will happily tell you a customer's `active_entitlements`, and reading them
in the gate looks like the correct, normalised, single-source-of-truth design.

**Don't.** They are revoked the instant a subscription lapses. Wire them to the
runtime and a restaurant whose card expired on Saturday cannot take orders on
Sunday — you have converted a billing problem into an outage, for your
*paying* customer, at their busiest hour.

Billing is **record-only**. A lapsed subscription disables nothing; somebody sends
an email like a human being. The customer whose card failed is the customer you
most want to keep.

### The mapping lives in the dashboard, not the code

Each tier's product carries entitlement features whose **`lookup_key` *is* the
flag key**. That identity is the whole trick: "Pro now includes analytics" becomes
an attach in the billing dashboard, with no deploy and no code change. The code
never learns which tier grants what — it only asks "what does this tier grant"
and writes the answer.

Keys that are not real flags are **dropped rather than trusted**, because a
billing dashboard is a place humans type strings.

---

## A flag with no consumer is a lie

We shipped two flags that were live, flippable, visible in the admin panel, and
**read by absolutely nothing** for months.

Nobody noticed, because a flag that does nothing looks exactly like a flag that
works and is currently off. An operator flips it, nothing happens, and they report
that the product is broken — which it is, in the way that is hardest to see.

So every flag declares the file that reads it, and a test asserts that file exists
and mentions the key:

```ts
{ key: 'delivery', readSite: 'src/features/ordering.ts' }
```

`tests/registry.test.ts` checks it in **both directions**: no flag without a read
site, and no read site consuming a key the registry does not declare — because
that second one resolves to `undefined`, which is falsy, so the capability
silently disappears rather than erroring.

It is a `readFileSync` and a substring check. It would have caught both.

---

## Wiring a dark flag needs a backfill

Absent row ⇒ off. That default is correct, and it is a trap the day you finally
wire up a flag that has been sitting dark in the registry.

Ship the read site and every **existing** tenant is silently off, with no row to
flip and nothing in the admin UI to show a decision was ever available. New
tenants get their rows at provisioning; existing ones get them from a backfill
migration, or never.

Both paths are needed. `db/migrations/0004` is the backfill, and two details in it
are load-bearing:

- **It runs as the owner role**, which bypasses row security — which is what lets
  one statement read `organization` and write `tenant_features` across every
  tenant. Neither the app role nor the platform role could. A cross-tenant write
  is a migration-time privilege, not a runtime one.
- **`ON CONFLICT DO NOTHING`**, so a re-run never re-disables a tenant who has
  since turned it on. Migrations get replayed — fresh environments, redeploys, a
  restored volume.

---

## Preconditions must share the transaction

Some flags cannot be enabled unconditionally: *"you may not turn on ordering with
zero products."*

The check and the write **must be in one transaction**, and the API is shaped so
they cannot be separated:

```ts
setEnablementGuardedIn(uow, tenantId, feature, true, precondition)
```

A precondition evaluated in its own transaction releases its locks *before* the
write lands, reopening precisely the window it exists to close. And no black-box
test can tell the two shapes apart, because both block identically when the rows
are contended. Making it structural is the only guarantee actually available.

---

## Tests

```
30 pass, 0 fail
```

The ones worth reading:

| Test | What it protects |
|---|---|
| `every feature names a read site that exists and reads it` | The two dark flags |
| `read sites only reference keys the registry declares` | Silent `undefined` ⇒ falsy |
| `governed is a small subset` | Billing's blast radius |
| `a tier granting a BASELINE flag cannot write it` | No downgrade can close a shop |
| `renewal, payment failure and cancellation write nothing` | **The invariant** |
| `a lapsed subscription disables NOTHING` | Record-only billing |
| `a downgrade withdraws` | The explicit `false` |
| `enablement is RLS-isolated` | It is tenant data like any other |
| `the backfill fills existing tenants, and re-running never re-disables one` | Migration replay |
| `an unknown row is ignored, not fatal` | Removing a flag must not break every tenant carrying its row |

---

## What this repo is not

- **No admin UI.** Where maturity would actually earn its keep is a panel that
  warns before a human flips an alpha switch. The data model is here; the screen
  is not.
- **No cache.** Production puts a per-tenant config cache in front of
  `loadFeatures` with `LISTEN/NOTIFY` invalidation — the `pg_notify` calls in the
  write path are the hook, and they fire transactionally so a rollback cannot
  invalidate on a write that never happened. The listener itself is out of scope.
- **No live billing integration.** `resolveSeed` is a function you supply. The
  demo inlines two tiers so it runs with no account; in production it reads the
  processor's entitlements **before** the transaction opens, because holding a
  Postgres transaction open across a third party's API call is how a slow vendor
  becomes lock contention.
- **No audit trail.** *Who* turned this off and when is a real requirement and
  `updated_at` is not an answer to it.

## Licence

MIT.
