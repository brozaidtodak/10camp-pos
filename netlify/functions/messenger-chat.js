/**
 * messenger-chat.js — FB Messenger + Instagram DM inbox for the POS omnichannel chat (p1_1079).
 *
 *   ?mode=conversations&channel=fb|ig   — list threads (grouped from meta_messages, latest first)
 *   ?mode=messages&channel=..&conversation_id=THREAD  — messages in one thread (old→new)
 *   POST { to_id, message, channel }     — send a reply via Graph, store outgoing row
 *
 * Reads/writes the meta_messages store (populated by meta-webhook). Sends via the page token
 * in meta_tokens. Gated by requireAuth. Public URL: /.netlify/functions/messenger-chat
 */
const { sb, getMetaConfig, graph } = require('./_meta');
const { requireAuth } = require('./_auth');

function json(code, obj) {
    return { statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj, null, 2) };
}
function q(v) { return encodeURIComponent(v); }

exports.handler = async (event) => {
    const auth = await requireAuth(event);
    if (!auth.ok) return auth.response;

    const p = (event && event.queryStringParameters) || {};
    const channel = (p.channel === 'ig') ? 'ig' : 'fb';

    try {
        if (event.httpMethod === 'POST') {
            let body = {};
            try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'bad json' }); }
            const toId = String(body.to_id || '').trim();
            const message = String(body.message || '').trim();
            const ch = (body.channel === 'ig') ? 'ig' : 'fb';
            if (!toId || !message) return json(400, { error: 'to_id and message required' });

            const cfg = await getMetaConfig();
            if (!cfg || !cfg.page_access_token) return json(400, { error: 'meta not connected' });

            // Send via Graph: /me/messages with the page token. messaging_type RESPONSE = reply within window.
            let sendRes;
            try {
                sendRes = await graph('/me/messages', {
                    token: cfg.page_access_token,
                    method: 'POST',
                    body: { recipient: { id: toId }, message: { text: message }, messaging_type: 'RESPONSE' }
                });
            } catch (e) {
                return json(200, { error: e.message || String(e), graph: e.graph || null });
            }
            // Store our outgoing message so the thread shows it immediately.
            await sb('POST', '/meta_messages', {
                channel: ch, thread_id: toId, direction: 'out', text: message,
                mid: (sendRes && sendRes.message_id) || null, sender_name: cfg.page_name || 'Page', raw: sendRes
            }, { Prefer: 'resolution=ignore-duplicates,return=minimal' });

            return json(200, { ok: true, sent: sendRes });
        }

        const mode = p.mode || 'conversations';

        if (mode === 'messages') {
            const thread = String(p.conversation_id || '').trim();
            if (!thread) return json(400, { error: 'conversation_id required' });
            const rows = await sb('GET', `/meta_messages?channel=eq.${q(channel)}&thread_id=eq.${q(thread)}&order=created_at.asc&limit=200`);
            return json(200, { messages: rows || [] });
        }

        // default: conversations — fetch recent rows, group into threads (latest message wins).
        const rows = await sb('GET', `/meta_messages?channel=eq.${q(channel)}&order=created_at.desc&limit=300`);
        const byThread = new Map();
        (rows || []).forEach(r => {
            if (!byThread.has(r.thread_id)) {
                byThread.set(r.thread_id, {
                    thread_id: r.thread_id,
                    name: r.sender_name || r.thread_id,
                    last_text: r.text || '[lampiran]',
                    last_at: r.created_at,
                    last_direction: r.direction
                });
            }
        });
        const conversations = Array.from(byThread.values());
        return json(200, { conversations });
    } catch (e) {
        return json(500, { error: String(e && e.message || e) });
    }
};
