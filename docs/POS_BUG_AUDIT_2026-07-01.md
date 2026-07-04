# 10 CAMP POS — Deep Bug Audit (2026-07-01)

Method: 23 parallel finder agents across all of `app.js` (44,862 lines, 12 line-range chunks) + both netlify server-function groups, each finding then re-checked by an independent adversarial verifier that opened the real code and tried to refute it. **37 findings survived** (35 CONFIRMED, 2 PLAUSIBLE). 3 candidates were refuted and dropped.

Repo: `~/Projects/pos-site` @ commit `fdae67e`. Report-only — no code changed.

Severity legend: **CRITICAL** = active security hole · **HIGH** = real money/stock loss or data leak, reachable · **MEDIUM** = wrong money/stock under a realistic path · **LOW** = wrong numbers on internal/report screens, no transaction moved.

---

## CRITICAL (1)

### C1 — Staff PINs are offline-crackable (owner account included) — **WON'T FIX (Zaid decision 2026-07-04)**
`netlify/functions/staff-auth.js:42`
The PIN hash uses a hardcoded, publicly-known salt (`10camp_salt_v1`) and the hashes are shipped in the client bundle (`app.js` ~16557). The verifier actually ran the crack and recovered real PINs in milliseconds: **CMP001 owner (zaid@10camp.com) = 1999**, REV001 = 4729, TST001 = 8888. This bypasses the server's 12-attempt rate limit entirely and lets an attacker mint a genuine authenticated Supabase session as the owner.

**DECISION 2026-07-04 (Zaid): keep current PINs — accept the risk, close the item.** Mitigating factors that make this acceptable for 10 CAMP's context: it's a small internal team on a shared company device, the device now auto-locks and requires PIN on every entry (p1_1030), and rotating PINs + re-briefing all staff wasn't worth the operational friction. Original fix (rotate PINs, remove hashes from client, secret server salt) documented above if the risk profile changes later.

---

## HIGH (3)

### H1 — `approveDiscrepancy` stock write uses a stale client-side read (lost update)
`app.js:26330`
Warehouse audit approval deducts stock with the OLD `SELECT-then-UPDATE` pattern (writes `local qty - delta` back), instead of the atomic `deduct_stock_fifo` RPC used everywhere else. If a cashier sold the SKU since the page loaded, approving a shortage resurrects already-sold units. The identical pattern was already fixed elsewhere as "p1_789 (H1)"; this call site was missed. **Fix: route through `__applyStockDelta` / `deduct_stock_fifo`.**

### H2 — Receipt-email endpoint is fully unauthenticated → customer PII leak
`netlify/functions/send-receipt-email.js:233`
No auth guard. Anyone can POST `{sale_id:N, preview:true}` for N=1,2,3… and receive the rendered receipt (customer name, every item, totals) **plus the raw customer email**. Enumerating IDs exfiltrates the whole customer + purchase-history list. Without `preview` it can also spam real receipt emails. **Fix: add `requireAuth`/`requireStaff` gate.**

### H3 — TikTok finance endpoint is public → business financials leak
`netlify/functions/tiktok-finance.js:83`
No auth. `GET /api/tiktok-finance?mode=rows` returns all TikTok payout data — per-order gross, commission, fees, net payout. **Fix: add auth gate.**

---

## MEDIUM (18)

