// demo:ingest — a paper flyer in, a reviewable draft out. Publishes nothing.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRouter } from '../application/router'
import { ingest } from '../application/ingest'
import { buildProviders } from '../providers'
import { renderDraft } from './format'
import { FIXTURES_DIR, saveDraft } from './store'
import { blockingItems } from '../domain/review'

const file = process.argv[2] ?? join(FIXTURES_DIR, 'flyer-trattoria.txt')
const text = await readFile(file, 'utf8')

const usingKey = Boolean(process.env.ANTHROPIC_API_KEY)
console.log(`\n  source:   ${file}`)
console.log(`  provider: ${usingKey ? 'Claude (ANTHROPIC_API_KEY is set)' : 'fixture — offline, no key, no spend'}`)

const router = createRouter(buildProviders())
const draft = await ingest(router, { images: [], pdfs: [], text }, 'trattoria')

console.log(renderDraft(draft))

const blocked = blockingItems(draft)
const path = await saveDraft(draft)
console.log(`  ${draft.items.length} dishes extracted, ${blocked.length} need a human decision`)
console.log(`  saved to ${path}`)
console.log(`\n  nothing has been published. next:  bun run demo:review\n`)
