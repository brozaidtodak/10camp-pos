/**
 * public-checkout.js — Security Langkah B/2 (p1_648).
 *
 * Public website "Hantar & Jana Invois" — inserts the web quotation server-side
 * (service key) so the public anon key needs NO write access to quotations_log.
 * Mirrors the old processPublicCheckout() insert shape.
 *
 * POST { name, company, phone, email, items:[{sku,name,qty,price,image}] }
 *   -> { ok, ref }
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj) });
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// M6 (audit 2026-07-03) — best-effort per-IP throttle (per warm instance) to stop bots flooding the
// admin invoice inbox with junk web quotes.
const __hits = new Map();
const RL_WINDOW_MS = 10 * 60 * 1000, RL_MAX = 8;
function throttled(ip) {
  const now = Date.now();
  const arr = (__hits.get(ip) || []).filter(t => now - t < RL_WINDOW_MS);
  arr.push(now); __hits.set(ip, arr);
  if (__hits.size > 5000) { for (const k of __hits.keys()) { __hits.delete(k); if (__hits.size <= 4000) break; } }
  return arr.length > RL_MAX;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const hh = event.headers || {};
  const ip = String(hh['x-nf-client-connection-ip'] || (hh['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();
  if (throttled(ip)) return json(429, { error: 'too_many_requests', reason: 'Terlalu banyak permintaan. Cuba lagi sekejap.' });
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad body' }); }
  const name = String(b.name || '').trim(), company = String(b.company || '').trim();
  const phone = String(b.phone || '').trim(), email = String(b.email || '').trim();
  const items = Array.isArray(b.items) ? b.items : [];
  if (!name || !phone || !email) return json(400, { error: 'missing fields' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: 'bad email' });
  if (!items.length) return json(400, { error: 'empty cart' });

  // M6 — HARGA dari server (public_products view), BUKAN dari client. Dulu percaya it.price → bot boleh
  // jana invois harga palsu (RM1). SKU yang tak wujud/tak published digugurkan.
  const skus = [...new Set(items.slice(0, 200).map(it => String(it.sku || '').trim().toUpperCase()).filter(Boolean))];
  let priceMap = {};
  if (skus.length) {
    try {
      const inList = skus.map(s => '"' + s.replace(/"/g, '') + '"').join(',');
      const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/public_products?select=sku,price,name&sku=in.(${encodeURIComponent(inList)})`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      })).json();
      (Array.isArray(rows) ? rows : []).forEach(r => { priceMap[String(r.sku).toUpperCase()] = { price: Number(r.price) || 0, name: r.name || '' }; });
    } catch (_) { /* fall through — empty map drops all lines below */ }
  }

  // recompute totals server-side from the catalogue price (don't trust client subtotal OR price)
  let subtotal = 0;
  const clean = items.slice(0, 200).map(it => {
    const skuU = String(it.sku || '').trim().toUpperCase();
    const cat = priceMap[skuU];
    if (!cat) return null; // SKU tak sah / tak published → gugur
    const qty = Math.max(0, Math.floor(Number(it.qty) || 0));
    if (qty <= 0) return null;
    const price = round2(cat.price);
    const line = round2(price * qty);
    subtotal = round2(subtotal + line);
    return { sku: String(it.sku || '').slice(0, 64), name: (cat.name || String(it.name || '')).slice(0, 200), qty, price, line_total: line, image: String(it.image || '').slice(0, 500) };
  }).filter(Boolean);
  if (!clean.length) return json(400, { error: 'no_valid_items' });
  const ref = 'WEB-' + String(Date.now()).slice(-7);
  const custStr = name + (company ? ' (' + company + ')' : '') + ' · ' + phone + ' · ' + email;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/quotations_log`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify([{
        id: ref + '-v1', ref, version: 1, type: 'Web Invoice', customer: custStr,
        terms: 'Permohonan invois dari website 10camp.com — menunggu pengesahan admin.',
        subtotal, grand_total: subtotal, items: clean, superseded: false
      }])
    });
    if (!res.ok) { const t = await res.text(); return json(502, { error: 'insert_failed', detail: t.slice(0, 200) }); }
    return json(200, { ok: true, ref });
  } catch (e) {
    return json(502, { error: 'exception', detail: String(e).slice(0, 160) });
  }
};
