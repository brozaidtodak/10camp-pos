/**
 * tiktok-coupon-sync.js — pull ACTIVE TikTok coupons (shop-level vouchers) into the
 * marketplace_promotions table so the POS Campaigns page can show ALL ongoing promos
 * (not just per-product discounts). Modes: ?mode=peek (raw shape) | ?mode=sync (write).
 *
 * Coupon API confirmed via probe: POST /promotion/202406/coupons/search, body.status = LIST.
 */
const tt = require('./_tiktok');
const CV = '202406';

function json(code, obj) {
    return { statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj, null, 2) };
}

async function getActiveCoupons(tok, cipher) {
    const out = [];
    let pageToken = '', guard = 0;
    do {
        const body = { status: ['ONGOING'], page_size: 50 };
        if (pageToken) body.page_token = pageToken;
        const res = await tt.ttRequest('POST', `/promotion/${CV}/coupons/search`, { body, accessToken: tok.access_token, shopCipher: cipher });
        if (res.code !== 0) throw new Error(`coupons/search: ${res.message} (code ${res.code})`);
        const d = res.data || {};
        for (const c of (d.coupons || d.coupon_list || [])) out.push(c);
        pageToken = d.next_page_token || '';
    } while (pageToken && ++guard < 20);
    return out;
}

exports.handler = async (event) => {
    const params = (event && event.queryStringParameters) || {};
    const mode = params.mode === 'sync' ? 'sync' : 'peek';
    try {
        const tok = await tt.getValidToken();
        const cipher = await tt.ensureShopCipher(tok);
        const coupons = await getActiveCoupons(tok, cipher);

        if (mode === 'peek') {
            return json(200, { mode, active_coupons: coupons.length, sample: coupons.slice(0, 3) });
        }

        // sync → replace TikTok coupons in marketplace_promotions (dedupe by id)
        const now = new Date().toISOString();
        const seen = new Set();
        const rows = [];
        for (const c of coupons) {
            const ext = String(c.id || c.coupon_id || '');
            if (!ext || seen.has(ext)) continue;
            seen.add(ext);
            const disc = c.discount || {};
            const amt = disc.reduction_amount && disc.reduction_amount.amount;
            const pct = disc.percentage || (disc.reduction_percentage);
            const minSpend = c.threshold && c.threshold.min_spend && c.threshold.min_spend.amount;
            rows.push({
                platform: 'TikTok', promo_type: 'COUPON', ext_id: ext,
                title: c.title || c.name || 'Coupon',
                details: {
                    discount_type: disc.type || null,
                    amount_off: amt != null ? Number(amt) : null,
                    percent_off: pct != null ? Number(pct) : null,
                    min_spend: minSpend != null ? Number(minSpend) : null,
                    segment: c.target_buyer_segment || null,
                    scope: c.product_scope || null,
                    raw: c
                },
                starts_at: (c.claim_duration && c.claim_duration.start_time) ? new Date(Number(c.claim_duration.start_time) * 1000).toISOString() : null,
                ends_at: (c.claim_duration && c.claim_duration.end_time) ? new Date(Number(c.claim_duration.end_time) * 1000).toISOString() : null,
                active: true, synced_at: now
            });
        }
        await tt.sb('DELETE', `/marketplace_promotions?platform=eq.TikTok&promo_type=eq.COUPON`, null, { Prefer: 'return=minimal' });
        if (rows.length) await tt.sb('POST', '/marketplace_promotions', rows, { Prefer: 'return=minimal' });
        return json(200, { mode, synced: rows.length, distinct: rows.length, total_returned: coupons.length, synced_at: now });
    } catch (err) {
        return json(500, { mode, error: String(err) });
    }
};
