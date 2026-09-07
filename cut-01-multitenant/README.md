# condominio

**Shared-schema multi-tenancy for Postgres, done fail-closed.**

A *condominio* is one building: shared foundations, shared plumbing, one set of
pipes — and apartments that cannot see into each other. That is the architecture.
One database, one schema, one connection pool, and a row-level security boundary
that returns **zero rows** when it is unsure rather than all of them.

Extracted from a production multi-tenant SaaS that serves real businesses on their
own domains. MIT. No dependencies beyond `postgres` and Postgres 18.

```ts
await db.withTenant(tenantId, (uow) =>
  uow.query`SELECT * FROM settings`)      // RLS-scoped. Cannot see another tenant.

await db.withPlatform((uow) => …)         // BYPASSRLS. Platform admin only.
```

---

## Why this repo exists

There are three ways to isolate tenants in Postgres, every blog post lists the same
three, and almost none of them are written by someone who has run more than one.

I ran **schema-per-tenant in production**, hit its ceiling, and migrated the live
tenants onto **RLS**. This is the decision written from the other side of that
migration, with the trade-offs that actually showed up rather than the ones you can
predict from a table.

---

## The decision

| | Database-per-tenant | Schema-per-tenant | **Shared schema + RLS** |
|---|---|---|---|
| Isolation | Physical | Namespace | Policy (logical) |
| Blast radius of a bug | One tenant | One tenant | **All tenants** |
| Migration cost | N deploys | N applications | **1 application** |
| Connections | Pool per tenant | Pool per tenant, or `search_path` juggling on a shared pool | **One pool, fixed** |
| Cross-tenant query | Impossible without ETL | Painful (`UNION` over schemas) | Trivial (one privileged role) |
| Per-tenant restore | Easy | Moderate | Hard — needs row-level tooling |
| Cost per tenant | High | Low | **Near zero** |
| Onboarding a tenant | Provision infra | `CREATE SCHEMA` + migrate | **Insert a row** |

### Why not database-per-tenant

It is the correct answer if your tenants are enterprises with contractual data
residency, or if a single tenant's load can hurt the others. It is the wrong answer
at small-business price points: you pay per-tenant infrastructure cost against
per-tenant revenue that does not cover it, and every schema change becomes a fleet
operation with partial-failure states.

### Why not schema-per-tenant (what actually went wrong)

Schema-per-tenant looks like a free lunch. It is not, and the bill arrives in two
places that are hard to see in advance.

**1. Migration fan-out is superlinear in pain, not in count.**

The current system has **152 migrations, written over roughly twelve weeks** —
`0001` on 2026-06-11 through `0152`. With three tenants, schema-per-tenant means
**456 migration applications** instead of 152. The count is not the problem; the
*state space* is. Every application can fail independently, so at any moment your
tenants can be on different schema versions, and your application code must
tolerate every combination. You end up writing migrations defensively — `IF NOT
EXISTS` everywhere, no destructive changes, no rename that a half-migrated tenant
would notice — which means your schema slowly stops being able to change shape at
all.

The failure mode nobody warns you about is not a migration that errors. It is a
migration that succeeds for tenant A, fails for tenant B, and leaves you deciding
at 2am whether to roll forward or back a system where those two words no longer
have a single meaning.

**2. Connection pooling stops working.**

A pool is a set of *interchangeable* connections. The moment a connection carries
tenant state — a `search_path`, a schema binding — it is no longer interchangeable,
and you have one of two bad options:

- **A pool per tenant.** Connection count now scales with tenant count. Postgres
  has a hard ceiling and each backend costs real memory. This is the option that
  quietly caps your business at a tenant count you did not choose.
- **One pool, set `search_path` per checkout.** Now correctness depends on every
  single code path resetting that state on release. One missed reset — one early
  `return`, one thrown exception on the wrong line — and a connection carrying
  tenant A's `search_path` is handed to a request for tenant B. This is a
  cross-tenant data leak that no test will find, because it only appears under
  concurrency, under load, in production.

RLS has the same shape of risk and solves it properly. See *transaction-local
scope* below.

### Why RLS won

Because the isolation guarantee moves from **discipline** to **the database**, and
because it can be **tested exhaustively in CI**. You cannot write a test that proves
every code path resets `search_path`. You *can* write a test that proves every
tenant-owned table has row security enabled, forced, and policied — and fail the
build when someone adds a table that does not.

That test is the whole argument. It is in `tests/rls.test.ts` and it is the first
thing you should read.

**The honest cost:** RLS trades physical isolation for a policy boundary. A bug in
that boundary is a cross-tenant leak affecting *everyone*, not one tenant. You are
buying operational simplicity with a concentrated risk, and the only responsible way
to hold that trade is to make the boundary mechanically verified rather than
reviewed. If you are not willing to run the coverage test in CI and treat a failure
as a release blocker, use schema-per-tenant instead — the discipline burden is lower
there because the failure is louder.

