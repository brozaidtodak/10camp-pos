# 10 CAMP POS — Notes untuk Zack (19 Jun 2026)

Hari ni banyak perubahan masuk. Semua dah push ke `main`.
**Versi:** `app.js v808` · `design-tokens.css v121` · `style.css v61`
**Commit range:** `1037e3c..455105d` (16 commit, p1_834 → p1_848)
**Deploy:** Netlify (manual) + **hard-refresh** (Cmd/Ctrl+Shift+R) sebab cache buster naik.

Tiga aliran kerja: **A) UI/UX polish**, **B) Marketing**, **C) WMS Inventory upgrade**.

---

## A) UI/UX Polish (p1_834–837)

Guna skill design baru. Brand-lock dikekalkan (bronze/black/cream + Poppins back office).

- **Overview (Home)** — greeting strip ikut waktu + nama staf + ringkasan status kedai; kad jadi "terapung" (soft shadow ganti border rata); kad "Jualan" ada corak kontur topografi (signature outdoor); alert cards ada tint warna ikut severity. Bahasa BM kaku dibaiki ("Antrian Operasi"→"Kerja Nak Buat", dll).
- **Elevation sweep seluruh back office** — `.card` / `.stat-card` / `.rp-*` dapat shadow lembut. Naik konsisten merentas semua skrin (Reports, Inventory Analytics, dll).
- **Landing** — heading guna serif editorial **Fraunces** (display font baru; body kekal Poppins) + corak kontur pada hero. Serif scoped ke `.lp-*` SAHAJA → chrome back office tak terjejas.

**Test:** buka Overview + mana-mana skrin ada stat-card (patut nampak bayang). Landing hero patut serif.

---

## B) Marketing (p1_838–844)

### Tracking & SEO (p1_838) — PERLU TINDAKAN
- `analytics.js` baru: GA4 + Meta Pixel + TikTok Pixel, **gated ke landing awam sahaja** (skip back office via `#staff`/pos-app-scoped/currentUser). Auto tambah UTM + event `outbound_*` pada link Shopee/TikTok/WA.
- **PIXEL MASIH OFF** — ID kosong dalam `window.__ANALYTICS` (head index.html). Bos kena bagi ID GA4/Meta/TikTok, baru isi.
- `robots.txt` + `sitemap.xml` + `llms.txt` + schema **FAQPage**/Store ditambah. Perlu daftar sitemap di Google Search Console.

### Blog/Panduan (p1_839–841) — LIVE
- Sistem blog statik di **`/blog/`** (HTML sebenar, bagus SEO, guna semula CSS landing + Fraunces). 4 artikel: Khemah Terbaik · Tempat Camping Selangor · Naturehike vs Mobi Garden · Barang Wajib First-Timer.
- Link produk dalam artikel = **link Shopee tepat** (tarik dari `products_master.metadata.shopee_url`).
- Nav landing tambah "Panduan" → `/blog/`. Setiap artikel ada BlogPosting + FAQPage schema.
- Draf sumber: `docs/articles/` · Pelan kandungan: `docs/MARKETING_CONTENT_PLAN.md`.

### Sidebar Marketing dirombak (p1_842)
- 6 seksyen BARU + render fn: **Reviews & Reputasi · Content & SEO · Web Traffic · Referrals · Audiences · Local & Google Business**.
- IA jadi 4 kluster (sub-header `.nav-subhead`): Promosi & Iklan / Pelanggan & Jangkauan / Kandungan & Web / Ukur.
- **Broadcast dipindah** dari Messages → Marketing.

### Audiences auto-segmen (p1_843) — LIVE
- `renderAudiences` kira 10 segmen LIVE dari `customersData` (2,971 pelanggan): berulang/sekali/VIP/belanja tinggi/loyalty/lama-tak-beli/baru/email-consent/B2B. **Eksport CSV** tiap segmen untuk broadcast/retargeting.
- Tarikh beli terakhir TIADA column → derive dari `salesHistory` ikut `customer_phone`.

### FIX Engagement (p1_844)
- **Bug lama:** re-engage tiers (Sleeping/Cold/Lost) sentiasa 0 sebab `reTierCustomers` guna `c.last_order_at` yang tak wujud dlm table & tak pernah diisi.
- **Fix:** `window.__enrichCustomerLastOrder()` isi `last_order_at` dari salesHistory (in-memory, tiada tulis DB), dipanggil di awal reTierCustomers. Sekarang ~Sleeping 15 / Cold 11 / Lost 1,456.

**Test:** Marketing → Audiences (nombor + CSV), Engagement (tier keluar selepas ~4s sejarah jualan penuh masuk).

---

## C) WMS Inventory Upgrade (p1_845–848) — 4/4 SIAP

Idea dilombong dari **GreaterWMS** (open-source WMS). Kita TAK jalankan sistem dia — cuma ambil konsep masuk POS. **Audit "Katalog & Stok"** dibuat dulu. **Semua fasa reuse infra sedia ada — TIADA table baru, minimum sentuh write-path.**

1. **Inventory › Stock Levels** (p1_845) — paparan read-only stok pelbagai keadaan per SKU: On-hand · **Reserved** (order online belum dihantar, `ffStage!=shipped`) · **Tersedia jual** (=on-hand−reserved) · **Akan masuk** (PO Pending). KPI oversell/rendah + carian + CSV. *Tak ubah cara stok ditolak.*
2. **Purchasing › Receiving** (p1_846) — GRN V2 sedia ada (scan barcode, partial, print) ditambah lajur **"Rosak"**. `confirmReceivePO`: baik=(terima−rosak) → stok jual; **rosak → returns_log** (type damaged, source `po_receive`, untuk claim pembekal); PO tutup ikut jumlah fizikal. View Receiving baru (untuk diterima + sejarah).
3. **Inventory › Cycle Count** (p1_847) — kira separa berputar ganti tutup-kedai-kira-semua. Jana subset SKU (berputar cursor / nilai tertinggi / rawak) → cipta `stock_check_sessions` → **guna semula flow Stock Take** untuk counting/variance/adjust.
4. **Inventory › Locations & Bins** (p1_848) — directory bin diagregat dari `location_bin` produk. Senarai bin (SKU/unit/nilai), **scan kod bin atau SKU** → kandungan, **cetak label barcode bin** (JsBarcode), senarai "SKU tiada lokasi" + Tetapkan (modal sedia ada).

**Test:** Inventory → Stock Levels (cari yang Tersedia ≤0 = oversell). Purchasing → Receiving → Terima PO + isi qty rosak (rosak patut masuk Returns log, baik masuk stok). Inventory → Cycle Count → Jana → Cipta sesi → kira. Inventory → Locations & Bins → scan/cetak label.

---

## Action items / Pending
1. **Bos bagi ID pixel** (GA4 `G-…` / Meta ~15 digit / TikTok) → isi `window.__ANALYTICS`. Daftar sitemap di Search Console.
2. **Stock Levels "Reserved"** tepat selepas sejarah jualan penuh dimuat (~4s lepas login) — sama untuk Engagement & Audiences "lama tak beli".
3. **Stock Levels "Rosak/Hold"** belum disambung (tunggu sahkan semantik `returns_log` — adakah qty rosak patut tolak dari sellable). Boleh jadi fasa lanjut.
4. **Harga dalam artikel blog = anggaran harga kedai** — sahkan sebelum promote kuat.
5. Referrals & beberapa item Marketing baru = page permulaan (action/status), belum wired data penuh.

Apa-apa soalan, tanya je. Semua perubahan additive + brand-lock dikekal; div balance disahkan tak berubah setiap commit.
