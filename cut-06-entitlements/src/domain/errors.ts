export class DatabaseError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'DatabaseError'
  }
}

/** A unique constraint was violated. */
export class ConflictError extends DatabaseError {
  constructor(message: string, cause?: unknown) {
    super('CONFLICT', message, cause)
    this.name = 'ConflictError'
  }
}

/**
 * A constraint the tenant boundary depends on was violated — including an RLS
 * policy rejecting a cross-tenant write, and a composite foreign key rejecting a
 * cross-tenant reference.
 */
export class IntegrityError extends DatabaseError {
  constructor(message: string, cause?: unknown) {
    super('INTEGRITY', message, cause)
    this.name = 'IntegrityError'
  }
}

/** The database is unreachable. Distinct from "the query was wrong". */
export class DatabaseUnavailableError extends DatabaseError {
  constructor(message: string, cause?: unknown) {
    super('UNAVAILABLE', message, cause)
    this.name = 'DatabaseUnavailableError'
  }
}

// ─── Feature gating ─────────────────────────────────────────────────────────

/** A refused feature write. Distinct from a database failure — nothing broke. */
export class FeatureError extends Error {
  constructor(
    readonly code: 'UNKNOWN_FEATURE' | 'DEPRECATED' | 'PRECONDITION_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'FeatureError'
  }
}
