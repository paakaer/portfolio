import { afterAll, beforeAll, expect, test } from 'bun:test'
import { db } from '../src/index'
import { FeatureError } from '../src/domain/errors'
import { seedForGrants } from '../src/domain/seed'
import {
  applyTierSeedIn,
  isEnabledIn,
  loadFeatures,
  seedEnablementIn,
  setEnablementGuardedIn,
  setEnablementIn,
} from '../src/application/enablement'
import { applySubscriptionEvent } from '../src/application/subscription-events'
import type { FeatureKey } from '../src/domain/registry'

// Requires the database up:  bun run db:up

let tenantA = ''
let tenantB = ''

// Tiers grant only GOVERNED flags. onlineOrdering is baseline and appears in no
// tier — provisioning sets it, and billing can never touch it.
const TIERS: Record<string, FeatureKey[]> = {
  start: [],
  pro: ['delivery', 'onlinePayments', 'analytics'],
}
const resolveSeed = async (tier: string) => seedForGrants(TIERS[tier] ?? [])

beforeAll(async () => {
  await db.migrate()
  const tag = Date.now().toString(36)
  const rows = await db.withPlatform<{ id: string }[]>((uow) =>
    uow.query<{ id: string }>`
      INSERT INTO organization (slug, name)
      VALUES (${`a-${tag}`}, 'A'), (${`b-${tag}`}, 'B') RETURNING id`,
  )
  tenantA = rows[0]!.id
  tenantB = rows[1]!.id
})

afterAll(async () => {
  if (tenantA) await db.withPlatform((uow) => uow.query`DELETE FROM organization WHERE id = ANY(${[tenantA, tenantB]})`)
  await db.end()
})

const features = (t: string) => db.withTenant(t, (uow) => loadFeatures(uow, t))
const set = (t: string, k: FeatureKey, v: boolean) => db.withTenant(t, (uow) => setEnablementIn(uow, t, k, v))

test('a tenant with no rows has everything off', async () => {
  const f = await features(tenantA)
  expect(Object.values(f).every((v) => v === false)).toBe(true)
})

test('a flip is readable, and scoped to its own tenant', async () => {
  await set(tenantA, 'crossSell', true)
  expect((await features(tenantA)).crossSell).toBe(true)
  expect((await features(tenantB)).crossSell).toBe(false)
})

test('enablement is RLS-isolated — one tenant cannot write another’s flag', async () => {
  await expect(
    db.withTenant(tenantA, (uow) =>
      uow.query`INSERT INTO tenant_features (tenant_id, feature, enabled) VALUES (${tenantB}, 'analytics', true)`,
    ),
  ).rejects.toThrow()
})

test('seed fills only absent flags — a hand-set value survives', async () => {
  await set(tenantA, 'delivery', true) // the operator's decision
  await db.withTenant(tenantA, async (uow) => {
    await seedEnablementIn(uow, tenantA, 'delivery', false) // a tier says otherwise
    await seedEnablementIn(uow, tenantA, 'analytics', true) // never set before
  })
  const f = await features(tenantA)
  expect(f.delivery).toBe(true) // untouched
  expect(f.analytics).toBe(true) // filled
})

test('seed reports whether it actually inserted', async () => {
  const first = await db.withTenant(tenantB, (uow) => seedEnablementIn(uow, tenantB, 'analytics', true))
  const second = await db.withTenant(tenantB, (uow) => seedEnablementIn(uow, tenantB, 'analytics', false))
  expect(first).toBe(true)
  expect(second).toBe(false)
})

test('a deprecated feature refuses a NEW enablement', async () => {
  await expect(set(tenantB, 'legacyBanner', true)).rejects.toThrow(FeatureError)
})

test('...but an EXISTING deprecated enablement keeps working, and can be turned off', async () => {
  // Deprecation stops the bleeding; it does not take a capability away from
  // someone already using it.
  await db.withPlatform((uow) =>
    uow.query`INSERT INTO tenant_features (tenant_id, feature, enabled) VALUES (${tenantB}, 'legacyBanner', true)`,
  )
  expect((await features(tenantB)).legacyBanner).toBe(true)
  await expect(set(tenantB, 'legacyBanner', true)).resolves.toBeUndefined() // idempotent re-set is fine
  await set(tenantB, 'legacyBanner', false)
  expect((await features(tenantB)).legacyBanner).toBe(false)
})

test('a guarded write is refused when its precondition fails, and writes nothing', async () => {
  await expect(
    db.withTenant(tenantB, (uow) => setEnablementGuardedIn(uow, tenantB, 'onlineOrdering', true, async () => false)),
  ).rejects.toThrow(FeatureError)
  expect((await features(tenantB)).onlineOrdering).toBe(false)
})

test('a guarded write proceeds when the precondition holds', async () => {
  await db.withTenant(tenantB, (uow) => setEnablementGuardedIn(uow, tenantB, 'onlineOrdering', true, async () => true))
  expect((await features(tenantB)).onlineOrdering).toBe(true)
})

test('a tier change OVERWRITES governed flags — a downgrade withdraws', async () => {
  await db.withPlatform((uow) => applyTierSeedIn(uow, tenantB, seedForGrants(TIERS.pro!), 'overwrite'))
  expect((await features(tenantB)).delivery).toBe(true)

  await db.withPlatform((uow) => applyTierSeedIn(uow, tenantB, seedForGrants(TIERS.start!), 'overwrite'))
  const f = await features(tenantB)
  expect(f.delivery).toBe(false) // actually withdrawn
  expect(f.onlineOrdering).toBe(true) // baseline — no tier can reach it
})

