import { expect, test } from 'bun:test'
import { buildTierSeed, seedForGrants } from '../src/domain/seed'
import { GOVERNED_KEYS } from '../src/domain/registry'

test('a seed emits EVERY governed key, not just the granted ones', () => {
  // The whole reason a downgrade works. Emitting only the granted keys — the
  // obvious implementation — leaves the higher tier's flags switched on for a
  // tenant now paying less, and nothing ever turns them off.
  const seed = buildTierSeed(['onlineOrdering', 'delivery', 'analytics'], ['onlineOrdering'])
  expect(seed).toEqual([
    ['analytics', false],
    ['delivery', false],
    ['onlineOrdering', true],
  ])
})

test('an ungranted governed key is explicitly false, never absent', () => {
  const seed = buildTierSeed(['delivery'], [])
  expect(seed).toEqual([['delivery', false]])
})

test('a key the registry does not know is dropped, not trusted', () => {
  // Lookup keys are typed by humans into a billing dashboard. Treat that as input.
  const seed = buildTierSeed(['onlineOrdering', 'typoedKey', ''], ['onlineOrdering', 'typoedKey'])
  expect(seed).toEqual([['onlineOrdering', true]])
})

test('a granted key that is not governed cannot sneak in', () => {
  // crossSell belongs to the operator. A billing dashboard granting it must not
  // give billing write access to it.
  const seed = buildTierSeed(['onlineOrdering'], ['onlineOrdering', 'crossSell'])
  expect(seed.map(([k]) => k)).toEqual(['onlineOrdering'])
})

test('duplicate governed keys collapse', () => {
  expect(buildTierSeed(['delivery', 'delivery'], ['delivery'])).toEqual([['delivery', true]])
})

test('seedForGrants uses our own governed set as the universe', () => {
  const seed = seedForGrants(['delivery'])
  expect(seed.map(([k]) => k)).toEqual([...GOVERNED_KEYS])
  expect(seed.find(([k]) => k === 'delivery')?.[1]).toBe(true)
  expect(seed.find(([k]) => k === 'analytics')?.[1]).toBe(false)
})

test('a tier granting a BASELINE flag cannot write it', () => {
  // onlineOrdering is ungoverned on purpose, so no tier — and therefore no
  // downgrade — can take a restaurant's storefront offline. A billing dashboard
  // that lists it as an entitlement is simply ignored.
  const seed = seedForGrants(['onlineOrdering', 'delivery'])
  expect(seed.map(([k]) => k)).not.toContain('onlineOrdering')
  expect(seed.find(([k]) => k === 'delivery')?.[1]).toBe(true)
})

test('an empty tier withdraws everything governed', () => {
  const seed = seedForGrants([])
  expect(seed.every(([, on]) => on === false)).toBe(true)
  expect(seed).toHaveLength(GOVERNED_KEYS.length)
})
