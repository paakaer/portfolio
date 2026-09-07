# Observability on Bun, without a vendor

**OpenTelemetry, a free-tier sink, and the alerts that were green because they
queried nothing.**

A write-up, companion to the [self-hosted infra runbook](../cut-04-selfhosted/).
That document tells you how to run the box. This one tells you how you find out
it is broken.

---

## The three constraints

Every decision below falls out of these, and they are worth stating because most
observability advice assumes none of them:

1. **Vendor lock-in is the biggest risk for a small team.** Switching sinks later
   must not mean re-instrumenting the application.
2. **The database is the system of record, including for evidence.** Audit trails
   and request logs belong in Postgres — queryable, retained on your terms — not
   in a telemetry SaaS that expires them on its own schedule.
3. **Budget is zero until there is revenue.** The v1 sink has to be free.

---

## Decision 1 — Instrument against OpenTelemetry, never a vendor SDK

Application code imports `@opentelemetry/api` and nothing else. No Grafana, no
Datadog, no Sentry SDK anywhere in the service.

**Why it is worth the extra layer:** instrumenting against a vendor SDK is a
one-way door. Every span, counter and attribute you write becomes a migration
cost. Against OTel, changing where telemetry *goes* is an exporter config change
— an environment variable — and the code is untouched.

The boundary is the hedge. You are not betting on OTel being better than a
vendor's SDK; you are buying the option to be wrong about the vendor.

**The no-op contract that makes it liveable:** the SDK initialises to a **no-op
when the OTLP endpoint is empty.** Local development and CI need no collector, no
credentials, and no special mode. A developer never thinks about telemetry, and
telemetry never breaks a test run. Pair it with the same convention everywhere
(empty key ⇒ feature off, never a boot crash) and the whole class of "it works on
my machine because I have the env var" disappears.

---

## Decision 2 — Direct OTLP export first, a collector later

v1 exports OTLP/HTTP straight from the service to a hosted free tier. No agent, no
sidecar, no collector to run.

That is the right first move because a collector is another always-on process on
a box you are already fitting into 8 GB, and it buys nothing until you have
something a collector solves: host metrics, multiple services, or dual export.

**What it cannot do, stated plainly:** an application cannot emit its own host
CPU, memory, disk or load. If you export directly from the app, you have
application telemetry and no infrastructure telemetry — which means you will see
the symptom (latency) and not the cause (the box is swapping). Adding a collector
later is a config change, and the OTel boundary is what keeps it one.

---

## Failure mode 1 — Alerts that query a metric nothing emits

The worst outcome in this whole document, because it inverts the purpose of the
system.

The initial alert rules were written against the **OTel semantic-convention**
metric names — `http_server_request_duration_seconds_*`. Reasonable: those are the
documented names, and they are what the auto-instrumentation emits *when your HTTP
server is one the instrumentation understands*.

Ours is not. `Bun.serve` is not Node's `http` module, so the auto-instrumentation
never hooked it, and those metrics were never emitted. The application's real
metrics came from a hand-written middleware under our own namespace.

So the alert rules queried a metric that did not exist. And a Prometheus-style
alert on an absent series does not error, does not warn, and does not go unknown —
**it evaluates to nothing and stays green.**

We had three golden-signal alerts, a dashboard, and a provisioning pipeline. We
had no alerting at all, and everything on the screen said we did. That is strictly
worse than having none, because it converts an open question into a false
reassurance.

**The fix is one check, and it belongs in CI:** every metric name referenced by an
alert rule must exist in the set of metric names the code registers. It is a grep
and a set difference. Ours now carries a warning comment at the top of the rules
file explaining what happened, which is the second-best form of the check.

**The general rule:** an alert you have never seen fire is not evidence of health.
Fire every alert once, deliberately, on purpose, before you trust any of them.

---

## Failure mode 2 — The runtime instrumentation that half-works

`@opentelemetry/instrumentation-runtime-node` does what it says on Node. On Bun,
its **heap-spaces collector throws on every collection interval** — it reaches for
a V8 API that Bun does not expose the same way.

