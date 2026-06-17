/**
 * staff-assistant.js — in-app AI helper for staff (p1_795). Answers "how do I…" + SOP questions
 * about the 10 CAMP POS. Browser-called by logged-in staff; gated by requireStaff (no public access,
 * controls cost). Uses the existing OPENAI_API_KEY (gpt-4o-mini = cheap). Monthly cost cap = ~RM50.
 *
 * POST { messages: [{role:'user'|'assistant', content}] }  → { reply }  (or { reply, capped:true })
 */
const { requireStaff } = require('./_auth');

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = 'gpt-4o-mini';
const CAP_USD = 10;                 // ~RM50/month (RM ~4.7/USD); safety backstop, generous for normal use
const PRICE_IN = 0.15 / 1e6;        // gpt-4o-mini input  $/token
const PRICE_OUT = 0.60 / 1e6;       // gpt-4o-mini output $/token
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const cors = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (code, obj) => ({ statusCode: code, headers: cors, body: JSON.stringify(obj) });

async function sb(method, path, body, extra) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method, headers: Object.assign({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, extra || {}),
        body: body ? JSON.stringify(body) : undefined
    });
    const t = await res.text();
    if (!res.ok) throw new Error(`sb ${res.status}: ${t.slice(0, 200)}`);
    return t ? (t[0] === '[' || t[0] === '{' ? JSON.parse(t) : t) : null;
}

