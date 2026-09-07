// The review queue. Pure domain — no I/O.
//
// This is the half that makes the feature shippable, and the half most demos
// skip. Extraction is a probabilistic process writing into a system where a
// wrong number is a wrong charge to a real customer. So the pipeline does not
// end at "the model answered"; it ends at "a human agreed".
//
// The design rule: the model may not publish. It may only PROPOSE. Everything
// here exists to make the proposal cheap to check — flags point the reviewer at
// the four or five rows that are actually doubtful, so reviewing 40 dishes is a
// minute's work rather than a re-read of the whole menu.

import type { ExtractedDish, ExtractedMenu } from './types'

export type FlagCode =
  /** No price was read. Cannot be sold. */
  | 'MISSING_PRICE'
  /** A price outside any plausible range — usually a decimal misread. */
  | 'SUSPICIOUS_PRICE'
  /** Priced by weight, or possibly should be. Getting this wrong is a 10x error. */
  | 'PER_KG_AMBIGUOUS'
  /** The same dish name twice — usually the model read one line into two rows. */
  | 'DUPLICATE_NAME'
  /** No section header. Advisory: it still sells, it just lands in "Altro". */
  | 'NO_SECTION'

export interface Flag {
  code: FlagCode
  /** Blocking flags must be resolved by a human before publish. */
  blocking: boolean
  detail: string
}

export interface ReviewItem {
  dish: ExtractedDish
  flags: Flag[]
  /** Set by a human. A resolved item publishes even if it still carries flags. */
  resolved: boolean
}

export interface Draft {
  id: string
  createdAt: string
  /** Which provider actually produced this, and what it cost to get here. */
  provider: string
  escalations: string[]
  sections: string[]
  items: ReviewItem[]
  publishedAt: string | null
}

/** Plausibility window for a single restaurant dish, in cents. */
const MIN_PLAUSIBLE_CENTS = 50
const MAX_PLAUSIBLE_CENTS = 20_000

/** Section names that imply sale by weight. Deli counters, takeaway trays. */
const BY_WEIGHT_HINTS = /gastronomia|asporto|banco|al\s*kg|salumi/i

export function flagsFor(dish: ExtractedDish, allDishes: ExtractedDish[]): Flag[] {
  const flags: Flag[] = []

  if (dish.priceCents === null) {
    flags.push({
      code: 'MISSING_PRICE',
      blocking: true,
      detail: 'no price was printed, or none was read',
    })
  } else if (dish.priceCents < MIN_PLAUSIBLE_CENTS || dish.priceCents > MAX_PLAUSIBLE_CENTS) {
    flags.push({
      code: 'SUSPICIOUS_PRICE',
      blocking: true,
      // The classic failure: "11,00" read as 1100 euro rather than 1100 cents,
      // or a decimal comma dropped entirely.
      detail: `€${(dish.priceCents / 100).toFixed(2)} is outside the plausible range — check the decimal`,
    })
  }

  // A by-weight price applied as a per-portion price is a 10x overcharge, and it
  // looks completely normal in the data. Flag BOTH directions.
  const sectionSuggestsWeight = dish.section !== null && BY_WEIGHT_HINTS.test(dish.section)
  if (sectionSuggestsWeight && !dish.pricePerKg) {
    flags.push({
      code: 'PER_KG_AMBIGUOUS',
      blocking: true,
      detail: `section "${dish.section}" suggests sale by weight, but the price is marked per portion`,
    })
  }

  const twins = allDishes.filter((d) => d.name.toLowerCase() === dish.name.toLowerCase())
  if (twins.length > 1) {
    flags.push({
      code: 'DUPLICATE_NAME',
      blocking: true,
      detail: `"${dish.name}" appears ${twins.length} times — one line may have been read twice`,
    })
  }

  if (dish.section === null) {
    flags.push({ code: 'NO_SECTION', blocking: false, detail: 'no section header — will land under "Altro"' })
  }

  return flags
}

export function buildDraft(
  menu: ExtractedMenu,
  meta: { id: string; provider: string; escalations: string[]; createdAt?: string },
): Draft {
  return {
    id: meta.id,
    createdAt: meta.createdAt ?? new Date().toISOString(),
    provider: meta.provider,
    escalations: meta.escalations,
    sections: menu.sections,
    items: menu.dishes.map((dish) => ({ dish, flags: flagsFor(dish, menu.dishes), resolved: false })),
    publishedAt: null,
  }
}

/** Items that still block publication. */
export function blockingItems(draft: Draft): ReviewItem[] {
  return draft.items.filter((i) => !i.resolved && i.flags.some((f) => f.blocking))
}

export interface PublishCheck {
  ok: boolean
  reason?: string
  blocked: ReviewItem[]
}

/**
 * The gate. There is deliberately NO force flag and NO auto-publish threshold.
 *
 * "Publish automatically when confidence is high" is the feature everyone asks
 * for and it is the one that ends the product: the failure it produces is a
 * plausible wrong price on a live menu, which nobody notices until a customer is
 * charged. Confidence estimated by the same class of system that made the error
 * is not independent evidence.
 */
export function canPublish(draft: Draft): PublishCheck {
  if (draft.publishedAt !== null) {
    return { ok: false, reason: 'already published', blocked: [] }
  }
  if (draft.items.length === 0) {
    return { ok: false, reason: 'draft is empty', blocked: [] }
  }
  const blocked = blockingItems(draft)
  if (blocked.length > 0) {
    return { ok: false, reason: `${blocked.length} item(s) need a human decision`, blocked }
  }
  return { ok: true, blocked: [] }
}

/** Apply a human correction. Re-flags the item, and re-flags DUPLICATE across the draft. */
export function patchItem(draft: Draft, index: number, patch: Partial<ExtractedDish>): Draft {
  const items = draft.items.map((item, i) => (i === index ? { ...item, dish: { ...item.dish, ...patch } } : item))
  const dishes = items.map((i) => i.dish)
  return {
    ...draft,
    // A rename can clear a duplicate somewhere else, so every item is re-flagged,
    // not just the patched one.
    items: items.map((item) => ({ ...item, flags: flagsFor(item.dish, dishes) })),
  }
}

/** Mark a human decision: this item is fine as it stands. */
export function resolveItem(draft: Draft, index: number): Draft {
  return { ...draft, items: draft.items.map((item, i) => (i === index ? { ...item, resolved: true } : item)) }
}

export function removeItem(draft: Draft, index: number): Draft {
  const items = draft.items.filter((_, i) => i !== index)
  const dishes = items.map((i) => i.dish)
  return { ...draft, items: items.map((item) => ({ ...item, flags: flagsFor(item.dish, dishes) })) }
}