---

## How it works

### One door

Nothing outside the module imports the driver, the pools, or the provider. There is
one file you import from, and four ways to reach the database:

```ts
db.withTenant(id, fn)   // app role + tenant scope. RLS applies. The default.
db.registry(fn)         // app role, NO scope. Non-RLS routing tables only.
db.withPlatform(fn)     // BYPASSRLS role. Cross-tenant admin work only.
db.migrate()            // owner role. Applies pending SQL migrations.
```

Three Postgres roles, deliberately:

- **`condo_app`** — non-owner, cannot bypass RLS. The application's default. It is
  important that this role does not own the tables: **a table owner bypasses row
  security by default.**
- **`condo_platform`** — `BYPASSRLS`. Reachable only through `withPlatform`. If this
  role appears in your request path, you have a bug.
- **`condo_owner`** — superuser, migrations only. Never used at runtime.

### Transaction-local scope (the part that matters)

```ts
await sql.begin(async (tx) => {
  await tx`SELECT set_config('app.tenant', ${tenantId}, true)`
  //                                                    ^^^^ transaction-local
  return fn(unitOfWorkFor(tx))
})
```

The third argument to `set_config` is `is_local`. It scopes the setting to the
**transaction**, so it is reset automatically on commit *or* rollback — including
the rollback you did not write, from the exception you did not anticipate.

This is what makes a shared pool safe. There is no release path to forget, because
the reset is Postgres's job, not yours. It is the direct answer to the
`search_path`-leak problem above, and it is the single most important line in this
repo.

### Fail-closed policies

```sql
CREATE POLICY settings_isolation ON settings
  USING      (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);
```

Two details carry the whole guarantee:

- **`nullif(…, '')`** — an unset or empty GUC becomes `NULL`, and `tenant_id = NULL`
  matches **no rows**. The naive version without `nullif` can throw, or worse, be
  written in a way that matches everything. Unset context must mean *zero rows*,
  never *all rows*.
- **`WITH CHECK`** — `USING` filters reads. `WITH CHECK` blocks writes. Without it a
  tenant can `INSERT` a row stamped with someone else's `tenant_id`; they will not
  be able to read it back, which makes it a silent corruption rather than an error.
- **`current_setting('app.tenant', true)`** — the `true` is `missing_ok`. Without it
  an unset GUC raises instead of returning null, and your fail-closed policy becomes
  a fail-loud one in paths where that is not what you want.

---

## Three traps

These are the ones that cost real time. The first two are the reason this repo
exists as documentation rather than just code.

### 1. `ENABLE` is not enough — you need `FORCE`

```sql
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings FORCE  ROW LEVEL SECURITY;
```

`ENABLE` applies row security to everyone **except the table's owner**. If your
application connects as the owner — which it will, if you did the obvious thing and
used one role for everything — then RLS is on, your policies are correct, your tests
pass, and the boundary does nothing at all.

Two independent defences: a non-owner app role, *and* `FORCE`. Use both.

### 2. Foreign key checks bypass row security

This one is genuinely obscure and it is the most dangerous thing in this document.

**A foreign key constraint is checked as the referenced table's owner, and that
check bypasses RLS.** So this innocuous column:

```sql
customer_id uuid REFERENCES customer(id)      -- WRONG in a shared-schema system
```

…lets tenant A create a row pointing at **tenant B's customer**. Walk it through:
the `WITH CHECK` policy passes, because A wrote its own `tenant_id` on its own row.
The FK check passes, because it cannot see the tenant boundary. Reads still look
safe — RLS hides the far side, so nobody notices. But the row *is* cross-tenant, and
it is now load-bearing: `ON DELETE CASCADE` reaches across it, and any legitimately
unscoped path (a platform admin query, a cross-tenant report, a background worker)
dereferences it and returns tenant B's data inside tenant A's result.

The fix is structural rather than disciplinary — make it impossible to express:

```sql
CONSTRAINT foo_customer_fk
  FOREIGN KEY (tenant_id, customer_id)
  REFERENCES customer (tenant_id, id) ON DELETE CASCADE
```

This requires `UNIQUE (tenant_id, id)` on the **referenced** table. Add that index
to every tenant table on day one, before anything references it — retrofitting it
across an existing schema is the expensive version of this lesson.

**Watch the `ON DELETE SET NULL` variant too.** A bare `SET NULL` on a composite FK
nulls *every* column in the constraint, including `tenant_id` — which detaches the
row from its tenant entirely and, because the isolation policy now matches nothing,
makes it invisible to everyone forever. Name the column explicitly:
`ON DELETE SET NULL (customer_id)`.

### 3. Some tables genuinely cannot be tenant-scoped

