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
