import postgres, { type Sql, type TransactionSql } from 'postgres'
import type { UnitOfWork } from '../domain/unit-of-work'

// The ONLY module that imports the driver. Everything else goes through
// UnitOfWork / ConnectionProvider. If `postgres` appears in an import anywhere
// else in this repo, the door has been walked around.

export type DriverSql = Sql

export function createSql(connectionString: string, max: number): DriverSql {
  return postgres(connectionString, {
    max,
    // Suppress benign NOTICEs (`IF NOT EXISTS ... skipping`). Real problems are errors.
    onnotice: () => {},
  }) as DriverSql
}

/** Wrap an already-scoped transaction as a driver-agnostic UnitOfWork. */
export function unitOfWorkFor(tx: TransactionSql): UnitOfWork {
  // The driver's tagged-template overload is typed for its own parameter union;
  // UnitOfWork is deliberately driver-agnostic, so this cast is the one sanctioned
  // place the driver leaks — and it is contained to this file.
  const run = tx as unknown as (s: TemplateStringsArray, ...p: unknown[]) => Promise<unknown[]>
  return {
    async query(strings, ...params) {
      return (await run(strings, ...params)) as never[]
    },
  }
}
