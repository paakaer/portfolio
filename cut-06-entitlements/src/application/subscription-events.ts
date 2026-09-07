import type { UnitOfWork } from '../domain/unit-of-work'
import { applyTierSeedIn } from './enablement'
import type { TierSeed } from '../domain/seed'

// The billing seam — where subscription events meet feature flags.
//
// This file exists to be SMALL and to be read as a list of things that do
// nothing. The interesting content is the `case` arms that fall through.

export type SubscriptionEvent =
  | { kind: 'first_subscription'; tier: string }
  | { kind: 'tier_changed'; from: string; to: string }
  | { kind: 'renewed' }
  | { kind: 'payment_failed' }
  | { kind: 'cancelled' }
  | { kind: 'reactivated'; tier: string }

export interface EventOutcome {
  wrote: boolean
  why: string
}

/**
 * Apply one subscription event. `resolveSeed` reads the tier's entitlements from
 * the billing processor and is called ONLY when a write is actually going to
 * happen — so the ~90% of events that change nothing cost no network call either.
 *
 * **Record-only billing.** A lapsed subscription disables NOTHING. The restaurant
 * that forgot to update its card keeps taking orders, and someone sends them an
 * email like a human being. Taking a paying business's storefront offline over a
 * failed charge is a product decision disguised as an implementation detail, and
 * it is the wrong one — the customer whose card failed is the customer you most
 * want to keep.
 */
export async function applySubscriptionEvent(
  uow: UnitOfWork,
  tenantId: string,
  event: SubscriptionEvent,
  resolveSeed: (tier: string) => Promise<TierSeed>,
): Promise<EventOutcome> {
  switch (event.kind) {
    case 'first_subscription':
      // Fill mode: hand them the tier's defaults without trampling a hand-tuned
      // setup that predates billing.
      await applyTierSeedIn(uow, tenantId, await resolveSeed(event.tier), 'fill')
      return { wrote: true, why: `first subscription (${event.tier}) — filled unset flags` }

    case 'tier_changed':
      // Overwrite mode: the ONLY path that rewrites a governed flag. A downgrade
      // writes false, which is what actually withdraws a paid feature.
      await applyTierSeedIn(uow, tenantId, await resolveSeed(event.to), 'overwrite')
      return { wrote: true, why: `tier ${event.from} → ${event.to} — governed flags rewritten` }

    case 'renewed':
      // A renewal is the same tier as before. Re-seeding here is the bug that
      // makes operators' manual flips mysteriously revert once a month, and it is
      // very hard to diagnose because it only happens on the billing anniversary.
      return { wrote: false, why: 'renewal — same tier, nothing to write' }

    case 'payment_failed':
      // Record-only. See above.
      return { wrote: false, why: 'payment failed — record-only, nothing disabled' }

    case 'cancelled':
      // Deliberately not a downgrade-to-nothing. Cancellation is an
      // account-lifecycle event handled by a human with a calendar, not a
      // same-second capability withdrawal.
      return { wrote: false, why: 'cancelled — record-only, nothing disabled' }

    case 'reactivated':
      // Reactivation onto the SAME tier they left is not a tier change, so it
      // must not rewrite anything. If the tier differs, the processor emits a
      // tier_changed too.
      return { wrote: false, why: 'reactivated — no tier change, nothing to write' }
  }
}
