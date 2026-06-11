/**
 * tiktok-promo-sync.js — pull ACTIVE TikTok promotions/campaigns and write a snapshot
 * onto products_master.tiktok_campaign per SKU (with below_cost flag).
 *
 * Modes:
 *   ?mode=peek  (default) — raw shape: activity list + first activity detail (no write)
 *   ?mode=sync            — map active promos to POS SKUs, compute below_cost, write column
 *
 * Read scope: seller.promotion.info. Same HMAC signing as other tiktok-* funcs (via _tiktok.js).
 */
const tt = require('./_tiktok');
const VERSION = '202309';

function json(code, obj) {
    return { statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj, null, 2) };
}

// Pull all ONGOING activities (paginated)
async function getActivities(accessToken, shopCipher) {
    const acts = [];
    let pageToken = '', guard = 0;
    do {
        const body = { status: 'ONGOING', page_size: 50 };
        if (pageToken) body.page_token = pageToken;
        const res = await tt.ttRequest('POST', `/promotion/${VERSION}/activities/search`, {
            body, accessToken, shopCipher
        });
        if (res.code !== 0) throw new Error(`activities search failed: ${res.message} (code ${res.code})`);
        const data = res.data || {};
        for (const a of (data.activities || data.activity_list || [])) acts.push(a);
        pageToken = data.next_page_token || '';
    } while (pageToken && ++guard < 40);
    return acts;
}

async function getActivityDetail(id, accessToken, shopCipher) {
    const res = await tt.ttRequest('GET', `/promotion/${VERSION}/activities/${id}`, { accessToken, shopCipher });
    if (res.code !== 0) throw new Error(`activity ${id} failed: ${res.message} (code ${res.code})`);
    return res.data || {};
}

function ttSkuPrice(sku) {
    const p = sku.price || {};
    const v = p.sale_price || p.tax_exclusive_price || p.original_price || p.amount || p.list_price;
    return parseFloat(v) || 0;
}
const isoFromUnix = (s) => (s ? new Date(Number(s) * 1000).toISOString() : null);

// Build the desired tiktok_campaign snapshot per seller_sku from ongoing activities.
async function buildCampaignMap(tok, cipher) {
    // 1. tiktok sku_id -> { seller_sku, base_price }
    const products = await tt.getTiktokProducts(tok.access_token, cipher);
    const bySkuId = {};
    for (const p of products) for (const s of (p.skus || [])) {
        bySkuId[String(s.id)] = { seller_sku: (s.seller_sku || '').toUpperCase(), base: ttSkuPrice(s) };
    }
    // 2. ongoing activities -> per sku promo
    const acts = await getActivities(tok.access_token, cipher);
    const map = {}; // seller_sku -> campaign object
    for (const a of acts) {
        const detail = await getActivityDetail(a.id || a.activity_id, tok.access_token, cipher);
        const title = detail.title || a.title || 'Campaign';
        const atype = detail.activity_type || a.activity_type || '';
        const starts = isoFromUnix(detail.begin_time || a.begin_time);
        const ends = isoFromUnix(detail.end_time || a.end_time);
        for (const prod of (detail.products || [])) {
            for (const sk of (prod.skus || [])) {
                const meta = bySkuId[String(sk.id)];
                if (!meta || !meta.seller_sku) continue;
                const fixed = sk.activity_price && parseFloat(sk.activity_price.amount);
                const disc = parseFloat(sk.discount);
                let promo_price = null, dtype = null, dval = null;
                if (fixed && fixed > 0) { promo_price = +fixed.toFixed(2); dtype = 'fixed_price'; dval = fixed; }
                else if (disc && meta.base > 0) { promo_price = +(meta.base * (1 - disc / 100)).toFixed(2); dtype = 'percentage'; dval = disc; }
                map[meta.seller_sku] = {
                    active: true, name: title, type: atype,
                    discount_type: dtype, discount_value: dval,
                    base_price: meta.base || null, promo_price,
                    starts_at: starts, ends_at: ends
                };
            }
        }
    }
    return map;
}

exports.handler = async (event) => {
    const params = (event && event.queryStringParameters) || {};
    const mode = params.mode === 'sync' ? 'sync' : 'peek';
    try {
        const tok = await tt.getValidToken();
        const cipher = await tt.ensureShopCipher(tok);
        const acts = await getActivities(tok.access_token, cipher);

        if (mode === 'peek') {
            const out = { mode, ongoing_activities: acts.length, first_activity: acts[0] || null };
            if (acts[0]) out.first_activity_detail = await getActivityDetail(acts[0].id || acts[0].activity_id, tok.access_token, cipher);
            return json(200, out);
        }

        // ---- mode=sync ----
        const desired = await buildCampaignMap(tok, cipher);
        // cost map + current campaign state
        const rows = await tt.sb('GET', '/products_master?select=sku,cost_price,tiktok_campaign');
        const cost = {}, current = {};
        for (const r of rows) {
            const s = (r.sku || '').toUpperCase();
            cost[s] = parseFloat(r.cost_price) || 0;
            current[s] = r.tiktok_campaign || null;
        }
        const now = new Date().toISOString();
        let belowCostCount = 0;
        const belowCostSkus = [];
        const sig = (c) => c ? JSON.stringify([c.active, c.promo_price, c.below_cost, c.discount_value, c.ends_at, c.name]) : 'null';
        const setRows = [], clearRows = [];

        // Set/refresh promo SKUs (only those that exist in POS + changed)
        for (const [sku, camp] of Object.entries(desired)) {
            if (!(sku in cost)) continue; // only known POS SKUs
            camp.below_cost = (cost[sku] > 0 && camp.promo_price != null && camp.promo_price < cost[sku]);
            camp.synced_at = now;
            if (camp.below_cost) { belowCostCount++; belowCostSkus.push({ sku, promo_price: camp.promo_price, cost: cost[sku] }); }
            if (sig(current[sku]) !== sig(camp)) setRows.push({ sku, tiktok_campaign: camp });
        }
        // Clear SKUs that had an active campaign but are no longer in any ongoing promo
        for (const [sku, cur] of Object.entries(current)) {
            if (cur && cur.active && !(sku in desired)) clearRows.push({ sku, tiktok_campaign: null });
        }
        // PATCH per sku (update-only; products_master has NOT NULL cols so no upsert).
        // Parallelised in chunks for speed.
        const all = setRows.concat(clearRows);
        const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
        for (const c of chunk(all, 25)) {
            await Promise.all(c.map(r =>
                tt.sb('PATCH', `/products_master?sku=eq.${encodeURIComponent(r.sku)}`,
                    { tiktok_campaign: r.tiktok_campaign }, { Prefer: 'return=minimal' })));
        }

        return json(200, {
            mode, ongoing_activities: acts.length, promo_skus: Object.keys(desired).length,
            updated: setRows.length, cleared: clearRows.length,
            below_cost_count: belowCostCount, below_cost: belowCostSkus, synced_at: now
        });
    } catch (err) {
        return json(500, { mode, error: String(err) });
    }
};
