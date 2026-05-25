/**
 * Shopee Open Platform OAuth callback — Netlify Function (p3_1 Shopee Fasa 1).
 *
 * Flow:
 *   1. Shop owner authorizes via Shopee auth URL (built by /api/shopee-auth-link).
 *   2. Shopee redirects here with ?code=<auth_code>&shop_id=<shop_id>.
 *   3. This function POSTs to /api/v2/auth/token/get to exchange code → access_token + refresh_token.
 *   4. Tokens saved to Supabase public.shopee_tokens (RLS-locked, service-role only).
 *
 * Public URL: https://pos.10camp.com/api/shopee-oauth
 *
 * Env vars (Netlify):
 *   SHOPEE_PARTNER_ID    — numeric partner_id
 *   SHOPEE_PARTNER_KEY   — partner key (secret)
 *   SHOPEE_ENV           — 'sandbox' (default) or 'live'
 *   SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service_role key (bypasses RLS)
 *
 * Note: auth_code expires in 10 minutes and is single-use.
 */

const crypto = require('crypto');

const PARTNER_ID  = process.env.SHOPEE_PARTNER_ID || '';
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY || '';
const ENV         = (process.env.SHOPEE_ENV || 'sandbox').toLowerCase();
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

// Shopee MY hosts (verified via API Test Tool 2026-05-25):
//   Sandbox: openplatform.sandbox.test-stable.shopee.sg
//   Live:    partner.shopeemobile.com (MY production)
const HOST = ENV === 'live'
    ? 'https://partner.shopeemobile.com'
    : 'https://openplatform.sandbox.test-stable.shopee.sg';

const TOKEN_PATH = '/api/v2/auth/token/get';

function page(title, message, ok) {
    const color = ok ? '#10B981' : '#EF4444';
    return `<!doctype html><html lang="ms"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
 body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
   background:#F4F6F8;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
 .card{background:#fff;border-radius:14px;padding:36px 40px;max-width:520px;
   box-shadow:0 12px 40px rgba(0,0,0,.12);text-align:center}
 .dot{width:54px;height:54px;border-radius:50%;background:${color};margin:0 auto 18px;
   display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;font-weight:800}
 h1{font-size:19px;color:#111827;margin:0 0 8px}
 p{font-size:14px;color:#6B7280;line-height:1.6;margin:0}
 .env{display:inline-block;margin-top:12px;padding:3px 10px;border-radius:99px;
   background:#FEF3C7;color:#92400E;font-size:11px;font-weight:700;text-transform:uppercase}
</style></head><body>
<div class="card"><div class="dot">${ok ? '&#10003;' : '&#33;'}</div>
<h1>${title}</h1><p>${message}</p>
${ENV !== 'live' ? `<div class="env">Sandbox · Test</div>` : ''}
</div></body></html>`;
}

function html(statusCode, body) {
    return { statusCode, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body };
}

exports.handler = async (event) => {
    const q = event.queryStringParameters || {};

    // 1. No code or shop_id returned (user rejected, or hit URL directly)
    if (!q.code || !q.shop_id) {
        return html(400, page(
            'Authorization Dibatalkan',
            'Shopee tak hantar kod kebenaran. Cuba klik "Connect Shopee Shop" semula dari POS, dan pastikan tekan butang "Confirm Authorization" di halaman Shopee.',
            false));
    }

    // 2. Config guard
    if (!PARTNER_ID || !PARTNER_KEY) {
        return html(500, page('Setup Belum Lengkap',
            'SHOPEE_PARTNER_ID atau SHOPEE_PARTNER_KEY belum diset dalam Netlify environment variables.', false));
    }
    if (!SERVICE_KEY) {
        return html(500, page('Setup Belum Lengkap',
            'SUPABASE_SERVICE_KEY belum diset dalam Netlify environment variables.', false));
    }

    try {
        // 3. Build sign for token/get: HMAC-SHA256(partner_id + path + timestamp, partner_key)
        const timestamp = Math.floor(Date.now() / 1000);
        const baseString = `${PARTNER_ID}${TOKEN_PATH}${timestamp}`;
        const sign = crypto.createHmac('sha256', PARTNER_KEY).update(baseString).digest('hex');

        const url = `${HOST}${TOKEN_PATH}`
            + `?partner_id=${encodeURIComponent(PARTNER_ID)}`
            + `&timestamp=${timestamp}`
            + `&sign=${sign}`;

        const tokenRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: q.code,
                shop_id: Number(q.shop_id),
                partner_id: Number(PARTNER_ID)
            })
        });

        const json = await tokenRes.json();

        if (json.error || !json.access_token) {
            return html(502, page('Token Exchange Gagal',
                `Shopee tolak permintaan: ${json.message || json.error || 'ralat tidak diketahui'}. `
                + `auth_code mungkin dah luput (10 minit) atau dah guna. Cuba authorize semula untuk kod baru.`, false));
        }

        const nowMs = Date.now();
        const row = {
            shop_id: Number(q.shop_id),
            partner_id: Number(PARTNER_ID),
            access_token: json.access_token,
            access_token_expire_at: new Date(nowMs + (Number(json.expire_in || 14400) * 1000)).toISOString(),
            refresh_token: json.refresh_token,
            // Shopee refresh_token: valid 30 days from issue
            refresh_token_expire_at: new Date(nowMs + (30 * 24 * 3600 * 1000)).toISOString(),
            environment: ENV,
            merchant_id_list: Array.isArray(json.merchant_id_list) ? json.merchant_id_list : null,
            shop_id_list: Array.isArray(json.shop_id_list) ? json.shop_id_list : null,
            updated_at: new Date().toISOString()
        };

        // 4. Upsert into Supabase (service-role key bypasses RLS)
        const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/shopee_tokens?on_conflict=shop_id`, {
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
                `Access token diterima dari Shopee tapi gagal simpan ke Supabase: `
                + `${sbRes.status} ${errText.slice(0, 200)}. `
                + `Periksa table public.shopee_tokens dah dicipta dan SUPABASE_SERVICE_KEY betul.`, false));
        }

        return html(200, page('Berjaya Disambung!',
            `Kedai Shopee shop_id ${q.shop_id} dah bersambung dengan POS 10 CAMP. `
            + `Access token disimpan selamat (refresh otomatik 4 jam sekali). `
            + `Boleh tutup tab ni — kembali ke POS dan bagitau Claude "Shopee dah connect".`, true));

    } catch (err) {
        return html(500, page('Ralat Tak Dijangka',
            `Sesuatu tak kena masa proses authorization: ${String(err).slice(0, 200)}`, false));
    }
};
