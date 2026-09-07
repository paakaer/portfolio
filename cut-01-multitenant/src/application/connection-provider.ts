import { DatabaseError } from '../domain/errors'
import { TENANT_ID_REGEX, type ConnectionScope } from '../domain/types'
import type { UnitOfWork } from '../domain/unit-of-work'
import { createSql, unitOfWorkFor, type DriverSql } from '../infrastructure/pg'
import { translateError } from '../infrastructure/error-translator'

export interface ProviderConfig {
  /** Non-owner app role. RLS applies. */
  appUrl: string
  /** BYPASSRLS platform role. */
  platformUrl: string
  appMax?: number
  platformMax?: number
}

/**
 * Owns the pools, and is the ONLY place a tenant scope is bound to a connection.
 *
 * The pool sizes do not vary with tenant count. That is the whole commercial
 * argument for shared-schema: 10 + 2 + 1 connections whether you have three tenants
 * or three thousand. Under schema-per-tenant this configuration has a tenant-count
 * variable in it, and that variable is what caps the business.
 */
export class ConnectionProvider {
  #app: DriverSql | null = null
  #platform: DriverSql | null = null
  // A dedicated single connection for LISTEN, kept OFF the query pools: a long-lived
  // subscription parked on a pooled connection starves the pool it borrowed from.
  #listen: DriverSql | null = null

  constructor(private readonly config: ProviderConfig) {}

  #appSql(): DriverSql {
    return (this.#app ??= createSql(this.config.appUrl, this.config.appMax ?? 10))
  }

  #platformSql(): DriverSql {
    return (this.#platform ??= createSql(this.config.platformUrl, this.config.platformMax ?? 2))
  }

  #listenSql(): DriverSql {
    return (this.#listen ??= createSql(this.config.appUrl, 1))
  }

  async listen(channel: string, handler: (payload: string) => void): Promise<void> {
    await this.#listenSql().listen(channel, handler)
  }

  async run<T>(scope: ConnectionScope, fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    try {
      if ('tenant' in scope) {
        // Validate BEFORE it reaches set_config. A malformed id is an error, never
        // an unscoped connection.
        if (!TENANT_ID_REGEX.test(scope.tenant)) {
          throw new DatabaseError('INVALID_TENANT', `invalid tenant id ${JSON.stringify(scope.tenant)}`)
        }
        return (await this.#appSql().begin(async (tx) => {
          // THE LINE THAT MAKES A SHARED POOL SAFE.
          //
          // The third argument to set_config is `is_local`: it scopes the setting to
          // this TRANSACTION, so it resets automatically on commit OR rollback —
          // including the rollback you did not write, from the exception you did not
          // anticipate. There is no release path to forget, because the reset is
          // Postgres's job rather than yours.
          //
          // This is the direct answer to the search_path leak that makes
          // schema-per-tenant unsafe on a shared pool.
          await tx`SELECT set_config('app.tenant', ${scope.tenant}, true)`
          return fn(unitOfWorkFor(tx))
        })) as T
      }

      if ('registry' in scope) {
        // App role, NO app.tenant. For the non-RLS routing tables read before a
        // tenant is known. An RLS table read here returns zero rows — fail-closed,
        // never a leak.
        return (await this.#appSql().begin((tx) => fn(unitOfWorkFor(tx)))) as T
      }

      return (await this.#platformSql().begin((tx) => fn(unitOfWorkFor(tx)))) as T
    } catch (err) {
      throw translateError(err)
    }
  }

  async end(): Promise<void> {
    // Null the handles first so a later call re-bootstraps: end() is idempotent and
    // the provider stays reusable across test files that each clean up.
    const ending = [this.#app?.end(), this.#platform?.end(), this.#listen?.end()]
    this.#app = null
    this.#platform = null
    this.#listen = null
    await Promise.all(ending)
  }
}
