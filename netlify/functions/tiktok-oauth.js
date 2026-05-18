/**
 * TikTok Shop OAuth callback — Netlify Function (p3_1 direct integration, Phase 1).
 *
 * Flow:
 *   1. Seller authorizes the app via the TikTok authorization link.
 *   2. TikTok redirects here with ?code=<auth_code>&state=<state>.
 *      (On rejection: ?code=null&error=auth_denied)
 *   3. This function exchanges auth_code for access_token + refresh_token
 *      via GET https://auth.tiktok-shops.com/api/v2/token/get
 *   4. Tokens are stored in Supabase public.tiktok_tokens (RLS-locked,
 *      service-role only).
 *
 * Public URL: https://pos.10camp.com/api/tiktok-oauth
 *
 * Env vars (set in Netlify dashboard):
 *   TIKTOK_APP_KEY        — app key from TikTok Shop Partner Center
 *   TIKTOK_APP_SECRET     — app secret (regenerated; never commit)
 *   SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_KEY  — Supabase service_role key (bypasses RLS)
 *
 * Note: auth_code expires in 30 minutes and is single-use.
 */

const TOKEN_ENDPOINT = 'https://auth.tiktok-shops.com/api/v2/token/get';

const APP_KEY     = process.env.TIKTOK_APP_KEY || '';
const APP_SECRET  = process.env.TIKTOK_APP_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

function page(title, message, ok) {
    const color = ok ? '#10B981' : '#EF4444';
    return `<!doctype html><html lang="ms"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
 body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
   background:#F4F6F8;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
 .card{background:#fff;border-radius:14px;padding:36px 40px;max-width:480px;
   box-shadow:0 12px 40px rgba(0,0,0,.12);text-align:center}
 .dot{width:54px;height:54px;border-radius:50%;background:${color};margin:0 auto 18px;
   display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;font-weight:800}
 h1{font-size:19px;color:#111827;margin:0 0 8px}
 p{font-size:14px;color:#6B7280;line-height:1.6;margin:0}
</style></head><body>
<div class="card"><div class="dot">${ok ? '&#10003;' : '&#33;'}</div>
<h1>${title}</h1><p>${message}</p></div></body></html>`;
}

function html(statusCode, body) {
    return { statusCode, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body };
}

exports.handler = async (event) => {
    const q = event.queryStringParameters || {};

    // 1. Seller rejected, or no code returned
    if (q.error || !q.code || q.code === 'null') {
        return html(400, page(
            'Authorization Dibatalkan',
            'TikTok tak hantar kod kebenaran. Cuba semula link authorize, dan pastikan klik "Authorize" / "Confirm".',
            false));
    }

    // 2. Config guard
    if (!APP_KEY || !APP_SECRET) {
        return html(500, page('Setup Belum Lengkap',
            'TIKTOK_APP_KEY / TIKTOK_APP_SECRET belum diset dalam Netlify environment variables.', false));
    }
    if (!SERVICE_KEY) {
        return html(500, page('Setup Belum Lengkap',
            'SUPABASE_SERVICE_KEY belum diset dalam Netlify environment variables.', false));
    }

    try {
        // 3. Exchange auth_code → access_token (no signature needed for this endpoint)
        const url = `${TOKEN_ENDPOINT}?app_key=${encodeURIComponent(APP_KEY)}`
            + `&app_secret=${encodeURIComponent(APP_SECRET)}`
            + `&auth_code=${encodeURIComponent(q.code)}`
            + `&grant_type=authorized_code`;

        const res = await fetch(url, { method: 'GET' });
        const json = await res.json();

        if (json.code !== 0 || !json.data || !json.data.access_token) {
            return html(502, page('Token Exchange Gagal',
                `TikTok tolak permintaan: ${json.message || 'ralat tidak diketahui'} `
                + `(code ${json.code}). auth_code mungkin dah luput (30 min) atau dah guna. `
                + `Cuba authorize semula untuk kod baru.`, false));
        }

        const d = json.data;
        const row = {
            open_id: d.open_id,
            seller_name: d.seller_name || null,
            seller_base_region: d.seller_base_region || null,
            access_token: d.access_token,
            access_token_expire_at: new Date((d.access_token_expire_in || 0) * 1000).toISOString(),
            refresh_token: d.refresh_token,
            refresh_token_expire_at: new Date((d.refresh_token_expire_in || 0) * 1000).toISOString(),
            granted_scopes: d.granted_scopes || [],
            user_type: typeof d.user_type === 'number' ? d.user_type : null,
            updated_at: new Date().toISOString()
        };

        // 4. Upsert into Supabase (service-role key bypasses RLS)
        const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/tiktok_tokens?on_conflict=open_id`, {
            method: 'POST',
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'resolution=merge-duplicates,return=minimal'
            },
            body: JSON.stringify(row)
        });

        if (!sbRes.ok) {
            const errText = await sbRes.text();
            return html(502, page('Token Dapat, Tapi Gagal Simpan',
                `Access token diterima dari TikTok tapi gagal simpan ke Supabase: `
                + `${sbRes.status} ${errText.slice(0, 200)}`, false));
        }

        return html(200, page('Berjaya Disambung!',
            `Kedai TikTok "${d.seller_name || d.open_id}" dah bersambung dengan POS 10 CAMP. `
            + `Access token disimpan selamat. Boleh tutup tab ni — bagitau Claude "dah connect".`, true));

    } catch (err) {
        return html(500, page('Ralat Tak Dijangka',
            `Sesuatu tak kena masa proses authorization: ${String(err).slice(0, 200)}`, false));
    }
};
