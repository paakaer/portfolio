import { ExtractionError, type ExtractedMenu, type ExtractionProvider, type MenuSource } from '../domain/types'

export interface RoutedResult {
  menu: ExtractedMenu
  /** Which provider actually produced the result. */
  provider: string
  /** Every tier that failed before it, with why. For logs and the draft record. */
  escalations: string[]
}

export interface Router {
  extract(source: MenuSource): Promise<RoutedResult>
}

/**
 * Cheapest-first escalation over an ordered provider list.
 *
 * THE RULE THAT MATTERS — and the one the naive version gets wrong:
 *
 *   A QUALITY failure escalates.  This tier tried and produced nothing useful;
 *                                 a better model is the right answer.
 *
 *   A CONFIG failure ABORTS.      This tier was never going to work. Escalating
 *                                 past it silently converts a broken deployment
 *                                 into a more expensive one that still works —
 *                                 so nobody finds out until the bill, or until
 *                                 the output quality is questioned weeks later.
 *
 * The version of this we shipped first did not make that distinction. Bad
 * credentials on the primary provider fell straight through to the fallback,
 * which happily returned plausible output for a DIFFERENT input. The failure
 * never surfaced as an error — it surfaced as believable, wrong data.
 *
 * A fallback chain that swallows configuration errors is not a resilience
 * feature. It is a correctness bug wearing a resilience costume.
 *
 * An EMPTY extraction counts as a quality failure. A provider that returns zero
 * dishes has not succeeded quietly; it has failed loudly in a way that looks
 * like success, and letting it win means publishing an empty menu.
 */
export function createRouter(providers: ExtractionProvider[]): Router {
  return {
    async extract(source: MenuSource): Promise<RoutedResult> {
      if (providers.length === 0) {
        throw new ExtractionError(
          'NOT_CONFIGURED',
          'No extraction provider is configured. Set ANTHROPIC_API_KEY, or run with the fixture provider.',
        )
      }

      const escalations: string[] = []
      let last: ExtractionError | null = null

      for (const provider of providers) {
        try {
          const menu = await provider.extract(source)

          if (menu.dishes.length === 0) {
            last = new ExtractionError('BAD_OUTPUT', 'returned zero dishes', provider.name)
            escalations.push(`${provider.name}: zero dishes`)
            continue
          }

          return { menu, provider: provider.name, escalations }
        } catch (err) {
          const e =
            err instanceof ExtractionError
              ? err
              : new ExtractionError('REQUEST_FAILED', err instanceof Error ? err.message : String(err), provider.name)

          // Do not escalate past a broken deployment.
          if (e.fatal) throw e

          last = e
          escalations.push(`${provider.name}: ${e.code} ${e.message}`)
        }
      }

      throw last ?? new ExtractionError('REQUEST_FAILED', 'every provider failed')
    },
  }
}
