# 10 CAMP — Ideas mined from *awesome-ecommerce-skills* (178 skills)

Dilombong dari koleksi 178 e-commerce skill (finsilabs, MIT). Cara sama macam [GreaterWMS mining] dulu — **ambil idea, silang dengan apa 10 CAMP dah ada, prioritize**. BUKAN untuk install skill (kebanyakan platform-specific Shopify/Woo yang tak kena; kita custom POS + Supabase + Shopee/TikTok).

Status: **HAVE** = dah ada · **PARTIAL** = ada asas, boleh naik taraf · **GAP** = belum ada · **N/A** = tak relevan model kita.
Priority: **P1** = high-value & sejajar keperluan sekarang · **P2** = berbaloi bila ada masa · **P3** = nice-to-have.

Konteks 10 CAMP: retail camping gear · jual via **Shopee / TikTok / walk-in** (tiada payment gateway web) · POS custom + 10cc (kewangan) · marketing = jurang paling besar (memory: pixel/GBP/content pending).

---

## A. MARKETING & GROWTH — jurang terbesar 🎯
36 skill di sini. Kita ada scaffold (analytics.js, schema, sitemap) tapi hampir semua flow marketing belum wujud.

| Idea | Status | Untuk 10 CAMP | P |
|---|---|---|---|
| **review-generation-engine** | GAP | Auto-mintak review lepas jualan (email/WA selepas walk-in / order marketplace) → social proof + SEO. Kita ada Resend + WA. | **P1** |
| **email/lifecycle-marketing-automation** | GAP | Flow auto: welcome VIP, post-purchase, win-back, back-in-stock. Kita ada email (Resend) + data pelanggan + points. | **P1** |
| **win-back-reactivation / customer-retention-engine** | GAP | Sasar pelanggan lama tak beli (total_spent + last order) → tawaran comeback. Data dah ada. | **P1** |
| **google-shopping-feed** | GAP | Jana product feed → Google Merchant Center → produk muncul di Google Shopping. Katalog dah ada, tinggal feed XML. | **P1** |
| **social-proof-widgets** | GAP | "X orang beli minggu ni", kiraan review, badge verified — pada landing. Naikkan trust + conversion funnel. | **P2** |
| **push-notifications (price-drop / back-in-stock)** | GAP | Notifikasi browser: stok masuk semula, harga turun. Kita ada Capacitor (mobile push) + stok data. | **P2** |
| **referral-program / viral-loops** | GAP | Refer-a-friend dual reward + link unik. Guna sistem loyalty sedia ada. | **P2** |
| **cross-sell-upsell-engine** | GAP | Cadang produk pelengkap masa checkout POS / landing (ikut corak jualan). salesHistory dah ada. | **P2** |
| **seasonal-campaign-automation** | PARTIAL | Kita ada campaign flags marketplace; tambah playbook musim (Raya/BF/holiday) + countdown. | **P2** |
| **meta/tiktok/google-ads + analytics-integration** | PARTIAL | Pixel dah scaffold (OFF). Isi IDs + server-side (Conversions/Events API) untuk tracking tepat. | **P1** |
| **marketing-attribution-dashboard** | GAP | UTM + multi-touch → tahu channel mana bawa jualan. Perlu selepas pixel hidup. | **P3** |
| **cart-abandonment / exit-intent** | N/A-ish | Tiada checkout web (marketplace handle). Boleh apply pada "held sale" / web enquiry sahaja. | **P3** |

---

## B. CATALOG & INVENTORY
Kita kuat di sini. Kebanyakan HAVE.

| Idea | Status | Nota | P |
|---|---|---|---|
| inventory-tracking / low-stock-alerts | **HAVE** | Stock Levels + Pusat Amaran + reorder points | — |
| cogs-tracking-allocation | **HAVE** | Calculator landed cost + product_landed_cost | — |
| product-bundles-kits | **HAVE** | Bundle Builder (auto-deduct FIFO) | — |
| variant-matrix / product-data-modeling | **HAVE** | Varian + parent_sku + metadata | — |
| product-categorization | **HAVE** | Categories + Collections (baru) | — |
| product-analytics (dead stock, sell-through) | **HAVE** | Inventory Analytics | — |
| **multi-warehouse** | PARTIAL | stock_locations multi-lokasi manual; formalkan transfer + split-fulfillment (WMS Bins pending) | P2 |
| **demand-forecasting** | GAP | Ramal reorder ikut sejarah + musim (WMS fasa pending). salesHistory + batches dah ada | **P1** |
| **product-content-enrichment (AI)** | PARTIAL | Ada Tanya AI staf; tambah auto-jana description + tag gambar untuk katalog | P2 |
| catalog-import-export | **HAVE** | Bulk edit + import katalog | — |

---

## C. PRICING & PROMOTIONS
Sederhana kuat.

| Idea | Status | Nota | P |
|---|---|---|---|
| loyalty-points-system | **HAVE** | RM10=1 mata, tier VIP | — |
| volume-pricing | **HAVE** | B2B tier ikut min_qty | — |
| **discount/price-rules-engine** | PARTIAL | Ada diskaun manual + campaign; belum rule stackable/priority/segment | P2 |
| **coupon-management** | GAP | Kod kupon (%/RM, had guna, expiry, bulk unique-code) — untuk walk-in / marketing | P2 |
| **gift-cards** | GAP | Jual + terima gift card (balance, partial redeem). Nota: store-credit dulu di-DROP oleh Zaid — semak semula | P3 |
| **flash-sale-engine** | GAP | Jualan bermasa + countdown + cap qty (event/musim) | P3 |
| dynamic-pricing / ab-testing-pricing | GAP | Auto ubah harga ikut demand/stok — advanced, kemudian | P3 |