The event-loop metrics from the same package work fine.

So you get a genuinely useful signal and a stack trace every few seconds, from one
package, forever. The options are to disable the package (losing event-loop lag,
which is the metric you actually want on a single-threaded runtime), or to keep it
and accept log noise that trains everyone to ignore that log line.

We kept it. That is a defensible choice and it has a cost, and the cost is worth
naming: **a recurring error you have decided to tolerate is indistinguishable from
one you have not noticed**, three months later, to someone who was not in the
room. Write it down where the logs are read.

**The broader point about Bun:** the runtime is excellent and the observability
ecosystem is still written for Node. Auto-instrumentation is where that gap
shows, and it shows *by silently not working* rather than by failing. Budget for
hand-writing the instrumentation you assumed you would get for free — that is
where the HTTP metrics came from, and it is why they were under a different name
than the alerts expected.

---

## Failure mode 3 — A healthcheck that cannot go unhealthy

Covered in the [infra runbook](../cut-04-selfhosted/FAILURES.md#3) as an infra
problem; it is equally an observability one.

A scheduled-jobs container crash-looped for a day with no signal. `restart:
unless-stopped` plus no healthcheck means Docker faithfully restarts a container
that dies at boot, forever, and it reads as *up* everywhere you would look.

The fix is a healthcheck that reads a **heartbeat the job runner refreshes once it
is actually running** — not one that checks the process exists, because the
process does exist, briefly, over and over.

**And the half that is still missing:** Docker marks the container `unhealthy` and
does nothing. It does not restart on health. Alerting on unhealthy is a separate
piece of work, and a runbook that claims the healthcheck solved this is lying.

---

## What actually gets watched

Four golden signals, and one thing that is not a signal:

| | Where it comes from |
|---|---|
| **Rate** | Request counter, hand-written middleware, per route template |
| **Errors** | Error counter, same middleware |
| **Duration** | Request histogram, p95 |
| **Saturation** | Host metrics — **needs a collector**, which is why this line is honest and not yet complete |
| **Audit** | **Postgres.** Not telemetry. |

**Audit records go in the database, deliberately.** They are evidence: who changed
what, in which tenant, when. They must be queryable with a join against the rows
they describe, retained on a schedule you choose, and still there when a telemetry
free tier expires them or you change vendor. Telemetry is for *noticing*; the
database is for *proving*.

The same reasoning puts the request log in Postgres. It is written cross-tenant
from the hot path and read only by a hard-gated platform view — which is exactly
why it is one of the deliberate no-RLS exceptions in the
[multi-tenant repo](../cut-01-multitenant/), documented as a security decision
rather than an oversight.

---

## Cost

Free, at this scale, on a hosted free tier — with a real cardinality caveat that
is the usual way free tiers stop being free.

**Route templates, not URLs.** `/orders/:id` is one series; `/orders/1`,
`/orders/2` … is one series per order. Getting that wrong is not a gradual cost
increase, it is a cliff. It is also the main reason the HTTP metrics are
hand-written at the framework layer rather than derived from paths: the framework
knows the template, the URL does not.

---

## The five-line version

1. **Instrument against OTel, export wherever.** The boundary is the whole point.
2. **No-op when unconfigured.** Local and CI must need nothing.
3. **Assert every alerted metric name exists in code, in CI.** An alert on an
   absent series is permanently, silently green.
4. **Fire every alert once on purpose** before you believe any of them.
5. **Evidence goes in the database; telemetry goes to the sink.** They are
   different jobs and only one of them has to survive a vendor change.

---

## What is not here

- **No repo.** The provisioning files are small and only meaningful against a live
  Grafana instance. The runnable artefact in this portfolio is the
  [infra runbook's compose stack](../cut-04-selfhosted/compose/).
- **No collector.** Host metrics remain unshipped — the honest state of the
  system, and the reason the saturation row above is incomplete.
- **No log aggregation.** Structured logs go to stdout and are read with
  `docker logs`. At one host that is defensible; at three it is not.
