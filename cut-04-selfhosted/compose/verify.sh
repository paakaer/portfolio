#!/usr/bin/env bash
# Prove the routing model rather than describe it. Exits non-zero on any failure,
# so it works as a smoke test in a pipeline as well as a demo on a call.
set -uo pipefail

BASE="localhost:8088"
fails=0

check() { # check <label> <host> <expected-substring>
  local body
  body=$(curl -s -H "Host: $2" "$BASE" 2>/dev/null)
  if grep -q "$3" <<<"$body"; then
    printf '  \033[32m✓\033[0m %-46s -> %s\n' "$1" "$3"
  else
    printf '  \033[31m✗\033[0m %-46s -> got: %s\n' "$1" "$(tr '\n' ' ' <<<"$body")"
    fails=$((fails + 1))
  fi
}

echo
echo "  ROUTING"
check "bare localhost"                    "localhost"          "web container"
check "trattoria.localhost  (never configured)" "trattoria.localhost" "web container"
check "osteria.localhost    (never configured)" "osteria.localhost"   "web container"
check "any-slug-at-all.localhost"         "any-slug-at-all.localhost" "web container"
check "api.localhost        (priority wins)"    "api.localhost"       "api container"

echo
echo "  CAPS"
for svc in traefik web api; do
  cid=$(docker compose ps -q "$svc" 2>/dev/null)
  if [ -z "$cid" ]; then
    printf '  \033[31m✗\033[0m %-20s not running\n' "$svc"; fails=$((fails + 1)); continue
  fi
  limit=$(docker inspect -f '{{.HostConfig.Memory}}' "$cid")
  if [ "$limit" -gt 0 ] 2>/dev/null; then
    printf '  \033[32m✓\033[0m %-20s capped at %s MiB\n' "$svc" "$((limit / 1024 / 1024))"
  else
    printf '  \033[31m✗\033[0m %-20s UNCAPPED — the kernel picks the victim\n' "$svc"
    fails=$((fails + 1))
  fi
done

echo
echo "  HEALTH"
for svc in traefik web api; do
  cid=$(docker compose ps -q "$svc" 2>/dev/null)
  status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null)
  if [ "$status" = "healthy" ]; then
    printf '  \033[32m✓\033[0m %-20s %s\n' "$svc" "$status"
  else
    printf '  \033[31m✗\033[0m %-20s %s\n' "$svc" "$status"
    fails=$((fails + 1))
  fi
done

echo
if [ "$fails" -eq 0 ]; then
  echo "  all checks passed — 4 hosts, 0 per-host config, 2 containers"
  echo
  exit 0
fi
echo "  $fails failure(s)"
echo
exit 1
