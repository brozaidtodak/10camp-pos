/**
 * push-retry-cron.js — scheduled trigger (see netlify.toml, every 30 min). Fires
 * push-retry-background so parked marketplace price-push failures get re-attempted
 * with backoff. Returns immediately.
 */
exports.handler = async () => {
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://www.10camp.com';
    try { await fetch(`${base}/.netlify/functions/push-retry-background?mode=sync`); }
    catch (e) { return { statusCode: 200, body: `trigger attempted: ${String(e)}` }; }
    return { statusCode: 200, body: 'push-retry-background triggered' };
};
