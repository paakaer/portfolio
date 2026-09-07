import { GOVERNED_KEYS, isFeatureKey, type FeatureKey } from './registry'

// Turning a tier's entitlements into a feature seed. PURE — every network read
// happens in the application layer, before the transaction opens.
//
// The mapping from tier to flags does NOT live in this file, and that is the
// design. In the billing processor (Stripe Entitlements, or equivalent) each tier's
// Product carries entitlement features whose `lookup_key` **is** the flag key.
// That identity is what makes "Pro now includes analytics" a dashboard attach with
// no deploy — the code below never learns which tier grants what.

/** One tier's seed: every governed flag, with the value this tier gives it. */
export type TierSeed = Array<[FeatureKey, boolean]>

/**
 * Build the seed for a tier.
 *
 * `governedKeys` — every entitlement feature defined on the billing account.
 * `grantedKeys`  — those attached to THIS tier's product.
 *
 * **Every governed key is emitted, granted ones true and the rest explicitly
 * false.** That explicit `false` is what makes a downgrade actually withdraw a
 * paid feature. Emitting only the granted keys — the obvious implementation —
 * leaves the higher tier's flags switched on for a tenant now paying less, and
 * nothing ever turns them off.
 *
 * A key that is not a real flag is DROPPED rather than trusted, so a typo'd
 * lookup key in someone's billing dashboard cannot write a column that does not
 * exist. The billing dashboard is a place humans type strings; treat its output
 * as input.
 */
export function buildTierSeed(governedKeys: readonly string[], grantedKeys: readonly string[]): TierSeed {
  const granted = new Set(grantedKeys.filter(isFeatureKey))
  const governed = [...new Set(governedKeys.filter(isFeatureKey))].sort()
  return governed.map((key) => [key, granted.has(key)])
}

/**
 * The seed for a tier, using this platform's own governed set as the universe.
 * The convenience form for callers that trust their own registry over the
 * processor's feature list.
 */
export function seedForGrants(grantedKeys: readonly string[]): TierSeed {
  return buildTierSeed(GOVERNED_KEYS, grantedKeys)
}
