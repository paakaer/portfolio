-- THE TEMPLATE. Copy this file verbatim for every new tenant-scoped table.
--
-- Four required parts:
--   1. tenant_id uuid NOT NULL REFERENCES organization(id)
--   2. ENABLE row level security
--   3. FORCE  row level security
--   4. A fail-closed isolation policy with BOTH `USING` and `WITH CHECK`
--
-- Plus UNIQUE (tenant_id, id) if anything will ever reference this table — see
-- 0004_customer.sql for why retrofitting that later is expensive.
CREATE TABLE IF NOT EXISTS settings (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id  uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE INDEX IF NOT EXISTS settings_tenant_id_idx ON settings (tenant_id);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings FORCE  ROW LEVEL SECURITY;

-- FAIL-CLOSED. Read it left to right:
--
--   current_setting('app.tenant', true)   -> NULL when unset (the `true` is missing_ok;
--                                            without it, an unset GUC RAISES)
--   nullif(..., '')                       -> NULL when set-but-empty
--   tenant_id = NULL                      -> matches NO rows
--
-- So an unscoped connection sees ZERO rows. Never all rows. That asymmetry is the
-- entire safety property: the failure mode of this policy is "you see nothing",
-- which is an outage, not a breach.
--
-- USING filters reads. WITH CHECK blocks writes. Without WITH CHECK a tenant can
-- INSERT a row stamped with someone else's tenant_id and never be able to read it
-- back — silent corruption instead of an error.
CREATE POLICY settings_isolation ON settings
  USING      (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);
