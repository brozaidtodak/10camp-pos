-- p1_493 — Stock Take 2nd check (double confirm). Fahmi counts (1st), Tarmizi/Kael
-- verifies (2nd, blind). System compares match/mismatch. Non-destructive add columns.
ALTER TABLE stock_check_session_items ADD COLUMN IF NOT EXISTS counted_qty_2 INTEGER;
ALTER TABLE stock_check_session_items ADD COLUMN IF NOT EXISTS counted_by_2_name TEXT;
ALTER TABLE stock_check_session_items ADD COLUMN IF NOT EXISTS counted_at_2 TIMESTAMPTZ;
