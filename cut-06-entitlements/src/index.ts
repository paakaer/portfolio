// The door.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from './env'
import { ConnectionProvider } from './application/connection-provider'
import { migrate as runMigrate } from './application/migrate'
import type { UnitOfWork } from './domain/unit-of-work'

const provider = new ConnectionProvider({ appUrl: env.DATABASE_URL, platformUrl: env.DATABASE_PLATFORM_URL })
export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../db/migrations')

export const db = {
  withTenant<T>(tenantId: string, fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return provider.run({ tenant: tenantId }, fn)
  },
  registry<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return provider.run({ registry: true }, fn)
  },
  withPlatform<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return provider.run({ platform: true }, fn)
  },
  migrate(): Promise<string[]> {
    return runMigrate(env.DATABASE_OWNER_URL, MIGRATIONS_DIR, env.DATABASE_NAME)
  },
  end(): Promise<void> {
    return provider.end()
  },
}

export {
  FEATURES,
  FEATURE_KEYS,
  GOVERNED_KEYS,
  allOff,
  featureDefinition,
  isFeatureKey,
  type FeatureKey,
  type FeatureDefinition,
  type Features,
  type Maturity,
} from './domain/registry'
export { buildTierSeed, seedForGrants, type TierSeed } from './domain/seed'
export { FeatureError } from './domain/errors'
export {
  loadFeatures,
  isEnabledIn,
  setEnablementIn,
  seedEnablementIn,
  setEnablementGuardedIn,
  applyTierSeedIn,
  type SeedMode,
} from './application/enablement'
export {
  applySubscriptionEvent,
  type SubscriptionEvent,
  type EventOutcome,
} from './application/subscription-events'
export type { UnitOfWork } from './domain/unit-of-work'