Host → tenant routing is read **before** a tenant context exists — resolving *which*
tenant is the whole point, so it cannot be scoped to one. Same for a signed OAuth
state you must verify at a callback, before any tenant identity can be trusted.

These tables carry a `tenant_id` but have no RLS, on purpose. That is fine, and it is
also exactly how a real leak gets introduced by someone in a hurry. So the exception
list is **explicit, in code, with a written justification per entry**, and the
coverage test reads that list. Adding a name to it is a deliberate security decision
that shows up in a diff and gets reviewed as one.

### 4. Fail-closed will present as "routing is broken"

The obvious Host → tenant resolver is one query joining the routing table to the
tenant table. It compiles, it reads correctly, and it **always returns null** — the
join has to run without a tenant scope (establishing which tenant is the whole
point), the tenant table is RLS-protected, and an unscoped read of an RLS table
yields zero rows. The join silently matches nothing.

That is fail-closed working exactly as designed, and it is the first thing everyone
hits. It presents as "tenant resolution is broken", not as a permissions error,
because **zero rows is not an error**. Resolution is therefore two steps: read the
non-RLS routing table to learn *which* tenant, then open a tenant scope and load the
tenant's own row through RLS — which has the pleasant side effect of making step 2
double-check step 1.

Budget for this class of bug generally. The cost of fail-closed is paid in confusing
empty results rather than in breaches, which is the right trade, but it is not a
free one.

---

## The coverage test

The gate. It queries the catalogue for every table carrying a tenant key, subtracts
the documented exception set, and asserts row security is enabled, forced, and
policied on each one. Add a tenant table without a policy and CI fails.

It also covers the cases a naive version misses:

- **Fail-closed proof.** A raw app-role connection with **no** `app.tenant` set reads
  a populated table and must get **zero rows**. This is asserted directly rather than
  inferred from the policy text.
- **Cross-tenant write.** Tenant A inserting a row stamped for tenant B must throw.
- **The tenant registry itself.** The `organization` table *is* the tenant, so it
  scopes on `id` and has no `tenant_id` column — which means the coverage query
  cannot see it. It is asserted separately. A table that is invisible to your
  coverage check is worse than one you forgot.
- **Malformed tenant ids** are rejected before they reach `set_config`.

```
✓ ids are UUIDv7 (version nibble 7)
✓ tenant A sees only its own rows
✓ tenant B sees only its own rows
✓ FAIL-CLOSED: app role with no app.tenant sees ZERO rows
✓ cross-tenant WRITE is blocked by WITH CHECK
✓ cross-tenant REFERENCE is blocked by the composite foreign key
✓ ON DELETE SET NULL (customer_id) nulls ONLY the named column
✓ registry scope CANNOT read an RLS table (the resolver trap)
✓ platform (BYPASSRLS) sees all tenants
✓ withTenant rejects a malformed tenant id before it reaches set_config
✓ COVERAGE: every tenant-owned table has RLS enabled, FORCED, and a policy
✓ COVERAGE: organization is RLS-protected (self-scoped on id, no tenant_id column)
✓ a tenant sees ONLY its own organization row

13 pass, 0 fail
```

### Proving the test can fail

A green test that cannot go red is decoration. Three mutations, each applied to the
running database with the suite re-run against it:

| Mutation | Result |
|---|---|
| `ALTER TABLE settings DISABLE ROW LEVEL SECURITY` | **6 of 13 fail** |
| `ALTER TABLE settings NO FORCE ROW LEVEL SECURITY` | **1 of 13 fails** — the coverage test, alone |
| Composite FK swapped for `REFERENCES customer(id)` | **1 of 13 fails** — the cross-tenant reference test |

The middle row is the one worth sitting with. Dropping `FORCE` changes **no
observable behaviour** — every behavioural test still passes, the application works
correctly, and nothing in a code review looks wrong — because the app role is not
the table owner, so the second line of defence going missing is invisible from the
outside. Only the structural check catches it.

That is the argument for asserting against `pg_class` rather than only asserting on
behaviour. Behavioural tests verify the boundary you are currently standing behind.
The coverage test verifies the boundary you will be standing behind after someone
changes the connection string in eight months.

The third row is the composite FK trap, reproduced: with the naive single-column
constraint, tenant A **successfully** writes a row pointing at tenant B's customer.
No error, no warning.

---

## Migrations

Hand-written SQL, `NNNN_name.sql`, applied in filename order, each in its own
transaction, recorded in a `migrations` table. No ORM and no migration tool — not
out of purism, but because **RLS policies are DDL you must be able to read in a
review.** A generated migration you skim is a boundary you did not check.

One guard worth stealing regardless of your stack: the runner asserts
`current_database()` matches what you expected **before** running any DDL.

