# Self-hosted multi-tenant runbook

**Coolify + Hetzner + Traefik.** How to run a multi-tenant SaaS — web, API,
Postgres, background worker, wildcard subdomains and per-customer custom domains —
on one VPS, with automatic TLS and push-to-deploy.

Extracted from a production deployment serving real businesses on their own domains.

This is a runbook, not an argument. Three companion documents carry the parts a
runbook cannot:

| | |
|---|---|
| **[`FAILURES.md`](FAILURES.md)** | Eight production failure modes, seven of them silent. **Read this one first.** |
| **[`COSTS.md`](COSTS.md)** | The cost model, including the line most comparisons omit |
| **[`compose/`](compose/)** | A runnable reduction of the routing model — `docker compose up`, then `./verify.sh` |

---

## What you get

- One VPS, one control plane, no per-service SaaS bills
- `<anything>.example.com` routes to the app with **no per-tenant configuration**
- A customer's own domain attaches with **one command**, live, no redeploy
- Automatic TLS for both, from Let's Encrypt
- Push to a branch → image built → deployed

## What you do not get

Say this out loud before anyone commits:

- **One host is one failure domain.** No multi-AZ, no automatic failover.
- **No preview deployments per pull request.** This is what teams miss most.
- **Backups are yours.** Snapshots are not backups until you have restored one.
- **You are the on-call.** See `FAILURES.md` for what that means in practice.

---

## 1. The host

One ARM64 VPS, 4 vCPU / 8 GB. ARM is roughly a third cheaper for the same
performance here and every image in this stack builds multi-arch — but **your CI must
build for `linux/arm64`.** A stack that runs locally on an ARM laptop and is built
`amd64` in CI will fail to start on the host with an exec-format error that reads
like a corrupt image.

```yaml
# CI build step
platforms: linux/arm64
```

**There is no swap.** Decide this deliberately. Swap on a VPS trades an OOM kill for
unbounded latency, which for a web app is usually worse — but with no swap you have
no cushion at all, and memory caps stop being optional. See `FAILURES.md` #1.

### Memory budget

Every service capped, summing to well under the total:

| Service | Cap | Steady state |
|---|---|---|
| Postgres | 2 GB | — |
| Web (SSR) | 1.5 GB | ~360 MiB |
| API | 1 GB | ~163 MiB |
| Worker (headless browser) | 1 GB | — |
| **Total capped** | **5.5 GB** | of 8 GB |

The remaining ~2.5 GB is for the host, Docker, Traefik and the control plane. The
headroom is the point: two services spiking at once must still not reach the kernel's
global OOM killer.

Caps are **backstops, not tuning knobs**. Set each at roughly 4–6× measured steady
state. If a service genuinely uses its cap, find out why rather than raising it
quietly. Raise a cap only when legitimate load is being killed — `docker inspect`
shows `OOMKilled: true` and exit code 137.

---

## 2. DNS

Cloudflare, **DNS-only — grey cloud, not proxied.** Proxying breaks the ACME HTTP-01
challenge and terminates TLS somewhere you did not configure.

```
*.example.com   A   <VPS_IP>    DNS only
example.com     A   <marketing or app IP>
```

The wildcard is what makes tenant onboarding zero-touch. The apex stays wherever your
marketing site lives; the routing rules below match subdomains only, so the apex is
never stolen.

---

## 3. Routing

Two mechanisms, and they are not interchangeable. Getting this split right is most of
the work.

| | Wildcard subdomains | Customer custom domains |
|---|---|---|
| Host | `<slug>.example.com` | `theircompany.com` |
| Routing | One `HostRegexp` router | One generated file per domain |
| TLS challenge | **DNS-01** (required) | **HTTP-01** |
| Adding one | Nothing — DNS wildcard covers it | One CLI command, live |
| Provider API token | Required | Not required |

### 3a. Wildcard subdomains

**Wildcard TLS requires DNS-01.** Let's Encrypt will not issue `*.example.com` from
an HTTP-01 challenge — only a DNS challenge can validate a wildcard. That means the
proxy needs a DNS-provider API token, scoped as tightly as your provider allows
(`Zone:DNS:Edit` + `Zone:Zone:Read`, single zone).

