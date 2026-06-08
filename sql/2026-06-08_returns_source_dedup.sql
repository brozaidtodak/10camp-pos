-- p1_504 — Returns auto-pull dari Shopee/TikTok: dedup columns.
-- source = 'shopee' | 'tiktok' | 'manual'(null = manual lama)
-- external_id = channel return id (+ sku) supaya pull berulang tak double.
ALTER TABLE returns_log ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE returns_log ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Partial unique index: satu (source, external_id) sekali sahaja.
-- Manual entries (external_id NULL) tak terkesan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_returns_source_ext
  ON returns_log (source, external_id)
  WHERE external_id IS NOT NULL;