That check exists because of a real incident. On a shared container network, a
compose service named `postgres` collided with the platform's own database of the
same name; Docker DNS round-robined between them, and migrations intermittently
applied to the wrong server. The connection string was correct the entire time.
**Whatever the URL says, only the far end can tell you where you actually landed.**

### Adding a tenant table

Copy the template migration verbatim, then change the name and columns:

1. `tenant_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE`
2. `ENABLE` **and** `FORCE ROW LEVEL SECURITY`
3. The fail-closed isolation policy, with `USING` **and** `WITH CHECK`
4. `UNIQUE (tenant_id, id)` if anything will ever reference this table
5. Composite FKs for every reference *out* to another tenant table

Then run the coverage test. Steps 1–3 are enforced by it; steps 4–5 are not, which
is why they are written down here.

### Connections

The pool is fixed and does not grow with tenants:

| Pool | Size | Role |
|---|---|---|
| App | 10 | `condo_app` — every tenant request |
| Platform | 2 | `condo_platform` — admin only |
| Listen | 1 | dedicated `LISTEN` connection, kept off the query pools |

Thirteen connections, whether you have three tenants or three thousand. Under
schema-per-tenant this table has a tenant-count variable in it, and that variable is
the reason people migrate.

The `LISTEN` connection is separate on purpose: a long-lived subscription parked on
a pooled connection starves the pool it is borrowing from.

---

## Running it

```bash
bun install
bun run db:up          # Postgres 18 on :5544
bun run db:migrate     # apply migrations as the owner role
bun test               # the RLS suite
```

Requires Postgres 18 for native `uuidv7()`. IDs are UUIDv7 throughout —
time-ordered, so index locality is preserved without a separate sort key, and a
UUIDv4 handed in as a tenant id is rejected as malformed rather than silently
accepted.

> **Postgres 18 moved the data directory.** The image now stores data in a
> major-version-specific subdirectory, so the volume mounts at
> `/var/lib/postgresql` — **not** `/var/lib/postgresql/data`, as it did through 17.
> Copying a pre-18 compose file gets you an immediate `exit 1` and a wall of text
> about `pg_ctlcluster`. The compose file here has it right, with a note.

### The white-label demo

```bash
bun run demo:up        # provision two invented tenants
bun run demo:serve     # one process, both brands
```

```
✓ Trattoria Bella  bella.localhost    theme=warm  01a07651-255e-785c-bb90-a6685a729077
✓ Osteria Nova     nova.localhost     theme=cool  01a07651-256f-74a9-9706-1fea9c7a4817
```

| Brand | Host | Theme | Palette |
|---|---|---|---|
| Trattoria Bella | `bella.localhost:4400` | `warm` | sand / terracotta |
| Osteria Nova | `nova.localhost:4400` | `cool` | slate / teal |

Or without touching DNS:

```bash
curl -H 'Host: bella.localhost' localhost:4400
curl -H 'Host: nova.localhost'  localhost:4400
curl -H 'Host: evil.localhost'  localhost:4400   # 404 — never a default tenant
```

Two brands, two palettes, two menus, two subdomains — **one process, one schema,
one connection pool.** Read `src/demo/server.ts` looking for a branch on which
tenant it is: there is exactly one, and it is a colour lookup. Onboarding the third
brand is three INSERTs, not a deploy.

The 404 matters as much as the two brands do. An unknown Host is an error, never
"the first tenant" or "the default tenant" — a routing fallback in a multi-tenant
system is how one customer's data gets served under another customer's brand.

### Attacking it

The demo also ships a probe, because a README that claims isolation is only a claim:

```bash
bun run demo:probe
```

```
✓ BLOCKED  cross-tenant READ
           A ran an unfiltered SELECT and got 1 row: its own
✓ BLOCKED  cross-tenant WRITE
           WITH CHECK rejected it — IntegrityError
✓ BLOCKED  cross-tenant REFERENCE
           composite FK rejected it — IntegrityError
✓ BLOCKED  UNSCOPED read
           app role with no app.tenant saw 0 rows (fail-closed)

4/4 blocked. The boundary is in the database, not in the application.
```

It exits non-zero if any of the four gets through, so it works as a smoke test in a
pipeline as well as a demo on a call.

---

## What this repo is not

- **Not benchmarked.** The claims here are structural — connection counts, migration
  counts, failure modes. There are no latency numbers because I did not run a fair
  comparison, and quoting unfair ones would undercut the parts that are true.
- **Not a framework.** It is roughly 500 lines that you are meant to read, understand,
  and copy — not depend on.
- **Not the right answer for enterprise tenants.** Contractual data residency,
  per-tenant restore SLAs, or a single tenant large enough to affect the others all
  point back at database-per-tenant. This architecture is for many small tenants at
  low revenue per tenant, which is where it is unbeatable.
- **Not a substitute for the coverage test.** If you take the code and leave the test,
  you have taken the risk and left the mitigation.

## Licence

MIT.