// The "brain": curated how-to + SOP knowledge. Keep accurate + concise (it's sent every call).
const KB = `Kau ialah pembantu AI dalaman untuk staf kedai 10 CAMP (kedai gear camping/outdoor di Cyberjaya) yang guna sistem POS web sendiri. Jawab soalan staf tentang CARA GUNA sistem + SOP kerja. Bahasa: ikut bahasa soalan (BM/Manglish atau English), ringkas, mesra, JANGAN guna emoji. Kalau soalan di luar pengetahuan ni atau pasal data sebenar (cth "stok BD103 berapa"), JANGAN teka — kata "Aku tak boleh tengok data live lagi; check sendiri di [tempat] atau tanya Bos/Aliff." Jangan reka fakta.

PENGETAHUAN SISTEM POS 10 CAMP:
- LOGIN: guna email+password (atau PIN kalau ada). Sesi kekal sampai logout.
- CASHIER (jual walk-in): menu Cashier → tambah barang ke troli (scan/cari SKU) → "Bayar". Boleh letak Diskaun Custom (RM atau %) + sebab. Pilih channel + kaedah bayaran. Tag NAMA STAF supaya komisen dikira. VIP customer auto dikesan (cadangan diskaun, masuk manual).
- REFUND / RETURN: buka order di All Orders → "Urus" → pilih barang + qty nak return, tanda "pulang ke stok" kalau barang elok. Refund penuh = status jadi Refunded; separa = kekal, direkod. Stok auto pulang ikut yang dipilih.
- VOID / BATAL order: dari All Orders. Kalau order pernah tolak stok, void akan pulang balik stok automatik.
- STOK: Semakan Stok (Stock Take) untuk kira fizikal; adjust stok di kad produk (PDP) → "Adjust Stock" (positif=tambah, negatif=kurang) + sebab. Stok online (Shopee/TikTok) auto-sync.
- PRODUK: Master Produk = senarai semua. Kalkulator Harga = set kos + harga. Bundles = cantum barang jadi pakej.
- KOMISEN: tiap staf ada "My Commission" (lihat sendiri). Komisen = 5% dari base jualan yang ditag nama staf. Order batal/void TAK dikira. Komisen bulan X biasa dibayar dalam gaji bulan X+1. Soalan kiraan detail → tanya Aliff.
- JUALAN WALK-IN TAK BER-STAF: kalau order tak ditag nama, komisen tak boleh kira. Aliff assign di Commission Report > Jualan Tak Dituntut.
- HR: menu Cuti (lihat baki cuti, pohon cuti) + Claim (hantar tuntutan perubatan/pengangkutan/makanan/dll). Bos lulus/tolak.
- ROSTER/JADUAL: jadual syif di Jadual Operasi (Syif B/C/OFF/AL/MC). Bos set.
- PUSAT AMARAN (BARU): tab "Amaran" di Home tunjuk perkara perlu perhatian ikut bahagian kau — Sales nampak hal harga/jualan, Inventory nampak hal stok, Bos nampak semua. Tiap amaran ada butang terus ke tempat betulkan.
- LOCENG NOTIFIKASI (BARU): atas kanan, ada tapisan Belum baca / Penting / Semua. Notifikasi lama auto-hilang.
- MARKETPLACE: Shopee + TikTok sync automatik (stok + harga + order). Harga marketplace diset PER-PRODUK di kad Variants (bukan global), biasa lebih tinggi dari harga walk-in (tutup caj marketplace). POS tak boleh tukar harga KEMPEN — betulkan di Seller Centre.
- REPORTS: menu Reports. Ada Laporan Sulit (untung/kos/komisen) — kunci PIN.
- SIAPA HUBUNGI: Bos = Zaid (keputusan, harga, polisi). Aliff = admin/kewangan/komisen/claim. Zack = sistem/teknikal/bug. Kael/Fahmi = inventory.
- MASALAH TEKNIKAL (bug, skrin rosak, sync tak jalan): bagitahu Zack. Untuk amaran integrasi marketplace, tengok tab Amaran di Home.

Kalau staf tanya benda yang patut Bos/Aliff putuskan (cth lulus diskaun besar, polisi baru), suruh mereka rujuk orang yang betul. Jawapan pendek + praktikal.`;

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

    const auth = await requireStaff(event);
    if (!auth.ok) return auth.response;
    if (!OPENAI_KEY) return json(500, { error: 'OPENAI_API_KEY tak set' });

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}
    let history = Array.isArray(body.messages) ? body.messages : [];
    // sanitise + cap history (control token cost): keep last 8 turns, only user/assistant text
    history = history.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) })).slice(-8);
    if (!history.length || history[history.length - 1].role !== 'user') return json(400, { error: 'no user message' });

    // ---- monthly cost cap ----
    const ym = new Date().toISOString().slice(0, 7);
    const usageKey = 'ai_usage_' + ym;
    let usage = { cost_usd: 0, calls: 0, in_tok: 0, out_tok: 0 };
    try {
        const rows = await sb('GET', `/app_settings?key=eq.${usageKey}&select=value&limit=1`);
        if (rows && rows[0] && rows[0].value) usage = Object.assign(usage, rows[0].value);
    } catch (_) { /* if usage read fails, allow (don't block staff over a tracking glitch) */ }
    if (usage.cost_usd >= CAP_USD) {
        return json(200, { reply: 'Maaf, had penggunaan AI untuk bulan ni dah dicapai. Cuba lagi bulan depan, atau bagitahu Bos kalau perlu naikkan had.', capped: true });
    }

    // ---- call OpenAI ----
    let reply = '', pin = 0, pout = 0;
    try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: 'system', content: KB }, ...history],
                temperature: 0.3,
                max_tokens: 500
            })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return json(502, { error: 'AI gagal jawab', detail: (d.error && d.error.message) || r.status });
        reply = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || 'Maaf, aku tak dapat jawab tu. Cuba tanya lain.';
        pin = (d.usage && d.usage.prompt_tokens) || 0;
        pout = (d.usage && d.usage.completion_tokens) || 0;
    } catch (e) {
        return json(502, { error: 'AI gagal jawab', detail: String(e.message || e).slice(0, 150) });
    }

    // ---- record usage (best-effort) ----
    try {
        const cost = pin * PRICE_IN + pout * PRICE_OUT;
        const next = { cost_usd: +(usage.cost_usd + cost).toFixed(6), calls: (usage.calls || 0) + 1, in_tok: (usage.in_tok || 0) + pin, out_tok: (usage.out_tok || 0) + pout, updated_at: new Date().toISOString() };
        await sb('POST', '/app_settings?on_conflict=key', { key: usageKey, value: next }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    } catch (_) { /* tracking failure must not break the reply */ }

    return json(200, { reply });
};
