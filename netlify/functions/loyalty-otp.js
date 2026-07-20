// p1_573 — Loyalty Portal OTP (Email via Resend). Customer masuk email → kod 6-digit →
// sahkan → pulang data loyalti (tier/mata/pembelian). Server-side guna SERVICE_KEY (bypass RLS).
//
// p1_1059 — AKAUN CUSTOMER penuh (keputusan Zaid: OTP + Sign Up + Kekal Login, TIADA password —
// elak rombak pagar staf "authenticated=staf" + tiada liabiliti simpan password):
//   action:'signup'  { name, phone, email } — customer BARU: simpan profil pending dlm loyalty_otp
//                    (kolum jsonb `pending`) + hantar OTP "sahkan pendaftaran". Verify → cipta
//                    baris customers (source portal_signup). Email dah wujud → suruh terus login.
//   action:'send'    — kini pulang { sent:false, not_found:true } kalau email TAK dikenali supaya
//                    client boleh buka borang daftar (tradeoff privasi kecil vs UX; kedai kecil OK).
//   action:'session' { token } — KEKAL LOGIN 90 hari: token stateless HMAC (tiada table sesi) —
//                    "loyalty|email|exp" ditandatangan INTERNAL_FN_SECRET; sah → pulang payload
//                    sama mcm verify. Secret tak diset → ciri sesi dimatikan senyap (OTP tiap kali).
//
// Env (Netlify): RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, INTERNAL_FN_SECRET, RECEIPT_FROM.

