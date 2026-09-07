import { expect, test } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import { createClaudeProvider } from '../src/infrastructure/claude-adapter'
import type { MenuSource } from '../src/domain/types'

// Request-shaping and response-parsing are covered with an injected `create`, so
// the vendor path is tested with NO API key and NO spend. What this cannot cover
// is whether the live model reads a real photograph well — that is an eval, not
// a unit test, and it is a different discipline.

function reply(input: unknown): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: 'tool_use', id: 'tu_1', name: 'extract_menu', input }],
  } as unknown as Anthropic.Message
}

const source: MenuSource = { images: [], pdfs: [], text: 'TIRAMISU 6,00' }

test('output is forced through the tool, never free text', async () => {
  let seen: Anthropic.MessageCreateParamsNonStreaming | null = null
  const provider = createClaudeProvider({
    model: 'claude-haiku-4-5',
    create: async (p) => {
      seen = p
      return reply({ dishes: [{ name: 'Tiramisù', price: 6 }] })
    },
  })
  await provider.extract(source)

  const params = seen as unknown as Anthropic.MessageCreateParamsNonStreaming
  expect(params.tool_choice).toEqual({ type: 'tool', name: 'extract_menu' })
  expect((params.tools?.[0] as Anthropic.Tool).name).toBe('extract_menu')
})

test('euros become cents by ROUNDING, not truncation', async () => {
  // 8.5 must be 850, and 11.1 * 100 is 1110.0000000000002 in binary floating
  // point — truncating that gives 1110, but truncating 8.5 * 100 = 849.999… gives
  // 849. One cent wrong on every menu is the kind of bug nobody reports.
  const provider = createClaudeProvider({
    model: 'm',
    create: async () => reply({ dishes: [{ name: 'a', price: 8.5 }, { name: 'b', price: 11.1 }] }),
  })
  const menu = await provider.extract(source)
  expect(menu.dishes[0]!.priceCents).toBe(850)
  expect(menu.dishes[1]!.priceCents).toBe(1110)
})

test('a missing price becomes null, never zero', async () => {
  // Zero is a price. A free dish and an unread price must not be the same value.
  const provider = createClaudeProvider({ model: 'm', create: async () => reply({ dishes: [{ name: 'a' }] }) })
  expect((await provider.extract(source)).dishes[0]!.priceCents).toBeNull()
})

test('malformed tool payloads are coerced, not trusted', async () => {
  const provider = createClaudeProvider({
    model: 'm',
    create: async () =>
      reply({
        sections: ['Primi', 42, null],
        dishes: [
          { name: '  Spaghetti  ', price: 'nine', ingredients: ['ok', 7, ''], section: '   ' },
          { name: '' },
          null,
        ],
      }),
  })
  const menu = await provider.extract(source)
  expect(menu.sections).toEqual(['Primi'])
  expect(menu.dishes).toHaveLength(1)
  expect(menu.dishes[0]!.name).toBe('Spaghetti')
  expect(menu.dishes[0]!.priceCents).toBeNull()
  expect(menu.dishes[0]!.ingredients).toEqual(['ok'])
  expect(menu.dishes[0]!.section).toBeNull()
})

test('a response with no tool call is BAD_OUTPUT (quality — it escalates)', async () => {
  const provider = createClaudeProvider({
    model: 'm',
    create: async () => ({ ...reply({}), content: [{ type: 'text', text: 'here is your menu' }] }) as Anthropic.Message,
  })
  await expect(provider.extract(source)).rejects.toMatchObject({ code: 'BAD_OUTPUT' })
})

test('a refusal is REQUEST_FAILED, and stop_reason is checked before content', async () => {
  const provider = createClaudeProvider({
    model: 'm',
    create: async () => ({ ...reply({}), stop_reason: 'refusal', content: [] }) as Anthropic.Message,
  })
  await expect(provider.extract(source)).rejects.toMatchObject({ code: 'REQUEST_FAILED' })
})

test('a missing API key is NOT_CONFIGURED and FATAL', async () => {
  // The router must abort on this rather than escalate. Without the fatal bit,
  // an unconfigured primary silently promotes the fallback to production.
  const previous = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  try {
    const provider = createClaudeProvider({ model: 'm' })
    await expect(provider.extract(source)).rejects.toMatchObject({ code: 'NOT_CONFIGURED', fatal: true })
  } finally {
    if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous
  }
})

test('images and PDFs go before the instruction text block', async () => {
  let seen: Anthropic.MessageCreateParamsNonStreaming | null = null
  const provider = createClaudeProvider({
    model: 'm',
    create: async (p) => {
      seen = p
      return reply({ dishes: [{ name: 'a', price: 1 }] })
    },
  })
  await provider.extract({
    images: [{ base64: 'aGk=', mediaType: 'image/jpeg' }],
    pdfs: [{ base64: 'cGRm' }],
    text: null,
  })
  const params = seen as unknown as Anthropic.MessageCreateParamsNonStreaming
  const content = params.messages[0]!.content as Anthropic.ContentBlockParam[]
  expect(content.map((b) => b.type)).toEqual(['document', 'image', 'text'])
})

test('a re-prompt carries the instruction AND the prior extraction', async () => {
  // This is what makes review a loop rather than a form: the reviewer corrects
  // the model's framing, and the model sees what it got wrong.
  let seen: Anthropic.MessageCreateParamsNonStreaming | null = null
  const provider = createClaudeProvider({
    model: 'm',
    create: async (p) => {
      seen = p
      return reply({ dishes: [{ name: 'a', price: 1 }] })
    },
  })
  await provider.extract({
    images: [], pdfs: [], text: 'x',
    instructions: 'i prezzi della gastronomia sono al kg',
    previousResult: { sections: [], dishes: [] },
  })
  const params = seen as unknown as Anthropic.MessageCreateParamsNonStreaming
  const text = (params.messages[0]!.content as Anthropic.ContentBlockParam[]).at(-1) as Anthropic.TextBlockParam
  expect(text.text).toContain('al kg')
  expect(text.text).toContain('Estrazione precedente')
})
