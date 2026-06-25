-- 2026-06-25 — B2B per-company negotiated price list.
-- Setiap B2B customer (customers.is_b2b = true) boleh ada harga rundingan sendiri
-- per SKU. Cashier auto-guna harga ni bila customer B2B di-attach ke cart.
-- min_qty: harga khas hanya apply bila qty cart >= min_qty (default 1 = sentiasa).
--
-- Model akses = sama macam customers/payment-proofs: POS staff login via PIN guna
-- anon key, jadi policy mesti benarkan role `public` (anon) untuk read+write.
-- App dalaman dipercayai (rujuk payment_proofs_public_insert).

CREATE TABLE IF NOT EXISTS public.b2b_price_list (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    sku         TEXT NOT NULL,
    unit_price  NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    min_qty     INTEGER NOT NULL DEFAULT 1 CHECK (min_qty >= 1),
    note        TEXT,
    set_by      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, sku)
);

COMMENT ON TABLE public.b2b_price_list IS
    'Harga rundingan per B2B customer per SKU. Cashier guna bila customer B2B attached.';
COMMENT ON COLUMN public.b2b_price_list.unit_price IS
    'Harga seunit khas untuk customer ni (ganti products_master.price di cashier).';
COMMENT ON COLUMN public.b2b_price_list.min_qty IS
    'Kuantiti minimum sebelum harga khas apply. 1 = sentiasa.';
COMMENT ON COLUMN public.b2b_price_list.set_by IS
    'Nama staff yang set/update harga (audit trail).';

ALTER TABLE public.b2b_price_list ENABLE ROW LEVEL SECURITY;

-- service_role penuh (backend/admin tools)
DROP POLICY IF EXISTS "service_role_all_b2b_price_list" ON public.b2b_price_list;
CREATE POLICY "service_role_all_b2b_price_list" ON public.b2b_price_list
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- public (anon-key POS staff) read+write — konsisten dgn model POS dalaman dipercayai
DROP POLICY IF EXISTS "public_read_b2b_price_list" ON public.b2b_price_list;
CREATE POLICY "public_read_b2b_price_list" ON public.b2b_price_list
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "public_insert_b2b_price_list" ON public.b2b_price_list;
CREATE POLICY "public_insert_b2b_price_list" ON public.b2b_price_list
    FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "public_update_b2b_price_list" ON public.b2b_price_list;
CREATE POLICY "public_update_b2b_price_list" ON public.b2b_price_list
    FOR UPDATE TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_delete_b2b_price_list" ON public.b2b_price_list;
CREATE POLICY "public_delete_b2b_price_list" ON public.b2b_price_list
    FOR DELETE TO public USING (true);

CREATE INDEX IF NOT EXISTS b2b_price_list_customer_idx
    ON public.b2b_price_list (customer_id);
CREATE INDEX IF NOT EXISTS b2b_price_list_sku_idx
    ON public.b2b_price_list (sku);

-- Rollback:
-- DROP TABLE IF EXISTS public.b2b_price_list;
