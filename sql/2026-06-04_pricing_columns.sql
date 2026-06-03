-- p1_172 — Pricing Setup: cost detail + tier pricing columns.
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS cost_rmb NUMERIC(10,2);
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(6,4) DEFAULT 0.60;
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS shipping_cost_rm NUMERIC(10,2) DEFAULT 0;
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS handling_pct NUMERIC(5,2) DEFAULT 5;
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS price_rrp NUMERIC(10,2);
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS price_kedai NUMERIC(10,2);
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS price_marketplace NUMERIC(10,2);
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS markup_kedai_pct NUMERIC(5,2) DEFAULT 30;
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS markup_marketplace_pct NUMERIC(5,2) DEFAULT 40;
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS kedai_discount_pct NUMERIC(5,2) DEFAULT 20;
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS price_set_by TEXT;
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS price_set_at TIMESTAMPTZ;
