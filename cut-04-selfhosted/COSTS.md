# The cost delta

> **⚠ PRICES ARE PLACEHOLDERS — fill from your own invoices before publishing.**
> Every figure marked `⟨…⟩` must come from a real bill, and every list price must be
> re-checked on the day you publish. A cost comparison with a stale number in it is
> worse than no comparison, because the one wrong row is the one a sceptical reader
> will find. The *model* below is the durable part; the numbers are not.

---

## What is actually running

A cost comparison is meaningless without the workload stated precisely. This is it:

| | |
|---|---|
| Host | 1 × ARM64 VPS, 4 vCPU / 8 GB RAM, no swap |
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

## Self-hosted

| Line | Monthly | Notes |
|---|---|---|
| VPS (4 vCPU / 8 GB ARM) | `⟨fill⟩` | The whole stack. Fixed. |
| Backups / snapshots | `⟨fill⟩` | Usually a % of the VPS price |
| Object storage + egress | `⟨fill⟩` | Scales with media, not traffic |
| Registry | `⟨0 if GHCR⟩` | |
| DNS | `⟨0 on free tier⟩` | |
| TLS | `0` | Let's Encrypt |
| Control plane | `0` | Coolify, self-hosted |
| **Infrastructure total** | **`⟨fill⟩`** | |
| Operator time | `⟨hours⟩ × ⟨rate⟩` | **See below. This is the real line.** |

## Managed equivalent

Like-for-like means replacing four things, not one. Pricing a Vercel plan against a
VPS and stopping there is the mistake that makes these comparisons untrustworthy.

| Line | Monthly | Notes |
|---|---|---|
| Frontend platform (SSR) | `⟨fill⟩` | Seat cost + metered functions/bandwidth |
| Managed Postgres | `⟨fill⟩` | The largest managed line, usually |
| Worker / cron host | `⟨fill⟩` | Headless-browser jobs do not fit most function runtimes |
| Object storage + egress | `⟨fill⟩` | Often dearer per GB than the VPS provider's |
| Custom domains / TLS | `⟨fill⟩` | Frequently per-domain above a plan's included count |
| **Total** | **`⟨fill⟩`** | |

---

## What actually drives the delta

The headline number is not the interesting part. Four structural differences are:

**1. You are buying variance insurance you may not need.**
Metered platforms price the *ability to absorb a spike*. That is genuinely valuable
if you might get one. A storefront with two predictable meal-time peaks never
exercises it, so the premium buys nothing. This is the whole argument, and it
reverses completely for a workload with real spikes.

**2. Multi-tenancy is priced very differently on each side.**
On a VPS, the tenth tenant costs nothing — same containers, same database, one more
row (see the sibling multi-tenant repo for why). On per-domain or per-project managed
pricing, tenants can be a per-unit line item. **The delta widens with tenant count**,
which means a comparison done at one tenant tells you almost nothing about your bill
at thirty.

**3. Egress is where managed bills surprise people.**
Compute is usually the line people compare. Bandwidth is usually the line that moves.
If you serve images, check egress pricing on both sides before anything else.

**4. Always-on is the worst possible shape for per-invocation pricing.**
Scale-to-zero is a discount for bursty, idle-heavy workloads. Four processes that
must stay warm — one of them a database — collect none of it.

---

## The line that is usually left out

**Operator time is the real cost of self-hosting, and it is not zero.**

`FAILURES.md` documents seven production failure modes from this stack. Six of them
were **silent** — they presented as a slow site, a wrong password, a 404, or as
nothing at all. Not one announced itself at the layer that caused it.

That is what you actually buy from a managed platform: not uptime, but *attribution*.
When it breaks, someone else's on-call has to work out which layer it was.

Be honest in the arithmetic:

```
true monthly cost  =  infrastructure  +  (hours you spend on it × your rate)
```

If the stack takes four hours a month to run and your time is worth anything, that
term can exceed the infrastructure saving outright at small scale. The saving is real
and often large — but it is a saving on *infrastructure*, and it is paid for in
*attention*.

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

- **Single-host risk.** One VPS is one failure domain. Multi-host or a managed
  database narrows the gap considerably, and honestly should be priced as the real
  comparison for anything revenue-bearing.
- **Restore, not backup.** An untested backup is not a backup. Budget the restore
  rehearsal; see the runbook.

---

## How to use this

1. Pull three months of real invoices from both sides. Not estimates.
2. Fill every `⟨…⟩`.
3. Add the operator-time line with an honest hour count — track it for a month first.
4. Re-run the comparison at your projected tenant count, not today's.

If it still wins after that, it is a real result and you can publish the number. If
it only wins with operator time set to zero, it did not win.
