import type { UnitOfWork } from '../domain/unit-of-work'
import { allOff, featureDefinition, type FeatureKey, type Features } from '../domain/registry'
import { FeatureError } from '../domain/errors'
import type { TierSeed } from '../domain/seed'

// The enablement store. THE SINGLE WRITE PATH for a feature flag.
//
// Everything that can change what a tenant has switched on goes through one of
// the three writers below. That is not tidiness — it is what makes the cache
// invalidation impossible to forget, and what makes "who turned this off?" a
// question with an answer.

// ─── Reading ────────────────────────────────────────────────────────────────

/**
 * Resolve every flag for a tenant. **This is the entire runtime gate.**
 *
 *   live(tenant, feature) = tenant_features.enabled
 *
 * Not the tier. Not the subscription status. Not the maturity. Not the
 * processor's entitlements. One field.
 *
 * The reason is worth stating plainly, because every one of those alternatives
 * looks reasonable in isolation: each of them can change *without a human
 * deciding anything* — a card expires, a webhook is redelivered, someone edits a
 * maturity level — and each would then silently take a working restaurant's
 * storefront apart. Enablement changes only when somebody, or a tier change,
 * writes it.
 *
 * Absent rows read as false, so a brand-new tenant is off across the board and a
 * newly-added flag is off until someone decides otherwise.
 */
export async function loadFeatures(uow: UnitOfWork, tenantId: string): Promise<Features> {
  const rows = await uow.query<{ feature: string; enabled: boolean }>`
    SELECT feature, enabled FROM tenant_features WHERE tenant_id = ${tenantId}`
  const features = allOff()
  for (const row of rows) {
    // A row for a key the registry no longer knows is ignored, never crashed on:
    // removing a flag from the code must not break every tenant carrying its row.
    if (row.feature in features) features[row.feature as FeatureKey] = row.enabled
  }
  return features
}

/**
 * Read ONE flag inside the caller's transaction, uncached.
 *
 * The sibling of `loadFeatures`, and it exists for one specific case: a caller
 * doing a read-modify-write that must be serialised against a concurrent writer.
 * A cached read cannot serve that — it can hand back an enablement that another
 * writer has already committed, which is exactly the window the caller is holding
 * a lock to close.
 */
export async function isEnabledIn(uow: UnitOfWork, tenantId: string, feature: FeatureKey): Promise<boolean> {
  const [row] = await uow.query<{ enabled: boolean }>`
    SELECT enabled FROM tenant_features WHERE tenant_id = ${tenantId} AND feature = ${feature}`
  return row?.enabled ?? false
}

// ─── Writing ────────────────────────────────────────────────────────────────

/**
 * Overwriting write. Used by a human flipping a switch, and by a genuine
 * tier-to-tier change.
 *
 * A `deprecated` feature refuses a NEW enablement and permits everything else —
 * disabling it, and leaving an existing enablement alone. Deprecation stops the
 * bleeding; it does not take a capability away from someone already using it.
 */
export async function setEnablementIn(
  uow: UnitOfWork,
  tenantId: string,
  feature: FeatureKey,
  enabled: boolean,
): Promise<void> {
  if (enabled && featureDefinition(feature).maturity === 'deprecated') {
    const already = await isEnabledIn(uow, tenantId, feature)
    if (!already) {
      throw new FeatureError('DEPRECATED', `${feature} is deprecated — no new enablements`)
    }
  }
  await uow.query`
    INSERT INTO tenant_features (tenant_id, feature, enabled) VALUES (${tenantId}, ${feature}, ${enabled})
    ON CONFLICT (tenant_id, feature) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`
  // Transactional notify — fires on commit, so other processes drop their cached
  // config. It lives HERE, in the write path, precisely so a caller cannot forget it.
  await uow.query`SELECT pg_notify('features:updated', ${tenantId})`
}

