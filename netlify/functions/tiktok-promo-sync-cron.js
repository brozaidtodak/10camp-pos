/**
 * tiktok-promo-sync-cron.js — scheduled trigger (see netlify.toml schedule).
 * Fires the heavy tiktok-promo-sync-background function (which has the 15-min
 * background budget) so active TikTok campaigns + below_cost flags stay fresh on
 * products_master.tiktok_campaign. Returns immediately.
 */
exports.handler = async () => {
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://www.10camp.com';
    try {
        await fetch(`${base}/.netlify/functions/tiktok-promo-sync-background?mode=sync`);
    } catch (e) {
        return { statusCode: 200, body: `trigger attempted: ${String(e)}` };
    }
    return { statusCode: 200, body: 'tiktok-promo-sync-background triggered' };
};
