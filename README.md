# Portfolio — working directory

Nine cuts of one production multi-tenant SaaS, packaged as portfolio assets.

**This repo is the staging area, and it is private on purpose.** The plan is that
each cut becomes its own public repo or its own write-up — keeping them together
here makes them reviewable in one place first. Nothing goes public until it has
passed the *Scrub gate* below.

### Splitting a cut out when it goes public

Each cut is a self-contained directory, so publishing one is:

```bash
git subtree split -P cut-01-multitenant -b cut-01
gh repo create condominio --public
git push condominio cut-01:main
```

That carries the directory's own history into the new repo. Nothing here needs
restructuring first.

## The cuts

| # | Cut | Buyer | Artefact | Status |
|---|-----|-------|----------|--------|
| 1 | **Multi-tenant Postgres (RLS)** | Agency TD building a client's SaaS slice | Repo + white-label demo | **Built · runs** |
| 2 | **Marketplace payments: holds & captures** | Agency / founder needing Connect | Write-up + Loom | **Written** · Loom to record |
| 3 | **WhatsApp Cloud API commerce** | Italian agencies & SMEs | Write-up (EN + IT) + Loom | **Written** · Loom to record |
| 4 | **Self-hosted infra runbook** | Founders with Vercel bill shock | Runbook + cost table + demo | **Built · runs** · prices to fill |
| 5 | **AI menu ingestion** | Agencies wanting AI that isn't a chatbot | Repo + Loom | **Built · runs** · Loom to record |
| 6 | **Entitlements & feature gating** | Agencies selling tiered client capabilities | Repo | **Built · runs** |
| 7 | **Observability on Bun** | Same buyer as #4 | Write-up | **Written** |
| 8 | **Italian compliance** | Italian SMEs & their commercialista | Write-up (IT + EN) | **Written** |
| 9 | **Agentic delivery harness** | Nobody, directly — a call asset | Write-up | **Written** |

**All nine done.** Remaining before publishing: three Looms, and the `COSTS.md` figures.

## What each cut actually is

### Cut 1 — Multi-tenant Postgres (headline) — **BUILT** (`cut-01-multitenant/`)
Shared-schema + row-level security on Postgres 18, extracted and clean-roomed.
The decision doc (schema-per-tenant vs RLS vs database-per-tenant) written from
the winning side, having run *both* in production. Star exhibit: the coverage test
that fails CI if any tenant table lacks an isolation policy. Includes the
white-label demo — two invented brands, two subdomains, one container, one schema.

Green from a fresh volume: 13 tests, tsc clean, two-brand demo serving, probe
blocking 4/4. The coverage test is mutation-verified — dropping `FORCE` changes no
observable behaviour and only the structural check catches it.

### Cut 2 — Marketplace payments: holds & captures — **WRITTEN** (`cut-02-payments/`)
**Not** "two payment rails" — Satispay was never built, only researched. The real
and rarer story: Connect direct charges where the restaurant is merchant of record,
and the order isn't confirmed at checkout — so you authorise, hold, and capture
later. Covers the capture outbox, the expired-hold sweep, webhook idempotency, and
the cross-tenant capture guard. Framed as decisions and failure modes.

### Cut 3 — WhatsApp Cloud API commerce — **WRITTEN** (`cut-03-whatsapp/`, EN + IT)
Lead with Tech Provider status, Embedded Signup, and template approval mechanics.
Two things no tutorial has: the **template reconcile sweep** (Meta approves and
rejects asynchronously, so your local catalogue drifts from theirs), and the
static-URL-button `{{1}}` bug that silently killed every operator order link in
production. Short. Credibility, not lead-gen.

### Cut 4 — Self-hosted infra runbook — **BUILT** (`cut-04-selfhosted/`)
Coolify + Hetzner + Traefik. Four files: the runbook, `FAILURES.md` (eight production
failure modes, seven silent), `COSTS.md` (the model — **prices are placeholders
pending real invoices**), and `compose/`, a runnable reduction where four hosts reach
two containers with zero per-host config and `./verify.sh` passes 11/11.

The differentiator is `FAILURES.md`, not the setup steps. Anyone can write the setup
steps. Failure #8 — a wildcard router silently answering the API with the wrong app,
because Traefik's default tie-break is rule length — was found and reproduced while
building the demo.

