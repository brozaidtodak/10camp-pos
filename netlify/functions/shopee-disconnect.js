/**
 * Shopee Disconnect — Netlify Function (p1_98 Fasa 3B).
 *
 * Removes the stored token row from public.shopee_tokens, effectively
 * disconnecting POS from the Shopee shop. After this, sync/webhook
 * cannot fetch order details anymore.
 *
 * Public URL: https://www.10camp.com/api/shopee-disconnect
 *
 * Methods:
 *   GET  — list current connected shops (status check)
 *   POST — delete token row (body: { shop_id?: number }; omit to delete all for current env)
 *
 * Note: this does NOT call Shopee's cancel_authorization API. To fully
 * revoke from Shopee's side, shop owner must disconnect via Shopee Seller
 * Centre → Apps → Disconnect 10 CAMP POS Sync.
 */

const ENV          = (process.env.SHOPEE_ENV || 'sandbox').toLowerCase();
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

function json(statusCode, obj) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(obj, null, 2)
    };
}

async function sb(method, path, body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method,
        headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
    return text ? (text.startsWith('[') || text.startsWith('{') ? JSON.parse(text) : text) : null;
}

exports.handler = async (event) => {
    if (!SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY not set' });

    try {
        // GET — list connected shops
        if (event.httpMethod === 'GET') {
            const res = await fetch(
                `${SUPABASE_URL}/rest/v1/shopee_tokens?environment=eq.${ENV}&select=shop_id,partner_id,access_token_expire_at,refresh_token_expire_at,created_at,updated_at`,
                { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
            );
            const rows = await res.json();
            return json(200, { env: ENV, connected: rows || [], count: (rows || []).length });
        }

        // POST — disconnect
        if (event.httpMethod === 'POST') {
            let payload = {};
            try { payload = event.body ? JSON.parse(event.body) : {}; } catch(e) {}
            const filter = payload.shop_id
                ? `shop_id=eq.${payload.shop_id}`
                : `environment=eq.${ENV}`;
            await sb('DELETE', `/shopee_tokens?${filter}`);
            return json(200, { ok: true, deleted_filter: filter, env: ENV });
        }

        return { statusCode: 405, body: 'method not allowed' };

    } catch (err) {
        return json(500, { error: String(err) });
    }
};
