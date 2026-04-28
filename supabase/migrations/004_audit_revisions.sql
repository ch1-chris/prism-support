-- Self-healing KB audit: persistent revision history so every audit-applied
-- change can be reverted, plus a stale-aware semantic search RPC.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One row per audit invocation. Used both as a "currently running" lock
-- (finished_at IS NULL) and as the parent record for revisions produced by
-- the run.
CREATE TABLE IF NOT EXISTS kb_audit_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  total_scanned   INTEGER NOT NULL DEFAULT 0,
  total_merged    INTEGER NOT NULL DEFAULT 0,
  total_deleted   INTEGER NOT NULL DEFAULT 0,
  total_skipped   INTEGER NOT NULL DEFAULT 0,
  summary         TEXT,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS kb_audit_runs_started ON kb_audit_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS kb_audit_runs_inflight ON kb_audit_runs (started_at)
  WHERE finished_at IS NULL;

-- Pre-change snapshots for every row touched by an audit. The snapshot is the
-- full kb_entries row as JSON so a deleted entry can be reinserted verbatim.
-- entry_id has no FK because merge_delete revisions outlive their entry.
CREATE TABLE IF NOT EXISTS kb_entry_revisions (
  id               BIGSERIAL PRIMARY KEY,
  audit_run_id     UUID REFERENCES kb_audit_runs(id) ON DELETE SET NULL,
  entry_id         BIGINT NOT NULL,
  paired_entry_id  BIGINT,
  operation        TEXT NOT NULL CHECK (operation IN ('merge_update', 'merge_delete')),
  snapshot         JSONB NOT NULL,
  reason           TEXT,
  summary          TEXT,
  reverted_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_entry_revisions_run ON kb_entry_revisions (audit_run_id, created_at);
CREATE INDEX IF NOT EXISTS kb_entry_revisions_entry ON kb_entry_revisions (entry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kb_entry_revisions_recent ON kb_entry_revisions (created_at DESC);

-- Replace match_kb_entries so semantically-retrieved results never include
-- entries that were flagged stale outside the audit (e.g. by a future
-- workflow). The audit itself fully resolves contradictions, so this is
-- defense in depth.
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
    AND (is_stale IS NULL OR is_stale = FALSE)
    AND (filter_version IS NULL OR version IN (filter_version, 'latest'))
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
