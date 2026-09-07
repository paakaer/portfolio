// demo:review — the human half.
//
//   bun run demo:review          show the queue and try to publish (it refuses)
//   bun run demo:review --fix    apply a human's decisions, then publish
//
// The two runs are the whole argument: the gate is not advisory.

import { blockingItems, canPublish, patchItem, removeItem, resolveItem, type Draft } from '../domain/review'
import { renderDraft } from './format'
import { loadDraft, saveDraft } from './store'

const RED = '\x1b[31m'
const GRN = '\x1b[32m'
const DIM = '\x1b[2m'
const OFF = '\x1b[0m'

const fix = process.argv.includes('--fix')
let draft: Draft

try {
  draft = await loadDraft('trattoria')
} catch {
  console.error('\n  no draft found — run `bun run demo:ingest` first\n')
  process.exit(1)
}

if (!fix) {
  console.log(renderDraft(draft))
  const check = canPublish(draft)
  console.log(`  ${RED}PUBLISH REFUSED${OFF} — ${check.reason}`)
  for (const item of check.blocked) {
    console.log(`    ${DIM}·${OFF} ${item.dish.name}  ${DIM}${item.flags.filter((f) => f.blocking).map((f) => f.code).join(', ')}${OFF}`)
  }
  console.log(`\n  a human decides each one. then:  bun run demo:review --fix\n`)
  process.exit(0)
}

// ── The human's decisions ───────────────────────────────────────────────────
// Hard-coded here so the demo is reproducible. In the product these arrive from
// the admin UI as the operator works the queue: correct, confirm, or delete.
// Note that all three verbs are needed — a queue that only lets you approve is a
// rubber stamp, and a reviewer who cannot disagree stops reading.

console.log(`\n  ${DIM}applying the operator's decisions…${OFF}\n`)

const decisions: Array<{ match: string; why: string; apply: (d: Draft, i: number) => Draft }> = [
  {
    match: 'Grigliata mista di carne',
    why: 'priced on the day — the operator types today\'s price',
    apply: (d, i) => patchItem(d, i, { priceCents: 2200 }),
  },
  {
    match: 'Porchetta di Ariccia',
    why: '"al kg" was missed — it IS sold by weight, so this is a 10x overcharge',
    apply: (d, i) => patchItem(d, i, { pricePerKg: true }),
  },
]

for (const decision of decisions) {
  const index = draft.items.findIndex((it) => it.dish.name === decision.match)
  if (index === -1) continue
  draft = decision.apply(draft, index)
  console.log(`  ${GRN}fixed${OFF}     ${decision.match.padEnd(26)} ${DIM}${decision.why}${OFF}`)
}

// The duplicate: one printed line read twice. Delete the second copy — and note
// that this single delete clears the flag on the FIRST copy too, because the
// flags are relational.
const names = draft.items.map((it) => it.dish.name)
const dupName = names.find((n, i) => names.indexOf(n) !== i)
if (dupName) {
  draft = removeItem(draft, names.lastIndexOf(dupName))
  console.log(`  ${GRN}deleted${OFF}   ${dupName.padEnd(26)} ${DIM}2nd copy — one line was read twice${OFF}`)
}

// Anything still blocking is confirmed as correct-as-printed by the human.
for (const item of blockingItems(draft)) {
  const index = draft.items.indexOf(item)
  draft = resolveItem(draft, index)
  console.log(`  ${GRN}confirmed${OFF} ${item.dish.name}  ${DIM}correct as printed${OFF}`)
}

console.log(renderDraft(draft))

const check = canPublish(draft)
if (!check.ok) {
  console.log(`  ${RED}PUBLISH REFUSED${OFF} — ${check.reason}\n`)
  process.exit(1)
}

draft = { ...draft, publishedAt: new Date().toISOString() }
await saveDraft(draft)
console.log(`  ${GRN}PUBLISHED${OFF} ${draft.items.length} dishes — every one seen by a human\n`)
