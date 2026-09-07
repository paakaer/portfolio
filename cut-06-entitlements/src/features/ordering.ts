import type { Features } from '../domain/registry'

// A read site. Nothing clever here — the point of this file is that it EXISTS.
//
// tests/registry.test.ts asserts every registered flag names a file that exists
// and mentions the key. A flag whose read site is missing fails the build, which
// is the mechanical form of "a flag with no consumer is a lie".

export type OrderType = 'pickup' | 'delivery'

export function availableOrderTypes(features: Features): OrderType[] {
  if (!features.onlineOrdering) return []
  const types: OrderType[] = []
  if (features.pickup) types.push('pickup')
  if (features.delivery) types.push('delivery')
  return types
}

export function showsCrossSell(features: Features): boolean {
  return features.onlineOrdering && features.crossSell
}

export function showsLegacyBanner(features: Features): boolean {
  return features.legacyBanner
}
