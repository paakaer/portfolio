# Failure modes

Seven ways this stack broke in production, what each looked like from the outside,
and what actually caused it. These are the parts you cannot get from documentation,
because none of them are documented anywhere — each one cost between an hour and a
day to find.

Ordered by how expensive they were.

---

## 1. The kernel picked the wrong victim

**Symptom.** Every storefront timed out for about five minutes. Not a 502 — a
*timeout*. The process was alive the whole time.

**Cause.** The web container leaked to 4.83 GiB of anonymous RSS on an 8 GB host
with **zero swap**. It never crashed on its own; it stalled in an allocation spiral,
still accepting connections and never answering them. Eventually the kernel's global
OOM killer fired: `global_oom, task=bun`.

**The part that matters.** The kill was the *recovery*, not the outage. The outage
was the five minutes before it, while the process was alive and useless. And the
kernel chooses its victim by `oom_score` across the whole host — it could just as
easily have picked the database, turning one restarting web container into a
Postgres kill under active writes.

**Fix.** Cap every service, not just the leaky one:

```yaml
db-prod:  { mem_limit: 2g }
web:      { mem_limit: 1.5g }
backend:  { mem_limit: 1g }
worker:   { mem_limit: 1g }
```

5.5 GB of 8, leaving ~2.5 GB for the host, Docker, Traefik and the control plane.
The sum is deliberately well under the total so that a simultaneous spike in two
services still cannot reach the global killer.

**Capping the other services is what makes the database cap safe.** A cap is not a
tuning knob — it moves the kill from the kernel, which picks arbitrarily, into the
cgroup of the thing that actually leaked, where the blast radius is one restart.

**Follow-up.** The app also grades its own memory against the same ceiling and warns
at 50% and 80%, so a slow leak shows up in logs with hours of headroom instead of
arriving as a kernel line you find the next morning. That ceiling is passed as an
env var, which means it is the same fact written in two places — keep them adjacent
in the compose file, or you will raise the cap and leave the warning firing at a
number the container is no longer killed at.

---

## 2. A service named `postgres` resolved to somebody else's database

**Symptom.** `28P01 password authentication failed` from the migration runner, at
boot, *intermittently*. Logins and config "worked sometimes". Nothing in the
connection string was wrong.

**Cause.** The control plane puts every container on a shared overlay network, and
that network already carries the control plane's own database. A compose service
literally named `postgres` therefore resolves **ambiguously** — Docker DNS
round-robins between your Postgres and theirs. Roughly half of connection attempts
landed on a server that had never heard of your roles.

**Fix, in two parts.**

1. Name the service uniquely, and name it **per environment** — `db-prod`,
   `db-staging`. A shared `db` only moves the collision, since staging and prod are
   on that network too.
2. Make the application refuse to run against the wrong server:

```ts
const [row] = await sql`SELECT current_database()`
if (row?.current_database !== expectedDatabase) throw new Error(...)
```

Assert it **before any DDL runs**. Whatever the URL says, only the far end can tell
you where you actually landed. This turns an intermittent, half-the-time,
looks-like-a-password-problem failure into a loud crash at boot.

---

## 3. A dying container looked exactly like a working one

**Symptom.** None. That is the finding. The scheduled-jobs container crash-looped
for a day and nothing anywhere said so.

**Cause.** `restart: unless-stopped` plus no healthcheck. Docker faithfully restarts
a container that dies on boot, forever, and `docker ps` shows it as up — because it
is, for the second and a half before it dies again. Nothing in the control plane UI
distinguishes this from healthy.

The jobs that silently did not run: the weekly report, the metrics ingest, and — the
one with a security edge — the sweep that revokes unclaimed third-party OAuth
consent. Abandoned authorisations accumulated at the provider with nothing on our
side clearing them.

**Fix.** A healthcheck that reads a **heartbeat the process refreshes only once its
job runner is actually up**, not one that checks the process exists. Define it in the
image rather than the compose file so it cannot drift between environments.

**Still missing, and worth saying out loud:** Docker will now mark the container
`unhealthy` — and *do nothing about it*. It does not restart on health by default.
Alerting on unhealthy is the other half, and a runbook that claims this is solved by
the healthcheck alone is lying to you.

---

## 4. The proxy discovered no containers and every route 404'd

**Symptom.** Traefik up, containers up, labels correct, every request 404.

**Cause.** Traefik v3.5's Docker provider cannot negotiate with newer Docker daemons
(Docker Desktop ≥ 4.78, API 1.54) and gets `400 Bad Request` on discovery. It finds
zero containers and therefore routes nothing. It does not consider this an error
worth shouting about.