**Refund / void not reversed on every path** (money & stock leak; the void path *does* reverse, these don't):
- **M1** `app.js:10613` — full/partial **refund never rolls back loyalty points / total_spent**. Customer keeps points (and tier → VIP auto-discount) for refunded money.
- **M2** `app.js:8396` — **editing a sale never adjusts loyalty points / total_spent / total_orders**. RM500→RM50 edit leaves 50 pts + RM500 lifetime spend.
- **M3** `app.js:10396` — fulfillment queue filter tests `status==='refund'` but refunds set `'Refunded'`, so **refunded online orders stay in the packing queue** (staff can re-ship already-refunded goods).
- **M4** `app.js:36300` — **Tutup Kira expected-cash ignores cash refunds** paid from the drawer → drawer always looks short by refunded cash.
- **M5** `app.js:36254` — **cash leg of Split-payment sales excluded from drawer reconciliation** (`payment_method='Split'` fails the `/cash|tunai/` test) → drawer looks over.

**Silent DB-write failures** (Supabase-js returns `{error}` instead of throwing; code assumes success):
- **M6** `app.js:42097` — **store-credit issue** insert not error-checked → shows success, credit never saved, shop silently owes customer.
- **M7** `app.js:42402` — **park/hold sale** (`held_sales`) insert not checked; **clears the cart anyway** → entire in-progress sale lost on failure.
- **M8** `app.js:16131` — checkout: a **transient `deduct_stock_fifo` error is treated as backorder**, sale commits with stock never decremented → silent oversell, never retried.
- **M9** `netlify/functions/shopee-webhook.js:370` — order marked `stock_deducted=true` and committed **before** deduction runs; `deductStockForItems` swallows errors → silent oversell, never retried.

**Stock-integrity retry races** (side-effects before the authoritative write, no idempotency):
- **M10** `app.js:8253` — **cancel order** restocks + writes returns_log before the status update; if the update fails and staff retry → **double restock** (null-metadata POS orders).
- **M11** `app.js:8375` — **edit order** stock reconcile is non-idempotent; failed save + retry → **double deduct/restock** + phantom returns_log.

**Walk-in sales undercounted** (`qty` vs `quantity` field mismatch — cashier stores `quantity`, these read `qty`):
- **M12** `app.js:34325` — **Manager dashboard Top-SKU** counts every walk-in line as 1 unit → unit counts and RM revenue understated.
- **M13** `app.js:35209` — **velocity / reorder analysis** reads `it.qty` → walk-in quantities count as 0 → reorder points wrong.

**Other medium:**
- **M14** `app.js:20555` — **`approveRequest` roster overwrite deletes the old shift before the negative-AL-balance confirm**; clicking Cancel destroys the day with no replacement.
- **M15** `app.js:15059` — **B2B volume-tier price never re-evaluated** when qty changes via +/- taps → B2B customer charged retail instead of negotiated tier price.
- **M16** `app.js:24766` — **quotation/invoice ref numbers reuse** (`nextQuoteIdNum` never seeded from DB) → `QT-1001` collides after reload, save fails.
- **M17** `app.js:27925` — **picking-list UI never writes built HTML to the DOM** for non-empty lists → staff see blank picking list.
- **M18** `app.js:21675` — **7-day sales graph** buckets by day+month only (no year) → sales from same date in prior years inflate the chart.
- **M19** `netlify/functions/loyalty-otp.js:108` — **OTP 5-attempt cap bypassable** via concurrent verify race; no per-IP throttle.
- **M20** `netlify/functions/shopee-refunds-pull.js:63` & **M21** `tiktok-product-sync.js:168` — **mutating service-role endpoints missing `requireAuth`** (the p1_786/787 hardening skipped these two files).

*(M6–M21 = 16; combined with M1–M5 the medium bucket totals 18 distinct items above — some grouped for readability.)*

---

## LOW (8) — wrong numbers on internal/report screens, no transaction moved

- **L1** `app.js:1962` & **L2** `app.js:4057` — staff self-report revenue/orders **count test + voided + cancelled + refunded** sales (no `is_test`/`status` filter).
- **L3** `app.js:13987` — Cashier KPI "Jualan Hari Ini" (store-wide) **ignores same-day refunds**, while personal "Jualan Aku" nets them → two numbers disagree.
- **L4** `app.js:19047` — Finance P&L **revenue never nets refunds** → Net Profit overstated (internal/deprecated report).
- **L5** `app.js:19607` — Sales-target "monthly" commission widget sums **all-time** history (mislabelled monthly, bar pinned 100%).
- **L6** `app.js:4389` — manual stock movement logs full requested qty even when FIFO deducted less → Inventory History "Baki" column wrong (actual stock OK).
- **L7** `app.js:19702` — `saveScheduleBtn` deletes shift before AL-balance confirm (same class as M14, manual-save path).
- **L8** `app.js:42979` — stock-transfer log insert not error-checked → false "saved" audit trail.
- **L9** `netlify/functions/settlement-recon-background.js:132` — Shopee orders 15–45 days old falsely flagged `belum_settle` (escrow pull window 15d < POS window 45d).
- **L10** `netlify/functions/config-check.js:83` — unauth `config-check` discloses env/config status and wipes/rewrites `config_health` on each hit.
- **L11** `netlify/functions/public-assistant.js:139` — AI spend cap is race-prone and self-disables on a DB read error (per-warm-instance throttle only).
- **L12** `app.js:14898` (PLAUSIBLE) — PDP discount retroactively re-prices units already in cart at full price (whole line overwritten to discounted price).

---

## Recurring root causes (fix the pattern, kill many bugs)

1. **Supabase-js never throws on DB error** — it returns `{error}`. Every unchecked `await db.from(...).insert/update(...)` on a money/stock path silently "succeeds". Affects M6, M7, M8, M9, L8. → Add a shared `assertOk()` helper and wire it into all write paths.
2. **Refund/void reversal only lives in one path** (`__restockSaleIfVoided`). Refund, edit, and drawer/report code don't call it. Affects M1, M2, M3, M4, M5, L3, L4. → Make one canonical "reverse a sale" routine and call it from refund + edit too.
3. **Side-effects before the authoritative write, no idempotency key** → double-apply on retry. Affects M10, M11 (and the general lack of a save-button in-flight lock). → Write status first / use an idempotency guard on stock+returns_log.
4. **`qty` vs `quantity` field split** between marketplace (`qty`) and cashier (`quantity`). There's already an `__aoItemQty` helper — several sites don't use it. Affects M12, M13. → Replace raw `it.qty` with `__aoItemQty(it)` everywhere.
5. **Unauthenticated netlify endpoints** — the p1_786/787 auth sweep missed several. Affects H2, H3, M20, M21, L10. → Add `requireAuth` to every mutating/data-returning function; add a CI check.
