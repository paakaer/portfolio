import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FEATURES, FEATURE_KEYS, GOVERNED_KEYS, allOff } from '../src/domain/registry'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// THE GATE. A flag that nothing reads is not a feature — it is a switch wired to
// no lamp, and it will be flipped by an operator who then reports that the
// product is broken.
//
// We shipped two of these. Both were live, flippable, visible in the admin panel,
// and read by absolutely nothing for months. Nobody noticed, because a flag that
// does nothing looks exactly like a flag that works and is currently off.
//
// This test is the mechanical cure: every registered flag must name a file that
// exists and mentions the key.

test('every feature names a read site that exists and reads it', () => {
  for (const feature of FEATURES) {
    const path = join(ROOT, feature.readSite)
    expect(existsSync(path), `${feature.key}: readSite ${feature.readSite} does not exist`).toBe(true)

    const source = readFileSync(path, 'utf8')
    expect(source.includes(feature.key), `${feature.key}: ${feature.readSite} never mentions it`).toBe(true)
  }
})

test('read sites only reference keys the registry declares', () => {
  // The other direction: a read site consuming `features.somethingElse` means the
  // registry and the code have drifted, and the loader will hand back undefined —
  // which is falsy, so the capability silently disappears rather than erroring.
  const known = new Set<string>(FEATURE_KEYS)
  const sites = [...new Set(FEATURES.map((f) => f.readSite))]

  for (const site of sites) {
    const source = readFileSync(join(ROOT, site), 'utf8')
    for (const match of source.matchAll(/features\.([a-zA-Z][a-zA-Z0-9]*)/g)) {
      const key = match[1]!
      expect(known.has(key), `${site}: reads features.${key}, which the registry does not declare`).toBe(true)
    }
  }
})

test('governed is a small subset — the blast radius of a billing event', () => {
  // Not a style rule. Every governed key is a flag a subscription webhook may
  // rewrite without a human, so this set IS the blast radius of the billing
  // integration. If it ever becomes "most flags", billing has quietly taken over
  // the product.
  expect(GOVERNED_KEYS.length).toBeLessThan(FEATURE_KEYS.length / 2)
})

test('keys are unique', () => {
  expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length)
})

test('allOff covers every key and is entirely false', () => {
  const off = allOff()
  expect(Object.keys(off).sort()).toEqual([...FEATURE_KEYS].sort())
  expect(Object.values(off).every((v) => v === false)).toBe(true)
})
