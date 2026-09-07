import { expect, test } from 'bun:test'
import { createRouter } from '../src/application/router'
import { ExtractionError, type ExtractedMenu, type ExtractionProvider } from '../src/domain/types'

const MENU: ExtractedMenu = {
  sections: ['Primi'],
  dishes: [{ name: 'Tagliatelle', priceCents: 1100, pricePerKg: false, section: 'Primi', ingredients: [], description: null }],
}

function ok(name: string, calls: string[]): ExtractionProvider {
  return { name, extract: async () => (calls.push(name), MENU) }
}
function fails(name: string, code: 'BAD_OUTPUT' | 'REQUEST_FAILED' | 'AUTH_FAILED' | 'NOT_CONFIGURED', calls: string[]): ExtractionProvider {
  return {
    name,
    extract: async () => {
      calls.push(name)
      throw new ExtractionError(code, `${name} failed`, name)
    },
  }
}
function empty(name: string, calls: string[]): ExtractionProvider {
  return { name, extract: async () => (calls.push(name), { sections: [], dishes: [] }) }
}

test('the cheap tier wins when it works — the expensive one is never called', async () => {
  const calls: string[] = []
  const result = await createRouter([ok('cheap', calls), ok('rich', calls)]).extract({ images: [], pdfs: [], text: 'x' })
  expect(calls).toEqual(['cheap'])
  expect(result.provider).toBe('cheap')
  expect(result.escalations).toEqual([])
})

test('a QUALITY failure escalates to the next tier', async () => {
  const calls: string[] = []
  const result = await createRouter([fails('cheap', 'BAD_OUTPUT', calls), ok('rich', calls)]).extract({
    images: [], pdfs: [], text: 'x',
  })
  expect(calls).toEqual(['cheap', 'rich'])
  expect(result.provider).toBe('rich')
  expect(result.escalations).toHaveLength(1)
})

test('an EMPTY extraction is a failure, not a quiet success', async () => {
  // A provider returning zero dishes has failed in the shape of success. Letting
  // it win publishes an empty menu over a real one.
  const calls: string[] = []
  const result = await createRouter([empty('cheap', calls), ok('rich', calls)]).extract({ images: [], pdfs: [], text: 'x' })
  expect(calls).toEqual(['cheap', 'rich'])
  expect(result.provider).toBe('rich')
  expect(result.escalations[0]).toContain('zero dishes')
})

test('AUTH_FAILED does NOT escalate — a broken deployment must not be hidden', async () => {
  // THE REGRESSION TEST FOR THE BUG THIS REPO IS ABOUT.
  //
  // Escalating past bad credentials converts a loud, fixable configuration error
  // into a silent, more expensive one that still returns plausible output. The
  // next tier must never be called.
  const calls: string[] = []
  const router = createRouter([fails('cheap', 'AUTH_FAILED', calls), ok('rich', calls)])

  await expect(router.extract({ images: [], pdfs: [], text: 'x' })).rejects.toThrow(ExtractionError)
  expect(calls).toEqual(['cheap'])
})

test('NOT_CONFIGURED does not escalate either', async () => {
  const calls: string[] = []
  const router = createRouter([fails('cheap', 'NOT_CONFIGURED', calls), ok('rich', calls)])
  await expect(router.extract({ images: [], pdfs: [], text: 'x' })).rejects.toThrow(ExtractionError)
  expect(calls).toEqual(['cheap'])
})

test('an unknown thrown value becomes a non-fatal REQUEST_FAILED and still escalates', async () => {
  const calls: string[] = []
  const flaky: ExtractionProvider = {
    name: 'flaky',
    extract: async () => {
      calls.push('flaky')
      throw new Error('socket hang up')
    },
  }
  const result = await createRouter([flaky, ok('rich', calls)]).extract({ images: [], pdfs: [], text: 'x' })
  expect(calls).toEqual(['flaky', 'rich'])
  expect(result.provider).toBe('rich')
})

test('exhausting every tier throws the last failure', async () => {
  const calls: string[] = []
  const router = createRouter([fails('a', 'BAD_OUTPUT', calls), fails('b', 'REQUEST_FAILED', calls)])
  await expect(router.extract({ images: [], pdfs: [], text: 'x' })).rejects.toThrow('b failed')
  expect(calls).toEqual(['a', 'b'])
})

test('an empty provider list is NOT_CONFIGURED, never a silent empty menu', async () => {
  await expect(createRouter([]).extract({ images: [], pdfs: [], text: 'x' })).rejects.toMatchObject({
    code: 'NOT_CONFIGURED',
    fatal: true,
  })
})
