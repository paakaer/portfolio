-- The tenant registry. An `organization` row IS a tenant — provisioning a tenant
-- is this INSERT, not new infrastructure.
--
-- It has NO tenant_id column, because it does not belong to a tenant: it *is* the
-- tenant. So it scopes on `id` instead. That makes it invisible to a coverage query
-- that looks for tenant_id columns, which is why the test suite asserts it
-- separately. A table your coverage check cannot see is worse than one you forgot.
CREATE TABLE IF NOT EXISTS organization (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  theme      text NOT NULL DEFAULT 'warm',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization FORCE  ROW LEVEL SECURITY;

-- Self-scoped: a tenant sees exactly its own row and no other tenant's.
CREATE POLICY organization_isolation ON organization
  USING      (id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.tenant', true), '')::uuid);
