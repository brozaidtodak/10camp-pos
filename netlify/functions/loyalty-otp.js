// p1_573 — Loyalty Portal OTP (Email via Resend). Customer masuk email → kod 6-digit →
// sahkan → pulang data loyalti (tier/mata/pembelian). Server-side guna SERVICE_KEY (bypass RLS).
//
// Env (Netlify): RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, RECEIPT_FROM (optional).
//
// POST body: { action:'send', email }  ATAU  { action:'verify', email, code }

const RESEND_KEY = process.env.RESEND_API_KEY || '';
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'POST only' }) };
  if (!SERVICE_KEY) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'SUPABASE_SERVICE_KEY tak set' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Body tak valid' }) }; }

  const action = body.action;
  const email = (body.email || '').trim().toLowerCase();
  if (!isEmail(email)) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Email tak sah' }) };

  try {
    // ---------- SEND ----------
    if (action === 'send') {
      // Cari customer ikut email (jangan dedah kewujudan — sentiasa pulang sent:true)
      const custs = await sb(`/customers?email=eq.${encodeURIComponent(email)}&select=id,name&limit=1`);
      if (!custs || !custs.length) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ sent: true }) }; // generik
      }
      if (!RESEND_KEY) return { statusCode: 200, headers: cors, body: JSON.stringify({ sent: false, reason: 'RESEND_API_KEY tak set' }) };

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      // upsert (email PK)
      await sb('/loyalty_otp?on_conflict=email', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ email, code, expires_at: expires, attempts: 0, created_at: new Date().toISOString() }])
      });

      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; max-width:440px; margin:0 auto; padding:24px;">
        <div style="text-align:center; font-weight:800; font-size:20px; color:#CD7C32; letter-spacing:1px;">10 CAMP REWARDS</div>
        <p style="font-size:14px; color:#374151; margin:18px 0 6px;">Hai${custs[0].name ? ' ' + esc(custs[0].name) : ''}, ini kod masuk anda:</p>
        <div style="font-size:34px; font-weight:800; letter-spacing:10px; text-align:center; background:#FAF6EF; border:1px solid #F0C896; border-radius:12px; padding:16px; color:#101010; margin:8px 0;">${code}</div>
        <p style="font-size:12.5px; color:#6B7280; margin-top:14px;">Kod sah selama 10 minit. Jangan kongsi kod ini dengan sesiapa. Kalau anda tak minta kod, abaikan email ini.</p>
        <p style="font-size:11px; color:#9CA3AF; margin-top:18px;">10 CAMP &middot; admin@10camp.com</p>
      </div>`;

      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_ADDR, to: email, subject: `${code} — Kod masuk 10 CAMP Rewards`, html })
      });
      const rd = await r.json().catch(() => ({}));
      if (!r.ok) return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Hantar email gagal', detail: rd.message || r.status }) };
      return { statusCode: 200, headers: cors, body: JSON.stringify({ sent: true }) };
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
      if ((row.attempts || 0) >= 5) {
        await sb(`/loyalty_otp?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, error: 'Terlalu banyak cubaan. Hantar kod baru.' }) };
      }
      if (String(row.code) !== code) {
        await sb(`/loyalty_otp?email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ attempts: (row.attempts || 0) + 1 }) });
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, error: 'Kod salah.' }) };
      }
      // BERJAYA — buang kod (one-time) + pulang data loyalti
      await sb(`/loyalty_otp?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      const custs = await sb(`/customers?email=eq.${encodeURIComponent(email)}&select=id,name,phone,points,points_redeemed,total_spent,total_orders&limit=1`);
      const c = custs && custs[0];
      if (!c) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, error: 'Akaun tak dijumpai.' }) };
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
        statusCode: 200, headers: cors,
        body: JSON.stringify({
          ok: true,
          customer: { name: c.name || '', points: Number(c.points) || 0, points_redeemed: Number(c.points_redeemed) || 0, total_spent: Number(c.total_spent) || 0, total_orders: Number(c.total_orders) || 0 },
          purchases: pSlim
        })
      };
    }

    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'action tak sah (send / verify)' }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
