/**
 * Three connection URLs, three roles. Deliberately three separate variables rather
 * than one URL plus a role switch: you cannot accidentally reach the BYPASSRLS role
 * by mutating a string.
 *
 * The local defaults match docker-compose.yml so `bun test` works on a clean
 * checkout. In production they are removed: an unset URL is a crash at boot with a
 * readable message, never a silent fallback to localhost.
 */
const LOCAL = {
  DATABASE_URL: 'postgres://condo_app:condo_app_pw@localhost:5544/condominio',
  DATABASE_PLATFORM_URL: 'postgres://condo_platform:condo_platform_pw@localhost:5544/condominio',
  DATABASE_OWNER_URL: 'postgres://condo_owner:condo_owner_pw@localhost:5544/condominio',
  DATABASE_NAME: 'condominio',
} as const

function read(key: keyof typeof LOCAL): string {
  const value = process.env[key]
  if (value) return value
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${key} is not set. Refusing to start with a local-development fallback.`)
  }
  return LOCAL[key]
}

export const env = {
  /** Non-owner app role. RLS applies. */
  get DATABASE_URL() {
    return read('DATABASE_URL')
  },
  /** BYPASSRLS. Platform admin only. */
  get DATABASE_PLATFORM_URL() {
    return read('DATABASE_PLATFORM_URL')
  },
  /** Superuser. Migrations only, never held open at runtime. */
  get DATABASE_OWNER_URL() {
    return read('DATABASE_OWNER_URL')
  },
  /** Asserted against current_database() before any DDL runs. */
  get DATABASE_NAME() {
    return read('DATABASE_NAME')
  },
}
