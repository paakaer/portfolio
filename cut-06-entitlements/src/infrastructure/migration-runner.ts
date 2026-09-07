import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Sql } from 'postgres'

/**
 * Apply pending `NNNN_*.sql` files in filename order, each in its own transaction,
 * recording applied names in `migrations`.
 *
 * No ORM and no migration tool — not out of purism, but because RLS policies are DDL
 * you must be able to READ IN A REVIEW. A generated migration you skim is a tenant
 * boundary you did not check.
 *
 * `expectedDatabase` is asserted against `current_database()` BEFORE any DDL runs.
 * That guard is here because of a real incident: on a shared container network a
 * service named `postgres` collided with another Postgres of the same name, Docker
 * DNS round-robined between them, and migrations intermittently applied to the wrong
 * server. The connection string was correct the entire time. Whatever the URL says,
 * only the far end can tell you where you actually landed.
 */
export async function runMigrations(sql: Sql, dir: string, expectedDatabase: string): Promise<string[]> {
  const [row] = await sql<{ current_database: string }[]>`SELECT current_database()`
  const actual = row?.current_database
  if (actual !== expectedDatabase) {
    throw new Error(
      `DB identity mismatch: connected to "${actual}", expected "${expectedDatabase}". ` +
        `The host in your owner URL is resolving to a different Postgres. Give the ` +
        `service a unique name and point the connection URLs at it.`,
    )
  }

  await sql`CREATE TABLE IF NOT EXISTS migrations (
    name       text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  // One SELECT for the whole applied set, not one per file — every boot runs this
  // and most files are already applied.
  const seen = new Set((await sql<{ name: string }[]>`SELECT name FROM migrations`).map((r) => r.name))
  const applied: string[] = []

  for (const file of files) {
    if (seen.has(file)) continue

    const ddl = await readFile(join(dir, file), 'utf8')
    await sql.begin(async (tx) => {
      await tx.unsafe(ddl)
      await tx`INSERT INTO migrations (name) VALUES (${file})`
    })
    applied.push(file)
  }

  return applied
}
