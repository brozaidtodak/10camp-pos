/**
 * tiktok-live-gmv-cron.js — AUTO-ISI ANGKA RASMI LIVE GMV dari TikTok API (p1_1180).
 * Zaid: "aku tak nak tambah kerja staff" — ganti SOP manual (staf baca TikTok Seller →
 * Data Analysis → Live → taip dlm kotak Angka Rasmi p1_1166) dengan tarikan API harian.
 *
 * Endpoint: GET /analytics/202509/shop_lives/performance (scope data.shop_analytics.public.read)
 * — pulangkan SETIAP sesi live rasmi: start_time/end_time (unix) + sales_performance.gmv
 * (currency LOCAL = MYR) + sku_orders + items_sold.
 *
 * Aliran (tiap pagi 08:30 MYT, lihat netlify.toml):
 *  1. Tarik sesi live rasmi TikTok 3 hari terakhir.
 *  2. Padan dgn live_sessions kita ikut pertindihan masa (toleransi ±30 min).
 *  3. Auto-isi live_sales_rm (= kotak Angka Rasmi; komisen terus kira dari angka rasmi,
 *     marketing.js __liveKom) + orders_count + items_sold. API = sumber kebenaran, jadi
 *     nilai sedia ada DITIMPA bila berbeza.
 *  4. Sesi rasmi TikTok yang TIADA rekod kita (staf lupa rekod) → dilapor dlm summary.
 *  ?dry=1 (staff JWT) = preview penuh tanpa tulis — juga ujian scope token.
 */
const { requireAuth } = require('./_auth');
const { sb, ttRequest, getValidToken, ensureShopCipher } = require('./_tiktok');

const TOL_MS = 30 * 60 * 1000; // toleransi padanan masa ±30 min

function overlapMs(a0, a1, b0, b1) {
    const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
    return Math.max(0, hi - lo);
}

