# Bug & Security Review — Pos-System-Test

Date: 2026-06-14 · Reviewed by Claude Code (3 parallel review agents: backend, core logic, secrets/SQL).
Scope: `netlify/functions/`, `app.js`, `index.html`, `sql/`, config. Throwaway `*.py` patch scripts not reviewed.

Severity: 🔴 Critical · 🟠 High · 🟡 Medium

---

## 🔴 CRITICAL — Security

### C1. Mutating Netlify functions are public + unauthenticated, running with the Supabase service-role key
No function checks a caller token, shared secret, or HMAC. Anyone can call them:
- `netlify/functions/shopee-disconnect.js:62-68` — unauthenticated POST deletes ALL Shopee tokens for the env. Worse, `payload.shop_id` is interpolated raw into a PostgREST filter → `{"shop_id":"gt.0"}` produces `?shop_id=gt.0`, mass-deleting all rows regardless of env. GET branch leaks shop_id/partner_id.
- `netlify/functions/marketplace-price-push.js:93-243` — `?mode=push` rewrites LIVE Shopee+TikTok prices for ~600 listings.
- `shopee-stock-push.js`, `shopee-stock-sync.js?mode=push`, `tiktok-stock-push.js`, `tiktok-stock-sync.js?mode=push` — overwrite live marketplace stock from POS numbers (oversell/undersell).
- `settlement-recon-background.js:158`, `price-sentinel-background.js:171/174`, `tiktok-coupon-sync.js:71-72` — a bare GET defaults to destructive `mode=sync` that DELETEs + rewrites whole tables.
- `marketplace-settings.js:32-44` — unauthenticated POST writes the pricing markup config used by price-push.
- `returns-pull.js:264-266` — cron vs public requests indistinguishable; bare GET runs a live import; `?mode=dryrun` leaks raw marketplace return data.

**Fix direction:** add a shared auth gate (secret header / Netlify Identity / Supabase JWT) to every non-webhook function; treat webhook signature checks as mandatory. ARCHITECTURAL — needs owner decision (app currently uses an "anon-trusted" model with PIN login, so there may be no user JWT to check).

