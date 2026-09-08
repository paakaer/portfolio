# Compliance pressure from your clients

Your customers have started asking what you store, who can reach it, and how you
would prove either — NIS2, ISO 27001, GDPR, the AI Act, arriving as a questionnaire
and landing on whoever runs the systems.

**What this is not:** a certification practice — no ISO 27001 gap assessment, no
NIS2 readiness review, no AI Act conformity work. What is here is a system that
produces evidence as a by-product of running — the expensive part to retrofit.

## Start here

**[Cut 8 — Consent under Italian law](../cut-08-italian-compliance/)** · also in
Italian. Cold commercial email to a company is unlawful in Italy without prior
consent, and legitimate interest cannot substitute — article and Garante decisions
named, so your lawyer gets something specific. The model: consent per channel, a
mechanism naming an act on a named screen, versioned wording, and a soft opt-in
computed at send time rather than stored.

**[Cut 1 — Access control you can demonstrate](../cut-01-multitenant/)** ·
runnable. The boundary sits in Postgres, not application code. A test enumerates
every tenant table and fails CI on one without a policy, so "who can reach this
data" is a test result rather than an assertion.

**[Cut 7 — Where evidence lives](../cut-07-observability/)** — audit records go in
the database, not a telemetry vendor, so they outlive a free tier and a vendor
change.

## Then

**[Cut 6 — Entitlements](../cut-06-entitlements/)** · runnable — every capability
switch names the file that reads it; billing is record-only.
**[Cut 4 — Infrastructure](../cut-04-selfhosted/)** · runnable — the eight ways it
failed, and the restore rehearsal.

## The rest

[Payments](../cut-02-payments/) · [WhatsApp](../cut-03-whatsapp/) ·
[AI ingestion](../cut-05-menu-ingestion/) · [Delivery](../cut-09-agentic-delivery/)

The routine half — collecting evidence, moving records, chasing what expires — I
automate with n8n. The modelling above decides whether that automation is worth
having.

## What a first engagement looks like

One consent or access-control surface modelled and wired to a chokepoint every send
path must call, or one audit trail moved somewhere it can be queried. Typically two
to six weeks <!-- TODO: Albert — confirm duration -->, ending in a schema, a test
that fails when the rule is broken, and a note naming the sources.