test('a tier change NEVER touches an ungoverned flag', async () => {
  await set(tenantB, 'crossSell', true)
  await db.withPlatform((uow) => applyTierSeedIn(uow, tenantB, seedForGrants([]), 'overwrite'))
  expect((await features(tenantB)).crossSell).toBe(true)
})

test('THE INVARIANT: renewal, payment failure and cancellation write nothing', async () => {
  // The bug this prevents is an operator's manual flip reverting once a month, on
  // the billing anniversary, for reasons nobody can reproduce.
  await db.withPlatform((uow) => applyTierSeedIn(uow, tenantA, seedForGrants(TIERS.pro!), 'overwrite'))
  await set(tenantA, 'analytics', false) // operator disagrees with their own tier
  const before = await features(tenantA)

  for (const event of [{ kind: 'renewed' }, { kind: 'payment_failed' }, { kind: 'cancelled' }] as const) {
    const outcome = await db.withPlatform((uow) => applySubscriptionEvent(uow, tenantA, event, resolveSeed))
    expect(outcome.wrote, `${event.kind} must not write`).toBe(false)
  }

  expect(await features(tenantA)).toEqual(before)
})

test('a lapsed subscription disables NOTHING — record-only billing', async () => {
  await set(tenantA, 'onlineOrdering', true) // as provisioning would
  await db.withPlatform((uow) => applySubscriptionEvent(uow, tenantA, { kind: 'payment_failed' }, resolveSeed))
  await db.withPlatform((uow) => applySubscriptionEvent(uow, tenantA, { kind: 'cancelled' }, resolveSeed))
  // The restaurant that forgot to update its card is still trading.
  expect((await features(tenantA)).onlineOrdering).toBe(true)
})

test('a first subscription fills without trampling', async () => {
  const outcome = await db.withPlatform((uow) =>
    applySubscriptionEvent(uow, tenantA, { kind: 'first_subscription', tier: 'pro' }, resolveSeed),
  )
  expect(outcome.wrote).toBe(true)
  // analytics was hand-set false above; fill mode must leave it alone.
  expect((await features(tenantA)).analytics).toBe(false)
})

test('an unknown row is ignored, not fatal', async () => {
  // Removing a flag from the code must not break every tenant still carrying its row.
  await db.withPlatform((uow) =>
    uow.query`INSERT INTO tenant_features (tenant_id, feature, enabled) VALUES (${tenantB}, 'retiredFlag', true)`,
  )
  const f = await features(tenantB)
  expect(f).not.toHaveProperty('retiredFlag')
  expect(Object.keys(f).length).toBeGreaterThan(0)
})

test('isEnabledIn reads uncached inside the caller transaction', async () => {
  await db.withTenant(tenantB, async (uow) => {
    await setEnablementIn(uow, tenantB, 'weeklyReport', true)
    // Same transaction, so it must see its own uncommitted write.
    expect(await isEnabledIn(uow, tenantB, 'weeklyReport')).toBe(true)
  })
})

test('the backfill fills existing tenants, and re-running never re-disables one', () => {
  // Migration 0004's semantics, which are easy to get subtly wrong in both
  // directions.
  //
  // NOTE WHAT THIS TEST CANNOT ASSERT: that the backfill covered these tenants.
  // It ran before they existed. A backfill covers the tenants alive AT MIGRATION
  // TIME and nobody else — new tenants get their rows at provisioning. Needing
  // BOTH paths is the actual lesson, and forgetting either one leaves a
  // population of tenants with no row and therefore no decision.
  return db.withPlatform(async (uow) => {
    const [fresh] = await uow.query<{ id: string }>`
      INSERT INTO organization (slug, name) VALUES (${`bf-${Date.now().toString(36)}`}, 'Backfill') RETURNING id`
    const id = fresh!.id
    try {
      const before = await uow.query`
        SELECT 1 FROM tenant_features WHERE tenant_id = ${id} AND feature = 'weeklyReport'`
      expect(before.length, 'a tenant created after the backfill has no row').toBe(0)

      const backfill = () => uow.query`
        INSERT INTO tenant_features (tenant_id, feature, enabled)
        SELECT id, 'weeklyReport', false FROM organization WHERE id = ${id}
        ON CONFLICT (tenant_id, feature) DO NOTHING`

      await backfill()
      const [row] = await uow.query<{ enabled: boolean }>`
        SELECT enabled FROM tenant_features WHERE tenant_id = ${id} AND feature = 'weeklyReport'`
      expect(row?.enabled, 'backfilled off — nobody is silently opted in').toBe(false)

      // The operator turns it on, then the migration is re-run (a redeploy, a
      // fresh environment, a replayed migration). ON CONFLICT DO NOTHING is what
      // stops that from re-disabling them.
      await uow.query`
        UPDATE tenant_features SET enabled = true WHERE tenant_id = ${id} AND feature = 'weeklyReport'`
      await backfill()
      const [after] = await uow.query<{ enabled: boolean }>`
        SELECT enabled FROM tenant_features WHERE tenant_id = ${id} AND feature = 'weeklyReport'`
      expect(after?.enabled, 're-running the backfill must not re-disable').toBe(true)
    } finally {
      await uow.query`DELETE FROM organization WHERE id = ${id}`
    }
  })
})
