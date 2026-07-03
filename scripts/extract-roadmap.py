#!/usr/bin/env python3
# p1_1023 (Fasa 1b) — pindah ROADMAP_DATA (1000+ entri sejarah dev, ~1.2MB) keluar dari
# index.html ke roadmap-data.js, dimuat LAZY bila page Roadmap dibuka. Elak parse tiap cold start.
import re, sys

HTML = 'index.html'
OUT  = 'roadmap-data.js'

with open(HTML, 'r') as f:
    lines = f.readlines()

# Cari start: baris yang ada 'const ROADMAP_DATA = {'
start = next((i for i, l in enumerate(lines) if 'const ROADMAP_DATA = {' in l), None)
# Penanda tamat yang stabil: baris tepat selepas objek = "const STORAGE_KEY = 'roadmapProgress_v2'"
endmark = next((i for i, l in enumerate(lines) if "const STORAGE_KEY = 'roadmapProgress_v2'" in l), None)
if start is None or endmark is None or endmark <= start:
    print('FATAL: penanda tak jumpa (start=%s end=%s)' % (start, endmark)); sys.exit(1)

close = endmark - 1  # baris ' };' yang menutup objek
# Sahkan baris close betul-betul penutup objek
if lines[close].strip() not in ('};', '}'):
    print('FATAL: baris close tak dijangka: %r' % lines[close]); sys.exit(1)

obj = lines[start:close+1]                 # 9001..close inklusif
# sanity: mesti ada byte besar + banyak entri
blob = ''.join(obj)
n_entries = blob.count("d:'done'") + blob.count('d:"done"')
print('objek: baris %d..%d, %d KB, ~%d entri done' % (start+1, close+1, len(blob)//1024, n_entries))
if len(blob) < 200_000 or n_entries < 500:
    print('FATAL: objek nampak terlalu kecil — henti demi selamat'); sys.exit(1)

# Tulis roadmap-data.js: tukar 'const ROADMAP_DATA = {' -> 'window.ROADMAP_DATA = {'
obj_js = obj[:]
obj_js[0] = obj_js[0].replace('const ROADMAP_DATA = {', 'window.ROADMAP_DATA = {')
header = ('// p1_1023 (Fasa 1b) — data sejarah roadmap, dimuat LAZY oleh index.html bila page\n'
          '// Roadmap dibuka (bukan tiap cold start). Auto-minify di Netlify build.\n')
with open(OUT, 'w') as f:
    f.write(header)
    f.writelines(obj_js)

# Shim pengganti dalam index.html (lazy loader)
shim = (
"  // p1_1023 (Fasa 1b) — ROADMAP_DATA (1000+ entri) dipindah ke roadmap-data.js, dimuat LAZY\n"
"  // bila page Roadmap dibuka sahaja — elak parse ~1.2MB tiap cold start.\n"
"  window.__loadRoadmapData = function(cb){\n"
"    if (window.ROADMAP_DATA) { if (cb) cb(); return; }\n"
"    if (window.__rmDataLoading) { window.__rmDataLoading.push(cb); return; }\n"
"    window.__rmDataLoading = [cb];\n"
"    var s = document.createElement('script');\n"
"    s.src = 'roadmap-data.js?v=1013';\n"
"    s.onload = function(){ var q = window.__rmDataLoading || []; window.__rmDataLoading = null; q.forEach(function(f){ if (f){ try { f(); } catch(e){} } }); };\n"
"    s.onerror = function(){ window.__rmDataLoading = null; console.warn('roadmap-data.js gagal dimuat'); };\n"
"    document.head.appendChild(s);\n"
"  };\n"
)

new_lines = lines[:start] + [shim] + lines[close+1:]
html = ''.join(new_lines)

# Rujukan kod: ROADMAP_DATA.phases -> window.ROADMAP_DATA.phases (semua prose ROADMAP_DATA dah keluar)
before = html.count('ROADMAP_DATA.phases')
html = html.replace('ROADMAP_DATA.phases', 'window.ROADMAP_DATA.phases')
# renderRoadmap guard: lazy-load dulu kalau data belum ada
html = html.replace(
    ' function renderRoadmap(){\n',
    ' function renderRoadmap(){\n'
    '  if (!window.ROADMAP_DATA) { window.__loadRoadmapData(renderRoadmap); return; }\n',
    1)

with open(HTML, 'w') as f:
    f.write(html)

print('OK: roadmap-data.js ditulis, index.html shim + %d ref window.ROADMAP_DATA.phases + guard renderRoadmap' % before)
