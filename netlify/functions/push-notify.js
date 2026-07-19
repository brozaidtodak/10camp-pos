/**
 * push-notify.js — trigger notification order masuk dari client (kasir/web checkout) (p1_1119).
 * POST { channel, total }
 * Auth: staff session. Sync Shopee/TikTok TIDAK guna endpoint ni — dia panggil _pushcore terus.
 */

const { requireStaff } = require('./_auth');
const { notifyNewOrders } = require('./_pushcore');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
    const gate = await requireStaff(event);
    if (!gate.ok) return gate.response;

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}
    const channel = String(body.channel || 'POS').slice(0, 40);
    const total = (body.total != null && isFinite(Number(body.total))) ? Number(body.total) : null;

    try {
        const out = await notifyNewOrders({ channel, count: 1, total });
        return { statusCode: 200, body: JSON.stringify(out) };
    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: String(e.message || e).slice(0, 200) }) };
    }
};
