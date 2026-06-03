-- 2026-06-04 — Permanent removal of OutdoorExpo event SKUs from products_master
-- Author: Zaid (10 CAMP owner), via Claude
-- Reason: Event SKUs were temporary EasyStore groupings for past OutdoorExpo event.
--         Most unpublished, all RM placeholder prices, cluttered Pricing Setup
--         Senarai Produk and other staff list views.
-- Pre-flight: 142 products_master rows matched (across 6 parent groups:
--             CHANODUG 28, SHINETRIP 34, LFO 22, MOUNTAINHIKER 17,
--             MOBI-GARDEN 30, VIDALIDO 11).
-- Cascade impact: 134 inventory_batches + 1 inventory_transactions auto-deleted
--                 via FK ON DELETE CASCADE constraint.
-- Unaffected: 156 sales_history rows referencing expo SKUs in items JSONB
--             keep their name/price/qty snapshots — historical receipts intact.

BEGIN;

-- Snapshot count BEFORE delete (sanity)
DO $$
DECLARE
  before_pm INT;
  before_ib INT;
BEGIN
  SELECT count(*) INTO before_pm FROM public.products_master
    WHERE upper(coalesce(parent_sku,'')) LIKE '%OUTDOOREXPO%'
       OR upper(coalesce(name,'')) LIKE '%OUTDOOR EXPO%'
       OR upper(coalesce(sku,'')) LIKE '%OUTDOOREXPO%';
  SELECT count(*) INTO before_ib FROM public.inventory_batches ib
    WHERE EXISTS (SELECT 1 FROM public.products_master pm
                  WHERE pm.sku = ib.sku
                    AND (upper(coalesce(pm.parent_sku,'')) LIKE '%OUTDOOREXPO%'
                         OR upper(coalesce(pm.name,'')) LIKE '%OUTDOOR EXPO%'
                         OR upper(coalesce(pm.sku,'')) LIKE '%OUTDOOREXPO%'));
  RAISE NOTICE 'BEFORE delete: products_master=%, inventory_batches(linked)=%', before_pm, before_ib;
END $$;

-- Hard delete (CASCADE picks up inventory_batches + inventory_transactions)
DELETE FROM public.products_master
WHERE upper(coalesce(parent_sku,'')) LIKE '%OUTDOOREXPO%'
   OR upper(coalesce(name,'')) LIKE '%OUTDOOR EXPO%'
   OR upper(coalesce(sku,'')) LIKE '%OUTDOOREXPO%';

-- Verify cleanup
DO $$
DECLARE
  after_pm INT;
  after_ib INT;
BEGIN
  SELECT count(*) INTO after_pm FROM public.products_master
    WHERE upper(coalesce(parent_sku,'')) LIKE '%OUTDOOREXPO%'
       OR upper(coalesce(name,'')) LIKE '%OUTDOOR EXPO%'
       OR upper(coalesce(sku,'')) LIKE '%OUTDOOREXPO%';
  SELECT count(*) INTO after_ib FROM public.inventory_batches
    WHERE sku ILIKE '%OUTDOOREXPO%';
  RAISE NOTICE 'AFTER delete: products_master=%, inventory_batches(orphan)=%', after_pm, after_ib;
END $$;

COMMIT;
