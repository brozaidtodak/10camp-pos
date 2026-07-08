/**
 * client-telemetry.js — terima telemetry ringan dari POS client (p1_1085).
 *
 * POST { events: [{ type, data?, app_version?, device?, online?, staff? }] }
 * Siasatan aduan Ariff "cashier lag / Selesai tak load": checkout step-timings + JS errors
 * dari device sebenar. Gated requireAuth; insert service-role ke client_telemetry (RLS-locked).
 *
 * Caps: max 20 events/call, data JSON <= 4KB/event (dipotong), device <= 200 chars.
 */
const { requireAuth } = require('./_auth');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

function json(code, obj) {
    return { statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
    const auth = await requireAuth(event);
    if (!auth.ok) return auth.response;
    if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'bad json' }); }
    const events = Array.isArray(body.events) ? body.events.slice(0, 20) : [];
    if (!events.length) return json(400, { error: 'no events' });

    const rows = events.map(ev => {
        // p1_1088 — .slice(4096) boleh potong JSON jadi tak sah → JSON.parse throw → SELURUH batch 500.
        // Kini: kalau stringified > 4KB, simpan sebagai {truncated:"..."} (string selamat), bukan parse semula.
        let dataVal = null;
        try {
            if (ev.data != null) {
                const s = JSON.stringify(ev.data);
                dataVal = s.length <= 4096 ? ev.data : { truncated: s.slice(0, 4000) };
            }
        } catch (e) { dataVal = null; }
        return {
            staff_name: String(ev.staff || '').slice(0, 60) || null,
            event_type: String(ev.type || 'unknown').slice(0, 40),
            app_version: String(ev.app_version || '').slice(0, 20) || null,
            device: String(ev.device || '').slice(0, 200) || null,
            online: typeof ev.online === 'boolean' ? ev.online : null,
            data: dataVal
        };
    });

    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/client_telemetry`, {
            method: 'POST',
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify(rows)
        });
        if (!res.ok) return json(500, { error: 'store failed: ' + res.status });
        return json(200, { ok: true, stored: rows.length });
    } catch (e) {
        return json(500, { error: String(e && e.message || e) });
    }
};
