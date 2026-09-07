-- Runs once, as the bootstrap superuser (POSTGRES_USER=condo_owner).
--
-- THREE ROLES, and the split is the point:
--
--   condo_owner     superuser. Owns the tables. Runs migrations. Never used at runtime.
--   condo_app       NOT the owner, NOBYPASSRLS. Every tenant request. Cannot escape RLS.
--   condo_platform  BYPASSRLS. Cross-tenant admin only.
--
-- The app role must not own the tables: a table owner bypasses row security unless
-- the table is FORCE'd. We do both (non-owner role AND FORCE) so that either one
-- alone would still hold the boundary.

CREATE ROLE condo_app       LOGIN PASSWORD 'condo_app_pw'      NOBYPASSRLS;
CREATE ROLE condo_platform  LOGIN PASSWORD 'condo_platform_pw' BYPASSRLS;

GRANT CONNECT ON DATABASE condominio TO condo_app, condo_platform;
GRANT USAGE   ON SCHEMA   public     TO condo_app, condo_platform;

-- Tables do not exist yet (migrations create them), so grant forward. These apply
-- to objects created BY condo_owner in public — which is exactly what the migration
-- runner does.
ALTER DEFAULT PRIVILEGES FOR ROLE condo_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO condo_app, condo_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE condo_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO condo_app, condo_platform;
