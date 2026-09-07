import { ExtractionError, type ExtractedDish, type ExtractedMenu, type ExtractionProvider, type MenuSource } from '../domain/types'

// A deterministic stand-in for a model, so the whole pipeline runs with NO API
// key and NO spend. This matters for a demo people are meant to actually run:
// an extraction repo that needs a funded account to show anything is a repo
// nobody evaluates.
//
// IT IS NOT AN EXTRACTOR. It parses one known text layout with line rules. Real
// input is a photograph of a laminated card at an angle under a warm bulb, which
// is exactly why the real path is a vision model. What this reproduces
// faithfully is the SHAPE of a model's output — including its characteristic
// mistakes, so the review queue has something real to catch:
//
//   * a line read twice          -> DUPLICATE_NAME
//   * a dish with no price       -> MISSING_PRICE
//   * "al kg" missed as per-kg   -> PER_KG_AMBIGUOUS
//
// Those are not contrived. They are the three errors this pipeline produced most
// often in production.

const PRICE = /(\d{1,3})[,.](\d{2})\s*(€\s*\/\s*kg|\/\s*kg|al\s*kg)?\s*$/i

/** Only `€/kg` and `/kg` are recognised — the bare Italian "al kg" is MISSED on
 *  purpose, mirroring a real miss the reviewer then has to catch. */
const PER_KG = /(€\s*\/\s*kg|\/\s*kg)\s*$/i

function isSectionHeader(line: string): boolean {
  const t = line.trim()
  if (t.length === 0 || PRICE.test(t)) return false
  const letters = t.replace(/[^a-zA-ZÀ-ÿ]/g, '')
  return letters.length >= 3 && letters === letters.toUpperCase() && !t.includes('....')
}

function parseLine(line: string, section: string | null): ExtractedDish | null {
  const raw = line.trim()
  if (raw.length === 0) return null

  const priceMatch = raw.match(PRICE)
  const pricePerKg = PER_KG.test(raw)
  const priceCents = priceMatch ? Number(priceMatch[1]) * 100 + Number(priceMatch[2]) : null

  // Strip the price tail and the dot leaders, then split name from ingredients on
  // the run of whitespace a printed menu uses as a column gutter.
  let body = raw.replace(PRICE, '').replace(/[.\s]*$/, '').trim()
  if (body.length === 0) return null

  let name = body
  let ingredients: string[] = []
  const gutter = body.match(/^(.+?)\s{2,}(.+)$/)
  if (gutter?.[1] && gutter[2]) {
    name = gutter[1].trim()
    ingredients = gutter[2]
      .split(',')
      .map((s) => s.replace(/[.\s]*$/, '').trim())
      .filter(Boolean)
  }
  name = name.replace(/[.\s]*$/, '').trim()
  if (name.length === 0) return null

  // A price-less trailing note ("prezzo secondo disponibilità") is not an
  // ingredient list — it is the reason there is no price.
  if (priceCents === null && ingredients.length > 0 && /prezzo|disponibil/i.test(ingredients.join(' '))) {
    ingredients = []
  }

  return { name, priceCents, pricePerKg, section, ingredients, description: null }
}

export function createFixtureProvider(name = 'fixture'): ExtractionProvider {
  return {
    name,
    async extract(source: MenuSource): Promise<ExtractedMenu> {
      if (!source.text) {
        throw new ExtractionError('BAD_OUTPUT', 'the fixture provider only reads text sources', name)
      }

      const sections: string[] = []
      const dishes: ExtractedDish[] = []
      let current: string | null = null

      for (const line of source.text.split('\n')) {
        if (line.trim().startsWith('---') || line.trim().length === 0) continue
        if (isSectionHeader(line)) {
          const header = line.trim()
          // The restaurant's own name is a shouty line too, and it is not a section.
          if (dishes.length === 0 && sections.length === 0 && !/antipasti|primi|secondi|dolci|gastronomia/i.test(header)) continue
          current = header
          if (!sections.includes(header)) sections.push(header)
          continue
        }
        const dish = parseLine(line, current)
        if (dish) dishes.push(dish)
      }

      return { sections, dishes }
    },
  }
}
