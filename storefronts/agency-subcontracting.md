# For agency tech leads

You have a client build in Next.js and TypeScript, and the backend or the
infrastructure is the part you would rather subcontract than staff. Everything
below is already written and, where marked runnable, already runs.

## Start here

**[Cut 1 — Multi-tenant Postgres](../cut-01-multitenant/)** · runnable
Shared-schema row-level security, fail-closed: unset tenant context returns zero
rows. A coverage test reads the catalogue and fails CI when a tenant table ships
without an isolation policy, and three mutations are documented showing the test
goes red — including one that changes no observable behaviour at all.

**[Cut 2 — Marketplace payments](../cut-02-payments/)**
Stripe Connect direct charges when the order is not confirmed at checkout:
authorise, hold, capture days later. Covers the capture outbox, webhook
idempotency, and the sweep that must never void a fulfilled order.

**[Cut 4 — Self-hosted infrastructure](../cut-04-selfhosted/)** · runnable
One VPS, wildcard subdomains and per-customer domains with no per-tenant config.
Eight production failure modes, seven of them silent. `docker compose up`, then
`./verify.sh`.

## Then

**[Cut 6 — Entitlements](../cut-06-entitlements/)** · runnable — per-tenant flags a
billing tier seeds but does not govern, so a failed card disables nothing.
**[Cut 7 — Observability](../cut-07-observability/)** — OpenTelemetry over a vendor
SDK, and the alert rules that stayed green because they queried a metric nothing
emitted.
**[Cut 9 — Delivery](../cut-09-agentic-delivery/)** — a milestone in, one reviewable
branch out, with a deterministic diff guard on auth, tenant isolation, payments and
migrations. A human opens every pull request.

## The rest

[WhatsApp Cloud API](../cut-03-whatsapp/) ·
[AI menu ingestion](../cut-05-menu-ingestion/) ·
[Italian consent law](../cut-08-italian-compliance/)

## What a first engagement looks like

One scoped piece, not a retainer: a tenant-isolation boundary with its coverage
test, a payments flow with its outbox and sweep, or a deployment moved onto one
host with routing, rollback and a rehearsed restore. I work in your repo and
through your review process — branches arrive reviewable, never self-merged.
Typically two to four weeks <!-- TODO: Albert — confirm duration -->, with
something you can run at the end of the first one.
