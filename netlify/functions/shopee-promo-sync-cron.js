/**
 * shopee-promo-sync-cron.js — scheduled trigger (see netlify.toml). Fires the heavy
 * shopee-promo-sync-background function so active Shopee discounts + below_cost flags
 * stay fresh on products_master.shopee_campaign. Returns immediately.
 */
exports.handler = async () => {
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://www.10camp.com';
    try {
        await fetch(`${base}/.netlify/functions/shopee-promo-sync-background?mode=sync`);
    } catch (e) {
        return { statusCode: 200, body: `trigger attempted: ${String(e)}` };
    }
    return { statusCode: 200, body: 'shopee-promo-sync-background triggered' };
};
