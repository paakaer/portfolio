// demo:probe — attack the boundary and report what happened.
//
// A README that claims isolation is a claim. This attempts four cross-tenant
// operations against the running demo data and prints the outcome of each, so you can
// watch the boundary hold instead of taking its word for it.

import { db } from '../index'
import { env } from '../env'
import { createSql } from '../infrastructure/pg'
import { BRANDS } from '../demo/brands'

const [bella, nova] = BRANDS
const slugs = [bella!.slug, nova!.slug]

const orgs = await db.withPlatform<{ id: string; slug: string }[]>((uow) =>
  uow.query<{ id: string; slug: string }>`
    SELECT id, slug FROM organization WHERE slug = ANY(${slugs}) ORDER BY slug`,
)
if (orgs.length !== 2) {
  console.error('demo tenants not found — run `bun run demo:up` first.')
  process.exit(1)
}
const A = orgs.find((o) => o.slug === bella!.slug)!
const B = orgs.find((o) => o.slug === nova!.slug)!

let failures = 0
const pass = (label: string, detail: string) => console.log(`  ✓ BLOCKED  ${label}\n             ${detail}`)
const fail = (label: string, detail: string) => {
  failures++
  console.log(`  ✗ LEAKED   ${label}\n             ${detail}`)
}

console.log(`\n  A = ${A.slug}  ${A.id}`)
console.log(`  B = ${B.slug}  ${B.id}\n`)

// 1. Read across the boundary. No WHERE clause — if RLS were off this returns both.
{
  const rows = await db.withTenant<{ value: string }[]>(A.id, (uow) =>
    uow.query<{ value: string }>`SELECT value FROM settings WHERE key = 'tagline'`,
  )
  const leaked = rows.some((r) => r.value === nova!.tagline)
  if (rows.length === 1 && !leaked) {
    pass('cross-tenant READ', `A ran an unfiltered SELECT and got ${rows.length} row: its own`)
  } else {
    fail('cross-tenant READ', `A saw ${rows.length} rows`)
  }
}

// 2. Write a row stamped for the other tenant. WITH CHECK must reject it.
try {
  await db.withTenant(A.id, (uow) =>
    uow.query`INSERT INTO settings (tenant_id, key, value) VALUES (${B.id}, 'stolen', 'x')`,
  )
  fail('cross-tenant WRITE', 'A inserted a row owned by B')
} catch (err) {
  pass('cross-tenant WRITE', `WITH CHECK rejected it — ${(err as Error).constructor.name}`)
}

// 3. Reference the other tenant's customer. The composite FK must reject it.
{
  const [bCustomer] = await db.withTenant<{ id: string }[]>(B.id, (uow) =>
    uow.query<{ id: string }>`SELECT id FROM customer LIMIT 1`,
  )
  try {
    await db.withTenant(A.id, (uow) =>
      uow.query`INSERT INTO note (tenant_id, customer_id, body) VALUES (${A.id}, ${bCustomer!.id}, 'x')`,
    )
    fail('cross-tenant REFERENCE', "A's row now points at B's customer")
  } catch (err) {
    pass('cross-tenant REFERENCE', `composite FK rejected it — ${(err as Error).constructor.name}`)
  }
}

// 4. The unscoped connection. A forgotten scope must yield nothing, not everything.
{
  const raw = createSql(env.DATABASE_URL, 1)
  const rows = await raw`SELECT * FROM settings`
  await raw.end()
  if (rows.length === 0) {
    pass('UNSCOPED read', 'app role with no app.tenant saw 0 rows (fail-closed)')
  } else {
    fail('UNSCOPED read', `saw ${rows.length} rows across all tenants`)
  }
}

console.log(
  failures === 0
    ? '\n  4/4 blocked. The boundary is in the database, not in the application.\n'
    : `\n  ${failures} LEAK(S). Do not ship this.\n`,
)
await db.end()
process.exit(failures === 0 ? 0 : 1)
