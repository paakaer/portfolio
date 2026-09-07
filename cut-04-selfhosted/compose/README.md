# Runnable routing model

A reduction of the production setup in the parent runbook, small enough to read in
one sitting and real enough to break.

```bash
docker compose up -d --wait
./verify.sh
docker compose down -v
```

Traefik on `localhost:8088`, dashboard on `localhost:8089`.

## What it demonstrates

- **Wildcard host routing.** `trattoria.localhost`, `osteria.localhost` and
  `any-slug-at-all.localhost` all reach the `web` container. None of them is named
  anywhere in this repo. That is the property that makes tenant onboarding a database
  row instead of a config change.
- **Priority disambiguation.** `api.localhost` matches the wildcard too, and reaches
  the `api` container only because of an explicit `priority=100`.
- **Memory caps on every service**, for the reason in `../FAILURES.md` #1.
- **Healthchecks that can actually fail.**

## Break it on purpose

```bash
sed -i '' '/routers.api.priority=100/d' docker-compose.yml
docker compose up -d --force-recreate --wait
curl -H 'Host: api.localhost' localhost:8088     # -> web container. 200. Wrong app.
git checkout docker-compose.yml
```

Traefik's default tie-break is rule *length*, and the wildcard rule is longer than
the exact one — so the catch-all wins. RE2 has no negative lookahead, so the regex
cannot exclude `api`. Priority is the only lever. `../FAILURES.md` #8.

## Two things this file gets right that are easy to get wrong

**`$$host` in the config content.** Compose interpolates `configs.content` before the
container sees it, so a bare `$host` is consumed and nginx receives an empty string.
This file shipped with that bug until `verify.sh` printed a blank Host line.
`../FAILURES.md` #5.

**Traefik pinned to v3.6.** v3.5's Docker provider cannot negotiate with newer Docker
daemons: discovery gets `400 Bad Request`, it finds zero containers, and every route
404s without logging anything that looks like an error. `../FAILURES.md` #4.

## What it is not

No TLS (that needs real DNS), no database, no control plane. Those are in the runbook
because they cannot be usefully faked locally. This proves the routing model, which
is the part people get wrong.
