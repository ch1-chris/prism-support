-- Add category support to FAQ entries.
-- Categories are picked by Claude during the regenerate pass; nullable so old
-- rows (or rows where Claude omitted a category) fall under "General" client-side.

ALTER TABLE faq_entries
  ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS faq_entries_category_order
  ON faq_entries (category, display_order, id);
