// demo — the seven moments that define this system, in order.
//
// Read the OUTPUT, not this file. The point is which events change something and
// which do not.

import { db } from '../index'
import { loadFeatures, setEnablementIn } from '../application/enablement'
import { applySubscriptionEvent, type SubscriptionEvent } from '../application/subscription-events'
import { seedForGrants } from '../domain/seed'
import { FEATURE_KEYS, GOVERNED_KEYS, featureDefinition, type FeatureKey, type Features } from '../domain/registry'

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', B = '\x1b[1m', Y = '\x1b[33m', O = '\x1b[0m'

// What each tier grants. In production this lives in the billing processor as
// entitlement features whose lookup_key IS the flag key — changing it is a
// dashboard attach, not a deploy. Inlined here so the demo needs no account.
const TIERS: Record<string, FeatureKey[]> = {
  start: [],
  pro: ['delivery', 'onlinePayments', 'analytics'],
}
const resolveSeed = async (tier: string) => seedForGrants(TIERS[tier] ?? [])

await db.migrate()

const tag = Date.now().toString(36)
const [org] = await db.withPlatform<{ id: string }[]>((uow) =>
  uow.query<{ id: string }>`
    INSERT INTO organization (slug, name) VALUES (${`demo-${tag}`}, 'Trattoria Demo') RETURNING id`,
)
const tenantId = org!.id

function render(features: Features, previous?: Features): string {
  return FEATURE_KEYS.map((k) => {
    const on = features[k]
    const changed = previous !== undefined && previous[k] !== on
    const def = featureDefinition(k)
    const mark = on ? `${G}on ${O}` : `${D}off${O}`
    const gov = def.governed ? `${D}governed${O}` : `${Y}operator${O}`
    const delta = changed ? `${B}  ← changed${O}` : ''
    return `      ${mark}  ${k.padEnd(16)} ${gov}${delta}`
  }).join('\n')
}

let previous: Features | undefined
async function show(title: string, note?: string) {
  const features = await db.withTenant(tenantId, (uow) => loadFeatures(uow, tenantId))
  console.log(`\n  ${B}${title}${O}`)
  if (note) console.log(`  ${D}${note}${O}`)
  console.log(render(features, previous))
  previous = features
}

async function event(e: SubscriptionEvent, title: string) {
  const outcome = await db.withPlatform((uow) => applySubscriptionEvent(uow, tenantId, e, resolveSeed))
  const badge = outcome.wrote ? `${G}WROTE${O}` : `${D}no-op${O}`
  await show(`${title}   ${badge}`, outcome.why)
}

console.log(`\n  tenant ${tenantId}`)
console.log(`  ${D}governed by billing: ${GOVERNED_KEYS.join(', ')}${O}`)
console.log(`  ${D}everything else belongs to the operator, permanently${O}`)

// 1 — a brand-new tenant. No rows at all.
await show('1. created', 'no rows yet — absent means off, so nothing is live')

// 1b — provisioning turns on the baseline. NOT a tier, and no tier can undo it.
await db.withTenant(tenantId, async (uow) => {
  await setEnablementIn(uow, tenantId, 'onlineOrdering', true)
  await setEnablementIn(uow, tenantId, 'pickup', true)
})
await show('1b. provisioned', 'baseline set by provisioning — ungoverned, so billing can never reach it')

// 2 — first subscription. Fill mode.
await event({ kind: 'first_subscription', tier: 'start' }, '2. subscribes to Start')

// 3 — the operator makes two decisions of their own.
await db.withTenant(tenantId, async (uow) => {
  await setEnablementIn(uow, tenantId, 'crossSell', true) // ungoverned
  await setEnablementIn(uow, tenantId, 'delivery', true) // governed — Start does NOT grant this
})
await show(
  '3. operator flips two switches by hand',
  'crossSell (theirs alone) and delivery (a governed flag Start does not grant)',
)

// 4 — THE POINT. Three events that must change nothing.
await event({ kind: 'renewed' }, '4a. monthly renewal')
await event({ kind: 'payment_failed' }, '4b. card declined')
await event({ kind: 'renewed' }, '4c. webhook redelivered')

// 5 — a real upgrade.
await event({ kind: 'tier_changed', from: 'start', to: 'pro' }, '5. upgrades to Pro')

// 6 — a real downgrade. Paid features are actually withdrawn.
await event({ kind: 'tier_changed', from: 'pro', to: 'start' }, '6. downgrades to Start')

// 7 — cancellation. Record-only.
await event({ kind: 'cancelled' }, '7. cancels')

const final = await db.withTenant(tenantId, (uow) => loadFeatures(uow, tenantId))
console.log(`\n  ${B}what survived${O}`)
console.log(`    ${final.crossSell ? G + '✓' + O : R + '✗' + O} crossSell      the operator's own choice, untouched by all of it`)
console.log(`    ${final.delivery ? R + '✗ still on' + O : G + '✓ withdrawn' + O}  delivery       governed — the downgrade took it back`)
console.log(`    ${final.onlineOrdering ? G + '✓' + O : R + '✗' + O} onlineOrdering  still trading after a failed payment and a cancellation`)
console.log()

await db.withPlatform((uow) => uow.query`DELETE FROM organization WHERE id = ${tenantId}`)
await db.end()
