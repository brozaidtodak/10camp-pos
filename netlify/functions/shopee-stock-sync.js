/**
 * Shopee Open Platform STOCK sync — Netlify Function (p1_98 Fasa 2C).
 *
 * Pushes POS inventory stock → Shopee shop. Matches SKU between POS
 * masterProducts/inventory_batches and Shopee items/models, compares
 * stock levels, optionally updates Shopee inventory.
 *
 * Query modes:
 *   ?mode=peek    (default) — list all Shopee items + match status, no compare
 *   ?mode=dryrun            — compare POS vs Shopee stock, list diffs (no write)
 *   ?mode=push              — actually push stock updates to Shopee
 *   ?limit=N                — limit items processed (default 50, max 100)
 *
 * Public URL: https://www.10camp.com/api/shopee-stock-sync
 */

const crypto = require('crypto');

const PARTNER_ID   = process.env.SHOPEE_PARTNER_ID || '';
const PARTNER_KEY  = process.env.SHOPEE_PARTNER_KEY || '';
const ENV          = (process.env.SHOPEE_ENV || 'sandbox').toLowerCase();
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

const HOST = ENV === 'live'
    ? 'https://partner.shopeemobile.com'
    : 'https://openplatform.sandbox.test-stable.shopee.sg';

function json(statusCode, obj) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(obj, null, 2)
    };
}

async function sb(method, path, body, extraHeaders) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method,
        headers: Object.assign({
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json'
        }, extraHeaders || {}),
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
}

function signShop(path, timestamp, accessToken, shopId) {
    const base = `${PARTNER_ID}${path}${timestamp}${accessToken}${shopId}`;
    return crypto.createHmac('sha256', PARTNER_KEY).update(base).digest('hex');
}

async function shopeeGet(path, extraQuery, accessToken, shopId) {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = signShop(path, timestamp, accessToken, shopId);
    const q = Object.assign({
        partner_id: PARTNER_ID,
        timestamp,
        access_token: accessToken,
        shop_id: shopId,
        sign
    }, extraQuery || {});
    const qs = Object.entries(q).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const res = await fetch(`${HOST}${path}?${qs}`, { method: 'GET' });
    return res.json();
}

