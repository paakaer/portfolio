import type { Features } from '../domain/registry'

/**
 * Card payment requires ordering to be on at all. A capability that depends on
 * another capability checks BOTH — the dependency is not implied by the flag
 * being true, and expressing it here rather than in the registry keeps the
 * registry a list of facts rather than a graph.
 */
export function acceptsCardPayment(features: Features): boolean {
  return features.onlineOrdering && features.onlinePayments
}
