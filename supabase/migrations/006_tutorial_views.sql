-- Prism Support — Tutorial view logging
-- Run this in the Supabase SQL Editor after 005_brands.sql.

-- Records a "view" each time a tutorial video starts playing in the gallery.
-- tutorial_id / brand_id use ON DELETE SET NULL so history survives deletions;
-- tutorial_title / brand_name snapshot the names at view time so the activity
-- log stays readable even after the source row is removed.
CREATE TABLE tutorial_views (
  id             BIGSERIAL PRIMARY KEY,
  tutorial_id    BIGINT REFERENCES tutorials(id) ON DELETE SET NULL,
  brand_id       BIGINT REFERENCES brands(id) ON DELETE SET NULL,
  is_admin       BOOLEAN DEFAULT FALSE,
  session_id     TEXT,
  tutorial_title TEXT,
  brand_name     TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX tutorial_views_created ON tutorial_views (created_at);
CREATE INDEX tutorial_views_tutorial ON tutorial_views (tutorial_id);
