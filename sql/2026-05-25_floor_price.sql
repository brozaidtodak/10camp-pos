-- p1_109 — Floor price calculator columns.
-- Add to existing products_master table for tracking minimum sellable price per SKU.

ALTER TABLE public.products_master
    ADD COLUMN IF NOT EXISTS floor_price     NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS floor_margin_pct NUMERIC(5, 2),
    ADD COLUMN IF NOT EXISTS floor_set_by    TEXT,
    ADD COLUMN IF NOT EXISTS floor_set_at    TIMESTAMPTZ;

COMMENT ON COLUMN public.products_master.floor_price IS
    'Minimum sellable price (cost + margin). Cashier warning kalau jual bawah floor.';
COMMENT ON COLUMN public.products_master.floor_margin_pct IS
    'Margin % used to compute floor_price from cost_price. Stored for audit.';
COMMENT ON COLUMN public.products_master.floor_set_by IS
    'Staff name yang set floor price (audit trail).';
COMMENT ON COLUMN public.products_master.floor_set_at IS
    'Timestamp bila floor price terakhir di-set/update.';

CREATE INDEX IF NOT EXISTS products_master_floor_price_idx
    ON public.products_master (floor_price)
    WHERE floor_price IS NOT NULL;
