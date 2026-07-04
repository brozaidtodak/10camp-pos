#!/usr/bin/env node
/*
 * POS Guardian (mechanical CI checks) — partner to the AI agent .claude/agents/pos-guardian.md.
 * Diff-based: scans only the lines ADDED in a push so pre-existing legacy emoji/colors don't
 * fail the build — it only flags NEW violations. Plus a hard JS syntax check + cache-bust hint.
 *
 * Rules enforced (high-confidence, low false-positive):
 *  - no NEW emoji in app.js/index.html/css (no-emoji hard rule); ROADMAP_DATA entries + comments skipped
 *  - no NEW off-brand theme colors (the purples/blues/teal that the brand migration p1_386 removed)
 *  - app.js must still `node --check` clean
 *  - if app.js/CSS changed, nudge to bump ?v= (cache-bust rule) — warning only
 *
 * Allowed (never flagged): brand #CD7C32/#101010/#FAF6EF, functional status red/green/amber,
 * marketplace Shopee #EE4D2D / WhatsApp green / TikTok black, neutral greys.
 */
const { execSync } = require('child_process');

const EMOJI = /\p{Extended_Pictographic}/u;
// Denylist = the off-brand theme palette eliminated by p1_386 (purples/blues) + teal. Specific = low noise.
const DENY_COLORS = [
 '#a855f7','#7c3aed','#4c1d95','#6d28d9','#8b5cf6','#a78bfa','#c4b5fd','#ddd6fe','#ede9fe','#f5f3ff',
 '#3b82f6','#2563eb','#1e40af','#1d4ed8','#60a5fa','#93c5fd','#bfdbfe','#dbeafe','#eff6ff',
 '#0f766e','#0d9488','#14b8a6'
];

const failures = [];
const warns = [];

