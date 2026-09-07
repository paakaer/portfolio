# The cost delta

> **The self-hosted column is one real Hetzner invoice — August 2026, net of VAT.**
> The managed column is not an invoice: I have never run this workload on those
> platforms, so it is a basket I priced from published rates on **7 September 2026**
> and it must be re-checked before anyone quotes it. The two columns are different
> kinds of evidence and are labelled as such throughout. The *model* is the durable
> part; the numbers are not.

---

## What is actually running

A cost comparison is meaningless without the workload stated precisely. This is it:

| | |
|---|---|
| Host | 1 × ARM64 VPS, 4 vCPU / 8 GB RAM, no swap — Hetzner CAX21 |
| Web | Next.js, standalone output, SSR on every request |
| API | Long-running HTTP service |
| Database | Postgres 18, same host, local volume |
| Worker | Scheduled jobs, headless browser for PDF rendering |
| Proxy | Traefik — TLS termination, wildcard + custom domains |
| Control plane | Coolify, same host |
| Object storage | S3-compatible, separate |
| Tenants | Multiple, each on its own domain, one shared deployment |

Two properties of this workload matter more than any price:

1. **Load is predictable and modest.** Restaurant storefronts have a lunch peak and a
   dinner peak. There is no viral spike to absorb.
2. **It is always on.** Four long-running processes, one of which is a database. There
   is no meaningful idle period to scale to zero for.

Those two facts decide the entire comparison. Read the section *When managed wins*
before assuming your workload is this one.

---

## Self-hosted — actual invoice

Hetzner, billing period 08/2026, **net of VAT** (reverse-charge, so net is the number
that matters to the business). Every line below is a line on the bill.

| Line | Monthly | Notes |
|---|---|---|
| CAX21 Cloud Server (4 vCPU / 8 GB ARM) | `€7.99` | The whole stack. Fixed. |
| Backup | `€1.60` | Exactly 20.00% of instance price — 20 × €0.0799 |
| Primary IPv4 | `€0.50` | Fixed. The line every comparison forgets. |
| Snapshot | `€0.08` | 5.7871 GB-months × €0.0143. Variable, trivially so. |
| Server traffic (20 TB included) | `€0.00` | 0 TB billed above the allowance |
| Object storage — base | `€6.49` | Fixed |
| Object storage — additional + traffic | `€0.00` | 0 TB-hours, 0 TB. Under quota. |
| Registry | `€0.00` | GHCR |
| DNS | `€0.00` | Free tier |
| TLS | `€0.00` | Let's Encrypt |
| Control plane | `€0.00` | Coolify, self-hosted |
| **Infrastructure total** | **`€16.66`** | Of which €16.58 is fixed |
| Operator time | `⟨hours⟩ × ⟨rate⟩` | **See below. This is the real line.** |

Three honest caveats about that €16.66:

- **It is one month, not three.** August 2026 only. The fixed lines cannot move, but
  a single month cannot show you a seasonal traffic bill.
- **Almost nothing here is metered.** €16.58 of the €16.66 is fixed subscription;
  the entire variable exposure was 8 cents of snapshot. That is the actual
  structural claim of this document, and it is visible in the shape of the invoice
  rather than argued for.
- **Object storage costs more than the server.** €6.49 against €7.99, at effectively
  zero usage, because it is priced as a subscription with a quota rather than per GB.
  At this scale the storage bill is a base fee, not a function of anything.

---

## Managed equivalent — list prices, checked 7 September 2026

Like-for-like means replacing four things, not one. Pricing a Vercel plan against a
VPS and stopping there is the mistake that makes these comparisons untrustworthy.

**This column is modelled, not billed.** Sizing choices are arguable in a way an
invoice is not, so they are stated here for you to disagree with:

- **Frontend** — Vercel Pro, one developer seat. With SSR on every request, the
  included 10 M edge requests / 1 TB fast data transfer / 1 M function invocations
  run out before the seat cost matters.
- **API** — a long-running HTTP service does not fit a function runtime, so it needs
  a container host. Fly `shared-cpu-4x` at 4 GB.
- **Postgres** — Neon Launch. Neon bills compute by the CU-hour with **no base fee**,
  which is excellent for a database that idles and brutal for one that does not: an
  always-on instance accrues every hour of the month.
