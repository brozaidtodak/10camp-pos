-- 2026-06-04 — Add image_url snapshot to stock_check_session_items
-- Reason: staff need visual ref untuk elakkan salah barang ketika count.
--         Snapshot at session create time (denormalized) — kalau master image
--         tukar lepas tu, history sesi kekal tunjuk image masa kira.

BEGIN;

ALTER TABLE public.stock_check_session_items
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- (Optional backfill) — current active sessions akan dapat image dari master.
-- Uncomment kalau Zaid nak fill existing rows:
-- UPDATE public.stock_check_session_items sci
-- SET image_url = (
--   SELECT pm.images->>0 FROM public.products_master pm WHERE pm.sku = sci.sku LIMIT 1
-- )
-- WHERE sci.image_url IS NULL;

COMMIT;

SELECT
  column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'stock_check_session_items'
  AND column_name = 'image_url';
