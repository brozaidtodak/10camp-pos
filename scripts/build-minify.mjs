// p1_1022 (Fasa 1a) — Minify aset besar SEMASA Netlify build (in-place, di mesin build sahaja).
// Sumber dalam git kekal TAK di-minify (senang baca/edit). Netlify jalankan skrip ni sebelum publish,
// jadi yang dihidang = versi kecil. app.js ~2.77MB -> ~2.07MB (parse iPad turun ~25%).
//
// BULLETPROOF: kalau minify satu fail gagal, KEKAL fail asal + log amaran + teruskan (exit 0).
// Deploy TAK PERNAH pecah sebab langkah ni — paling teruk, fail tu tak di-minify.
//
// index.html SENGAJA tak di-minify (ada skrip inline + ROADMAP_DATA sensitif; berat HTML
// dikendali berasingan via lazy-load ROADMAP — Fasa 1b). sw.js dibiar (kecil + sensitif).

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import esbuild from 'esbuild';

const TARGETS = [
  { file: 'app.js',            loader: 'js'  },
  { file: 'design-tokens.css', loader: 'css' },
  { file: 'style.css',         loader: 'css' },
];

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
let anyDone = false;

for (const { file, loader } of TARGETS) {
  try {
    const before = statSync(file).size;
    const src = readFileSync(file, 'utf8');
    const out = await esbuild.transform(src, {
      minify: true,
      loader,
      legalComments: 'none',
      // JS: KEKAL nama top-level (fungsi global dipanggil dari index.html by name).
      // esbuild transform (bukan bundle) memang tak namakan semula identifier top-level skrip.
    });
    if (!out.code || out.code.length < 100) throw new Error('output kosong/terlalu kecil');
    writeFileSync(file, out.code);
    anyDone = true;
    console.log(`[minify] ${file}: ${kb(before)} -> ${kb(out.code.length)}`);
  } catch (err) {
    console.warn(`[minify] SKIP ${file} (kekal asal): ${err && err.message ? err.message : err}`);
  }
}

console.log(anyDone ? '[minify] siap.' : '[minify] tiada fail di-minify (semua kekal asal).');
process.exit(0); // jangan sekali-kali pecahkan deploy
