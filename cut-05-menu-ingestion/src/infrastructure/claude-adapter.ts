import Anthropic from '@anthropic-ai/sdk'
import { ExtractionError, type ExtractedDish, type ExtractedMenu, type ExtractionProvider, type MenuSource } from '../domain/types'

// The Claude-backed provider. ONE adapter handles every input a MenuSource can
// carry — images, PDFs, OCR'd text, and the reviewer's re-prompt.
//
// The vendor lives ONLY in this file. The domain, the router, the review queue
// and the CLI never import the SDK or name a model. Adding a second vendor is a
// sibling file plus one branch in providers.ts.

const TOOL_NAME = 'extract_menu'

/**
 * Two rules, and the second one is the whole prompt.
 *
 * A model that knows what goes in an amatriciana will write you an ingredient
 * list the restaurant never printed, and it will be a GOOD list — plausible,
 * well-formed, and indistinguishable downstream from one that was actually on
 * the page. That is worse than a blank field, because a blank field is visibly
 * missing and an invented one is not. The instruction is repeated per-field in
 * the schema below for the same reason.
 */
const SYSTEM_PROMPT = [
  'Leggi il menù di un ristorante da foto, PDF e/o testo. Estrai i piatti, le',
  'intestazioni di sezione e — quando sono STAMPATI accanto al piatto — i suoi',
  'ingredienti e la sua descrizione, esattamente come appaiono.',
  '',
  'REGOLA FONDAMENTALE: non inventare e non dedurre nulla. Trascrivi solo ciò che',
  'è scritto. In particolare gli ingredienti: NON immaginarli dal nome del piatto',
  '— riportali solo se elencati sul menù, altrimenti lascia la lista vuota. Lo',
  'stesso vale per la descrizione. Non aggiungere piatti che non sono stampati.',
  '',
  'I prezzi sono in euro. Alcuni piatti (gastronomia, salumi, dolci) sono venduti',
  'AL CHILO («€/kg», «al kg», «/kg»): in quei casi imposta pricePerKg=true e metti',
  'in price il prezzo al chilo.',
  '',
  'Se ricevi istruzioni di correzione e/o una estrazione precedente, correggi il',
  `risultato di conseguenza. Restituisci il risultato SOLO tramite lo strumento ${TOOL_NAME}.`,
].join('\n')

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Emetti i piatti e le sezioni estratti dal menù.',
  input_schema: {
    type: 'object',
    properties: {
      sections: {
        type: 'array',
        items: { type: 'string' },
        description: 'Intestazioni di sezione, in ordine di lettura.',
      },
      dishes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            price: { type: 'number', description: 'Prezzo in euro (es. 8.5). Ometti se non indicato.' },
            pricePerKg: { type: 'boolean', description: 'true se il prezzo è AL CHILO.' },
            section: { type: 'string' },
            ingredients: {
              type: 'array',
              items: { type: 'string' },
              description: 'SOLO se elencati sul menù. Non dedurli dal nome: se non sono stampati, lascia vuoto.',
            },
            description: { type: 'string', description: 'SOLO se stampata sul menù. Non inventarla.' },
          },
          required: ['name'],
        },
      },
    },
    required: ['dishes'],
  },
}

function buildContent(source: MenuSource): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = []

  // Documents and images first, then one text block. Putting the instruction
  // last keeps the (large, stable) media at the front of the prefix, which is
  // also where prompt caching wants it.
  for (const pdf of source.pdfs) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.base64 } })
  }
  for (const img of source.images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType as 'image/jpeg', data: img.base64 },
    })
  }

  const parts = ['Estrai i piatti e le sezioni da questo menù.']
  if (source.text) parts.push(`Testo del menù:\n${source.text}`)
  if (source.instructions) parts.push(`Istruzioni di correzione:\n${source.instructions}`)
  if (source.previousResult) parts.push(`Estrazione precedente da correggere:\n${JSON.stringify(source.previousResult)}`)
  content.push({ type: 'text', text: parts.join('\n\n') })

  return content
}

