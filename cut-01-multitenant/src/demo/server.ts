// demo:serve — one server, one schema, one pool, two brands.
//
// There is no per-tenant code path in this file. Read it looking for a branch on
// which tenant it is: there is exactly one, and it is a colour lookup.

import { db } from '../index'
import { resolveTenantByHost } from '../tenant'
import { PALETTES } from './brands'

const PORT = Number(process.env.PORT ?? 4400)

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function page(tenant: { id: string; name: string; theme: string }, tagline: string, menu: [string, string][]) {
  const p = PALETTES[tenant.theme as keyof typeof PALETTES] ?? PALETTES.warm
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(tenant.name)}</title>
<style>
  :root { color-scheme: light }
  body { margin:0; background:${p.bg}; color:${p.ink};
         font:16px/1.6 ui-serif,Georgia,serif; }
  main { max-width:34rem; margin:0 auto; padding:4rem 1.5rem; }
  h1 { font-size:2.4rem; margin:0 0 .2rem; letter-spacing:-.02em }
  .tag { color:${p.accent}; font-style:italic; margin:0 0 2.5rem }
  ul { list-style:none; padding:0; margin:0 0 3rem }
  li { display:flex; justify-content:space-between; gap:1rem;
       padding:.7rem 0; border-bottom:1px solid ${p.rule} }
  .price { color:${p.accent}; font-variant-numeric:tabular-nums }
  footer { border-top:2px solid ${p.rule}; padding-top:1rem;
           font:12px/1.6 ui-monospace,monospace; color:${p.ink}; opacity:.65 }
  code { color:${p.accent} }
</style></head><body><main>
  <h1>${esc(tenant.name)}</h1>
  <p class="tag">${esc(tagline)}</p>
  <ul>${menu.map(([n, pr]) => `<li><span>${esc(n)}</span><span class="price">€ ${esc(pr)}</span></li>`).join('')}</ul>
  <footer>
    tenant &nbsp;<code>${esc(tenant.id)}</code><br>
    theme &nbsp;&nbsp;<code>${esc(tenant.theme)}</code> — a column, not a deploy<br>
    served by the same process, schema and pool as every other brand
  </footer>
</main></body></html>`
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const host = req.headers.get('host') ?? ''
    const tenant = await resolveTenantByHost(host)

    // An unknown host is a 404. It is NOT "the first tenant" or "the default
    // tenant" — a routing fallback in a multi-tenant system serves one customer's
    // data under another customer's brand.
    if (!tenant) {
      return new Response(
        `no tenant mapped to host "${host}"\n\n` +
          `try:  curl -H 'Host: bella.localhost' localhost:${PORT}\n` +
          `      curl -H 'Host: nova.localhost'  localhost:${PORT}\n`,
        { status: 404, headers: { 'content-type': 'text/plain' } },
      )
    }

    // Tenant-scoped. Note the absence of `WHERE tenant_id = ...` — RLS is applying
    // it. Forgetting the filter here yields zero rows, never another tenant's.
    const rows = await db.withTenant<{ key: string; value: string }[]>(tenant.id, (uow) =>
      uow.query<{ key: string; value: string }>`SELECT key, value FROM settings ORDER BY key`,
    )
    const tagline = rows.find((r) => r.key === 'tagline')?.value ?? ''
    const menu = rows
      .filter((r) => r.key.startsWith('menu:'))
      .map((r) => [r.key.slice(5), r.value] as [string, string])

    return new Response(page(tenant, tagline, menu), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  },
})

console.log(`\n  one process, two brands — http://localhost:${server.port}\n`)
console.log(`  http://bella.localhost:${server.port}   Trattoria Bella  (warm)`)
console.log(`  http://nova.localhost:${server.port}    Osteria Nova     (cool)\n`)
console.log(`  or without DNS:`)
console.log(`    curl -H 'Host: bella.localhost' localhost:${server.port}\n`)