**Fix.** Traefik **v3.6+**. Pin it. This is a version-skew failure between two things
you did not change on the same day, which is the hardest kind to attribute.

---

## 5. Compose ate the variables meant for the shell

**Symptom.** The database role bootstrap ran with empty passwords, or failed
outright.

**Cause.** An init script embedded in a compose `configs:` block goes through
Compose's own variable interpolation first. `$POSTGRES_PASSWORD` is consumed by
Compose — which does not have it — and the shell inside the container receives
nothing.

**Fix.** Escape with `$$` so the real variable survives to runtime:

```bash
psql --username "$$POSTGRES_USER" --dbname "$$POSTGRES_DB"
```

**Related, opposite direction.** The control plane does **not** interpolate `${VAR}`
inside compose `labels:`. A label written as
`traefik.http.routers.x.rule=Host(\`${DOMAIN}\`)` is passed through literally and
matches a host called `${DOMAIN}`. Inline the literal value in labels; use a single
`$`, and do not assume interpolation works uniformly across the file.

---

## 6. A missing file became a directory

**Symptom.** A credential loader failed with *"is a directory"*.

**Cause.** Bind-mounting a host path that does not exist. Docker does not error — it
**creates a directory** at that path and mounts it. Your application then opens a
directory where it expected a JSON key.

**Fix.** Create the file on the host first, with the right mode, before the first
deploy. Better: prefer passing the secret as an environment variable so no file,
path, or mount is involved at all.

**Why this one is worse than it looks.** In our case the credential loader fell
through to a *fallback provider* when it could not authenticate. So the failure did
not surface as an error — it surfaced as plausible-looking output from the wrong
service. A fallback chain converts a configuration error into a correctness bug.

---

## 7. Build-time variables that looked like runtime ones

**Symptom.** Setting a variable in the control plane's environment UI changed
nothing. Redeploying changed nothing.

**Cause.** Framework-public variables (the `NEXT_PUBLIC_*` family and equivalents)
are **inlined into the JavaScript bundle at build time**. They must be build
arguments in the image build. Setting them as runtime environment is a no-op, and
the UI gives you no hint of the difference — both kinds appear in the same list.

**Fix.** Pass them as Docker build args in CI. Accept the consequence: changing one
requires a rebuild, not a redeploy.

**Corollary worth designing around.** Anything that differs between test and live —
a publishable API key, for instance — should be served to the browser by a runtime
endpoint rather than baked in, or you freeze the test/live distinction into the image
and cannot fix it without a rebuild.

---

## 8. The wildcard router quietly ate the API

**Symptom.** Requests to `api.example.com` are answered by the storefront. Correct
HTTP status, wrong application. No error anywhere.

**Cause.** In a wildcard multi-tenant setup two routers match the same host: the
specific `Host(\`api.example.com\`)` and the catch-all
`HostRegexp(\`^[a-z0-9-]+\\.example\\.com$\`)`. Traefik breaks the tie by **rule
length**, and the wildcard rule is the longer string — so **the catch-all wins by
default.**

You cannot fix this in the regex. Traefik v3 uses Go's RE2, which has no negative
lookahead, so the wildcard cannot exclude `api`.

**Fix.** State the priority explicitly on the specific router:

```yaml
- traefik.http.routers.api.priority=100
```

**Reproduced in this repo.** Delete that one line from `compose/docker-compose.yml`,
recreate, and `curl -H 'Host: api.localhost' localhost:8088` returns
`web container`. Put it back and it returns `api container`.

**Why it is worse in a multi-tenant system.** The catch-all exists precisely so that
a new tenant needs no routing change. That is the feature. It also means every
special-case host you add later — an API, a status page, a webhook receiver — is one
forgotten priority away from being served by the tenant app, and the failure is a
200, not a 404.

---

## The pattern

Seven of these eight are **silent**. Not one announced itself as an error at the layer
that caused it:

| # | Presented as | Actually |
|---|---|---|
| 1 | Slow site | Kernel choosing a victim |
| 2 | Wrong password | DNS round-robin |
| 3 | Nothing at all | A crash loop |
| 4 | 404 | Version skew |
| 5 | Empty password | Interpolation layering |
| 6 | Wrong output | A missing file |
| 7 | Nothing at all | Build vs runtime |
| 8 | The wrong app, with a 200 | Default tie-break by rule length |

That is the actual cost of self-hosting, and it is not the hourly rate of the box. It
is that your platform no longer tells you which layer broke. The runbook is what you
build to buy that back — and it is why the honest recommendation in `COSTS.md` is
that this saves money only if someone is going to own it.
