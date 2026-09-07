import type { Draft, ReviewItem } from '../domain/review'

const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const YEL = '\x1b[33m'
const GRN = '\x1b[32m'
const OFF = '\x1b[0m'

export function euro(cents: number | null): string {
  return cents === null ? '     —' : `€${(cents / 100).toFixed(2)}`.padStart(6)
}

export function renderItem(item: ReviewItem, index: number): string {
  const blocking = item.flags.some((f) => f.blocking) && !item.resolved
  const mark = item.resolved ? `${GRN}✓${OFF}` : blocking ? `${RED}!${OFF}` : ' '
  const kg = item.dish.pricePerKg ? `${DIM}/kg${OFF}` : '   '
  const section = item.dish.section ?? '—'

  const lines = [
    `  ${mark} ${String(index).padStart(2)}  ${euro(item.dish.priceCents)} ${kg}  ${item.dish.name.padEnd(34)} ${DIM}${section}${OFF}`,
  ]
  for (const f of item.flags) {
    const colour = f.blocking ? RED : YEL
    lines.push(`         ${colour}${f.code}${OFF} ${DIM}${f.detail}${OFF}`)
  }
  return lines.join('\n')
}

export function renderDraft(draft: Draft): string {
  const out: string[] = []
  out.push('')
  out.push(`  draft ${draft.id}   provider: ${draft.provider}   ${draft.items.length} dishes`)
  if (draft.escalations.length > 0) {
    out.push(`  ${DIM}escalations: ${draft.escalations.join(' → ')}${OFF}`)
  }
  out.push('')
  draft.items.forEach((item, i) => out.push(renderItem(item, i)))
  out.push('')
  return out.join('\n')
}
