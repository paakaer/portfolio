const LOCAL = {
  DATABASE_URL: 'postgres://quadro_app:quadro_app_pw@localhost:5545/quadro',
  DATABASE_PLATFORM_URL: 'postgres://quadro_platform:quadro_platform_pw@localhost:5545/quadro',
  DATABASE_OWNER_URL: 'postgres://quadro_owner:quadro_owner_pw@localhost:5545/quadro',
  DATABASE_NAME: 'quadro',
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
  get DATABASE_URL() { return read('DATABASE_URL') },
  get DATABASE_PLATFORM_URL() { return read('DATABASE_PLATFORM_URL') },
  get DATABASE_OWNER_URL() { return read('DATABASE_OWNER_URL') },
  get DATABASE_NAME() { return read('DATABASE_NAME') },
}
