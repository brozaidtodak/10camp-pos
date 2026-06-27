/**
 * tiktok-create-product.js — Cara B: create a POS product on TikTok Seller Centre.
 *
 * POST { sku, title?, category_id?, dry?, save_mode? }
 *   sku       : parent/listing SKU in products_master (variants pulled via parent_sku)
 *   title     : optional override for the TikTok title (else auto-cleaned from name)
 *   category_id : optional override TikTok leaf category (else mapped from our category)
 *   dry       : true → assemble & return payload only (NO image upload, NO create)
 *   save_mode : 'AS_DRAFT' (default) | 'LISTING'
 *
 * Returns { ok, dry, product_id?, title, category_id, skus, payload?, errors[] }.
 * On real create, writes tiktok_product_id + sku_id back to products_master.metadata.
 *
 * Auth: requires header x-pos-key === TIKTOK_CREATE_KEY (env) OR same-origin POS call.
 */
const tt = require('./_tiktok');
const { requireAuth } = require('./_auth'); // staff JWT (browser) OR internal key (cron/testing)
const V = tt.VERSION;
const API_BASE = 'https://open-api.tiktokglobalshop.com';
const SALES_WAREHOUSE = '7369471784624146184'; // 10 Camp default SALES_WAREHOUSE (probe)

// our category (lowercased) → TikTok leaf category id (Sukan & Luar > Perkhemahan & Mendaki)
const CAT_MAP = {
    // Khemah & Aksesori
    'tent': '700782', 'dome': '700782', 'flysheet': '700782', 'tent pole': '700782',
    'pegs': '700782', 'pole cap': '700782', 'canopy': '700782', 'ground sheet': '700782',
    'rope': '700782', 'hooks': '700782', 'velco strap': '700782', 'carabiner': '700782',
    // Perabot Perkhemahan (camping furniture)
    'tables': '838280', 'table': '838280', 'mini table': '838280', 'chairs': '838280',
    'stool': '838280', 'wagons': '838280', 'rack': '838280', 'shelf': '838280',
    'camping cots': '838280', 'portable hanger': '838280', 'rubbish frame': '838280',
    // Alat Dapur Perkhemahan (cookware)
    'pots': '603917', 'stove': '603917', 'kettle': '603917', 'grills': '603917',
    'cups': '603917', 'plate': '603917', 'utensils': '603917', 'pot hanging tripod': '603917',
    'seasoning bottles': '603917', 'charcoal': '603917', 'basket': '603917',
    // Lampu Perkhemahan (lamps)
    'hanging lamp': '603970', 'lanterns': '603970', 'ground lamp': '603970',
    'universal lamp': '603970', 'string light': '603970', 'light standing pole': '603970',
    'lighting': '603970', 'warning light': '603970', 'lights with mosquito repellent': '603970',
    // Beg Tidur & Kelengkapan Tidur (sleeping)
    'sleeping bags': '604054', 'pillow': '604054', 'blankets': '604054',
    'air mattress': '604054', 'mat': '604054', 'sleeping gear': '604054', 'inflatable sofa': '604054',
    // Buaian (hammock)
    'hammock': '603952',
    // Kipas Khemah (fans)
    'portable fan': '1023112', 'fan': '1023112', 'fan accessories': '1023112',
    // Pisau & Perlengkapan (survival)
    'survival tools': '603835', 'hammer': '603835', 'universal tactical screws': '603835',
    // Penapis/Penyimpan Air (water)
    'bucket': '1000200',
    // kebersihan (hygiene)
    'towel': '1000328',
};
const DEFAULT_CAT = '700782'; // Khemah & Aksesori — safe default for outdoor gear
const COLOR_ATTR_ID = '100000'; // "Warna" sales property (from probe)

function resolveCategory(ourCat) {
    const k = String(ourCat || '').trim().toLowerCase();
    return CAT_MAP[k] || DEFAULT_CAT;
}

