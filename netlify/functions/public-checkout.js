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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad body' }); }
  const name = String(b.name || '').trim(), company = String(b.company || '').trim();
  const phone = String(b.phone || '').trim(), email = String(b.email || '').trim();
  const items = Array.isArray(b.items) ? b.items : [];
  if (!name || !phone || !email) return json(400, { error: 'missing fields' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: 'bad email' });
  if (!items.length) return json(400, { error: 'empty cart' });

  // recompute totals server-side (don't trust client subtotal)
  let subtotal = 0;
  const clean = items.slice(0, 200).map(it => {
    const qty = Math.max(0, Math.floor(Number(it.qty) || 0));
    const price = round2(it.price);
    const line = round2(price * qty);
    subtotal = round2(subtotal + line);
    return { sku: String(it.sku || '').slice(0, 64), name: String(it.name || '').slice(0, 200), qty, price, line_total: line, image: String(it.image || '').slice(0, 500) };
  });
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
