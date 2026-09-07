import { createSql } from '../infrastructure/pg'
import { runMigrations } from '../infrastructure/migration-runner'

/**
 * Apply pending migrations on a short-lived OWNER connection, then close it. The
 * owner role is never held open at runtime — it exists for this and nothing else.
 */
export async function migrate(ownerUrl: string, dir: string, expectedDatabase: string): Promise<string[]> {
  const sql = createSql(ownerUrl, 1)
  try {
    return await runMigrations(sql, dir, expectedDatabase)
  } finally {
    await sql.end()
  }
}
