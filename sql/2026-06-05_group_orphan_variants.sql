-- p1_302 — Group 9 clear orphan-variant sets into parent_sku (Zaid: "boleh kau
-- buat untuk produk2 lain?" → chose "auto-group yang jelas").
--
-- 65 products had no parent_sku; 11 looked like variant sets (shared name header
-- "XXX-YYY |"). Grouped the 9 self-contained ones; left 2 ambiguous
-- (BD091-143 → BD142/BD143, BD098-171 → BD151/BD171) because their header range
-- references SKUs already grouped under a different parent. parent_sku set to the
-- name header so the Collection/Inventory view collapses them to one card.
-- Variant labels (color/size) left null — data had none; PDP lists siblings by SKU.
-- Applied 2026-06-05 via Mgmt API: 24 rows, no_parent 65 → 41. Reversible.

UPDATE products_master
SET parent_sku = trim(split_part(name, '|', 1))
WHERE parent_sku IS NULL
  AND trim(split_part(name, '|', 1)) IN
   ('MX011-015','BD147-150','MX008-010','BD161-162','MX004-005','NH140-141','NH142-143','ST136-137','BD155-156');
