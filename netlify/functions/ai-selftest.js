/**
 * ai-selftest.js — ujian automatik Tanya AI lawan database (p1_1044).
 *
 * KENAPA: Zack tangkap Tanya AI reka data stok (BD057, p1_1043). Fix dah masuk (paksa tool call),
 * tapi kita nak JARING KESELAMATAN kekal: tiap pagi sistem sendiri tanya beberapa SKU rawak
 * (berturut-turut dalam SATU perbualan — corak sama yang buat AI hallucinate dulu), banding
 * jawapan dengan database sebenar. Tak padan → rekod FAIL → kad merah muncul di Pusat Amaran
 * (Home > Amaran, mgmt/system) supaya Zaid/Zack tahu SEBELUM staf kena tipu.
 *
 * ALIRAN: pilih 3 SKU rawak (published, stok > 0) → mint sesi tester@10camp.com (sama cara
 * staff-auth: admin generate_link → verify) → tanya staff-assistant LIVE hujung-ke-hujung
 * macam staf sebenar → semak jawapan (angka stok betul ada? barcode salah muncul?) →
 * simpan keputusan ke app_settings ai_selftest_last (+ ai_selftest_lastfail kalau gagal).
 *
 * Gate: requireAuth (scheduled / x-internal-key / staff JWT). Dipanggil oleh ai-selftest-cron
 * tiap pagi 06:45 MYT, atau manual dgn kunci dalaman.
 */
const { requireAuth } = require('./_auth');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const TESTER_EMAIL = 'tester@10camp.com';   // akaun ujian sebenar (TST001) — bukan staf jualan
const N_SKUS = 3;

const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj) });

async function sb(method, path, body, extra) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method, headers: Object.assign({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, extra || {}),
        body: body ? JSON.stringify(body) : undefined
    });
    const t = await res.text();
    if (!res.ok) throw new Error(`sb ${res.status}: ${t.slice(0, 200)}`);
    return t ? (t[0] === '[' || t[0] === '{' ? JSON.parse(t) : t) : null;
}

// Mint sesi authenticated utk akaun tester — sama resipi macam staff-auth.js (generate_link → verify).
async function mintTesterToken() {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'magiclink', email: TESTER_EMAIL })
    });
    const j = await r.json();
    if (!r.ok) throw new Error('generate_link ' + r.status);
    const token_hash = j.hashed_token || (j.properties && j.properties.hashed_token);
    if (!token_hash) throw new Error('no token_hash');
    const v = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'magiclink', token_hash })
    });
    const vj = await v.json();
    if (!v.ok || !vj.access_token) throw new Error('verify failed ' + v.status);
    return vj.access_token;
}

// Semak satu jawapan AI lawan data sebenar. Diskriminator utama:
// (1) angka stok betul MESTI ada dalam jawapan; (2) TIADA barcode salah (nombor 10-14 digit
// yang bukan barcode sebenar = fabrikasi — corak sama macam kes BD057).
function judge(reply, expect) {
    const r = String(reply || '');
    const okStock = new RegExp('\\b' + expect.stock + '\\b').test(r);
    const digits = r.match(/\b\d{10,14}\b/g) || [];
    const wrongBarcode = digits.filter(d => d !== expect.barcode);
    const barcodeShown = expect.barcode ? r.includes(expect.barcode) : null; // null = produk memang tiada barcode
    const ok = okStock && wrongBarcode.length === 0;
    return { ok, okStock, wrongBarcode, barcodeShown };
}

exports.handler = async (event) => {
    const auth = await requireAuth(event);
    if (!auth.ok) return auth.response;
    if (!SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY tak set' });
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://www.10camp.com';

    const startedAt = new Date().toISOString();
    let result = { at: startedAt, status: 'error', tests: [], note: '' };
    try {
        // 1) calon: produk published dgn stok > 0
        const prods = await sb('GET', `/products_master?select=sku,name,erp_barcode&is_published=eq.true&limit=3000`);
        const batches = await sb('GET', `/inventory_batches?select=sku,qty_remaining&limit=20000`);
        const stock = {};
        (batches || []).forEach(b => { if (b.sku) stock[b.sku] = (stock[b.sku] || 0) + (Number(b.qty_remaining) || 0); });
        const pool = (prods || []).filter(p => p.sku && (stock[p.sku] || 0) > 0);
        if (pool.length < N_SKUS) throw new Error('tak cukup produk berstok utk ujian');
        // pilih rawak tanpa ulangan
        const picks = [];
        while (picks.length < N_SKUS && pool.length) {
            const i = Math.floor(Math.random() * pool.length);
            picks.push(pool.splice(i, 1)[0]);
        }

        // 2) sesi tester + perbualan BERTURUT-TURUT (corak yang pernah buat AI hallucinate)
        const token = await mintTesterToken();
        const history = [];
        for (const p of picks) {
            const q = 'berapa stok ' + p.sku + '?';
            history.push({ role: 'user', content: q });
            const r = await fetch(`${base}/.netlify/functions/staff-assistant`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: history.slice(-8), lang: 'bm' })
            });
            const d = await r.json().catch(() => ({}));
            const reply = (d && d.reply) || ('HTTP ' + r.status);
            history.push({ role: 'assistant', content: String(reply).slice(0, 500) });
            const expect = { stock: stock[p.sku] || 0, barcode: p.erp_barcode || '' };
            const verdict = judge(reply, expect);
            result.tests.push({
                sku: p.sku, ok: verdict.ok,
                expect_stock: expect.stock, expect_barcode: expect.barcode || null,
                ok_stock: verdict.okStock, wrong_barcodes: verdict.wrongBarcode, barcode_shown: verdict.barcodeShown,
                provider: (d && d.provider) || null, reply: String(reply).slice(0, 220)
            });
        }
        result.status = result.tests.every(t => t.ok) ? 'pass' : 'fail';
    } catch (e) {
        result.note = String(e.message || e).slice(0, 200);
    }

    // 3) simpan keputusan (client baca ai_selftest_last utk kad Pusat Amaran)
    try {
        await sb('POST', '/app_settings?on_conflict=key', { key: 'ai_selftest_last', value: result }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
        if (result.status !== 'pass') {
            await sb('POST', '/app_settings?on_conflict=key', { key: 'ai_selftest_lastfail', value: result }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
        }
    } catch (e) { result.note += ' | save: ' + String(e.message || e).slice(0, 80); }

    return json(200, result);
};
