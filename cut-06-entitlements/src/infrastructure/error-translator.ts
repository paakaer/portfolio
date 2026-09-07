import { ConflictError, DatabaseError, DatabaseUnavailableError, IntegrityError } from '../domain/errors'

interface PgError {
  code?: string
  message?: string
}

/**
 * Turn driver errors into domain errors, so callers never pattern-match on
 * Postgres SQLSTATE strings.
 *
 * The three codes that matter for the tenant boundary:
 *   42501  insufficient_privilege — an RLS WITH CHECK rejected a cross-tenant write
 *   23503  foreign_key_violation  — a COMPOSITE fk rejected a cross-tenant reference
 *   23505  unique_violation
 *
 * 42501 in particular is the boundary doing its job. It should reach your logs as a
 * loud, named error, not as an opaque driver exception someone wraps in a retry.
 */
export function translateError(err: unknown): Error {
  if (err instanceof DatabaseError) return err

  const e = err as PgError
  const message = e?.message ?? 'database error'

  switch (e?.code) {
    case '23505':
      return new ConflictError(message, err)
    case '23503':
    case '23514':
    case '42501':
      return new IntegrityError(message, err)
    case 'ECONNREFUSED':
    case 'CONNECT_TIMEOUT':
    case '57P03':
      return new DatabaseUnavailableError(message, err)
    default:
      return err instanceof Error ? err : new DatabaseError('UNKNOWN', message, err)
  }
}
