-- p1_309 — Unique indexes to prevent inbound order double-import (dedup race).
-- Shopee order can be imported by BOTH shopee-webhook (instant) and shopee-sync
-- (15-min cron). Their check-then-insert dedup is not atomic, so a race could
-- insert the same order twice → stock deducted twice. These partial unique
-- indexes make the 2nd insert fail (23505); the functions catch that and skip the
-- duplicate's stock deduction. TikTok/EasyStore added too (future-proofing).
-- No existing duplicates at creation time.

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_shopee_order_sn
  ON sales_history ((metadata->>'shopee_order_sn'))   WHERE metadata->>'shopee_order_sn'   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_tiktok_order_id
  ON sales_history ((metadata->>'tiktok_order_id'))   WHERE metadata->>'tiktok_order_id'   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_easystore_order_id
  ON sales_history ((metadata->>'easystore_order_id')) WHERE metadata->>'easystore_order_id' IS NOT NULL;