### C2. shopee-webhook.js:226-241 — signature computed but never enforced
On sign mismatch it logs `"sign unverified — processed via API re-fetch (safe)"` and continues. Mitigated (order data re-fetched from Shopee's authenticated API, so no data injection) but still allows endpoint spam → unbounded Shopee API calls / token refreshes (cost + quota DoS). Contrast: `easystore-webhook.js:55-63` does correct HMAC + `timingSafeEqual` (only weakness: skipped entirely if `APP_SECRET` unset).

### C3. easystore-push.js:24 & easystore-webhook.js:23 — hardcoded Supabase anon JWT committed as fallback
`const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbG...'` ships a working anon credential (ref `asehjdnfzoypbwfeazra`, exp 2091) in source. Should be env-only and rotated. (Hardcoded URL fallback elsewhere is non-secret and fine.)

### C4. Supabase anon key + permissive RLS = sensitive data exposed
The whole app (`app.js:2/9`, index.html, APK) does direct client-side CRUD via the anon key. Security depends on RLS, but several policies are effectively public:
- `sql/2026-06-06_cost_shipment_calculator.sql:36-43` — `for all to public using(true) with check(true)` + `grant all to anon` on `cost_shipments`/`cost_shipment_items` (sensitive margin/cost data).
- `sql/2026-06-06_payment_proofs_public_insert.sql:8-13` — `payment_proofs` bucket grants INSERT+UPDATE to public (anon can upload/overwrite payment proofs).
- `sql/2026-06-04_receipts_bucket.sql:35-38` — `receipts` bucket world-readable (customer PII if paths guessable).
- `sql/2026-06-05_fix_price_log_trigger_secdef.sql` + `2026-06-06_price_history_actor.sql` — anon can write `products_master.cost_price`/`price`; audit actor is client-supplied `last_modified_by` → spoofable.
- Multiple tables `FOR ALL TO authenticated USING(true) WITH CHECK(true)` (stock_check_sessions, staff_profiles, staff_feedback, staff_report_submissions, returns_log) — any logged-in staff can read/alter every other staff's rows.

**Fix direction:** replace `using(true)`/`to public`/`to anon` write policies with row-scoped RLS, or route sensitive writes through service-key functions. ARCHITECTURAL — owner decision.

---

## 🟠 HIGH — Data integrity & money

### H1. app.js:22516-22524 — `__applyStockDelta` negative path is a non-atomic read-then-write (lost-update race)
Reads `qty_remaining` via select then writes `qty_remaining - take`. Checkout uses the atomic `deduct_stock_fifo` RPC to avoid exactly this, but refund/void/edit/manual paths don't. Two concurrent ops on the same SKU lose updates (batch 10 + two +5 restocks → 15 not 20).

### H2. app.js:8995-8999 — partial return sets `stock_restored=true`, blocking later void restock
`__returnRefundConfirm` restocks only returned items but unconditionally sets `md.stock_restored=true`. Later full void → `__restockSaleIfVoided` (27065) returns early `if(md.stock_restored)`, so un-returned units are never restocked. Sell 5, return 2, void → 3 units lost from inventory forever.

### H3. app.js:13670-13680 — idempotency guard is a TOCTOU SELECT, not an atomic unique-insert
Pre-checks `client_txn_id` via select, but the `sales_history` insert (13843) has no upsert/onConflict. Double-tap / two devices that both pass the SELECT → duplicate sale + double stock deduction, unless a DB-level unique index on `client_txn_id` exists (unverifiable from app code).

### H4. app.js:13045-13046 — payment modal shows total that ignores the custom/VIP discount
`paymentTotalDisplay` is set to raw `cart.reduce(c.price*c.quantity)`. Real charge (`finalTotal`, 13731) is correct, but the number the cashier reads to collect cash can overstate the charge if the modal opens with pre-existing discount state.

---

## 🟡 MEDIUM

### M1. app.js:13324-13325 — stored XSS via unescaped customer name/phone in `posSetCustomer`
`detail.innerHTML` interpolates `name`/`phone` with no escaping (rest of file uses `hesc()`). Customer name `<img src=x onerror=...>` saved via public invoice form executes in the cashier session.

### M2. _inventory.js:51-63 — per-SKU deduct errors swallowed; audit-ledger write best-effort
If `deduct_stock_fifo` fails it's pushed to `errors` and the loop continues but callers return `ok:true`. If RPC succeeds but `inventory_transactions` insert throws, batches decremented with no OUTBOUND_SALE row → ledger disagrees, no alert.

### M3. shopee-sync.js — idempotency is insert-only, not coupled to deduction
Unique index on `shopee_order_sn` dedups the insert; `deductStockForItems` runs after in a separate non-transactional call. Timeout between insert and deduct → re-run sees row as existing, skips, stock never deducted → oversell.

### M4. daily-bos-digest.js:163-202 — HTML injection in digest; :290 `?send=1` triggers email blast
Product name/sku and marketplace detail/error_message interpolated into digest HTML with no escaping (stored injection into boss's mail client). Unauthenticated `?send=1` fires a real Resend email on demand (spam/cost).

### M5. PostgREST `in.(...)` filters interpolate quote-stripped SKUs
returns-pull.js:329, shopee-stock-push.js:66, _tiktok.js:125 — a SKU containing `"`/`)` could manipulate the filter. Lower risk (SKUs mostly server-sourced).

---

## Cleared / not issues
- No shell/command execution anywhere (no `child_process`).
- No classic SQL injection (PostgREST parameterised).
- No SERVICE_ROLE key committed — only anon keys (expected). Public functions read `process.env.SUPABASE_SERVICE_KEY` and recompute totals/validate server-side. Good.
- Checkout stock deduction uses the atomic FIFO RPC with timeout + rollback. Good.
- Receipt/order-history rendering uses `hesc`/`escHtml`; send-receipt-email.js and loyalty-otp.js escape HTML. Good.
- capacitor.config.json: `cleartext:false`, `allowNavigation` scoped to 10camp.com. Fine.
- AndroidManifest `exported="true"` is the standard Capacitor launcher. Fine.
- Committed `10camp-pos.apk` embeds only already-public anon key. Informational.