**Put the token on the proxy, never on the app containers.**

```yaml
certificatesResolvers:
  cloudflare:
    acme:
      email: ops@example.com
      storage: /traefik/acme-cloudflare.json
      dnsChallenge:
        provider: cloudflare
```

One cert covers every subdomain — no per-host issuance latency when a tenant is
created.

Then one router catches them all:

```yaml
- "traefik.http.routers.web.rule=Host(`example.com`) || HostRegexp(`^[a-z0-9-]+\\.example\\.com$`)"
```

**Anchor the regex.** An unanchored host pattern in a multi-tenant proxy matches more
than you intend.

**Give every specific host an explicit priority.** Traefik's default tie-break is
rule *length*, and a wildcard rule is longer than an exact one — so the catch-all
wins by default and silently serves your API from the storefront. RE2 has no negative
lookahead, so you cannot exclude hosts in the regex. Priority is the only lever:

```yaml
- traefik.http.routers.api.priority=100
```

This is reproducible in `compose/` — delete the line, recreate, watch
`api.localhost` return the wrong application with a 200. `FAILURES.md` #8.

### 3b. Custom domains

Customer domains cannot be wildcarded — each is a separate certificate. Use Traefik's
**file provider**: drop a per-domain YAML file into a watched directory and Traefik
picks it up **live**, with no redeploy and no proxy restart.

Bind-mount the proxy's dynamic directory into whichever service generates the files:

```yaml
volumes:
  - /data/coolify/proxy/dynamic:/traefik-dynamic
```

| Setting | Value | Note |
|---|---|---|
| `TRAEFIK_DYNAMIC_DIR` | `/traefik-dynamic` | Empty ⇒ feature off, routing stays manual |
| `TRAEFIK_CERT_RESOLVER` | `letsencrypt` | **Verify against your proxy's static config** |
| `TRAEFIK_WEB_TARGET` | `http://web-<id>:3000` | How the proxy reaches the app container |
| `INGRESS_IP` | `<VPS_IP>` | Enables a DNS preflight warning |

`TRAEFIK_WEB_TARGET` is the one value that depends on your live install and the first
thing to check when a route 404s. Find it with
`docker ps --format '{{.Names}}' | grep '^web-'`, and confirm the container is on the
proxy's network.

Per domain: the customer points an `A` record at your IP, you run one command, and
you verify after ~30s for the HTTP-01 cert.

```bash
curl -I https://theircompany.com     # 200, valid cert
```

