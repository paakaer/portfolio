// THE REGISTRY — the single declaration of every capability the platform can gate.
//
// A flag is not a boolean. It is four facts, and separating them is the whole
// design:
//
//   key        what the runtime reads
//   maturity   how finished it is         — GLOBAL, ADVISORY, never a gate
//   governed   whether a billing tier may write it
//   readSite   the file that actually consumes it
//
// `readSite` is not documentation. There is a test that asserts the file exists
// and mentions the key, so a flag cannot be added without the code that reads it.
// See tests/registry.test.ts and the README section "A flag with no consumer is
// a lie".

/**
 * How finished a capability is. GLOBAL — one value for the whole platform, not
 * per tenant.
 *
 * ADVISORY ONLY. Maturity never appears in the runtime resolution. It drives what
 * the admin UI *warns* about when a human flips a switch:
 *
 *   alpha       "this may break your storefront"
 *   beta        "this works, expect rough edges"
 *   mature      no warning; eligible for bulk enable and on-by-default
 *   deprecated  blocks NEW enablements, warns on existing ones, disables nothing
 *
 * The temptation is to fold maturity into the gate — "alpha features are off
 * unless…". Don't. A tenant deliberately running an alpha feature in production
 * (which is how you get real feedback) would be switched off by a maturity edit
 * made by someone who has never heard of them.
 */
export type Maturity = 'alpha' | 'beta' | 'mature' | 'deprecated'

export interface FeatureDefinition {
  /** The runtime key. Stable forever — renaming one is a migration, not an edit. */
  readonly key: string
  readonly maturity: Maturity
  /**
   * True when a billing tier is allowed to write this flag.
   *
   * GOVERNED flags are seeded on a tier change and overwritten on a tier change.
   * UNGOVERNED flags are the operator's alone — billing never touches them, in
   * either direction, ever.
   *
   * Most flags are ungoverned. Only the ones a customer is actually buying are
   * governed, and keeping that number small is what makes the system predictable:
   * the blast radius of a subscription event is exactly this set.
   */
  readonly governed: boolean
  /** Path (from the repo root) of the file that reads this flag. Asserted by a test. */
  readonly readSite: string
  readonly description: string
}

export const FEATURES = [
  {
    key: 'onlineOrdering',
    maturity: 'mature',
    // BASELINE, and therefore NOT governed. Every tier includes it, so no tier
    // ever needs to write it — and leaving it ungoverned means no billing event
    // can ever take a restaurant's storefront offline, by any path, including a
    // downgrade. Governing a flag you never intend a tier to withdraw buys you
    // nothing and hands billing a weapon.
    governed: false,
    readSite: 'src/features/ordering.ts',
    description: 'Accept orders through the storefront at all. Baseline — every tier has it.',
  },
  {
    key: 'delivery',
    maturity: 'mature',
    governed: true,
    readSite: 'src/features/ordering.ts',
    description: 'Offer delivery as an order type.',
  },
  {
    key: 'pickup',
    maturity: 'mature',
    governed: false,
    readSite: 'src/features/ordering.ts',
    description: 'Offer pickup as an order type. Baseline — every tier has it.',
  },
  {
    key: 'onlinePayments',
    maturity: 'beta',
    governed: true,
    readSite: 'src/features/payments.ts',
    description: 'Take card payment at checkout rather than cash on collection.',
  },
  {
    key: 'analytics',
    maturity: 'mature',
    governed: true,
    readSite: 'src/features/analytics.ts',
    description: 'The operator analytics dashboard.',
  },
  {
    key: 'crossSell',
    maturity: 'beta',
    governed: false,
    readSite: 'src/features/ordering.ts',
    description: 'Suggest accompaniments in the cart. Operator taste, not a paid tier.',
  },
  {
    key: 'weeklyReport',
    maturity: 'beta',
    governed: false,
    readSite: 'src/features/analytics.ts',
    description: 'Sunday email summarising the week. Opt-in; nobody is auto-subscribed.',
  },
  {
    key: 'legacyBanner',
    maturity: 'deprecated',
    governed: false,
    readSite: 'src/features/ordering.ts',
    description: 'The old promo banner. Deprecated: no new enablements, existing ones still work.',
  },
] as const satisfies readonly FeatureDefinition[]

export type FeatureKey = (typeof FEATURES)[number]['key']

/** Every key, sorted. The loader's default-false seed and the writer's allowlist. */
export const FEATURE_KEYS: readonly FeatureKey[] = FEATURES.map((f) => f.key).sort()

const BY_KEY = new Map<string, FeatureDefinition>(FEATURES.map((f) => [f.key, f]))

export function isFeatureKey(key: string): key is FeatureKey {
  return BY_KEY.has(key)
}

export function featureDefinition(key: FeatureKey): FeatureDefinition {
  const def = BY_KEY.get(key)
  if (!def) throw new Error(`unknown feature ${key}`)
  return def
}

/** The flags a billing tier is allowed to write. The blast radius of any subscription event. */
export const GOVERNED_KEYS: readonly FeatureKey[] = FEATURES.filter((f) => f.governed)
  .map((f) => f.key)
  .sort()

/** A map of every key to false — the shape the loader starts from. */
export type Features = Record<FeatureKey, boolean>

export function allOff(): Features {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Features
}
