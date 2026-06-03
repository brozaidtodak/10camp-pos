/**
 * Shopee Sync Status — read latest sync log entries for UI display.
 *
 * Public URL: https://www.10camp.com/api/shopee-sync-status
 *
 * Returns: { last_run, last_5_runs, totals_today }
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

async function sb(path) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    return res.json();
}

exports.handler = async () => {
    if (!SERVICE_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: 'SUPABASE_SERVICE_KEY not set' }) };
    }
    try {
        const last5 = await sb('/shopee_sync_log?order=ran_at.desc&limit=5&select=id,ran_at,source,mode,orders_found,orders_new,orders_inserted,error_message,duration_ms');
        const today = new Date(); today.setHours(0,0,0,0);
        const todayRuns = await sb(`/shopee_sync_log?order=ran_at.desc&ran_at=gte.${today.toISOString()}&select=orders_inserted,error_message`);
        const todayInserted = (todayRuns || []).reduce((s, r) => s + (r.orders_inserted || 0), 0);
        const todayErrors = (todayRuns || []).filter(r => r.error_message).length;
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
            body: JSON.stringify({
                last_run: last5[0] || null,
                last_5: last5,
                today: {
                    runs: todayRuns.length,
                    inserted: todayInserted,
                    errors: todayErrors
                }
            })
        };
    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
    }
};
