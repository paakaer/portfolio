import { expect, test } from 'bun:test'
import { buildDraft, canPublish, flagsFor, patchItem, removeItem, resolveItem } from '../src/domain/review'
import type { ExtractedDish, ExtractedMenu } from '../src/domain/types'

const dish = (over: Partial<ExtractedDish> = {}): ExtractedDish => ({
  name: 'Tagliatelle',
  priceCents: 1100,
  pricePerKg: false,
  section: 'Primi',
  ingredients: [],
  description: null,
  ...over,
})

const menu = (dishes: ExtractedDish[]): ExtractedMenu => ({ sections: ['Primi'], dishes })
const draftOf = (dishes: ExtractedDish[]) => buildDraft(menu(dishes), { id: 't', provider: 'fixture', escalations: [] })

test('a clean dish carries no flags', () => {
  expect(flagsFor(dish(), [dish()])).toEqual([])
})

test('a missing price blocks', () => {
  const flags = flagsFor(dish({ priceCents: null }), [])
  expect(flags.map((f) => f.code)).toContain('MISSING_PRICE')
  expect(flags.every((f) => f.blocking)).toBe(true)
})

test('an implausible price blocks — the decimal-comma misread', () => {
  // "11,00" read as 1100 EUROS instead of 1100 cents. Structurally valid,
  // completely wrong, and invisible without a plausibility window.
  const flags = flagsFor(dish({ priceCents: 110_000 }), [])
  expect(flags.map((f) => f.code)).toContain('SUSPICIOUS_PRICE')
})

test('a by-weight section with a per-portion price blocks (a 10x overcharge)', () => {
  const d = dish({ name: 'Porchetta', section: 'Gastronomia', priceCents: 1890, pricePerKg: false })
  expect(flagsFor(d, [d]).map((f) => f.code)).toContain('PER_KG_AMBIGUOUS')
})

test('a duplicate name blocks both copies', () => {
  const a = dish()
  const b = dish()
  expect(flagsFor(a, [a, b]).map((f) => f.code)).toContain('DUPLICATE_NAME')
})

test('a missing section is advisory, not blocking', () => {
  const flags = flagsFor(dish({ section: null }), [dish({ section: null })])
  const noSection = flags.find((f) => f.code === 'NO_SECTION')
  expect(noSection?.blocking).toBe(false)
})

test('publish is REFUSED while anything blocking is unresolved', () => {
  const draft = draftOf([dish({ priceCents: null })])
  const check = canPublish(draft)
  expect(check.ok).toBe(false)
  expect(check.blocked).toHaveLength(1)
})

test('publish is allowed once a human has corrected the item', () => {
  const draft = patchItem(draftOf([dish({ priceCents: null })]), 0, { priceCents: 2200 })
  expect(canPublish(draft).ok).toBe(true)
})

test('a human can also confirm an item as correct-as-printed', () => {
  // The flag stands; the human overrode it. That is a decision, and it is
  // recorded as one rather than silently clearing the flag.
  const draft = resolveItem(draftOf([dish({ priceCents: null })]), 0)
  expect(canPublish(draft).ok).toBe(true)
  expect(draft.items[0]!.flags.map((f) => f.code)).toContain('MISSING_PRICE')
})

test('deleting one copy of a duplicate clears the flag on the OTHER copy', () => {
  // Flags are relational, so a fix in one row can resolve a different row. Only
  // re-flagging the edited item would leave a phantom block that no edit clears.
  let draft = draftOf([dish(), dish()])
  expect(canPublish(draft).ok).toBe(false)
  draft = removeItem(draft, 1)
  expect(draft.items).toHaveLength(1)
  expect(draft.items[0]!.flags).toEqual([])
  expect(canPublish(draft).ok).toBe(true)
})

test('renaming one duplicate also clears the other', () => {
  let draft = draftOf([dish(), dish()])
  draft = patchItem(draft, 1, { name: 'Tagliatelle al ragù bianco' })
  expect(canPublish(draft).ok).toBe(true)
})

test('an empty draft cannot be published', () => {
  expect(canPublish(draftOf([])).ok).toBe(false)
})

test('there is no force flag — a published draft cannot be republished', () => {
  const draft = { ...draftOf([dish()]), publishedAt: new Date().toISOString() }
  expect(canPublish(draft).ok).toBe(false)
})
