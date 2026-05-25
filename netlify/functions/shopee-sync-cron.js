/**
 * Shopee Cron Sync — Netlify Scheduled Function (p1_98 Fasa 2D).
 *
 * Runs every 15 minutes via netlify.toml schedule.
 * Calls /api/shopee-sync?mode=import internally, logs result to
 * public.shopee_sync_log for monitoring.
 *
 * Schedule: "<asterisk>/15 <asterisk> <asterisk> <asterisk> <asterisk>" — every 15 minutes
 *
 * To pause cron temporarily: comment out [functions."shopee-sync-cron"]
 * block in netlify.toml.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const SITE_URL     = process.env.URL || 'https://pos.10camp.com';
const ENV          = (process.env.SHOPEE_ENV || 'sandbox').toLowerCase();

async function logRun(row) {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/shopee_sync_log`, {
            method: 'POST',
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal'
            },
            body: JSON.stringify(row)
        });
    } catch (e) { /* swallow log errors */ }
}

exports.handler = async () => {
    const startMs = Date.now();
    const base = {
        source: 'cron',
        mode: 'import',
        environment: ENV,
        ran_at: new Date().toISOString()
    };

    try {
        const res = await fetch(`${SITE_URL}/api/shopee-sync?mode=import`);
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