/** Coerce the tool payload into the domain shape. Never trust it structurally. */
function parseToolInput(input: unknown): ExtractedMenu {
  const obj = (input ?? {}) as Record<string, unknown>
  const rawDishes = Array.isArray(obj.dishes) ? obj.dishes : []
  const sections = Array.isArray(obj.sections) ? obj.sections.filter((s): s is string => typeof s === 'string') : []

  const dishes: ExtractedDish[] = []
  for (const raw of rawDishes) {
    const d = (raw ?? {}) as Record<string, unknown>
    const name = typeof d.name === 'string' ? d.name.trim() : ''
    if (name.length === 0) continue

    // Euro → cents via rounding, NOT truncation: 8.5 must become 850, and
    // floating point makes 11.1 * 100 = 1110.0000000000002.
    const price = typeof d.price === 'number' && Number.isFinite(d.price) ? Math.round(d.price * 100) : null

    dishes.push({
      name,
      priceCents: price,
      pricePerKg: d.pricePerKg === true,
      section: typeof d.section === 'string' && d.section.trim() ? d.section.trim() : null,
      ingredients: Array.isArray(d.ingredients)
        ? d.ingredients.filter((i): i is string => typeof i === 'string' && i.trim().length > 0).map((i) => i.trim())
        : [],
      description: typeof d.description === 'string' && d.description.trim() ? d.description.trim() : null,
    })
  }

  return { sections, dishes }
}

/** The narrow slice of the SDK this adapter needs — injectable for tests. */
export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>

export interface ClaudeProviderOptions {
  model: string
  name?: string
  /** Injected in tests so request-shaping and parsing are covered with no key. */
  create?: CreateMessage
  /** Adaptive thinking. Off for the cheap tier, which does not support it. */
  thinking?: boolean
  maxTokens?: number
}

export function createClaudeProvider(options: ClaudeProviderOptions): ExtractionProvider {
  const name = options.name ?? `claude:${options.model}`

  return {
    name,
    async extract(source: MenuSource): Promise<ExtractedMenu> {
      const create =
        options.create ??
        (async (params) => {
          const key = process.env.ANTHROPIC_API_KEY
          // NOT_CONFIGURED is fatal — the router aborts rather than escalating.
          // Silently falling through to another tier is exactly the bug this
          // repo is about.
          if (!key) throw new ExtractionError('NOT_CONFIGURED', 'ANTHROPIC_API_KEY is not set', name)
          return new Anthropic({ apiKey: key }).messages.create(params)
        })

      let message: Anthropic.Message
      try {
        message = await create({
          model: options.model,
          max_tokens: options.maxTokens ?? 16000,
          system: SYSTEM_PROMPT,
          tools: [TOOL],
          // Forced tool use: the only acceptable output is the structured one.
          tool_choice: { type: 'tool', name: TOOL_NAME },
          ...(options.thinking ? { thinking: { type: 'adaptive' as const } } : {}),
          messages: [{ role: 'user', content: buildContent(source) }],
        })
      } catch (err) {
        if (err instanceof ExtractionError) throw err
        // An auth failure is a broken deployment, not a weak model. Fatal, so
        // the router stops instead of quietly buying a more expensive answer.
        if (err instanceof Anthropic.AuthenticationError) {
          throw new ExtractionError('AUTH_FAILED', `authentication rejected: ${err.message}`, name)
        }
        throw new ExtractionError('REQUEST_FAILED', err instanceof Error ? err.message : String(err), name)
      }

      if (message.stop_reason === 'refusal') {
        throw new ExtractionError('REQUEST_FAILED', 'the model declined this request', name)
      }

      const block = message.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === TOOL_NAME,
      )
      if (!block) throw new ExtractionError('BAD_OUTPUT', `no ${TOOL_NAME} tool call in the response`, name)

      return parseToolInput(block.input)
    },
  }
}
