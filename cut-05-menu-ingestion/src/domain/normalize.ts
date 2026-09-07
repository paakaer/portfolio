// Post-extraction text cleanup. Pure, no I/O.
//
// A model reading a printed menu transcribes it VERBATIM, which is what you want
// — and it means the extraction inherits every quirk of the paper. Restaurants
// print in ALL CAPS and abbreviate ingredients to fit the column ("pom.",
// "mozz."). Cleaning that here means the reviewer reads tidy text, and it stays
// OUT of the prompt, where "also tidy it up" would compete with "change nothing".
//
// Only ALL-CAPS strings are re-cased. Correctly-cased text is left alone, so a
// deliberate acronym survives.

/**
 * Italian articles, prepositions and contraction prefixes that stay lowercase in
 * a title unless they lead it — so "PENNE ALL'ARRABBIATA" titles as
 * "Penne all'Arrabbiata" and not "Penne All'arrabbiata".
 */
const SMALL_WORDS = new Set([
  'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra', 'e', 'ed', 'o', 'od',
  'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'all', 'del', 'dello', 'della',
  'dei', 'degli', 'delle', 'dell', 'dal', 'dalla', 'dai', 'col', 'coi', 'nel',
  'nella', 'nei', 'sul', 'sulla', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un',
  'uno', 'una', 'l', 'd', 'nell', 'sull', 'dall',
])

/**
 * Abbreviation → full word. Keys are deliberately NON-WORDS, so expanding one
 * can never clobber a real ingredient: "pom" is not Italian for anything, but
 * "pane" is, and a dictionary containing real words would corrupt real menus.
 */
const ABBREVIATIONS: Record<string, string> = {
  pom: 'pomodoro', pomo: 'pomodoro', pomod: 'pomodoro',
  mozz: 'mozzarella', moz: 'mozzarella',
  prosc: 'prosciutto', prosci: 'prosciutto',
  parm: 'parmigiano', parmig: 'parmigiano',
  gorg: 'gorgonzola',
  form: 'formaggi',
  pecor: 'pecorino',
  scamor: 'scamorza',
  melanz: 'melanzane',
  zucch: 'zucchine',
  carc: 'carciofi', carcio: 'carciofi',
  ricot: 'ricotta',
  basil: 'basilico',
  origan: 'origano',
  salsic: 'salsiccia',
  acciug: 'acciughe',
  cipoll: 'cipolla',
}

/** True when a string has cased letters and none are lowercase — i.e. shouting. */
export function isShouty(s: string): boolean {
  const letters = s.replace(/[^a-zà-öø-ÿA-ZÀ-ÖØ-Þ]/g, '')
  return letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()
}

function capitalizeWord(w: string): string {
  const apos = w.indexOf("'")
  if (apos > 0 && apos < w.length - 1 && SMALL_WORDS.has(w.slice(0, apos))) {
    return `${w.slice(0, apos + 1)}${w.charAt(apos + 1).toUpperCase()}${w.slice(apos + 2)}`
  }
  return w.charAt(0).toUpperCase() + w.slice(1)
}

/** Italian-aware title case. Only ever applied to shouty text. */
export function titleCase(s: string): string {
  let seenFirst = false
  return s
    .toLowerCase()
    .split(/(\s+)/) // keep the whitespace tokens so spacing survives
    .map((tok) => {
      if (tok.trim() === '') return tok
      const isFirst = !seenFirst
      seenFirst = true
      if (!isFirst && SMALL_WORDS.has(tok)) return tok
      return capitalizeWord(tok)
    })
    .join('')
}

/** Re-case only if the source was shouting; otherwise leave it exactly as printed. */
export function softTitle(s: string): string {
  return isShouty(s) ? titleCase(s) : s
}

/**
 * Both passes, in the order that works. ORDER MATTERS and getting it backwards
 * is silent:
 *
 *   expand first  -> "BRUSCHETTE AL POM." becomes "BRUSCHETTE AL pomodoro",
 *                    which is no longer all-caps, so the shouty check fails and
 *                    the title-case pass never runs. You get "BRUSCHETTE AL
 *                    pomodoro" shipped to a storefront.
 *
 * So: measure shoutiness on the ORIGINAL, then expand, then re-case.
 */
export function normalizeText(s: string): string {
  const shouty = isShouty(s)
  const expanded = expandAbbreviations(s)
  return shouty ? titleCase(expanded) : expanded
}

/** Expand known abbreviations. Trailing punctuation is stripped for the lookup. */
export function expandAbbreviations(s: string): string {
  return s.replace(/[\p{L}]+\.?/gu, (tok) => {
    const bare = tok.replace(/\.$/, '').toLowerCase()
    const full = ABBREVIATIONS[bare]
    if (!full) return tok
    // Preserve the source's capitalisation of the first letter.
    return tok[0] === tok[0]?.toUpperCase() && isShouty(tok) === false
      ? full.charAt(0).toUpperCase() + full.slice(1)
      : full
  })
}

import type { ExtractedMenu } from './types'

/** Apply both passes across a whole extraction. Pure — returns a new object. */
export function normalizeMenu(menu: ExtractedMenu): ExtractedMenu {
  return {
    sections: menu.sections.map(softTitle),
    dishes: menu.dishes.map((d) => ({
      ...d,
      name: normalizeText(d.name),
      section: d.section === null ? null : softTitle(d.section),
      ingredients: d.ingredients.map((i) => expandAbbreviations(i).toLowerCase().trim()).filter(Boolean),
      description: d.description === null ? null : normalizeText(d.description),
    })),
  }
}
