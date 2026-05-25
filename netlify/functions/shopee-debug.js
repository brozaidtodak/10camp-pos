/**
 * Shopee Debug — diagnostic endpoint. Returns enough info to verify
 * env vars + sign generation without leaking the full partner_key.
 *
 * Public URL: https://pos.10camp.com/api/shopee-debug
 *
 * Safe to expose: shows only first 4 + last 4 chars of partner_key.
 */

const crypto = require('crypto');

exports.handler = async () => {
    const PARTNER_ID  = process.env.SHOPEE_PARTNER_ID || '';
    const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY || '';
    const ENV         = (process.env.SHOPEE_ENV || 'sandbox').toLowerCase();

    const HOST = ENV === 'live'
        ? 'https://partner.shopeemobile.com'
        : 'https://partner.test-stable.shopeemobile.com';

    const PATH = '/api/v2/shop/auth_partner';
    const timestamp = Math.floor(Date.now() / 1000);
    const baseString = `${PARTNER_ID}${PATH}${timestamp}`;

    let sign = '';
    let signError = '';
    try {
        sign = crypto.createHmac('sha256', PARTNER_KEY).update(baseString).digest('hex');
    } catch(e) {
        signError = e.message;
    }

    // Mask partner_key: show first 4 + last 4 chars + length, hide middle
    const keyLen = PARTNER_KEY.length;
    const keyPreview = keyLen >= 8
        ? `${PARTNER_KEY.slice(0, 4)}...${PARTNER_KEY.slice(-4)} (length=${keyLen})`
        : `<too short, length=${keyLen}>`;

    // Check for whitespace issues
    const hasLeadingWs = PARTNER_KEY !== PARTNER_KEY.trimStart();
    const hasTrailingWs = PARTNER_KEY !== PARTNER_KEY.trimEnd();
    const hasNewline = PARTNER_KEY.includes('\n') || PARTNER_KEY.includes('\r');

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({
            env: ENV,
            host: HOST,
            partner_id: PARTNER_ID,
            partner_id_length: String(PARTNER_ID).length,
            partner_key_preview: keyPreview,
            partner_key_length: keyLen,
            partner_key_starts_with_shpk: PARTNER_KEY.startsWith('shpk'),
            whitespace_check: {
                leading: hasLeadingWs,
                trailing: hasTrailingWs,
                newline: hasNewline,
                trimmed_length: PARTNER_KEY.trim().length
            },
            sign_calc: {
                timestamp,
                base_string: baseString,
                sign: sign,
                sign_length: sign.length,
                sign_error: signError
            },
            sample_auth_url: `${HOST}${PATH}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}&redirect=${encodeURIComponent('https://pos.10camp.com/api/shopee-oauth')}`
        }, null, 2)
    };
};
