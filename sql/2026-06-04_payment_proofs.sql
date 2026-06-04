-- 2026-06-04 — Payment proof upload + monitoring
-- Author: Zaid (10 CAMP owner), via Claude
-- Reason: Customers using non-cash (QR / Debit / Credit / SPayLater / E-Wallet)
--         provide payment confirmation (screenshot / receipt). Staff uploads
--         via checkout modal. Owner monitors via Reports → Payment Proofs.

BEGIN;

-- 1) Add payment-proof tracking columns to sales_history
ALTER TABLE public.sales_history
  ADD COLUMN IF NOT EXISTS payment_proof_url TEXT,
  ADD COLUMN IF NOT EXISTS payment_proof_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_proof_uploaded_by TEXT,
  ADD COLUMN IF NOT EXISTS payment_method_detail TEXT,
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_status TEXT;

-- 2) Create Storage bucket for payment proofs (public read so URLs work in reports)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'payment-proofs',
    'payment-proofs',
    true,
    5242880,  -- 5 MB cap per file
    ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf']
  )
  ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3) RLS policies on storage.objects for the payment-proofs bucket
-- Authenticated users can insert
DROP POLICY IF EXISTS "payment_proofs_authenticated_insert" ON storage.objects;
CREATE POLICY "payment_proofs_authenticated_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-proofs');

-- Authenticated users can update (re-upload corrections)
DROP POLICY IF EXISTS "payment_proofs_authenticated_update" ON storage.objects;
CREATE POLICY "payment_proofs_authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'payment-proofs');

-- Public can read (URLs in reports + receipts)
DROP POLICY IF EXISTS "payment_proofs_public_read" ON storage.objects;
CREATE POLICY "payment_proofs_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'payment-proofs');

-- 4) Helpful index for reports filtering
CREATE INDEX IF NOT EXISTS idx_sales_history_proof
  ON public.sales_history (payment_proof_uploaded_at DESC)
  WHERE payment_proof_url IS NOT NULL;

COMMIT;

-- Sanity check
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sales_history'
      AND column_name IN ('payment_proof_url','payment_proof_uploaded_at','payment_proof_uploaded_by','payment_method_detail','email_sent_at','email_status')) AS new_cols_added,
  (SELECT id FROM storage.buckets WHERE id='payment-proofs') AS bucket_id;
