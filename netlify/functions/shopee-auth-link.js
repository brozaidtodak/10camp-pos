/**
 * Shopee Open Platform — Generate Authorization Link (p3_1 Shopee Fasa 1).
 *
 * Flow:
 *   1. POS UI (Sync settings) calls GET /api/shopee-auth-link
 *   2. This function constructs the authorization URL with timestamp + HMAC-SHA256 sign
 *      (sign needs partner_key which is server-side env var, so URL must be built here).
 *   3. UI opens the returned URL in a new tab/window.
 *   4. Shop owner logs in to Shopee + authorizes the app.
 *   5. Shopee redirects to /api/shopee-oauth with ?code=...&shop_id=...
 *
 * Public URL: https://pos.10camp.com/api/shopee-auth-link
 *
 * Env vars (Netlify):
 *   SHOPEE_PARTNER_ID  — numeric partner_id from Shopee Open Platform
 *   SHOPEE_PARTNER_KEY — partner key (secret, hex string)
 *   SHOPEE_ENV         — 'sandbox' (default) or 'live'
 */

const crypto = require('crypto');

const PARTNER_ID  = process.env.SHOPEE_PARTNER_ID || '';
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY || '';
const ENV         = (process.env.SHOPEE_ENV || 'sandbox').toLowerCase();

// Shopee MY hosts (verified via API Test Tool 2026-05-25):
//   Sandbox: openplatform.sandbox.test-stable.shopee.sg
//   Live:    partner.shopeemobile.com (MY production)
const HOST = ENV === 'live'
    ? 'https://partner.shopeemobile.com'
    : 'https://openplatform.sandbox.test-stable.shopee.sg';

const PATH = '/api/v2/shop/auth_partner';
const REDIRECT = 'https://pos.10camp.com/api/shopee-oauth';

exports.handler = async () => {
    if (!PARTNER_ID || !PARTNER_KEY) {
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ok: false, error: 'SHOPEE_PARTNER_ID atau SHOPEE_PARTNER_KEY belum diset dalam Netlify env vars.' })
        };
    }

    // Shopee V2 sign formula: HMAC-SHA256(partner_id + api_path + timestamp, partner_key)
    const timestamp = Math.floor(Date.now() / 1000);
    const baseString = `${PARTNER_ID}${PATH}${timestamp}`;
    const sign = crypto.createHmac('sha256', PARTNER_KEY).update(baseString).digest('hex');

    const url = `${HOST}${PATH}`
        + `?partner_id=${encodeURIComponent(PARTNER_ID)}`
        + `&timestamp=${timestamp}`
        + `&sign=${sign}`
        + `&redirect=${encodeURIComponent(REDIRECT)}`;

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ ok: true, url, env: ENV, expires_in_seconds: 600 })
    };
};