exports.handler = async (event) => {
    const a = await requireAuth(event); if (!a.ok) return a.response;
    const dry = !!(event && event.queryStringParameters && event.queryStringParameters.dry);
    const out = { dry, tiktok_sessions: 0, matched: [], unmatched_tiktok: [], updated: 0, skipped_same: 0 };
    try {
        const tok = await getValidToken();
        const cipher = await ensureShopCipher(tok);

        // Tetingkap: 3 hari terakhir (MYT). end_date_lt eksklusif = esok.
        // ?days=N (max 60) utk backfill sejarah lama secara manual (run sekali).
        let days = parseInt(event && event.queryStringParameters && event.queryStringParameters.days, 10) || 3;
        if (days < 1) days = 1; if (days > 60) days = 60;
        const myt = new Date(Date.now() + 8 * 3600e3);
        const ymd = (d) => d.toISOString().slice(0, 10);
        const endLt = ymd(new Date(myt.getTime() + 24 * 3600e3));
        const startGe = ymd(new Date(myt.getTime() - days * 24 * 3600e3));
        out.window = { start_date_ge: startGe, end_date_lt: endLt };

        // 1) Sesi live rasmi TikTok (pagination page_token)
        let ttSessions = [], pageToken = '';
        for (let i = 0; i < 5; i++) {
            const q = { start_date_ge: startGe, end_date_lt: endLt, page_size: 100, currency: 'LOCAL' };
            if (pageToken) q.page_token = pageToken;
            const res = await ttRequest('GET', '/analytics/202509/shop_lives/performance', {
                query: q, accessToken: tok.access_token, shopCipher: cipher
            });
            if (res.code !== 0) {
                // Ralat scope/permission dilapor terus — utk diagnosis (perlu re-auth app?)
                return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'tiktok api', code: res.code, message: res.message, hint: 'code 105/permission = scope data.shop_analytics.public.read tiada — tambah kebenaran Analytics dlm Partner Center + re-authorize' }) };
            }
            const list = (res.data && res.data.live_stream_sessions) || [];
            ttSessions = ttSessions.concat(list);
            pageToken = (res.data && res.data.next_page_token) || '';
            if (!pageToken || !list.length) break;
        }
        out.tiktok_sessions = ttSessions.length;

        // 2) Sesi kita dlm tetingkap sama
        const ours = await sb('GET', '/live_sessions?select=id,session_date,start_at,end_at,host_name,live_sales_rm,orders_count,items_sold'
            + '&session_date=gte.' + startGe + '&start_at=not.is.null&end_at=not.is.null');

        // 3) Padankan: tiap sesi TikTok → sesi kita dgn pertindihan masa terbesar (±30 min)
        const assigned = {}; // ourId -> { gmv, orders, items, tt: [] }
        ttSessions.forEach(t => {
            const t0 = parseInt(t.start_time, 10) * 1000, t1 = parseInt(t.end_time, 10) * 1000;
            if (!t0 || !t1) return;
            let best = null, bestOv = 0;
            (ours || []).forEach(s => {
                const s0 = new Date(s.start_at).getTime() - TOL_MS, s1 = new Date(s.end_at).getTime() + TOL_MS;
                const ov = overlapMs(t0, t1, s0, s1);
                if (ov > bestOv) { bestOv = ov; best = s; }
            });
            const gmv = parseFloat(t.sales_performance && t.sales_performance.gmv && t.sales_performance.gmv.amount) || 0;
            const orders = parseInt(t.sales_performance && t.sales_performance.sku_orders, 10) || 0;
            const items = parseInt(t.sales_performance && t.sales_performance.items_sold, 10) || 0;
            if (!best) {
                out.unmatched_tiktok.push({ title: t.title || '', username: t.username || '', start: new Date(t0).toISOString(), gmv,
                    _t0: t0, _t1: t1, _orders: orders, _items: items });
                return;
            }
            const slot = assigned[best.id] = assigned[best.id] || { sess: best, gmv: 0, orders: 0, items: 0, tt: 0 };
            slot.gmv += gmv; slot.orders += orders; slot.items += items; slot.tt++;
        });

        // 4) Tulis (atau preview) — API = sumber kebenaran, timpa nilai lama bila beza
        for (const id of Object.keys(assigned)) {
            const m = assigned[id];
            const newVal = Math.round(m.gmv * 100) / 100;
            const oldVal = m.sess.live_sales_rm != null ? parseFloat(m.sess.live_sales_rm) : null;
            const rec = { session_id: m.sess.id, date: m.sess.session_date, host: m.sess.host_name,
                gmv_rasmi: newVal, gmv_lama: oldVal, orders: m.orders, tiktok_sesi_dipadamkan: m.tt };
            out.matched.push(rec);
            if (oldVal != null && Math.abs(oldVal - newVal) < 0.005) { out.skipped_same++; continue; }
            if (!dry) {
                await sb('PATCH', '/live_sessions?id=eq.' + m.sess.id,
                    { live_sales_rm: newVal, orders_count: m.orders || null, items_sold: m.items || null },
                    { Prefer: 'return=minimal' });
                out.updated++;
            }
        }
        // p1_1180b — BACKFILL MANUAL (?backfill_host=Ariff): cipta rekod live_sessions utk sesi
        // rasmi 10campofficial yang TIADA rekod kita (staf tak rekod — cth lubang 14 Jun-13 Jul).
        // Host disahkan Zaid dulu (TikTok tak bagitahu siapa host). TIDAK berjalan dlm cron
        // berjadual (param tiada). Sesi GMV 0 dilangkau (tiada kesan komisen).
        const bfHost = event && event.queryStringParameters && event.queryStringParameters.backfill_host;
        if (bfHost && !dry) {
            out.backfilled = [];
            for (const u of out.unmatched_tiktok) {
                if (u.username !== '10campofficial' || !(u.gmv > 0)) continue;
                const mytDate = new Date(u._t0 + 8 * 3600e3).toISOString().slice(0, 10);
                await sb('POST', '/live_sessions', {
                    session_date: mytDate, host_name: bfHost,
                    start_at: new Date(u._t0).toISOString(), end_at: new Date(u._t1).toISOString(),
                    live_sales_rm: u.gmv, orders_count: u._orders || null, items_sold: u._items || null,
                    note: 'Auto-backfill dari TikTok API (p1_1180)', created_by: 'tiktok-live-gmv-cron'
                }, { Prefer: 'return=minimal' });
                out.backfilled.push({ date: mytDate, gmv: u.gmv, orders: u._orders });
            }
        }
        out.unmatched_tiktok = out.unmatched_tiktok.map(u => ({ title: u.title, username: u.username, start: u.start, gmv: u.gmv }));
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) };
    } catch (e) {
        return { statusCode: 200, body: 'tiktok-live-gmv error: ' + String(e.message || e).slice(0, 250) };
    }
};
