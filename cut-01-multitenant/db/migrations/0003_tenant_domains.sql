-- Host -> tenant routing. A PLATFORM table, read BEFORE any tenant context exists:
-- resolving *which* tenant is the whole point, so it cannot itself be scoped to one.
--
-- It carries a tenant_id and deliberately has NO RLS. That is a real exception, and
-- exceptions like this are how a leak gets introduced by someone in a hurry — so the
-- name is listed explicitly in the coverage test's exception set, with a written
-- justification. Adding a name to that set shows up in a diff and gets reviewed as
-- the security decision it is.
--
-- Hosts are public routing information. There is nothing here a competitor could not
-- learn with a DNS lookup.
CREATE TABLE IF NOT EXISTS tenant_domains (
  host       text PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  kind       text NOT NULL DEFAULT 'subdomain',  -- subdomain | custom | alias
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_domains_tenant_id_idx ON tenant_domains (tenant_id);
