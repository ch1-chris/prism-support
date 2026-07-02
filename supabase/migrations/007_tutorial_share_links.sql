-- Opaque magic links for one-click gallery access (admin-generated, per tutorial + brand).

CREATE TABLE tutorial_share_links (
  id           BIGSERIAL PRIMARY KEY,
  token        TEXT NOT NULL UNIQUE,
  tutorial_id  BIGINT NOT NULL REFERENCES tutorials(id) ON DELETE CASCADE,
  brand_id     BIGINT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX tutorial_share_links_token_idx ON tutorial_share_links (token);
