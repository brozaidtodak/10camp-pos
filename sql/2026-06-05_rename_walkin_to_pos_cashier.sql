-- p1_288 — Rename channel "Walk-in Kedai" → "POS Cashier" (full rename).
-- Zaid: "letak pos cashier dekat channel (walk in store - register purchase)"
--       → chose FULL rename incl. historical re-tag.
--
-- Code side (dropdowns, fallbacks, fee config, normalization maps) updated in the
-- same commit. This re-tags existing sales_history rows so reports/filters stay
-- consistent with the new canonical label.
--
-- Pre-count (2026-06-05): 2533 rows with channel='Walk-in Kedai'.
-- Reversible: swap the two strings to roll back.

UPDATE sales_history
SET channel = 'POS Cashier'
WHERE channel = 'Walk-in Kedai';

-- Verify:
-- SELECT channel, COUNT(*) FROM sales_history GROUP BY channel ORDER BY 2 DESC;