// ROADMAP_DATA entries are historical changelog text (emoji/colors/divs inside strings) — never flag.
function isRoadmapLine(s) { return /id:\s*'p\d+_/.test(s); }
function isComment(s) { return /^\s*\/\//.test(s) || /^\s*\*/.test(s) || /^\s*<!--/.test(s); }

// 1) Hard: JS syntax
try { execSync('node --check app.js', { stdio: 'pipe' }); }
catch (e) { failures.push('Sintaks JS app.js GAGAL: ' + (e.stderr ? e.stderr.toString().split('\n')[0] : e.message)); }

// 2) Diff-based scan of ADDED lines
const before = process.env.GUARDIAN_BEFORE || '';
const after = process.env.GUARDIAN_AFTER || 'HEAD';
const paths = '-- app.js index.html design-tokens.css style.css netlify';
let diff = '';
const tryDiff = (range) => { try { return execSync(`git diff ${range} ${paths}`, { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 }).toString(); } catch (e) { return ''; } };
if (before && !/^0+$/.test(before)) diff = tryDiff(`${before} ${after}`);
if (!diff) diff = tryDiff('HEAD~1 HEAD');

let curFile = '';
diff.split('\n').forEach(line => {
 if (line.startsWith('+++ b/')) { curFile = line.slice(6); return; }
 if (!line.startsWith('+') || line.startsWith('+++')) return;
 const added = line.slice(1);
 if (isRoadmapLine(added) || isComment(added)) return;
 if (EMOJI.test(added)) failures.push(`Emoji baru dalam ${curFile}: ${added.trim().slice(0, 70)}`);
 const low = added.toLowerCase();
 DENY_COLORS.forEach(c => { if (low.includes(c)) failures.push(`Warna off-brand baru (${c}) dalam ${curFile}: ${added.trim().slice(0, 55)}`); });
});

// 3) Cache-bust hint (warning only)
const changedAssets = /\n\+\+\+ b\/(app\.js|design-tokens\.css|style\.css)/.test(diff);
const bumped = /[-+][^\n]*\.(js|css)\?v=\d+/.test(diff);
if (changedAssets && !bumped) warns.push('app.js/CSS berubah tapi nampak tiada bump ?v= dalam index.html — sahkan cache-bust.');

// 4) p1_1049 — ANTI-HABUK (penuh-fail, baseline bersih sejak p1_1047/1045):
//    kelas bug yang audit Jul 2026 jumpa — tangkap masa push, bukan masa staf komplen.
const fs = require('fs');
let appSrc = '', htmlSrc = '';
try { appSrc = fs.readFileSync('app.js', 'utf8'); htmlSrc = fs.readFileSync('index.html', 'utf8'); } catch (e) {}

// 4a) BUTANG LOMPAT MATI — semua rujukan programatik [data-tab=X] mesti sasar data-tab yang wujud.
//     (p1_1047: 4 butang mati selepas restruktur sidebar p1_816 — loceng amaran, Review, Buka Report, Buka Inventory)
if (appSrc && htmlSrc) {
 const defined = new Set();
 (htmlSrc.match(/data-tab="([a-z_0-9]+)"/g) || []).forEach(m => defined.add(m.slice(10, -1)));
 const refRe = /\[data-tab=\\?["']?([a-z_0-9]+)\\?["']?\]/g;
 const seen = new Set();
 let m;
 for (const src of [appSrc, htmlSrc]) {
  refRe.lastIndex = 0;
  while ((m = refRe.exec(src)) !== null) {
   const t = m[1];
   if (seen.has(t)) continue; seen.add(t);
   if (!defined.has(t)) failures.push(`Butang lompat MATI: rujukan [data-tab=${t}] tapi tiada elemen data-tab="${t}" dalam index.html`);
  }
 }
}

// 4b) I18N-WIPE — data-i18n pada elemen yang ada ANAK ber-id dinamik (bukan jiran sebaris).
//     applyI18N buat textContent=val → anak dipadam (p1_1045: total BAYAR SEKARANG lenyap sejak p1_947).
//     Parse ringkas: dari tag pembuka data-i18n, cari </tagNama> padanan dlm baris sama —
//     hanya flag kalau ada <x id="..."> DI ANTARA pembuka dan penutup (= anak sebenar).
if (htmlSrc) {
 htmlSrc.split('\n').forEach((line, i) => {
  if (isComment(line)) return;
  let from = 0;
  while (true) {
   const di = line.indexOf('data-i18n="', from);
   if (di === -1) break;
   from = di + 11;
   const openStart = line.lastIndexOf('<', di);
   if (openStart === -1) continue;
   const tagM = /^<([a-z0-9]+)/.exec(line.slice(openStart));
   if (!tagM) continue;
   const tag = tagM[1];
   const openEnd = line.indexOf('>', di);
   if (openEnd === -1) continue;
   const closeIdx = line.indexOf('</' + tag, openEnd);
   if (closeIdx === -1) continue; // tutup di baris lain — skip (elak false positive multi-baris)
   const inner = line.slice(openEnd + 1, closeIdx);
   if (/<[a-z]+ [^>]*id="/.test(inner)) {
    failures.push(`i18n-wipe risk index.html:${i + 1}: data-i18n pada <${tag}> yang ada ANAK ber-id (applyI18N akan padam anak) — pindahkan data-i18n ke span label`);
   }
  }
 });
}

// 4c) SECTION YATIM (warning sahaja) — id="xxxSection" yang TIADA rujukan lain di mana-mana.
//     Allowlist = dorman sengaja (kod kekal, menu dibuang).
const ORPHAN_OK = new Set(['backfillOrderSection']); // p1_1048 — dorman sengaja utk backfill DO 2025/26
if (appSrc && htmlSrc) {
 const secs = new Set();
 (htmlSrc.match(/id="([A-Za-z0-9]+Section)"/g) || []).forEach(s => secs.add(s.slice(4, -1)));
 secs.forEach(sec => {
  if (ORPHAN_OK.has(sec)) return;
  const inApp = appSrc.split(sec).length - 1;
  const inHtml = htmlSrc.split(sec).length - 1; // 1 = definisi sendiri
  if (inApp === 0 && inHtml <= 1) warns.push(`Section yatim: ${sec} tiada laluan masuk (tiada rujukan) — habuk? Atau tambah ke ORPHAN_OK kalau dorman sengaja.`);
 });
}

// Report
console.log('POS Guardian (mekanikal) — ' + (process.env.GITHUB_SHA || 'local'));
if (warns.length) { console.log('\nAMARAN:'); warns.forEach(w => console.log('  - ' + w)); }
if (failures.length) {
 console.log('\nGAGAL (' + failures.length + '):');
 failures.forEach(f => console.log('  - ' + f));
 console.log('\nGuardian jumpa isu BARU. Betulkan, atau kalau memang sengaja, maklum.');
 process.exit(1);
}
console.log('\nBersih — tiada emoji / warna off-brand baru, sintaks OK.');
