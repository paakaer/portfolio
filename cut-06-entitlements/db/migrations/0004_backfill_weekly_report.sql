-- BACKFILL — the migration you must remember when you wire up a flag that has
-- been dark.
--
-- `weeklyReport` existed in the registry before anything read it. The moment its
-- read site ships, the loader's "absent row ⇒ off" default means every existing
-- tenant is silently off, with no row to flip and nothing in the admin UI to show
-- that a decision was ever available. New tenants get their rows at provisioning;
-- existing ones get them here, or never.
--
-- Migrations run as the OWNER role, which bypasses row security — which is what
-- lets this single statement read `organization` and write `tenant_features`
-- across every tenant. Neither the app role nor the platform role could do this
-- in one statement, and that asymmetry is deliberate: a cross-tenant write is a
-- migration-time privilege, not a runtime one.
--
-- Idempotent, and the ON CONFLICT is load-bearing: a re-run must never re-disable
-- a tenant who has since turned it on.
INSERT INTO tenant_features (tenant_id, feature, enabled)
SELECT id, 'weeklyReport', false
FROM organization
ON CONFLICT (tenant_id, feature) DO NOTHING;
