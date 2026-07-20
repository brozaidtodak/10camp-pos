# Design System — 10 CAMP "Ekspedisi Peta"

> Sumber kebenaran design untuk SEMUA permukaan 10 CAMP: landing page, back office POS, app mobile iOS/Android.
> Dipilih Zaid 19 Jul 2026 selepas 5 pusingan explorasi (27 arah, A–AA). Arah V = gabungan B (bold utility) × P (kartografi/topo).
> Preview rasmi: ~/.gstack/projects/brozaidtodak-Pos-System-Test/designs/design-system-20260719/alternatif-pusingan5-BxP.html (seksyen ARAH V)

## Konteks Produk
- **Apa:** Kedai runcit camping gear premium di Cyberjaya — 11 jenama, walk-in + Shopee + TikTok
- **Untuk siapa:** Camper Malaysia (keluarga & hobbyist); staf guna back office/app harian
- **Memorable thing:** "Rasa adventure" — tenaga ekspedisi, bukan katalog
- **Bahasa UI:** BM tegas & pendek ("Datang, angkat, gerak.")

## Arah Estetik
- **Nama:** Ekspedisi Peta — utility ekspedisi × kartografi
- **Decoration level:** intentional — tekstur kontur topo halus sahaja, selebihnya tipografi buat kerja
- **Mood:** tegas, teknikal, bersedia; macam peta misi yang dilipat dalam poket
- **Rujukan:** Patagonia (tipografi besar atas kandungan), gear-label utility

## Tipografi
- **Display/Hero:** Archivo Black — UPPERCASE, letter-spacing -2px, saiz besar; SATU moment display per skrin
- **Badan/UI:** Archivo (400/500/600) — jelas pada 13px dalam table data
- **Data/Nombor:** IBM Plex Mono (400/500/600) — SEMUA harga, SKU, kuantiti, koordinat, timestamp; tabular-nums; jajar kanan dalam table
- **Loading:** Google Fonts: `family=Archivo:wght@400;500;600;700&family=Archivo+Black&family=IBM+Plex+Mono:wght@400;500;600`
- **Skala:** 12 / 13.5 / 15 / 17 / 22 / 28 / 40 / 56 / 80+ px (hero clamp responsif)

## Warna
- **Approach:** restrained — SATU aksen sahaja
- **Tulang `#F4F2EC`** — latar utama (bukan putih tulen)
- **Ink `#141414`** — teks utama, border tebal, butang sekunder
- **Oren Ekspedisi `#FF4D00`** — HANYA untuk tindakan/aksen: CTA, harga, penanda aktif. Jangan jadi hiasan latar
- **Kabus `#6E6A5E`** — teks muted / label mono
- **Garis `#B9B4A6`** — pemisah dashed
- **Permukaan `#FFFFFF` / `#FFFDF6`** — kad & panel atas tulang
- **Semantik:** success `#168C50` · warning `#B8860B` · error `#C62828` · info `#1565C0` (dengan ikon/teks, bukan warna semata)
- **Dark mode:** belum diperlukan; bila buat — ink jadi latar `#141414`, tulang jadi teks, oren kekal

## Ciri Khas Jenama (signature devices)
1. **Kontur topo** — gelang `repeating-radial-gradient` halus (opacity ≤6%) di latar hero/section besar. JANGAN atas kawasan data padat
2. **Koordinat GPS** — `2.9188° N, 101.6520° E — ELEV. 34M` sebagai baris mono jenama (footer, hero, resit)
3. **Manifest bernombor** — senarai produk gaya `01 — NAMA / JENAMA ..... RM X` dengan pemisah dashed; ini ganti card-grid di landing
4. **Butang misi** — CTA oren dengan border 3px ink + hard shadow `6px 6px 0 #141414`; hover: anjak 2px. Sekunder: outline ink
5. **Oren = tindakan** — tak pernah jadi warna hiasan

## Spacing & Layout
- **Base unit:** 8px (4px untuk dalam komponen padat)
- **Density:** landing = lega; back office/app = padat selesa (row table 40-44px)
- **Layout:** grid-disciplined; landing komposisi poster jajar-KIRI (jangan centre semua); max-width kandungan 1200px
- **Radius:** butang 0-4px (utility, bukan bubble) · kad 8-12px · pill 999px hanya untuk status
- **Table:** header uppercase mono 11px letter-spacing 1.5px; nombor jajar kanan mono

## Motion
- **Approach:** minimal-functional — transition 150-250ms ease-out; tiada animasi hiasan
- **Hormati** `prefers-reduced-motion`

## Peraturan Teknikal Sedia Ada (kekal)
- Kod POS WAJIB guna `var(--primary-*)` + `var(--font-main)` (sistem tema)
- Deep-link WAJIB `__navHubGo`; sidebar `.nav-children`
- Perubahan landing MESTI apply Preview Mode sekali (parity)
- Ikon: Lucide sahaja, satu stroke-width; TIADA emoji sebagai ikon UI

## Log Keputusan
| Tarikh | Keputusan | Rasional |
|---|---|---|
| 19 Jul 2026 | Buang sistem lama (bronze/Poppins) | Arahan Zaid — mahu arah segar |
| 19 Jul 2026 | Tolak "Malam di Kem" (gelap malam-dulu) | Zaid tak berkenan gelap |
| 19 Jul 2026 | Pilih ARAH V "Ekspedisi Peta" dari 27 arah | Zaid suka B+P; V = gabungan terus. Grounded ui-ux-pro-max + /design-consultation |
| 20 Jul 2026 | DI-APPLY ke landing (Fasa A: token + hero poster + butang misi + koordinat GPS) — p1_1125 | Arahan Zaid via /design-consultation "Apply ke landing". Teks butang = ink atas oren (kontras 5.6:1 > putih 3.5:1). Fasa B belum: manifest bernombor, kontur topo radial. Back office/app belum |
