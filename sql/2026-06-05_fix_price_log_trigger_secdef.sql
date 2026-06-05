-- p1_306 — Fix: editing price/cost from the app errored.
-- Zaid: "dekat cost pulak yang tak boleh".
--
-- ROOT CAUSE: trigger log_product_price_change_trg (AFTER UPDATE OF price,
-- cost_price) runs log_product_price_change() which INSERTs into
-- product_price_history. The function was SECURITY INVOKER, so the insert ran as
-- the app's anon/authenticated role. product_price_history has RLS ON with no
-- INSERT policy for that role → insert blocked → the whole UPDATE failed. (Stock
-- worked because it doesn't touch price/cost; service-key writes bypass RLS.)
--
-- FIX: make the audit trigger SECURITY DEFINER so it logs as the owner,
-- bypassing RLS (standard pattern for audit-log triggers). Verified: anon PATCH
-- of products_master.cost_price now succeeds.

ALTER FUNCTION public.log_product_price_change() SECURITY DEFINER;
