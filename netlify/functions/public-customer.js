/**
 * public-customer.js — Security Langkah B/1 (p1_648).
 *
 * Public VIP login lookup/register, server-side (service key). Replaces the old
 * handleCustomerLogin() which searched the ENTIRE customers table loaded into every
 * visitor's browser (the PII leak). Now the client sends ONE phone number and gets
 * back ONLY that customer's minimal info (or a freshly-created skeleton).
 *
 * POST { phone }  ->  { ok, customer: { id, name, phone, points, total_orders, total_spent } }
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj) });

async function sb(method, path, body, extra) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: Object.assign({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, extra || {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`db ${res.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const pick = (c) => c ? { id: c.id, name: c.name, phone: c.phone, points: c.points || 0, total_orders: c.total_orders || 0, total_spent: c.total_spent || 0 } : null;

// H3 (audit 2026-07-03) — best-effort per-IP throttle to slow phone enumeration (harvest nama+points).
// Per warm instance (Map); not perfect across instances but adds real friction to bulk scans.
const __hits = new Map(); // ip -> [ts,...]
const RL_WINDOW_MS = 5 * 60 * 1000;
const RL_MAX = 15; // 15 lookup / 5 min / IP
function throttled(ip) {
  const now = Date.now();
  const arr = (__hits.get(ip) || []).filter(t => now - t < RL_WINDOW_MS);
  arr.push(now);
  __hits.set(ip, arr);
  if (__hits.size > 5000) { for (const k of __hits.keys()) { __hits.delete(k); if (__hits.size <= 4000) break; } } // bound memory
  return arr.length > RL_MAX;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const h = event.headers || {};
  const ip = String(h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();
  if (throttled(ip)) return json(429, { error: 'too_many_requests', reason: 'Terlalu banyak carian. Cuba lagi sekejap.' });
  let phone;
  try { phone = String((JSON.parse(event.body || '{}').phone) || '').trim(); } catch (_) { return json(400, { error: 'bad body' }); }
  if (!phone || phone.length < 6 || phone.length > 20) return json(400, { error: 'invalid phone' });
  try {
    const found = await sb('GET', `/customers?select=id,name,phone,points,total_orders,total_spent&phone=eq.${encodeURIComponent(phone)}&limit=1`);
    if (Array.isArray(found) && found.length) return json(200, { ok: true, customer: pick(found[0]), existing: true });
    // H3 — JANGAN auto-create baris pada lookup (dulu inject "Pelanggan VIP" junk rows utk tiap nombor
    // rawak). Pulang null; klien (handleCustomerLogin) sudah fallback ke skeleton sendiri, dan baris
    // customer sebenar dicipta masa checkout pertama.
    return json(200, { ok: true, customer: null, existing: false });
  } catch (e) {
    return json(502, { error: 'lookup_failed', detail: String(e).slice(0, 160) });
  }
};
