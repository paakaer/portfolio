/**
 * Two invented brands. Note what is NOT here: any per-brand code path. A theme is a
 * row value the storefront reads at request time, so one container serves every
 * tenant and onboarding the third brand is an INSERT, not a deploy.
 */
export interface Brand {
  slug: string
  name: string
  host: string
  theme: 'warm' | 'cool'
  tagline: string
  menu: Array<{ name: string; price: string }>
}

export const BRANDS: Brand[] = [
  {
    slug: 'trattoria-bella',
    name: 'Trattoria Bella',
    host: 'bella.localhost',
    theme: 'warm',
    tagline: 'Cucina casalinga dal 1974',
    menu: [
      { name: 'Tagliatelle al ragù', price: '12,00' },
      { name: 'Scaloppine al limone', price: '14,50' },
      { name: 'Tiramisù della casa', price: '6,00' },
    ],
  },
  {
    slug: 'osteria-nova',
    name: 'Osteria Nova',
    host: 'nova.localhost',
    theme: 'cool',
    tagline: 'Small plates, natural wine',
    menu: [
      { name: 'Vitello tonnato', price: '13,00' },
      { name: 'Risotto alle erbe', price: '15,00' },
      { name: 'Sorbetto al bergamotto', price: '5,50' },
    ],
  },
]

export const PALETTES = {
  warm: { bg: '#fdf6ec', ink: '#3d2b1f', accent: '#b4451f', rule: '#e8d5bd' },
  cool: { bg: '#f2f6f8', ink: '#1c2b33', accent: '#1f6f8b', rule: '#d3e0e6' },
} as const
