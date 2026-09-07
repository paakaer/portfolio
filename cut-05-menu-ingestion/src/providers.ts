import { createClaudeProvider } from './infrastructure/claude-adapter'
import { createFixtureProvider } from './infrastructure/fixture-adapter'
import type { ExtractionProvider } from './domain/types'

// The registry — the ONE place a concrete vendor is named. The domain, the
// router, the review queue and the CLI depend only on the ExtractionProvider
// interface, so this file is the entire blast radius of a vendor change.
//
// Selection is driven by environment. A vendor with no key is NOT BUILT, so it
// never enters the ladder. That is deliberate and it is the second half of the
// fatal-error rule in the router: a provider that cannot work should be absent,
// not present-and-failing. Present-and-failing is what produces a fallback chain
// that quietly degrades.

/** Cheap first pass. Haiku reads a clean printed menu perfectly well. */
const CHEAP_MODEL = process.env.CARTA_MODEL_CHEAP || 'claude-haiku-4-5'

/** Escalation tier for the hard inputs: angled photos, handwriting, bad light. */
const RICH_MODEL = process.env.CARTA_MODEL_RICH || 'claude-opus-5'

export interface RegistryOptions {
  /** Force the offline provider regardless of environment. */
  fixture?: boolean
}

/**
 * The ladder, cheapest-first.
 *
 * Two tiers rather than one because the cost difference across a menu backlog is
 * real and the quality difference only shows up on hard inputs. The cheap tier
 * handles the clean printed card; the escalation exists for the photo taken at
 * an angle in a dark room. Escalation is driven by OUTPUT (zero dishes, a
 * malformed response), never by a guess made in advance.
 */
export function buildProviders(options: RegistryOptions = {}): ExtractionProvider[] {
  if (options.fixture) return [createFixtureProvider()]

  if (process.env.ANTHROPIC_API_KEY) {
    return [
      createClaudeProvider({ model: CHEAP_MODEL, name: `claude:${CHEAP_MODEL}` }),
      createClaudeProvider({ model: RICH_MODEL, name: `claude:${RICH_MODEL}`, thinking: true }),
    ]
  }

  // No key: the offline provider, so the demo still runs. In a real deployment
  // this branch returns [] and the router raises NOT_CONFIGURED — a missing key
  // must be a loud failure, not a quiet downgrade.
  return [createFixtureProvider()]
}
