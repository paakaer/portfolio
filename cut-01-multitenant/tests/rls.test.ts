import { afterAll, beforeAll, expect, test } from 'bun:test'
import { db } from '../src/index'
import { env } from '../src/env'
import { createSql, type DriverSql } from '../src/infrastructure/pg'

// The adversarial tenant-isolation suite. This is the gate: it must be green before
// any tenant table is added, and a failure is a release blocker, not a flake.
//
// The argument for RLS over schema-per-tenant rests entirely on this file. You cannot
// write a test proving every code path resets a search_path. You CAN write a test
// proving every tenant-owned table is policied — and fail the build when someone adds
// one that is not. That is the trade being made.
//
// Requires the database up:  bun run db:up

let orgA = ''
let orgB = ''
// A raw app-role connection with NO app.tenant ever set — used to prove fail-closed
// directly rather than inferring it from the policy text.
let rawApp: DriverSql

beforeAll(async () => {
  await db.migrate()
  rawApp = createSql(env.DATABASE_URL, 1)

  // Distinct slugs per run so reruns do not collide on the unique index.
  const tag = Date.now().toString(36)
  const [a] = await db.withPlatform<{ id: string }[]>((uow) =>
    uow.query<{ id: string }>`
      INSERT INTO organization (slug, name, theme) VALUES (${`a-${tag}`}, 'Tenant A', 'warm') RETURNING id`,
  )
  const [b] = await db.withPlatform<{ id: string }[]>((uow) =>
    uow.query<{ id: string }>`
      INSERT INTO organization (slug, name, theme) VALUES (${`b-${tag}`}, 'Tenant B', 'cool') RETURNING id`,
  )
  orgA = a!.id
  orgB = b!.id

  await db.withTenant(orgA, (uow) =>
    uow.query`INSERT INTO settings (tenant_id, key, value) VALUES (${orgA}, 'color', 'red')`,
  )
  await db.withTenant(orgB, (uow) =>
    uow.query`INSERT INTO settings (tenant_id, key, value) VALUES (${orgB}, 'color', 'blue')`,
  )
})

afterAll(async () => {
  if (orgA && orgB) {
    await db.withPlatform((uow) => uow.query`DELETE FROM organization WHERE id = ANY(${[orgA, orgB]})`)
  }
  await rawApp?.end()
  await db.end()
})

test('ids are UUIDv7 (version nibble 7)', () => {
  expect(orgA[14]).toBe('7')
  expect(orgB[14]).toBe('7')
})

test('tenant A sees only its own rows', async () => {
  const rows = await db.withTenant<{ value: string }[]>(orgA, (uow) =>
    uow.query<{ value: string }>`SELECT value FROM settings`,
  )
  expect(rows.map((r) => r.value)).toEqual(['red'])
})

test('tenant B sees only its own rows', async () => {
  const rows = await db.withTenant<{ value: string }[]>(orgB, (uow) =>
    uow.query<{ value: string }>`SELECT value FROM settings`,
  )
  expect(rows.map((r) => r.value)).toEqual(['blue'])
})

test('FAIL-CLOSED: app role with no app.tenant sees ZERO rows', async () => {
  // Asserted against a real connection, not inferred from the policy. The table is
  // populated; an unscoped read must still return nothing.
  const rows = await rawApp`SELECT * FROM settings`
  expect(rows.length).toBe(0)
})

test('cross-tenant WRITE is blocked by WITH CHECK', async () => {
  // Without WITH CHECK this INSERT succeeds and becomes a row A can never read back:
  // silent corruption rather than an error.
  await expect(
    db.withTenant(orgA, (uow) =>
      uow.query`INSERT INTO settings (tenant_id, key, value) VALUES (${orgB}, 'x', 'y')`,
    ),
  ).rejects.toThrow()
})

test('cross-tenant REFERENCE is blocked by the composite foreign key', async () => {
  // The trap this repo exists to document. A foreign key check runs as the referenced
  // table's owner and BYPASSES row security, so a single-column
  // `REFERENCES customer(id)` would let this through: the WITH CHECK passes (A wrote
  // its own tenant_id) and the FK check cannot see the tenant boundary.
  //
  // With FOREIGN KEY (tenant_id, customer_id) the pair (A, B's customer) simply does
  // not exist, so it raises.
  const [bCustomer] = await db.withTenant<{ id: string }[]>(orgB, (uow) =>
    uow.query<{ id: string }>`
      INSERT INTO customer (tenant_id, email, name)
      VALUES (${orgB}, 'someone@example.test', 'B Customer') RETURNING id`,
  )

  await expect(
    db.withTenant(orgA, (uow) =>
      uow.query`
        INSERT INTO note (tenant_id, customer_id, body)
        VALUES (${orgA}, ${bCustomer!.id}, 'pointing at another tenant')`,
    ),
  ).rejects.toThrow()
})

