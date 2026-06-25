-- Prism Support — Brands (client accounts) + per-brand tutorial visibility
-- Run this in the Supabase SQL Editor after 004_audit_revisions.sql.

-- A "brand" is a client account. Each brand has one shared access code that a
-- client redeems in the gallery to unlock the tutorials assigned to them.
CREATE TABLE brands (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  access_code TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Many-to-many: a tutorial can be assigned to several brands, and a brand can
-- have many tutorials. Only consulted when a tutorial is not global.
CREATE TABLE tutorial_brands (
  tutorial_id BIGINT NOT NULL REFERENCES tutorials(id) ON DELETE CASCADE,
  brand_id    BIGINT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  PRIMARY KEY (tutorial_id, brand_id)
);

CREATE INDEX tutorial_brands_brand ON tutorial_brands (brand_id);

-- Global tutorials are visible to everyone (anonymous visitors and any brand).
-- Existing rows default to TRUE so current tutorials stay public.
-- A non-global tutorial with no rows in tutorial_brands is admin-only.
ALTER TABLE tutorials
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT TRUE;
