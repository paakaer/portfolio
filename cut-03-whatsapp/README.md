# WhatsApp Cloud API for ordering

**Tech Provider status, template approval, and the session window — the
operational knowledge, not the API surface.**

A short write-up. *Versione italiana: [`README.it.md`](README.it.md).*

The Cloud API docs tell you how to send a message. They do not tell you that your
template's category can change without you doing anything, that a template can be
approved and still unsendable, or that a button which looks correct in Meta's
preview can silently produce a broken link for every customer. Those are the
things that cost weeks.

---

## 1. The three facts that decide your architecture

**The 24-hour session window.** A business can send freely for 24 hours after the
customer's last message. Outside it, only a **pre-approved template**. This is not
a rate limit; it is a different message type with a different approval path and a
different price. Design for it or you will discover it the first time an operator
tries to answer someone the next morning.

**Templates are approved per WABA, and re-categorised without notice.** Approval
is asynchronous and revocable. A template you never touched can move from
`APPROVED` to `PAUSED` or `DISABLED` on quality grounds, and its **category** can
be reclassified by Meta — most painfully `UTILITY → MARKETING`, which changes both
the price and whether you may send it at all.

**Category is Meta's call, not yours.** Since April 2025, `allow_category_change`
defaults to **true**. You submit a UTILITY template; Meta may return a MARKETING
one; nothing errors. If your legal basis for messaging is transactional, this
quietly moves you outside it — your basis has not changed, but Meta's enforcement
acts on the category *it* assigned.

**So: check the category on the API response and hard-fail on a mismatch.** Do
not assume the category you asked for is the category you got.

---

## 2. Tech Provider, and why it changes the shape of the product

As a **Meta Tech Provider** you can onboard a client's WhatsApp Business Account
through **Embedded Signup**: they click through a Meta-hosted flow, and their
number lands under your app without either party sharing a password.

The alternative is asking a pizzeria owner to create a Business Manager, verify a
business, and register a phone number. In practice that is where the project
dies.

Three consequences that are not obvious until you are in it:

- **Onboarding becomes a feature, not a support ticket.** It is the difference
  between "sign up" and "book a call with the founder".
- **You now custody tokens for other businesses.** A per-tenant credential vault
  with real encryption stops being optional. Rotating the encryption key
  crypto-shreds every tenant's connection with no recovery but reconnecting each
  one by hand — a thing worth writing on the wall next to the key.
- **The Graph API version is a live dependency.** Pinned versions expire, and an
  expired version does not fail loudly — **it silently reroutes** to a newer one
  whose behaviour you have not tested. Track the deprecation calendar; treat a
  version bump as a change, not a chore.

Embedded Signup itself gets deprecated and replaced on Meta's schedule, not
yours. Budget for a migration you did not choose.

---

## 3. The reconcile sweep — the piece nobody builds until it hurts

Your local record of a template's status is a **cache of a remote decision that
changes without asking you.** Webhooks tell you about transitions, but webhooks
are lossy: a delivery fails, a status you do not handle arrives, an operator edits
something in Meta's UI.

So there are two mechanisms, and you need both:

1. **Webhooks** — `message_template_status_update` and `template_category_update`
   land on the shared app callback, batched per entry, per change, in the *same*
   envelope as inbound messages. Walk the whole envelope or you will drop events
   that arrived alongside something else.
2. **A periodic reconcile sweep** — read the truth back from the API, per WABA,
   and upsert. Idempotent: check whether the template exists, create it if not,
   read the category off the response, hard-fail on a mismatch, upsert the
   registry row. Running it twice leaves no duplicates in either place.

**Handle the statuses you do not know.** Meta has states beyond the ones you
model (`IN_APPEAL`, `FLAGGED`, and more over time). Skipping an unknown status
silently is fine *if* the reconcile sweep will eventually correct the record.
Without the sweep, skipping is data loss.

---

## 4. The bug worth the whole write-up

Every operator order link in production was dead, for days, and nothing reported
an error.

WhatsApp template buttons come in two kinds. A **dynamic** URL button carries a
`{{1}}` placeholder and you supply the value at send time. A **static** URL button
has a fixed URL and takes no parameter.

We had a static button. Meta's preview rendered it correctly. Sends succeeded. The
API returned 200. But at delivery the supplied value was **appended to** the fixed
URL rather than substituted into it, and every operator received a link to a URL
that did not exist.

Three properties made it expensive:

- **It only appears at delivery.** Not in the template editor, not in the API
  response, not in any status.
- **The send succeeds.** There is no failed message to alert on, no error rate to
  watch, no retry that would have caught it.
- **The operators assumed it was them.** A dead link reads as a broken phone, not
  a broken platform, so it was not reported for days.

**The generalisable lesson:** in this API the difference between static and
dynamic is not a flag you set, it is which shape you submitted at approval time —
and once approved, a mismatch between that shape and your send payload is not an
error, it is a wrong result. **Test one real delivery to a real handset per
template.** Not the preview. Not a 200 from the API. A phone.

---

## 5. What we send, and what we deliberately do not

**Outbound only, to start.** The base ordering path is a prefilled `wa.me` link:
the diner taps, WhatsApp opens with the order already composed, they send it
themselves. No API, no template, no session window, no per-tenant onboarding.

That is not a stopgap, it is a good default. It works on day one for every tenant,
costs nothing, and puts the message in the diner's own thread with the restaurant
— which is where they will look for it later anyway.

The Cloud API earns its complexity for the messages the restaurant must
*initiate*: order confirmed, order ready, order cancelled, pickup time changed. A
dozen templates, all UTILITY, all short.

**Delivery receipts are currently dropped.** The `statuses` webhook payloads are
parsed as non-message events and discarded, which means "sent" is the last thing
we actually know. That is a real gap, honestly stated: we can tell you a message
left, not that it arrived.

---

## 6. The five-line checklist

If you are starting a WhatsApp integration this week:

1. **Get Tech Provider status before you build onboarding.** It changes what
   onboarding *is*.
2. **Read the category off every approval response and fail loudly on a
   mismatch.** Do not trust the category you submitted.
3. **Build the reconcile sweep with the webhook, not after it.** The webhook is
   lossy; the sweep is the source of truth.
4. **Send one real message per template to a real phone before go-live.** The API
   will lie to you by succeeding.
5. **Pin the Graph API version and diary its expiry.** Expiry reroutes silently.

---

## What is not here

- **No repo.** This needs a Meta app, a verified business, a WABA and a live
  number to run. A demo repo would be a screenshot with extra steps.
- **The Loom is the artefact.** An order placed from a storefront arriving in
  WhatsApp on a sandbox number, and the operator's reply going back — about
  ninety seconds. This document is the supporting note.
- **No inbound conversational flow.** We do not run a bot. The diner talks to the
  restaurant, not to us, and I think that is correct for this market — but it
  means I have not built NLU, intent routing, or a conversation state machine.