- **Worker** — headless Chrome for PDF rendering needs real CPU rather than a shared
  slice. Fly `performance-1x` at 2 GB.
- **Object storage** — Cloudflare R2, 100 GB standard, free tier deducted.

| Line | Monthly (USD, net) | Basis |
|---|---|---|
| Frontend platform (SSR) | `$20.00` | Vercel Pro, 1 developer seat, before any overage |
| API host (long-running) | `$22.78` | Fly `shared-cpu-4x`/1 GB $7.78 + 3 GB × $5 |
| Managed Postgres — compute | `$77.38` | Neon Launch, 1 CU × 730 h × $0.106/CU-hour |
| Managed Postgres — storage | `$3.50` | 10 GB × $0.35/GB-month |
| Worker / cron host | `$32.19` | Fly `performance-1x`/2 GB |
| Object storage + egress | `$1.35` | R2: 90 GB × $0.015/GB-month; egress free |
| Custom domains / TLS | `$0.00` | Vercel Pro — no per-domain fee at this scale |
| **Total** | **`$157.20`** | Before a single unit of metered overage |

Two arithmetic notes, so the total is auditable: Fly quotes its machine prices per
**30 days**, so those two rows understate a 31-day month by about 3%; Neon is
computed at 730 h, an average calendar month. And the **$157.20 is the floor** — it
assumes zero Vercel overage, which an SSR storefront under real traffic will not
deliver.

### The delta

The columns are in different currencies and I am not going to launder that through
one FX rate that will be wrong next month. At EUR/USD anywhere between 1.05 and 1.20:

| | |
|---|---|
| Self-hosted, invoiced | **€16.66** |
| Managed basket, list | **$157.20** ≈ €131 – €150 |
| Difference | **≈ €114 – €133 / month** |
| Ratio | **≈ 7.9 – 9.0 ×** |

**The currency split is itself a cost.** The Hetzner bill is EUR and so is the
revenue; the managed basket is USD. A euro-earning business paying dollar invoices
has taken on an FX position it did not choose, and at these amounts nobody hedges it
— they just absorb it. Small here, real at scale.

---

## What actually drives the delta

The headline number is not the interesting part. Four structural differences are:

**1. You are buying variance insurance you may not need.**
Metered platforms price the *ability to absorb a spike*. That is genuinely valuable
if you might get one. A storefront with two predictable meal-time peaks never
exercises it, so the premium buys nothing. This is the whole argument, and it
reverses completely for a workload with real spikes. The invoice above is what that
looks like on paper: €16.58 of €16.66 fixed, because nothing was bought that could
scale.

**2. Multi-tenancy is priced differently on each side — but check *how*.**
On a VPS, the tenth tenant costs nothing: same containers, same database, one more
row (see the sibling multi-tenant repo for why). The managed side is where the
received wisdom needs correcting. **Vercel Pro does not charge per custom domain** —
the soft limit is 100,000 domains per project — so on that platform tenant count
reaches the bill through *metered requests and bandwidth*, not through a domain line
item. Elsewhere the per-unit charge is real and explicit: Fly bills $0.10/month per
hostname certificate after the first 10, and $1/month for a wildcard. Either way
**the delta widens with tenant count**, so a comparison done at one tenant tells you
almost nothing about your bill at thirty — but find the actual per-tenant mechanism
on your platform before you assert one.

**3. Egress is where managed bills surprise people — on some platforms.**
Bandwidth is usually the line that moves, and the spread is enormous: R2 charges
**nothing** for egress, Fly charges $0.02/GB from EU regions, and Vercel charges
$0.15/GB once the 1 TB included in Pro is gone — a 7.5× spread across three vendors
in the same basket. The Hetzner side simply did not have this line: 20 TB is included
with the server and 0 TB was billed above it. If you serve images, price egress on
both sides before anything else, per vendor rather than in general.

**4. Always-on is the worst possible shape for per-invocation pricing.**
Scale-to-zero is a discount for bursty, idle-heavy workloads. Four processes that
must stay warm — one of them a database — collect none of it. The Neon row is the
clearest instance: no base fee at all, genuinely cheaper than a fixed instance for a
database that sleeps, and **$77.38/month** for one that never does. Converted, that
single line is roughly four times the entire self-hosted bill, and it is not a
penalty — it is the
same pricing model working exactly as designed against a workload it was not designed
for.

