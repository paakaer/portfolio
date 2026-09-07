// THE DOOR.
//
// Everything outside this module imports from here. Hidden, permanently: the
// `postgres` driver, the pools, the ConnectionProvider, and anything under
// application/ or infrastructure/.
//
// There are exactly four ways to reach the database and you must name which one you
// meant. There is no `getConnection()`.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from './env'
import { ConnectionProvider } from './application/connection-provider'
import { migrate as runMigrate } from './application/migrate'
import type { UnitOfWork } from './domain/unit-of-work'

const provider = new ConnectionProvider({
  appUrl: env.DATABASE_URL,
  platformUrl: env.DATABASE_PLATFORM_URL,
})

// src/index.ts -> db/migrations
export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../db/migrations')

export const db = {
  /**
   * Run `fn` scoped to one tenant. RLS guarantees it sees only that tenant's rows,
   * and a cross-tenant write raises. This is the default; if you are reaching for
   * anything else, say why in a comment.
   */
  withTenant<T>(tenantId: string, fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return provider.run({ tenant: tenantId }, fn)
  },

  /**
   * App role with NO tenant scope — for the non-RLS routing tables read before a
   * tenant is known (`tenant_domains`), i.e. Host -> tenant resolution.
   *
   * Reading an RLS table here returns ZERO rows, fail-closed. That includes
   * `organization`, which is RLS-protected and is NOT registry-readable.
   */
  registry<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return provider.run({ registry: true }, fn)
  },

  /**
   * Cross-tenant, as the BYPASSRLS role. Platform-admin work ONLY.
   *
   * If this appears anywhere in a request path, that is a bug. It is a separate
   * named method rather than a flag precisely so it shows up in a diff.
   */
  withPlatform<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return provider.run({ platform: true }, fn)
  },

  /** Subscribe to a Postgres LISTEN channel on a dedicated connection. */
  listen(channel: string, handler: (payload: string) => void): Promise<void> {
    return provider.listen(channel, handler)
  },

  /** Apply pending migrations as the owner role. Returns the names applied. */
  migrate(): Promise<string[]> {
    return runMigrate(env.DATABASE_OWNER_URL, MIGRATIONS_DIR, env.DATABASE_NAME)
  },

  /** Close every pool. Call on shutdown and after tests. */
  end(): Promise<void> {
    return provider.end()
  },
}

export type { UnitOfWork } from './domain/unit-of-work'
export { TENANT_ID_REGEX, type ConnectionScope } from './domain/types'
export {
  ConflictError,
  DatabaseError,
  DatabaseUnavailableError,
  IntegrityError,
} from './domain/errors'
export { normalizeHost, resolveTenantByHost, type TenantRef } from './tenant'
