/**
 * tiktok-order-probe.js — SIASATAN (read-only, sementara).
 * Tarik beberapa order TikTok terkini & pulangkan STRUKTUR medan sahaja
 * (redact PII: alamat/nama/emel/telefon) untuk semak ada tak medan
 * attribution LIVE/livestream/source. Buang fungsi ni lepas siasat.
 *
 * Public URL: /.netlify/functions/tiktok-order-probe?days=21
 */
const { VERSION, ttRequest, getValidToken, ensureShopCipher } = require('./_tiktok');
function json(code, obj){ return { statusCode: code, headers: {'Content-Type':'application/json; charset=utf-8'}, body: JSON.stringify(obj, null, 2) }; }
const PII = /address|recipient|buyer_email|buyer_message|phone|name|email|first_name|last_name|cpf|tax_number|full_address/i;
function redact(obj, depth){
  if(depth>6 || obj===null) return obj;
  if(Array.isArray(obj)) return obj.slice(0,2).map(x=>redact(x,depth+1));
  if(typeof obj==='object'){
    const out={};
    for(const k of Object.keys(obj)){
      if(PII.test(k)){ out[k]='[redacted]'; continue; }
      out[k]=redact(obj[k], depth+1);
    }
    return out;
  }
  return obj;
}
function scanLive(obj, path, hits){
  if(obj===null||typeof obj!=='object') return;
  for(const k of Object.keys(obj)){
    const p = path?path+'.'+k:k;
    if(/live|stream|content|source|attribut|channel|creator|host|campaign/i.test(k)){
      hits.push({ field: p, value: (typeof obj[k]==='object'?'[obj]':obj[k]) });
    }
    if(typeof obj[k]==='object') scanLive(obj[k], p, hits);
  }
}
exports.handler = async (event) => {
  const p = (event && event.queryStringParameters) || {};
  const days = Math.min(parseInt(p.days)||21, 60);
  try {
    const tok = await getValidToken();
    const cipher = await ensureShopCipher(tok);
    const ge = Math.floor(Date.now()/1000) - days*86400;
    const search = await ttRequest('POST', `/order/${VERSION}/orders/search`, {
      query: { page_size: 20 }, body: { create_time_ge: ge },
      accessToken: tok.access_token, shopCipher: cipher
    });
    if(search.code !== 0) return json(200, { step:'search', code: search.code, message: search.message });
    const ids = ((search.data && search.data.orders) || []).map(o=>o.id).slice(0,3);
    if(!ids.length) return json(200, { note:'no orders in window', days });
    const det = await ttRequest('GET', `/order/${VERSION}/orders`, {
      query: { ids: ids.join(',') }, accessToken: tok.access_token, shopCipher: cipher
    });
    if(det.code !== 0) return json(200, { step:'detail', code: det.code, message: det.message });
    const orders = (det.data && det.data.orders) || [];
    const first = orders[0] || {};
    const liveHits = [];
    orders.forEach(o => scanLive(o, '', liveHits));
    return json(200, {
      days, orders_checked: orders.length,
      top_level_keys: Object.keys(first).sort(),
      line_item_keys: (first.line_items && first.line_items[0]) ? Object.keys(first.line_items[0]).sort() : [],
      live_related_fields: liveHits,
      sample_order_redacted: redact(first, 0)
    });
  } catch(e){ return json(500, { error: String(e) }); }
};
