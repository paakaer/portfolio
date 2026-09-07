import { db } from './index'

export interface TenantRef {
  id: string
  slug: string
  name: string
  theme: string
}

/**
 * Lowercase and strip the port, so a Host header matches what is stored. Do this in
 * ONE place: a resolver that is case-sensitive in one code path and not another is a
 * tenant-routing bug waiting for the first email client that lowercases a link.
 */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().split(':')[0] ?? ''
}

/**
 * Resolve a Host header to its tenant. TWO STEPS, and the split is not incidental.
 *
 * THE TRAP: the obvious implementation is one query joining tenant_domains to
 * organization. It compiles, it reads correctly, and it ALWAYS RETURNS NULL — because
 * the join has to run in registry scope (there is no tenant context yet, that is what
 * we are establishing), `organization` is RLS-protected, and an RLS table read without
 * a tenant scope yields zero rows. The join silently matches nothing.
 *
 * That is fail-closed working exactly as designed, and it is the first thing every
 * newcomer to this codebase hits. It presents as "tenant resolution is broken", not as
 * a permissions error, because zero rows is not an error.
 *
 * So: step 1 reads the routing table (no RLS, by deliberate exception) to learn WHICH
 * tenant. Step 2 opens a tenant scope with that id and loads the tenant's own row
 * through RLS — which also means step 2 double-checks step 1, since the organization
 * policy is self-scoped on `id`.
 */
export async function resolveTenantByHost(host: string): Promise<TenantRef | null> {
  const normalized = normalizeHost(host)

  // Step 1 — registry scope. Routing information only.
  const [route] = await db.registry<{ tenant_id: string }[]>(
    (uow) => uow.query<{ tenant_id: string }>`
      SELECT tenant_id FROM tenant_domains WHERE host = ${normalized}
    `,
  )
  if (!route) return null

  // Step 2 — tenant scope. Everything from here on is inside the boundary.
  const [org] = await db.withTenant<TenantRef[]>(route.tenant_id, (uow) =>
    uow.query<TenantRef>`SELECT id, slug, name, theme FROM organization`,
  )
  return org ?? null
}