test('ON DELETE SET NULL (customer_id) nulls ONLY the named column', async () => {
  // A bare `ON DELETE SET NULL` nulls every column in the constraint — tenant_id
  // included — which detaches the row from its tenant and, because the isolation
  // policy then matches nothing, makes it invisible to everyone forever.
  const [customer] = await db.withTenant<{ id: string }[]>(orgA, (uow) =>
    uow.query<{ id: string }>`
      INSERT INTO customer (tenant_id, email, name)
      VALUES (${orgA}, 'doomed@example.test', 'A Customer') RETURNING id`,
  )
  const [note] = await db.withTenant<{ id: string }[]>(orgA, (uow) =>
    uow.query<{ id: string }>`
      INSERT INTO note (tenant_id, customer_id, body)
      VALUES (${orgA}, ${customer!.id}, 'survives the delete') RETURNING id`,
  )

  await db.withTenant(orgA, (uow) => uow.query`DELETE FROM customer WHERE id = ${customer!.id}`)

  const rows = await db.withTenant<{ tenant_id: string; customer_id: string | null }[]>(orgA, (uow) =>
    uow.query<{ tenant_id: string; customer_id: string | null }>`
      SELECT tenant_id, customer_id FROM note WHERE id = ${note!.id}`,
  )
  // Still visible to its tenant, still owned by it, no longer pointing anywhere.
  expect(rows.length).toBe(1)
  expect(rows[0]!.tenant_id).toBe(orgA)
  expect(rows[0]!.customer_id).toBeNull()
})

test('registry scope CANNOT read an RLS table (the resolver trap)', async () => {
  // Why Host -> tenant resolution is two steps. Joining organization in registry
  // scope compiles, reads correctly, and silently matches nothing.
  const rows = await db.registry((uow) => uow.query`SELECT id FROM organization`)
  expect(rows.length).toBe(0)
})

test('platform (BYPASSRLS) sees all tenants', async () => {
  const rows = await db.withPlatform<{ value: string }[]>((uow) =>
    uow.query<{ value: string }>`
      SELECT value FROM settings WHERE tenant_id = ANY(${[orgA, orgB]}) ORDER BY value`,
  )
  expect(rows.map((r) => r.value)).toEqual(['blue', 'red'])
})

test('withTenant rejects a malformed tenant id before it reaches set_config', async () => {
  await expect(db.withTenant('not-a-uuid', async () => undefined)).rejects.toThrow()
  // A UUIDv4 is rejected too — ids here are v7 by construction, so a v4 means
  // something upstream is minting them wrongly.
  await expect(db.withTenant('f47ac10b-58cc-4372-a567-0e02b2c3d479', async () => undefined)).rejects.toThrow()
})

test('COVERAGE: every tenant-owned table has RLS enabled, FORCED, and a policy', async () => {
  const rows = await db.withPlatform<
    { table_name: string; rowsecurity: boolean; forced: boolean; policies: string }[]
  >((uow) =>
    uow.query<{ table_name: string; rowsecurity: boolean; forced: boolean; policies: string }>`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rowsecurity,
             c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
        )`,
  )

  // Tables that carry a tenant_id but intentionally have NO RLS, because they are
  // read BEFORE a tenant context exists. Every entry needs a written justification,
  // and adding one is a deliberate security decision that shows up in a diff.
  //
  //   tenant_domains — Host -> tenant routing. Resolution decides WHICH tenant, so it
  //                    cannot be scoped to one. Hosts are public routing information.
  const NON_RLS_TENANT_TABLES = new Set(['tenant_domains'])

  const scoped = rows.filter((t) => !NON_RLS_TENANT_TABLES.has(t.table_name))
  expect(scoped.length).toBeGreaterThan(0)
  for (const t of scoped) {
    expect(t.rowsecurity, `${t.table_name}: RLS enabled`).toBe(true)
    expect(t.forced, `${t.table_name}: RLS FORCED`).toBe(true)
    expect(Number(t.policies), `${t.table_name}: has a policy`).toBeGreaterThan(0)
  }
})

test('COVERAGE: organization is RLS-protected (self-scoped on id, no tenant_id column)', async () => {
  // organization IS the tenant, so it scopes on `id` and has no tenant_id column —
  // which makes it invisible to the coverage query above. Asserted separately: a
  // table your coverage check cannot see is worse than one you forgot.
  const [org] = await db.withPlatform<{ rowsecurity: boolean; forced: boolean; policies: string }[]>((uow) =>
    uow.query<{ rowsecurity: boolean; forced: boolean; policies: string }>`
      SELECT c.relrowsecurity AS rowsecurity,
             c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'organization'`,
  )
  expect(org?.rowsecurity, 'organization: RLS enabled').toBe(true)
  expect(org?.forced, 'organization: RLS FORCED').toBe(true)
  expect(Number(org?.policies), 'organization: has a policy').toBeGreaterThan(0)
})

test('a tenant sees ONLY its own organization row', async () => {
  const rows = await db.withTenant<{ id: string }[]>(orgA, (uow) =>
    uow.query<{ id: string }>`SELECT id FROM organization`,
  )
  expect(rows.map((r) => r.id)).toEqual([orgA])
})
