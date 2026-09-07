-- Global feature maturity. A PLATFORM table: one row per feature for the whole
-- installation, NOT per tenant. It therefore carries no tenant_id and no RLS —
-- there is nothing tenant-specific to isolate, and every tenant's admin UI needs
-- to read it to render its warnings.
--
-- This table is ADVISORY. Nothing in the runtime resolution reads it. If you ever
-- find a query joining tenant_features to feature_maturity to decide whether a
-- capability is live, that is the bug this separation exists to prevent: it would
-- let an edit here switch off a tenant who deliberately opted into an alpha.
CREATE TABLE IF NOT EXISTS feature_maturity (
  feature    text PRIMARY KEY,
  maturity   text NOT NULL CHECK (maturity IN ('alpha', 'beta', 'mature', 'deprecated')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
