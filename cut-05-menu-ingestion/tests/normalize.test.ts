import { expect, test } from 'bun:test'
import { expandAbbreviations, isShouty, normalizeMenu, softTitle } from '../src/domain/normalize'

test('shouty text is re-cased, correctly-cased text is left alone', () => {
  expect(softTitle('TAGLIATELLE AL RAGU')).toBe('Tagliatelle al Ragu')
  // Already correct — must not be touched.
  expect(softTitle('Risotto ai funghi porcini')).toBe('Risotto ai funghi porcini')
})

test('Italian small words stay lowercase unless they lead', () => {
  expect(softTitle('GNOCCHI AL GORGONZOLA')).toBe('Gnocchi al Gorgonzola')
  expect(softTitle('AL FORNO')).toBe('Al Forno')
})

test("contraction prefixes title the word after the apostrophe", () => {
  expect(softTitle("PENNE ALL'ARRABBIATA")).toBe("Penne all'Arrabbiata")
})

test('isShouty ignores digits and punctuation', () => {
  expect(isShouty('TIRAMISU 6,00')).toBe(true)
  expect(isShouty('6,00')).toBe(false)
  expect(isShouty('Tiramisu')).toBe(false)
})

test('abbreviations expand, with or without the trailing dot', () => {
  expect(expandAbbreviations('pom. fresco')).toBe('pomodoro fresco')
  expect(expandAbbreviations('mozz e basil.')).toBe('mozzarella e basilico')
})

test('the dictionary contains only non-words, so real ingredients survive', () => {
  // "pane" and "pera" are real Italian words. A dictionary with real words in it
  // corrupts real menus, which is why every key is a non-word.
  expect(expandAbbreviations('pane')).toBe('pane')
  expect(expandAbbreviations('pera')).toBe('pera')
  expect(expandAbbreviations('parmigiano')).toBe('parmigiano')
})

test('normalizeMenu applies both passes and preserves everything else', () => {
  const out = normalizeMenu({
    sections: ['ANTIPASTI'],
    dishes: [
      {
        name: 'BRUSCHETTE AL POM.',
        priceCents: 650,
        pricePerKg: false,
        section: 'ANTIPASTI',
        ingredients: ['pom. fresco', 'BASIL.'],
        description: null,
      },
    ],
  })
  expect(out.sections).toEqual(['Antipasti'])
  expect(out.dishes[0]!.name).toBe('Bruschette al Pomodoro')
  expect(out.dishes[0]!.section).toBe('Antipasti')
  expect(out.dishes[0]!.ingredients).toEqual(['pomodoro fresco', 'basilico'])
  expect(out.dishes[0]!.priceCents).toBe(650)
})
