-- A tenant table that OTHER tenant tables will reference. Note the extra
-- UNIQUE (tenant_id, id).
--
-- That index looks redundant — id is already the primary key. It is not. It is the
-- prerequisite for the composite foreign key form in 0005, and you want it on every
-- tenant table from day one: adding it later, across a schema where a dozen tables
-- already point at each other the wrong way, is the expensive version of the lesson
-- in 0005.
CREATE TABLE IF NOT EXISTS customer (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id  uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email      text NOT NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email),
  -- The referenced key for composite FKs. Do this on day one.
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS customer_tenant_id_idx ON customer (tenant_id);

ALTER TABLE customer ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer FORCE  ROW LEVEL SECURITY;

CREATE POLICY customer_isolation ON customer
  USING      (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);
