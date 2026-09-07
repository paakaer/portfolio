/**
 * The query surface callers run against. Deliberately tiny and driver-agnostic:
 * a tagged template that returns rows.
 *
 * You never receive a connection, a pool, or a driver client — only this, and only
 * inside a callback that is already scoped and already inside a transaction. That
 * is what makes the scope impossible to leak: there is no object you could hold on
 * to after the transaction ends.
 */
export interface UnitOfWork {
  query<T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...params: unknown[]
  ): Promise<T[]>
}
