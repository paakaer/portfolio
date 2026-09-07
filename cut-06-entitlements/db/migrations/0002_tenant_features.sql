-- Per-tenant feature enablement. THE SOLE RUNTIME SOURCE OF TRUTH.
--
-- One row per (tenant, feature). A feature with NO ROW defaults to OFF in the
-- loader — enablement is opt-in, and absence means "never turned on", not
-- "unknown". That default is why turning on a long-dark flag needs a backfill
-- (see 0004): flipping the code without seeding rows leaves every existing tenant
-- silently off.
--
-- Tenant-scoped, so it follows the isolation template: tenant_id + ENABLE + FORCE
-- + a fail-closed policy. Enablement is exactly the kind of row you must not be
-- able to read or write across a tenant boundary — it is the answer to "what is
-- this business paying for".
CREATE TABLE IF NOT EXISTS tenant_features (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id  uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  feature    text NOT NULL,
  enabled    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature),
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS tenant_features_tenant_id_idx ON tenant_features (tenant_id);

ALTER TABLE tenant_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_features FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_features_isolation ON tenant_features
  USING      (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);