async function shopeePost(path, extraQuery, bodyObj, accessToken, shopId) {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = signShop(path, timestamp, accessToken, shopId);
    const q = Object.assign({
        partner_id: PARTNER_ID,
        timestamp,
        access_token: accessToken,
        shop_id: shopId,
        sign
    }, extraQuery || {});
    const qs = Object.entries(q).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const res = await fetch(`${HOST}${path}?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj || {})
    });
    return res.json();
}

async function getValidToken() {
    const rows = await sb('GET', `/shopee_tokens?environment=eq.${ENV}&order=created_at.desc&limit=1`);
    if (!rows || !rows.length) throw new Error(`No Shopee token for ${ENV} — run the authorize flow first.`);
    return rows[0]; // refresh logic lives in shopee-sync.js; this assumes recent connect
}

// Load POS stock from inventory_batches (sum qty_remaining per SKU).
// p1_266 — fix column: was 'current_qty' (tak wujud) → correct 'qty_remaining' (per audit p1_236).
async function loadPosStock() {
    const rows = await sb('GET', '/inventory_batches?select=sku,qty_remaining&limit=10000');
    const bySku = {};
    for (const r of (rows || [])) {
        const sku = (r.sku || '').toUpperCase().trim();
        if (!sku) continue;
        bySku[sku] = (bySku[sku] || 0) + Number(r.qty_remaining || 0);
    }
    return bySku;
}

function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

exports.handler = async (event) => {
    if (!PARTNER_ID || !PARTNER_KEY) return json(500, { error: 'SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY not set' });
    if (!SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY not set' });

    const params = event.queryStringParameters || {};
    const mode = ['peek','dryrun','push','map'].includes(params.mode) ? params.mode : 'peek';
    const limit = Math.min(parseInt(params.limit || '50', 10) || 50, 100);
    const offset = Math.max(0, parseInt(params.offset || '0', 10) || 0); // p1_523 — paging

    const out = { mode, env: ENV, limit, offset };

    try {
        const tok = await getValidToken();
        out.shop_id = tok.shop_id;

        // p1_364 — dryrun/push guna MAPPING TERSIMPAN (metadata.shopee_item_id + shopee_model_id),
        // bukan re-list katalog (yang cap 100 item + miss produk variant + timeout). Reliable + laju.
        // Stok absolute (POS = sumber kebenaran). update_stock idempotent.
        if (mode === 'dryrun' || mode === 'push') {
            const posStock = await loadPosStock();
            out.pos_skus_total = Object.keys(posStock).length;
            const mappedRows = await sb('GET', "/products_master?select=sku,smid:metadata->>shopee_item_id,smod:metadata->>shopee_model_id&metadata->>shopee_item_id=not.is.null&limit=10000");
            out.shopee_mapped = (mappedRows || []).length;
            const byItem = {};
            for (const r of (mappedRows || [])) {
                const sku = (r.sku || '').toUpperCase().trim();
                const itemId = r.smid;
                if (!sku || !itemId) continue;
                if (!byItem[itemId]) byItem[itemId] = [];
                byItem[itemId].push({ model_id: Number(r.smod) || 0, sku, pos_qty: posStock[sku] || 0 });
            }
            // p1_523 — sort DETERMINISTIK (ikut item_id) + paging via offset, supaya cron boleh
            // pusing seluruh katalog (dulu slice(0,limit) sahaja = first-N je yang sync selama-lamanya).
            const allEntries = Object.entries(byItem).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
            out.total_items = allEntries.length;
            const itemEntries = allEntries.slice(offset, offset + limit);
            out.next_offset = (offset + limit < allEntries.length) ? (offset + limit) : null; // null = dah habis sekali pusing
            out.matched = itemEntries.reduce((s, e) => s + e[1].length, 0);
            out.items_to_push = itemEntries.length;
            out.sample = itemEntries.reduce((a, e) => a.concat(e[1]), []).slice(0, 10).map(x => ({ sku: x.sku, pos_qty: x.pos_qty }));
            if (mode === 'dryrun') {
                out.note = 'DRYRUN — guna mapping tersimpan; push akan set stok Shopee = stok POS (absolute).';
                return json(200, out);
            }
            let pushed = 0; const errors = [];
            for (const e of itemEntries) {
                const itemId = e[0], list = e[1];
                const stockList = list.map(d => ({ model_id: d.model_id, seller_stock: [{ stock: d.pos_qty }] }));
                const r = await shopeePost('/api/v2/product/update_stock', {}, { item_id: Number(itemId), stock_list: stockList }, tok.access_token, tok.shop_id);
                if (r.error) errors.push({ item_id: itemId, error: r.error, message: r.message });
                else pushed += list.length;
            }
            out.pushed = pushed;
            if (errors.length) out.errors = errors.slice(0, 10);
            out.ok = errors.length === 0;
            return json(200, out);
        }

        // 1. List Shopee items
        const itemIds = [];
        let offset = 0;
        let guard = 0;
        do {
            const r = await shopeeGet('/api/v2/product/get_item_list', {
                offset,
                page_size: 100,
                item_status: 'NORMAL'
            }, tok.access_token, tok.shop_id);
            if (r.error) { out.error = `get_item_list: ${r.message || r.error}`; return json(502, out); }
            const list = (r.response && r.response.item) || [];
            for (const it of list) itemIds.push(it.item_id);
            if (!(r.response && r.response.has_next_page)) break;
            offset += 100;
        } while (++guard < 20 && itemIds.length < limit);

        out.shopee_items_total = itemIds.length;
        const cappedIds = itemIds.slice(0, limit);

        if (!cappedIds.length) {
            out.note = 'Shopee shop tiada items (NORMAL status). Tambah products dalam Shopee Seller Centre dulu.';
            return json(200, out);
        }

        // 2. Get item base info — batches of 50
        const items = [];
        for (const batch of chunk(cappedIds, 50)) {
            const r = await shopeeGet('/api/v2/product/get_item_base_info', {
                item_id_list: batch.join(',')
            }, tok.access_token, tok.shop_id);
            if (r.error) { out.error = `get_item_base_info: ${r.message || r.error}`; return json(502, out); }
            for (const it of ((r.response && r.response.item_list) || [])) items.push(it);
        }

        if (mode === 'peek') {
            out.items_sample = items.slice(0, 5).map(i => ({
                item_id: i.item_id,
                item_sku: i.item_sku,
                item_name: i.item_name,
                has_model: !!i.has_model
            }));
            out.note = 'PEEK mode — list items only. Use ?mode=dryrun untuk compare stock POS vs Shopee.';
            return json(200, out);
        }

        // p1_264 — mode=map: write metadata.shopee_item_id + shopee_synced_at per matched POS sku
        // p1_265 — skip already-mapped, ?limit= chunk control
        if (mode === 'map') {
            const posStock = await loadPosStock();
            const now = new Date().toISOString();
            const limitN = parseInt(params.limit, 10) || 80;
            const force = params.force === '1';
            const already = new Set();
            if (!force) {
                const mapped = await sb('GET', '/products_master?select=sku&metadata->>shopee_item_id=not.is.null');
                for (const r of (mapped || [])) already.add((r.sku || '').toUpperCase());
            }
            const updates = []; // { sku, shopee_item_id, shopee_model_id }
            const seen = new Set();
            for (const it of items) {
                if (updates.length >= limitN) break;
                if (it.has_model) {
                    const r = await shopeeGet('/api/v2/product/get_model_list', { item_id: it.item_id }, tok.access_token, tok.shop_id);
                    if (r.error) continue;
                    for (const m of (r.response && r.response.model) || []) {
                        const modelSku = (m.model_sku || '').toUpperCase().trim();
                        if (!modelSku || !(modelSku in posStock) || seen.has(modelSku) || already.has(modelSku)) continue;
                        seen.add(modelSku);
                        updates.push({ sku: modelSku, shopee_item_id: String(it.item_id), shopee_model_id: String(m.model_id) });
                        if (updates.length >= limitN) break;
                    }
                } else {
                    const itemSku = (it.item_sku || '').toUpperCase().trim();
                    if (!itemSku || !(itemSku in posStock) || seen.has(itemSku) || already.has(itemSku)) continue;
                    seen.add(itemSku);
                    updates.push({ sku: itemSku, shopee_item_id: String(it.item_id), shopee_model_id: null });
                }
            }
            let written = 0;
            const errors = [];
            for (const u of updates) {
                try {
                    const cur = await sb('GET', `/products_master?sku=eq.${encodeURIComponent(u.sku)}&select=metadata`);
                    const m = (cur && cur[0] && cur[0].metadata && typeof cur[0].metadata === 'object') ? cur[0].metadata : {};
                    const merged = Object.assign({}, m, {
                        shopee_item_id: u.shopee_item_id,
                        shopee_model_id: u.shopee_model_id,
                        shopee_synced_at: now
                    });
                    await sb('PATCH', `/products_master?sku=eq.${encodeURIComponent(u.sku)}`, { metadata: merged }, { Prefer: 'return=minimal' });
                    written++;
                } catch (e) {
                    errors.push({ sku: u.sku, error: String(e).slice(0, 200) });
                }
            }
            out.previously_mapped = already.size;
            out.candidates_this_batch = updates.length;
            out.write_count = written;
            out.write_errors = errors.length;
            out.errors_sample = errors.slice(0, 5);
            out.note = updates.length >= limitN ? 'Chunk limit hit — re-call function untuk continue.' : 'Done. All matched SKUs now have Shopee mapping.';
            return json(200, out);
        }

        // 3. dryrun + push — compare stock POS vs Shopee
        const posStock = await loadPosStock();
        out.pos_skus_total = Object.keys(posStock).length;

        const diffs = []; // { item_id, model_id, item_sku, model_sku, pos_qty, shopee_qty, diff }

        for (const it of items) {
            const itemSku = (it.item_sku || '').toUpperCase().trim();

            if (it.has_model) {
                // Need to fetch models for variants
                const r = await shopeeGet('/api/v2/product/get_model_list', {
                    item_id: it.item_id
                }, tok.access_token, tok.shop_id);
                if (r.error) continue;
                const models = (r.response && r.response.model) || [];
                for (const m of models) {
                    const modelSku = (m.model_sku || '').toUpperCase().trim();
                    if (!modelSku) continue;
                    if (!(modelSku in posStock)) continue;
                    const posQty = posStock[modelSku] || 0;
                    const shopeeQty = (m.stock_info_v2 && m.stock_info_v2.summary_info && m.stock_info_v2.summary_info.total_available_stock) || 0;
                    const diff = posQty - shopeeQty;
                    if (diff !== 0) diffs.push({
                        item_id: it.item_id,
                        model_id: m.model_id,
                        item_sku: itemSku,
                        model_sku: modelSku,
                        pos_qty: posQty,
                        shopee_qty: shopeeQty,
                        diff
                    });
                }
            } else {
                if (!itemSku) continue;
                if (!(itemSku in posStock)) continue;
                const posQty = posStock[itemSku] || 0;
                const shopeeQty = (it.stock_info_v2 && it.stock_info_v2.summary_info && it.stock_info_v2.summary_info.total_available_stock) || 0;
                const diff = posQty - shopeeQty;
                if (diff !== 0) diffs.push({
                    item_id: it.item_id,
                    model_id: 0,
                    item_sku: itemSku,
                    pos_qty: posQty,
                    shopee_qty: shopeeQty,
                    diff
                });
            }
        }

        out.matched = diffs.length;
        out.diffs_sample = diffs.slice(0, 10);

        if (mode === 'dryrun') {
            out.note = 'DRYRUN — listed up to 10 diffs above. Use ?mode=push to actually update Shopee stock.';
            return json(200, out);
        }

        // 4. push — update_stock per item
        let pushed = 0;
        const errors = [];
        // Group by item_id
        const byItem = {};
        for (const d of diffs) {
            if (!byItem[d.item_id]) byItem[d.item_id] = [];
            byItem[d.item_id].push(d);
        }
        for (const [itemId, list] of Object.entries(byItem)) {
            const stockList = list.map(d => ({
                model_id: d.model_id,
                seller_stock: [{ stock: d.pos_qty }]
            }));
            const r = await shopeePost('/api/v2/product/update_stock', {}, {
                item_id: Number(itemId),
                stock_list: stockList
            }, tok.access_token, tok.shop_id);
            if (r.error) {
                errors.push({ item_id: itemId, error: r.error, message: r.message });
            } else {
                pushed += list.length;
            }
        }
        out.pushed = pushed;
        if (errors.length) out.errors = errors;
        out.ok = errors.length === 0;
        return json(200, out);

    } catch (err) {
        out.error = String(err);
        return json(500, out);
    }
};
