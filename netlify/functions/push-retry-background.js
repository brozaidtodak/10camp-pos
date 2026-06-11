/**
 * push-retry-background.js — Integration hardening #6 (p1_639).
 *
 * Retries marketplace price pushes that failed and were parked in push_failures
 * (the dead-letter table). Picks rows that are due (status=pending, next_retry_at<=now),
 * groups by channel, and re-invokes marketplace-price-push?mode=push&channel=X&skus=...
 * for them. The push function itself records the outcome: a success DELETEs the row
 * (self-heal); a repeat failure escalates attempts + backoff; after MAX_ATTEMPTS the
 * row becomes status=dead (surfaced in the daily email, alert card, health dashboard).
 *
 * Background fn (returns 202) — cron-triggered every 30 min. ?mode=peek lists what's due.
 */
const sb = require('./_tiktok').sb; // service-key PostgREST helper
const BATCH = 60;
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj, null, 2) });
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

exports.handler = async (event) => {
    const mode = (event && event.queryStringParameters && event.queryStringParameters.mode) || 'sync';
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://www.10camp.com';
    const now = new Date().toISOString();
    const out = { checked_at: now };
    try {
        const due = await sb('GET', `/push_failures?select=sku,channel,attempts&status=eq.pending&next_retry_at=lte.${encodeURIComponent(now)}&order=channel`) || [];
        const byChannel = { shopee: [], tiktok: [] };
        for (const r of due) if (byChannel[r.channel]) byChannel[r.channel].push(String(r.sku).toUpperCase());
        out.due = { shopee: byChannel.shopee.length, tiktok: byChannel.tiktok.length };

        if (mode === 'peek') { out.sample = due.slice(0, 40); return json(200, out); }

        out.retried = { shopee: 0, tiktok: 0 };
        for (const channel of ['shopee', 'tiktok']) {
            const skus = [...new Set(byChannel[channel])];
            for (const batch of chunk(skus, BATCH)) {
                const url = `${base}/.netlify/functions/marketplace-price-push?mode=push&channel=${channel}&skus=${encodeURIComponent(batch.join(','))}`;
                try { await fetch(url, { method: 'GET' }); out.retried[channel] += batch.length; }
                catch (e) { out.retry_error = `${channel}: ${String(e).slice(0, 150)}`; }
            }
        }
        // post-run snapshot
        const left = await sb('GET', '/push_failures?select=status') || [];
        out.remaining = { pending: left.filter(r => r.status === 'pending').length, dead: left.filter(r => r.status === 'dead').length };
        return json(200, out);
    } catch (err) {
        out.error = String(err).slice(0, 200);
        return json(500, out);
    }
};
