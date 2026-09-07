// demo:up — provision two invented tenants against ONE database and ONE schema.
//
// The whole point: this file creates no infrastructure. No schema, no container, no
// deploy. A tenant is a row, its address is a row, and its brand is a column.
// Onboarding the third brand is the same three INSERTs.

import { db } from '../index'
import { BRANDS } from '../demo/brands'

await db.migrate()

for (const brand of BRANDS) {
  // Platform scope: creating a tenant is the one thing that cannot be done from
  // inside a tenant scope, because the tenant does not exist yet.
  const [org] = await db.withPlatform<{ id: string }[]>((uow) =>
    uow.query<{ id: string }>`
      INSERT INTO organization (slug, name, theme) VALUES (${brand.slug}, ${brand.name}, ${brand.theme})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, theme = EXCLUDED.theme
      RETURNING id`,
  )
  const tenantId = org!.id

  await db.withPlatform((uow) =>
    uow.query`
      INSERT INTO tenant_domains (host, tenant_id, kind) VALUES (${brand.host}, ${tenantId}, 'subdomain')
      ON CONFLICT (host) DO UPDATE SET tenant_id = EXCLUDED.tenant_id`,
  )

  // Everything from here is tenant-scoped. Note there is no `WHERE tenant_id = ...`
  // on the reads — RLS is applying it, which is exactly the property being sold.
  await db.withTenant(tenantId, async (uow) => {
    await uow.query`
      INSERT INTO settings (tenant_id, key, value) VALUES (${tenantId}, 'tagline', ${brand.tagline})
      ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`
    for (const item of brand.menu) {
      await uow.query`
        INSERT INTO settings (tenant_id, key, value)
        VALUES (${tenantId}, ${`menu:${item.name}`}, ${item.price})
        ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`
    }
    await uow.query`
      INSERT INTO customer (tenant_id, email, name)
      VALUES (${tenantId}, ${`regular@${brand.slug}.test`}, 'Cliente Abituale')
      ON CONFLICT (tenant_id, email) DO NOTHING`
  })

  console.log(`  ✓ ${brand.name.padEnd(16)} ${brand.host.padEnd(18)} theme=${brand.theme}  ${tenantId}`)
}

console.log('\ntwo brands, one container, one schema, one connection pool.')
console.log('next:  bun run demo:serve   then  bun run demo:probe')
await db.end()
