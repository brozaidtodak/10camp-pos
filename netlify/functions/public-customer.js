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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  let phone;
  try { phone = String((JSON.parse(event.body || '{}').phone) || '').trim(); } catch (_) { return json(400, { error: 'bad body' }); }
  if (!phone || phone.length < 6 || phone.length > 20) return json(400, { error: 'invalid phone' });
  try {
    const found = await sb('GET', `/customers?select=id,name,phone,points,total_orders,total_spent&phone=eq.${encodeURIComponent(phone)}&limit=1`);
    if (Array.isArray(found) && found.length) return json(200, { ok: true, customer: pick(found[0]), existing: true });
    // register skeleton (name filled at checkout)
    const ins = await sb('POST', '/customers', [{ name: 'Pelanggan VIP', phone, points: 0, address: '' }], { Prefer: 'return=representation' });
    const row = Array.isArray(ins) && ins[0] ? ins[0] : { name: 'Pelanggan VIP', phone, points: 0 };
    return json(200, { ok: true, customer: pick(row), existing: false });
  } catch (e) {
    return json(502, { error: 'lookup_failed', detail: String(e).slice(0, 160) });
  }
};
