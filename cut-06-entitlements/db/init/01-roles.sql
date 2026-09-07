-- Runs once, as the bootstrap superuser (POSTGRES_USER=quadro_owner).
--
-- THREE ROLES, and the split is the point:
--
--   quadro_owner     superuser. Owns the tables. Runs migrations. Never used at runtime.
--   quadro_app       NOT the owner, NOBYPASSRLS. Every tenant request. Cannot escape RLS.
--   quadro_platform  BYPASSRLS. Cross-tenant admin only.
--
-- The app role must not own the tables: a table owner bypasses row security unless
-- the table is FORCE'd. We do both (non-owner role AND FORCE) so that either one
-- alone would still hold the boundary.

CREATE ROLE quadro_app       LOGIN PASSWORD 'quadro_app_pw'      NOBYPASSRLS;
CREATE ROLE quadro_platform  LOGIN PASSWORD 'quadro_platform_pw' BYPASSRLS;

GRANT CONNECT ON DATABASE quadro TO quadro_app, quadro_platform;
GRANT USAGE   ON SCHEMA   public     TO quadro_app, quadro_platform;

-- Tables do not exist yet (migrations create them), so grant forward. These apply
-- to objects created BY quadro_owner in public — which is exactly what the migration
-- runner does.
ALTER DEFAULT PRIVILEGES FOR ROLE quadro_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quadro_app, quadro_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE quadro_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO quadro_app, quadro_platform;
