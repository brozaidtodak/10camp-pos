-- p1_525 — Resit: sokong sehingga 3 gambar bukti bayar per order.
-- payment_proof_urls = array JSONB; payment_proof_url kekal = gambar PERTAMA (backward compat
-- untuk semua reads sedia ada: badge, export resit, email, payment proofs list).
ALTER TABLE sales_history ADD COLUMN IF NOT EXISTS payment_proof_urls JSONB DEFAULT '[]'::jsonb;

-- backfill: masukkan proof tunggal sedia ada ke dalam array
UPDATE sales_history
SET payment_proof_urls = jsonb_build_array(payment_proof_url)
WHERE payment_proof_url IS NOT NULL
  AND payment_proof_url <> ''
  AND (payment_proof_urls IS NULL OR payment_proof_urls = '[]'::jsonb);
