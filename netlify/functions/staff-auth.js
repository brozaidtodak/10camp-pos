/**
 * staff-auth.js — Integration/security hardening (Langkah A, p1_647).
 *
 * Turns a PIN login into a REAL Supabase `authenticated` session WITHOUT shipping any
 * secret to the browser. Flow:
 *   client POST { staff_id, pin }
 *     → this fn (holds SERVICE key) verifies the PIN server-side (same salted SHA-256
 *       as the client's hashPin), rate-limits by IP,
 *     → mints a one-time magiclink via the GoTrue Admin API (admin/generate_link),
 *     → returns { token_hash } which the client redeems with supabase.auth.verifyOtp()
 *       to obtain an authenticated session.
 *
 * Purpose: once every logged-in staff session is `authenticated`, RLS can be locked so
 * the public anon key no longer reads customers/sales/finance (Langkah B).
 *
 * NOTE: pin_hashes mirror the client authUsers (already public) — no extra exposure.
 * Future: move pin auth fully server-side + stronger PINs.
 */
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const SALT = '10camp_salt_v1';
const MAX_ATTEMPTS = 12;          // per IP per window
const WINDOW_MIN = 10;

// staff_id -> { email, pin_hash }  (exact mirror of client authUsers)
const STAFF = {
  CMP001: { email: 'zaid@10camp.com',          pin_hash: '50d1e0682d0e472acc6a9dc109911c4703ddb14ebfa90c3b051f541111626343' },
  CMP008: { email: 'aliff@10camp.com',         pin_hash: '33ffc079d45afe132295ee5e09980e872c3be2334df23aeb1ee52d0c7c9cfcec' },
  CMP010: { email: 'farhanwakiman@10camp.com', pin_hash: 'bed579f196a5bbb1ffbf1ba2b3c9bdd754a28680861ce96103794e25527d914e' },
  CMP005: { email: 'zack@10camp.com',          pin_hash: 'e5f99d4a4886603bb5c9dd78b4c529ee3657dcf6818a93aff697f7436eef36ca' },
  CMP006: { email: 'ariff@10camp.com',         pin_hash: '3392222a8b235180e57307768e7f2200e8ca4ae32ea6cd065572d22f5a7923d7' },
  CMP003: { email: 'irfan@10camp.com',         pin_hash: '1ac46628226b2db70ab61adf7e7912aa6456b7c703c1b922a9a5bba78d16396c' },
  CMP011: { email: 'tarmizi@10camp.com',       pin_hash: '4c3c39d9b9cd41540b359ffed45b97d5b76b04a6461d1cdedb79eb4003727779' },
  CMP009: { email: 'fahmi@10camp.com',         pin_hash: '1eeab06ad295d2d41259419cb3a5d1d914ddd9c9e70c66e658042341986c91de' },
  TST001: { email: 'tester@10camp.com',        pin_hash: '0992063d103f60eaac866479931a0a052aea264d4c761ceb643fdda2b4c322ef' },
  REV001: { email: 'reviewer@10camp.com',      pin_hash: '7eef95c334de83025794ebde3656eb0b4aaee684e5ac458524b9c88e5a304c2e' },
};

const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj) });
const hashPin = (staffId, pin) => crypto.createHash('sha256').update(`${staffId}:${pin}:${SALT}`).digest('hex');

async function sb(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (method === 'GET') { const t = await res.text(); return t ? JSON.parse(t) : []; }
  return res.ok;
}

// custom PIN hash dari DB (staf set sendiri) — override hardcoded kalau ada. Fail → null (fallback).
async function customHash(staff_id) {
  try {
    const rows = await sb('GET', `/staff_pins?staff_id=eq.${encodeURIComponent(staff_id)}&select=pin_hash`);
    return (Array.isArray(rows) && rows[0] && rows[0].pin_hash) ? rows[0].pin_hash : null;
  } catch (_) { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  let staff_id, pin, action;
  try { const b = JSON.parse(event.body || '{}'); staff_id = String(b.staff_id || '').trim(); pin = String(b.pin || '').trim(); action = String(b.action || '').trim(); } catch (_) { return json(400, { error: 'bad body' }); }

  // ── SET PIN — staf yang dah login (email) tetapkan/tukar PIN sendiri. Perlu JWT staf. ──
  if (action === 'set_pin') {
    if (!/^\d{4,8}$/.test(pin)) return json(400, { error: 'invalid_pin_format' });
    if (/^(\d)\1+$/.test(pin)) return json(400, { error: 'weak_pin' }); // semua digit sama
    const auth = event.headers['authorization'] || event.headers['Authorization'] || '';
    const m = /Bearer\s+(.+)/i.exec(auth);
    if (!m) return json(401, { error: 'no_token' });
    let email = '';
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${m[1].trim()}` } });
      if (!r.ok) return json(401, { error: 'invalid_session' });
      const u = await r.json();
      email = String((u && u.email) || '').toLowerCase();
      if (!email || u.aud !== 'authenticated') return json(401, { error: 'not_authenticated' });
    } catch (e) { return json(401, { error: 'auth_check_failed' }); }
    const entry = Object.entries(STAFF).find(([, rec]) => rec.email.toLowerCase() === email);
    if (!entry) return json(403, { error: 'not_staff' });
    const sid = entry[0];
    const newHash = hashPin(sid, pin);
    // upsert ke staff_pins (service-role)
    const up = await fetch(`${SUPABASE_URL}/rest/v1/staff_pins?on_conflict=staff_id`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ staff_id: sid, pin_hash: newHash, updated_at: new Date().toISOString(), updated_by: email })
    });
    if (!up.ok) return json(502, { error: 'save_failed', detail: ('http ' + up.status) });
    return json(200, { ok: true, staff_id: sid });
  }

  if (!staff_id || !/^\d{4,8}$/.test(pin)) return json(400, { error: 'invalid input' });

  const ip = (event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const since = new Date(Date.now() - WINDOW_MIN * 60000).toISOString();

  // rate limit by IP
  try {
    const rows = await sb('GET', `/auth_attempts?select=id&ip=eq.${encodeURIComponent(ip)}&created_at=gte.${encodeURIComponent(since)}`);
    if (Array.isArray(rows) && rows.length >= MAX_ATTEMPTS) return json(429, { error: 'too_many_attempts' });
  } catch (_) {}

  const rec = STAFF[staff_id];
  // DB-first: kalau staf dah set PIN sendiri, guna hash tu; jika tidak / DB gagal → hardcoded.
  const custom = await customHash(staff_id);
  const expected = custom || (rec ? rec.pin_hash : null);
  const ok = !!expected && hashPin(staff_id, pin) === expected;
  try { await sb('POST', '/auth_attempts', { ip, staff_id, ok }); } catch (_) {}

  if (!ok) return json(401, { error: 'invalid_pin' });

  // mint a magiclink via GoTrue admin → token_hash for client verifyOtp
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', email: rec.email })
    });
    const j = await r.json();
    if (!r.ok) return json(502, { error: 'link_failed', detail: (j && (j.msg || j.error_description || j.error)) || ('http ' + r.status) });
    const token_hash = j.hashed_token || (j.properties && j.properties.hashed_token);
    if (!token_hash) return json(502, { error: 'no_token' });
    return json(200, { ok: true, email: rec.email, token_hash, email_otp: j.email_otp || (j.properties && j.properties.email_otp) || null });
  } catch (e) {
    return json(502, { error: 'mint_exception', detail: String(e).slice(0, 160) });
  }
};
