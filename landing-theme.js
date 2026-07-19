/**
 * landing-theme.js — pemuat tema landing dari Makmal Design (p1_1121, Fasa 3).
 *
 * Aliran:
 *  1. Baca cache localStorage (lpTheme_v1) SEGERA — elak kelip (flash) tema.
 *  2. Fetch tema AKTIF dari design_themes (anon, baca sahaja) di latar; simpan cache.
 *  3. slug 'klasik-bronze' = rupa asal → TIADA var diset (fallback CSS pegang).
 *  4. Jaring keselamatan: nisbah kontras teks/bg < 3 → JANGAN apply, kekal default.
 *
 * Skop: hanya var --lp-* pada .lp-root (landing + Preview Mode — DOM sama).
 * POS (data-theme) tidak disentuh.
 */
(function () {
  var REST = 'https://asehjdnfzoypbwfeazra.supabase.co/rest/v1/design_themes';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzZWhqZG5mem95cGJ3ZmVhenJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MjE2NjMsImV4cCI6MjA5MTE5NzY2M30.34nAhmcNO_xN73OdsyxayKl_jipIk-M8DIBgibAOdaI';
  var KEY = 'lpTheme_v1';

  function lum(hex) {
    try {
      var h = hex.replace('#', '');
      var r = parseInt(h.substr(0, 2), 16) / 255, g = parseInt(h.substr(2, 2), 16) / 255, b = parseInt(h.substr(4, 2), 16) / 255;
      var f = function (c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    } catch (e) { return null; }
  }
  function contrast(a, b) {
    var la = lum(a), lb = lum(b);
    if (la == null || lb == null) return 21;
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  function apply(theme) {
    var root = document.documentElement;
    var VARS = ['--lp-accent', '--lp-accent-2', '--lp-accent-text', '--lp-ink', '--lp-ink-2', '--lp-bg', '--lp-bg-warm', '--lp-surface', '--lp-muted', '--lp-muted-2', '--lp-line', '--lp-font-display', '--lp-font-body', '--lp-radius-btn', '--lp-radius-card'];
    if (!theme || theme.slug === 'klasik-bronze') {
      VARS.forEach(function (v) { root.style.removeProperty(v); });
      return;
    }
    var t = theme.tokens || {};
    // Jaring: teks mesti boleh baca atas latar & atas permukaan
    if (contrast(t.text, t.bg) < 3 || contrast(t.text, t.surface || t.bg) < 3) {
      try { console.warn('[landing-theme] kontras gagal — kekal tema asal'); } catch (e) {}
      return;
    }
    var set = function (k, v) { if (v) root.style.setProperty(k, v); };
    set('--lp-accent', t.accent);
    set('--lp-accent-2', t.accent);
    set('--lp-accent-text', t.accentText);
    set('--lp-ink', t.text);
    set('--lp-ink-2', t.text);
    set('--lp-bg', t.bg);
    set('--lp-bg-warm', t.bg);
    set('--lp-surface', t.surface);
    set('--lp-muted', t.muted);
    set('--lp-muted-2', t.muted);
    set('--lp-line', t.line);
    if (t.fontDisplay) set('--lp-font-display', "'" + t.fontDisplay + "', sans-serif");
    if (t.fontBody) set('--lp-font-body', "'" + t.fontBody + "', sans-serif");
    if (t.radiusBtn != null) set('--lp-radius-btn', (t.radiusBtn >= 999 ? '999px' : t.radiusBtn + 'px'));
    if (t.radiusCard != null) set('--lp-radius-card', t.radiusCard + 'px');
    // muat font Google kalau bukan font sedia ada
    var need = [t.fontDisplay, t.fontBody].filter(function (f) { return f && f !== 'Poppins' && f !== 'inherit'; });
    if (need.length && !document.getElementById('lpThemeFonts')) {
      var link = document.createElement('link');
      link.id = 'lpThemeFonts';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?' + need.map(function (f) {
        return 'family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':wght@400;600;700;800';
      }).join('&') + '&display=swap';
      document.head.appendChild(link);
    }
  }

  // 1. Cache dulu (tiada kelip)
  var cached = null;
  try { cached = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (cached) apply(cached);

  // 2. Fetch aktif di latar
  try {
    fetch(REST + '?status=eq.aktif&select=slug,tokens,version&order=version.desc&limit=1', {
      headers: { apikey: ANON, Authorization: 'Bearer ' + ANON }
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (rows) {
      var t = rows && rows[0] ? rows[0] : null;
      if (!t) return;
      try { localStorage.setItem(KEY, JSON.stringify(t)); } catch (e) {}
      if (!cached || cached.slug !== t.slug || cached.version !== t.version) apply(t);
    }).catch(function () { /* offline → kekal cache/default */ });
  } catch (e) {}
})();
