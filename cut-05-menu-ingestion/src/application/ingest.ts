import { normalizeMenu } from '../domain/normalize'
import { buildDraft, type Draft } from '../domain/review'
import type { MenuSource } from '../domain/types'
import type { Router } from './router'

/**
 * The whole pipeline, in the order the steps have to happen:
 *
 *   1. EXTRACT    — the only probabilistic step. Isolated behind the router.
 *   2. NORMALIZE  — deterministic cleanup. Kept OUT of the prompt, where
 *                   "tidy this up" would compete with "change nothing".
 *   3. FLAG       — deterministic doubt-finding. Also kept out of the prompt:
 *                   asking a model to score its own confidence gets you a
 *                   number, not evidence.
 *   4. DRAFT      — a proposal. Never a publish.
 *
 * Steps 2-4 are pure functions over step 1's output, which is what makes the
 * whole thing testable without an API key, and what keeps the model's job small
 * enough that it can do it reliably.
 */
export async function ingest(router: Router, source: MenuSource, id: string): Promise<Draft> {
  const routed = await router.extract(source)
  const normalized = normalizeMenu(routed.menu)
  return buildDraft(normalized, { id, provider: routed.provider, escalations: routed.escalations })
}
