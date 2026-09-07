import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Draft } from '../domain/review'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const DRAFTS_DIR = join(ROOT, '.drafts')
export const FIXTURES_DIR = join(ROOT, 'fixtures')

export async function saveDraft(draft: Draft): Promise<string> {
  await mkdir(DRAFTS_DIR, { recursive: true })
  const path = join(DRAFTS_DIR, `${draft.id}.json`)
  await writeFile(path, `${JSON.stringify(draft, null, 2)}\n`, 'utf8')
  return path
}

export async function loadDraft(id: string): Promise<Draft> {
  return JSON.parse(await readFile(join(DRAFTS_DIR, `${id}.json`), 'utf8')) as Draft
}