// Clean our messy "BD016-067 | BLACKDOG CBD2450WS010 _ Quick-opening canopy | ..." → readable title
function cleanTitle(name, brand) {
    let s = String(name || '').trim();
    const alphaScore = (x) => (String(x).match(/[A-Za-z]{3,}/g) || []).length;
    let parts = s.split('|').map(x => x.trim()).filter(Boolean);
    let cand = parts.sort((a, b) => alphaScore(b) - alphaScore(a))[0] || s;
    if (cand.includes('_')) cand = cand.split('_').pop().trim();
    cand = cand.replace(/\b[A-Z]{2,6}\d{2,}[A-Z0-9-]*\b/g, ' ');       // model codes CBD2450WS010
    cand = cand.replace(/\b[A-Z]{1,4}\d{2,3}(?:-\d{2,3})*\b/g, ' ');   // SKU codes BD016 / BD016-067
    cand = cand.replace(/\s*-\s*[A-Za-z][A-Za-z ]{1,18}$/, '');         // trailing " - Beige"
    cand = cand.replace(/[_|]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (brand && cand && !cand.toLowerCase().includes(String(brand).toLowerCase().slice(0, 5)))
        cand = brand + ' ' + cand;
    cand = cand.replace(/\s{2,}/g, ' ').trim();
    if (cand.length < 12) cand = (cand + ' Outdoor Camping Gear').trim();
    return cand.slice(0, 255);
}

function pickImages(p) {
    let imgs = p.images;
    if (typeof imgs === 'string') imgs = imgs ? [imgs] : [];
    if (!Array.isArray(imgs)) imgs = [];
    return imgs.filter(Boolean).slice(0, 9);
}

// Upload one image (by URL) to TikTok → returns uri. Multipart: body excluded from signature.
async function uploadImageByUrl(url, accessToken) {
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`fetch image ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const path = `/product/${V}/images/upload`;
    // NOTE: image upload does NOT take shop_cipher (TikTok err 36009004 if present)
    const q = { app_key: tt.APP_KEY, timestamp: Math.floor(Date.now() / 1000).toString() };
    q.sign = tt.signRequest(path, q, '', true); // true = exclude body (multipart)
    const qs = Object.entries(q).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const fd = new FormData();
    fd.append('data', new Blob([buf]), 'image.jpg');
    fd.append('use_case', 'MAIN_IMAGE');
    const res = await fetch(`${API_BASE}${path}?${qs}`, {
        method: 'POST', headers: { 'x-tts-access-token': accessToken }, body: fd });
    const j = await res.json();
    if (j.code !== 0 || !j.data || !j.data.uri) throw new Error(`img upload: ${j.message} (${j.code})`);
    return j.data.uri;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
    const auth = await requireAuth(event);
    if (!auth.ok) return auth.response;

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, body: 'bad json' }; }
    const { sku, title: titleOverride, category_id: catOverride, dry = false, force = false,
            publish = false, product_id: publishProductId = null, save_mode = 'AS_DRAFT',
            requirements = false,                 // mode=requirements → pulang field wajib kategori + prefill POS
            description: descOverride = null, brand_id: brandIdOverride = null,
            attributes: attrOverride = null,      // [{id, name, values:[{id?, name}]}] dari borang prefill
            weight_kg: wOverride = null, length_cm: lOverride = null,
            width_cm: wdOverride = null, height_cm: hOverride = null } = body;
    if (!sku) return { statusCode: 400, body: 'sku required' };

    const errors = [];
    try {
        // 1) Pull the listing rows (parent + variants share parent_sku == this sku, OR this single sku)
        const esc = (s) => encodeURIComponent('"' + String(s).toUpperCase().replace(/"/g, '\\"') + '"');
        let rows = await tt.sb('GET', `/products_master?or=(sku.eq.${encodeURIComponent(sku)},parent_sku.eq.${encodeURIComponent(sku)})&select=*`);
        if (!rows || !rows.length) return { statusCode: 404, body: 'product not found' };
        // variant children = rows whose own sku != listing sku; lead = the listing sku row (or first)
        const lead = rows.find(r => r.sku === sku) || rows[0];
        let skuRows = rows.filter(r => r.sku && r.sku !== sku);
        const hasVariants = skuRows.length > 0;
        if (!hasVariants) skuRows = [lead];
        if (lead.metadata && lead.metadata.tiktok_product_id && !dry && !force && !publish && !requirements)
            return { statusCode: 200, body: JSON.stringify({ ok: false, already: true, product_id: lead.metadata.tiktok_product_id }) };

        // 2) Title + category + description (borang prefill boleh override)
        const title = titleOverride || cleanTitle(lead.name, lead.brand);
        const category_id = catOverride || resolveCategory(lead.category);
        const descRaw = descOverride != null ? descOverride : (lead.description || '');
        const desc = (descRaw && descRaw.length > 20)
            ? (/[<>]/.test(descRaw) ? descRaw : `<p>${descRaw}</p>`)
            : `<p>${title}.</p><p>${lead.brand || '10 Camp'} outdoor & camping equipment. Tahan lasak untuk aktiviti luar.</p>`;

        // 3) Package weight + dimensions (TikTok requires dimensions; borang boleh override)
        const w = Number(wOverride) > 0 ? Number(wOverride) : (Number(lead.weight_kg) > 0 ? Number(lead.weight_kg) : 1);
        const dim = {
            length: String(Math.max(1, Math.round(Number(lOverride) || Number(lead.length_cm) || 20))),
            width: String(Math.max(1, Math.round(Number(wdOverride) || Number(lead.width_cm) || 15))),
            height: String(Math.max(1, Math.round(Number(hOverride) || Number(lead.height_cm) || 10))),
            unit: 'CENTIMETER'
        };

        // 4) Stock per sku
        const stockMap = await tt.getPosStock(skuRows.map(r => r.sku));

        // 5) Build SKUs
        const skus = skuRows.map(r => {
            const price = Number(r.tiktok_price) > 0 ? Number(r.tiktok_price)
                        : Number(r.price) > 0 ? Number(r.price) : Number(lead.price) || 0;
            const qty = stockMap[(r.sku || '').toUpperCase()] || 0;
            const s = {
                seller_sku: r.sku,
                price: { amount: price.toFixed(2), currency: 'MYR' },
                inventory: [{ warehouse_id: SALES_WAREHOUSE, quantity: qty }]
            };
            if (hasVariants) {
                const color = r.variant_color || r.variant_size || r.sku;
                s.sales_attributes = [{ id: COLOR_ATTR_ID, name: 'Warna', value_name: String(color).slice(0, 50) }];
            }
            return s;
        });

        const imgUrls = pickImages(lead);

        // REQUIREMENTS — pulang field WAJIB kategori TikTok + nilai prefill dari POS.
        // Borang "Hantar ke TikTok" guna ni untuk tunjuk apa staf perlu isi sebelum terbit.
        if (requirements) {
            const tok = await tt.getValidToken();
            const cipher = await tt.ensureShopCipher(tok);
            let attrs = [], rules = {};
            // PARALLEL — elak timeout (dulu 2 GET berturut + auth verify > 10s di Netlify → respons kosong)
            const [arRes, rrRes] = await Promise.allSettled([
                tt.ttRequest('GET', `/product/${V}/categories/${category_id}/attributes`, { query: { category_version: 'v2' }, accessToken: tok.access_token, shopCipher: cipher }),
                tt.ttRequest('GET', `/product/${V}/categories/${category_id}/rules`, { query: { category_version: 'v2' }, accessToken: tok.access_token, shopCipher: cipher })
            ]);
            if (arRes.status === 'fulfilled') attrs = (arRes.value.data && arRes.value.data.attributes) || [];
            else errors.push('attributes: ' + String(arRes.reason));
            if (rrRes.status === 'fulfilled') rules = rrRes.value.data || {};
            else errors.push('rules: ' + String(rrRes.reason));
            // normalize attributes — PRODUCT_PROPERTY only (SALES_PROPERTY=varian, dikendali lain)
            const norm = attrs.filter(a => (a.type || '') !== 'SALES_PROPERTY').map(a => ({
                id: String(a.id), name: a.name,
                is_required: !!(a.is_required || a.is_requried || a.requirement_type === 'REQUIRED'),
                is_multi: !!a.is_multiple_selection,
                values: (a.values || []).map(v => ({ id: String(v.id), name: v.name }))
            }));
            return { statusCode: 200, headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ok: true, requirements: true, listing_sku: sku, category_id,
                    has_variants: hasVariants,
                    prefill: {
                        title, description: (lead.description || ''), brand: lead.brand || '',
                        weight_kg: w, length_cm: Number(dim.length), width_cm: Number(dim.width), height_cm: Number(dim.height),
                        images: imgUrls, price: (skus[0] && skus[0].price && skus[0].price.amount) || '0.00',
                        skus: skus.map(s => ({ seller_sku: s.seller_sku, price: s.price.amount, qty: (s.inventory[0] || {}).quantity }))
                    },
                    attributes: norm,
                    package_dimension_required: !!(rules.package_dimension && rules.package_dimension.is_required),
                    cert_required: Array.isArray(rules.product_certifications) && rules.product_certifications.some(c => c.is_required),
                    errors }, null, 2) };
        }

        if (dry) {
            return { statusCode: 200, headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ok: true, dry: true, title, category_id,
                    listing_sku: sku, has_variants: hasVariants, image_count: imgUrls.length,
                    package: { weight_kg: w, dim }, skus, errors }, null, 2) };
        }

        // 6) Real create — auth, upload images, POST
        const tok = await tt.getValidToken();
        const cipher = await tt.ensureShopCipher(tok);

        const main_images = [];
        for (const u of imgUrls) {
            try { main_images.push({ uri: await uploadImageByUrl(u, tok.access_token) }); }
            catch (e) { errors.push('img: ' + e.message); }
        }
        if (!main_images.length) return { statusCode: 200, body: JSON.stringify({ ok: false, errors: ['no images uploaded'].concat(errors) }) };

        const payload = {
            save_mode,
            title,
            description: desc,
            category_id,
            category_version: 'v2', // shops are required to use V2 categories (err 12052217)
            main_images,
            package_weight: { value: w.toFixed(2), unit: 'KILOGRAM' },
            package_dimensions: dim,
            skus
        };
        if (brandIdOverride) payload.brand_id = String(brandIdOverride);
        // attribut wajib kategori dari borang prefill → product_attributes
        if (Array.isArray(attrOverride) && attrOverride.length) {
            payload.product_attributes = attrOverride
                .filter(a => a && a.id && Array.isArray(a.values) && a.values.length)
                .map(a => ({ id: String(a.id),
                    values: a.values.map(v => v && v.id ? { id: String(v.id), name: v.name } : { name: String(v.name || v) }) }));
        }
        // PUBLISH = edit existing draft → LISTING (submit for review). Else POST create.
        const targetId = publishProductId || (lead.metadata && lead.metadata.tiktok_product_id);
        let res;
        if (publish && targetId) {
            // fetch current SKU ids so the edit updates existing SKUs in place (not duplicate)
            try {
                const det = await tt.ttRequest('GET', `/product/${V}/products/${targetId}`, {
                    accessToken: tok.access_token, shopCipher: cipher });
                const idBySeller = {};
                for (const s of ((det.data && det.data.skus) || [])) idBySeller[(s.seller_sku || '').toUpperCase()] = s.id;
                payload.skus = skus.map(s => {
                    const id = idBySeller[(s.seller_sku || '').toUpperCase()];
                    return id ? Object.assign({ id }, s) : s;
                });
            } catch (e) { errors.push('detail fetch: ' + e.message); }
            payload.save_mode = 'LISTING';
            res = await tt.ttRequest('PUT', `/product/${V}/products/${targetId}`, {
                body: payload, accessToken: tok.access_token, shopCipher: cipher });
        } else {
            res = await tt.ttRequest('POST', `/product/${V}/products`, {
                body: payload, accessToken: tok.access_token, shopCipher: cipher });
        }
        if (res.code !== 0) {
            return { statusCode: 200, headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ok: false, published: !!publish, tiktok_code: res.code, tiktok_msg: res.message,
                    title, category_id, errors, payload_preview: { skus, image_count: main_images.length } }, null, 2) };
        }
        const data = res.data || {};
        const productId = data.product_id || targetId;
        if (publish) {
            return { statusCode: 200, headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ok: true, published: true, product_id: productId, title, category_id, errors }, null, 2) };
        }
        // 7) Write tiktok_product_id back to each sku's metadata
        const skuIdBySeller = {};
        for (const s of (data.skus || [])) skuIdBySeller[s.seller_sku] = s.id;
        for (const r of (force ? [] : skuRows)) {
            const meta = Object.assign({}, r.metadata || {}, {
                tiktok_product_id: productId,
                tiktok_sku_id: skuIdBySeller[r.sku] || null,
                tiktok_created_at: new Date().toISOString(),
                tiktok_created_via: 'cara_b'
            });
            try {
                await tt.sb('PATCH', `/products_master?sku=eq.${encodeURIComponent(r.sku)}`,
                    { metadata: meta }, { Prefer: 'return=minimal' });
            } catch (e) { errors.push('writeback ' + r.sku + ': ' + e.message); }
        }
        return { statusCode: 200, headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ok: true, product_id: productId, title, category_id,
                sku_count: skus.length, errors }, null, 2) };

    } catch (e) {
        return { statusCode: 500, headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ok: false, error: String((e && e.stack) || e), errors }) };
    }
};