/**
 * Fill-in-the-blanks write. Only writes a flag the tenant has never had set.
 *
 * This is the half that makes a first subscription safe. Tenants who predate
 * billing are hand-configured, and their first checkout must hand them their
 * tier's defaults **without trampling decisions an operator already made.**
 * `ON CONFLICT DO NOTHING` is exactly that.
 *
 * Returns true when a row was actually inserted.
 */
export async function seedEnablementIn(
  uow: UnitOfWork,
  tenantId: string,
  feature: FeatureKey,
  enabled: boolean,
): Promise<boolean> {
  const rows = await uow.query<{ feature: string }>`
    INSERT INTO tenant_features (tenant_id, feature, enabled) VALUES (${tenantId}, ${feature}, ${enabled})
    ON CONFLICT (tenant_id, feature) DO NOTHING
    RETURNING feature`
  // Only notify when something changed, so a no-op seed does not churn every
  // instance's cache on every renewal.
  if (rows.length > 0) await uow.query`SELECT pg_notify('features:updated', ${tenantId})`
  return rows.length > 0
}

/**
 * A write whose PRECONDITION must hold at the moment of writing.
 *
 * The transaction is owned here, and `precondition` runs inside it, so the two
 * cannot be separated by a later edit at the call site. That matters more than it
 * looks: a precondition evaluated in its own transaction releases its locks
 * BEFORE this write lands, reopening precisely the window it exists to close —
 * and no black-box test can tell the two shapes apart, because both block
 * identically when the rows are contended.
 *
 * The motivating case: "you may not enable ordering with zero products". The
 * check must take a lock on the product rows, and the same lock the product
 * writer takes, or an enable and a delete-the-last-product pass through each
 * other and leave a live storefront with nothing to sell.
 *
 * Making it structural is the only guarantee actually available here.
 */
export async function setEnablementGuardedIn(
  uow: UnitOfWork,
  tenantId: string,
  feature: FeatureKey,
  enabled: boolean,
  precondition: (uow: UnitOfWork) => Promise<boolean>,
): Promise<void> {
  if (!(await precondition(uow))) {
    throw new FeatureError('PRECONDITION_FAILED', `precondition refused ${feature}`)
  }
  await setEnablementIn(uow, tenantId, feature, enabled)
}

// ─── The billing seam ───────────────────────────────────────────────────────

/**
 * How a tier's seed meets a flag the tenant already has an opinion about.
 *
 * `fill`      — the tenant's FIRST subscription. Only flags never explicitly set
 *               are written, so hand-configuration survives the moment they start
 *               paying.
 * `overwrite` — a genuine tier-to-tier change. Every governed flag is written,
 *               which is what makes a downgrade actually withdraw a paid feature.
 */
export type SeedMode = 'fill' | 'overwrite'

/**
 * Apply a tier's seed, inside the caller's transaction, so that the recorded tier
 * and the flags it implies land together or not at all.
 *
 * **Call this ONLY on an actual tier change.** That single restriction is the
 * invariant the whole design rests on:
 *
 *   • a tier CHANGE writes the governed flags;
 *   • nothing else ever writes them — not a renewal, not a payment failure, not
 *     a cancellation, not a redelivered webhook.
 *
 * So an operator's flip after subscribing stays flipped, while a real upgrade or
 * downgrade still moves what the tenant is paying for.
 *
 * The seed is resolved by the CALLER, before this transaction opens, because
 * resolving it reads the billing processor over the network — and holding a
 * Postgres transaction open across a third party's API call is how a slow vendor
 * becomes database lock contention.
 */
export async function applyTierSeedIn(
  uow: UnitOfWork,
  tenantId: string,
  seed: TierSeed,
  mode: SeedMode,
): Promise<void> {
  for (const [feature, enabled] of seed) {
    if (mode === 'fill') await seedEnablementIn(uow, tenantId, feature, enabled)
    else await setEnablementIn(uow, tenantId, feature, enabled)
  }
}
