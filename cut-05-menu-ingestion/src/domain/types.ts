// Domain vocabulary. Pure types — no I/O, no vendor SDK. Adapters and callers
// both depend on THESE shapes, never on a vendor's, so the provider is swappable
// without touching the domain, the router, the review queue or the CLI.

/** One page of a paper menu, base64 + its magic-byte-verified media type. */
export interface MenuImage {
  base64: string
  mediaType: string
}

/** Everything handed in for one extraction attempt. */
export interface MenuSource {
  images: MenuImage[]
  pdfs: { base64: string }[]
  /** OCR'd or pasted text, or null. */
  text: string | null
  /**
   * A re-prompt instruction from the reviewer ("i prezzi sono al kg", "ignora le
   * bevande"). Null on the first pass. This is what makes review a LOOP rather
   * than a form: the human corrects the model's framing, not just its output.
   */
  instructions?: string | null
  /** The prior extraction being corrected, for re-prompt context. */
  previousResult?: ExtractedMenu | null
}

/** One dish read off the menu. `priceCents` is null when no price was printed. */
export interface ExtractedDish {
  name: string
  priceCents: number | null
  /** True when the printed price is per kilo (deli counters price by weight). */
  pricePerKg: boolean
  /** The section header this dish sat under, if the source grouped it. */
  section: string | null
  /**
   * Ingredients read VERBATIM off the page. Empty when none were printed —
   * never inferred from the dish name. A model that "knows" what goes in a
   * carbonara will happily invent an ingredient list that the restaurant never
   * wrote, and nobody downstream can tell the difference.
   */
  ingredients: string[]
  /** The description printed on the menu, or null. Same rule as ingredients. */
  description: string | null
}

export interface ExtractedMenu {
  /** Section headers found, in reading order. */
  sections: string[]
  dishes: ExtractedDish[]
}

/** Provider-agnostic extraction port. Each tier is one implementation. */
export interface ExtractionProvider {
  /** Stable label for logs and escalation traces. */
  readonly name: string
  extract(source: MenuSource): Promise<ExtractedMenu>
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * THE DISTINCTION THIS WHOLE REPO TURNS ON.
 *
 * Two categories, and conflating them is the bug:
 *
 *   QUALITY failures  (BAD_OUTPUT, REQUEST_FAILED) — this tier could not do the
 *     job. Escalating to a better model is the correct response.
 *
 *   CONFIG failures   (NOT_CONFIGURED, AUTH_FAILED) — this tier was never going
 *     to work. Escalating hides a broken deployment behind a more expensive
 *     model, and you find out weeks later from the output quality.
 *
 * `fatal` is what the router reads. See application/router.ts.
 */
export type ExtractionErrorCode = 'NOT_CONFIGURED' | 'AUTH_FAILED' | 'BAD_OUTPUT' | 'REQUEST_FAILED'

const FATAL_CODES = new Set<ExtractionErrorCode>(['NOT_CONFIGURED', 'AUTH_FAILED'])

export class ExtractionError extends Error {
  constructor(
    readonly code: ExtractionErrorCode,
    message: string,
    readonly provider?: string,
  ) {
    super(message)
    this.name = 'ExtractionError'
  }

  /** True when escalating would hide a misconfiguration instead of fixing it. */
  get fatal(): boolean {
    return FATAL_CODES.has(this.code)
  }
}
