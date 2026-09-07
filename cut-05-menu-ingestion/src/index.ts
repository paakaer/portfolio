// The door.

export { createRouter, type Router, type RoutedResult } from './application/router'
export { ingest } from './application/ingest'
export { buildProviders } from './providers'

export {
  buildDraft,
  canPublish,
  flagsFor,
  blockingItems,
  patchItem,
  resolveItem,
  removeItem,
  type Draft,
  type Flag,
  type FlagCode,
  type ReviewItem,
  type PublishCheck,
} from './domain/review'

export { normalizeMenu, softTitle, titleCase, expandAbbreviations, isShouty } from './domain/normalize'

export {
  ExtractionError,
  type ExtractedDish,
  type ExtractedMenu,
  type ExtractionProvider,
  type ExtractionErrorCode,
  type MenuSource,
  type MenuImage,
} from './domain/types'

export { createFixtureProvider } from './infrastructure/fixture-adapter'
export { createClaudeProvider, type CreateMessage } from './infrastructure/claude-adapter'
