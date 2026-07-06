/**
 * meta-webhook.js — receives FB Messenger + Instagram DM events from Meta (p1_1079).
 *
 *   GET  → webhook verification handshake (Meta sends hub.challenge on subscribe).
 *   POST → incoming message events → stored into meta_messages (channel 'fb' / 'ig').
 *
 * PUBLIC endpoint (Meta calls it server-to-server, no staff JWT). Security:
 *   - GET verify: hub.verify_token must equal META_VERIFY_TOKEN.
 *   - POST: if META_APP_SECRET is set, X-Hub-Signature-256 is verified; else accepted (progressive-safe).
 *
 * Meta App Dashboard setup (once): Webhooks → callback URL = https://www.10camp.com/.netlify/functions/meta-webhook,
 * verify token = value of META_VERIFY_TOKEN, subscribe fields: messages, messaging_postbacks.
 *
 * Public URL: /.netlify/functions/meta-webhook
 */
const crypto = require('crypto');
const { sb } = require('./_meta');

// Default so the endpoint verifies even before the env var is set; override in Netlify env for real security.
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || '10camp_meta_webhook_verify';
const APP_SECRET   = process.env.META_APP_SECRET || '';

function signatureOk(event) {
    if (!APP_SECRET) return true; // progressive-safe: no secret configured → skip (like INTERNAL_FN_SECRET pattern)
    try {
        const h = (event.headers || {});
        const sig = h['x-hub-signature-256'] || h['X-Hub-Signature-256'] || '';
        const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(event.body || '', 'utf8').digest('hex');
        // timing-safe compare
        const a = Buffer.from(sig), b = Buffer.from(expected);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (e) { return false; }
}

// Pull message rows out of one webhook entry. Handles both FB Page ('messaging') and IG shapes.
function extractRows(body) {
    const rows = [];
    const channel = (body.object === 'instagram') ? 'ig' : 'fb';
    (body.entry || []).forEach(entry => {
        const events = entry.messaging || entry.standby || [];
        events.forEach(ev => {
            const senderId = ev.sender && ev.sender.id;
            const m = ev.message;
            if (!senderId || !m) return;
            if (m.is_echo) return; // page's own outbound echo — we store our own sends separately
            rows.push({
                channel,
                thread_id: String(senderId),
                direction: 'in',
                text: m.text != null ? String(m.text) : null,
                mid: m.mid || null,
                attachments: m.attachments ? m.attachments : null,
                raw: ev
            });
        });
    });
    return rows;
}

exports.handler = async (event) => {
    // --- GET: verification handshake ---
    if (event.httpMethod === 'GET') {
        const p = event.queryStringParameters || {};
        const mode = p['hub.mode'];
        const token = p['hub.verify_token'];
        const challenge = p['hub.challenge'];
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: String(challenge || '') };
        }
        return { statusCode: 403, body: 'verification failed' };
    }

    // --- POST: incoming events ---
    if (event.httpMethod === 'POST') {
        if (!signatureOk(event)) return { statusCode: 401, body: 'bad signature' };
        let body = {};
        try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 200, body: 'ok' }; }
        try {
            const rows = extractRows(body);
            // Insert; ignore-duplicates on mid so Meta retries don't double-store.
            if (rows.length) {
                await sb('POST', '/meta_messages', rows, { Prefer: 'resolution=ignore-duplicates,return=minimal' });
            }
        } catch (e) {
            // Never 5xx to Meta or it will retry aggressively; log-and-ack.
            console.error('meta-webhook store error:', e && e.message);
        }
        // Meta requires a fast 200 ack.
        return { statusCode: 200, body: 'EVENT_RECEIVED' };
    }

    return { statusCode: 405, body: 'method not allowed' };
};
