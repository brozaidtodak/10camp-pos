/**
 * TikTok Cron Sync — Netlify Scheduled Function (p1_104).
 * Mirror shopee-sync-cron.js pattern.
 *
 * Note: schedule NOT activated in netlify.toml by default — TikTok orders
 * masih sync via EasyStore. Aktifkan bila ready cutover ke direct API
 * (uncomment schedule block dalam netlify.toml).
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const SITE_URL     = process.env.URL || 'https://www.10camp.com';

async function logRun(row) {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/tiktok_sync_log`, {
            method: 'POST',
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal'
            },
            body: JSON.stringify(row)
        });
    } catch (e) { /* silent */ }
}

exports.handler = async () => {
    const startMs = Date.now();
    const base = { source: 'cron', mode: 'import', ran_at: new Date().toISOString() };

    try {
        const res = await fetch(`${SITE_URL}/api/tiktok-sync?mode=import`);
        const json = await res.json();
        const duration = Date.now() - startMs;

        if (json.error) {
            await logRun({
                ...base,
                error_message: String(json.error).slice(0, 500),
                duration_ms: duration,
                raw_response: json
            });
            return { statusCode: 200, body: 'cron logged error' };
        }
        await logRun({
            ...base,
            orders_found: json.orders_found || 0,
            orders_new: json.new || 0,
            orders_inserted: json.inserted || 0,
            duration_ms: duration,
            raw_response: { since: json.since, mapped: json.mapped, ok: json.ok }
        });
        return { statusCode: 200, body: `cron ok: ${json.inserted || 0} new orders` };
    } catch (e) {
        await logRun({
            ...base,
            error_message: String(e).slice(0, 500),
            duration_ms: Date.now() - startMs
        });
        return { statusCode: 500, body: 'cron failed' };
    }
};
