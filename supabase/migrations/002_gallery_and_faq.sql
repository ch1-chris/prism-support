-- Prism Support — Gallery (tutorial videos) + FAQ tables
-- Run this in the Supabase SQL Editor after 001_initial.sql.

-- Tutorial videos shown on the public /gallery page and managed in the admin panel.
CREATE TABLE tutorials (
  id            BIGSERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  video_url     TEXT NOT NULL,
  thumbnail_url TEXT,
  category      TEXT,
  display_order INT DEFAULT 0,
  published     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX tutorials_published_order
  ON tutorials (published, display_order, created_at DESC);

-- FAQ entries regenerated from kb_entries by an admin-triggered Claude pass.
-- The whole table is wiped and replaced on every refresh.
CREATE TABLE faq_entries (
  id             BIGSERIAL PRIMARY KEY,
  question       TEXT NOT NULL,
  answer         TEXT NOT NULL,
  source_kb_ids  BIGINT[] DEFAULT '{}',
  display_order  INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX faq_entries_order ON faq_entries (display_order, id);