---

## D. CUSTOMER / CRM
Ada asas loyalty; analitik pelanggan lemah.

| Idea | Status | Nota | P |
|---|---|---|---|
| loyalty (points/tier) | **HAVE** | CRM/Members | — |
| **customer-segmentation (RFM)** | PARTIAL | Ada tier VIP; tambah RFM (recency/frequency/monetary) untuk sasar marketing | **P1** |
| **customer-lifetime-value (CLV)** | PARTIAL | total_spent dijejak; tambah kira CLV + auto retention segmen tinggi | P2 |
| **product-reviews-ratings** | GAP | Kumpul + papar review + star + rich-result markup → trust + SEO | **P1** |
| **personalization-engine** | GAP | Cadangan produk ikut sejarah browse/beli | P3 |
| customer-support-integration / live-chat | PARTIAL | Ada Chat Inbox (Shopee live); TikTok pending | P2 |

---

## E. DATA / ANALYTICS & FINANCE
10cc kuat untuk kewangan; analitik pelanggan/marketing lemah.

| Idea | Status | Nota | P |
|---|---|---|---|
| marketplace-fee-reconciliation | **HAVE** | 10cc settlements + fees posted | — |
| profit-margin-analysis | **HAVE** | Margin + Laporan Sulit | — |
| financial-reporting-dashboard (P&L) | **HAVE** | 10cc P&L/reports | — |
| **unit-economics-tracking (CAC/LTV/payback)** | GAP | Jejak CAC + LTV + contribution margin ikut cohort/channel — perlu bila marketing hidup | **P1** |
| **customer-analytics (RFM/cohort/churn)** | GAP | Cohort + churn prediction → retention | P2 |
| **cash-flow-forecasting** | GAP | Ramal aliran tunai (10cc ada buku; tambah forecast + runway) — berguna untuk Zaid | **P1** |
| **cost-allocation-analysis** | PARTIAL | Ada landed cost; agih shipping/marketing/overhead ke per-order untuk profit sebenar | P2 |
| ecommerce-budgeting-forecasting | GAP | Belanjawan rolling (inventory purchase, marketing) | P3 |
| sales/product-analytics dashboard | **HAVE** | Reports + Inventory Analytics | — |

---

## F. OPERATIONS & FULFILLMENT
| Idea | Status | Nota | P |
|---|---|---|---|
| order-management-system | PARTIAL | Ada order + Notify; formalkan routing/split/backorder | P2 |
| **order-fulfillment-workflow (pick-pack-ship + barcode)** | PARTIAL | Ada Notify picking; tambah scan barcode + packing slip (WMS Receiving/Cycle Count) | **P1** |
| returns-management | **HAVE** | Return-at-cashier + returns_log | — |
| **vendor-management (portal/scorecard)** | PARTIAL | Ada suppliers/PO; tambah scorecard prestasi + tracking DO | P2 |
| accounts-payable-management | PARTIAL | Ada supplier_orders; formalkan AP + matching invois | P2 |
| shipment-tracking | PARTIAL | Marketplace handle; sendiri via SF Intl | P3 |
| b2b-commerce (company accounts/quotes/PO) | PARTIAL | Ada B2B price + quotations; tambah akaun syarikat + net terms | P2 |

---

## G. STOREFRONT (landing) — enhancement
| Idea | Status | Nota | P |
|---|---|---|---|
| image-zoom / search-autocomplete | PARTIAL | Ada zoom lightbox + search | — |
| **faceted-navigation (multi-filter)** | PARTIAL | Ada category pills; tambah tapis serentak (brand+kategori+harga) — kini Collections dah bantu | P2 |
| **wishlist / recently-viewed / quick-view** | GAP | Enhancement funnel landing (guna localStorage) | P2 |
| product-comparison | GAP | Banding produk side-by-side | P3 |
| accessibility-commerce (WCAG) | GAP | A11y audit landing | P3 |

---

## H. SECURITY & COMPLIANCE
| Idea | Status | Nota | P |
|---|---|---|---|
| account-security (MFA, lockout) | PARTIAL | Ada PIN lockout; **C1 PIN hardening masih pending** (putar PIN + buang hash client) | **P1** |
| bot-protection / throttle | PARTIAL | Audit dah tambah per-IP throttle (public-customer/checkout) | — |
| **financial-audit-trail (immutable)** | PARTIAL | Ada audit_logs; jadikan immutable + tamper-detection untuk compliance | P2 |
| fraud-detection | N/A-ish | Walk-in tunai risiko rendah; marketplace handle | P3 |
| gdpr / data-retention | GAP | Dasar simpan/padam data pelanggan (kalau skala besar) | P3 |

---

## Cadangan tumpuan (P1 shortlist)

Kalau nak buat next, aku susun ikut nilai vs usaha:

1. **Marketing engine asas** (P1 cluster) — review-generation + email/win-back automation + Google Shopping feed + hidupkan pixel. Ni jurang paling besar & data semua dah ada. Impact: pulangan pelanggan + trust + trafik.
2. **C1 PIN hardening** (security, dah lama pending, perlu keputusan Zaid).
3. **Demand-forecasting + fulfillment barcode** (WMS fasa seterusnya — sejajar Zack's inventory ops).
4. **RFM segmentation + CLV + cash-flow-forecasting** (analitik: sasar marketing tepat + Zaid nampak runway).

Yang lain (P2/P3) simpan sebagai backlog.

---

*Sumber: awesome-ecommerce-skills (178 skill). Dilombong sebagai idea sahaja — tiada skill di-install. Silang dengan roadmap sedia ada dalam index.html (ROADMAP_DATA) + memory.*
