# For an LLM prototype in production

The demo worked; what is missing is what stops a wrong answer reaching a customer,
what tells you it went wrong, and what it costs to run daily.

## Start here

**[Cut 5 — Ingestion with a human gate](../cut-05-menu-ingestion/)** · runnable.
A photographed menu becomes structured, priced data; the model proposes and never
publishes. Deterministic flags — missing or implausible price, per-kilo
ambiguity, duplicate name — block publication until a person resolves them. No
confidence threshold, no force flag: the score that would key one comes from the
system that made the error. Runs offline with no API key: 37 tests. It also
documents the bug worth your time: a misconfigured credential silently escalated to
the fallback and degraded output for weeks. Configuration errors now abort.

**[Cut 10 — WhatsApp ordering agent](../cut-10-whatsapp-agent/)** · runnable.
An agent that takes real orders by tool calling. Every price comes from the
database, never the model; a quote is bound to the cart and must be accepted in a
later message; allergies, complaints and loops go to a person. 88 tests run
offline; behavioural evals against the live model check the database, not the
wording.

**[Cut 11 — Handwritten pages to data](../cut-11-document-pipeline/)** · runnable, Python.
A FastAPI service reads photographed order-book pages into typed records, and a
React screen lets a person check and approve them. Accuracy and cost per page are
measured on every model. The first eval found dish-list errors on every model. Reading
them showed a missing input, not a weak model: given the shop's menu, Haiku reaches
100% on the test set at €0.93 per 1,000 pages, a thirtieth of Opus's cost.

**[Cut 7 — Observability](../cut-07-observability/)** — instrument against
OpenTelemetry, not a vendor SDK, so changing where telemetry goes is an
environment variable. Includes the alert rules that stayed green
because they queried a metric nothing emitted.

**[Cut 9 — Delivery](../cut-09-agentic-delivery/)** — where model output may go near
a codebase and where it may not: a deterministic diff guard on auth, tenant
isolation, payments and migrations; a human opens every pull request.

## Then

**[Cut 6 — Entitlements](../cut-06-entitlements/)** · runnable — switch a feature on
for one customer, and off again, without a deploy.
**[Cut 4 — Infrastructure](../cut-04-selfhosted/)** · runnable — one host, eight
failure modes, seven silent.

## What it costs to run

Cut 4's `COSTS.md` sets one real August 2026 invoice — €16.66 net, €16.58 fixed —
against a managed basket priced from list that day, $157.20 before overage. One
month of one workload, as the document says: the transferable part is the method,
not the ratio.

## The rest

[Multi-tenant Postgres](../cut-01-multitenant/) · [Payments](../cut-02-payments/) ·
[WhatsApp](../cut-03-whatsapp/) · [Consent law](../cut-08-italian-compliance/)

## What a first engagement looks like

One prototype moved behind a gate: the model call behind a port, deterministic
checks in front of anything a customer sees, a review queue where a person can
correct, confirm or delete, telemetry you can query. Three to six weeks
<!-- TODO: Albert — confirm duration -->, ending with the pipeline on your
infrastructure and tests that need no API key.