---

## The line that is usually left out

**Operator time is the real cost of self-hosting, and it is not zero.**

`FAILURES.md` documents eight production failure modes from this stack. Seven of them
were **silent** — they presented as a slow site, a wrong password, a 404, or as
nothing at all. Not one announced itself at the layer that caused it.

That is what you actually buy from a managed platform: not uptime, but *attribution*.
When it breaks, someone else's on-call has to work out which layer it was.

Be honest in the arithmetic:

```
true monthly cost  =  infrastructure  +  (hours you spend on it × your rate)
```

With a real delta of €114–133/month, the break-even is now a number rather than a
worry — this is how many hours a month the stack has to cost you before self-hosting
stops paying:

| Your hourly rate | Break-even |
|---|---|
| €30 | ≈ 3.8 – 4.4 h/month |
| €50 | ≈ 2.3 – 2.7 h/month |
| €80 | ≈ 1.4 – 1.7 h/month |

**Read that table honestly, because it does not obviously favour self-hosting.** One
unplanned incident and a restore rehearsal can eat a month's saving at a
consultant's rate. The saving is real and it is roughly 8–9×, but it is a saving on
*infrastructure* and it is paid for in *attention*.

**But the break-even is per stack, and most of what sits above it is not.** Those are
the *marginal* hours on one stack, and they are dominated by a cost paid once: knowing
that a 404 is a stale `TRAEFIK_WEB_TARGET` and not a DNS problem, having rehearsed the
restore before you needed it, tracking when the proxy and Postgres want upgrading.
That knowledge is what `FAILURES.md` is — and it transfers whole to the next stack
built on the same pattern, because the incidents are the same incidents. The second
stack costs a fraction of the first and the fifth costs a fraction of the second, so
the useful question is not *self-host or don't* but **who owns it**: at a founder's
€80/h with one stack, this table often favours managed; for someone running several on
one playbook, the €114–133 repeats per stack while the operator hours barely move.

The honest recommendation: **self-hosting saves money when someone is going to own
it.** If nobody owns it, you have not cut costs, you have deferred them into an
incident.

---

## When managed wins

State this plainly or the whole document reads as advocacy:

- **Spiky or unpredictable traffic.** Variance insurance is worth paying for when you
  have variance.
- **No operator.** If there is no one to own the box, managed is correct at any price.
- **Compliance requiring managed backups, audit logs, or an RPO/RTO you would have to
  build.** Building that yourself costs more than the difference.
- **A team that ships more when it never thinks about infrastructure.** Real, and
  usually worth more than the delta.
- **Preview deployments per pull request.** Genuinely excellent, genuinely annoying
  to rebuild, and the thing teams miss most after migrating.

Two things to weigh that are not on either invoice:

- **Single-host risk.** One VPS is one failure domain, and the €16.66 buys exactly
  one. Multi-host or a managed database narrows the gap considerably, and honestly
  should be priced as the real comparison for anything revenue-bearing. Adding a
  second CAX21 and a managed database is not an 8× saving any more.
- **Restore, not backup.** An untested backup is not a backup. The €1.60 backup line
  is insurance whose payout has to be rehearsed. Budget the rehearsal; see the
  runbook.

---

## How to use this

The numbers above are mine. Yours will differ, and the method is the transferable part:

1. Pull real invoices from your own side. Not estimates. Three months if you have
   them — the column above is one month, which is enough for fixed lines and not
   enough for seasonal ones.
2. Re-price the managed basket on the day you publish, and **state the date**. Every
   figure in that column is a list price with a shelf life.
3. Add the operator-time line with an honest hour count — track it for a month first.
4. Re-run the comparison at your projected tenant count, not today's, using the
   per-tenant mechanism your platform actually bills on.

If it still wins after that, it is a real result and you can publish the number. If
it only wins with operator time set to zero, it did not win.

---

**Sources for the managed column, all checked 7 September 2026:**
[Vercel pricing](https://vercel.com/pricing) ·
[Vercel limits](https://vercel.com/docs/limits) ·
[Neon pricing](https://neon.com/pricing) ·
[Fly.io pricing](https://fly.io/docs/about/pricing/) ·
[Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
