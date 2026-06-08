-- p1_474 — Publish ke Products feature.
-- Track when a stock-check session's counts were published to master inventory.
-- Nullable; app swallows update errors if column missing (back-compat).
ALTER TABLE stock_check_sessions ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
