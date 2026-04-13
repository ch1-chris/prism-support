-- Prism Support — Initial Database Schema
-- Run this in the Supabase SQL Editor after enabling the vector extension.

CREATE EXTENSION IF NOT EXISTS vector;

-- Knowledge base entries with structured schema
CREATE TABLE kb_entries (
  id                BIGSERIAL PRIMARY KEY,
  title             TEXT NOT NULL,
  feature_name      TEXT,
  ui_location       TEXT,
  how_to_access     TEXT,
  keyboard_shortcut TEXT,
  content           TEXT NOT NULL,
  file_url          TEXT,
  common_issues     TEXT,
  related_features  TEXT[],
  source            TEXT NOT NULL,
  version           TEXT DEFAULT 'latest',
  embedding         vector(1024),
  is_stale          BOOLEAN DEFAULT FALSE,
  stale_reason      TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  title_content_fts tsvector GENERATED ALWAYS AS (
    to_tsvector('english', COALESCE(title,'') || ' ' || COALESCE(content,''))
  ) STORED
);

CREATE INDEX kb_entries_fts ON kb_entries USING gin(title_content_fts);

CREATE INDEX kb_entries_embedding ON kb_entries
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX kb_entries_version ON kb_entries (version);
CREATE INDEX kb_entries_source ON kb_entries (source);
CREATE INDEX kb_entries_stale ON kb_entries (is_stale) WHERE is_stale = TRUE;

-- Semantic search RPC for pgvector nearest-neighbor lookup
CREATE OR REPLACE FUNCTION match_kb_entries(
  query_embedding vector(1024),
  match_count int DEFAULT 5,
  filter_version text DEFAULT NULL
)
RETURNS SETOF kb_entries
LANGUAGE sql STABLE
AS $$
  SELECT *
  FROM kb_entries
  WHERE embedding IS NOT NULL
    AND (filter_version IS NULL OR version IN (filter_version, 'latest'))
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Chat sessions
CREATE TABLE chat_sessions (
  id          TEXT PRIMARY KEY,
  app_version TEXT,
  language    TEXT DEFAULT 'en',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Chat messages with feedback tracking
CREATE TABLE chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  follow_ups  TEXT[],
  feedback    SMALLINT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX chat_messages_session ON chat_messages (session_id, created_at);

-- Analytics events
CREATE TABLE analytics_events (
  id          BIGSERIAL PRIMARY KEY,
  question    TEXT NOT NULL,
  session_id  TEXT,
  matched_kb  BIGINT[],
  had_answer  BOOLEAN,
  feedback    SMALLINT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX analytics_events_created ON analytics_events (created_at);

-- Support tickets
CREATE TABLE support_tickets (
  id              BIGSERIAL PRIMARY KEY,
  session_id      TEXT REFERENCES chat_sessions(id),
  conversation    JSONB NOT NULL,
  user_summary    TEXT,
  status          TEXT DEFAULT 'open',
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX support_tickets_status ON support_tickets (status);

-- KB test cases for regression testing
CREATE TABLE kb_test_cases (
  id              BIGSERIAL PRIMARY KEY,
  question        TEXT NOT NULL,
  expected_answer TEXT NOT NULL,
  last_result     TEXT,
  last_actual     TEXT,
  last_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- App settings
CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Session table for connect-pg-simple
CREATE TABLE session (
  sid     VARCHAR NOT NULL PRIMARY KEY,
  sess    JSON NOT NULL,
  expire  TIMESTAMPTZ NOT NULL
);

CREATE INDEX session_expire_idx ON session (expire);
