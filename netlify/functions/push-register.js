/**
 * push-register.js — daftar/refresh token push peranti staf (p1_1119).
 * POST { token, platform: 'ios'|'android'|'web', staff_id, staff_name }
 * Auth: staff session (requireStaff) — sama gate macam fn chat.
 */

const { requireStaff } = require('./_auth');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
    const gate = await requireStaff(event);
    if (!gate.ok) return gate.response;

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}
    const token = String(body.token || '').trim();
    const platform = ['ios', 'android', 'web'].includes(body.platform) ? body.platform : 'unknown';
    if (!token || token.length < 20 || token.length > 4096) {
        return { statusCode: 400, body: JSON.stringify({ error: 'token tak sah' }) };
    }

    const row = {
        token,
        platform,
        staff_id: String(body.staff_id || '').slice(0, 40) || null,
        staff_name: String(body.staff_name || '').slice(0, 80) || null,
        last_seen: new Date().toISOString()
    };
    const res = await fetch(SUPABASE_URL + '/rest/v1/push_tokens?on_conflict=token', {
        method: 'POST',
        headers: {
            apikey: SERVICE_KEY,
            Authorization: 'Bearer ' + SERVICE_KEY,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify([row])
    });
    if (!res.ok) return { statusCode: 500, body: JSON.stringify({ error: 'simpan gagal', detail: (await res.text()).slice(0, 200) }) };
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