const crypto = require('crypto');
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const SESSION_SECRET = process.env.INTERNAL_FN_SECRET || '';
const SESSION_DAYS = 90;
const FROM_ADDR = process.env.LOYALTY_FROM || process.env.RECEIPT_FROM || '10 CAMP Rewards <admin@10camp.com>';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${res.status}: ${txt.slice(0, 200)}`);
  }
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

function isEmail(e) { return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ---- p1_1059: sesi kekal-login (stateless HMAC, 90 hari) ----
function sessSig(email, exp) {
  return crypto.createHmac('sha256', SESSION_SECRET).update('loyalty|' + email + '|' + exp).digest('hex');
}
function mintSession(email) {
  if (!SESSION_SECRET) return null;
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return Buffer.from(email, 'utf8').toString('base64url') + '.' + exp + '.' + sessSig(email, exp);
}
function checkSession(token) {
  try {
    if (!SESSION_SECRET || !token) return null;
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const email = Buffer.from(parts[0], 'base64url').toString('utf8');
    const exp = parseInt(parts[1], 10);
    if (!isEmail(email) || !exp || exp * 1000 < Date.now()) return null;
    const want = sessSig(email, exp);
    const got = parts[2];
    if (want.length !== got.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got))) return null;
    return email;
  } catch (_) { return null; }
}

// ---- p1_1130: katalog tebus mata → barang dead stock (utk papar dlm portal) ----
// Kadar & peraturan SYNC dgn app.js (LOYALTY_MATA_RM dll) — ubah sana, ubah sini sekali.
const REDEEM_RATES = { Bronze: 0.40, Silver: 0.50, VIP: 0.60 };
const REDEEM_RULES = { min_purchase: 50, freeze_months: 12, min_margin: 35, dead_days: 60 };
const CATALOG_KEY = 'deadstock_reward_catalog';
const CATALOG_TTL_MS = 6 * 3600 * 1000;

// PostgREST max-rows cap: JANGAN percaya limit besar — page manual 1000-1000.
async function sbPaged(basePath, pageSize, maxPages) {
  const out = [];
  for (let i = 0; i < (maxPages || 30); i++) {
    const page = await sb(`${basePath}&limit=${pageSize}&offset=${i * pageSize}`);
    if (Array.isArray(page)) out.push(...page);
    if (!Array.isArray(page) || page.length < pageSize) break;
  }
  return out;
}

async function getRedeemCatalog() {
  try {
    // cache 6 jam dlm app_settings (kira penuh agak berat: 3 sweep berpage)
    try {
      const cached = await sb(`/app_settings?key=eq.${CATALOG_KEY}&select=value&limit=1`);
      const v = cached && cached[0] && cached[0].value;
      if (v && v.at && (Date.now() - new Date(v.at).getTime()) < CATALOG_TTL_MS && Array.isArray(v.items)) return v.items;
    } catch (_) {}
    const prods = await sbPaged('/products_master?select=sku,name,price,cost_price&is_published=eq.true&order=sku.asc', 1000, 5);
    const batches = await sbPaged('/inventory_batches?select=sku,qty_remaining&qty_remaining=gt.0&order=id.asc', 1000, 25);
    const since = new Date(Date.now() - REDEEM_RULES.dead_days * 86400000).toISOString();
    const sales = await sbPaged(`/sales_history?select=status,is_test,items&created_at=gte.${encodeURIComponent(since)}&order=id.asc`, 1000, 10);
    const stock = {};
    batches.forEach(b => { if (b.sku) { const k = String(b.sku).toUpperCase(); stock[k] = (stock[k] || 0) + (Number(b.qty_remaining) || 0); } });
    const VOIDS = ['voided', 'cancelled', 'canceled', 'refunded'];
    const sold = {};
    sales.forEach(s => {
      if (!s || s.is_test || VOIDS.includes(String(s.status || '').toLowerCase())) return;
      let items = s.items; if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }
      if (Array.isArray(items)) items.forEach(it => { const k = String(it && it.sku || '').toUpperCase(); if (k) sold[k] = true; });
    });
    const items = prods.filter(p => {
      const k = String(p.sku || '').toUpperCase();
      const price = Number(p.price) || 0, cost = Number(p.cost_price) || 0;
      if (!k || sold[k] || (stock[k] || 0) <= 0 || price <= 0 || cost <= 0) return false;
      return ((price - cost) / price * 100) >= REDEEM_RULES.min_margin;
    }).map(p => ({ sku: p.sku, name: p.name || p.sku, price: Number(p.price) || 0 }))
      .sort((a, b) => a.price - b.price);
    try {
      await sb(`/app_settings?on_conflict=key`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ key: CATALOG_KEY, value: { at: new Date().toISOString(), items } }]) });
    } catch (_) {}
    return items;
  } catch (e) { return []; } // katalog gagal — portal cuma tak papar senarai, login tetap jalan
}

// ---- p1_1059: payload loyalti dikongsi (verify + session) ----
async function loyaltyPayload(email) {
  const custs = await sb(`/customers?email=eq.${encodeURIComponent(email)}&select=id,name,phone,points,points_redeemed,total_spent,total_orders,created_at&limit=1`);
  const c = custs && custs[0];
  if (!c) return null;
  // p1_1128 — status baju percuma tahun ini (Silver/VIP 1×/tahun) utk papar dlm portal
  let shirtClaimed = false;
  try {
    const yr = new Date().getFullYear();
    const claims = await sb(`/loyalty_shirt_claims?customer_id=eq.${c.id}&claim_year=eq.${yr}&select=id&limit=1`);
    shirtClaimed = !!(claims && claims.length);
  } catch (e) { /* table tiada / ralat — biar false, portal papar "belum" */ }
  let purchases = [];
  try {
    purchases = await sb(`/sales_history?customer_email=eq.${encodeURIComponent(email)}&select=created_at,total,total_amount,channel,items&order=created_at.desc&limit=15`) || [];
  } catch (e) { purchases = []; }
  const pSlim = (purchases || []).map(s => {
    let items = s.items; if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }
    const cnt = Array.isArray(items) ? items.reduce((n, it) => n + (parseInt(it && (it.qty != null ? it.qty : it.quantity)) || 1), 0) : 0;
    return { date: s.created_at, total: Number(s.total != null ? s.total : s.total_amount) || 0, channel: s.channel || 'POS', items: cnt };
  });
  return {
    // p1_1128 — phone utk QR Kad Ahli (staf scan di kaunter), member_since + shirt_claimed utk paparan kad
    customer: { name: c.name || '', phone: c.phone || '', points: Number(c.points) || 0, points_redeemed: Number(c.points_redeemed) || 0, total_spent: Number(c.total_spent) || 0, total_orders: Number(c.total_orders) || 0, member_since: c.created_at || null, shirt_claimed: shirtClaimed },
    purchases: pSlim,
    // p1_1130 — katalog tebus mata + kadar/peraturan (portal papar "Barang Boleh Tebus")
    redeem: { rates: REDEEM_RATES, rules: REDEEM_RULES, catalog: await getRedeemCatalog() }
  };
}

// ---- p1_1059: hantar email OTP (dikongsi login + signup) ----
async function sendOtpEmail(email, code, greetName, isSignup) {
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; max-width:440px; margin:0 auto; padding:24px;">
    <div style="text-align:center; font-weight:800; font-size:20px; color:#CD7C32; letter-spacing:1px;">10 CAMP REWARDS</div>
    <p style="font-size:14px; color:#374151; margin:18px 0 6px;">Hai${greetName ? ' ' + esc(greetName) : ''}, ${isSignup ? 'sahkan pendaftaran anda dengan kod ini' : 'ini kod masuk anda'}:</p>
    <div style="font-size:34px; font-weight:800; letter-spacing:10px; text-align:center; background:#FAF6EF; border:1px solid #F0C896; border-radius:12px; padding:16px; color:#101010; margin:8px 0;">${code}</div>
    <p style="font-size:12.5px; color:#6B7280; margin-top:14px;">Kod sah selama 10 minit. Jangan kongsi kod ini dengan sesiapa. Kalau anda tak minta kod, abaikan email ini.</p>
    <p style="font-size:11px; color:#9CA3AF; margin-top:18px;">10 CAMP &middot; admin@10camp.com</p>
  </div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_ADDR, to: email, subject: `${code} — ${isSignup ? 'Sahkan pendaftaran' : 'Kod masuk'} 10 CAMP Rewards`, html })
  });
  return r;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'POST only' }) };
  if (!SERVICE_KEY) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'SUPABASE_SERVICE_KEY tak set' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Body tak valid' }) }; }

  const action = body.action;

  // ---------- p1_1059: SESSION (kekal login — tiada email dlm body, semak SEBELUM validasi email) ----------
  if (action === 'session') {
    try {
      const sEmail = checkSession(body.token);
      if (!sEmail) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, expired: true }) };
      const payload = await loyaltyPayload(sEmail);
      if (!payload) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, expired: true }) };
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, email: sEmail, ...payload }) };
    } catch (e) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message || String(e) }) };
    }
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!isEmail(email)) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Email tak sah' }) };

  try {
    // ---------- SEND ----------
    if (action === 'send') {
      const custs = await sb(`/customers?email=eq.${encodeURIComponent(email)}&select=id,name&limit=1`);
      if (!custs || !custs.length) {
        // p1_1059 — email tak dikenali → beritahu client supaya buka borang DAFTAR (dulu generik
        // sent:true utk privasi; tradeoff kecil diterima utk UX kedai kecil — customer tak tergantung).
        return { statusCode: 200, headers: cors, body: JSON.stringify({ sent: false, not_found: true }) };
      }
      // p1_794 — cooldown: jangan hantar OTP baru kalau yang lama dihantar <60s lalu (elak spam emel + kos Resend).
      try {
        const recent = await sb(`/loyalty_otp?email=eq.${encodeURIComponent(email)}&select=created_at&limit=1`);
        if (recent && recent.length && recent[0].created_at && (Date.now() - new Date(recent[0].created_at).getTime()) < 60000) {
          return { statusCode: 200, headers: cors, body: JSON.stringify({ sent: true, cooldown: true }) };
        }
      } catch (_) { /* kalau check gagal, teruskan hantar (lebih baik dari blok sah) */ }
      if (!RESEND_KEY) return { statusCode: 200, headers: cors, body: JSON.stringify({ sent: false, reason: 'RESEND_API_KEY tak set' }) };

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      // upsert (email PK) — pending:null (login biasa, bukan signup)
      await sb('/loyalty_otp?on_conflict=email', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ email, code, expires_at: expires, attempts: 0, created_at: new Date().toISOString(), pending: null }])
      });
      const r = await sendOtpEmail(email, code, custs[0].name, false);
      const rd = await r.json().catch(() => ({}));
      if (!r.ok) return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Hantar email gagal', detail: rd.message || r.status }) };
      return { statusCode: 200, headers: cors, body: JSON.stringify({ sent: true }) };
    }

    // ---------- p1_1059: SIGNUP (customer baru — profil pending + OTP sahkan email) ----------
    if (action === 'signup') {
      const name = String(body.name || '').trim().slice(0, 60);
      const phone = String(body.phone || '').replace(/[^\d+]/g, '').slice(0, 15);
      if (name.length < 2) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, error: 'Nama terlalu pendek.' }) };
      if (phone.replace(/\D/g, '').length < 9) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, error: 'No. telefon tak sah.' }) };
      const ex = await sb(`/customers?email=eq.${encodeURIComponent(email)}&select=id&limit=1`);
      if (ex && ex.length) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, exists: true, error: 'Email ini dah berdaftar — terus log masuk.' }) };
      // cooldown sama macam send
      try {
        const recent = await sb(`/loyalty_otp?email=eq.${encodeURIComponent(email)}&select=created_at&limit=1`);
        if (recent && recent.length && recent[0].created_at && (Date.now() - new Date(recent[0].created_at).getTime()) < 60000) {
          return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, sent: true, cooldown: true }) };
        }
      } catch (_) {}
      if (!RESEND_KEY) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, error: 'Sistem email belum diset.' }) };
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await sb('/loyalty_otp?on_conflict=email', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ email, code, expires_at: expires, attempts: 0, created_at: new Date().toISOString(), pending: { name, phone } }])
      });
      const r = await sendOtpEmail(email, code, name, true);
      const rd = await r.json().catch(() => ({}));
      if (!r.ok) return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Hantar email gagal', detail: rd.message || r.status }) };
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, sent: true }) };
    }

    // ---------- VERIFY ----------
    if (action === 'verify') {
      const code = (body.code || '').trim();
      if (!/^\d{6}$/.test(code)) return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'Kod mesti 6 digit' }) };
      const rows = await sb(`/loyalty_otp?email=eq.${encodeURIComponent(email)}&select=*&limit=1`);
      const row = rows && rows[0];
      if (!row) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, error: 'Tiada kod. Hantar kod baru.' }) };
      if (new Date(row.expires_at).getTime() < Date.now()) {
        await sb(`/loyalty_otp?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, error: 'Kod dah tamat tempoh. Hantar kod baru.' }) };
      }
      // M19 (audit 2026-07-01) — increment attempts ATOMICALLY *before* checking the code, via a
      // compare-and-swap PATCH (filter attempts=eq.<seen>). Concurrent verifies used to all read the same
      // attempts value, pass the <5 check together, and burst past the 5-cap; now each guess must win a
      // CAS slot (else it re-reads + retries), so the cap holds under concurrency.
      let cur = row;
      let consumed = false;
      for (let i = 0; i < 8 && !consumed; i++) {
        const seen = cur.attempts || 0;
        if (seen >= 5) {
          await sb(`/loyalty_otp?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
          return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, error: 'Terlalu banyak cubaan. Hantar kod baru.' }) };
        }
        const won = await sb(`/loyalty_otp?email=eq.${encodeURIComponent(email)}&attempts=eq.${seen}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ attempts: seen + 1 }) });
        if (Array.isArray(won) && won.length) { consumed = true; break; }
        // CAS miss — another request incremented first; re-read latest and retry.
        const rr = await sb(`/loyalty_otp?email=eq.${encodeURIComponent(email)}&select=*&limit=1`);
        cur = rr && rr[0];
        if (!cur) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, error: 'Tiada kod. Hantar kod baru.' }) };
      }
      if (!consumed) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, error: 'Terlalu banyak cubaan serentak. Cuba lagi.' }) };
      if (String(cur.code) !== code) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, error: 'Kod salah.' }) };
      }
      // BERJAYA — buang kod (one-time)
      await sb(`/loyalty_otp?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      // p1_1059 — pendaftaran pending? Cipta akaun customer (email dah DISAHKAN melalui OTP).
      if (cur.pending && cur.pending.name) {
        const ex = await sb(`/customers?email=eq.${encodeURIComponent(email)}&select=id&limit=1`);
        if (!ex || !ex.length) {
          await sb('/customers', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify([{ name: cur.pending.name, phone: cur.pending.phone || '', email: email, points: 0, points_redeemed: 0, total_spent: 0, total_orders: 0, note: 'Daftar sendiri via Loyalty Portal (p1_1059)' }])
          });
        }
      }
      const payload = await loyaltyPayload(email);
      if (!payload) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, error: 'Akaun tak dijumpai.' }) };
      // p1_1059 — kekal login: token 90 hari (null kalau secret tak diset — client fallback OTP)
      return {
        statusCode: 200, headers: cors,
        body: JSON.stringify({ ok: true, session_token: mintSession(email), ...payload })
      };
    }

    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'action tak sah (send / signup / verify / session)' }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
