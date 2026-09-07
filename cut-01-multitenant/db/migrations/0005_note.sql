-- THE COMPOSITE FOREIGN KEY. The most dangerous trap in shared-schema multi-tenancy,
-- and the reason this repo is documentation and not just code.
--
-- A foreign key constraint is checked as the REFERENCED table's owner, and that check
-- BYPASSES row level security. So the obvious column:
--
--     customer_id uuid REFERENCES customer(id)          -- WRONG. Do not do this.
--
-- lets tenant A create a row pointing at tenant B's customer. Walk it through:
--
--   * The WITH CHECK policy passes  — A wrote its own tenant_id on its own row.
--   * The FK check passes           — it cannot see the tenant boundary.
--   * Reads still look safe         — RLS hides the far side, so nobody notices.
--
-- But the row IS cross-tenant, and it is load-bearing: ON DELETE CASCADE reaches
-- across it, and any legitimately unscoped path (a platform query, a report, a
-- background worker) dereferences it and returns tenant B's data inside tenant A's
-- result. The test suite proves this is blocked here.
--
-- The fix is structural, not disciplinary: put tenant_id inside the constraint so a
-- cross-tenant reference is not expressible.
CREATE TABLE IF NOT EXISTS note (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  -- Nullable so the SET NULL rule below has somewhere to go.
  customer_id uuid,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- The correct form. Requires UNIQUE (tenant_id, id) on customer — see 0004.
  --
  -- ON DELETE SET NULL (customer_id) — MIND THE COLUMN LIST. A bare `SET NULL` nulls
  -- EVERY column in the constraint, tenant_id included. That detaches the row from
  -- its tenant, and because the isolation policy then matches nothing, the row
  -- becomes invisible to everyone, forever. Naming the column is not a style
  -- preference.
  CONSTRAINT note_customer_fk
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customer (tenant_id, id)
    ON DELETE SET NULL (customer_id)
);

CREATE INDEX IF NOT EXISTS note_tenant_id_idx ON note (tenant_id);

ALTER TABLE note ENABLE ROW LEVEL SECURITY;
ALTER TABLE note FORCE  ROW LEVEL SECURITY;

CREATE POLICY note_isolation ON note
  USING      (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);
