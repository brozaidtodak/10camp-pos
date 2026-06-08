-- p1_479 — manual stock movements (ambilan/display/rosak/restock) recorded from
-- Inventory History. Add reason/staff/note context to the movement ledger.
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS staff_name TEXT;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS note TEXT;
