// backoffice-dash.js — p1_1036: dashboard back-office diekstrak dari app.js (lazy-load).
// Kandungan: Returns/Damage Tracker + Supplier Perf + Brand Perf (R1) · Channel Profitability +
// Reorder Auto-Suggest (R2a) · Inventory History (R2b). Margin Watcher & template simple report KEKAL di app.js.
// Classic <script> (BUKAN module) — baca db/masterProducts/salesHistory/inventoryBatches dari global
// lexical scope app.js; MESTI dimuat SELEPAS app.js. Dimuat oleh window.__ensureBackofficeDash.

// p1_121 — Returns/Damage Tracker
window.__rlAllRows = [];

window.renderReturnsLog = async function() {
 const wrap = document.getElementById('rlTableWrap');
 const problemWrap = document.getElementById('rlProblemSku');
 if(!wrap) return;
 wrap.innerHTML = '<p style="color:#9CA3AF; padding:20px; text-align:center;">Memuatkan…</p>';

 const period = document.getElementById('rlPeriod').value || '30d';
 const typeFilter = document.getElementById('rlType').value || 'all';
 const search = (document.getElementById('rlSearch').value || '').toUpperCase().trim();

 let sinceDate = null;
 const now = new Date();
 if(period === '30d') sinceDate = new Date(now.getTime() - 30 * 86400000);
 else if(period === '90d') sinceDate = new Date(now.getTime() - 90 * 86400000);
 else if(period === '180d') sinceDate = new Date(now.getTime() - 180 * 86400000);
 else if(period === 'ytd') sinceDate = new Date(now.getFullYear(), 0, 1);

 try {
 if(typeof db === 'undefined' || !db) throw new Error('DB tak available');
 let q = db.from('returns_log').select('*').order('reported_at', { ascending: false }).limit(500);
 if(sinceDate) q = q.gte('reported_at', sinceDate.toISOString());
 const { data, error } = await q;
 if(error) throw error;
 let rows = (data || []);
 if(typeFilter !== 'all') rows = rows.filter(r => r.type === typeFilter);
 if(search) rows = rows.filter(r => (r.sku || '').toUpperCase().includes(search) || (r.supplier || '').toUpperCase().includes(search) || (r.product_name || '').toUpperCase().includes(search));
 window.__rlAllRows = rows;

 // KPI aggregations
 const totalEntries = rows.length;
 const totalUnits = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
 const totalCost = rows.reduce((s, r) => s + (Number(r.cost_impact) || 0) * (Number(r.qty) || 0), 0);
 const reasonTally = {};
 const skuTally = {};
 rows.forEach(r => {
 reasonTally[r.reason || 'other'] = (reasonTally[r.reason || 'other'] || 0) + 1;
 const sku = (r.sku || '').toUpperCase();
 if(sku) {
 if(!skuTally[sku]) skuTally[sku] = { sku, name: r.product_name || sku, qty: 0, costImpact: 0, entries: 0, supplier: r.supplier || '' };
 skuTally[sku].qty += Number(r.qty) || 0;
 skuTally[sku].costImpact += (Number(r.cost_impact) || 0) * (Number(r.qty) || 0);
 skuTally[sku].entries++;
 }
 });
 const topReasonEntry = Object.entries(reasonTally).sort((a,b) => b[1] - a[1])[0];

 document.getElementById('rlTotalEntries').textContent = totalEntries;
 document.getElementById('rlTotalUnits').textContent = totalUnits;
 document.getElementById('rlTotalCost').textContent = 'RM ' + Number(totalCost).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
 document.getElementById('rlTopReason').textContent = topReasonEntry ? (topReasonEntry[0].slice(0, 20) + ' (' + topReasonEntry[1] + ')') : '—';

 // Problem SKUs (top 5)
 const problems = Object.values(skuTally).sort((a, b) => b.qty - a.qty).slice(0, 5);
 const escAttr = (s) => String(s == null ? '' : s).replace(/"/g,'&quot;').replace(/</g,'&lt;');
 const fmtRMC = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
 if(problemWrap) {
 if(!problems.length) problemWrap.innerHTML = '<p style="color:#101010; padding:14px;">Tiada SKU bermasalah dalam period ni — bagus.</p>';
 else problemWrap.innerHTML = `<table class="rp-comm-table">
 <thead><tr><th>SKU</th><th>Nama / Supplier</th><th style="text-align:right;">Entries</th><th style="text-align:right;">Units</th><th style="text-align:right;">Cost Impact</th></tr></thead>
 <tbody>${problems.map(p => `
 <tr style="background:rgba(254,226,226,.3);">
 <td><strong>${escAttr(p.sku)}</strong></td>
 <td style="font-size:12px;">${escAttr(p.name).slice(0, 50)}<br><span style="color:#6B7280; font-size:11px;">Supplier: ${escAttr(p.supplier) || '—'}</span></td>
 <td style="text-align:right;">${p.entries}</td>
 <td style="text-align:right; color:#B23A2E; font-weight:700;">${p.qty}</td>
 <td style="text-align:right; color:#B23A2E; font-weight:700;">${fmtRMC(p.costImpact)}</td>
 </tr>`).join('')}</tbody></table>`;
 }

 // Full table
 if(!rows.length) {
 wrap.innerHTML = '<p style="color:#101010; padding:20px; text-align:center;">Tiada entries — bagus.</p>';
 return;
 }
 wrap.innerHTML = `<table class="rp-comm-table">
 <thead><tr><th>Tarikh</th><th>SKU</th><th>Type</th><th>Reason</th><th style="text-align:right;">Qty</th><th>Channel</th><th>Reporter</th></tr></thead>
 <tbody>
 ${rows.slice(0, 100).map(r => {
 const typeColor = { return:'#cd7c32', damaged:'#B23A2E', missing:'#C68A1A', expired:'#a05f22', cancel:'#cd7c32' }[r.type] || '#6B7280';
 const typeLabel = { return:'Return', damaged:'Rosak', missing:'Hilang', expired:'Expired', cancel:'Batal/Refund' }[r.type] || r.type;
 return `<tr>
 <td style="font-size:11px; color:#6B7280;">${new Date(r.reported_at).toLocaleString('en-MY', { dateStyle:'short', timeStyle:'short' })}</td>
 <td><strong>${escAttr(r.sku)}</strong></td>
 <td><span style="display:inline-block; padding:2px 8px; border-radius:50px; background:${typeColor}20; color:${typeColor}; font-size:10px; font-weight:700;">${typeLabel}</span></td>
 <td style="font-size:12px;">${escAttr((r.reason || '').slice(0, 30))}</td>
 <td style="text-align:right; font-weight:700;">${r.qty}</td>
 <td style="font-size:11px;">${escAttr(r.channel || '—')}</td>
 <td style="font-size:11px;">${escAttr(r.reported_by_name || '—')}</td>
 </tr>`;
 }).join('')}
 </tbody>
 </table>
 ${rows.length > 100 ? `<p style="font-size:11px; color:#9CA3AF; text-align:center; margin-top:10px;">Papar 100 pertama dari ${rows.length} rows.</p>` : ''}`;
 if(window.lucide && lucide.createIcons) lucide.createIcons();
 } catch(e) {
 wrap.innerHTML = '<p style="color:#B23A2E; padding:20px;">Error: ' + e.message + '</p>';
 }
};

window.__rlOpenSubmit = function() {
 document.getElementById('rlSku').value = '';
 document.getElementById('rlQty').value = '1';
 document.getElementById('rlSubmitType').value = 'return';
 document.getElementById('rlChannel').value = 'POS Cashier';
 document.getElementById('rlReasonSelect').value = '';
 document.getElementById('rlReason').value = '';
 document.getElementById('rlCost').value = '0';
 document.getElementById('rlNotes').value = '';
 document.getElementById('rlSubmitOverlay').style.display = 'flex';
};
window.__rlCloseSubmit = function() { document.getElementById('rlSubmitOverlay').style.display = 'none'; };

window.__rlSkuLookup = function() {
 const sku = (document.getElementById('rlSku').value || '').toUpperCase().trim();
 if(!sku || typeof masterProducts === 'undefined') return;
 const p = masterProducts.find(x => (x.sku || '').toUpperCase() === sku);
 if(p) {
 document.getElementById('rlCost').value = Number(p.cost_price || 0).toFixed(2);
 }
};

window.__rlSubmit = async function() {
 const sku = (document.getElementById('rlSku').value || '').toUpperCase().trim();
 if(!sku) { if(typeof showToast === 'function') showToast('SKU wajib.', 'warn'); return; }
 const u = window.currentUser || {};
 let prodName = '';
 let supplier = '';
 try {
 const p = (masterProducts || []).find(x => (x.sku || '').toUpperCase() === sku);
 if(p) { prodName = p.name || ''; supplier = p.supplier_name || p.supplier || ''; }
 } catch(e){}
 const payload = {
 sku,
 product_name: prodName,
 qty: parseInt(document.getElementById('rlQty').value || '1', 10),
 type: document.getElementById('rlSubmitType').value,
 reason: (document.getElementById('rlReason').value || document.getElementById('rlReasonSelect').value || 'other').trim(),
 notes: document.getElementById('rlNotes').value.trim() || null,
 channel: document.getElementById('rlChannel').value || null,
 supplier,
 cost_impact: parseFloat(document.getElementById('rlCost').value || '0') || 0,
 reported_by_id: u.staff_id || 'unknown',
 reported_by_name: u.name || 'Unknown'
 };
 try {
 const { error } = await db.from('returns_log').insert([payload]);
 if(error) throw error;
 if(typeof showToast === 'function') showToast(`Logged: ${sku} × ${payload.qty}`, 'success');
 window.__rlCloseSubmit();
 setTimeout(() => window.renderReturnsLog(), 200);
 } catch(e) {
 if(typeof showToast === 'function') showToast('Save failed: ' + e.message, 'error');
 }
};

// p1_504 — Sedut returns dari Shopee + TikTok (auto-pull, dedup ikut return id + sku)
window.__rlPullReturns = async function() {
 const since = (document.getElementById('rlPeriod') && document.getElementById('rlPeriod').value) || '30d';
 // map period → tarikh since (cap 15 hari untuk Shopee per window dikendali server)
 const days = since === '90d' ? 90 : (since === '180d' ? 180 : (since === 'ytd' ? 365 : 30));
 const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
 if(typeof showToast === 'function') showToast('Menyedut returns dari Shopee + TikTok…', 'info');
 try {
  const res = await fetch(`/api/returns-pull?mode=import&since=${sinceDate}`, { cache: 'no-store', headers: await window.__authHeaders() });
  const j = await res.json();
  if(j.error) { if(typeof showToast === 'function') showToast('Sedut gagal: ' + j.error, 'error'); return; }
  const ins = j.inserted || 0;
  const dup = (j.already_logged || 0) + (j.dupes_skipped || 0);
  // ringkasan per channel (kalau ada error/skip satu channel, beritahu)
  const chMsgs = [];
  const ch = j.channels || {};
  ['shopee', 'tiktok'].forEach(k => {
   const c = ch[k]; if(!c) return;
   if(c.error) chMsgs.push(`${k}: error (${String(c.error).slice(0, 40)})`);
   else if(c.skipped) chMsgs.push(`${k}: dilangkau`);
  });
  let msg = `Sedut siap — ${ins} baru, ${dup} dah sedia ada (skip).`;
  if(chMsgs.length) msg += ' ⚠ ' + chMsgs.join(' · ');
  if(typeof showToast === 'function') showToast(msg, ins ? 'success' : 'info');
  setTimeout(() => window.renderReturnsLog(), 300);
 } catch(e) {
  if(typeof showToast === 'function') showToast('Sedut gagal: ' + (e.message || e), 'error');
 }
};

// p1_120 — Supplier Performance dashboard
window.__spPeriod = '90d';
window.__spSetPeriod = function(p, btn) {
 window.__spPeriod = p;
 document.querySelectorAll('[data-sp-period]').forEach(b => {
 b.classList.toggle('sp-period-btn--active', b === btn);
 if(b === btn) b.classList.remove('secondary');
 else b.classList.add('secondary');
 });
 window.renderSupplierPerf();
};

window.renderSupplierPerf = async function() {
 const wrap = document.getElementById('spTableWrap');
 if(!wrap) return;
 wrap.innerHTML = '<p style="color:#9CA3AF; padding:20px; text-align:center;">Memuatkan…</p>';

 const now = new Date();
 const p = window.__spPeriod;
 let sinceDate = null;
 if(p === '90d') sinceDate = new Date(now.getTime() - 90 * 86400000);
 else if(p === '180d') sinceDate = new Date(now.getTime() - 180 * 86400000);
 else if(p === 'ytd') sinceDate = new Date(now.getFullYear(), 0, 1);

 try {
 if(typeof db === 'undefined' || !db) throw new Error('DB tak available');
 let q = db.from('purchase_orders').select('*').order('created_at', { ascending: false }).limit(500);
 if(sinceDate) q = q.gte('created_at', sinceDate.toISOString());
 const { data: pos, error } = await q;
 if(error) throw error;

 // Aggregate per supplier
 const supMap = {};
 (pos || []).forEach(po => {
 const sup = (po.supplier || po.supplier_name || 'Unknown').trim();
 if(!supMap[sup]) supMap[sup] = { supplier: sup, poCount: 0, totalCost: 0, leadDays: [], skuCount: new Set(), lastDelivery: null };
 supMap[sup].poCount++;
 supMap[sup].totalCost += Number(po.total_cost || po.total || 0);
 // Lead time: created_at → completed_at or received_at
 const created = po.created_at ? new Date(po.created_at).getTime() : null;
 const completed = po.received_at || po.completed_at || (po.status === 'Completed' ? po.updated_at : null);
 if(created && completed) {
 const days = (new Date(completed).getTime() - created) / 86400000;
 if(days > 0 && days < 365) supMap[sup].leadDays.push(days);
 }
 if(completed) {
 const c = new Date(completed);
 if(!supMap[sup].lastDelivery || c > supMap[sup].lastDelivery) supMap[sup].lastDelivery = c;
 }
 // Items
 try {
 const items = typeof po.items === 'string' ? JSON.parse(po.items) : (po.items || []);
 (Array.isArray(items) ? items : []).forEach(it => { if(it.sku) supMap[sup].skuCount.add(String(it.sku).toUpperCase()); });
 } catch(e){}
 });

 const rows = Object.values(supMap).map(s => ({
 supplier: s.supplier,
 poCount: s.poCount,
 totalCost: s.totalCost,
 avgLead: s.leadDays.length > 0 ? s.leadDays.reduce((a,b) => a+b, 0) / s.leadDays.length : null,
 skuCount: s.skuCount.size,
 lastDelivery: s.lastDelivery
 })).sort((a, b) => b.totalCost - a.totalCost);

 // KPI
 const totalSuppliers = rows.length;
 const totalPO = rows.reduce((s, r) => s + r.poCount, 0);
 const totalSpend = rows.reduce((s, r) => s + r.totalCost, 0);
 const leadValues = rows.filter(r => r.avgLead != null).map(r => r.avgLead);
 const avgLead = leadValues.length > 0 ? leadValues.reduce((a,b) => a+b, 0) / leadValues.length : 0;

 document.getElementById('spTotalSuppliers').textContent = totalSuppliers;
 document.getElementById('spTotalPO').textContent = totalPO;
 document.getElementById('spTotalSpend').textContent = 'RM ' + Number(totalSpend).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
 document.getElementById('spAvgLead').textContent = avgLead.toFixed(1) + ' hari';

 if(!rows.length) {
 wrap.innerHTML = '<p style="color:#9CA3AF; padding:20px; text-align:center;">Tiada Purchase Order dalam period ni.</p>';
 return;
 }

 const escAttr = (s) => String(s == null ? '' : s).replace(/"/g,'&quot;').replace(/</g,'&lt;');
 const fmtRMC = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
 wrap.innerHTML = `<table class="rp-comm-table">
 <thead>
 <tr>
 <th>Rank</th>
 <th>Supplier</th>
 <th style="text-align:right;">PO Count</th>
 <th style="text-align:right;">Total Spend</th>
 <th style="text-align:right;">Avg Lead Time</th>
 <th style="text-align:right;">SKU Unik</th>
 <th style="text-align:right;">Last Delivery</th>
 </tr>
 </thead>
 <tbody>
 ${rows.map((r, i) => {
 const leadColor = r.avgLead == null ? '#9CA3AF' : (r.avgLead <= 7 ? '#101010' : (r.avgLead <= 21 ? '#C68A1A' : '#B23A2E'));
 const leadStr = r.avgLead == null ? '—' : r.avgLead.toFixed(1) + ' hari';
 const lastStr = r.lastDelivery ? r.lastDelivery.toLocaleDateString('en-MY') : '—';
 const daysSinceLast = r.lastDelivery ? Math.floor((Date.now() - r.lastDelivery.getTime()) / 86400000) : null;
 const lastColor = daysSinceLast == null ? '#9CA3AF' : (daysSinceLast > 90 ? '#B23A2E' : (daysSinceLast > 30 ? '#C68A1A' : '#101010'));
 return `<tr ${i < 3 ? 'style="background:rgba(252,211,77,.04);"' : ''}>
 <td>#${i+1}</td>
 <td><strong>${escAttr(r.supplier)}</strong></td>
 <td style="text-align:right;">${r.poCount}</td>
 <td style="text-align:right; font-weight:700;">${fmtRMC(r.totalCost)}</td>
 <td style="text-align:right; color:${leadColor}; font-weight:700;">${leadStr}</td>
 <td style="text-align:right;">${r.skuCount}</td>
 <td style="text-align:right; color:${lastColor};">${lastStr}${daysSinceLast != null ? ' <span style="font-size:10px; color:#9CA3AF;">(' + daysSinceLast + 'd ago)</span>' : ''}</td>
 </tr>`;
 }).join('')}
 </tbody>
 </table>`;
 if(window.lucide && lucide.createIcons) lucide.createIcons();
 } catch(e) {
 wrap.innerHTML = '<p style="color:#B23A2E; padding:20px;">Error: ' + e.message + '</p>';
 }
};

// p1_119 — Brand Performance dashboard
window.__bpPeriod = 'mtd';

window.__bpPeriodRange = function() {
 const now = new Date();
 const p = window.__bpPeriod;
 if(p === 'lastmonth') {
 const start = new Date(now.getFullYear(), now.getMonth()-1, 1);
 const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
 return { start, end };
 }
 if(p === '30d') return { start: new Date(now.getTime() - 30*86400000), end: now };
 if(p === '90d') return { start: new Date(now.getTime() - 90*86400000), end: now };
 if(p === 'ytd') return { start: new Date(now.getFullYear(), 0, 1), end: now };
 return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
};
window.__bpSetPeriod = function(p, btn) {
 window.__bpPeriod = p;
 document.querySelectorAll('[data-bp-period]').forEach(b => {
 b.classList.toggle('bp-period-btn--active', b === btn);
 if(b === btn) b.classList.remove('secondary');
 else b.classList.add('secondary');
 });
 window.renderBrandPerf();
};

window.renderBrandPerf = function() {
 const range = window.__bpPeriodRange();
 const startMs = range.start.getTime();
 const endMs = range.end.getTime();
 // Previous comparison range (same span before)
 const span = endMs - startMs;
 const prevStart = startMs - span;
 const prevEnd = startMs;

 // Build SKU→brand map from masterProducts
 const skuBrand = {};
 try {
 if(typeof masterProducts !== 'undefined' && Array.isArray(masterProducts)) {
 masterProducts.forEach(p => {
 const sku = (p.sku || '').toUpperCase();
 if(sku) skuBrand[sku] = p.brand || 'Unknown';
 });
 }
 } catch(e){}

 // Aggregate current + previous period
 const aggregate = (sMs, eMs) => {
 const map = {};
 if(typeof salesHistory === 'undefined' || !Array.isArray(salesHistory)) return map;
 salesHistory.forEach(sale => {
 if(!window.__isRealSale(sale)) return; // p1_452 — buang test/void/cancel/refund
 const t = new Date(sale.timestamp || sale.created_at || 0).getTime();
 if(t < sMs || t > eMs) return;
 const items = (() => { try { return JSON.parse(sale.items || '[]'); } catch(e) { return sale.items || []; } })();
 (Array.isArray(items) ? items : []).forEach(it => {
 const sku = (it.sku || '').toUpperCase();
 const brand = skuBrand[sku] || it.brand || 'Unknown';
 const revenue = (Number(it.qty != null ? it.qty : it.quantity) || 0) * Number(it.price || 0);
 const qty = (Number(it.qty != null ? it.qty : it.quantity) || 0);
 if(!map[brand]) map[brand] = { brand, revenue: 0, units: 0, skus: new Set() };
 map[brand].revenue += revenue;
 map[brand].units += qty;
 if(sku) map[brand].skus.add(sku);
 });
 });
 return map;
 };

 const current = aggregate(startMs, endMs);
 const previous = aggregate(prevStart, prevEnd);

 const totalRevenue = Object.values(current).reduce((s, b) => s + b.revenue, 0);
 const totalUnits = Object.values(current).reduce((s, b) => s + b.units, 0);
 const rows = Object.values(current).map(b => {
 const pr = previous[b.brand] ? previous[b.brand].revenue : 0;
 const trendPct = pr > 0 ? ((b.revenue - pr) / pr) * 100 : (b.revenue > 0 ? 100 : 0);
 return {
 brand: b.brand,
 revenue: b.revenue,
 units: b.units,
 skuCount: b.skus.size,
 share: totalRevenue > 0 ? (b.revenue / totalRevenue) * 100 : 0,
 prevRevenue: pr,
 trendPct
 };
 }).sort((a, b) => b.revenue - a.revenue);

 // KPI
 document.getElementById('bpTotalBrands').textContent = rows.length;
 document.getElementById('bpTotalRevenue').textContent = 'RM ' + Number(totalRevenue).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
 document.getElementById('bpTotalUnits').textContent = totalUnits;
 document.getElementById('bpTopBrand').textContent = rows[0] ? rows[0].brand : '—';

 const wrap = document.getElementById('bpTableWrap');
 const fmtRMC = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
 if(!rows.length) {
 wrap.innerHTML = '<p style="color:#9CA3AF; padding:20px; text-align:center;">Tiada sales dalam period ni.</p>';
 return;
 }
 wrap.innerHTML = `<table class="rp-comm-table">
 <thead>
 <tr>
 <th>Rank</th>
 <th>Brand</th>
 <th style="text-align:right;">Revenue</th>
 <th style="text-align:right;">Share %</th>
 <th style="text-align:right;">Units</th>
 <th style="text-align:right;">SKU Aktif</th>
 <th style="text-align:right;">vs Period Lepas</th>
 </tr>
 </thead>
 <tbody>
 ${rows.map((r, i) => {
 const trendColor = r.trendPct > 0 ? '#101010' : (r.trendPct < 0 ? '#B23A2E' : '#6B7280');
 const trendIcon = r.trendPct > 0 ? '↑' : (r.trendPct < 0 ? '↓' : '→');
 const trendStr = r.prevRevenue > 0 ? `${trendIcon} ${Math.abs(r.trendPct).toFixed(1)}%` : 'NEW';
 const rankColor = i === 0 ? '#E7C66A' : (i === 1 ? '#9CA3AF' : (i === 2 ? '#FB923C' : '#E5E7EB'));
 return `<tr ${i < 3 ? 'style="background:rgba(252,211,77,.04);"' : ''}>
 <td><span style="display:inline-block; width:24px; height:24px; line-height:24px; text-align:center; border-radius:50%; background:${rankColor}; color:#000; font-size:11px; font-weight:800;">${i+1}</span></td>
 <td><strong style="font-size:13.5px;">${r.brand}</strong></td>
 <td style="text-align:right; font-weight:700;">${fmtRMC(r.revenue)}</td>
 <td style="text-align:right;">
 <div style="display:inline-flex; align-items:center; gap:6px;">
 <span>${r.share.toFixed(1)}%</span>
 <div style="width:50px; height:6px; background:#E5E7EB; border-radius:50px; overflow:hidden;">
 <div style="height:100%; width:${Math.min(100, r.share)}%; background:var(--primary);"></div>
 </div>
 </div>
 </td>
 <td style="text-align:right;">${r.units}</td>
 <td style="text-align:right;">${r.skuCount}</td>
 <td style="text-align:right; color:${trendColor}; font-weight:700;">${trendStr}</td>
 </tr>`;
 }).join('')}
 </tbody>
 </table>`;

 if(window.lucide && lucide.createIcons) lucide.createIcons();
};

// p1_116 — Channel Profitability dashboard
window.__cpPeriod = 'mtd';
window.__cpDefaultFees = {
 'Shopee':         { fee: 8.0, processing: 2.5, label: 'Shopee', color: '#EE4D2D' },
 'TikTok Shop':    { fee: 5.0, processing: 2.0, label: 'TikTok Shop', color: '#000000' },
 'POS Cashier':  { fee: 0.0, processing: 0.5, label: 'POS Cashier', color: '#101010' },
 'Web EasyStore':  { fee: 0.0, processing: 2.5, label: 'Web EasyStore', color: '#cd7c32' },
 'WhatsApp':       { fee: 0.0, processing: 0.5, label: 'WhatsApp', color: '#5C8A56' }
};

window.__cpGetFees = function() {
 try {
 const stored = JSON.parse(localStorage.getItem('cpFees_v1') || 'null');
 if(stored) return Object.assign({}, window.__cpDefaultFees, stored);
 } catch(e){}
 return Object.assign({}, window.__cpDefaultFees);
};
window.__cpSaveFees = function(fees) {
 try { localStorage.setItem('cpFees_v1', JSON.stringify(fees)); } catch(e){}
};

window.__cpPeriodRange = function() {
 const now = new Date();
 const p = window.__cpPeriod;
 if(p === 'lastmonth') {
 const start = new Date(now.getFullYear(), now.getMonth()-1, 1);
 const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
 return { start, end };
 }
 if(p === '30d') return { start: new Date(now.getTime() - 30*86400000), end: now };
 if(p === '90d') return { start: new Date(now.getTime() - 90*86400000), end: now };
 if(p === 'ytd') return { start: new Date(now.getFullYear(), 0, 1), end: now };
 return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
};

window.__cpSetPeriod = function(p, btn) {
 window.__cpPeriod = p;
 document.querySelectorAll('[data-cp-period]').forEach(b => b.classList.toggle('cp-period-btn--active', b.dataset.cpPeriod === p));
 document.querySelectorAll('[data-cp-period]').forEach(b => {
 if(b === btn) b.classList.remove('secondary');
 else b.classList.add('secondary');
 });
 window.renderChannelProfit();
};

window.renderChannelProfit = function() {
 const fees = window.__cpGetFees();
 const range = window.__cpPeriodRange();
 const startMs = range.start.getTime();
 const endMs = range.end.getTime();

 // Build fee editor
 const feeEditor = document.getElementById('cpFeeEditor');
 if(feeEditor) {
 feeEditor.innerHTML = Object.entries(fees).map(([channel, cfg]) => `
 <div style="background:#F9FAFB; padding:12px; border-radius:8px; border:1px solid #E5E7EB;">
 <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
 <span style="width:10px; height:10px; border-radius:50%; background:${cfg.color};"></span>
 <strong style="font-size:12px;">${channel}</strong>
 </div>
 <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
 <div>
 <label style="font-size:10px; color:#6B7280; display:block;">Fee %</label>
 <input type="number" data-cp-fee="${channel}" class="rp-comm-input" style="width:100%; text-align:left; font-size:12px; padding:4px 6px;" step="0.1" min="0" max="30" value="${cfg.fee}" onchange="window.__cpUpdateFee('${channel}', 'fee', this.value)">
 </div>
 <div>
 <label style="font-size:10px; color:#6B7280; display:block;">Process %</label>
 <input type="number" data-cp-process="${channel}" class="rp-comm-input" style="width:100%; text-align:left; font-size:12px; padding:4px 6px;" step="0.1" min="0" max="10" value="${cfg.processing}" onchange="window.__cpUpdateFee('${channel}', 'processing', this.value)">
 </div>
 </div>
 </div>`).join('');
 }

 // Aggregate per channel
 const channelStats = {};
 const costMap = {};
 try {
 if(typeof masterProducts !== 'undefined' && Array.isArray(masterProducts)) {
 masterProducts.forEach(p => {
 const sku = (p.sku || '').toUpperCase();
 if(sku) costMap[sku] = Number(p.cost_price || 0);
 });
 }
 } catch(e){}

 if(typeof salesHistory !== 'undefined' && Array.isArray(salesHistory)) {
 salesHistory.forEach(sale => {
 if(!window.__isRealSale(sale)) return; // p1_452 — buang test/void/cancel/refund
 const t = new Date(sale.timestamp || sale.created_at || 0).getTime();
 if(t < startMs || t > endMs) return;
 const ch = sale.channel || 'POS Cashier';
 if(!channelStats[ch]) channelStats[ch] = { revenue: 0, orders: 0, cogs: 0 };
 const total = Number(sale.total || sale.amount || 0);
 channelStats[ch].revenue += total;
 channelStats[ch].orders++;
 // COGS from items
 const items = (() => { try { return JSON.parse(sale.items || '[]'); } catch(e) { return sale.items || []; } })();
 (Array.isArray(items) ? items : []).forEach(it => {
 const sku = (it.sku || '').toUpperCase();
 const cost = it.cost != null ? Number(it.cost) : (costMap[sku] || 0);
 channelStats[ch].cogs += cost * (Number(it.qty != null ? it.qty : it.quantity) || 0);
 });
 });
 }

 // Compute net per channel
 const fmtRM = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
 const fmtRMC = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
 const rows = [];
 Object.entries(channelStats).forEach(([ch, st]) => {
 const f = fees[ch] || { fee: 0, processing: 0 };
 const platformFees = st.revenue * (f.fee / 100);
 const processingFees = st.revenue * (f.processing / 100);
 const totalFees = platformFees + processingFees;
 const grossProfit = st.revenue - st.cogs;
 const netProfit = grossProfit - totalFees;
 const netMarginPct = st.revenue > 0 ? (netProfit / st.revenue) * 100 : 0;
 rows.push({
 channel: ch,
 ...st,
 platformFees, processingFees, totalFees,
 grossProfit, netProfit, netMarginPct,
 color: (fees[ch] && fees[ch].color) || '#6B7280'
 });
 });
 rows.sort((a, b) => b.netProfit - a.netProfit);

 // Per-channel cards
 const grid = document.getElementById('cpChannelGrid');
 if(grid) {
 if(!rows.length) {
 grid.innerHTML = '<div class="rp-section"><div class="rp-empty">Tiada sales dalam period ni.</div></div>';
 } else {
 grid.innerHTML = '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px; margin-bottom:14px;">' +
 rows.map(r => {
 const marginColor = r.netMarginPct >= 30 ? '#101010' : (r.netMarginPct >= 15 ? '#C68A1A' : '#B23A2E');
 return `<div class="rp-section" style="margin-bottom:0; border-top:4px solid ${r.color};">
 <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
 <span style="width:10px; height:10px; border-radius:50%; background:${r.color};"></span>
 <h3 style="margin:0; font-size:15px; font-weight:800;">${r.channel}</h3>
 </div>
 <div style="font-size:11px; color:#6B7280; margin-bottom:4px;">Revenue (${r.orders} orders)</div>
 <div style="font-size:24px; font-weight:800; color:#111;">${fmtRMC(r.revenue)}</div>
 <div style="margin-top:10px; padding-top:10px; border-top:1px solid #F3F4F6;">
 <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#6B7280; padding:3px 0;"><span>COGS</span><span>−${fmtRMC(r.cogs)}</span></div>
 <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#6B7280; padding:3px 0;"><span>Platform fee</span><span>−${fmtRMC(r.platformFees)}</span></div>
 <div style="display:flex; justify-content:space-between; font-size:11.5px; color:#6B7280; padding:3px 0;"><span>Processing</span><span>−${fmtRMC(r.processingFees)}</span></div>
 </div>
 <div style="margin-top:10px; padding-top:10px; border-top:2px solid ${marginColor};">
 <div style="font-size:11px; color:#6B7280;">Net Profit · ${r.netMarginPct.toFixed(1)}% margin</div>
 <div style="font-size:22px; font-weight:800; color:${marginColor};">${fmtRM(r.netProfit)}</div>
 </div>
 </div>`;
 }).join('') + '</div>';
 }
 }

 // Comparison table
 const cmpTable = document.getElementById('cpCompareTable');
 if(cmpTable) {
 if(!rows.length) cmpTable.innerHTML = '';
 else cmpTable.innerHTML = `<table class="rp-comm-table">
 <thead>
 <tr>
 <th>Channel</th>
 <th style="text-align:right;">Orders</th>
 <th style="text-align:right;">Revenue</th>
 <th style="text-align:right;">COGS</th>
 <th style="text-align:right;">Total Fees</th>
 <th style="text-align:right;">Net Profit</th>
 <th style="text-align:right;">Margin %</th>
 </tr>
 </thead>
 <tbody>
 ${rows.map((r, i) => {
 const marginColor = r.netMarginPct >= 30 ? '#101010' : (r.netMarginPct >= 15 ? '#C68A1A' : '#B23A2E');
 return `<tr ${i === 0 ? 'style="background:rgba(16, 16, 16,.06);"' : ''}>
 <td><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${r.color}; margin-right:6px;"></span><strong>${r.channel}</strong></td>
 <td style="text-align:right;">${r.orders}</td>
 <td style="text-align:right;">${fmtRMC(r.revenue)}</td>
 <td style="text-align:right; color:#6B7280;">${fmtRMC(r.cogs)}</td>
 <td style="text-align:right; color:#6B7280;">${fmtRMC(r.totalFees)}</td>
 <td style="text-align:right; font-weight:700; color:${marginColor};">${fmtRMC(r.netProfit)}</td>
 <td style="text-align:right; font-weight:700; color:${marginColor};">${r.netMarginPct.toFixed(1)}%</td>
 </tr>`;
 }).join('')}
 </tbody>
 </table>`;
 }

 if(window.lucide && lucide.createIcons) lucide.createIcons();
};

window.__cpUpdateFee = function(channel, field, value) {
 const fees = window.__cpGetFees();
 if(!fees[channel]) return;
 fees[channel][field] = parseFloat(value) || 0;
 window.__cpSaveFees(fees);
 window.renderChannelProfit();
};

// p1_115 — Stock Reorder Auto-Suggest
window.__rsAllRows = [];

window.renderReorderSuggest = function() {
 const wrap = document.getElementById('rsTableWrap');
 if(!wrap) return;
 wrap.innerHTML = '<p style="color:#9CA3AF; padding:20px; text-align:center;">Computing suggestions…</p>';

 try {
 const windowDays = parseInt(document.getElementById('rsWindow').value || '30', 10);
 const leadTime = parseFloat(document.getElementById('rsLeadTime').value || '14');
 const safety = parseFloat(document.getElementById('rsSafety').value || '1.5');
 const minVel = parseFloat(document.getElementById('rsMinVel').value || '1');
 const cutoffMs = Date.now() - windowDays * 86400000;

 // Tally units sold per SKU in window
 const skuSold = {};
 if(typeof salesHistory !== 'undefined' && Array.isArray(salesHistory)) {
 salesHistory.forEach(sale => {
 const t = new Date(sale.timestamp || sale.created_at || 0).getTime();
 if(t < cutoffMs) return;
 const items = (() => { try { return JSON.parse(sale.items || '[]'); } catch(e) { return sale.items || []; } })();
 (Array.isArray(items) ? items : []).forEach(it => {
 const sku = (it.sku || '').toUpperCase();
 if(!sku) return;
 skuSold[sku] = (skuSold[sku] || 0) + (Number(it.qty != null ? it.qty : it.quantity) || 0);
 });
 });
 }

 // Build current stock map from inventory_batches sum (fallback to masterProducts.stock)
 const currentStock = {};
 if(typeof inventoryBatches !== 'undefined' && Array.isArray(inventoryBatches)) {
 inventoryBatches.forEach(b => {
 const sku = (b.sku || '').toUpperCase();
 if(!sku) return;
 currentStock[sku] = (currentStock[sku] || 0) + Number(b.qty_remaining || b.current_qty || 0);
 });
 }
 if(typeof masterProducts !== 'undefined' && Array.isArray(masterProducts)) {
 masterProducts.forEach(p => {
 const sku = (p.sku || '').toUpperCase();
 if(!sku) return;
 if(!(sku in currentStock)) currentStock[sku] = Number(p.stock || p.qty_on_hand || 0);
 });
 }

 // Compute suggestions
 const rows = [];
 (masterProducts || []).forEach(p => {
 const sku = (p.sku || '').toUpperCase();
 if(!sku) return;
 const sold = skuSold[sku] || 0;
 const dailyAvg = sold / windowDays;
 if(dailyAvg < minVel / 30) return; // skip very-low velocity
 const cur = currentStock[sku] || 0;
 const targetStock = dailyAvg * leadTime * safety;
 const suggestedQty = Math.max(0, Math.ceil(targetStock - cur));
 if(suggestedQty <= 0) return; // already enough stock
 const daysTillStockout = dailyAvg > 0 ? Math.floor(cur / dailyAvg) : 999;
 const cost = Number(p.cost_price || 0);
 const estCost = suggestedQty * cost;
 rows.push({
 sku, name: p.name || '', brand: p.brand || '', category: p.category || '',
 location_bin: p.location_bin || '',
 currentStock: cur,
 sold, dailyAvg,
 daysTillStockout,
 suggestedQty,
 cost,
 estCost,
 isOutOfStock: cur <= 0,
 isUrgent: daysTillStockout < 7
 });
 });

 window.__rsAllRows = rows;
 window.__rsApplyFilter();
 } catch(e) {
 wrap.innerHTML = '<p style="color:#B23A2E; padding:20px;">Error: ' + e.message + '</p>';
 }
};

window.__rsApplyFilter = function() {
 const wrap = document.getElementById('rsTableWrap');
 if(!wrap) return;
 const search = (document.getElementById('rsSearchInput').value || '').toUpperCase().trim();
 const sortBy = document.getElementById('rsSortBy').value || 'urgency';
 let rows = window.__rsAllRows.slice();
 if(search) rows = rows.filter(r => r.sku.includes(search) || r.brand.toUpperCase().includes(search) || r.name.toUpperCase().includes(search));
 // Sort
 if(sortBy === 'urgency') rows.sort((a, b) => a.daysTillStockout - b.daysTillStockout);
 else if(sortBy === 'qty') rows.sort((a, b) => b.suggestedQty - a.suggestedQty);
 else if(sortBy === 'velocity') rows.sort((a, b) => b.dailyAvg - a.dailyAvg);
 else if(sortBy === 'cost') rows.sort((a, b) => b.estCost - a.estCost);

 // KPI
 const urgentCount = rows.filter(r => r.isUrgent).length;
 const oosCount = rows.filter(r => r.isOutOfStock).length;
 const totalCost = rows.reduce((s, r) => s + r.estCost, 0);
 document.getElementById('rsTotalSku').textContent = rows.length;
 document.getElementById('rsUrgent').textContent = urgentCount;
 document.getElementById('rsOutOfStock').textContent = oosCount;
 document.getElementById('rsEstCost').textContent = 'RM ' + totalCost.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

 // Sidebar badge
 const badge = document.getElementById('reorderBadge');
 if(badge) {
 if(urgentCount > 0) { badge.style.display = ''; badge.textContent = urgentCount; }
 else badge.style.display = 'none';
 }

 if(!rows.length) {
 wrap.innerHTML = '<p style="color:#101010; padding:30px; text-align:center;">Tiada SKU perlu reorder pada settings ni — bagus.</p>';
 return;
 }
 const escAttr = (s) => String(s == null ? '' : s).replace(/"/g,'&quot;').replace(/</g,'&lt;');
 const fmtRM = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
 wrap.innerHTML = `<table class="rp-comm-table">
 <thead>
 <tr>
 <th>SKU</th>
 <th>Brand / Nama</th>
 <th>Lokasi</th>
 <th style="text-align:right;">Stok</th>
 <th style="text-align:right;">Sold (${parseInt(document.getElementById('rsWindow').value || '30', 10)}d)</th>
 <th style="text-align:right;">Avg/Hari</th>
 <th style="text-align:right;">Risk</th>
 <th style="text-align:right;">Reorder Qty</th>
 <th style="text-align:right;">Anggaran Cost</th>
 </tr>
 </thead>
 <tbody>
 ${rows.slice(0, 100).map(r => {
 const riskColor = r.isOutOfStock ? '#7C2A20' : (r.isUrgent ? '#B23A2E' : (r.daysTillStockout < 14 ? '#C68A1A' : '#101010'));
 const riskLabel = r.isOutOfStock ? 'OUT' : (r.daysTillStockout >= 999 ? '—' : r.daysTillStockout + 'd');
 const rowBg = r.isOutOfStock ? 'background:#F4E4DF;' : (r.isUrgent ? 'background:#FAF0EE;' : '');
 const locPill = r.location_bin ? `<span style="background:#F8EFD7; color:#7A5410; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:700; font-family:'SF Mono',Menlo,monospace; letter-spacing:0.3px;">${escAttr(r.location_bin)}</span>` : '<span style="color:#D1D5DB; font-size:11px;">—</span>';
 return `<tr style="${rowBg}">
 <td><strong>${escAttr(r.sku)}</strong></td>
 <td style="font-size:12px;"><strong>${escAttr(r.brand)}</strong><br><span style="color:#6B7280;">${escAttr(r.name).slice(0, 60)}</span></td>
 <td>${locPill}</td>
 <td style="text-align:right; color:${r.isOutOfStock ? '#7C2A20' : '#374151'}; font-weight:${r.isOutOfStock ? 700 : 400};">${r.currentStock}</td>
 <td style="text-align:right;">${r.sold}</td>
 <td style="text-align:right;">${r.dailyAvg.toFixed(2)}</td>
 <td style="text-align:right; color:${riskColor}; font-weight:700;">${riskLabel}</td>
 <td style="text-align:right; font-weight:700; color:#1F2937;">${r.suggestedQty}</td>
 <td style="text-align:right;">${fmtRM(r.estCost)}</td>
 </tr>`;
 }).join('')}
 </tbody>
 </table>
 ${rows.length > 100 ? `<p style="font-size:11px; color:#9CA3AF; text-align:center; margin-top:10px;">Papar 100 pertama dari ${rows.length} rows. Narrow filter untuk lihat selebihnya.</p>` : ''}`;
};

// ============= p1_478 — INVENTORY HISTORY (log masuk/keluar stok) =============
// INPUT = inventory_batches (qty_received). OUTPUT = sales_history jualan sebenar
// (setiap item = stok keluar). Format ikut sheet 10 CAMP "Input / Output":
// Ref · Product · Input/Output · Units · Cost/Price · Total · Date. Bina dari global
// dalam-memori (inventoryBatches + salesHistory + masterProducts).
window.__ihState = window.__ihState || { dir:'all', q:'', period:'all', from:'', to:'', page:1, perPage:100 };
window.__ihRows = window.__ihRows || [];
window.__ihTxns = window.__ihTxns || [];   // p1_479 — pergerakan manual (ambilan/display/rosak/restock)
window.__ihMoveDir = window.__ihMoveDir || 'OUT';
window.__IH_REASONS = {
 OUT: ['Jadi Display (CUD)','Rental Company (CUR)','Ganti Display (SCUD)','Return & Refund (R&R)','Rosak / Damaged','Ambilan Staf','Hilang','Sampel / Hadiah','Guna Dalaman','Transfer Cawangan','Pembetulan Kira (kurang)','Lain-lain'],
 IN: ['Restock Manual','Pulangan Pelanggan','Rental Pulang (CUR balik)','Jumpa Semula','Pembetulan Kira (tambah)','Lain-lain']
};

window.__ihBuildRows = function() {
 const rows = [];
 const nameOf = (sku, fallback) => {
  const p = (typeof masterProducts !== 'undefined' ? masterProducts : []).find(x => x.sku === sku);
  return (p && p.name) || fallback || '';
 };
 // INPUT — setiap batch = stok masuk
 (typeof inventoryBatches !== 'undefined' ? inventoryBatches : []).forEach(b => {
  if(!b || !b.sku) return;
  const units = Number(b.qty_received != null ? b.qty_received : b.qty_remaining) || 0;
  if(units <= 0) return;
  const cost = Number(b.cost_price) || 0;
  rows.push({ sku: b.sku, product: nameOf(b.sku, ''), dir: 'INPUT', units, price: cost, total: units * cost, date: b.inbound_date || b.created_at || null, note: b.notes || 'Stok masuk' });
 });
 // OUTPUT — setiap item dalam jualan sebenar = stok keluar
 (typeof salesHistory !== 'undefined' ? salesHistory : []).forEach(s => {
  if(!window.__isRealSale(s)) return;
  let items = s.items;
  if(typeof items === 'string') { try { items = JSON.parse(items); } catch(e){ items = []; } }
  if(!Array.isArray(items)) return;
  items.forEach(it => {
   const sku = (it && (it.sku || it.SKU || '')).toString().trim();
   if(!sku) return;
   const units = window.__aoItemQty ? window.__aoItemQty(it) : (parseInt(it.qty != null ? it.qty : it.quantity) || 0);
   if(units <= 0) return;
   const price = Number(it.price) || 0;
   rows.push({ sku, product: it.name || nameOf(sku, ''), dir: 'OUTPUT', units, price, total: units * price, date: s.created_at || null, note: 'Jualan #' + s.id + (s.channel ? ' · ' + s.channel : '') + (s.customer_name ? ' · ' + s.customer_name : '') });
  });
 });
 // PERGERAKAN MANUAL (p1_479) — ambilan/display/rosak/restock dari inventory_transactions.
 // Exclude OUTBOUND_SALE (dah dikira via sales_history — elak double count).
 (window.__ihTxns || []).forEach(t => {
  if(!t || !t.sku) return;
  if((t.transaction_type || '').toUpperCase() === 'OUTBOUND_SALE') return;
  const qc = Number(t.qty_change) || 0;
  if(qc === 0) return;
  const dir = qc > 0 ? 'INPUT' : 'OUTPUT';
  const units = Math.abs(qc);
  const pc = (typeof masterProducts !== 'undefined' ? masterProducts : []).find(x => x.sku === t.sku);
  const cost = pc ? (Number(pc.cost_price) || 0) : 0;
  const noteTxt = (t.reason || t.transaction_type || 'Pergerakan') + (t.note ? ' — ' + t.note : '') + (t.staff_name ? ' · ' + t.staff_name : '');
  rows.push({ sku: t.sku, product: nameOf(t.sku, ''), dir, units, price: cost, total: units * cost, date: t.created_at || null, note: noteTxt });
 });
 // p1_479 — Nombor pergerakan: paling AWAL (lama) = #1, menaik ikut masa.
 // Nombor stabil ikut kronologi penuh (bukan ikut filter/page).
 rows.slice().sort((a, b) => (a.date ? new Date(a.date).getTime() : 0) - (b.date ? new Date(b.date).getTime() : 0))
   .forEach((r, i) => { r.seq = i + 1; });
 // Papar: terbaru dulu (seq tetap melekat pada setiap baris)
 rows.sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
 return rows;
};

// p1_694 — Baki Unit (running balance) per SKU. Anchor pada stok HIDUP semasa (qty_remaining),
// jalan MUNDUR ikut seq: balAfter(terbaru)=stok semasa; balAfter(k)=balAfter(k+1)−signed(k+1).
// Kaedah backward ni kebal — tak perlu sejarah lengkap dari sifar; sentiasa padan stok sebenar.
window.__ihComputeBalances = function() {
 const rows = window.__ihRows || [];
 const stockBySku = {};
 (typeof inventoryBatches !== 'undefined' ? inventoryBatches : []).forEach(b => {
  if(!b || !b.sku) return;
  stockBySku[b.sku] = (stockBySku[b.sku] || 0) + (Number(b.qty_remaining) || 0);
 });
 const bySku = {};
 rows.forEach(r => { (bySku[r.sku] = bySku[r.sku] || []).push(r); });
 Object.keys(bySku).forEach(sku => {
  const list = bySku[sku].slice().sort((a, b) => (a.seq || 0) - (b.seq || 0)); // kronologi (lama→baru)
  let bal = stockBySku[sku] || 0; // baki selepas pergerakan terbaru = stok hidup sekarang
  for(let i = list.length - 1; i >= 0; i--) {
   list[i].balAfter = bal;
   const signed = list[i].dir === 'INPUT' ? list[i].units : -list[i].units;
   bal = bal - signed; // baki sebelum pergerakan ni = baki selepas pergerakan sebelumnya
  }
 });
};

window.__ihDateRange = function() {
 const st = window.__ihState;
 if(st.period === 'all') return { from: -Infinity, to: Infinity };
 if(st.period === 'today') { const d = new Date(); d.setHours(0,0,0,0); return { from: d.getTime(), to: Infinity }; }
 if(st.period === 'custom') {
  const f = st.from ? new Date(st.from + 'T00:00:00').getTime() : -Infinity;
  const t = st.to ? new Date(st.to + 'T23:59:59.999').getTime() : Infinity;
  return { from: f, to: t };
 }
 const days = parseInt(st.period) || 0;
 return { from: Date.now() - days * 86400000, to: Infinity };
};

// p1_696 — kalau query padan TEPAT satu SKU sebenar, pulangkan SKU itu (mod exact).
// Tujuan: produk group variant kongsi NAMA sama (cth "BD005-035 ... | BD035") — cari "BD035"
// jangan tarik SKU adik-beradik (BD005) via padanan nama. Cari nama biasa (cth "picnic") kekal substring.
window.__ihExactSku = function(q) {
 q = (q || '').toLowerCase().trim();
 if(!q) return null;
 if((window.__ihRows || []).some(r => (r.sku || '').toLowerCase() === q)) return q;
 const mp = (typeof masterProducts !== 'undefined') ? masterProducts : [];
 if(mp.some(p => (p.sku || '').toLowerCase() === q)) return q;
 return null;
};

window.__ihFiltered = function() {
 const st = window.__ihState;
 const dr = window.__ihDateRange();
 const q = (st.q || '').toLowerCase().trim();
 const exact = window.__ihExactSku(q);
 return window.__ihRows.filter(r => {
  if(st.dir !== 'all' && r.dir !== st.dir) return false;
  if(q) {
   if(exact) { if((r.sku || '').toLowerCase() !== exact) return false; }
   else if(!((r.sku||'').toLowerCase().includes(q) || (r.product||'').toLowerCase().includes(q))) return false;
  }
  if(dr.from !== -Infinity || dr.to !== Infinity) {
   const t = r.date ? new Date(r.date).getTime() : 0;
   if(t < dr.from || t > dr.to) return false;
  }
  return true;
 });
};

window.renderInventoryHistory = async function() {
 // Refresh inventory_batches penuh (boleh > 1000 bila bisnes membesar — boot guna .limit capped 1000)
 try { if(typeof window.__fetchAllRows === 'function') { const b = await window.__fetchAllRows('inventory_batches','inbound_date',false); if(Array.isArray(b) && b.length) inventoryBatches = b; } } catch(e){}
 // Pergerakan manual (p1_479)
 try { if(typeof window.__fetchAllRows === 'function') { window.__ihTxns = await window.__fetchAllRows('inventory_transactions','created_at',false) || []; } } catch(e){ window.__ihTxns = window.__ihTxns || []; }
 window.__ihRows = window.__ihBuildRows();
 window.__ihComputeBalances();
 window.__ihState.page = 1;
 window.__ihApply();
};

// ===== p1_479 — Rekod Pergerakan Stok manual (auto-tolak/tambah stok sebenar) =====
window.__ihMoveSetDir = function(dir) {
 window.__ihMoveDir = dir;
 const sel = document.getElementById('ihMoveReason');
 if(sel) sel.innerHTML = (window.__IH_REASONS[dir] || []).map(r => `<option value="${r.replace(/"/g,'&quot;')}">${r}</option>`).join('');
 const base = 'flex:1; padding:9px; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer;';
 const active = base + ' background:var(--primary); color:#fff; border:1px solid var(--primary);';
 const idle = base + ' background:#fff; color:#374151; border:1px solid #E5E7EB;';
 const outBtn = document.getElementById('ihMoveDirOut'), inBtn = document.getElementById('ihMoveDirIn');
 if(outBtn) outBtn.style.cssText = (dir === 'OUT') ? active : idle;
 if(inBtn) inBtn.style.cssText = (dir === 'IN') ? active : idle;
 if(window.lucide && lucide.createIcons) try { lucide.createIcons(); } catch(e){}
};

window.__ihMoveLookup = function() {
 const sku = ((document.getElementById('ihMoveSku') || {}).value || '').trim();
 const info = document.getElementById('ihMoveInfo');
 if(!info) return;
 if(!sku) { info.innerHTML = ''; return; }
 const p = (typeof masterProducts !== 'undefined' ? masterProducts : []).find(x => (x.sku || '').toLowerCase() === sku.toLowerCase());
 if(!p) { info.innerHTML = '<span style="color:#B23A2E;">SKU tak jumpa dalam master.</span>'; return; }
 const stock = window.__scsLiveQty ? window.__scsLiveQty(p.sku) : (typeof inventoryBatches !== 'undefined' ? inventoryBatches : []).filter(b => b.sku === p.sku).reduce((s, b) => s + (b.qty_remaining || 0), 0);
 const esc = (typeof hesc === 'function') ? hesc : (x) => String(x == null ? '' : x);
 info.innerHTML = '<strong>' + esc(p.name || '') + '</strong><br><span style="color:#6B7280;">Stok sistem sekarang: <strong>' + stock + '</strong> ' + esc(p.unit || 'pcs') + '</span>';
};

window.__ihMoveOpen = function() {
 const m = document.getElementById('ihMoveModal'); if(!m) return;
 const set = (id, v) => { const e = document.getElementById(id); if(e) e.value = v; };
 set('ihMoveSku', ''); set('ihMoveQty', '1'); set('ihMoveNote', '');
 const info = document.getElementById('ihMoveInfo'); if(info) info.innerHTML = '';
 window.__ihMoveSetDir('OUT');
 m.style.display = 'flex';
 if(window.lucide && lucide.createIcons) try { lucide.createIcons(); } catch(e){}
};

window.__ihRecordMovement = async function() {
 const skuInput = ((document.getElementById('ihMoveSku') || {}).value || '').trim();
 const p = (typeof masterProducts !== 'undefined' ? masterProducts : []).find(x => (x.sku || '').toLowerCase() === skuInput.toLowerCase());
 if(!p) { if(typeof showToast === 'function') showToast('SKU tak sah / tak jumpa dalam master.', 'warn'); return; }
 const sku = p.sku;
 const dir = window.__ihMoveDir || 'OUT';
 const qty = parseInt((document.getElementById('ihMoveQty') || {}).value, 10) || 0;
 if(qty <= 0) { if(typeof showToast === 'function') showToast('Kuantiti mesti lebih 0.', 'warn'); return; }
 const reason = (document.getElementById('ihMoveReason') || {}).value || 'Lain-lain';
 const note = ((document.getElementById('ihMoveNote') || {}).value || '').trim();
 const live = window.__scsLiveQty ? window.__scsLiveQty(sku) : 0;
 if(dir === 'OUT' && qty > live && !confirm('Stok sistem cuma ' + live + ' tapi nak keluarkan ' + qty + '.\nTeruskan? (stok akan jadi 0)')) return;
 const u = window.currentUser || {};
 const signed = dir === 'OUT' ? -qty : qty;
 const btn = document.getElementById('ihMoveSaveBtn');
 const orig = btn ? btn.innerHTML : '';
 if(btn) { btn.disabled = true; btn.innerHTML = 'Menyimpan…'; }
 try {
  // 1. Auto-adjust stok sebenar (FIFO untuk keluar, batch baru untuk masuk)
  if(typeof window.__applyStockDelta === 'function') {
   await window.__applyStockDelta(sku, signed, 'Pergerakan: ' + reason + (note ? ' — ' + note : '') + ' oleh ' + (u.name || 'System'));
  }
  // 2. Log ke ledger inventory_transactions
  try {
   await db.from('inventory_transactions').insert([{ sku, transaction_type: dir === 'OUT' ? 'ADJUST_OUT' : 'ADJUST_IN', qty_change: signed, reason, staff_name: u.name || 'System', note: note || null, created_at: new Date().toISOString() }]);
  } catch(e) { console.warn('ledger insert gagal:', e.message); }
  // 3. Reload stok + render semula
  try { const { data } = await db.from('inventory_batches').select('*').limit(100000); if(data) inventoryBatches = data; } catch(e){}
  if(typeof showToast === 'function') showToast((dir === 'OUT' ? 'Keluar' : 'Masuk') + ' ' + qty + ' unit ' + sku + ' direkod (' + reason + ').', 'success');
  const m = document.getElementById('ihMoveModal'); if(m) m.style.display = 'none';
  if(typeof window.renderInventoryHistory === 'function') window.renderInventoryHistory();
 } catch(e) { if(typeof showToast === 'function') showToast('Gagal rekod pergerakan: ' + e.message, 'error'); }
 if(btn) { btn.disabled = false; btn.innerHTML = orig; if(window.lucide && lucide.createIcons) try { lucide.createIcons(); } catch(e){} }
};

window.__ihSetDir = function(dir, btn) {
 window.__ihState.dir = dir;
 window.__ihState.page = 1;
 document.querySelectorAll('[data-ih-dir]').forEach(b => b.classList.toggle('rm-pill--active', b === btn));
 window.__ihApply();
};

window.__ihPeriodChange = function() {
 const sel = document.getElementById('ihPeriod');
 window.__ihState.period = sel ? sel.value : 'all';
 const cr = document.getElementById('ihCustomRange');
 if(cr) cr.style.display = (window.__ihState.period === 'custom') ? 'grid' : 'none';
 if(window.__ihState.period !== 'custom') { window.__ihState.page = 1; window.__ihApply(); }
};

window.__ihPage = function(n) { window.__ihState.page = n; window.__ihApply(); };

window.__ihApply = function() {
 const st = window.__ihState;
 st.q = (document.getElementById('ihSearch') || {}).value || '';
 if(st.period === 'custom') { st.from = (document.getElementById('ihFrom') || {}).value || ''; st.to = (document.getElementById('ihTo') || {}).value || ''; }
 const wrap = document.getElementById('ihTableWrap');
 const pager = document.getElementById('ihPager');
 if(!wrap) return;
 const all = window.__ihFiltered();
 let inUnits = 0, outUnits = 0;
 all.forEach(r => { if(r.dir === 'INPUT') inUnits += r.units; else outUnits += r.units; });
 const setK = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
 setK('ihKpiTotal', all.length.toLocaleString());
 setK('ihKpiIn', '+' + inUnits.toLocaleString());
 setK('ihKpiOut', '−' + outUnits.toLocaleString());
 const net = inUnits - outUnits;
 const netEl = document.getElementById('ihKpiNet');
 if(netEl) { netEl.textContent = (net >= 0 ? '+' : '') + net.toLocaleString(); netEl.style.color = net >= 0 ? '#345E43' : '#7C2A20'; }
 // p1_693 — Stok Semasa (live): jumlah qty_remaining sekarang. Ikut skop carian SKU (BUKAN period —
 // stok semasa tak bergantung tempoh). Tiada carian → jumlah semua produk.
 const batches = (typeof inventoryBatches !== 'undefined' && Array.isArray(inventoryBatches)) ? inventoryBatches : [];
 const sq = (st.q || '').toLowerCase().trim();
 const exactSku = window.__ihExactSku ? window.__ihExactSku(sq) : null;
 let curStock = 0, scopeHint = 'semua produk';
 if(exactSku) {
  // p1_696 — SKU tepat: stok SKU itu sahaja (jangan campur adik-beradik group)
  curStock = batches.reduce((s,b) => s + ((b.sku||'').toLowerCase() === exactSku ? (b.qty_remaining||0) : 0), 0);
  scopeHint = 'SKU ' + exactSku.toUpperCase();
 } else if(sq) {
  const mp = (typeof masterProducts !== 'undefined' && Array.isArray(masterProducts)) ? masterProducts : [];
  const matchSkus = new Set(mp.filter(p => (p.sku||'').toLowerCase().includes(sq) || (p.name||'').toLowerCase().includes(sq)).map(p => p.sku));
  const inScope = (b) => matchSkus.has(b.sku) || (b.sku||'').toLowerCase().includes(sq);
  curStock = batches.reduce((s,b) => s + (inScope(b) ? (b.qty_remaining||0) : 0), 0);
  const nSkus = new Set(batches.filter(inScope).map(b => b.sku)).size;
  scopeHint = nSkus <= 1 ? 'padan carian' : (nSkus + ' produk padan');
 } else {
  curStock = batches.reduce((s,b) => s + (b.qty_remaining||0), 0);
 }
 setK('ihKpiStock', curStock.toLocaleString());
 const stockHintEl = document.getElementById('ihKpiStockHint'); if(stockHintEl) stockHintEl.textContent = scopeHint;
 const perPage = st.perPage;
 const totalPages = Math.max(1, Math.ceil(all.length / perPage));
 if(st.page > totalPages) st.page = totalPages;
 const start = (st.page - 1) * perPage;
 const slice = all.slice(start, start + perPage);
 if(!slice.length) { wrap.innerHTML = '<p style="color:#9CA3AF; padding:24px; text-align:center;">Tiada rekod pergerakan padan filter.</p>'; if(pager) pager.innerHTML = ''; return; }
 const esc = (typeof hesc === 'function') ? hesc : (x) => String(x==null?'':x);
 const fmtRM = (n) => 'RM ' + (Number(n)||0).toFixed(2);
 const fmtDt = (d) => d ? new Date(d).toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '-';
 const rowsHtml = slice.map(r => {
  const dirBadge = r.dir === 'INPUT'
   ? '<span style="display:inline-flex; align-items:center; gap:4px; background:#E4EFE2; color:#345E43; padding:2px 8px; border-radius:20px; font-size:10.5px; font-weight:800;"><i data-lucide="arrow-down-to-line" style="width:11px;height:11px;"></i> INPUT</span>'
   : '<span style="display:inline-flex; align-items:center; gap:4px; background:#F4E4DF; color:#7C2A20; padding:2px 8px; border-radius:20px; font-size:10.5px; font-weight:800;"><i data-lucide="arrow-up-from-line" style="width:11px;height:11px;"></i> OUTPUT</span>';
  return `<tr style="border-bottom:1px solid #F3F4F6;">
   <td style="padding:7px 9px; text-align:center; font-weight:800; font-size:12px; color:#9CA3AF;">${r.seq || ''}</td>
   <td style="padding:7px 9px; font-family:'SF Mono',Menlo,monospace; font-weight:700; font-size:11.5px;">${esc(r.sku)}</td>
   <td style="padding:7px 9px; font-size:11.5px; max-width:260px;">${esc((r.product||'').slice(0,60))}</td>
   <td style="padding:7px 9px; text-align:center;">${dirBadge}</td>
   <td style="padding:7px 9px; text-align:right; font-weight:800; font-size:13px; color:${r.dir==='INPUT'?'#345E43':'#7C2A20'};">${r.dir==='INPUT'?'+':'−'}${r.units}</td>
   <td style="padding:7px 9px; text-align:right; font-weight:800; font-size:12.5px; color:#101010;">${r.balAfter != null ? r.balAfter.toLocaleString() : '-'}</td>
   <td style="padding:7px 9px; text-align:right; font-size:11.5px; color:#6B7280;">${r.price ? fmtRM(r.price) : '-'}</td>
   <td style="padding:7px 9px; text-align:right; font-size:11.5px; font-weight:700;">${r.total ? fmtRM(r.total) : '-'}</td>
   <td style="padding:7px 9px; font-size:11px; color:#6B7280; white-space:nowrap;">${esc(fmtDt(r.date))}</td>
   <td style="padding:7px 9px; font-size:10.5px; color:#9CA3AF; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(r.note)}">${esc(r.note)}</td>
  </tr>`;
 }).join('');
 wrap.innerHTML = `<div style="overflow-x:auto; border:1px solid #F0F0F0; border-radius:10px;">
  <table style="width:100%; border-collapse:collapse; font-size:12px;">
   <thead><tr style="background:#FAFAFA; font-size:10px; color:#6B7280; text-transform:uppercase; letter-spacing:0.4px;">
    <th style="text-align:center; padding:8px 9px;">No.</th><th style="text-align:left; padding:8px 9px;">Ref</th><th style="text-align:left; padding:8px 9px;">Product</th><th style="text-align:center; padding:8px 9px;">Input / Output</th><th style="text-align:right; padding:8px 9px;">Units</th><th style="text-align:right; padding:8px 9px;">Baki</th><th style="text-align:right; padding:8px 9px;">Cost/Price</th><th style="text-align:right; padding:8px 9px;">Total</th><th style="text-align:left; padding:8px 9px;">Date</th><th style="text-align:left; padding:8px 9px;">Nota</th>
   </tr></thead><tbody>${rowsHtml}</tbody>
  </table></div>`;
 if(pager) {
  const btn = (lbl, pg, disabled) => `<button onclick="window.__ihPage(${pg})" ${disabled?'disabled':''} style="background:${disabled?'#F9FAFB':'#fff'}; border:1px solid #E5E7EB; color:${disabled?'#D1D5DB':'#374151'}; padding:6px 12px; border-radius:7px; cursor:${disabled?'not-allowed':'pointer'}; font-size:12px; font-weight:700;">${lbl}</button>`;
  pager.innerHTML = `${btn('« Awal', 1, st.page<=1)} ${btn('‹ Prev', st.page-1, st.page<=1)} <span>Halaman ${st.page} / ${totalPages} · ${all.length.toLocaleString()} rekod</span> ${btn('Next ›', st.page+1, st.page>=totalPages)} ${btn('Akhir »', totalPages, st.page>=totalPages)}`;
 }
 if(window.lucide && lucide.createIcons) try { lucide.createIcons(); } catch(e){}
};

window.__ihExportCsv = function() {
 const all = window.__ihFiltered();
 if(!all.length) { if(typeof showToast === 'function') showToast('Tiada rekod untuk export.', 'warn'); return; }
 const q = (v) => '"' + String(v==null?'':v).replace(/"/g,'""') + '"';
 const lines = [['No.','Ref','Product','Input / Output','Units','Baki','Cost/Price','Total','Date','Nota'].join(',')];
 all.forEach(r => {
  const dt = r.date ? new Date(r.date).toLocaleDateString('en-GB') : '';
  lines.push([r.seq || '', q(r.sku), q(r.product), q(r.dir), r.units, (r.balAfter != null ? r.balAfter : ''), (r.price||0).toFixed(2), (r.total||0).toFixed(2), q(dt), q(r.note)].join(','));
 });
 const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url; a.download = 'inventory-history-' + new Date().toISOString().slice(0,10) + '.csv';
 document.body.appendChild(a); a.click(); document.body.removeChild(a);
 setTimeout(() => URL.revokeObjectURL(url), 1000);
 if(typeof showToast === 'function') showToast(all.length + ' rekod di-export.', 'success');
};

