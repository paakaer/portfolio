# Portfolio

I design and run a production multi-tenant SaaS — Postgres, Bun, TypeScript, self-hosted —
and these are nine cuts of it. Each directory stands on its own.

I take subcontracted backend and infrastructure work from design-led agencies in DACH
and northern Italy building in Next.js and TypeScript. I also work with SMEs that need
compliance automation or AI features running in production without an in-house team.

[![CI](https://github.com/paakaer/portfolio/actions/workflows/ci.yml/badge.svg)](https://github.com/paakaer/portfolio/actions/workflows/ci.yml)

| # | Cut | |
|---|-----|---|
| 1 | [**Multi-tenant Postgres**](cut-01-multitenant/) | Shared-schema RLS, fail-closed — with a coverage test that fails CI if any tenant table lacks an isolation policy. |
| 2 | [**Marketplace payments**](cut-02-payments/) | Stripe Connect direct charges when you cannot charge at checkout: authorise, hold, capture days later. |
| 3 | [**WhatsApp Cloud API commerce**](cut-03-whatsapp/) | Tech Provider status, template approval, and the reconcile sweep for a catalogue that drifts asynchronously. |
| 4 | [**Self-hosted infra runbook**](cut-04-selfhosted/) | Coolify + Hetzner + Traefik, plus eight production failure modes — seven of them silent. |
| 5 | [**AI menu ingestion**](cut-05-menu-ingestion/) | A photographed paper menu becomes structured, priced, reviewable data — with a human gate before publish. |
| 6 | [**Entitlements & feature gating**](cut-06-entitlements/) | Per-tenant flags a billing tier seeds but does not govern, and a test that no flag ships unread. |
| 7 | [**Observability on Bun**](cut-07-observability/) | OpenTelemetry against a runtime that isn't Node, and the alerts that were green because they queried nothing. |
| 8 | [**Italian compliance**](cut-08-italian-compliance/) | What an Italian business can lawfully send, to whom, and how to model consent so it survives an audit. |
| 9 | [**Agentic delivery harness**](cut-09-agentic-delivery/) | How one person ships and operates the whole system: a milestone in, one reviewable branch out. |

## Start here, depending on who you are

- **[Agency tech lead](storefronts/agency-subcontracting.md)** — subcontracting the
  backend or the infrastructure of a client build.
- **[Compliance pressure from your clients](storefronts/compliance-automation.md)** —
  questionnaires about what you store and who can reach it.
  *[Versione italiana](storefronts/compliance-automation.it.md).*
- **[An LLM prototype that has to run in production](storefronts/ai-in-production.md)** —
  the demo works; the gates, the telemetry and the running cost do not exist yet.

Cuts 1, 5 and 6 are runnable repositories — `bun install && bun test`, with
`bun run db:up` first where a database is needed. Cut 4 ships a compose reduction
and a `verify.sh`. The rest are write-ups; cuts 3 and 8 are also in Italian.

MIT licensed.

## Contact

- Email — `<email>`
- Malt — `<Malt profile URL>`
- Freelancermap — `<Freelancermap profile URL>`
