/**
 * Shopee Debug — diagnostic endpoint. Returns enough info to verify
 * env vars + sign generation without leaking the full partner_key.
 *
 * Public URL: https://www.10camp.com/api/shopee-debug
 *
 * Safe to expose: shows only first 4 + last 4 chars of partner_key.
 */

const crypto = require('crypto');

exports.handler = async () => {
    const PARTNER_ID  = process.env.SHOPEE_PARTNER_ID || '';
    const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY || '';
    const ENV         = (process.env.SHOPEE_ENV || 'sandbox').toLowerCase();

    // Shopee MY hosts (verified via API Test Tool 2026-05-25):
    //   Sandbox: openplatform.sandbox.test-stable.shopee.sg
    //   Live:    partner.shopeemobile.com
    const HOST = ENV === 'live'
        ? 'https://partner.shopeemobile.com'
        : 'https://openplatform.sandbox.test-stable.shopee.sg';

    const PATH = '/api/v2/shop/auth_partner';
    const timestamp = Math.floor(Date.now() / 1000);
    const baseString = `${PARTNER_ID}${PATH}${timestamp}`;

    // Try 3 sign variants to identify which one Shopee accepts
    let signA = '', signB = '', signC = '', signError = '';
    const keyB = PARTNER_KEY.replace(/^shpk/, ''); // strip prefix
    let keyC = null;
    try {
        signA = crypto.createHmac('sha256', PARTNER_KEY).update(baseString).digest('hex');
        signB = crypto.createHmac('sha256', keyB).update(baseString).digest('hex');
        try { keyC = Buffer.from(keyB, 'hex'); } catch(e){}
        if (keyC) signC = crypto.createHmac('sha256', keyC).update(baseString).digest('hex');
    } catch(e) {
        signError = e.message;
    }
    const sign = signA; // keep var name for downstream usage

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
                signA_full_key: signA,
                signB_strip_shpk_prefix: signB,
                signC_hex_decode_after_strip: signC,
                sign_error: signError
            },
            test_urls: {
                A: `${HOST}${PATH}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${signA}&redirect=${encodeURIComponent('https://www.10camp.com/api/shopee-oauth')}`,
                B: `${HOST}${PATH}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${signB}&redirect=${encodeURIComponent('https://www.10camp.com/api/shopee-oauth')}`,
                C: `${HOST}${PATH}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${signC}&redirect=${encodeURIComponent('https://www.10camp.com/api/shopee-oauth')}`
            },
            server_side_test: await (async () => {
                const tries = { A: signA, B: signB, C: signC };
                const hosts = {
                    sandbox: 'https://partner.test-stable.shopeemobile.com',
                    live: 'https://partner.shopeemobile.com'
                };
                const out = {};
                for (const [hName, hUrl] of Object.entries(hosts)) {
                    out[hName] = {};
                    for (const [name, s] of Object.entries(tries)) {
                        if (!s) { out[hName][name] = { skipped: 'no_sign' }; continue; }
                        const url = `${hUrl}${PATH}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${s}&redirect=${encodeURIComponent('https://www.10camp.com/api/shopee-oauth')}`;
                        try {
                            const r = await fetch(url, { method: 'GET', redirect: 'manual' });
                            const text = await r.text().catch(() => '');
                            let parsed = null;
                            try { parsed = JSON.parse(text); } catch(e) {}
                            out[hName][name] = {
                                status: r.status,
                                location: r.headers.get('location') || '',
                                parsed_error: parsed?.error || null,
                                parsed_message: parsed?.message || null,
                                body_first_120: text.slice(0, 120)
                            };
                        } catch(e) {
                            out[hName][name] = { fetch_error: String(e).slice(0, 200) };
                        }
                    }
                }
                return out;
            })()
        }, null, 2)
    };
};