### Cut 5 — AI menu ingestion — **BUILT** (`cut-05-menu-ingestion/`)
Photo of a paper flyer → structured, priced, categorised menu with a human review
queue before publish. Multi-provider router with fallback. The honest note: a
misconfigured primary provider falls through to the fallback **silently**, so you
get confidently wrong output instead of an error — a fallback chain is a
correctness bug wearing a resilience costume.

### Cut 6 — Entitlements & feature gating — **BUILT** (`cut-06-entitlements/`)
`quadro` — the switchboard. Built on cut 1's tenant scaffolding, so the family is
visible: `condominio` answers *can A see B's data*, `quadro` answers *what has A
got switched on*.

The two-facts model: global **maturity** (advisory) vs per-tenant **enablement**
(runtime truth, one field). A tier change seeds flags — including an explicit
`false` on downgrade, which is what actually withdraws a paid feature — and then
nothing re-writes them: renewals, payment failures, cancellations and redelivered
webhooks are all no-ops. The tier→feature map lives in the billing dashboard
(entitlement `lookup_key` == flag key), so changing what a tier grants needs no
deploy.

Two things it enforces mechanically: **baseline capability is ungoverned**, so no
downgrade can close a shop; and **every flag must name the file that reads it**,
tested in both directions — the cure for two flags we shipped that were live,
flippable, and read by nothing for months.

`bun run demo` walks seven subscription events and shows which three change
anything. 30 tests, tsc clean, green from a fresh volume.

### Cut 7 — Observability on Bun — **WRITTEN** (`cut-07-observability/`)
OpenTelemetry + Grafana provisioning against a runtime that isn't Node. Honest
finding: the `runtime-node` heap-spaces collector throws on every interval under
Bun while the event-loop metrics work fine. Also worth saying out loud — alert
rules that query a metric your server never emits are worse than no alerts, because
they are permanently green.

### Cut 8 — Italian compliance — **WRITTEN** (`cut-08-italian-compliance/`, IT + EN)
Art. 121 c.1-bis lett. f) extends the opt-in requirement to *persona giuridica*, so
cold B2B email is unlawful in Italy — which most English-language "outbound"
playbooks get wrong for this market. Plus consent storage, and the trap of having
two consent stores that must both be consulted. Italian first; this is the cut where
being local *is* the moat.

### Cut 9 — Agentic delivery harness — **WRITTEN** (`cut-09-agentic-delivery/`)
How one person runs a multi-tenant SaaS in production: milestone in, implementer
agent, adversarial security-and-design gate, consolidated to one reviewable branch.

**Positioning risk, stated once:** some buyers read this as "AI wrote his code" and
discount everything else in the portfolio. Recommended placement is *below the fold*
or reserved for the call — not on the landing page, and not as the first thing an
agency TD sees. Publishing it is the right call; leading with it is not.

## Sequence

1. **Cut 4** — cheapest, converts directly into a paid offer.
2. **Cut 1** — the headline. Everything else hangs off it.
3. **Cut 5** — best demo-to-effort ratio; makes the portfolio read as current.
4. **Cut 6** — small repo, reuses Cut 1's tenant scaffolding.
5. **Cut 3** (IT + EN) — sales support.
6. **Cut 7** — folds naturally out of Cut 4's infra.
7. **Cut 8** — write-up only, pairs with Cut 3 for the Italian buyer.
8. **Cut 2** — last; needs the most careful writing.
9. **Cut 9** — whenever; it is not on the critical path to an invoice.

## Scrub gate

No cut goes public until all four pass:

- [ ] No tenant names, slugs, hosts, or customer data
- [ ] No real email addresses (the cutover CLI in the source repo contains one)
- [ ] No credentials, tokens, Meta app IDs, Stripe keys, or template IDs
- [ ] No internal issue numbers, ADR numbers, or milestone references

## Provenance note

A public, dated repo is only evidence of pre-existing work if the date is real.
Clean-rooming into a fresh repo with squashed history gives a date and nothing
else. Get the repos public **before** signing anything that assigns IP, and keep
the private source history intact as the actual provenance record.
