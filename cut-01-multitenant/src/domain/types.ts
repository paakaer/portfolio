/**
 * A UUIDv7, strictly: version nibble `7` and an RFC 4122 variant nibble.
 *
 * Validated before it is ever interpolated into `set_config`, so a malformed or
 * hostile tenant id is a thrown error rather than an unscoped connection. A UUIDv4
 * is rejected too — ids in this system are v7 by construction, and accepting a v4
 * here would mean something upstream is minting ids the wrong way.
 */
export const TENANT_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * The three ways to reach the database. There is no fourth, and no way to ask for
 * "a connection" without saying which of these you meant.
 */
export type ConnectionScope =
  /** RLS-scoped to one tenant. The default for everything user-facing. */
  | { tenant: string }
  /** App role, NO tenant scope. Non-RLS routing tables only. Fail-closed elsewhere. */
  | { registry: true }
  /** BYPASSRLS. Cross-tenant platform work only. */
  | { platform: true }