**Why the file provider rather than the control plane's own domain field:** the
control plane's compose-domains API silently fails to persist domains
(coollabsio/coolify#4326). The file provider is a directory Traefik watches; it either
has your file or it does not.

---

## 4. The control plane

Coolify, self-hosted on the same box. Deploy model is **registry push + webhook** —
CI builds and pushes an image, then calls a deploy hook. **No SSH from CI**, which
means no deploy key to leak.

### Six things that will cost you an afternoon

1. **A service named `postgres` collides with the control plane's own database.**
   Every container joins a shared overlay network that already carries one. Docker
   DNS round-robins; you intermittently migrate the wrong server. Name services
   uniquely *per environment* — `db-prod`, `db-staging`. `FAILURES.md` #2.
2. **`${VAR}` is not interpolated inside compose `labels:`.** Inline literals there.
3. **`$` inside `configs.content` *is* interpolated — escape it as `$$`.** The two
   preceding rules point in opposite directions in the same file. `FAILURES.md` #5.
4. **Shared variables are not auto-injected.** Every key must still be listed in the
   service; the value is the reference.
5. **Framework-public variables (`NEXT_PUBLIC_*`) are build-time.** Setting them in
   the environment UI does nothing. They are build args. `FAILURES.md` #7.
6. **Bind-mounting a nonexistent host file creates a *directory*.** Create the file
   first, or pass the secret as an environment variable and avoid mounts entirely.

### Image tags and rollback

Services track a moving tag (`:prod`). Promotion is a **server-side retag** of an
already-validated image — no rebuild, so what you tested is bit-for-bit what ships.

Keep the immutable `:<sha>` tags. Rollback is setting `IMAGE_TAG=<sha>` and
redeploying.

> **Two traps.** A moving tag can be restarted without re-pulling — verify by
> container digest, not by the tag name. And if your rollback target's images were
> never tagged, "roll back" means "rebuild", which is not a rollback. Retag by digest
> as part of promotion, and remember to do it for *every* service, including the
> worker.

---

## 5. Postgres

Same host, local volume. Not a managed service — see `COSTS.md` for when that is the
wrong call.

**Postgres 18 moved the data directory.** Mount the volume at `/var/lib/postgresql`,
**not** `/var/lib/postgresql/data`. Mounting the old path makes the container exit 1
on first boot with a wall of text about `pg_ctlcluster`. Copying a pre-18 compose
file is how everyone meets this.

```yaml
volumes:
  - pgdata:/var/lib/postgresql
```

**Cap it last and highest.** Capping the *other* services is what makes the database
cap safe — with everything else confined to its own cgroup, a leak upstream can no
longer make the kernel choose Postgres as its global victim.

**Assert the database identity before running any DDL.** Whatever the connection
string says, only the far end can tell you where you landed:

```ts
const [row] = await sql`SELECT current_database()`
if (row?.current_database !== expected) throw new Error('DB identity mismatch')
```

**Backups.** Snapshot the volume on a schedule, and **rehearse a restore into a
scratch environment on a calendar reminder.** An untested backup is a belief, not a
backup. This is the single most common gap in self-hosted setups and the one that
converts a bad afternoon into a company-ending one.

---

## 6. The worker

Scheduled jobs run in **their own container**, on their own image, with their own
memory cap. A headless-browser render that OOMs must not be able to take the API down
with it — and without a cap that claim is simply false, because an unbounded worker
walks the whole host into the kernel's OOM killer.

**Give it a healthcheck that reads a heartbeat the job runner refreshes**, not one
that checks the process exists. `restart: unless-stopped` plus no healthcheck means a
container that crash-loops forever looks identical to a working one in `docker ps`.
Ours did, for a day. `FAILURES.md` #3.

**And know what the healthcheck does not do:** Docker will mark the container
`unhealthy` and take no action. It does not restart on health. Alerting on unhealthy
is the other half, and it is not free.

---

## 7. Verify a deploy

Never trust "deploy succeeded". Check the four things that can each be independently
wrong:

```bash
# 1. Which image is actually running — digest, not tag
docker inspect --format '{{index .RepoDigests 0}}' <container>

# 2. What the app thinks it is
curl -s https://api.example.com/version

# 3. Routing, per host class
curl -sI https://tenant-a.example.com     # wildcard
curl -sI https://theircompany.com          # custom domain, valid cert
curl -sI https://api.example.com           # priority router, NOT the storefront

# 4. Health of every service, including the ones with no port
docker compose ps
```

Target containers **by name**, not by tag: a moving tag can point at an image the
running container never pulled.

Expose a `/version` endpoint that reports the build SHA **and the process start
time**. Without a start time you cannot distinguish "deployed and healthy" from
"deployed and silently restarting every 90 seconds", and outage forensics without it
is guesswork.

---

## 8. Try the routing model

The interesting half of this runbook is runnable:

```bash
cd compose
docker compose up -d --wait
./verify.sh
```

```
ROUTING
  ✓ bare localhost                                 -> web container
  ✓ trattoria.localhost  (never configured)        -> web container
  ✓ osteria.localhost    (never configured)        -> web container
  ✓ any-slug-at-all.localhost                      -> web container
  ✓ api.localhost        (priority wins)           -> api container

CAPS
  ✓ traefik              capped at 256 MiB
  ✓ web                  capped at 512 MiB
  ✓ api                  capped at 256 MiB

HEALTH
  ✓ traefik              healthy
  ✓ web                  healthy
  ✓ api                  healthy

all checks passed — 4 hosts, 0 per-host config, 2 containers
```

Four hosts reach two containers with zero per-host configuration. Three of those
hosts were never named anywhere — that is the property that makes tenant onboarding a
database row.

Then break it on purpose: delete the `priority=100` line, recreate, and watch
`api.localhost` get answered by the storefront with a 200.

`verify.sh` exits non-zero on any failure, so it works as a post-deploy smoke test as
well as a demo.

---

## Licence

MIT.
