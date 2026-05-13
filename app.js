const SUPABASE_URL = "https://asehjdnfzoypbwfeazra.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzZWhqZG5mem95cGJ3ZmVhenJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MjE2NjMsImV4cCI6MjA5MTE5NzY2M30.34nAhmcNO_xN73OdsyxayKl_jipIk-M8DIBgibAOdaI";

let db = null;
try {
 if(SUPABASE_URL === "PASTE_URL_DISINI") {
 console.warn("SILA MASUKKAN SUPABASE URL DAN KEY!");
 } else {
 db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
 }
} catch (e) {
 console.error("API Error: ", e.message);
}


// Money helper: avoid float-drift accumulation. Use after every += / arithmetic
// that contributes to a money total. Display layers can still toFixed(2).
window.round2 = function(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; };
const round2 = window.round2;

// Loading overlay: full-screen translucent block during long ops.
window.showLoading = function(msg) {
 let el = document.getElementById('__globalLoadingOverlay');
 if (!el) {
 el = document.createElement('div');
 el.id = '__globalLoadingOverlay';
 el.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,.55); z-index:9998; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(2px);';
 el.innerHTML = '<div style="background:#fff; padding:24px 32px; border-radius:12px; display:flex; align-items:center; gap:14px; box-shadow:0 8px 32px rgba(0,0,0,.2); min-width:240px;"><div style="width:24px; height:24px; border:3px solid #e5e7eb; border-top-color:#CD7C32; border-radius:50%; animation:spin 0.8s linear infinite;"></div><div id="__globalLoadingMsg" style="font-weight:600; color:#111; font-size:14px;">Loading...</div></div>';
 const style = document.createElement('style');
 style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
 el.appendChild(style);
 document.body.appendChild(el);
 }
 document.getElementById('__globalLoadingMsg').textContent = msg || 'Loading...';
 el.style.display = 'flex';
};
window.hideLoading = function() {
 const el = document.getElementById('__globalLoadingOverlay');
 if (el) el.style.display = 'none';
};

// =============================================================
// p1_29 — EasyStore push (POS sale → online inventory decrement)
// Best-effort: queue failed pushes in localStorage, retry on next call
// =============================================================
window.EASYSTORE_PUSH_URL = '/api/easystore-push';
window.EASYSTORE_RETRY_KEY = 'easystorePushQueue_v1';

window.easystorePushSale = async function(items, delta) {
    delta = delta || 'subtract';
    if(!Array.isArray(items) || !items.length) return;
    // Drain retry queue alongside new items
    let queue = [];
    try { queue = JSON.parse(localStorage.getItem(window.EASYSTORE_RETRY_KEY) || '[]'); } catch(e){}
    const allItems = [...queue, ...items.map(i => ({ sku: i.sku, qty: i.qty, delta }))];
    // Group by delta direction
    const grouped = { subtract: [], add: [] };
    allItems.forEach(i => { (grouped[i.delta || 'subtract'] = grouped[i.delta || 'subtract'] || []).push({ sku: i.sku, qty: i.qty }); });

    const failedItems = [];
    for(const dir of ['subtract', 'add']) {
        const group = grouped[dir];
        if(!group || !group.length) continue;
        try {
            const r = await fetch(window.EASYSTORE_PUSH_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: group, delta: dir })
            });
            if(!r.ok) throw new Error('http_' + r.status);
            const data = await r.json();
            // Track per-SKU failures (e.g. no_easystore_mapping → don't retry)
            (data.results || []).forEach(res => {
                if(!res.ok && res.reason === 'api_error') {
                    failedItems.push({ sku: res.sku, qty: group.find(g => g.sku === res.sku)?.qty || 0, delta: dir });
                }
            });
            if(typeof showToast === 'function' && data.succeeded > 0) {
                console.log('[EasyStore push]', data.succeeded + '/' + data.processed + ' synced');
            }
        } catch(e) {
            console.warn('[EasyStore push] failed, queueing:', e.message);
            // Network error → retry whole group
            failedItems.push(...group.map(g => ({ sku: g.sku, qty: g.qty, delta: dir })));
        }
    }

    // Persist failures for next attempt
    try {
        if(failedItems.length > 0) {
            localStorage.setItem(window.EASYSTORE_RETRY_KEY, JSON.stringify(failedItems.slice(0, 100)));
            // Show subtle warning if many fails
            if(failedItems.length >= 3 && typeof showToast === 'function') {
                showToast('EasyStore sync delayed — ' + failedItems.length + ' items queued for retry', 'warn');
            }
        } else {
            localStorage.removeItem(window.EASYSTORE_RETRY_KEY);
        }
    } catch(e){}
};

// Toast: non-blocking notification. Replaces alert() for soft messages.
window.showToast = function(msg, type) {
 type = type || 'info';
 const colors = {
 info: { bg:'#3b82f6', icon:'i' },
 success: { bg:'#10b981', icon:'' },
 warning: { bg:'#f59e0b', icon:'' },
 warn: { bg:'#f59e0b', icon:'' },
 error: { bg:'#dc2626', icon:'' }
 };
 const c = colors[type] || colors.info;
 const el = document.createElement('div');
 el.style.cssText = 'position:fixed; top:20px; right:20px; background:'+c.bg+'; color:#fff; padding:12px 18px; border-radius:8px; z-index:9999; font-weight:600; box-shadow:0 4px 16px rgba(0,0,0,.2); max-width:340px; font-size:13.5px; display:flex; gap:10px; align-items:center; opacity:0; transform:translateX(20px); transition:opacity.25s, transform.25s;';
 el.innerHTML = '<span style="font-size:16px;">'+c.icon+'</span><span>'+String(msg).replace(/</g,'&lt;')+'</span>';
 document.body.appendChild(el);
 requestAnimationFrame(() => { el.style.opacity='1'; el.style.transform='translateX(0)'; });
 setTimeout(() => { el.style.opacity='0'; el.style.transform='translateX(20px)'; setTimeout(()=>el.remove(), 280); }, type==='error' ? 4500 : 2800);
 // p1_34: persist warnings/errors into notification center (success/info skipped — too noisy).
 if (window.notify && (type === 'warning' || type === 'warn' || type === 'error')) {
 try { window.notify.add({ title: type === 'error' ? 'Error' : 'Warning', body: String(msg), type: type === 'warn' ? 'warning' : type, silent: true }); } catch(e){}
 }
};

// p1_34: Global notification center. Persistent inbox for warnings/errors/system events.
// Storage key: notifications_v1 (cap 50, FIFO). Read state per-entry via .read flag.
(function(){
 const KEY = 'notifications_v1';
 const CAP = 50;
 let cache = null;
 let openState = false;
 let outsideHandler = null;

 function load() {
 if (cache) return cache;
 try { cache = JSON.parse(localStorage.getItem(KEY)) || []; } catch(e) { cache = []; }
 return cache;
 }
 function save() { try { localStorage.setItem(KEY, JSON.stringify(cache || [])); } catch(e){} }
 function fmtTime(ts) {
 const diff = Date.now() - ts;
 if (diff < 60000) return 'just now';
 if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
 if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
 const d = new Date(ts);
 return d.getDate()+'/'+(d.getMonth()+1)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
 }
 function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
 function iconFor(type) {
 return ({ warning:'alert-triangle', error:'alert-octagon', success:'check-circle', info:'info' })[type] || 'info';
 }
 function dedupeRecent(item) {
 // Skip if same title+body added in last 30s — prevents spam from rapid repeated calls.
 const now = Date.now();
 return load().some(n => n.title === item.title && n.body === item.body && (now - n.ts) < 30000);
 }

 const api = {
 add(item) {
 if (!item || !item.body) return;
 const entry = {
 id: 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
 title: item.title || 'Notification',
 body: String(item.body),
 type: item.type || 'info',
 ts: Date.now(),
 read: false,
 action: item.action || null
 };
 if (dedupeRecent(entry)) return;
 const list = load();
 list.unshift(entry);
 if (list.length > CAP) list.length = CAP;
 cache = list;
 save();
 api.renderBadge();
 if (openState) api.renderList();
 return entry.id;
 },
 list() { return load().slice(); },
 unreadCount() { return load().filter(n => !n.read).length; },
 markRead(id) {
 const list = load();
 const n = list.find(x => x.id === id);
 if (n && !n.read) { n.read = true; save(); api.renderBadge(); api.renderList(); }
 },
 markAllRead() {
 const list = load();
 let dirty = false;
 list.forEach(n => { if (!n.read) { n.read = true; dirty = true; } });
 if (dirty) { save(); api.renderBadge(); api.renderList(); }
 },
 clear() {
 cache = []; save(); api.renderBadge(); api.renderList();
 },
 renderBadge() {
 const badge = document.getElementById('ncBadge');
 if (!badge) return;
 const n = api.unreadCount();
 if (n <= 0) { badge.hidden = true; badge.textContent = '0'; }
 else { badge.hidden = false; badge.textContent = n > 99 ? '99+' : String(n); }
 },
 renderList() {
 const wrap = document.getElementById('ncList');
 if (!wrap) return;
 const list = load();
 if (list.length === 0) {
 wrap.innerHTML = '<div class="nc-empty"><i data-lucide="inbox" class="nc-empty__icon" style="width:32px; height:32px;"></i>Tiada notifikasi</div>';
 } else {
 wrap.innerHTML = list.map(n => (
 '<div class="nc-item ' + (n.read ? '' : 'is-unread') + '" role="listitem" data-id="' + n.id + '" onclick="window.notify.markRead(\'' + n.id + '\')">' +
 '<div class="nc-item__icon nc-item__icon--' + escape(n.type) + '"><i data-lucide="' + iconFor(n.type) + '" style="width:14px; height:14px;"></i></div>' +
 '<div class="nc-item__body">' +
 '<p class="nc-item__title">' + escape(n.title) + '</p>' +
 '<p class="nc-item__msg">' + escape(n.body) + '</p>' +
 '<div class="nc-item__time">' + escape(fmtTime(n.ts)) + '</div>' +
 '</div>' +
 '</div>'
 )).join('');
 }
 if (window.lucide && typeof window.lucide.createIcons === 'function') { try { window.lucide.createIcons(); } catch(e){} }
 },
 toggle() { openState ? api.close() : api.open(); },
 open() {
 const panel = document.getElementById('ncPanel');
 const bell = document.getElementById('ncBell');
 if (!panel || !bell) return;
 panel.hidden = false;
 bell.classList.add('is-open');
 bell.setAttribute('aria-expanded', 'true');
 openState = true;
 api.renderList();
 // Outside click → close
 setTimeout(() => {
 outsideHandler = (e) => {
 if (!panel.contains(e.target) && !bell.contains(e.target)) api.close();
 };
 document.addEventListener('click', outsideHandler);
 }, 0);
 },
 close() {
 const panel = document.getElementById('ncPanel');
 const bell = document.getElementById('ncBell');
 if (panel) panel.hidden = true;
 if (bell) { bell.classList.remove('is-open'); bell.setAttribute('aria-expanded', 'false'); }
 openState = false;
 if (outsideHandler) { document.removeEventListener('click', outsideHandler); outsideHandler = null; }
 }
 };

 window.notify = api;
 // ESC closes panel
 document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openState) api.close(); });
 // Initial badge once DOM ready
 if (document.readyState === 'loading') {
 document.addEventListener('DOMContentLoaded', () => api.renderBadge());
 } else { api.renderBadge(); }
})();

// p1_35: Stock Take save-draft. Auto-persists typed Kiraan Fizikal + komen so user
// doesn't lose work on tab refresh / accidental close. Drafts older than 7d are pruned.
(function(){
 const KEY = 'stockTakeDraft_v1';
 const TTL_MS = 7 * 24 * 60 * 60 * 1000;
 const DEBOUNCE_MS = 500;
 let cache = null;
 let saveTimer = null;
 let pendingMutations = {};

 function readRaw() {
 try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch(e) { return {}; }
 }
 function writeRaw(map) {
 try { localStorage.setItem(KEY, JSON.stringify(map)); } catch(e){}
 }
 function load() {
 if (cache) return cache;
 const raw = readRaw();
 const now = Date.now();
 const fresh = {};
 Object.keys(raw).forEach(sku => {
 const e = raw[sku];
 if (e && (now - (e.ts || 0)) < TTL_MS) fresh[sku] = e;
 });
 if (Object.keys(fresh).length !== Object.keys(raw).length) writeRaw(fresh); // prune stale
 cache = fresh;
 return cache;
 }
 function flush() {
 const map = load();
 Object.keys(pendingMutations).forEach(sku => {
 const m = pendingMutations[sku];
 if (m === null) { delete map[sku]; }
 else { map[sku] = m; }
 });
 pendingMutations = {};
 writeRaw(map);
 if (typeof api.renderCounter === 'function') api.renderCounter();
 }
 function scheduleFlush() {
 if (saveTimer) clearTimeout(saveTimer);
 saveTimer = setTimeout(flush, DEBOUNCE_MS);
 }

 const api = {
 get(sku) { return load()[sku] || null; },
 all() { return load(); },
 count() { return Object.keys(load()).length; },
 save(sku, qty, note) {
 if (!sku) return;
 const qtyStr = (qty == null ? '' : String(qty)).trim();
 const noteStr = (note == null ? '' : String(note));
 if (qtyStr === '' && noteStr === '') { api.clear(sku); return; }
 pendingMutations[sku] = { qty: qtyStr, note: noteStr, ts: Date.now() };
 cache[sku] = pendingMutations[sku];
 scheduleFlush();
 },
 clear(sku) {
 if (!sku) return;
 const map = load();
 if (map[sku]) {
 delete map[sku];
 cache = map;
 writeRaw(map);
 api.renderCounter();
 }
 // also drop any pending mutation
 delete pendingMutations[sku];
 },
 clearAll() {
 if (!confirm('Buang semua draft Stock Take? Tindakan ini tidak boleh undo.')) return;
 cache = {}; pendingMutations = {}; writeRaw({});
 api.renderCounter();
 if (typeof window.renderAuditCards === 'function') window.renderAuditCards();
 if (typeof showToast === 'function') showToast('Semua draft Stock Take dibuang', 'success');
 },
 renderCounter() {
 const wrap = document.getElementById('stDraftBanner');
 if (!wrap) return;
 const n = api.count();
 if (n === 0) { wrap.hidden = true; wrap.innerHTML = ''; return; }
 wrap.hidden = false;
 wrap.innerHTML =
 '<div class="st-draft-banner">' +
 '<i data-lucide="save" style="width:14px; height:14px;"></i>' +
 '<span><strong>' + n + '</strong> draft kiraan disimpan auto. Boleh sambung bila-bila.</span>' +
 '<button type="button" class="st-draft-clear" onclick="window.stDraft.clearAll()">Buang semua</button>' +
 '</div>';
 if (window.lucide && typeof window.lucide.createIcons === 'function') { try { window.lucide.createIcons(); } catch(e){} }
 }
 };

 // Flush on tab close / visibility hidden (best-effort — protects against losing the last keystroke).
 window.addEventListener('beforeunload', () => { if (saveTimer) { clearTimeout(saveTimer); flush(); } });
 document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) { clearTimeout(saveTimer); flush(); } });

 window.stDraft = api;
 if (document.readyState === 'loading') {
 document.addEventListener('DOMContentLoaded', () => api.renderCounter());
 } else { api.renderCounter(); }
})();

// Global ESC handler: close any visible modal/overlay.
document.addEventListener('keydown', function(e){
 if (e.key !== 'Escape') return;
 // Find topmost visible modal-like overlay
 const candidates = document.querySelectorAll([
 '#pinLoginOverlay', '#staffWelcomeModal', '#receiptModal',
 '#customerLoginGate', '#smModalOverlay.active', '.sh-modal-overlay.active',
 '.sy-conflict-modal-overlay.sy-modal-active'
].join(','));
 for (let i = candidates.length - 1; i>= 0; i--) {
 const el = candidates[i];
 const cs = window.getComputedStyle(el);
 if (cs.display !== 'none' && cs.visibility !== 'hidden') {
 if (el.classList.contains('active')) el.classList.remove('active');
 else el.style.display = 'none';
 return;
 }
 }
});

// Shop info — used in receipt header, defaults if not configured.
window.getShopInfo = function() {
 let s = {};
 try { s = JSON.parse(localStorage.getItem('complianceSettings_v1')) || {}; } catch(e){}
 const defaults = {
 name: '10 CAMP',
 address: '',
 phone: '',
 email: 'zaid@10camp.com',
 ssm: '',
 footer: 'THANK YOU FOR SHOPPING AT 10 CAMP'
 };
 return Object.assign({}, defaults, (s && s.shop) || {});
};

// Pagination Defaults
let publicCurrentPage = 1;
let posCurrentPage = 1;
const itemsPerPage = 21;
let lastPosSearchTerm = "";

window.changePublicPage = function(dir) {
 publicCurrentPage += dir;
 renderPublicStorefront();
 // Scroll slightly up or to top of catalog (optional, but good UX)
 document.getElementById('publicProductsList').parentElement.scrollTop = 0;
}
window.changePosPage = function(dir) {
 posCurrentPage += dir;
 renderPOS(lastPosSearchTerm);
 document.getElementById('productsList').parentElement.scrollTop = 0;
}
// Memory State
let masterProducts = [];

// Single source of truth for "is this product live in cashier?"
// Strict: only `true` counts as published. NULL / false / undefined = draft.
window.isPublished = function(p) { return !!p && p.is_published === true; };

let pettyCashLedger = [];
// p1_50 — persistence so refresh doesn't wipe the ledger (was in-memory only).
window.PETTY_KEY = 'pettyCash_v1';
window.loadPettyCash = function() {
 try { pettyCashLedger = JSON.parse(localStorage.getItem(window.PETTY_KEY) || '[]'); }
 catch(e) { pettyCashLedger = []; }
};
window.persistPettyCash = function() {
 try { localStorage.setItem(window.PETTY_KEY, JSON.stringify(pettyCashLedger)); }
 catch(e) { console.warn('persistPettyCash failed:', e); }
};
window.loadPettyCash();
let customerIssues = [];
let globalMemo = { active: false, text: "" };

// Staff Scheduling Roster
let staffSchedules = [];
let pendingSchedules = [];

let publicHolidays = [
 '2026-01-01', '2026-03-20', '2026-03-21', '2026-03-22', '2026-03-23',
 '2026-05-01', '2026-05-27', '2026-06-01', '2026-06-17', '2026-08-31',
 '2026-09-16', '2026-12-11'
];

let hrSettings = {
 wedBreak: "Tiada Rehat (Non-Stop)",
 friBreak: "1:00 PM - 3:00 PM (Solat)",
 normalBreak: "2:00 PM - 3:00 PM"
};

let activeRosterMonth = new Date().getMonth();
let activeRosterYear = new Date().getFullYear();

window.setRosterMonth = function(m) {
 activeRosterMonth = parseInt(m);
 renderStaffSchedule();
};

window.setRosterYear = function(y) {
 activeRosterYear = parseInt(y);
 renderStaffSchedule();
};

let moyySettings = {
 target: 10000,
 commRate: 5
};

let staffProfiles = [
 { name: "Aliff", leave_balance: 14 },
 { name: "Farhan Moyy", leave_balance: 14 },
 { name: "Zack", leave_balance: 12 },
 { name: "Ariff", leave_balance: 10 },
 { name: "Irfan", leave_balance: 10 },
 { name: "Tarmizi", leave_balance: 8 },
 { name: "Fahmi", leave_balance: 8 }
];

let inventoryBatches = [];

let salesHistory = [];
let inventoryTransactions = [];
let purchaseOrders = [];
let poDraftItems = [];

let customersData = [];

let financeRecords = [];
let financeChartInstance = null;
let cart = [];
let salesChartInst = null; // Chart.js Object

// ===================================
// INIT & NAVIGATION
// ===================================
function toggleSidebar() {
 document.getElementById("appSidebar").classList.toggle("open");
 document.getElementById("sidebarOverlay").classList.toggle("active");
}
window.toggleSidebar = toggleSidebar;

function switchHub(sectionIds, title, btnElement) {
 // Hide all sections first
 document.querySelectorAll('.tab-section').forEach(s => s.style.display = 'none');
 
 // Show requested sections
 sectionIds.forEach(id => {
 const el = document.getElementById(id);
 if(el) el.style.display = 'block';
 });
 
 // Set Window Title (legacy + new breadcrumb)
 const oldTitle = document.getElementById('pageTitle');
 if(oldTitle) oldTitle.textContent = title;
 if(typeof updateBreadcrumb === 'function') updateBreadcrumb(title);

 // p1_40: align in-section page heading to sidebar label so they never disagree.
 // Looks for an explicit [data-page-title] marker first; otherwise the first h1/h2
 // inside the section. Preserves icon children — only replaces text nodes.
 // Opt-out via [data-skip-title-sync]. Runs immediately AND on next tick so
 // sections that re-render via innerHTML (e.g. renderShiftSection) still get aligned.
 const __syncSectionTitles = () => {
 sectionIds.forEach(id => {
 const sec = document.getElementById(id);
 if (!sec) return;
 let target = sec.querySelector('[data-page-title]');
 if (!target) target = sec.querySelector('h1, h2');
 if (!target || target.hasAttribute('data-skip-title-sync')) return;
 let replaced = false;
 Array.from(target.childNodes).forEach(node => {
 if (node.nodeType === 3 /* TEXT_NODE */ && node.textContent.trim()) {
 if (!replaced) { node.textContent = ' ' + title; replaced = true; }
 else { node.textContent = ''; }
 }
 });
 if (!replaced) target.appendChild(document.createTextNode(' ' + title));
 });
 };
 if (title) {
 __syncSectionTitles();
 setTimeout(__syncSectionTitles, 0); // backstop for render functions that fire after switchHub
 }
 
 // Update active state in sidebar
 document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
 if(btnElement) btnElement.classList.add('active');
 
 // Close sidebar on mobile if open
 const sidebar = document.getElementById("appSidebar");
 if(sidebar && sidebar.classList.contains("open")) toggleSidebar();

 // Contextual renders based on the hub being opened
 if(sectionIds.includes('homeSection')) renderDashboard();
 if(sectionIds.includes('posSection')) {
 const term = document.getElementById("posSearchBox") ? document.getElementById("posSearchBox").value : "";
 renderPOS(term);
 }
 if(sectionIds.includes('stockTakeSection')) renderAuditCards();

 if(sectionIds.includes('mgmtPlaceholders')) renderMgmtPlaceholders();
 if(sectionIds.includes('rosterSection')) renderStaffSchedule();
}
window.switchHub = switchHub;



window.togglePosLayoutMode = function() {
 const isMobile = document.body.classList.toggle('pos-mobile-mode');
 localStorage.setItem('posMode', isMobile ? 'mobile' : 'desktop');
}
window.toggleMobileCartSheet = function() {
 const cartSec = document.getElementById('posCartDrawer');
 if(cartSec) cartSec.classList.toggle('drawer-open');
}



let __initAppCount = 0;
async function initApp() {
 __initAppCount++;
 const isFirstLoad = __initAppCount === 1;
 if (isFirstLoad && typeof showLoading === 'function') showLoading('Memuatkan data dari awan...');
 try {
 console.log("Loading Cloud Omnichannel Data...");
 let { data: master } = await db.from('products_master').select('*');
 if(master) masterProducts = master;

 let { data: batches } = await db.from('inventory_batches').select('*').order('inbound_date', {ascending: true});
 if(batches) inventoryBatches = batches;

 let { data: txns } = await db.from('inventory_transactions').select('*').order('created_at', {ascending: false});
 if(txns) inventoryTransactions = txns;

 // Sprint 2.1+2.2: load real PO + suppliers tables
 try { if(typeof loadSuppliers === 'function') await loadSuppliers(); } catch(e) { console.warn('loadSuppliers:', e); }
 try { if(typeof loadPosV2 === 'function') await loadPosV2(); } catch(e) { console.warn('loadPosV2:', e); }
 // Sprint 3.4: load active reservations
 try { if(typeof loadReservations === 'function') await loadReservations(); } catch(e) { console.warn('loadReservations:', e); }
 // p4_4: low-stock notification check (deferred to next tick after render)
 setTimeout(() => { if(typeof checkLowStockNotify === 'function') checkLowStockNotify(); }, 5000);
 // p7_3: load promo engine rules
 try { if(typeof loadPromotions === 'function') await loadPromotions(); } catch(e) { console.warn('loadPromotions:', e); }

 // RENDER FRONTEND INSTANTLY BEFORE ADMIN BACKEND FETCHES
 // p1_47: re-render activity tiles + category pills now that masterProducts is populated
 try { if(typeof window.lpRenderActivityTiles === 'function') window.lpRenderActivityTiles(); } catch(e){}
 try { if(typeof window.lpRenderCategoryPills === 'function') window.lpRenderCategoryPills(); } catch(e){}
 try { if(typeof window.lpUpdateTrustStats === 'function') window.lpUpdateTrustStats(); } catch(e){}
 renderPublicStorefront();
 renderPOS();

 try { renderQuotePOS(); } catch(e){}
 let { data: quotes } = await db.from('quotations_log').select('*').order('created_at', {ascending: false});
 if(quotes) quoteHistoryLogs = quotes;

 let { data: sales } = await db.from('sales_history').select('*').order('created_at', {ascending: false});
 if(sales) salesHistory = [...salesHistory,...sales];

 let { data: custs } = await db.from('customers').select('*');
 if(custs) customersData = custs;
 
 let { data: fin } = await db.from('finance_records').select('*').order('year', {ascending: false});
 if(fin) financeRecords = fin;
 
 let { data: rSched } = await db.from('roster_schedules').select('*');
 if(rSched && rSched.length> 0) {
 staffSchedules = rSched;
 } else {
 // Auto-Generate April Loop if EVERYTHING is completely raw
 let pattern = ["Zack", "Aliff", "Fahmi", "Tarmizi", "Irfan", "Ariff", "Farhan Moyy"];
 let genSchedules = [];
 let todayMs = Date.now();
 for(let d=1; d<=30; d++) {
 let st = pattern[(d-1) % 7];
 let dStr = d < 10 ? '0'+d : d;
 genSchedules.push({
 id: todayMs + d,
 staff_name: st,
 date: '2026-04-' + dStr,
 shift: 'OFF',
 mc_name: ''
 });
 }
 staffSchedules = genSchedules;
 try { await db.from('roster_schedules').insert(genSchedules); } catch(e){}
 }

 let { data: pSched } = await db.from('pending_requests').select('*');
 if(pSched && pSched.length> 0) {
 pendingSchedules = pSched;
 } else {
 pendingSchedules = [];
 }

 // Tsunami Pembersihan Zombie Cache
 localStorage.removeItem('saved_staffSchedules');
 localStorage.removeItem('saved_pendingSchedules');

 // Supabase Real-time Roster Broadcaster
 if(!window.rosterSyncChannel) {
 window.rosterSyncChannel = db.channel('roster-sync-channel')
.on('postgres_changes', { event: '*', schema: 'public', table: 'roster_schedules' }, async (payload) => {
 let { data } = await db.from('roster_schedules').select('*');
 if(data) {
 staffSchedules = data;
 if(typeof renderStaffSchedule === 'function') renderStaffSchedule();
 }
 })
.on('postgres_changes', { event: '*', schema: 'public', table: 'pending_requests' }, async (payload) => {
 let { data } = await db.from('pending_requests').select('*');
 if(data) {
 pendingSchedules = data;
 if(typeof renderPendingSchedules === 'function') renderPendingSchedules();
 }
 })
.subscribe();
 }

 renderWMS();
 if(typeof populateEditSkuList === 'function') populateEditSkuList();
 if(typeof populateMovementSkuList === 'function') populateMovementSkuList();
 renderHistory();
 renderCustomers();
 renderPromotions();
 renderDashboard();
 if(typeof renderFinance === "function") renderFinance();
 if(typeof renderWhAudit === 'function') renderWhAudit();
 if(typeof renderInventoryLedger === 'function') renderInventoryLedger();
 if(typeof renderPoSection === 'function') renderPoSection();
 if(typeof renderValuationSection === 'function') renderValuationSection();
 if(typeof renderMgmtInventory === 'function') renderMgmtInventory();
 autoClockOutUnclosed();
 if(typeof renderPersonalCommission === "function") renderPersonalCommission();
 if (isFirstLoad) handleReorderParam();
 } catch(e) {
 if (typeof showToast === 'function') showToast('Server Error: ' + e.message, 'error'); else alert('Server Error: ' + e.message);
 } finally {
 if (isFirstLoad && typeof hideLoading === 'function') hideLoading();
 }
}

// p3_2 Reorder: parse ?reorder=<base64> and pre-fill cart with matching SKUs
function handleReorderParam() {
 try {
 const params = new URLSearchParams(window.location.search);
 const b64 = params.get('reorder');
 if (!b64) return;
 const minimal = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(b64)))));
 if (!Array.isArray(minimal) || !minimal.length) return;

 let added = 0; let missing = [];
 minimal.forEach(it => {
 const sku = it.s; const qty = parseInt(it.q)||1;
 const product = (typeof masterProducts !== 'undefined' && Array.isArray(masterProducts)) ? masterProducts.find(p => p.sku === sku) : null;
 if (!product) { missing.push(sku); return; }
 const existing = cart.find(c => c.sku === sku);
 if (existing) existing.quantity += qty;
 else cart.push({ sku, name: product.name, price: parseFloat(product.price)||0, quantity: qty });
 added++;
 });

 if (typeof renderCart === 'function') renderCart();

 const msg = added> 0
 ? ` ${added} item dari reorder link ditambah ke troli`+(missing.length?` (${missing.length} SKU dah tak wujud)`:'')
 : 'Reorder link rosak atau semua item dah tak available.';
 if (typeof showToast === 'function') showToast(msg, added>0?'success':'warning');

 // Clean URL so refresh tak re-trigger
 const cleanUrl = window.location.origin + window.location.pathname;
 window.history.replaceState({}, document.title, cleanUrl);
 } catch(e) {
 console.warn('[reorder] parse failed:', e);
 if (typeof showToast === 'function') showToast('Reorder link rosak (decode gagal).', 'error');
 }
}

// ===================================
// ANALYTICS DASHBOARD (FASA 4)
// ===================================
// Dashboard date range state — default Today
window.__dashRange = window.__dashRange || 'today';
window.__setDashRange = function(range, btn) {
 window.__dashRange = range;
 document.querySelectorAll('.dash-pill').forEach(p => p.classList.toggle('active', p === btn));
 const customWrap = document.getElementById('dashCustomWrap');
 if (customWrap) customWrap.classList.toggle('active', range === 'custom');
 if (range !== 'custom') renderDashboard();
};
window.__dashGoto = function(tab) {
 const item = document.querySelector('.menu-item[data-tab="'+tab+'"]');
 if (item) item.click();
 else if (typeof showToast === 'function') showToast('Menu "'+tab+'" tak dijumpai', 'warning');
};
function __getDashDateRange() {
 const r = window.__dashRange || 'today';
 const now = new Date();
 const startOf = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
 const endOf = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
 if (r === 'today') return { start: startOf(now), end: endOf(now), label: 'Today' };
 if (r === 'yesterday') { const y = new Date(now); y.setDate(y.getDate()-1); return { start: startOf(y), end: endOf(y), label: 'Yesterday' }; }
 if (r === '7d') { const s = new Date(now); s.setDate(s.getDate()-6); return { start: startOf(s), end: endOf(now), label: 'Last 7 days' }; }
 if (r === '30d') { const s = new Date(now); s.setDate(s.getDate()-29); return { start: startOf(s), end: endOf(now), label: 'Last 30 days' }; }
 if (r === 'mtd') { const s = new Date(now.getFullYear(), now.getMonth(), 1); return { start: startOf(s), end: endOf(now), label: 'Month-to-date' }; }
 if (r === 'all') return { start: null, end: null, label: 'All time' };
 if (r === 'custom') {
 const ss = document.getElementById('dashStartDate')?.value;
 const ee = document.getElementById('dashEndDate')?.value;
 return { start: ss ? startOf(new Date(ss)) : null, end: ee ? endOf(new Date(ee)) : null, label: (ss||'?')+' → '+(ee||'?') };
 }
 return { start: null, end: null, label: '—' };
}

window.renderDashboard = function() {
 const range = __getDashDateRange();
 let filteredSales = salesHistory;
 if (range.start && range.end) {
 filteredSales = salesHistory.filter(s => {
 const sd = new Date(s.created_at);
 return sd>= range.start && sd <= range.end;
 });
 }
 const rangeLabelEl = document.getElementById('dashRangeLabel');
 if (rangeLabelEl) rangeLabelEl.textContent = '— ' + range.label;

 // 2. Compute Core Metrics
 let totalSales = 0;
 let channelFreq = {};
 let itemCounts = {};

 let statusToFulfil = 0; let statusUnpaid = 0; let statusProcessing = 0; let statusReturn = 0;

 filteredSales.forEach(sale => {
 let rev = Number(sale.total || sale.total_amount || 0);
 totalSales = round2(totalSales + rev);
 
 // Channels
 let ch = sale.channel || 'In-Store';
 channelFreq[ch] = (channelFreq[ch] || 0) + rev;

 // Status
 let st = sale.status || 'Completed';
 if(st === 'To Fulfil') statusToFulfil++;
 if(st === 'Unpaid') statusUnpaid++;
 if(st === 'Processing') statusProcessing++;
 if(st === 'Return Request') statusReturn++;

 // Best Sellers parsing
 const itemsList = typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items;
 if(Array.isArray(itemsList)) {
 itemsList.forEach(item => {
 let sKey = item.sku;
 if(!itemCounts[sKey]) itemCounts[sKey] = { name: item.name, qty: 0, revenue: 0 };
 itemCounts[sKey].qty += Number(item.quantity);
 itemCounts[sKey].revenue = round2(itemCounts[sKey].revenue + Number(item.price) * Number(item.quantity));
 });
 }
 });

 const fmtMoney = (n) => Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
 document.getElementById("dashTotalSales").textContent = fmtMoney(totalSales);
 document.getElementById("dashTotalOrders").textContent = filteredSales.length;

 // Average Order Value
 const aov = filteredSales.length ? round2(totalSales / filteredSales.length) : 0;
 const aovEl = document.getElementById("dashAOV");
 if (aovEl) aovEl.textContent = 'RM ' + fmtMoney(aov);

 // Top Channel + share %
 let tChannel = "—"; let tVal = -1; let totalChVal = 0;
 for (let k in channelFreq) { totalChVal += channelFreq[k]; if(channelFreq[k]> tVal) { tChannel = k; tVal = channelFreq[k]; } }
 document.getElementById("dashTopChannel").textContent = tChannel;
 const shareEl = document.getElementById("dashTopChannelShare");
 if (shareEl) {
 if (totalChVal> 0 && tVal> 0) {
 const pct = Math.round((tVal / totalChVal) * 100);
 shareEl.textContent = pct + '% of revenue · RM ' + fmtMoney(tVal);
 } else { shareEl.textContent = 'No sales in range'; }
 }

 // Status Board Update
 document.getElementById("badgeToFulfil").textContent = statusToFulfil;
 document.getElementById("badgeUnpaid").textContent = statusUnpaid;
 document.getElementById("badgeProcessing").textContent = statusProcessing;
 document.getElementById("badgeReturn").textContent = statusReturn;

 // 3. Inventory Stock Health
 let activeP=0; let draftP=0; let oosP=0; let lowP=0;
 masterProducts.forEach(p => {
 if(!isPublished(p)) { draftP++; return; }
 activeP++;
 
 let qty = inventoryBatches.filter(b=>b.sku===p.sku).reduce((sum, b)=>sum+b.qty_remaining,0);
 if(qty === 0) oosP++;
 else if(qty < 5) lowP++;
 });
 
 document.getElementById("badgeActive").textContent = activeP;
 document.getElementById("badgeDraft").textContent = draftP;
 document.getElementById("badgeOos").textContent = oosP;
 document.getElementById("badgeLow").textContent = lowP;

 // 4. CRM Customer Metrics
 // Calculate new buyers based on how many unique names are in filteredSales vs customersData. 
 // Simplified for MVP:
 let repeatC = customersData.filter(c => c.points> 0).length; // Assumption: points means repeated
 let membersC = customersData.filter(c => c.is_member === true).length;
 document.getElementById("dashNewBuyers").textContent = customersData.length; // Total saved unique customers
 document.getElementById("badgeRepeat").textContent = repeatC;
 document.getElementById("badgeMembers").textContent = membersC;

 // 5. Draw Top 10 List
 const topArr = Object.values(itemCounts).sort((a,b) => b.qty - a.qty).slice(0, 10);
 const tbodyLines = document.getElementById("topSellingList");
 tbodyLines.innerHTML = "";
 if(topArr.length === 0) tbodyLines.innerHTML = "<tr><td>No sales data</td></tr>";
 
 if (topArr.length === 0) {
 tbodyLines.innerHTML = '<tr><td colspan="4" style="padding:18px; text-align:center; color:var(--text-muted); font-size:12.5px;">Belum ada sales dalam range ni. Pilih range lebih luas atau buat sale pertama.</td></tr>';
 } else {
 topArr.forEach((o, i) => {
 tbodyLines.innerHTML += `<tr style="cursor:pointer;" onclick="window.__dashGoto('inv_mapping')">
 <td style="width:24px; font-weight:bold; color:#888;">#${i+1}</td>
 <td><strong>${o.name}</strong></td>
 <td style="color:#10b981; font-weight:700;">${o.qty} sold</td>
 <td style="text-align:right; font-weight:600;">RM ${fmtMoney(o.revenue)}</td>
 </tr>`;
 });
 }

 // 6. Draw Chart.js (Daily Sales)
 let dailyMap = {};
 filteredSales.forEach(s => {
 let dStr = new Date(s.created_at).toLocaleDateString('en-GB'); 
 dailyMap[dStr] = round2((dailyMap[dStr] || 0) + Number(s.total || s.total_amount || 0));
 });
 // Sort chronological
 let sortedDates = Object.keys(dailyMap).sort((a,b)=> new Date(a.split('/').reverse().join('-')) - new Date(b.split('/').reverse().join('-')));
 let gLabels = sortedDates;
 let gData = sortedDates.map(d => dailyMap[d]);

 const ctx = document.getElementById('salesChart');
 if(!ctx) return;
 
 if(salesChartInst) salesChartInst.destroy();
 salesChartInst = new Chart(ctx.getContext('2d'), {
 type: 'line',
 data: {
 labels: gLabels,
 datasets: [{
 label: 'RM',
 data: gData,
 backgroundColor: 'rgba(205, 124, 50, 0.12)',
 borderColor: '#CD7C32',
 borderWidth: 2,
 fill: true,
 tension: 0.35,
 pointRadius: gData.length> 14 ? 0 : 2,
 pointHoverRadius: 4
 }]
 },
 options: {
 responsive: true,
 maintainAspectRatio: false,
 plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => 'RM ' + Number(c.parsed.y).toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2}) } } },
 scales: { x: { display: false }, y: { display: false, beginAtZero: true } }
 }
 });

 // Freshness timestamp
 const stamp = document.getElementById('dashFreshStamp');
 if (stamp) stamp.textContent = new Date().toLocaleTimeString('en-MY', { hour:'2-digit', minute:'2-digit' });
}

function renderHistory() {
 const el = document.getElementById("salesHistory");
 if(!el) return;
 el.innerHTML = "";
 salesHistory.forEach(sale => {
 let sc = sale.channel || 'In-Store';
 let st = sale.status || 'Completed';
 let stColor = st==='Completed'?'#000000': (st==='Unpaid'?'#6F6F6F': (st==='To Fulfil'?'#F37021':'#D80000'));

 const d = new Date(sale.created_at);
 el.innerHTML += `
 <div class="history-card">
 <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
 <strong>[#${sale.id}] RM ${parseFloat(sale.total || sale.total_amount || 0).toFixed(2)}</strong>
 <span class="badge-status" style="background:${stColor};">${st}</span>
 </div>
 <div style="font-size:13px; color:#666; margin-bottom:5px;">Buyer: ${sale.customer_name||'Walk-in'} • Channel: <strong>${sc}</strong> • ${sale.payment_method}</div>
 <div style="font-size:12px; color:#aaa;">${d.toLocaleDateString() + ' ' + d.toLocaleTimeString()}</div>
 </div>
 `;
 });
}

// ===================================
// INVENTORY WMS (BACKOFFICE)
// ===================================
// p1_49: Inventory Browse — KPIs + filter bar + card grid (default) / table (toggle)
window.invFilters = window.invFilters || { search: '', brand: '', cat: '', status: '' };
window.invView = window.invView || 'grid';

window.invHandleSearch = function(val) {
 window.invFilters.search = (val || '').toLowerCase().trim();
 renderWMS();
};
window.invSetFilter = function(key, val) {
 if(window.invFilters[key] === undefined) return;
 window.invFilters[key] = val || '';
 // sync the UI control if the call came from elsewhere (e.g. KPI tile click)
 const map = { brand: 'invBrandFilter', cat: 'invCatFilter', status: 'invStatusFilter' };
 const el = document.getElementById(map[key]);
 if(el && el.value !== window.invFilters[key]) el.value = window.invFilters[key];
 renderWMS();
};
window.invClearFilters = function() {
 window.invFilters = { search: '', brand: '', cat: '', status: '' };
 ['invSearchInput','invBrandFilter','invCatFilter','invStatusFilter'].forEach(id => {
 const el = document.getElementById(id); if(el) el.value = '';
 });
 renderWMS();
};
window.invSetView = function(view) {
 window.invView = view === 'table' ? 'table' : 'grid';
 document.querySelectorAll('.inv-view-btn').forEach(b => b.classList.toggle('is-active', b.dataset.view === window.invView));
 const grid = document.getElementById('invGridContainer');
 const tbl = document.getElementById('invTableContainer');
 if(grid) grid.style.display = window.invView === 'grid' ? '' : 'none';
 if(tbl) tbl.style.display = window.invView === 'table' ? '' : 'none';
 renderWMS();
};
window.invPopulateFilterOptions = function() {
 if(typeof masterProducts === 'undefined') return;
 const brands = new Set(), cats = new Set();
 masterProducts.forEach(p => { if(p.brand) brands.add(p.brand); if(p.category) cats.add(p.category); });
 const fillSel = (id, all, items) => {
 const sel = document.getElementById(id);
 if(!sel) return;
 const cur = sel.value;
 sel.innerHTML = '<option value="">' + all + '</option>' + Array.from(items).sort().map(v => `<option value="${String(v).replace(/"/g,'&quot;')}">${v}</option>`).join('');
 sel.value = cur;
 };
 fillSel('invBrandFilter', 'Semua Brand', brands);
 fillSel('invCatFilter', 'Semua Kategori', cats);
};

function renderWMS() {
 // 1) Inbound select stays (used elsewhere for batch inbound)
 const select = document.getElementById("inboundSkuSelect");
 if(select){
 select.innerHTML = '<option value="">-- Choose SKU --</option>';
 masterProducts.forEach(p => { select.innerHTML += `<option value="${p.sku}">[${p.sku}] ${p.name}</option>`; });
 }

 // 2) Bail if the new browse section isn't on the page (other callers expect renderWMS without the UI)
 const gridContainer = document.getElementById('invGridContainer');
 const tbody = document.getElementById('inventoryTableBody');
 if(!gridContainer && !tbody) return;

 // 3) Populate filter dropdowns (refresh in case product list grew)
 window.invPopulateFilterOptions();

 // 4) Compute KPIs over the FULL master list (not filtered)
 const totalProducts = masterProducts.length;
 const brands = new Set(masterProducts.map(p => p.brand).filter(Boolean));
 const cats = new Set(masterProducts.map(p => p.category).filter(Boolean));
 let lowCount = 0, oosCount = 0;
 masterProducts.forEach(p => {
 const stock = inventoryBatches.filter(b => b.sku === p.sku && b.qty_remaining > 0).reduce((s, b) => s + b.qty_remaining, 0);
 const reorderPt = parseFloat(p.reorder_point) || 5;
 if(stock <= 0) oosCount++;
 else if(stock <= reorderPt) lowCount++;
 });
 const setText = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
 setText('invKpiTotal', totalProducts);
 setText('invKpiBrands', brands.size);
 setText('invKpiCats', cats.size);
 setText('invKpiLow', lowCount);
 setText('invKpiOOS', oosCount);

 // 5) Apply filters
 const f = window.invFilters;
 const filtered = masterProducts.filter(p => {
 if(f.search) {
 const q = f.search;
 if(!(p.name||'').toLowerCase().includes(q) && !(p.sku||'').toLowerCase().includes(q) && !(p.brand||'').toLowerCase().includes(q)) return false;
 }
 if(f.brand && p.brand !== f.brand) return false;
 if(f.cat && p.category !== f.cat) return false;
 if(f.status) {
 const stock = inventoryBatches.filter(b => b.sku === p.sku && b.qty_remaining > 0).reduce((s, b) => s + b.qty_remaining, 0);
 const reorderPt = parseFloat(p.reorder_point) || 5;
 if(f.status === 'active' && !isPublished(p)) return false;
 if(f.status === 'draft' && isPublished(p)) return false;
 if(f.status === 'oos' && stock > 0) return false;
 if(f.status === 'low' && (stock <= 0 || stock > reorderPt)) return false;
 }
 return true;
 });

 // 6) Active filter chips
 const banner = document.getElementById('invActiveFilters');
 if(banner) {
 const chips = [];
 const esc = (s) => String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
 if(f.search) chips.push(`<span class="inv-chip">Cari: "${f.search}" <button onclick="document.getElementById('invSearchInput').value=''; window.invHandleSearch('')">×</button></span>`);
 if(f.brand) chips.push(`<span class="inv-chip">Brand: ${esc(f.brand)} <button onclick="window.invSetFilter('brand','')">×</button></span>`);
 if(f.cat) chips.push(`<span class="inv-chip">Kategori: ${esc(f.cat)} <button onclick="window.invSetFilter('cat','')">×</button></span>`);
 if(f.status) {
 const labels = { active:'Active', draft:'Draft', low:'Low Stock', oos:'Sold Out' };
 chips.push(`<span class="inv-chip">Status: ${labels[f.status]||f.status} <button onclick="window.invSetFilter('status','')">×</button></span>`);
 }
 if(chips.length) {
 banner.innerHTML = `<span class="inv-active-filters__count">Showing <strong>${filtered.length}</strong> dari ${masterProducts.length} produk</span>` + chips.join('') + ` <button class="inv-clear-all" onclick="window.invClearFilters()">Clear all</button>`;
 banner.style.display = '';
 } else {
 banner.innerHTML = '';
 banner.style.display = 'none';
 }
 }

 // 7) Render grid or table based on view
 if(window.invView === 'table') {
 renderInventoryTable(filtered);
 } else {
 renderInventoryGrid(filtered);
 }
}

function renderInventoryGrid(products) {
 const container = document.getElementById('invGridContainer');
 if(!container) return;
 if(!products.length) {
 container.innerHTML = '<div class="inv-empty"><p>Tiada produk padan tapisan.</p><button class="btn-primary" onclick="window.invClearFilters()">Clear filters</button></div>';
 return;
 }
 const fmt = (n) => 'RM ' + (Number.isInteger(n) ? n : n.toFixed(2));
 let html = '';
 products.forEach(p => {
 const myBatches = inventoryBatches.filter(b => b.sku === p.sku && b.qty_remaining > 0);
 const totalStock = myBatches.reduce((sum, b) => sum + b.qty_remaining, 0);
 const reorderPt = parseFloat(p.reorder_point) || 5;
 const stockState = totalStock <= 0 ? 'oos' : (totalStock <= reorderPt ? 'low' : 'ok');
 const stockLabel = stockState === 'oos' ? 'Sold Out' : (stockState === 'low' ? `${totalStock} ${p.unit||'Pcs'} · Low` : `${totalStock} ${p.unit||'Pcs'}`);
 const thumb = (p.images && p.images[0]) ? p.images[0] : 'https://placehold.co/300x300?text=No+Img';
 const skuEsc = String(p.sku).replace(/'/g, "\\'");
 const draftBadge = !isPublished(p) ? '<span class="inv-card__badge inv-card__badge--draft">Draft</span>' : '';
 const cost = parseFloat(p.cost_price || 0);
 const price = parseFloat(p.price || 0);
 html += `
 <button type="button" class="inv-card" data-sku="${p.sku}" onclick="window.openPdpModal('${skuEsc}')">
 <div class="inv-card__media">
 <img src="${thumb}" alt="${(p.name||'').replace(/"/g,'&quot;')}" loading="lazy" onerror="this.src='https://placehold.co/300x300?text=No+Img'">
 ${draftBadge}
 <span class="inv-card__stock inv-card__stock--${stockState}">${stockLabel}</span>
 </div>
 <div class="inv-card__body">
 <div class="inv-card__meta">
 ${p.brand ? `<span class="inv-card__brand">${p.brand}</span>` : ''}
 ${p.category ? `<span class="inv-card__cat">${p.category}</span>` : ''}
 </div>
 <div class="inv-card__sku">${p.sku}</div>
 <h3 class="inv-card__name">${p.name || 'Untitled'}</h3>
 <div class="inv-card__footer">
 <div class="inv-card__price-wrap">
 <small>Cost ${fmt(cost)}</small>
 <strong>${fmt(price)}</strong>
 </div>
 <div class="inv-card__loc" title="Lokasi gudang">
 <i data-lucide="map-pin"></i>
 <span>${p.location_bin || '—'}</span>
 </div>
 </div>
 </div>
 </button>
 `;
 });
 container.innerHTML = html;
 if(window.lucide && lucide.createIcons) lucide.createIcons();
}

function renderInventoryTable(products) {
 const tbody = document.getElementById("inventoryTableBody");
 if(!tbody) return;
 let htmlBuf3 = "";
 products.forEach(p => {
 const myBatches = inventoryBatches.filter(b => b.sku === p.sku && b.qty_remaining> 0);
 const totalStock = myBatches.reduce((sum, b) => sum + b.qty_remaining, 0);
 let thumb = "https://placehold.co/100x100?text=Img";
 let imgs = p.images || []; if(imgs.length> 0) thumb = imgs[0];
 let sBadge = isPublished(p) ? `<span style="color:green;font-size:10px;">Active</span>` : `<span style="color:red;font-size:10px;">Draft</span>`;
 htmlBuf3 += `
 <tr onclick="window.openPdpModal('${String(p.sku).replace(/'/g, "\\'")}')" style="cursor:pointer;">
 <td>
 <img src="${thumb}" style="width:45px; height:45px; object-fit:cover; border-radius:6px; background:#eee;"><br>
 ${sBadge}
 </td>
 <td>
 <span class="sku-badge">${p.sku}</span> <span class="cat-badge">${p.category||'Uncategorized'}</span> ${p.location_bin ? `<span style="background:#fef08a; color:#854d0e; padding:3px 6px; border-radius:4px; font-size:10px;"> Loc: ${p.location_bin}</span>` : ''}<br>
 <strong>${p.name}</strong><br>
 <small style="color:#888;">Jenama: <strong>${p.brand || 'N/A'}</strong></small>
 </td>
 <td>
 <div style="font-size:12px; color:#555;">
 Model: ${p.model_no || '-'}<br>
 Variant: ${p.variant_size || '-'} / ${p.variant_color || '-'}<br>
 Dimensi: ${p.dimensions || '-'} (${p.weight_kg ? p.weight_kg+'Kg' : '-'})
 </div>
 </td>
 <td style="font-weight:bold; color:${totalStock <= 0 ? 'red' : 'green'};">
 ${totalStock} ${p.unit||'Pcs'}<br>
 <small style="font-weight:normal; color:#888;">${myBatches.length} batch(es)</small>
 ${myBatches.length> 0 ? (() => {
 const sources = [...new Set(myBatches.map(b => b.po_number).filter(Boolean))];
 const suppliers = [...new Set(myBatches.map(b => b.supplier_name).filter(Boolean))];
 let trace = '';
 if(sources.length) trace += `<br><span style="font-weight:normal; color:#0EA5E9; font-size:10px;"> ${sources.slice(0,2).join(', ')}${sources.length> 2 ? '+' : ''}</span>`;
 if(suppliers.length) trace += `<br><span style="font-weight:normal; color:#7C3AED; font-size:10px;"> ${suppliers.slice(0,2).join(', ')}${suppliers.length> 2 ? '+' : ''}</span>`;
 return trace;
 })() : ''}
 </td>
 <td>
 <div style="background:#F3F4F6; padding:5px; border-radius:4px; font-family:monospace; font-size:12px; border:1px solid #ddd; display:inline-block;">
 ${p.location_bin || "Tiada Maklumat Rak"}
 </div>
 </td>
 <td>
 <small>Cost: RM${parseFloat(p.cost_price||0).toFixed(2)}</small><br>
 <strong>Sell: RM${parseFloat(p.price).toFixed(2)}</strong>
 </td>
 </tr>
 `;
 });
 tbody.innerHTML = htmlBuf3;
}

window.renderAuditCards = function() {
 renderStockTake();
}

// Global variable to keep track of audit timestamps per SKU
let auditTimestamps = {};

function renderStockTake() {
 const container = document.getElementById("auditCardsContainer");
 if(!container) return;
 
 let searchTxt = (document.getElementById("auditSearchInput")?.value || "").toLowerCase();
 let filterVal = document.getElementById("auditFilterSelect")?.value || "all";
 
 let html = "";
 
 let filteredProducts = masterProducts.filter(p => {
 let matchName = p.name.toLowerCase().includes(searchTxt);
 let matchSku = p.sku.toLowerCase().includes(searchTxt);
 if(!matchName && !matchSku) return false;
 
 let qty = inventoryBatches.filter(b => b.sku === p.sku && b.qty_remaining> 0).reduce((sum, b) => sum + b.qty_remaining, 0);
 
 if(filterVal === "laku" && qty <= 10) return false; // fast moving is>10
 if(filterVal === "tak-laku" && qty> 10) return false; // dead stock is <=10
 
 return true;
 });

 if(filteredProducts.length === 0) {
 container.innerHTML = "<p style='text-align:center; padding:20px; color:#888;'>Tiada produk dijumpai yang padan dengan tapisan.</p>";
 return;
 }

 filteredProducts.forEach(p => {
 const myBatches = inventoryBatches.filter(b => b.sku === p.sku && b.qty_remaining> 0);
 const totalStock = myBatches.reduce((sum, b) => sum + b.qty_remaining, 0);
 
 // Mock properties based on user request:
 const modelNo = p.sku + "-X";
 const erpBarcode = "884" + p.sku.replace(/\D/g,'') + Math.floor(Math.random()*10);
 const locText = "Rak T" + ((p.sku.charCodeAt(2)||48)%3+1) + "/B" + ((p.sku.charCodeAt(3)||48)%6+1);
 const statusStok = totalStock> 10 ? "Fast-Moving (Laku)" : "Dead Stock (Perlahan)";
 const statusColor = totalStock> 10 ? "var(--success)" : "var(--danger)";
 const imgUrl = (p.images && p.images[0]) ? p.images[0] : "https://via.placeholder.com/150?text=No+Image";
 
 let stampHtml = auditTimestamps[p.sku] ? `<p style="color:var(--success); font-size:11px; margin-top:5px; font-weight:bold;"> Disemak pada: ${auditTimestamps[p.sku]}</p>` : "";

 const currentLoc = p.location_bin || locText;
 const currentStatus = p.stock_status || statusStok;
 const currentStatusColor = currentStatus.includes("Fast") ? "var(--success)" : currentStatus.includes("Dead") ? "var(--danger)" : "#6B7280";

 html += `
 <div class="admin-card" style="padding:15px; border-left:5px solid var(--primary); margin-bottom:0px; background:#fff; display:flex; gap:15px; flex-wrap:wrap;">
 
 <!-- Product Image & Basic Info (Left) -->
 <div style="flex:1; min-width:200px; display:flex; gap:10px;">
 <img src="${imgUrl}" style="width:80px; height:80px; object-fit:cover; border-radius:6px; border:1px solid var(--border-color);">
 <div>
 <strong style="color:var(--primary); font-size:16px;">${p.sku}</strong>
 <p style="font-size:14px; font-weight:bold; margin-bottom:5px;">${p.name}</p>
 <p style="font-size:11px; color:#888; margin-bottom:2px;">Model No: ${modelNo}</p>
 <p style="font-size:11px; color:#888; margin-bottom:2px;">ERP Barcode: ${erpBarcode}</p>
 </div>
 

 </div>

 <!-- Stock Location & Status (Middle) -->
 <div style="flex:1; min-width:220px; padding-left:10px; border-left:1px dashed var(--border-color);">
 <div style="display:flex; justify-content:space-between; align-items:center;">
 <p class="small-lbl" style="margin:0;">Lokasi Stok</p>
 <button onclick="openLocModal('${p.sku}')" style="background:none; border:none; cursor:pointer; font-size:12px; color:var(--primary);"> Ubah</button>
 </div>
 <div id="locDisplay-${p.sku}" style="display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap;">
 <span style="font-family:monospace; font-size:11px; font-weight:bold; background:#E0F2FE; padding:3px 8px; border-radius:4px; border:1px solid #BAE6FD;">${p.location_bin || p.loc_level || 'Belum Ditetapkan'}</span>
 </div>
 
 <p class="small-lbl" style="margin:0; margin-bottom:3px;">Status Stok</p>
 <select id="statusSelect-${p.sku}" onchange="updateStockStatus('${p.sku}', this.value)" style="font-size:11px; padding:3px; border-radius:4px; border:1px solid #ccc; font-weight:bold; background-color:${currentStatusColor}; color:white; width:100%; max-width:160px; cursor:pointer;">
 <option value="Fast-Moving (Laku)" style="background:white; color:black;" ${currentStatus.includes('Fast') ? 'selected' : ''}>Fast-Moving (Laku)</option>
 <option value="Dead Stock (Perlahan)" style="background:white; color:black;" ${currentStatus.includes('Dead') ? 'selected' : ''}>Dead Stock (Perlahan)</option>
 <option value="Normal / Baru" style="background:white; color:black;" ${(!currentStatus.includes('Fast') && !currentStatus.includes('Dead')) ? 'selected' : ''}>Normal / Baru</option>
 </select>
 </div>

 <!-- Audit Execution Panel (Right) -->
 <div style="flex:1.5; min-width:280px; padding-left:10px; border-left:1px dashed var(--border-color); background:#FAFAFA; border-radius:6px; padding:10px;">
 <div style="display:flex; justify-content:space-between; margin-bottom:10px; align-items:center;">
 <div style="text-align:center;">
 <p class="small-lbl" style="margin:0;">Stok Sistem</p>
 <span style="font-size:20px; font-weight:900;" id="sysQty-${p.sku}">${totalStock}</span>
 </div>
 <div style="text-align:center;">
 <p class="small-lbl" style="margin:0; color:var(--primary);">Kiraan Fizikal</p>
 <input type="number" id="fizikalQty-${p.sku}" onkeyup="calculateVariance('${p.sku}')" oninput="window.stDraft && window.stDraft.save('${p.sku}', this.value, (document.getElementById('auditKomen-${p.sku}')||{}).value || '')" class="login-input" style="width:80px; text-align:center; margin:0; padding:8px; border-color:var(--primary);" placeholder="Qty">
 </div>
 <div style="text-align:center;">
 <p class="small-lbl" style="margin:0;">Selisih (+/-)</p>
 <span style="font-size:16px; font-weight:bold;" id="varianceQty-${p.sku}">0</span>
 </div>
 </div>
 
 <div style="background:#e0f2fe; border:1px dashed #bae6fd; padding:10px; border-radius:6px; margin-bottom:10px; text-align:center;">
 <label style="font-size:11px; font-weight:bold; color:#0369a1; display:block; margin-bottom:5px;"> Tally Scan Fizikal (+1)</label>
 <input type="text" onkeyup="handleTallyScan(event, '${p.sku}', '${erpBarcode}')" class="login-input" style="width:100%; text-align:center; padding:6px; margin:0; border-color:#0ea5e9; font-size:12px;" placeholder="Tumpu di sini & scan barcode...">
 </div>

 <input type="text" id="auditKomen-${p.sku}" oninput="window.stDraft && window.stDraft.save('${p.sku}', (document.getElementById('fizikalQty-${p.sku}')||{}).value || '', this.value)" class="login-input" style="margin:0; padding:8px; font-size:12px; margin-bottom:10px;" placeholder="Tulis catatan (Cth: 2 item rosak)...">
 
 <button onclick="submitAuditSingle('${p.sku}')" class="btn-primary" style="width:100%; margin:0; padding:10px;">SUBMIT KIRAAN ITEM</button>
 <div id="stampWrapper-${p.sku}">${stampHtml}</div>
 </div>
 </div>
 `;
 });
 
 container.innerHTML = html;

 // p1_35: restore draft Kiraan Fizikal + komen, then refresh variance + draft tag
 if (window.stDraft) {
 const drafts = window.stDraft.all();
 Object.keys(drafts).forEach(sku => {
 const d = drafts[sku];
 const fiz = document.getElementById('fizikalQty-' + sku);
 const note = document.getElementById('auditKomen-' + sku);
 if (fiz && d.qty) fiz.value = d.qty;
 if (note && d.note) note.value = d.note;
 if (fiz && d.qty && typeof window.calculateVariance === 'function') window.calculateVariance(sku);
 const stamp = document.getElementById('stampWrapper-' + sku);
 if (stamp && !auditTimestamps[sku]) {
 stamp.innerHTML = '<span class="st-draft-tag" title="Auto-saved draft, belum submit">Draft tersimpan</span>';
 }
 });
 window.stDraft.renderCounter();
 }
}

window.openLocModal = function(sku) {
 let p = masterProducts.find(x => x.sku === sku);
 if(!p) return;
 document.getElementById('locModalSku').textContent = sku;
 document.getElementById('locModalName').textContent = p.name;
 document.getElementById('locModalSkuHidden').value = sku;
 
 let parts = (p.location_bin || "").split('-');
 if(parts.length>= 2) {
 document.getElementById('locZone').value = parts[0] || '';
 document.getElementById('locAisle').value = parts[1] || '';
 document.getElementById('locRack').value = parts[2] || '';
 document.getElementById('locTier').value = parts[3] || '';
 document.getElementById('locBin').value = parts[4] || '';
 } else {
 document.getElementById('locZone').value = p.loc_level || '';
 document.getElementById('locAisle').value = '';
 document.getElementById('locRack').value = p.loc_rack || '';
 document.getElementById('locTier').value = p.loc_tier || '';
 document.getElementById('locBin').value = '';
 }
 document.getElementById('locationUpdateModal').style.display = 'flex';
}

window.submitLocUpdate = function() {
 let sku = document.getElementById('locModalSkuHidden').value;
 let zone = document.getElementById('locZone').value.trim().toUpperCase();
 let aisle = document.getElementById('locAisle').value.trim().toUpperCase();
 let rack = document.getElementById('locRack').value.trim().toUpperCase();
 let tier = document.getElementById('locTier').value.trim().toUpperCase();
 let bin = document.getElementById('locBin').value.trim().toUpperCase();
 
 if(!zone && !aisle && !rack && !tier && !bin) { alert('Sila isikan sekurang-kurangnya satu ruangan!'); return; }
 
 let fullLoc = [zone, aisle, rack, tier, bin].filter(Boolean).join('-');
 
 let p = masterProducts.find(x => x.sku === sku);
 if(p) {
 p.location_bin = fullLoc;
 p.loc_level = zone;
 p.loc_rack = aisle;
 p.loc_tier = rack;
 
 try { if(db) db.from('products_master').update({ location_bin: fullLoc, loc_level: zone, loc_rack: aisle, loc_tier: rack }).eq('sku', sku).then(); } catch(e){}
 }
 
 let display = document.getElementById('locDisplay-'+sku);
 if(display) {
 display.innerHTML = `<span style="font-family:monospace; font-size:11px; font-weight:bold; background:#dcfce7; padding:3px 8px; border-radius:4px; border:1px solid #86efac; animation:fadeIn 0.3s;">${fullLoc}</span>`;
 }
 
 document.getElementById('locationUpdateModal').style.display = 'none';
}


window.updateStockStatus = function(sku, val) {
 let p = masterProducts.find(x => x.sku === sku);
 if(p) {
 p.stock_status = val; // Update memory
 // Update cloud asynchronously
 try { if(db) db.from('products_master').update({stock_status: val}).eq('sku', sku).then(); } catch(e){}
 }
 
 let selectEl = document.getElementById("statusSelect-"+sku);
 if(val.includes("Fast")) {
 selectEl.style.backgroundColor = "var(--success)";
 } else if(val.includes("Dead")) {
 selectEl.style.backgroundColor = "var(--danger)";
 } else {
 selectEl.style.backgroundColor = "#6B7280";
 }
}

window.calculateVariance = function(sku) {
 let sys = parseInt(document.getElementById("sysQty-"+sku).textContent) || 0;
 let fiz = parseInt(document.getElementById("fizikalQty-"+sku).value);
 let vDom = document.getElementById("varianceQty-"+sku);
 
 if(isNaN(fiz)) {
 vDom.textContent = "0";
 vDom.style.color = "var(--text-main)";
 return;
 }
 
 let diff = fiz - sys;
 if(diff> 0) {
 vDom.textContent = "+" + diff;
 vDom.style.color = "var(--success)";
 } else if(diff < 0) {
 vDom.textContent = diff;
 vDom.style.color = "var(--danger)";
 } else {
 vDom.textContent = "Tepat (0)";
 vDom.style.color = "var(--text-main)";
 }
}

window.submitAuditSingle = function(sku) {
 let fizDom = document.getElementById("fizikalQty-"+sku);
 if(fizDom.value === "") {
 alert("Sila masukkan nilai kiraan fizikal dahulu!");
 return;
 }
 
 // Save timestamp
 let today = new Date();
 auditTimestamps[sku] = today.toLocaleString('en-MY', { weekday:'short', day:'numeric', month:'short', hour:'numeric', minute:'numeric', hour12:true });
 
 // Refresh that component
 let stampWrap = document.getElementById("stampWrapper-"+sku);
 if(stampWrap) {
 stampWrap.innerHTML = `<p style="color:var(--success); font-size:11px; margin-top:5px; font-weight:bold; animation: fadeIn 0.5s;"> Disemak pada: ${auditTimestamps[sku]}</p>`;
 }
 
 // Optional border color change to signify done
 fizDom.parentElement.parentElement.parentElement.style.background = "#F0FDF4";

 // p1_35: drop draft now that the count is submitted
 if (window.stDraft) window.stDraft.clear(sku);
}

window.handleTallyScan = function(e, correctSku, correctErp) {
 if(e.key === 'Enter') {
 let val = e.target.value.trim().toUpperCase();
 e.target.value = ""; // Reset box for next scan
 if(!val) return;
 
 if(val === correctSku.toUpperCase() || val === correctErp.toUpperCase()) {
 let fizDom = document.getElementById("fizikalQty-"+correctSku);
 let currentFiz = parseInt(fizDom.value) || 0;
 fizDom.value = currentFiz + 1;
 window.calculateVariance(correctSku);
 
 // Visual success feedback
 fizDom.style.transition = "background-color 0.2s";
 fizDom.style.backgroundColor = "#dcfce7";
 setTimeout(() => fizDom.style.backgroundColor = "#fff", 300);
 } else {
 alert("Ralat: Barcode yang diimbas (" + val + ") TIDAK padan dengan produk ini!");
 }
 }
}

window.openBarcodeScannerModal = function() {
 document.getElementById('barcodeScannerModal').style.display = 'flex';
 document.getElementById('barcodeScanResult').style.display = 'none';
 document.getElementById('btnSubmitBarcodeAudit').style.display = 'none';
 const input = document.getElementById('barcodeScannerInput');
 input.value = '';
 setTimeout(() => input.focus(), 100);
}

window.handleMainAuditScan = function(e) {
 if(e.key === 'Enter') {
 const query = e.target.value.trim().toLowerCase();
 e.target.value = ""; // Reset box for next scan
 if(!query) return;
 
 const product = masterProducts.find(p => 
 p.sku.toLowerCase() === query ||
 (p.erp_barcode && p.erp_barcode.toLowerCase() === query) ||
 p.name.toLowerCase() === query ||
 (p.model_no && p.model_no.toLowerCase() === query)
);
 
 if(!product) {
 alert("Ralat: Produk (" + query + ") tidak dijumpai dalam sistem!");
 return;
 }
 
 const myBatches = inventoryBatches.filter(b => b.sku === product.sku && b.qty_remaining> 0);
 const totalStock = myBatches.reduce((sum, b) => sum + b.qty_remaining, 0);
 
 document.getElementById('bcScanSku').textContent = product.sku;
 document.getElementById('bcScanName').textContent = product.name;
 document.getElementById('bcScanSysQty').textContent = totalStock;
 document.getElementById('bcScanFizikalQty').value = "";
 document.getElementById('bcScanVariance').textContent = "0";
 document.getElementById('bcScanVariance').style.color = "var(--text-main)";
 
 document.getElementById('barcodeScannerModal').style.display = 'flex';
 document.getElementById('barcodeScanResult').style.display = 'block';
 document.getElementById('btnSubmitBarcodeAudit').style.display = 'block';
 
 // Let the DOM render the modal, then focus the physical quantity field
 setTimeout(() => document.getElementById('bcScanFizikalQty').focus(), 100);
 }
}

window.handleBarcodeScan = function(e) {
 if(e.key === 'Enter') {
 const query = e.target.value.trim().toLowerCase();
 if(!query) return;
 
 const product = masterProducts.find(p => 
 p.sku.toLowerCase() === query ||
 (p.erp_barcode && p.erp_barcode.toLowerCase() === query) ||
 p.name.toLowerCase() === query ||
 (p.model_no && p.model_no.toLowerCase() === query)
);
 
 if(!product) {
 alert("Produk tidak dijumpai dalam rekod!");
 e.target.select();
 return;
 }
 
 const myBatches = inventoryBatches.filter(b => b.sku === product.sku && b.qty_remaining> 0);
 const totalStock = myBatches.reduce((sum, b) => sum + b.qty_remaining, 0);
 
 document.getElementById('bcScanSku').textContent = product.sku;
 document.getElementById('bcScanName').textContent = product.name;
 document.getElementById('bcScanSysQty').textContent = totalStock;
 document.getElementById('bcScanFizikalQty').value = "";
 document.getElementById('bcScanVariance').textContent = "0";
 document.getElementById('bcScanVariance').style.color = "var(--text-main)";
 
 document.getElementById('barcodeScanResult').style.display = 'block';
 document.getElementById('btnSubmitBarcodeAudit').style.display = 'block';
 
 document.getElementById('bcScanFizikalQty').focus();
 }
}

window.calcBarcodeVariance = function() {
 let sys = parseInt(document.getElementById("bcScanSysQty").textContent) || 0;
 let fiz = parseInt(document.getElementById("bcScanFizikalQty").value);
 let vDom = document.getElementById("bcScanVariance");
 
 if(isNaN(fiz)) {
 vDom.textContent = "0";
 vDom.style.color = "var(--text-main)";
 return;
 }
 
 let diff = fiz - sys;
 if(diff> 0) {
 vDom.textContent = "+" + diff;
 vDom.style.color = "var(--success)";
 } else if(diff < 0) {
 vDom.textContent = diff;
 vDom.style.color = "var(--danger)";
 } else {
 vDom.textContent = "Tepat (0)";
 vDom.style.color = "var(--text-main)";
 }
}

window.processBarcodeAudit = function() {
 const sku = document.getElementById('bcScanSku').textContent;
 const fizDom = document.getElementById("bcScanFizikalQty");
 if(fizDom.value === "") {
 alert("Sila masukkan nilai kiraan fizikal dahulu!");
 return;
 }
 
 let today = new Date();
 auditTimestamps[sku] = today.toLocaleString('en-MY', { weekday:'short', day:'numeric', month:'short', hour:'numeric', minute:'numeric', hour12:true });
 
 if (typeof showToast==='function') showToast(`Kiraan fizikal untuk ${sku} disahkan`, 'success'); else alert(`Kiraan fizikal untuk ${sku} disahkan!`);

 // p1_35: drop draft after barcode-modal submit too
 if (window.stDraft) window.stDraft.clear(sku);

 if (document.getElementById("auditCardsContainer").innerHTML !== "") {
 renderStockTake();
 setTimeout(() => {
 let stampWrap = document.getElementById("stampWrapper-"+sku);
 if(stampWrap) {
 const mainFizDom = document.getElementById("fizikalQty-"+sku);
 if(mainFizDom) {
 mainFizDom.value = fizDom.value;
 window.calculateVariance(sku);
 mainFizDom.parentElement.parentElement.parentElement.style.background = "#F0FDF4";
 }
 }
 }, 100);
 }
 
 document.getElementById('barcodeScannerModal').style.display='none';
}





document.getElementById("startCsvBtn").onclick = async function() {
 const fileInput = document.getElementById("csvFileInput");
 if(!fileInput.files.length) return alert("Pilih fail Spreadsheet (.csv atau.xlsx)!");
 const file = fileInput.files[0];
 const fileExt = file.name.split('.').pop().toLowerCase();
 
 this.disabled = true; this.textContent = "Analyzing Smart Migrator...";

 const processData = async (dataArray, headers) => {
 const typeSelect = document.getElementById("csvImportType");
 const importMode = typeSelect ? typeSelect.value : "products";
 const btn = document.getElementById("startCsvBtn");
 
 if(importMode === "sales") {
 const isShopSales = headers.includes("Name") && headers.includes("Total");
 const isEasySales = headers.includes("Order Number") && headers.includes("Total");
 let salesPayload = [];
 
 dataArray.forEach(r => {
 let s_oid = "", s_amt = 0, s_cust = "Unknown", s_date = new Date().toISOString();
 if(isShopSales) {
 s_oid = r["Name"]; s_amt = r["Total"] || r["Subtotal"]; s_cust = r["Email"] || "Shopify Customer";
 s_date = r["Created at"] || s_date;
 } else if(isEasySales) {
 s_oid = r["Order Number"]; s_amt = r["Total"]; s_cust = r["Customer Name"];
 s_date = r["Date"] || s_date;
 } else {
 s_oid = r.order_id || r.id; s_amt = r.amount || r.total; s_cust = r.customer || r.name;
 }
 if(s_oid) {
 salesPayload.push({
 order_id: s_oid,
 platform: isShopSales ? "Shopify" : (isEasySales ? "EasyStore" : "Imported"),
 amount: parseFloat(s_amt || 0),
 customer_name: s_cust || "Unknown",
 created_at: new Date(s_date).toISOString()
 });
 }
 });
 
 if(salesPayload.length === 0) {
 alert("Format CSV/Excel Sales Tidak Sah / Kosong.");
 btn.disabled = false; btn.textContent = " Process Robot Upload";
 return;
 }
 try {
 let chunkSize = 500;
 for(let i=0; i<salesPayload.length; i+=chunkSize) {
 btn.textContent = `Pushing Sales: ${Math.min(i+chunkSize, salesPayload.length)} / ${salesPayload.length}...`;
 let chunk = salesPayload.slice(i, i+chunkSize);
 let { error } = await db.from('sales_history').upsert(chunk, { onConflict: 'order_id' });
 if(error) throw error;
 }
 alert(`Migrasi ${salesPayload.length} Rekod Jualan Berjaya!`);
 await initApp();
 } catch(e) { alert("Error: " + e.message); } finally { btn.disabled = false; btn.textContent = " Process Robot Upload"; }
 return;
 }

 // Products Migration Flow
 const isShopify = headers.includes("Variant SKU");
 const isEasyStore = headers.includes("Product Name") && headers.includes("Price");
 
 let payload = [];
 let inventoryPayload = [];

 dataArray.forEach(r => {
 let s_sku = "", s_name = "", s_price = 0, s_cost = 0, s_img = "", s_qty = 0;
 if(isShopify) {
 s_sku = r["Variant SKU"]; s_name = r["Handle"] || r["Title"]; s_price = r["Variant Price"];
 s_cost = r["Variant Compare At Price"] || 0; s_img = r["Image Src"] || "";
 s_qty = parseInt(r["Variant Inventory Qty"] || 0);
 } else if(isEasyStore) {
 s_sku = r["SKU"]; s_name = r["Product Name"]; s_price = r["Price"]; s_cost = r["Cost"];
 s_qty = parseInt(r["Quantity"] || 0);
 } else {
 s_sku = r.sku || r.SKU; s_name = r.name || r.NAME; s_price = r.price || r.PRICE; s_cost = r.cost_price || r.COST;
 }
 
 s_sku = (s_sku || "").toString().trim().toUpperCase();
 if(s_sku && s_sku !== "NAN") {
 payload.push({
 sku: s_sku, name: s_name || "Migrated Item",
 category: r.category || "Migrated", unit: "Pcs", cost_price: parseFloat(s_cost || 0),
 price: parseFloat(s_price || 0), commission_rate: 0,
 is_published: true, images: s_img ? [s_img] : []
 });
 if(s_qty> 0) {
 inventoryPayload.push({
 sku: s_sku, batch_year: new Date().getFullYear(),
 qty_received: s_qty, qty_remaining: s_qty
 });
 }
 }
 });

 if(payload.length === 0) {
 alert("Format Dokumen Tidak Dikenalpasti / Tiada SKU.");
 btn.disabled = false; btn.textContent = " Process Robot Upload";
 return;
 }
 
 try {
 // Chunking logic (500 items per chunk) to avoid Server Timeout
 let chunkSize = 500;
 for(let i=0; i<payload.length; i+=chunkSize) {
 btn.textContent = `Upserting Products: ${Math.min(i+chunkSize, payload.length)} / ${payload.length}...`;
 let chunk = payload.slice(i, i+chunkSize);
 let { error } = await db.from('products_master').upsert(chunk, { onConflict: 'sku' });
 if(error) throw error;
 }
 
 if(inventoryPayload.length> 0) {
 for(let i=0; i<inventoryPayload.length; i+=chunkSize) {
 btn.textContent = `Migrating Inventory: ${Math.min(i+chunkSize, inventoryPayload.length)} / ${inventoryPayload.length}...`;
 let chunk = inventoryPayload.slice(i, i+chunkSize);
 let { error } = await db.from('inventory_batches').insert(chunk);
 if(error) throw error;
 }
 }

 alert(`Migrasi Berjaya! dipindahkan sebanyak: ${payload.length} produk & ${inventoryPayload.length} susunan stok.`); 
 await initApp(); 
 
 } catch(e) {
 alert("Migration Error: " + e.message);
 } finally {
 btn.disabled = false; btn.textContent = " Process Robot Upload";
 }
 };

 if (fileExt === 'csv') {
 Papa.parse(file, {
 header: true, skipEmptyLines: true,
 complete: function(res) {
 processData(res.data, res.meta.fields || []);
 }
 });
 } else if (fileExt === 'xlsx' || fileExt === 'xls') {
 const reader = new FileReader();
 reader.onload = function(e) {
 const data = new Uint8Array(e.target.result);
 const workbook = XLSX.read(data, {type: 'array'});
 const firstSheetName = workbook.SheetNames[0];
 const worksheet = workbook.Sheets[firstSheetName];
 const jsonData = XLSX.utils.sheet_to_json(worksheet, {defval: ""});
 
 if (jsonData.length === 0) {
 alert("Fail bersheet kosong!");
 document.getElementById("startCsvBtn").disabled = false;
 document.getElementById("startCsvBtn").textContent = " Process Robot Upload";
 return;
 }
 const headers = Object.keys(jsonData[0]);
 processData(jsonData, headers);
 };
 reader.readAsArrayBuffer(file);
 } else {
 alert("Sila muat naik format fail yang sah (.csv atau.xlsx /.xls)!");
 this.disabled = false; this.textContent = " Process Robot Upload";
 }
};

document.getElementById("exportExcelBtn").onclick = function() {
 if(masterProducts.length === 0) return alert("Gudang kosong! Tiada apa untuk dieksport.");
 this.textContent = "Mengeksport...";
 
 let exportData = masterProducts.map(p => {
 let matchedBatches = inventoryBatches.filter(b => b.sku === p.sku);
 let totalStok = matchedBatches.reduce((sum, b) => sum + (b.qty_remaining || 0), 0);
 
 return {
 "SKU": p.sku,
 "NAME": p.name,
 "CATEGORY": p.category,
 "COST": p.cost_price,
 "PRICE": p.price,
 "QUANTITY": totalStok,
 "BRAND": p.brand || "",
 "DIMENSIONS": p.dimensions || "",
 "WEIGHT_KG": p.weight_kg || 0
 };
 });
 
 const worksheet = XLSX.utils.json_to_sheet(exportData);
 const workbook = XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory Data");
 
 XLSX.writeFile(workbook, `10CAMP_Inventory_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
 this.textContent = " Export Products (.xlsx)";
};



// ===================================
// POS CASHIER FRONTEND
// ===================================
function renderPOS(searchTerm = "") {
 const list = document.getElementById("productsList");
 if(!list) return;
 let htmlBuf = "";
 
 // Reset page if searching
 if(searchTerm !== lastPosSearchTerm) {
 lastPosSearchTerm = searchTerm;
 posCurrentPage = 1;
 }

 let filtered = masterProducts.filter(p => {
 if(!isPublished(p)) return false;
 if(searchTerm && !p.name.toLowerCase().includes(searchTerm.toLowerCase()) && !p.sku.toLowerCase().includes(searchTerm.toLowerCase())) return false;
 return true;
 });

 const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
 if(posCurrentPage> totalPages) posCurrentPage = totalPages;
 if(posCurrentPage < 1) posCurrentPage = 1;

 let sliced = filtered.slice((posCurrentPage - 1) * itemsPerPage, posCurrentPage * itemsPerPage);

 sliced.forEach(p => {

 const myBatches = inventoryBatches.filter(b => b.sku === p.sku && b.qty_remaining> 0);
 const totalStock = myBatches.reduce((sum, b) => sum + b.qty_remaining, 0);
 let thumb = p.images && p.images[0] ? p.images[0] : "https://placehold.co/300x200?text=No+Img";
 const skuEsc = String(p.sku).replace(/'/g, "\\'");

 // Clean title — strip leading "SKU |" or "CODE _" prefix from EasyStore name pollution,
 // and convert ALL CAPS to Title Case for readability.
 let cleanName = (p.name || 'Untitled');
 cleanName = cleanName.replace(/^[A-Z0-9-]+\s*[|_]\s*/i, '').trim();
 cleanName = cleanName.replace(/\s*[_]\s*/g, ' — ').replace(/\s{2,}/g, ' ').trim();
 // If name is mostly uppercase (>70% caps), title-case it
 const letters = cleanName.replace(/[^A-Za-z]/g, '');
 const upperRatio = letters.length ? (letters.match(/[A-Z]/g)||[]).length / letters.length : 0;
 if(upperRatio > 0.7 && letters.length > 6) {
   cleanName = cleanName.toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
 }
 const safeName = cleanName.replace(/"/g, '&quot;');

 htmlBuf += `
 <div class="product-card">
 <img src="${thumb}" class="pos-detail-trigger" onclick="window.posOpenProductDetail('${skuEsc}')" title="Klik untuk detail">
 <div class="product-card__badges">
 <span class="sku-badge">${p.sku}</span>
 ${p.brand ? `<span class="cat-badge">${p.brand}</span>` : (p.category ? `<span class="cat-badge">${p.category}</span>` : '')}
 </div>
 <h3 class="product-card__title pos-detail-trigger" onclick="window.posOpenProductDetail('${skuEsc}')" title="${safeName}">${cleanName}</h3>
 <p class="price">RM ${parseFloat(p.price).toFixed(2)}</p>
 <p class="product-card__stock">${totalStock <= 0 ? 'Out of stock' : `${totalStock} ${p.unit||'pcs'} in stock`}</p>
 <button onclick="addToCart('${skuEsc}')" ${totalStock <= 0 ? 'disabled' : ''}>${totalStock <= 0 ? 'Out of Stock' : 'Add to Cart'}</button>
 </div>
 `;
 });
 
 // Pagination Controls UI
 htmlBuf += `
 <div style="width:100%; display:flex; justify-content:center; align-items:center; gap:15px; margin-top:20px; grid-column: 1 / -1; font-size:14px; color:#555;">
 <button onclick="changePosPage(-1)" ${posCurrentPage <= 1 ? 'disabled style="opacity:0.5"' : 'style="cursor:pointer"'} class="custom-btn"> < Prev </button>
 <span>Page <b>${posCurrentPage}</b> of ${totalPages}</span>
 <button onclick="changePosPage(1)" ${posCurrentPage>= totalPages ? 'disabled style="opacity:0.5"' : 'style="cursor:pointer"'} class="custom-btn"> Next> </button>
 </div>
 `;
 list.innerHTML = htmlBuf;
}

// =============================================================
// p1_24 — POS Product Detail Modal (gallery + variants + add)
// =============================================================
window.__pdState = { sku: null, images: [], imgIdx: 0, qty: 1 };

window.posOpenProductDetail = function(sku) {
    const p = (typeof masterProducts !== 'undefined' ? masterProducts : []).find(x => x.sku === sku);
    if(!p) { if(typeof showToast==='function') showToast('Produk tak dijumpai', 'warn'); return; }
    const overlay = document.getElementById('posProdDetailOverlay');
    if(!overlay) return;

    // Gather images (jsonb array, fallback to placeholder)
    let images = [];
    if(Array.isArray(p.images)) images = p.images.filter(u => u);
    else if(typeof p.images === 'string') {
        try { const arr = JSON.parse(p.images); if(Array.isArray(arr)) images = arr.filter(u => u); }
        catch(e) { if(p.images.startsWith('http')) images = [p.images]; }
    }
    if(!images.length) images = ['https://placehold.co/600x600?text=No+Image'];

    // Stock breakdown by batch
    const batches = (typeof inventoryBatches !== 'undefined' ? inventoryBatches : []).filter(b => b.sku === sku && b.qty_remaining > 0);
    const totalStock = batches.reduce((s, b) => s + (b.qty_remaining || 0), 0);

    // Variants — siblings with same parent_sku (or guess from SKU prefix)
    let variants = [];
    if(p.parent_sku) {
        variants = (masterProducts || []).filter(x => x.parent_sku === p.parent_sku);
    }
    // Fallback: same first 2-3 SKU segments
    if(variants.length < 2 && p.sku.includes('-')) {
        const parts = p.sku.split('-');
        if(parts.length >= 2) {
            const prefix = parts.slice(0, parts.length - 1).join('-');
            const found = (masterProducts || []).filter(x => x.sku !== p.sku && x.sku.startsWith(prefix + '-'));
            if(found.length > 0) variants = [p, ...found];
        }
    }

    window.__pdState = { sku, images, imgIdx: 0, qty: 1 };

    // Clean product name — strip leading "SKU |" or "CODE _" patterns that pollute the name
    let cleanName = (p.name || 'Untitled');
    // Strip leading "<SKU>| " or "<CODE>_ " prefix (SKU is shown separately)
    cleanName = cleanName.replace(/^[A-Z0-9-]+\s*[|_]\s*/i, '').trim();
    // Collapse multiple separators
    cleanName = cleanName.replace(/\s*[_]\s*/g, ' — ').replace(/\s{2,}/g, ' ').trim();

    // Render
    document.getElementById('pdProdName').textContent = cleanName || (p.name || 'Untitled');
    document.getElementById('pdSku').textContent = 'SKU ' + (p.sku || '—');
    document.getElementById('pdCat').textContent = p.category || 'Uncategorized';
    document.getElementById('pdmBrandText').textContent = p.brand ? 'by ' + p.brand : '';
    document.getElementById('pdPrice').textContent = (typeof formatRM === 'function') ? formatRM(p.price) : 'RM ' + parseFloat(p.price || 0).toFixed(2);

    // Stock pill
    const stockEl = document.getElementById('pdStock');
    if(totalStock <= 0) { stockEl.textContent = 'Out of Stock'; stockEl.className = 'pdm-stock pdm-stock--out'; }
    else if(totalStock <= 5) { stockEl.textContent = totalStock + ' left'; stockEl.className = 'pdm-stock pdm-stock--low'; }
    else { stockEl.textContent = totalStock + ' in stock'; stockEl.className = 'pdm-stock'; }

    // Stock detail (batch breakdown) — only if multiple batches OR has bin
    const stockDetail = document.getElementById('pdStockDetail');
    if(batches.length > 1) {
        stockDetail.textContent = 'Across ' + batches.length + ' batches' + (batches[0].location_bin ? ' · Bin ' + batches[0].location_bin : '');
    } else if(batches.length === 1 && batches[0].location_bin) {
        stockDetail.textContent = 'Bin ' + batches[0].location_bin;
    } else { stockDetail.textContent = ''; }

    // Description — clean up EasyStore artefacts and duplicate "Product name:" lines
    let desc = (p.description || '').toString();
    desc = desc.replace(/\[EASYSTORE-ID:[^\]]+\]\s*/g, '');
    desc = desc.replace(/\[STOK BELUM DISAHKAN[^\]]*\]\s*/g, '');
    // Strip a leading "Product name: ..." line if it duplicates the title
    desc = desc.replace(/^Product name:\s*[^\n]*\n/i, '');
    // Strip leading SKU/CD prefix duplicate ("CHANODUG FX-2104 MID-FAMILY TENT")
    desc = desc.replace(/^[A-Z0-9-]+\s+(MID-)?FAMILY\s+TENT\s*\n/i, '');
    // Clean trailing dashes / multiple blank lines
    desc = desc.replace(/\n{3,}/g, '\n\n').trim();
    document.getElementById('pdDesc').textContent = desc || 'No description available.';

    // Variants
    const varWrap = document.getElementById('pdVariantsWrap');
    const varList = document.getElementById('pdVariants');
    if(variants.length >= 2) {
        varWrap.style.display = '';
        varList.innerHTML = variants.map(v => {
            const vStock = (inventoryBatches || []).filter(b => b.sku === v.sku && b.qty_remaining > 0).reduce((s,b) => s + b.qty_remaining, 0);
            const isCur = v.sku === sku ? 'is-current' : '';
            const isOut = vStock <= 0 ? 'is-out' : '';
            const label = v.variant_size || v.variant_color || v.sku.split('-').pop();
            const skuE = String(v.sku).replace(/'/g, "\\'");
            return `<button class="pdm-variant-pill ${isCur} ${isOut}" ${vStock<=0?'disabled':''} onclick="window.posOpenProductDetail('${skuE}')">${label}${vStock>0?' ('+vStock+')':''}</button>`;
        }).join('');
    } else { varWrap.style.display = 'none'; }

    // Specs
    const specsWrap = document.getElementById('pdSpecsWrap');
    const specsEl = document.getElementById('pdSpecs');
    const specs = [];
    if(p.brand) specs.push(['Brand', p.brand]);
    if(p.weight_kg) specs.push(['Weight', p.weight_kg + ' kg']);
    if(p.dimensions) specs.push(['Dimensions', p.dimensions]);
    if(p.length_cm || p.width_cm || p.height_cm) specs.push(['L×W×H', `${p.length_cm||'?'}×${p.width_cm||'?'}×${p.height_cm||'?'} cm`]);
    if(p.unit) specs.push(['Unit', p.unit]);
    if(p.erp_barcode) specs.push(['Barcode', p.erp_barcode]);
    if(p.location_bin) specs.push(['Bin Location', p.location_bin]);
    if(specs.length > 0) {
        specsWrap.style.display = '';
        specsEl.innerHTML = specs.map(([k,v]) => `<div class="pdm-spec-item"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    } else { specsWrap.style.display = 'none'; }

    // Qty + Add button
    document.getElementById('pdQtyInput').value = '1';
    const addBtn = document.getElementById('pdAddBtn');
    if(totalStock <= 0) {
        addBtn.disabled = true;
        addBtn.innerHTML = '<span>Out of Stock</span>';
    } else {
        addBtn.disabled = false;
        addBtn.innerHTML = '<i data-lucide="shopping-cart" style="width:16px;height:16px;flex-shrink:0;"></i><span>Add to Cart</span>';
    }

    // Render gallery
    window.__pdRenderGallery();

    overlay.style.display = 'flex';
    if(window.lucide && lucide.createIcons) lucide.createIcons();
};

window.__pdRenderGallery = function() {
    const s = window.__pdState;
    const main = document.getElementById('pdMainImg');
    const thumbsEl = document.getElementById('pdThumbs');
    const counter = document.getElementById('pdImgCounter');
    if(!main || !s.images.length) return;
    if(s.imgIdx < 0) s.imgIdx = s.images.length - 1;
    if(s.imgIdx >= s.images.length) s.imgIdx = 0;
    main.src = s.images[s.imgIdx];
    main.alt = (document.getElementById('pdProdName')||{}).textContent || '';
    counter.textContent = (s.imgIdx + 1) + ' / ' + s.images.length;
    // Hide nav if only 1 image
    document.querySelectorAll('.pdm-gallery__nav').forEach(b => b.style.display = s.images.length > 1 ? '' : 'none');
    counter.style.display = s.images.length > 1 ? '' : 'none';
    // Thumbs
    thumbsEl.innerHTML = s.images.map((url, i) =>
        `<div class="pdm-thumb ${i === s.imgIdx ? 'is-active' : ''}" onclick="window.posSetImg(${i})"><img src="${url}" alt="" loading="lazy"></div>`
    ).join('');
    thumbsEl.style.display = s.images.length > 1 ? '' : 'none';
};

window.posSetImg = function(i) { window.__pdState.imgIdx = i; window.__pdRenderGallery(); };
window.posCycleImg = function(delta) { window.__pdState.imgIdx += delta; window.__pdRenderGallery(); };

window.posDetailQty = function(delta) {
    const inp = document.getElementById('pdQtyInput');
    const cur = parseInt(inp.value) || 1;
    const next = Math.max(1, cur + delta);
    inp.value = next;
    window.__pdState.qty = next;
};

window.posDetailAddToCart = function() {
    const sku = window.__pdState.sku;
    if(!sku) return;
    const qty = Math.max(1, parseInt(document.getElementById('pdQtyInput').value) || 1);
    for(let i = 0; i < qty; i++) {
        if(typeof window.addToCart === 'function') window.addToCart(sku);
    }
    window.posCloseProductDetail();
    if(typeof showToast === 'function') {
        const p = masterProducts.find(x => x.sku === sku);
        showToast((p ? p.name : sku) + ' (×' + qty + ') added to cart', 'success');
    }
};

window.posCloseProductDetail = function() {
    const overlay = document.getElementById('posProdDetailOverlay');
    if(overlay) overlay.style.display = 'none';
    window.__pdState = { sku: null, images: [], imgIdx: 0, qty: 1 };
};

// Keyboard nav
document.addEventListener('keydown', function(e) {
    const overlay = document.getElementById('posProdDetailOverlay');
    if(!overlay || overlay.style.display === 'none') return;
    if(e.key === 'Escape') { window.posCloseProductDetail(); }
    else if(e.key === 'ArrowLeft' && window.__pdState.images.length > 1) { window.posCycleImg(-1); }
    else if(e.key === 'ArrowRight' && window.__pdState.images.length > 1) { window.posCycleImg(1); }
});

window.addToCart = function(sku) {
 const p = masterProducts.find(x => x.sku === sku);
 const totalAvail = inventoryBatches.filter(b => b.sku === sku && b.qty_remaining> 0).reduce((s, b) => s + b.qty_remaining, 0);
 const cartItem = cart.find(c => c.sku === sku);
 
 if(cartItem) { if (cartItem.quantity < totalAvail) cartItem.quantity++; else (typeof showToast==='function'?showToast('Stok tak cukup','warning'):alert('Limits reached!')); }
 else { if (totalAvail> 0) cart.push({ sku: sku, name: p.name, price: parseFloat(p.price), quantity: 1 }); }
 renderCart();
}

window.decreaseQuantity = function(sku) {
 const c = cart.find(x => x.sku === sku);
 if(c) { if(c.quantity> 1) c.quantity--; else cart = cart.filter(x => x.sku !== sku); }
 renderCart();
}
window.removeFromCart = function(sku) { cart = cart.filter(c => c.sku !== sku); renderCart(); }

function renderCart() {
 const container = document.getElementById("cartItems");
 const label = document.getElementById("totalPrice");
 const subLabel = document.getElementById("cartSubtotalVal");
 const btnPay = document.getElementById("btnOpenPayment");
 if(!container) return; container.innerHTML = ""; let total = 0; let totalItems = 0;
 
 // safe update helper for mobile bar
 const updateMobileBar = (t, i) => {
 const tEl = document.getElementById("mobileCartTotal");
 const iEl = document.getElementById("mobileCartItemCount");
 if(tEl) tEl.textContent = t.toFixed(2);
 if(iEl) iEl.textContent = i.toString();
 };

 if(cart.length === 0) { 
 container.innerHTML = "<p class='empty-cart-message'>Tiada barang di-scan.</p>"; 
 label.textContent = "0.00";
 if(subLabel) subLabel.textContent = "0.00";
 if(btnPay) btnPay.disabled = true;
 updateMobileBar(0, 0);
 return; 
 }

 cart.forEach(item => {
 total = round2(total + item.price * item.quantity);
 totalItems += item.quantity;
 container.innerHTML += `
 <div class="cart-item">
 <div style="flex:1;"><strong style="font-size:13px; color:#111;">[${item.sku}] ${item.name}</strong><br><small style="color:#666;">RM${item.price.toFixed(2)} x ${item.quantity}</small></div>
 <div style="display:flex; gap:8px; align-items:center;">
 <button onclick="decreaseQuantity('${item.sku}')" style="background:#eee; border:none; width:25px; height:25px; border-radius:5px; font-weight:bold;">-</button>
 <span style="font-weight:bold;">${item.quantity}</span>
 <button onclick="addToCart('${item.sku}')" style="background:#eee; border:none; width:25px; height:25px; border-radius:5px; font-weight:bold;">+</button>
 <button onclick="removeFromCart('${item.sku}')" style="color:#EF4444; background:#fee2e2; border:none; width:25px; height:25px; border-radius:5px; font-weight:bold; margin-left:5px;">X</button>
 </div>
 </div>`;
 });
 label.textContent = total.toFixed(2);
 if(subLabel) subLabel.textContent = total.toFixed(2);
 if(btnPay) btnPay.disabled = false;
 updateMobileBar(total, totalItems);
 // p4_7 Customer-facing display: broadcast cart for second screen
 if(typeof writeCustomerDisplayCart === 'function') writeCustomerDisplayCart();
}

// p4_7 Customer-facing display sync
window.writeCustomerDisplayCart = function() {
 try {
 const payload = {
 items: cart,
 vip: window.__currentCheckoutVip || null,
 updatedAt: new Date().toISOString()
 };
 localStorage.setItem('customerDisplayCart_v1', JSON.stringify(payload));
 } catch(e) {}
};

window.openCustomerDisplay = function() {
 const win = window.open('customer-display.html', '_blank',
 'width=1024,height=768,menubar=no,toolbar=no,location=no');
 if(!win) showToast('Pop-up blocked. Allow pop-ups for this site.', 'warn');
 else showToast('Customer display opened — drag to second screen', 'success');
};

// Payment Modal Logics
window.openPaymentModal = function() {
 if(cart.length === 0) return;
 let total = round2(cart.reduce((sum, c) => sum + (c.price * c.quantity), 0));
 document.getElementById('paymentTotalDisplay').textContent = total.toFixed(2);
 document.getElementById('checkoutPaymentModal').style.display = 'flex';
 // Reset VIP state from any previous session
 window.__currentCheckoutVip = null;
 const vb = document.getElementById('checkoutVipBadge'); if(vb) vb.style.display = 'none';
 const vl = document.getElementById('checkoutVipDiscountLine'); if(vl) vl.remove();
 // Auto-lookup if customer name/phone already filled
 if(typeof checkoutVipLookup === 'function') checkoutVipLookup();
}

window.setPaymentMethod = function(method, btnElement) {
 document.getElementById('paymentMethod').value = method;
 let btns = document.querySelectorAll('#checkoutPaymentModal.pay-btn');
 btns.forEach(b => {
 b.classList.remove('active');
 b.style.border = "1px solid var(--border-color)";
 b.style.background = "#FFF";
 b.style.color = "var(--text-muted)";
 });
 btnElement.classList.add('active');
 btnElement.style.border = "2px solid var(--primary)";
 btnElement.style.background = "#FFF5eb";
 btnElement.style.color = "var(--text-main)";

 // E-Wallet sub-panel: show & populate dropdown of enabled wallets
 const sub = document.getElementById('ewalletSubPanel');
 if (sub) {
 if (method === 'E-Wallet') {
 sub.style.display = 'block';
 const sel = document.getElementById('ewalletProvider');
 const emptyMsg = document.getElementById('ewalletEmptyMsg');
 if (sel) {
 let settings = {};
 try { settings = JSON.parse(localStorage.getItem('complianceSettings_v1')) || {}; } catch(e){}
 const ew = (settings && settings.ewallet) || {};
 const wallets = [
 { id:'tng', name:'Touch \'n Go eWallet', refPattern: /^\d{16,20}$/, refHint:'16-20 digit' },
 { id:'boost', name:'Boost', refPattern: /^[A-Za-z0-9]{8,}$/, refHint:'min 8 alphanumeric' },
 { id:'grabpay', name:'GrabPay', refPattern: /^[A-Z0-9]{10,}$/i, refHint:'min 10 alphanumeric' },
 { id:'shopeepay', name:'ShopeePay', refPattern: /^[A-Z0-9-]{10,}$/i, refHint:'min 10 alphanumeric' },
 { id:'mae', name:'MAE by Maybank', refPattern: /^\d{6,}$/, refHint:'min 6 digit' }
];
 const enabled = wallets.filter(w => ew[w.id] && ew[w.id].enabled);
 if (enabled.length === 0) {
 // B12: show empty state instead of fallback
 sel.innerHTML = '<option value="">— Configure e-wallets dulu di Compliance —</option>';
 sel.disabled = true;
 if (emptyMsg) emptyMsg.style.display = 'block';
 window.__ewalletPatterns = {};
 } else {
 sel.disabled = false;
 if (emptyMsg) emptyMsg.style.display = 'none';
 sel.innerHTML = '<option value="">— Pilih e-wallet —</option>'
 + enabled.map(w => '<option value="'+w.name+'" data-pattern="'+w.refPattern.source+'" data-hint="'+w.refHint+'">'+w.name+'</option>').join('');
 // Stash patterns for validation in checkout
 window.__ewalletPatterns = {};
 enabled.forEach(w => { window.__ewalletPatterns[w.name] = { pattern: w.refPattern, hint: w.refHint }; });
 }
 }
 const ref = document.getElementById('ewalletRef'); if (ref) ref.value = '';
 } else {
 sub.style.display = 'none';
 }
 }
}

window.clearCart = function() {
 cart = [];
 renderCart();
}

window.processNewCheckout = async function() {
 if(cart.length === 0) { if (typeof showToast==='function') showToast('Troli kosong — scan barang dulu','warning'); else alert('Empty Cart!'); return; }
 const btn = document.getElementById("checkoutBtn");
 btn.disabled = true; 
 btn.textContent = "Processing Omnichannel FIFO...";

 try {
 let transactionsPayload = []; let totalVal = 0;
 const cn = document.getElementById("checkoutChannel").value;
 const cst = document.getElementById("checkoutStatus").value;
 let pm = document.getElementById("paymentMethod").value;
 const custNameText = document.getElementById("customerName").value.trim() || 'Walk-In';
 const custPhoneText = document.getElementById("customerPhone").value.trim();

 // E-Wallet manual-confirm: require provider + ref number with format validation (B11)
 let ewalletRef = null, ewalletProvider = null;
 if (pm === 'E-Wallet') {
 ewalletProvider = document.getElementById("ewalletProvider").value;
 ewalletRef = document.getElementById("ewalletRef").value.trim();
 const fail = (msg) => {
 btn.disabled=false; btn.textContent="PENGESAHAN BAYARAN";
 if (typeof showToast === 'function') showToast(msg, 'error'); else alert(msg);
 };
 if (!ewalletProvider) { fail('Pilih e-wallet provider.'); return; }
 if (!ewalletRef) { fail('Ref # dari customer\'s confirmation screen wajib.'); return; }
 const patterns = window.__ewalletPatterns || {};
 const meta = patterns[ewalletProvider];
 if (meta && !meta.pattern.test(ewalletRef)) { fail('Ref # format tak match '+ewalletProvider+' ('+meta.hint+'). Verify dengan customer.'); return; }
 pm = ewalletProvider + ' (Ref: ' + ewalletRef + ')';
 }
 // B14: optional buyer TIN for e-Invoice
 const buyerTin = (document.getElementById("customerBuyerTin")?.value || '').trim();

 for (const item of cart) {
 totalVal = round2(totalVal + item.price * item.quantity);
 let needed = item.quantity;
 let batches = inventoryBatches.filter(b => b.sku===item.sku && b.qty_remaining>0).sort((a,b) => new Date(a.inbound_date) - new Date(b.inbound_date));
 // Track exact batch allocation per item (B7 perfect fix — refund can restock to same batches)
 item.batch_alloc = [];
 for (let batch of batches) {
 if (needed <= 0) break;
 let deduct = Math.min(needed, batch.qty_remaining);
 needed -= deduct;
 await db.from('inventory_batches').update({qty_remaining: batch.qty_remaining - deduct}).eq('id', batch.id);
 transactionsPayload.push({sku: item.sku, batch_id: batch.id, transaction_type: 'OUTBOUND_SALE', qty_change: -deduct});
 item.batch_alloc.push({ batch_id: batch.id, qty: deduct });
 }
 }

 if(transactionsPayload.length> 0) await db.from('inventory_transactions').insert(transactionsPayload);

 // Points & CRM System
 const earnedPoints = Math.floor(totalVal);
 if(custNameText !== 'Walk-In') {
 const existing = customersData.find(c => c.name.toLowerCase() === custNameText.toLowerCase() || (c.phone === custPhoneText && custPhoneText !== ''));
 if(!existing) {
 await db.from('customers').insert([{name: custNameText, phone: custPhoneText, points: earnedPoints}]);
 } else {
 await db.from('customers').update({points: (existing.points || 0) + earnedPoints, phone: custPhoneText || existing.phone}).eq('id', existing.id);
 }
 }

 // VIP auto-discount: apply if window.__currentCheckoutVip is set
 let vipDiscountAmt = 0;
 let finalTotal = totalVal;
 const vip = window.__currentCheckoutVip;
 if(vip && vip.discount_pct> 0) {
 vipDiscountAmt = round2(totalVal * vip.discount_pct / 100);
 finalTotal = round2(totalVal - vipDiscountAmt);
 }

 const saleMeta = {};
 if(ewalletProvider) {
 saleMeta.ewallet_provider = ewalletProvider;
 saleMeta.ewallet_ref = ewalletRef;
 }
 if(vip) {
 saleMeta.vip_discount_applied = true;
 saleMeta.vip_discount_pct = vip.discount_pct;
 saleMeta.vip_discount_amount = vipDiscountAmt;
 saleMeta.vip_subtotal_before_discount = totalVal;
 saleMeta.vip_customer_id = vip.customer_id;
 }

 await db.from('sales_history').insert([{
 customer_name: custNameText, customer_phone: custPhoneText, payment_method: pm, channel: cn, status: cst,
 total: finalTotal, total_amount: finalTotal, items: cart,
 staff_name: currentUser ? currentUser.name : 'Unknown',
 buyer_tin: buyerTin || null,
 metadata: Object.keys(saleMeta).length ? saleMeta : null
 }]);
 // Use finalTotal downstream
 totalVal = finalTotal;
 // p1_29: Push inventory deduction to EasyStore (best-effort, async, non-blocking)
 if(typeof window.easystorePushSale === 'function') {
   const pushItems = cart.map(c => ({ sku: c.sku, qty: parseInt(c.quantity) || 0 })).filter(x => x.qty > 0);
   if(pushItems.length) window.easystorePushSale(pushItems, 'subtract');
 }

 const invId = "INV-10C-" + Math.floor(1000 + Math.random() * 9000);
 const email = document.getElementById("customerEmail").value.trim();
 showReceiptModal(invId, custNameText, email, totalVal, [...cart]);

 cart = [];
 document.getElementById("customerName").value = "";
 document.getElementById("customerPhone").value = "";
 document.getElementById("customerEmail").value = "";
 const tinEl = document.getElementById("customerBuyerTin"); if (tinEl) tinEl.value = "";
 const ewRefEl = document.getElementById("ewalletRef"); if (ewRefEl) ewRefEl.value = "";
 const ewProvEl = document.getElementById("ewalletProvider"); if (ewProvEl) ewProvEl.value = "";
 const ewSub = document.getElementById("ewalletSubPanel"); if (ewSub) ewSub.style.display = "none";
 document.getElementById('checkoutPaymentModal').style.display = 'none';
 await initApp(); 
 renderCart();
 } catch (e) { console.error(e); if (typeof showToast==='function') showToast('Fatal Error: ' + e.message, 'error'); else alert('Fatal Error: ' + e.message); }
 
 if(btn) { btn.disabled = false; btn.textContent = "PENGESAHAN BAYARAN"; }
}

window.dispatchEmailReceipt = function() {
 const emailStr = document.getElementById('customerEmail')?.value;
 const btn = document.getElementById('sendEmailBtn');
 
 if(!emailStr) {
 alert("Sila isikan alamat e-mel pelanggan terlebih dahulu!");
 return;
 }
 
 // Dummy EmailJS integration implementation for Phase 1
 btn.innerHTML = "Menghantar...";
 btn.disabled = true;
 
 setTimeout(() => {
 btn.innerHTML = " Berjaya Dihantar!";
 btn.style.background = "var(--success)";
 alert("E-Resit berjaya diviralkan ke: " + emailStr + "\\n(Nota Fasa 1: E-Mel dihantar menerusi mock-service. EmailJS sedia disambungkan!).");
 }, 1500);
}

// ===================================
// CUSTOMERS CRM TABLE & HISTORY
// ===================================
window.viewCustomerHistory = function(cName) {
 const hist = salesHistory.filter(s => s.customer_name === cName);
 const container = document.getElementById("staffHistoryContent");
 document.getElementById("staffHistoryCustName").textContent = `Pelanggan: ${cName} (Keseluruhan: ${hist.length} Rekod)`;
 
 if(hist.length === 0) {
 container.innerHTML = '<p style="text-align:center; color:var(--text-muted); margin-top:20px;">Tiada rekod pembelian dijumpai untuk pelanggan ini.</p>';
 } else {
 container.innerHTML = hist.map(h => `
 <div style="background:#FFF; padding:15px; border-radius:8px; border:1px solid var(--border-color); margin-bottom:10px;">
 <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
 <strong style="font-size:14px;">${new Date(h.created_at).toLocaleString('en-GB')}</strong>
 <span style="font-weight:bold; color:var(--primary);">RM ${parseFloat(h.total || 0).toFixed(2)}</span>
 </div>
 <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
 Channel: ${h.channel} | Kaedah: ${h.payment_method}
 </div>
 <div style="font-size:12px; border-top:1px dashed #eee; padding-top:8px;">
 ${(h.items || []).map(i => `${i.quantity}x ${i.name}`).join('<br>')}
 </div>
 </div>
 `).join('');
 }
 document.getElementById("staffCustomerHistoryModal").style.display = "flex";
};

function renderCustomers() {
 // Delegate to v2 if it exists (post Shopify migration enrichment)
 if(typeof renderCustomersV2 === 'function') return renderCustomersV2();
 // Fallback: old shape
 const tbody = document.getElementById("customersTableBody");
 if(!tbody) return;
 tbody.innerHTML = '<tr><td colspan="9">Loading...</td></tr>';
}

// ===================================
// PROMOTIONS TABLE
// ===================================
function renderPromotions() {
 const tbody = document.getElementById("promotionsTableBody");
 if(!tbody) return;
 tbody.innerHTML = "";
 db.from('promotions').select('*').then(({data}) => {
 if(!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="4">Tiada promosi aktif.</td></tr>'; return; }
 data.forEach(p => {
 tbody.innerHTML += `<tr>
 <td><strong>${p.code}</strong></td>
 <td>${p.discount_type}</td>
 <td style="font-weight:bold;">${p.discount_type === 'percent' ? p.discount_value + '%' : 'RM' + parseFloat(p.discount_value).toFixed(2)}</td>
 <td>${p.active ? '<span style="color:#10B981; font-weight:bold;">Active </span>' : '<span style="color:#EF4444;">Inactive</span>'}</td>
 </tr>`;
 });
 });
}

// ===================================
// AUTHENTICATION LOGIC (MULTI-USER)
// ===================================

// Salt format: <staff_id>:<pin>:10camp_salt_v1, SHA-256 hex
async function hashPin(staffId, pin) {
 const text = `${staffId}:${pin}:10camp_salt_v1`;
 const buf = new TextEncoder().encode(text);
 const hashBuf = await crypto.subtle.digest('SHA-256', buf);
 return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const authUsers = [
 { name: 'brozaidtodak', role: 'superior', pin_hash: '50d1e0682d0e472acc6a9dc109911c4703ddb14ebfa90c3b051f541111626343', dept: 'Managing Director', email: 'zaid@10camp.com', staff_id: 'CMP001', full_name: 'Muhammad Zaid Ariffuddin Bin Zainal Ariffin', join_date: '2020-02-03' },
 { name: 'Aliff', role: 'mgmt', pin_hash: '33ffc079d45afe132295ee5e09980e872c3be2334df23aeb1ee52d0c7c9cfcec', dept: 'Administrative Department', email: 'aliff@10camp.com', staff_id: 'CMP008', full_name: 'Muhammad Aliff Ashraf Bin Johar', join_date: '2024-07-01' },
 { name: 'Farhan Moyy', role: 'mgmt', pin_hash: 'bed579f196a5bbb1ffbf1ba2b3c9bdd754a28680861ce96103794e25527d914e', dept: 'Business Development Department', email: 'farhanwakiman@10camp.com', staff_id: 'CMP010', full_name: 'Mohamad Farhan Bin Wakiman', join_date: '2025-09-01' },
 { name: 'Zack', role: 'mgmt', pin_hash: 'e5f99d4a4886603bb5c9dd78b4c529ee3657dcf6818a93aff697f7436eef36ca', dept: 'System Manager Department', email: 'zack@10camp.com', staff_id: 'CMP005', full_name: 'Muhammad Nur Zakwan Bin Md Mahalli', join_date: '2024-07-01' },
 { name: 'Ariff', role: 'sales', pin_hash: '3392222a8b235180e57307768e7f2200e8ca4ae32ea6cd065572d22f5a7923d7', dept: 'Sales & Product Department', email: 'ariff@10camp.com', staff_id: 'CMP006', full_name: 'Muhammad Zaimuddin Ariff Bin Zainal Ariffin', join_date: '2024-07-01' },
 { name: 'Irfan', role: 'sales', pin_hash: '1ac46628226b2db70ab61adf7e7912aa6456b7c703c1b922a9a5bba78d16396c', dept: 'Marketing Interim', email: 'irfan@10camp.com', staff_id: 'CMP003', full_name: 'Muhammad Irfansyah Bin Abd Fattah', join_date: '2024-07-01' },
 { name: 'Tarmizi Kael', role: 'inventory', pin_hash: '4c3c39d9b9cd41540b359ffed45b97d5b76b04a6461d1cdedb79eb4003727779', dept: 'Chief Inventory', email: 'tarmizi@10camp.com', staff_id: 'CMP011', full_name: 'Tarmizi bin Rusli', join_date: '2025-08-11' },
 { name: 'Fahmi', role: 'inventory', pin_hash: '1eeab06ad295d2d41259419cb3a5d1d914ddd9c9e70c66e658042341986c91de', dept: 'Inventory Assistance', email: 'fahmi@10camp.com', staff_id: 'CMP009', full_name: 'Shahrul Fahmi Bin Ramlee', join_date: '2024-07-01' },
 // p1_21: Investor persona — 51% majority shareholder
 { name: 'brolantodak', role: 'investor', pin_hash: '585790e32d7ab7bf6262dbb9bfec4f4d6831638364f429d25d03090c724e3822', dept: 'Investor (51% Equity)', email: 'investor@10camp.com', staff_id: 'INV001', full_name: 'Brolantodak (Majority Shareholder)', join_date: '2024-01-01' },
// Additional staff
 { name: 'Adam Faisal', role: 'sales', pin_hash: '439ec1dbe8edfbb3168a53292dbebbf916b3b64987256b8580bf1eaed71e6dfc', dept: 'Sales Department', email: 'adam.f@10camp.com', staff_id: 'CMP012', full_name: 'Adam Faisal Bin Yusoff', join_date: '2024-08-15' },
 { name: 'Hakim Ridzuan', role: 'inventory', pin_hash: '9f0043f2a7743022d7118a018fac6120d24021bf78a5a845ac9797ab673b05b2', dept: 'Inventory Assistance', email: 'hakim.r@10camp.com', staff_id: 'CMP013', full_name: 'Hakim Ridzuan Bin Ramli', join_date: '2024-09-20' },
 { name: 'Daniel Aiman', role: 'sales', pin_hash: '7e57db05dfec7a2d6ccdc7caca29200b74623a8388dc501dee522f77b5591605', dept: 'Customer Service', email: 'daniel.a@10camp.com', staff_id: 'CMP014', full_name: 'Daniel Aiman Bin Mokhtar', join_date: '2024-10-05' },
 { name: 'Nazri Hakimi', role: 'sales', pin_hash: '442a831baf98bdb46de2a9aa7325bbcb6ca9da0adecbfb26c2723bff70395c9e', dept: 'Marketing Interim', email: 'nazri.h@10camp.com', staff_id: 'CMP015', full_name: 'Mohamad Nazri Hakimi', join_date: '2024-11-22' },
 { name: 'Tester', role: 'sales', pin_hash: '0992063d103f60eaac866479931a0a052aea264d4c761ceb643fdda2b4c322ef', dept: 'External Demo Account', email: 'tester@10camp.com', staff_id: 'TST001', full_name: 'External QA Tester', join_date: '2026-05-07' },
 { name: 'Syafiq Iskandar', role: 'inventory', pin_hash: '3137eb1ebb393a5ceceb327d62b178c2ecc7b65d6b80faad13d79238ed20823d', dept: 'Logistics Coordinator', email: 'syafiq.i@10camp.com', staff_id: 'CMP016', full_name: 'Syafiq Iskandar Bin Mahmud', join_date: '2025-01-10' }
];

// p1_21: Pre-seed mode access overlay for investor — only investor mode (lock down all others)
(function __seedInvestorAccess(){
 try {
 const overlay = JSON.parse(localStorage.getItem('staffModeAccess_v1') || '{}');
 if(!overlay['INV001']) {
 overlay['INV001'] = { cashier: false, operations: false, manager: false, management: false, investor: true };
 localStorage.setItem('staffModeAccess_v1', JSON.stringify(overlay));
 }
 } catch(e){}
})();


let currentUser = null;
let currentUserRole = null;
let currentPublicCustomer = null;

window.handleCustomerLogin = async function() {
 const phone = document.getElementById("customerLoginPhone").value.trim();
 if(!phone) return alert("Sila masukkan nombor telefon yang sah.");
 
 // Check if customer exists in current customersData
 let existing = customersData.find(c => c.phone === phone);
 
 if(!existing) {
 // Pseudo-registration: create a new skeleton record without name to force them to fill their name at checkout
 const newCustomerObj = { name: "Pelanggan VIP", phone: phone, points: 0, address: "" };
 try {
 const { data } = await db.from('customers').insert([newCustomerObj]).select();
 if(data) {
 existing = data[0];
 customersData.push(existing);
 } else {
 existing = newCustomerObj; // Fallback
 }
 } catch(e) {
 existing = newCustomerObj; 
 }
 }
 
 currentPublicCustomer = existing;
 document.getElementById("customerLoginGate").style.display = "none";
 
 const btn = document.getElementById("btnCustomerPortal");
 if(btn) {
 btn.textContent = `Hi, ${existing.name.split(' ')[0]} (Pts: ${existing.points || 0})`;
 }
 
 if (typeof showToast==='function') showToast(`Berjaya Log Masuk · ${existing.points || 0} Points`, 'success'); else alert(`Berjaya Log Masuk. Anda kini mempunyai ${existing.points || 0} Points.`);
};

// Open the PIN login overlay; populate the staff dropdown (active only).
function handleLogin() {
 const overlay = document.getElementById('pinLoginOverlay');
 if(!overlay) { console.error('pinLoginOverlay not found in DOM'); return; }
 const pinInput = document.getElementById('pinLoginInput');
 if(pinInput) pinInput.value = '';
 const errEl = document.getElementById('pinLoginError');
 if(errEl) { errEl.textContent = ''; errEl.style.color = ''; }
 if(typeof window.__pinUpdateDots === 'function') window.__pinUpdateDots('');
 overlay.style.display = 'flex';
 // Show global lockout msg if device is locked
 const gl = __pinGetGlobalLockout();
 if(gl.lockedUntil && gl.lockedUntil> Date.now()) {
 const mins = Math.ceil((gl.lockedUntil - Date.now()) / 60000);
 if(errEl) { errEl.textContent = `Device dikunci. Cuba semula dalam ~${mins} minit.`; errEl.style.color = '#dc2626'; }
 }
 setTimeout(() => { if(pinInput) pinInput.focus(); }, 50);
}

// Per-staff lockout: 5 wrong attempts -> locked for 5 minutes.
const PIN_LOCKOUT_KEY = 'pinLockout_v1';
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 5 * 60 * 1000;
// Global device lockout (p1_22): 10 wrong PIN attempts in 5 min → lock device 5 min
const PIN_GLOBAL_KEY = 'pinGlobalLockout_v1';
const PIN_GLOBAL_MAX = 10;
const PIN_GLOBAL_WINDOW = 5 * 60 * 1000;

function getPinLockoutState() {
 try { return JSON.parse(localStorage.getItem(PIN_LOCKOUT_KEY) || '{}'); }
 catch(e) { return {}; }
}
function setPinLockoutState(state) {
 localStorage.setItem(PIN_LOCKOUT_KEY, JSON.stringify(state));
}
function __pinGetGlobalLockout() {
 try { return JSON.parse(localStorage.getItem(PIN_GLOBAL_KEY) || '{}'); }
 catch(e) { return {}; }
}
function __pinSetGlobalLockout(s) {
 try { localStorage.setItem(PIN_GLOBAL_KEY, JSON.stringify(s)); } catch(e){}
}
function __pinIncrementGlobal() {
 const now = Date.now();
 const gl = __pinGetGlobalLockout();
 // Reset window if expired
 if(!gl.windowStart || (now - gl.windowStart)> PIN_GLOBAL_WINDOW) {
 gl.windowStart = now; gl.attempts = 0;
 }
 gl.attempts = (gl.attempts || 0) + 1;
 if(gl.attempts>= PIN_GLOBAL_MAX) {
 gl.lockedUntil = now + PIN_LOCKOUT_MS;
 gl.attempts = 0;
 gl.windowStart = now;
 }
 __pinSetGlobalLockout(gl);
 return gl;
}
function __pinClearGlobal() {
 localStorage.removeItem(PIN_GLOBAL_KEY);
}
function refreshPinLockoutMsg() {
 // Legacy stub — kept so old callers don't crash.
}

window.handleLogin = handleLogin;
window.refreshPinLockoutMsg = refreshPinLockoutMsg;

// p1_22: Detect user by PIN alone (iterate all active staff, compute hash, match)
window.__detectUserByPin = async function(pin) {
 if(!/^\d{4,8}$/.test(pin)) return null;
 let inactive = [];
 try { inactive = JSON.parse(localStorage.getItem('staffInactive_v1') || '[]'); } catch(e){}
 const candidates = (typeof authUsers !== 'undefined' ? authUsers : []).filter(u => !inactive.includes(u.staff_id));
 for(const u of candidates) {
 try {
 const h = await hashPin(u.staff_id, pin);
 if(h === u.pin_hash) return u;
 } catch(e) {}
 }
 return null;
};

// PIN dots visual feedback
window.__pinUpdateDots = function(value) {
 const dots = document.querySelectorAll('#pinDotsDisplay.pin-dot');
 const len = (value || '').length;
 dots.forEach((d, i) => d.classList.toggle('is-filled', i < len));
};

// Auto-submit when PIN reaches typical length (4-6 digits)
let __pinAutoSubmitTimer = null;
window.__pinAutoSubmit = function(value) {
 clearTimeout(__pinAutoSubmitTimer);
 if(value.length < 4) return;
 // Debounce: wait 400ms after last keystroke (so 5/6-digit PINs aren't cut short)
 __pinAutoSubmitTimer = setTimeout(() => {
 const cur = (document.getElementById('pinLoginInput')||{}).value || '';
 if(cur.length>= 4) window.submitPinLogin();
 }, 400);
};

window.submitPinLogin = async function() {
 const pinInput = document.getElementById('pinLoginInput');
 const errEl = document.getElementById('pinLoginError');
 if(!pinInput || !errEl) return;
 const pin = (pinInput.value || '').trim();
 if(!/^\d{4,8}$/.test(pin)) { errEl.textContent = 'PIN mesti 4-8 digit nombor.'; errEl.style.color = '#dc2626'; return; }

 // Global device lockout check
 const gl = __pinGetGlobalLockout();
 if(gl.lockedUntil && gl.lockedUntil> Date.now()) {
 const mins = Math.ceil((gl.lockedUntil - Date.now()) / 60000);
 errEl.textContent = `Device dikunci. Cuba semula dalam ~${mins} minit.`;
 errEl.style.color = '#dc2626';
 return;
 }

 // Detect user
 const user = await window.__detectUserByPin(pin);
 if(!user) {
 const updated = __pinIncrementGlobal();
 const left = PIN_GLOBAL_MAX - (updated.attempts || 0);
 if(updated.lockedUntil && updated.lockedUntil> Date.now()) {
 errEl.textContent = `Terlalu banyak cubaan salah. Device dikunci 5 minit.`;
 } else {
 errEl.textContent = `PIN salah. Cubaan tinggal: ${left}`;
 }
 errEl.style.color = '#dc2626';
 pinInput.value = ''; window.__pinUpdateDots('');
 pinInput.focus();
 return;
 }

 // Per-staff lockout check (existing — independent from global)
 const state = getPinLockoutState();
 const rec = state[user.staff_id] || { attempts: 0, lockedUntil: 0 };
 if(rec.lockedUntil && rec.lockedUntil> Date.now()) {
 const mins = Math.ceil((rec.lockedUntil - Date.now()) / 60000);
 errEl.textContent = `Akaun terkunci. Cuba semula dalam ~${mins} minit.`;
 errEl.style.color = '#dc2626';
 pinInput.value = ''; window.__pinUpdateDots('');
 return;
 }

 // Success — clear lockouts, close overlay, boot session
 delete state[user.staff_id];
 setPinLockoutState(state);
 __pinClearGlobal();
 pinInput.value = ''; window.__pinUpdateDots('');
 const overlay = document.getElementById('pinLoginOverlay');
 if(overlay) overlay.style.display = 'none';
 loginAs(user);
};

// Onboarding wizard state — first-run setup for superior on fresh install.
const ONBOARDING_KEY = 'onboardingCompleted_v1';
let __obwStep = 1;
const __obwTotalSteps = 4;

function obwShowStep(n) {
 __obwStep = Math.max(1, Math.min(__obwTotalSteps, n));
 document.querySelectorAll('#onboardingOverlay.obw-step').forEach(el => {
 el.style.display = (parseInt(el.getAttribute('data-step')) === __obwStep) ? 'block' : 'none';
 });
 const stepNumEl = document.getElementById('obwStepNum'); if (stepNumEl) stepNumEl.textContent = __obwStep;
 const prog = document.getElementById('obwProgress'); if (prog) prog.style.width = (__obwStep * 100 / __obwTotalSteps) + '%';
 const back = document.getElementById('obwBackBtn'); if (back) back.style.display = (__obwStep === 1) ? 'none' : 'block';
 const next = document.getElementById('obwNextBtn'); if (next) next.textContent = (__obwStep === __obwTotalSteps) ? ' Finish' : 'Next →';
 const err = document.getElementById('obwError'); if (err) err.textContent = '';
}

window.__obwBack = function() { obwShowStep(__obwStep - 1); };

window.__obwSkip = function() {
 if (!confirm('Skip semua wizard? Boleh setup manual lepas ni di Compliance section.')) return;
 localStorage.setItem(ONBOARDING_KEY, 'skipped');
 document.getElementById('onboardingOverlay').style.display = 'none';
};

window.__obwNext = async function() {
 const errEl = document.getElementById('obwError');
 if (errEl) errEl.textContent = '';

 // Step 1: validate + save shop info
 if (__obwStep === 1) {
 const name = document.getElementById('obwShopName').value.trim();
 if (!name) { if(errEl) errEl.textContent = 'Nama kedai wajib.'; return; }
 let s = {};
 try { s = JSON.parse(localStorage.getItem('complianceSettings_v1')) || {}; } catch(e){}
 s.shop = Object.assign({}, s.shop || {}, {
 name,
 phone: document.getElementById('obwShopPhone').value.trim(),
 email: document.getElementById('obwShopEmail').value.trim(),
 address: document.getElementById('obwShopAddress').value.trim(),
 footer: 'THANK YOU FOR SHOPPING AT ' + name.toUpperCase()
 });
 localStorage.setItem('complianceSettings_v1', JSON.stringify(s));
 }

 // Step 2: SST
 if (__obwStep === 2) {
 const reg = document.getElementById('obwSstRegistered').checked;
 let s = {};
 try { s = JSON.parse(localStorage.getItem('complianceSettings_v1')) || {}; } catch(e){}
 s.sst = {
 registered: reg,
 number: reg ? document.getElementById('obwSstNumber').value.trim() : '',
 rate: parseFloat(document.getElementById('obwSstRate').value) || 6,
 inclusive: document.getElementById('obwSstInclusive').checked
 };
 localStorage.setItem('complianceSettings_v1', JSON.stringify(s));
 }

 // Step 3: optional sample product
 if (__obwStep === 3) {
 const sku = document.getElementById('obwProdSku').value.trim();
 const pName = document.getElementById('obwProdName').value.trim();
 const pPrice = parseFloat(document.getElementById('obwProdPrice').value);
 const pQty = parseInt(document.getElementById('obwProdQty').value);
 if (sku || pName || !isNaN(pPrice) || !isNaN(pQty)) {
 // User filled at least one field — require all
 if (!sku || !pName || isNaN(pPrice) || isNaN(pQty)) {
 if(errEl) errEl.textContent = 'Isi SEMUA field, atau kosongkan SEMUA untuk skip step ni.';
 return;
 }
 try {
 if (typeof db !== 'undefined' && db) {
 const { error: e1 } = await db.from('products_master').insert([{ sku, name: pName, price: pPrice, is_published: true }]);
 if (e1 && !String(e1.message||'').toLowerCase().includes('duplicate')) throw e1;
 const { error: e2 } = await db.from('inventory_batches').insert([{ sku, qty_remaining: pQty, qty_initial: pQty, inbound_date: new Date().toISOString().slice(0,10), cost_price: pPrice * 0.6 }]);
 if (e2) console.warn('[obw] batch insert warn:', e2);
 }
 } catch(e) {
 console.error('[obw] sample insert failed:', e);
 if(errEl) errEl.textContent = 'Gagal save produk: '+(e.message||e);
 return;
 }
 }
 }

 // Step 4: finish
 if (__obwStep === __obwTotalSteps) {
 localStorage.setItem(ONBOARDING_KEY, 'completed');
 document.getElementById('onboardingOverlay').style.display = 'none';
 if (typeof showToast === 'function') showToast('Setup siap. Selamat berniaga!', 'success');
 if (typeof initApp === 'function') { try { await initApp(); } catch(e){} }
 if (typeof renderCompliancePanel === 'function') renderCompliancePanel();
 return;
 }

 obwShowStep(__obwStep + 1);
};

function maybeShowOnboarding(user) {
 if (!user || user.role !== 'superior') return;
 const status = localStorage.getItem(ONBOARDING_KEY);
 if (status) return; // already completed or skipped
 const overlay = document.getElementById('onboardingOverlay');
 if (!overlay) return;
 // Pre-fill from existing settings if any (re-running scenario)
 try {
 const s = JSON.parse(localStorage.getItem('complianceSettings_v1')) || {};
 const shop = s.shop || {}; const sst = s.sst || {};
 const setVal = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.value = v; };
 setVal('obwShopName', shop.name);
 setVal('obwShopPhone', shop.phone);
 setVal('obwShopEmail', shop.email);
 setVal('obwShopAddress', shop.address);
 const sstReg = document.getElementById('obwSstRegistered'); if (sstReg) { sstReg.checked = !!sst.registered; }
 const sstFields = document.getElementById('obwSstFields'); if (sstFields) sstFields.style.display = sst.registered ? 'block' : 'none';
 setVal('obwSstNumber', sst.number);
 setVal('obwSstRate', sst.rate || 6);
 const sstIncl = document.getElementById('obwSstInclusive'); if (sstIncl) sstIncl.checked = sst.inclusive !== false;
 } catch(e){}
 // Wire SST checkbox toggle inside wizard
 const sstCb = document.getElementById('obwSstRegistered');
 if (sstCb && !sstCb.dataset.bound) {
 sstCb.addEventListener('change', () => {
 document.getElementById('obwSstFields').style.display = sstCb.checked ? 'block' : 'none';
 });
 sstCb.dataset.bound = '1';
 }
 obwShowStep(1);
 overlay.style.display = 'flex';
}

// Boot a session for the given user (was the body of handleLogin).
// Capability matrix — each role gets a SET of mode tabs they can access,
// PLUS a default mode that aligns with their home section.
// ALL ROLES see Cashier (everyone rings up customers when needed).
// Sales/Inventory ALSO see Operations (check stock during sale).
// Mgmt+Superior see Manager (dashboards + admin sections).
//
// IMPORTANT: defaultMode must match the home section's mode group,
// otherwise the home tab will be hidden by mode-bar's class filter.
const ROLE_CAPS = {
 superior: { modes: ['cashier', 'operations', 'manager', 'management', 'hq', 'investor'], defaultMode: 'hq', home: 'finance_main', label: 'Superior', emoji: '' },
 mgmt: { modes: ['cashier', 'operations', 'manager'], defaultMode: 'manager', home: 'admin_dashboard', label: 'Manager', emoji: '' },
 inventory: { modes: ['cashier', 'operations'], defaultMode: 'operations', home: 'inv_database', label: 'Inventory', emoji: '' },
 sales: { modes: ['cashier', 'operations'], defaultMode: 'cashier', home: 'sales_cashier', label: 'Sales', emoji: '' },
 investor: { modes: ['investor'], defaultMode: 'investor', home: 'investor_overview', label: 'Investor', emoji: '' },
};

function loginAs(user) {
 if(!user) return;
 currentUser = user;
 window.currentUser = user; // expose for helpers (e.g. hasManagementAccess)
 currentUserRole = user.role;
 const cap = ROLE_CAPS[user.role] || ROLE_CAPS.sales;

 // Boot side-effects (deferred: don't block UI thread on these)
 queueMicrotask(() => { try { checkMyAttendanceStatus(); } catch(e){} });
 queueMicrotask(() => { try { typeof renderPersonalCommission === "function" && renderPersonalCommission(); } catch(e){} });
 setTimeout(() => maybeShowOnboarding(user), 2700); // after welcome auto-dismiss (2.4s + 0.3s buffer)

 // p1_26: redesigned welcome screen with personality
 (function showWelcome() {
 const welcomeModal = document.getElementById("staffWelcomeModal");
 if(!welcomeModal) return;

 // Time-aware greeting (BM)
 const hr = new Date().getHours();
 const greeting = hr < 5  ? 'Malam tenang' :
                  hr < 12 ? 'Selamat pagi' :
                  hr < 15 ? 'Selamat tengahari' :
                  hr < 19 ? 'Selamat petang' :
                            'Selamat malam';

 // Role-based tagline + mode chip text
 const taglines = {
   superior:  ['Trail awaits, boss.', 'Komand penuh, boss.', 'Kerajaan tahan, boss.'],
   investor:  ['Boardroom standing by.', 'Cap table refreshed.', 'Numbers ready for review.'],
   mgmt:      ['Operations command, ready.', 'Tim awak menunggu.', 'Mari pacu hari ni.'],
   inventory: ['Stok dikira, jiran.', 'Warehouse on standby.', 'Mari uruskan inventori.'],
   sales:     ['Counter ready. Layan campers!', 'Mari layan pelanggan.', 'Sales tracker on.']
 };
 const lineSet = taglines[user.role] || ['Workspace ready.'];
 const tagline = lineSet[Math.floor(Math.random() * lineSet.length)];

 // Mode destination (uses pickDefaultMode if available)
 const modeLabels = { cashier:'Kaunter', operations:'Operasi', manager:'Pengurus', management:'Pengurusan', hq:'HQ', investor:'Investor' };
 let destMode = (typeof window.pickDefaultMode === 'function') ? window.pickDefaultMode(user) : (cap.defaultMode || 'cashier');
 const modeText = 'Heading to ' + (modeLabels[destMode] || 'workspace') + ' mode';

 // Avatar icon by role
 const iconByRole = { superior:'crown', investor:'trending-up', mgmt:'briefcase', inventory:'package', sales:'shopping-cart' };
 const avatarIcon = iconByRole[user.role] || 'user';

 // Compute relevant stats based on access
 const access = (typeof window.getModesAccess === 'function') ? window.getModesAccess(user) : {};
 const stats = [];
 // Sales today (if has cashier or manager access, or is investor/superior)
 try {
   const today = new Date(); today.setHours(0,0,0,0);
   const todaySales = (typeof salesHistory !== 'undefined' ? salesHistory : []).filter(s => {
     const d = new Date(s.created_at || s.timestamp);
     const amt = parseFloat(s.amount || s.total || 0);
     return amt > 0 && d >= today;
   });
   if(access.cashier || access.manager || access.management || access.investor) {
     const total = todaySales.reduce((sum, s) => sum + parseFloat(s.amount || s.total || 0), 0);
     stats.push({ value: todaySales.length, label: 'Sales today' });
     if(total > 0 && (access.management || access.investor || user.role === 'superior')) {
       const fmt = window.formatRMShort || (n => 'RM ' + Math.round(n));
       stats.push({ value: fmt(total), label: 'Revenue' });
     }
   }
 } catch(e) {}
 // Pending memos for superior
 try {
   if(user.role === 'superior' && typeof window.memoGetPendingCount === 'function') {
     const pending = window.memoGetPendingCount();
     if(pending > 0) stats.push({ value: pending, label: 'Pending memos' });
   }
 } catch(e) {}
 // Low stock alerts (operations/management/superior)
 try {
   if((access.operations || access.management || user.role === 'superior') && typeof masterProducts !== 'undefined') {
     let lowCount = 0;
     masterProducts.forEach(p => {
       if(!p.is_published && !p.published_at) return;
       const stock = (typeof inventoryBatches !== 'undefined' ? inventoryBatches : []).filter(b => b.sku === p.sku && b.qty_remaining > 0).reduce((s,b) => s+(b.qty_remaining||0), 0);
       const reorder = parseInt(p.reorder_point || 5);
       if(stock > 0 && stock <= reorder) lowCount++;
     });
     if(lowCount > 0) stats.push({ value: lowCount, label: 'Low stock' });
   }
 } catch(e) {}
 stats.length = Math.min(stats.length, 3); // max 3

 // Populate
 const greetEl = document.getElementById('welcomeGreeting');
 const nameEl = document.getElementById('welcomeStaffName');
 const tagEl = document.getElementById('welcomeTagline');
 const modeChipText = document.getElementById('welcomeModeText');
 const avatarEl = document.getElementById('welcomeAvatar');
 const avatarIconEl = document.getElementById('welcomeAvatarIcon');
 const statsEl = document.getElementById('welcomeStats');
 if(greetEl) greetEl.textContent = greeting;
 if(nameEl)  nameEl.textContent = user.name;
 if(tagEl)   tagEl.textContent = tagline + ' · ' + (user.dept || cap.label);
 if(modeChipText) modeChipText.textContent = modeText;
 if(avatarEl) avatarEl.setAttribute('data-tier', user.role);
 if(avatarIconEl) avatarIconEl.setAttribute('data-lucide', avatarIcon);
 if(statsEl) {
   statsEl.innerHTML = stats.map(s => `<div class="welcome-stat"><strong>${s.value}</strong><span>${s.label}</span></div>`).join('');
 }

 welcomeModal.style.display = 'flex';
 if(window.lucide && lucide.createIcons) setTimeout(() => lucide.createIcons(), 50);

 // Restart progress bar animation by re-inserting node
 const progressBar = welcomeModal.querySelector('.welcome-progress__bar');
 if(progressBar) {
   const fresh = progressBar.cloneNode(true);
   progressBar.parentNode.replaceChild(fresh, progressBar);
 }

 const dismissTimer = setTimeout(() => window.dismissWelcome(), 2400);
 window.dismissWelcome = function() {
   clearTimeout(dismissTimer);
   welcomeModal.classList.add('is-leaving');
   setTimeout(() => {
     welcomeModal.style.display = 'none';
     welcomeModal.classList.remove('is-leaving');
   }, 380);
 };
 })();

 // Global memo as toast (legacy globalMemo — keep for back-compat with old data)
 if(globalMemo.active && typeof showToast === 'function') {
 setTimeout(() => showToast(` PENGUMUMAN: ${globalMemo.text}`, 'warn'), 800);
 }
 // p1_19: Pinned approved memo from Memo Board → toast on login
 setTimeout(() => {
 try {
 const pinned = (typeof window.memoGetPinnedActive === 'function') ? window.memoGetPinnedActive() : null;
 if(pinned && typeof showToast === 'function') {
 showToast(' ' + pinned.title + ': ' + pinned.body.slice(0, 120) + (pinned.body.length>120?'...':''), 'warn');
 }
 } catch(e){}
 // Refresh sidebar badge for Bos
 if(typeof window.memoRefreshSidebarBadge === 'function') window.memoRefreshSidebarBadge();
 }, 1200);

 document.getElementById("shopAppLayout").style.display = "none";
 document.getElementById("posAppLayout").style.display = "block";

 // Header — "Hi, name · Role"
 const sessEl = document.getElementById("sessionUsername");
 if(sessEl) sessEl.innerHTML = `Hi, ${(user.name.split(' ')[0])} <span class="badge badge--neutral" style="margin-left:6px; font-size:9px; vertical-align:middle;">${cap.emoji} ${cap.label}</span>`;

 // Capability-based visibility — clear all role-style hides, then only show what role allows
 document.querySelectorAll(".sales-only,.inv-only,.mgmt-only,.superior-only")
.forEach(el => el.style.display = ""); // reset inline (let CSS class system take over)

 // p1_20: per-staff mode access overlay — overrides role caps entirely
 if(typeof window.refreshAllModeTabsVisibility === 'function') {
 window.refreshAllModeTabsVisibility();
 } else if(typeof window.applyRoleCapabilities === 'function') {
 window.applyRoleCapabilities(cap.modes);
 }

 // Default mode: highest-tier accessible (Management> Manager> Operasi> Kaunter)
 let defaultMode = (typeof window.pickDefaultMode === 'function') ? window.pickDefaultMode(user) : (cap.defaultMode || 'cashier');
 // Home tab matches default mode landing
 let homeTab = cap.home;
 // p1_32: Bos lands on Finance Dashboard when management access; otherwise admin_dashboard
 if(defaultMode === 'manager') {
   homeTab = (user && user.role === 'superior') ? 'finance_main' : (cap.home || 'admin_dashboard');
 } else if(defaultMode === 'operations') homeTab = 'inv_database';
 else if(defaultMode === 'cashier') homeTab = 'sales_cashier';
 else if(defaultMode === 'investor') homeTab = 'investor_overview';

 if(typeof window.setMode === 'function') {
 window.__modeJumping = true; // suppress auto-jump
 window.setMode(defaultMode);
 window.__modeJumping = false;
 }
 setTimeout(() => {
 const homeBtn = document.querySelector(`.menu-item[data-tab="${homeTab}"]`);
 if(homeBtn) homeBtn.click();
 else {
 const overviewBtn = document.querySelector('.menu-item[data-tab="overview"]');
 if(overviewBtn) overviewBtn.click();
 }
 }, 200);
}

// Apply capability-based mode tab visibility
window.applyRoleCapabilities = function(allowedModes) {
 document.querySelectorAll('.mode-tab').forEach(tab => {
 const m = tab.getAttribute('data-mode-set');
 const allowed = !allowedModes || allowedModes.includes(m);
 tab.style.display = allowed ? '' : 'none';
 tab.disabled = !allowed;
 });
};

function handleLogout() {
 currentUser = null;
 currentUserRole = null;
 document.getElementById("shopAppLayout").style.display = "block";
 document.getElementById("posAppLayout").style.display = "none";
 const sessEl = document.getElementById("sessionUsername");
 if(sessEl) sessEl.textContent = "10 CAMP POS";
 document.getElementById("appSidebar")?.classList.remove('open');
 document.getElementById("sidebarOverlay")?.classList.remove('active');

 document.querySelectorAll(".tab-section").forEach(el => el.style.display = "none");

 // Reset all role-style inline hides (next login starts fresh)
 document.querySelectorAll(".sales-only,.inv-only,.mgmt-only,.superior-only")
.forEach(el => el.style.display = "");

 // Reset mode-tab capability gating
 document.querySelectorAll('.mode-tab').forEach(tab => { tab.style.display = ''; tab.disabled = false; });

 // Close panels/modals that may be lingering
 ['checkoutPanel','staffWelcomeModal','cmdkOverlay','onboardingOverlay','pinLoginOverlay']
.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
 document.getElementById('checkoutPanelOverlay')?.classList.remove('is-open');
 document.getElementById('checkoutPanel')?.classList.remove('is-open');

 // Reset cart
 if(typeof cart !== 'undefined') { cart.length = 0; if(typeof renderCart === 'function') renderCart(); }
}

setTimeout(() => {
 document.getElementById("searchInput")?.addEventListener('input', e => renderPOS(e.target.value));
 const dateObj = new Date();
 const firstDay = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
 document.getElementById('dashStartDate').value = firstDay.toISOString().split('T')[0];
 document.getElementById('dashEndDate').value = dateObj.toISOString().split('T')[0];
 
 if(localStorage.getItem('posMode') === 'mobile') {
 document.body.classList.add('pos-mobile-mode');
 }

 if(db) initApp();
}, 200);

// ===================================
// PUBLIC E-COMMERCE ENGINE
// ===================================
// p1_23 landing redesign — filter state
window.lpSearchTerm = '';
window.lpActiveCategory = '';

// p1_48: Brand-as-category cleanup (read-only heuristic)
// Some products were imported with category set to a brand name (e.g. "BLACKDOG").
// Until the DB is hand-fixed, remap on the fly so the storefront pills/tiles stay clean.
window.lpBrandNamedCats = new Set(['BLACKDOG','NATUREHIKE','MOUNTAINHIKER','CHANODUG','SHINE TRIP','10Camp Official Store']);
window.lpCategoryRules = [
    [['cookware utensil set','cookware','pot set','pot|','pot ','pot,','milk pan',' pan ','pan|','frying','kettle'], 'Pots'],
    [['stove','burner'], 'Stove'],
    [['tent','dome'], 'Tent'],
    [['chair','stool'], 'Chairs'],
    [['table','desk'], 'Tables'],
    [['lamp','lantern','light pole','string light',' light ','light|'], 'Hanging Lamp'],
    [['fan '], 'Portable Fan'],
    [['backpack','bag '], 'Bags'],
    [['box ','case ','organizer','crate'], 'Boxes'],
    [['cup','mug'], 'Cups'],
    [['mattress','sleeping pad','mat '], 'Mat'],
    [['sleeping bag','sleepingbag'], 'Sleeping Bags'],
    [['flysheet','tarp','canopy'], 'Flysheet'],
    [['plate'], 'Plate'],
    [['grill','bbq','barbecue'], 'Grills'],
    [['hammock'], 'Hammock'],
    [['wagon','cart','trolley'], 'Wagons'],
    [['rope'], 'Rope'],
    [['hammer'], 'Hammer'],
    [['hook'], 'Hooks'],
    [['carabiner','clip'], 'Carabiner'],
    [['peg '], 'Pegs'],
    [['ground sheet','footprint'], 'Ground Sheet'],
    [['flag'], 'Flags'],
    [['bucket','pail'], 'Bucket'],
    [['rack'], 'Rack'],
    [['shelf','shelves'], 'Shelf'],
    [['blanket'], 'Blankets'],
    [['pillow'], 'Pillow'],
    [['cot '], 'Camping Cots'],
    [['utensil','spork','fork','spoon','knife','chopstick'], 'Utensils'],
    [['towel'], 'Towel'],
    [['shirt','jersey','jacket','apparel'], 'Apparel'],
    [['shovel','spade','axe'], 'Survival Tools']
];
window.lpRealCategory = function(p) {
    const orig = (p && p.category) || '';
    if(!window.lpBrandNamedCats.has(orig)) return orig;
    const name = ((p && p.name) || '').toLowerCase();
    for(const [kws, cat] of window.lpCategoryRules) {
        for(const k of kws) {
            if(name.includes(k)) return cat;
        }
    }
    return '';
};

// p1_47: Activity Grid — group raw categories into 10 activity buckets for primary navigation
window.LP_ACTIVITY_GROUPS = {
    shelter:   { label: 'Khemah & Shelter',  icon: 'tent',             cats: ['Tent','Dome','Canopy','Tent Pole','Pegs','Ground Sheet','Flysheet','Hammock'] },
    furniture: { label: 'Furniture Outdoor', icon: 'armchair',         cats: ['Tables','Chairs','Stool','Mini Table','Rack','Shelf','Tablecloth'] },
    cooking:   { label: 'Memasak & Makan',   icon: 'utensils-crossed', cats: ['Pots','Stove','Kettle','Grills','Cups','Plate','Utensils','Charcoal','Seasoning Bottles','Pot Hanging Tripod'] },
    sleeping:  { label: 'Tidur & Rehat',     icon: 'bed',              cats: ['Sleeping','Sleeping Bags','SLEEPING GEAR','Air Mattress','Mat','Pillow','Blankets','Camping Cots','Inflatable Sofa'] },
    lighting:  { label: 'Lighting',          icon: 'lamp',             cats: ['Hanging Lamp','Universal Lamp','Ground Lamp','String Light','Lanterns','LIGHTING','Light Standing Pole','Warning Light','Lights with Mosquito Repellent'] },
    storage:   { label: 'Storage',           icon: 'package',          cats: ['Boxes','Bags','Bucket','Storage','STORAGE','Basket'] },
    cooling:   { label: 'Cooling & Fan',     icon: 'fan',              cats: ['Portable Fan','Fan','FAN','Fan Accessories'] },
    tools:     { label: 'Tools & Aksesori',  icon: 'wrench',           cats: ['Hammer','Hooks','Rope','Velco Strap','Survival Tools','Universal Tactical Screws','Carabiner','Pole Cap','Wind Shield','Portable Hanger','Accessories'] },
    apparel:   { label: 'Apparel',           icon: 'shirt',            cats: ['Apparel','Towel'] },
    lifestyle: { label: 'Outdoor Lifestyle', icon: 'mountain',         cats: ['Wagons','Flags','Rubbish Frame','Bundle'] }
};
window.lpActiveActivity = '';

window.lpHandleSearch = function(val) {
    window.lpSearchTerm = (val || '').toLowerCase().trim();
    publicCurrentPage = 1;
    renderPublicStorefront();
    window.lpUpdateShopHeading();
};
window.lpFilterCategory = function(cat) {
    window.lpActiveCategory = cat || '';
    publicCurrentPage = 1;
    renderPublicStorefront();
    window.lpUpdateShopHeading();
    window.lpRenderCategoryPills();
    // Smooth scroll to shop
    const shop = document.getElementById('shop');
    if(shop) shop.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.lpFilterByActivity = function(activityKey) {
    const next = activityKey || '';
    // Toggle off if user clicks the same tile
    window.lpActiveActivity = (window.lpActiveActivity === next) ? '' : next;
    // Reset narrower filters so user starts fresh inside the activity
    window.lpActiveCategory = '';
    publicCurrentPage = 1;
    renderPublicStorefront();
    window.lpUpdateShopHeading();
    window.lpRenderActivityTiles();
    window.lpRenderCategoryPills();
    const shop = document.getElementById('shop');
    if(shop) shop.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
// p1_56: replace hardcoded hero/trust/about counts ("10K+ products", "2,800+ customers", "11 brands")
// with live numbers from masterProducts + customersData. Runs after data load.
window.lpUpdateTrustStats = function() {
    if (typeof masterProducts === 'undefined' || !Array.isArray(masterProducts)) return;
    const eligible = masterProducts.filter(p => isPublished(p) && !window.lpIsEventSku(p));
    const productCount = eligible.length;
    const brandSet = new Set();
    eligible.forEach(p => { if (p.brand && String(p.brand).trim()) brandSet.add(String(p.brand).trim().toLowerCase()); });
    const brandCount = brandSet.size;
    const customerCount = (typeof customersData !== 'undefined' && Array.isArray(customersData)) ? customersData.length : 0;
    document.querySelectorAll('[data-stat="products"]').forEach(el => {
        el.textContent = productCount > 0 ? productCount.toLocaleString() + '+' : '—';
    });
    document.querySelectorAll('[data-stat="brands"]').forEach(el => {
        el.textContent = brandCount > 0 ? String(brandCount) : '—';
    });
    document.querySelectorAll('[data-stat="customers"]').forEach(el => {
        el.textContent = customerCount > 0 ? customerCount.toLocaleString() + '+' : '—';
    });
};

window.lpRenderActivityTiles = function() {
    const wrap = document.getElementById('lpActivityGrid');
    if(!wrap || typeof masterProducts === 'undefined') return;
    const products = masterProducts.filter(p => isPublished && isPublished(p) && !window.lpIsEventSku(p));
    let html = '';
    Object.entries(window.LP_ACTIVITY_GROUPS).forEach(([key, g]) => {
        // p1_48: count uses lpRealCategory so brand-named cats remap to real cats first
        const count = products.filter(p => g.cats.includes(window.lpRealCategory(p))).length;
        const active = window.lpActiveActivity === key ? ' is-active' : '';
        html += `<button type="button" class="lp-activity-tile${active}" onclick="window.lpFilterByActivity('${key}')">
            <span class="lp-activity-tile__icon"><i data-lucide="${g.icon}"></i></span>
            <span class="lp-activity-tile__label">${g.label}</span>
            <span class="lp-activity-tile__count">${count} produk</span>
        </button>`;
    });
    wrap.innerHTML = html;
    if(window.lucide && lucide.createIcons) lucide.createIcons();
};
window.lpUpdateShopHeading = function() {
    const h = document.getElementById('lpShopHeading');
    if(!h) return;
    const act = window.lpActiveActivity && window.LP_ACTIVITY_GROUPS && window.LP_ACTIVITY_GROUPS[window.lpActiveActivity];
    if(window.lpActiveCategory && window.lpActiveCategory !== 'SALE') h.textContent = window.lpActiveCategory;
    else if(window.lpActiveCategory === 'SALE') h.textContent = 'Festival Sale';
    else if(window.lpSearchTerm) h.textContent = 'Search: "' + window.lpSearchTerm + '"';
    else if(act) h.textContent = act.label;
    else h.textContent = 'All Products';
};
window.lpRenderCategoryPills = function() {
    const wrap = document.getElementById('lpCategoryPills');
    if(!wrap || typeof masterProducts === 'undefined') return;
    // p1_47: when an activity is selected, restrict pills to its categories
    const activity = window.lpActiveActivity && window.LP_ACTIVITY_GROUPS && window.LP_ACTIVITY_GROUPS[window.lpActiveActivity];
    const allowedCats = activity ? new Set(activity.cats) : null;
    const cats = {};
    masterProducts.filter(p => isPublished && isPublished(p) && !window.lpIsEventSku(p)).forEach(p => {
        // p1_48: use cleaned category (brand-named cats remapped via heuristic)
        const c = window.lpRealCategory(p) || 'Uncat';
        // p1_48: never expose brand-named cats as a pill (BLACKDOG, NATUREHIKE, etc.)
        if(window.lpBrandNamedCats && window.lpBrandNamedCats.has(c)) return;
        if(allowedCats && !allowedCats.has(c)) return;
        cats[c] = (cats[c] || 0) + 1;
    });
    const sorted = Object.entries(cats).sort((a,b) => b[1] - a[1]).slice(0, 10);
    const allLabel = activity ? ('All ' + activity.label) : 'All';
    let html = `<button class="lp-pill ${window.lpActiveCategory === '' ? 'lp-pill--active' : ''}" onclick="window.lpFilterCategory('')">${allLabel}</button>`;
    sorted.forEach(([c, n]) => {
        const active = window.lpActiveCategory === c ? 'lp-pill--active' : '';
        html += `<button class="lp-pill ${active}" onclick="window.lpFilterCategory('${c.replace(/'/g, "\\'")}')">${c} (${n})</button>`;
    });
    // p1_47: if activity is active, offer a "Clear activity" chip back to all
    if(activity) {
        html += `<button class="lp-pill" style="border-color:var(--primary-500); color:var(--primary-700);" onclick="window.lpFilterByActivity('')">× Clear ${activity.label}</button>`;
    }
    wrap.innerHTML = html;
};

window.lpRenderSkeletons = function() {
    const list = document.getElementById('publicProductsList');
    if(!list) return;
    let html = '';
    for(let i = 0; i < 8; i++) {
        html += '<div class="lp-skeleton"><div class="lp-skeleton__media"></div><div class="lp-skeleton__line lp-skeleton__line--sm"></div><div class="lp-skeleton__line lp-skeleton__line--md"></div><div class="lp-skeleton__line"></div></div>';
    }
    list.innerHTML = html;
};

window.lpUpdateCartBadge = function() {
    const badge = document.getElementById('lpCartBadge');
    if(!badge) return;
    const count = (typeof publicCart !== 'undefined' && Array.isArray(publicCart))
        ? publicCart.reduce((s, c) => s + (c.quantity || 0), 0) : 0;
    if(count > 0) {
        badge.style.display = 'inline-block';
        badge.textContent = count > 99 ? '99+' : count;
    } else {
        badge.style.display = 'none';
    }
};

window.lpNewsletterSubmit = function(form) {
    const email = form.querySelector('input[type="email"]').value.trim();
    if(!email) return;
    let subs = []; try { subs = JSON.parse(localStorage.getItem('newsletter_subs_v1') || '[]'); } catch(e){}
    if(!subs.includes(email)) {
        subs.push(email);
        try { localStorage.setItem('newsletter_subs_v1', JSON.stringify(subs)); } catch(e){}
    }
    form.querySelector('input[type="email"]').value = '';
    if(typeof showToast === 'function') showToast('Thanks! You\'re on the list.', 'success');
};

// Refresh promo banner from active promotions (best-effort)
window.lpRefreshPromoBanner = function() {
    const banner = document.getElementById('lpPromoBanner');
    const text = document.getElementById('lpPromoText');
    if(!banner || !text) return;
    let promos = [];
    try {
        if(typeof window.promotionsCache !== 'undefined' && Array.isArray(window.promotionsCache)) {
            promos = window.promotionsCache;
        } else {
            promos = JSON.parse(localStorage.getItem('promotions_cache') || '[]');
        }
    } catch(e){}
    const now = new Date();
    const active = promos.find(p => {
        if(p.status !== 'active' && p.is_active !== true) return false;
        if(p.end_date && new Date(p.end_date) < now) return false;
        if(p.start_date && new Date(p.start_date) > now) return false;
        return true;
    });
    if(active) {
        text.textContent = (active.code ? active.code + ': ' : '') + (active.description || active.name || 'Special offer running now') + ' — Shop Sale →';
        banner.style.display = '';
        banner.style.cursor = 'pointer';
        banner.onclick = (e) => { if(e.target.tagName !== 'BUTTON') window.lpFilterCategory('SALE'); };
    } else {
        banner.style.display = 'none';
    }
};

// p1_46: Display name parser — strips SKU/brand/model noise from messy product names.
// "LF025-026 | LFO COOKWARE UTENSIL SET | LF025 | LF026 — LF025 KETTLE SET"
//   → { title: "LFO COOKWARE UTENSIL SET", variantName: "KETTLE SET" }
window.lpParseProductName = function(p) {
    let raw = String((p && p.name) || '').trim();
    let variantName = String((p && (p.variant_color || p.variant_size)) || '').trim();
    const dashIdx = raw.lastIndexOf(' — ');
    if (dashIdx > 0) {
        if (!variantName) variantName = raw.slice(dashIdx + 3).trim();
        raw = raw.slice(0, dashIdx);
    }
    const skuLike = /^[A-Z]{1,4}\d+([-\d]+)?$/;
    const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
    const meaningful = parts.filter(s => !skuLike.test(s) && s.length > 4);
    let title = meaningful.length ? meaningful[0] : (parts[0] || raw);
    if (p && p.brand) {
        const brandRe = new RegExp('^' + p.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i');
        title = title.replace(brandRe, '').trim();
    }
    title = title.replace(/^[A-Z0-9-]{4,}\s*_\s*/, '').trim();
    if (variantName) {
        variantName = variantName.replace(/^[A-Z]{1,4}\d+([-\d]+)?\s+/, '').trim();
    }
    return { title: title || raw, variantName };
};

// p1_46: Group products by parent_sku so variants of same product collapse into 1 card.
window.lpGroupVariants = function(products) {
    const groups = new Map();
    products.forEach(p => {
        const key = p.parent_sku || ('__solo:' + p.sku);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
    });
    return Array.from(groups.values());
};

// p1_46: Variant chip click — swaps active variant inside a single card without re-render.
window.lpSelectVariant = function(cardId, sku, btn) {
    if (!cardId || !sku) return;
    const card = document.getElementById(cardId);
    if (!card) return;
    const product = (typeof masterProducts !== 'undefined') ? masterProducts.find(p => p.sku === sku) : null;
    if (!product) return;
    card.querySelectorAll('.lp-variant-chip').forEach(c => c.classList.remove('is-active'));
    if (btn) btn.classList.add('is-active');
    const img = card.querySelector('.lp-product-card__img');
    const thumb = product.images && product.images[0] ? product.images[0] : 'https://placehold.co/300x300?text=No+Img';
    if (img) img.src = thumb;
    const fmt = (n) => 'RM ' + (Number.isInteger(n) ? n : n.toFixed(2));
    const price = parseFloat(product.price || 0);
    const compareAt = parseFloat(product.compare_at_price || 0);
    const onSale = compareAt > price && price > 0;
    const priceEl = card.querySelector('[data-role="price"]');
    if (priceEl) {
        priceEl.innerHTML = fmt(price) + (onSale ? ' <small style="color:#9CA3AF; font-weight:500; text-decoration:line-through; font-size:11px; margin-left:6px;">' + fmt(compareAt) + '</small>' : '');
    }
    const parsed = window.lpParseProductName(product);
    const labelEl = card.querySelector('[data-role="variant-label"]');
    if (labelEl) {
        if (parsed.variantName) { labelEl.textContent = parsed.variantName; labelEl.style.display = ''; }
        else { labelEl.style.display = 'none'; }
    }
    const addBtn = card.querySelector('[data-role="add-btn"]');
    if (addBtn) {
        addBtn.dataset.sku = sku;
        const myBatches = (typeof inventoryBatches !== 'undefined') ? inventoryBatches.filter(b => b.sku === sku && b.qty_remaining > 0) : [];
        const totalStock = myBatches.reduce((s, b) => s + b.qty_remaining, 0);
        if (totalStock <= 0) { addBtn.disabled = true; addBtn.textContent = 'Sold Out'; }
        else { addBtn.disabled = false; addBtn.textContent = 'Add to Cart'; }
    }
};

// p1_51: reveal the hidden chip row and remove the "+N more" toggle
window.lpExpandChips = function(btn) {
    if (!btn) return;
    const card = btn.closest('.lp-product-card');
    if (!card) return;
    const extra = card.querySelector('.lp-variant-chips--extra');
    if (extra) extra.hidden = false;
    btn.remove();
};

// p1_52: customer-facing product detail modal (storefront PDP)
window.lpPdpState = null;

// p1_53: turn the HTML body EasyStore stores in `description` into readable plain text
// (block tags → newlines, list items → bullets, table rows → " · ", remaining tags stripped).
window.lpFormatDescription = function(raw) {
    if (!raw) return '';
    let text = String(raw);
    text = text.replace(/^\[EASYSTORE-ID:[^\]]+\]\s*/, '');
    text = text.replace(/^\[STOK BELUM DISAHKAN[^\]]*\]\s*\n*/, '');
    text = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<li[^>]*>/gi, '• ');
    text = text.replace(/<\/td>\s*<td[^>]*>/gi, ' · ');
    text = text.replace(/<\/(p|div|h[1-6]|tr|li|ul|ol|table|thead|tbody|section)>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&nbsp;/g, ' ')
               .replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"')
               .replace(/&#39;/g, "'")
               .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
               .replace(/&[a-z]+;/gi, '');
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    return text.trim();
};

window.lpOpenProductDetail = function(sku) {
    if (!sku || typeof masterProducts === 'undefined') return;
    const lead = masterProducts.find(p => p.sku === sku);
    if (!lead) return;
    const parentSku = lead.parent_sku || lead.sku;
    const variants = masterProducts.filter(p => (p.parent_sku || p.sku) === parentSku);
    if (!variants.length) return;
    window.lpPdpState = { variants, currentSku: sku, qty: 1, imgIdx: 0 };
    window.lpRenderPdp();
    const modal = document.getElementById('lpPdpModal');
    if (modal) {
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }
};

window.lpClosePdp = function() {
    const modal = document.getElementById('lpPdpModal');
    if (modal) {
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
    window.lpPdpState = null;
};

window.lpRenderPdp = function() {
    const state = window.lpPdpState;
    if (!state) return;
    const body = document.getElementById('lpPdpBody');
    if (!body) return;
    const current = state.variants.find(v => v.sku === state.currentSku) || state.variants[0];
    const parsed = window.lpParseProductName(current);
    const cleanCat = window.lpRealCategory(current);
    const sameBC = current.brand && cleanCat && current.brand.toLowerCase().replace(/\s/g,'') === cleanCat.toLowerCase().replace(/\s/g,'');
    const fmt = (n) => 'RM ' + (Number.isInteger(n) ? n : n.toFixed(2));
    const price = parseFloat(current.price || 0);
    const compareAt = parseFloat(current.compare_at_price || 0);
    const onSale = compareAt > price && price > 0;
    const off = onSale ? Math.round(((compareAt - price) / compareAt) * 100) : 0;

    const myBatches = (typeof inventoryBatches !== 'undefined') ? inventoryBatches.filter(b => b.sku === current.sku && b.qty_remaining > 0) : [];
    const totalStock = myBatches.reduce((s, b) => s + b.qty_remaining, 0);
    let stockBadge = '';
    if (totalStock <= 0) stockBadge = '<span class="lp-pdp__stock lp-pdp__stock--out">Sold Out</span>';
    else if (totalStock <= 3) stockBadge = `<span class="lp-pdp__stock lp-pdp__stock--low">Only ${totalStock} left</span>`;
    else stockBadge = '<span class="lp-pdp__stock lp-pdp__stock--ok">In stock</span>';

    if (state.qty > Math.max(1, totalStock)) state.qty = Math.max(1, totalStock);

    const images = (current.images && current.images.length) ? current.images : ['https://placehold.co/600x600?text=No+Img'];
    if (state.imgIdx >= images.length) state.imgIdx = 0;
    const mainImg = images[state.imgIdx];

    const escAttr = (s) => String(s == null ? '' : s).replace(/"/g, '&quot;');
    const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const escJs = (s) => String(s == null ? '' : s).replace(/'/g, "\\'");

    let thumbsHtml = '';
    if (images.length > 1) {
        images.forEach((url, i) => {
            const active = (i === state.imgIdx) ? ' is-active' : '';
            thumbsHtml += `<button type="button" class="lp-pdp__thumb${active}" onclick="window.lpPdpPickImage(${i})"><img src="${escAttr(url)}" alt=""></button>`;
        });
    }

    let variantsHtml = '';
    if (state.variants.length > 1) {
        state.variants.forEach((v) => {
            const vp = window.lpParseProductName(v);
            const label = (vp.variantName || v.variant_color || v.variant_size || v.sku).slice(0, 32);
            const active = (v.sku === current.sku) ? ' is-active' : '';
            variantsHtml += `<button type="button" class="lp-variant-chip${active}" onclick="window.lpPdpSelectVariant('${escJs(v.sku)}')">${escHtml(label)}</button>`;
        });
    }

    let specsHtml = '';
    let meta = current.metafields;
    if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch(e) { meta = null; } }
    if (meta && typeof meta === 'object') {
        const entries = Object.entries(meta).filter(([k,v]) => k && String(v).trim());
        if (entries.length) {
            specsHtml = '<div class="lp-pdp__section"><h4 class="lp-pdp__section-title">Specifications</h4><ul class="lp-pdp__specs">';
            entries.forEach(([k, v]) => { specsHtml += `<li><strong>${escHtml(k)}</strong><span>${escHtml(v)}</span></li>`; });
            specsHtml += '</ul></div>';
        }
    }

    const desc = window.lpFormatDescription(current.description);
    const descHtml = desc ? `<div class="lp-pdp__section"><h4 class="lp-pdp__section-title">Description</h4><p class="lp-pdp__desc">${escHtml(desc)}</p></div>` : '';

    // p1_53: quick-spec strip surfaces weight + size at-a-glance so staff/customer don't have to scan the description
    const fmtKg = (n) => { const num = Number(n); if (!num) return ''; return (num >= 1 ? num.toFixed(2) : num.toFixed(3)).replace(/\.?0+$/, '') + ' kg'; };
    const quickSpecs = [];
    if (current.weight_kg) { const v = fmtKg(current.weight_kg); if (v) quickSpecs.push({ label: 'Berat', value: v }); }
    if (current.variant_size) quickSpecs.push({ label: 'Saiz', value: current.variant_size });
    if (current.unit && current.unit !== 'pcs') quickSpecs.push({ label: 'Unit', value: current.unit });
    const quickHtml = quickSpecs.length
        ? `<div class="lp-pdp__quick">${quickSpecs.map(s => `<div class="lp-pdp__quick-item"><span class="lp-pdp__quick-label">${escHtml(s.label)}</span><span class="lp-pdp__quick-value">${escHtml(s.value)}</span></div>`).join('')}</div>`
        : '';

    body.innerHTML = `
        <div class="lp-pdp__gallery">
            <img src="${escAttr(mainImg)}" class="lp-pdp__main-img" alt="${escAttr(parsed.title)}" onerror="this.src='https://placehold.co/600x600?text=No+Img'">
            ${thumbsHtml ? `<div class="lp-pdp__thumbs">${thumbsHtml}</div>` : ''}
        </div>
        <div class="lp-pdp__info">
            <div class="lp-pdp__meta">
                ${current.brand ? `<span class="lp-pdp__brand">${escHtml(current.brand)}</span>` : ''}
                ${(!sameBC && cleanCat) ? `<span class="lp-pdp__cat">${escHtml(cleanCat)}</span>` : ''}
                <span class="lp-pdp__sku">${escHtml(current.sku)}</span>
            </div>
            <h2 class="lp-pdp__title" id="lpPdpTitle">${escHtml(parsed.title)}</h2>
            <div class="lp-pdp__price-row">
                <span class="lp-pdp__price">${fmt(price)}</span>
                ${onSale ? `<span class="lp-pdp__price-was">${fmt(compareAt)}</span><span class="lp-pdp__discount">-${off}%</span>` : ''}
            </div>
            ${stockBadge}
            ${quickHtml}
            ${variantsHtml ? `<div class="lp-pdp__section"><h4 class="lp-pdp__section-title">Options (${state.variants.length})</h4><div class="lp-pdp__variants">${variantsHtml}</div></div>` : ''}
            ${descHtml}
            ${specsHtml}
            <div class="lp-pdp__cta-row">
                <div class="lp-pdp__qty">
                    <button type="button" onclick="window.lpPdpQty(-1)" ${state.qty <= 1 ? 'disabled' : ''}>−</button>
                    <input type="number" id="lpPdpQtyInput" value="${state.qty}" min="1" max="${Math.max(1, totalStock)}" onchange="window.lpPdpQtySet(this.value)">
                    <button type="button" onclick="window.lpPdpQty(1)" ${state.qty >= totalStock ? 'disabled' : ''}>+</button>
                </div>
                <button class="lp-pdp__cta" onclick="window.lpPdpAddToCart()" ${totalStock <= 0 ? 'disabled' : ''}>${totalStock <= 0 ? 'Sold Out' : 'Add to Cart'}</button>
            </div>
        </div>
    `;
};

window.lpPdpPickImage = function(idx) {
    if (!window.lpPdpState) return;
    window.lpPdpState.imgIdx = idx;
    window.lpRenderPdp();
};

window.lpPdpSelectVariant = function(sku) {
    if (!window.lpPdpState) return;
    window.lpPdpState.currentSku = sku;
    window.lpPdpState.imgIdx = 0;
    window.lpPdpState.qty = 1;
    window.lpRenderPdp();
};

window.lpPdpQty = function(delta) {
    if (!window.lpPdpState) return;
    const next = (window.lpPdpState.qty || 1) + delta;
    if (next < 1) return;
    window.lpPdpState.qty = next;
    window.lpRenderPdp();
};

window.lpPdpQtySet = function(val) {
    if (!window.lpPdpState) return;
    const q = Math.max(1, parseInt(val, 10) || 1);
    window.lpPdpState.qty = q;
    window.lpRenderPdp();
};

window.lpPdpAddToCart = function() {
    if (!window.lpPdpState) return;
    const sku = window.lpPdpState.currentSku;
    const qty = window.lpPdpState.qty || 1;
    if (typeof addToPublicCart === 'function') {
        for (let i = 0; i < qty; i++) addToPublicCart(sku);
    }
    window.lpClosePdp();
};

// ESC closes the PDP if open
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const modal = document.getElementById('lpPdpModal');
        if (modal && !modal.hidden) window.lpClosePdp();
    }
});

// p1_54: event SKU groups are operational staff data (e.g. OutdoorExpo booth catalogues), not real customer products.
// Add new event keywords here as staff create new event groups in EasyStore.
window.LP_EVENT_KEYWORDS = ['OUTDOOREXPO'];
window.lpIsEventSku = function(p) {
    if (!p || !window.LP_EVENT_KEYWORDS || !window.LP_EVENT_KEYWORDS.length) return false;
    const haystack = ((p.parent_sku || '') + ' ' + (p.sku || '') + ' ' + (p.name || '')).toUpperCase();
    return window.LP_EVENT_KEYWORDS.some(k => haystack.includes(String(k).toUpperCase()));
};

function renderPublicStorefront() {
    const list = document.getElementById("publicProductsList");
    if(!list) return;
    if(typeof masterProducts === 'undefined' || !Array.isArray(masterProducts)) {
        window.lpRenderSkeletons();
        return;
    }

    let filtered = masterProducts.filter(p => isPublished(p) && !window.lpIsEventSku(p));
    if(window.lpSearchTerm) {
        const q = window.lpSearchTerm;
        filtered = filtered.filter(p => (p.name||'').toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q) || (p.brand||'').toLowerCase().includes(q));
    }
    // p1_47: activity filter (broader bucket) applies first so category pill stays scoped
    // p1_48: filters use lpRealCategory so brand-named cats remap to real ones
    if(window.lpActiveActivity && window.LP_ACTIVITY_GROUPS && window.LP_ACTIVITY_GROUPS[window.lpActiveActivity]) {
        const allowed = new Set(window.LP_ACTIVITY_GROUPS[window.lpActiveActivity].cats);
        filtered = filtered.filter(p => allowed.has(window.lpRealCategory(p)));
    }
    if(window.lpActiveCategory && window.lpActiveCategory !== 'SALE') {
        filtered = filtered.filter(p => (window.lpRealCategory(p) || 'Uncat') === window.lpActiveCategory);
    }
    if(window.lpActiveCategory === 'SALE') {
        // Treat anything with discount or specific sale flag as "sale"
        filtered = filtered.filter(p => p.is_sale || p.compare_at_price > p.price || p.discount);
    }

    // p1_46: collapse variants — 1 card per parent_sku
    const groups = window.lpGroupVariants(filtered);

    const itemsPerPg = (typeof itemsPerPage === 'number' ? itemsPerPage : 20);
    const totalPages = Math.ceil(groups.length / itemsPerPg) || 1;
    if(publicCurrentPage > totalPages) publicCurrentPage = totalPages;
    if(publicCurrentPage < 1) publicCurrentPage = 1;
    const sliced = groups.slice((publicCurrentPage - 1) * itemsPerPg, publicCurrentPage * itemsPerPg);

    if(!sliced.length) {
        list.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:60px 20px; color:#9CA3AF;"><p style="font-size:16px;">No products match your search.</p><button class="lp-btn lp-btn--primary lp-btn--sm" style="margin-top:14px;" onclick="window.lpHandleSearch(\'\'); window.lpFilterCategory(\'\')">Clear filters</button></div>';
        return;
    }

    const fmt = (n) => 'RM ' + (Number.isInteger(n) ? n : n.toFixed(2));
    let html = '';
    sliced.forEach((variants, gIdx) => {
        // p1_55: pick the first in-stock variant as the card lead so groups with sold-out variants[0]
        // but live siblings stop reading as "Sold Out". Sold-out badge only when the whole group is out.
        const stockBySku = {};
        let groupTotalStock = 0;
        variants.forEach(v => {
            const s = inventoryBatches.filter(b => b.sku === v.sku && b.qty_remaining > 0).reduce((sum, b) => sum + b.qty_remaining, 0);
            stockBySku[v.sku] = s;
            groupTotalStock += s;
        });
        const inStockIdx = variants.findIndex(v => stockBySku[v.sku] > 0);
        if (inStockIdx > 0) { const promoted = variants.splice(inStockIdx, 1)[0]; variants.unshift(promoted); }
        const lead = variants[0];
        const cardKey = (lead.parent_sku || lead.sku || ('idx' + gIdx)).replace(/[^a-zA-Z0-9]/g, '_');
        const cardId = 'lpCard_' + gIdx + '_' + cardKey;
        const totalStock = stockBySku[lead.sku] || 0;
        const thumb = lead.images && lead.images[0] ? lead.images[0] : "https://placehold.co/300x300?text=No+Img";
        const compareAt = parseFloat(lead.compare_at_price || 0);
        const price = parseFloat(lead.price || 0);
        const onSale = compareAt > price && price > 0;
        let badge = '';
        if(groupTotalStock <= 0) badge = '<span class="lp-product-card__badge lp-product-card__badge--soldout">Sold Out</span>';
        else if(onSale) {
            const off = Math.round(((compareAt - price) / compareAt) * 100);
            badge = '<span class="lp-product-card__badge">-' + off + '%</span>';
        }
        if(variants.length > 1) {
            badge = (badge ? badge + ' ' : '') + '<span class="lp-product-card__badge lp-product-card__badge--variant">' + variants.length + ' options</span>';
        }
        const parsed = window.lpParseProductName(lead);
        const skuEsc = String(lead.sku).replace(/'/g, "\\'");
        // p1_48: use cleaned category for the badge so customer never sees raw "BLACKDOG"
        const cleanCat = window.lpRealCategory(lead);
        const sameBC = lead.brand && cleanCat && lead.brand.toLowerCase().replace(/\s/g,'') === cleanCat.toLowerCase().replace(/\s/g,'');
        const brandPill = lead.brand ? `<span class="lp-product-card__brand">${lead.brand}</span>` : '';
        const catPill = (!sameBC && cleanCat) ? `<span class="lp-product-card__cat">${cleanCat}</span>` : '';
        let chipsHtml = '';
        if (variants.length > 1) {
            // p1_51: cap visible chips at 3, push the rest into a hidden row revealed by "+N more"
            const MAX_VISIBLE_CHIPS = 3;
            const renderChip = (v, i) => {
                const vp = window.lpParseProductName(v);
                const label = (vp.variantName || v.variant_color || v.variant_size || ('Pilihan ' + (i + 1))).slice(0, 24);
                const isActive = i === 0 ? ' is-active' : '';
                const vSkuEsc = String(v.sku).replace(/'/g, "\\'");
                return `<button type="button" class="lp-variant-chip${isActive}" onclick="window.lpSelectVariant('${cardId}', '${vSkuEsc}', this)">${label}</button>`;
            };
            const visible = variants.slice(0, MAX_VISIBLE_CHIPS);
            const hidden = variants.slice(MAX_VISIBLE_CHIPS);
            chipsHtml = '<div class="lp-variant-chips">';
            visible.forEach((v, i) => { chipsHtml += renderChip(v, i); });
            if (hidden.length) {
                chipsHtml += `<button type="button" class="lp-variant-chip lp-variant-more" onclick="window.lpExpandChips(this)">+${hidden.length} more</button>`;
            }
            chipsHtml += '</div>';
            if (hidden.length) {
                chipsHtml += '<div class="lp-variant-chips lp-variant-chips--extra" hidden>';
                hidden.forEach((v, i) => { chipsHtml += renderChip(v, MAX_VISIBLE_CHIPS + i); });
                chipsHtml += '</div>';
            }
        }
        html += `
            <div class="lp-product-card" id="${cardId}">
                <div class="lp-product-card__media" onclick="window.lpOpenProductDetail('${skuEsc}')">
                    ${badge}
                    <img class="lp-product-card__img" src="${thumb}" alt="${parsed.title.replace(/"/g,'&quot;')}" loading="lazy" onerror="this.src='https://placehold.co/300x300?text=No+Img'">
                </div>
                <div class="lp-product-card__body">
                    <div class="lp-product-card__meta">${brandPill}${catPill}</div>
                    <h3 class="lp-product-card__name" onclick="window.lpOpenProductDetail('${skuEsc}')">${parsed.title}</h3>
                    <p class="lp-product-card__variant" data-role="variant-label" style="${parsed.variantName ? '' : 'display:none'}">${parsed.variantName || ''}</p>
                    <p class="lp-product-card__price" data-role="price">${fmt(price)}${onSale ? ' <small style="color:#9CA3AF; font-weight:500; text-decoration:line-through; font-size:11px; margin-left:6px;">' + fmt(compareAt) + '</small>' : ''}</p>
                    ${chipsHtml}
                    <button class="lp-product-card__btn" data-role="add-btn" data-sku="${skuEsc}" onclick="addToPublicCart(this.dataset.sku)" ${totalStock <= 0 ? 'disabled' : ''}>${totalStock <= 0 ? 'Sold Out' : 'Add to Cart'}</button>
                </div>
            </div>
        `;
    });

    html += `
        <div style="width:100%; display:flex; justify-content:center; align-items:center; gap:14px; margin-top:30px; grid-column:1/-1;">
            <button onclick="changePublicPage(-1)" ${publicCurrentPage <= 1 ? 'disabled' : ''} class="lp-pill" style="padding:8px 16px;">← Back</button>
            <span style="font-size:13px; color:#6B7280; font-weight:600;">Page <strong style="color:#111827;">${publicCurrentPage}</strong> / ${totalPages}</span>
            <button onclick="changePublicPage(1)" ${publicCurrentPage >= totalPages ? 'disabled' : ''} class="lp-pill" style="padding:8px 16px;">Next →</button>
        </div>
    `;
    list.innerHTML = html;
    window.lpUpdateCartBadge();
    if(window.lucide && lucide.createIcons) lucide.createIcons();
}

// Boot: render skeletons + category pills + activity tiles + promo banner ASAP
document.addEventListener('DOMContentLoaded', function() {
    window.lpRenderSkeletons();
    setTimeout(() => {
        window.lpRenderActivityTiles();
        window.lpRenderCategoryPills();
        window.lpRefreshPromoBanner();
        window.lpUpdateCartBadge();
    }, 500);
});

let publicCart = [];

window.togglePublicCart = function() {
 const drw = document.getElementById("publicCartDrawer");
 if(drw.style.display === "none") {
 if(currentPublicCustomer) {
 document.getElementById("custNamePub").value = currentPublicCustomer.name !== "Pelanggan VIP" ? currentPublicCustomer.name : "";
 document.getElementById("custPhonePub").value = currentPublicCustomer.phone || "";
 document.getElementById("custAddressPub").value = currentPublicCustomer.address || "";
 }
 drw.style.display = "flex";
 renderPublicCart();
 } else {
 drw.style.display = "none";
 }
}

window.addToPublicCart = function(sku) {
 const p = masterProducts.find(x => x.sku === sku);
 const totalAvail = inventoryBatches.filter(b => b.sku === sku && b.qty_remaining> 0).reduce((s, b) => s + b.qty_remaining, 0);
 const cartItem = publicCart.find(c => c.sku === sku);
 
 if(cartItem) { if (cartItem.quantity < totalAvail) cartItem.quantity++; else (typeof showToast==='function'?showToast('Stok tak cukup','warning'):alert('Limits reached!')); }
 else { if (totalAvail> 0) publicCart.push({ sku: sku, name: p.name, price: parseFloat(p.price), quantity: 1 }); }
 
 if(typeof window.lpUpdateCartBadge === 'function') window.lpUpdateCartBadge();
 if (typeof showToast==='function') showToast('Ditambah ke troli', 'success'); else alert('Ditambah ke troli!');
}

window.decreasePublicQty = function(sku) {
 const c = publicCart.find(x => x.sku === sku);
 if(c) { if(c.quantity> 1) c.quantity--; else publicCart = publicCart.filter(x => x.sku !== sku); }
 renderPublicCart();
}

window.increasePublicQty = function(sku) {
 const p = masterProducts.find(x => x.sku === sku);
 const totalAvail = inventoryBatches.filter(b => b.sku === sku && b.qty_remaining> 0).reduce((s, b) => s + b.qty_remaining, 0);
 const cartItem = publicCart.find(c => c.sku === sku);
 if(cartItem) { if (cartItem.quantity < totalAvail) cartItem.quantity++; } 
 renderPublicCart();
}

window.removePublicCart = function(sku) {
 publicCart = publicCart.filter(c => c.sku !== sku); 
 renderPublicCart(); 
}

function renderPublicCart() {
 const container = document.getElementById("publicCartItems");
 const label = document.getElementById("publicCartTotalLabel");
 if(typeof window.lpUpdateCartBadge === 'function') window.lpUpdateCartBadge();
 
 if(!container) return; 
 container.innerHTML = ""; 
 let total = 0;
 
 if(publicCart.length === 0) { container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding-top:20px;">Your cart is empty.</p>'; label.textContent = "0.00"; return; }

 publicCart.forEach(item => {
 total = round2(total + item.price * item.quantity);
 container.innerHTML += `
 <div style="display:flex; justify-content:space-between; margin-bottom:15px; border-bottom:1px solid #f9f9f9; padding-bottom:10px;">
 <div>
 <strong style="font-size:14px; display:block;">${item.name}</strong>
 <small style="color:var(--text-muted);">RM${item.price.toFixed(2)} x ${item.quantity}</small>
 </div>
 <div style="display:flex; gap:8px; align-items:center;">
 <button onclick="decreasePublicQty('${item.sku}')" style="border:1px solid #ddd; background:#fff; width:24px; height:24px; cursor:pointer;">-</button>
 <span>${item.quantity}</span>
 <button onclick="increasePublicQty('${item.sku}')" style="border:1px solid #ddd; background:#fff; width:24px; height:24px; cursor:pointer;">+</button>
 <button onclick="removePublicCart('${item.sku}')" style="color:red; background:none; border:none; cursor:pointer; margin-left:5px;">X</button>
 </div>
 </div>`;
 });
 label.textContent = total.toFixed(2);
}

window.processPublicCheckout = async function() {
 if(publicCart.length === 0) return alert("Cart is empty!");
 
 const cName = document.getElementById("custNamePub").value.trim();
 const cPhone = document.getElementById("custPhonePub").value.trim();
 const cAddr = document.getElementById("custAddressPub").value.trim();
 
 if(!cName || !cPhone || !cAddr) return alert("Sila isikan Nama, Telefon, dan Alamat Penghantaran dengan lengkap!");
 
 const btn = document.getElementById("btnPublicCheckout");
 btn.disabled = true; btn.textContent = "Processing Payment...";

 try {
 let transactionsPayload = []; let totalVal = 0;

 for (const item of publicCart) {
 totalVal = round2(totalVal + item.price * item.quantity);
 let needed = item.quantity;
 let batches = inventoryBatches.filter(b => b.sku===item.sku && b.qty_remaining>0).sort((a,b) => new Date(a.inbound_date) - new Date(b.inbound_date));
 
 for (let batch of batches) {
 if (needed <= 0) break;
 let deduct = Math.min(needed, batch.qty_remaining);
 needed -= deduct;
 await db.from('inventory_batches').update({qty_remaining: batch.qty_remaining - deduct}).eq('id', batch.id);
 transactionsPayload.push({sku: item.sku, batch_id: batch.id, transaction_type: 'OUTBOUND_SALE', qty_change: -deduct});
 }
 }

 if(transactionsPayload.length> 0) await db.from('inventory_transactions').insert(transactionsPayload);

 // Points System Concept (RM 1 = 1 Point)
 const earnedPoints = Math.floor(totalVal);
 let existing = null;
 if(currentPublicCustomer) {
 existing = currentPublicCustomer;
 currentPublicCustomer.name = cName;
 currentPublicCustomer.address = cAddr;
 await db.from('customers').update({name: cName, address: cAddr, points: (existing.points || 0) + earnedPoints}).eq('id', existing.id);
 } else {
 existing = customersData.find(c => c.phone === cPhone || c.name.toLowerCase() === cName.toLowerCase());
 if(!existing) {
 await db.from('customers').insert([{name: cName, phone: cPhone, address: cAddr, points: earnedPoints}]);
 } else {
 await db.from('customers').update({points: (existing.points || 0) + earnedPoints}).eq('id', existing.id);
 }
 }

 // Push to Sales History as E-Commerce Website Order
 const invStr = "WEB-10C-" + Math.floor(1000 + Math.random() * 9000);
 await db.from('sales_history').insert([{
 channel: 'Website',
 status: 'Pending Fulfillment',
 customer_name: cName, 
 payment_method: 'Online Transfer',
 total: totalVal, 
 items: publicCart
 }]);

 publicCart = []; 
 document.getElementById("custNamePub").value = "";
 document.getElementById("custPhonePub").value = "";
 document.getElementById("custAddressPub").value = "";
 
 // Let the customer see the simulated success pop up
 togglePublicCart();
 alert(`Pembayaran Berjaya! Nombor Resit: ${invStr}.\nTerima kasih kerana membeli bersama 10camp.`);
 
 await initApp(); // refresh background dashboard data
 } catch (e) { console.error(e); if (typeof showToast==='function') showToast('Fatal Error: ' + e.message, 'error'); else alert('Fatal Error: ' + e.message); }
 
 btn.disabled = false; btn.textContent = "Confirm Order";
}

// ===================================
// E-RECEIPT & EMAIL SYSTEM
// ===================================
let currentReceiptContext = null;

function showReceiptModal(invId, custName, email, total, cartData) {
 const rc = document.getElementById("receiptContent");
 const d = new Date().toLocaleString('en-GB');
 const shop = (typeof window.getShopInfo === 'function') ? window.getShopInfo() : { name:'10 CAMP', footer:'THANK YOU FOR SHOPPING AT 10 CAMP' };
 let itemsHtml = "";
 cartData.forEach(c => {
 itemsHtml += `<div style="margin-bottom:5px;">${c.quantity}x ${c.name} <span style="float:right">RM ${(c.price * c.quantity).toFixed(2)}</span></div>`;
 });

 let header = `<div style="text-align:center; font-size:16px; font-weight:900; letter-spacing:1px;">${shop.name}</div>`;
 if (shop.address) header += `<div style="text-align:center; font-size:11px; color:var(--text-muted);">${shop.address}</div>`;
 if (shop.phone) header += `<div style="text-align:center; font-size:11px; color:var(--text-muted);">Tel: ${shop.phone}</div>`;
 if (shop.ssm) header += `<div style="text-align:center; font-size:10.5px; color:var(--text-muted);">SSM: ${shop.ssm}</div>`;

 rc.innerHTML = `
 ${header}
 <hr style="border-top:1px dashed #ccc; margin:10px 0;">
 <div style="font-weight:bold; margin-bottom:10px;">INVOICE: ${invId}</div>
 <div style="color:var(--text-muted);">Date: ${d}</div>
 <div style="color:var(--text-muted);">Customer: ${custName}</div>
 <div style="color:var(--text-muted); margin-bottom:10px;">Cashier: ${currentUser?.name || 'Staff'}</div>
 <hr style="border-top:1px dashed #ccc; margin:10px 0;">
 ${itemsHtml}
 <hr style="border-top:1px dashed #ccc; margin:10px 0;">
 <div style="font-size:16px; font-weight:bold;">TOTAL <span style="float:right">RM ${total.toFixed(2)}</span></div>
 <div style="text-align:center; margin-top:30px; font-weight:bold; font-size:11px; color:var(--text-muted);">${shop.footer || 'THANK YOU'}</div>
 `;
 
 const phone = (document.getElementById("customerPhone")?.value || '').trim();
 currentReceiptContext = {
 invId, custName, email, phone, total,
 itemsText: cartData.map(c => `${c.quantity}x ${c.name} - RM ${(c.price * c.quantity).toFixed(2)}`).join('%0D%0A'),
 cartData: cartData.map(c => ({ sku:c.sku, name:c.name, price:c.price, quantity:c.quantity }))
 };
 document.getElementById("receiptModal").style.display = "flex";
}

// Build reorder deep-link: same site + ?reorder=<base64 JSON>
function buildReorderLink(cartItems) {
 try {
 const minimal = (cartItems||[]).map(c => ({ s:c.sku, q:c.quantity }));
 const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(minimal))));
 const base = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
 return base + 'index.html?reorder=' + encodeURIComponent(b64);
 } catch(e) { return ''; }
}

// Send receipt via WhatsApp using wa.me link (opens user's WhatsApp app)
window.dispatchWhatsAppReceipt = function() {
 if (!currentReceiptContext) return;
 const { invId, custName, phone, total, cartData } = currentReceiptContext;
 let target = (phone||'').replace(/[^\d+]/g, '');
 // Normalize to international format. Default MY +60 if local.
 if (target.startsWith('0')) target = '60' + target.slice(1);
 else if (target.startsWith('+')) target = target.slice(1);

 const shop = (typeof window.getShopInfo === 'function') ? window.getShopInfo() : { name:'10 CAMP' };
 const itemsList = (cartData||[]).map(c => `• ${c.quantity}x ${c.name} — RM ${(c.price*c.quantity).toFixed(2)}`).join('\n');
 const reorderUrl = buildReorderLink(cartData);

 const lines = [
 `Hi ${custName||'there'},`,
 ``,
 `Terima kasih beli barang dari *${shop.name}*!`,
 ``,
 ` Receipt: *${invId}*`,
 ` ${new Date().toLocaleString('en-MY')}`,
 ``,
 `*Items:*`,
 itemsList,
 ``,
 `*TOTAL: RM ${total.toFixed(2)}*`,
 ``
];
 if (reorderUrl) {
 lines.push(` Reorder semua benda ni: ${reorderUrl}`);
 lines.push('');
 }
 lines.push(shop.footer || 'Hope to see you again!');
 const text = lines.join('\n');

 // wa.me opens WhatsApp Web/app with pre-filled message. Phone target optional.
 const url = target
 ? `https://wa.me/${target}?text=${encodeURIComponent(text)}`
 : `https://wa.me/?text=${encodeURIComponent(text)}`;
 window.open(url, '_blank');
};

window.closeReceipt = function() {
 document.getElementById("receiptModal").style.display = "none";
};

document.getElementById("sendEmailBtn").onclick = function() {
 if(!currentReceiptContext) return;
 const { invId, custName, email, total, itemsText } = currentReceiptContext;
 const targetEmail = email || "";
 if(!targetEmail) { alert("Sila masukkan emel pelanggan terlebih dahulu sebelum menghantar resit."); return; }

 const subject = `E-Receipt ${invId} from 10camp`;
 const body = `Hi ${custName},%0D%0A%0D%0AThank you for shopping at 10camp! Here is your e-receipt:%0D%0A%0D%0AInvoice: ${invId}%0D%0A%0D%0AItems:%0D%0A${itemsText}%0D%0A%0D%0ATOTAL: RM ${total.toFixed(2)}%0D%0A%0D%0AHope to see you again soon!`;
 
 window.location.href = `mailto:${targetEmail}?subject=${subject}&body=${body}`;
};

// ===================================
// FINANCE & P&L MODULE (SUPER ADMIN)
// ===================================
// =============================================================
// p1_18 FINANCE & MEMO REDESIGN — owner-grade dashboard
// =============================================================
const FIN_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
window.formatRM = function(n) {
 const v = parseFloat(n) || 0;
 return 'RM ' + v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
window.formatRMShort = function(n) {
 const v = Math.abs(parseFloat(n) || 0);
 if(v>= 1000000) return 'RM ' + (v/1000000).toFixed(1) + 'M';
 if(v>= 1000) return 'RM ' + (v/1000).toFixed(1) + 'K';
 return 'RM ' + v.toFixed(0);
};
window.__finRange = 'month';
let __finRevDonut = null, __finExpDonut = null;

window.finSetRange = function(range, btn) {
 window.__finRange = range;
 document.querySelectorAll('[data-fin-range]').forEach(b => b.classList.toggle('fin-pill--active', b === btn));
 window.finRender();
};

// Returns {start: Date, end: Date, label: string} for current range
function __finGetPeriod() {
 const now = new Date();
 const y = now.getFullYear(), m = now.getMonth();
 let start, end, label;
 switch(window.__finRange) {
 case 'lastmonth':
 start = new Date(y, m-1, 1); end = new Date(y, m, 0, 23,59,59);
 label = FIN_MONTHS[start.getMonth()] + ' ' + start.getFullYear();
 break;
 case 'quarter':
 const qStart = Math.floor(m/3)*3;
 start = new Date(y, qStart, 1); end = new Date(y, qStart+3, 0, 23,59,59);
 label = 'Q' + (Math.floor(m/3)+1) + ' ' + y;
 break;
 case 'ytd':
 start = new Date(y, 0, 1); end = new Date(y, 11, 31, 23,59,59);
 label = 'YTD ' + y; break;
 case 'all':
 start = new Date(2000, 0, 1); end = new Date(2099, 11, 31);
 label = 'All Time'; break;
 case 'month':
 default:
 start = new Date(y, m, 1); end = new Date(y, m+1, 0, 23,59,59);
 label = FIN_MONTHS[m] + ' ' + y;
 }
 return { start, end, label };
}

// Period for last comparable period (for MoM% delta)
function __finGetPreviousPeriod() {
 const now = new Date();
 const y = now.getFullYear(), m = now.getMonth();
 switch(window.__finRange) {
 case 'lastmonth': return { start: new Date(y, m-2, 1), end: new Date(y, m-1, 0, 23,59,59) };
 case 'quarter': const qS = Math.floor(m/3)*3; return { start: new Date(y, qS-3, 1), end: new Date(y, qS, 0, 23,59,59) };
 case 'ytd': return { start: new Date(y-1, 0, 1), end: new Date(y-1, 11, 31, 23,59,59) };
 case 'all': return null;
 default: return { start: new Date(y, m-1, 1), end: new Date(y, m, 0, 23,59,59) };
 }
}

// Sum revenue from salesHistory between dates (excludes refunds: total<=0)
function __finSumRevenue(start, end) {
 let sum = 0;
 (salesHistory || []).forEach(s => {
 const d = new Date(s.created_at || s.timestamp || s.sale_date);
 if(isNaN(d) || d < start || d> end) return;
 const amt = parseFloat(s.amount || s.total || s.total_amount || 0);
 if(amt> 0) sum += amt; // skip refund rows
 });
 return sum;
}

// Sum expenses from financeRecords for month/year matching period
function __finSumExpenses(start, end, categoryFilter) {
 let sum = 0;
 (financeRecords || []).forEach(f => {
 const monthIdx = FIN_MONTHS.indexOf(f.month);
 if(monthIdx < 0) return;
 const recDate = new Date(parseInt(f.year), monthIdx, 15);
 if(recDate < start || recDate> end) return;
 if(categoryFilter && f.category !== categoryFilter) return;
 sum += parseFloat(f.amount || 0);
 });
 return sum;
}

// Outstanding receivables — unpaid quotations/invoices
function __finOutstandingAR() {
 const quotes = window.quotationsLog || [];
 let sum = 0, count = 0;
 quotes.forEach(q => {
 if(q.status === 'paid' || q.status === 'cancelled' || q.status === 'voided') return;
 if(q.doc_type !== 'invoice' && q.type !== 'invoice') return; // only invoices count as AR
 const amt = parseFloat(q.grand_total || q.total || 0);
 if(amt> 0) { sum += amt; count++; }
 });
 return { sum, count };
}

// Render delta vs previous period
function __finRenderDelta(elId, current, previous, isExpense) {
 const el = document.getElementById(elId);
 if(!el) return;
 if(previous == null) { el.textContent = '—'; el.className = 'fin-kpi__delta'; return; }
 if(previous === 0) {
 if(current === 0) { el.textContent = '—'; el.className = 'fin-kpi__delta'; return; }
 el.textContent = current> 0 ? '↑ baru' : '↓';
 el.className = 'fin-kpi__delta ' + (isExpense ? 'down' : 'up');
 return;
 }
 const pct = ((current - previous) / Math.abs(previous)) * 100;
 const arrow = pct>= 0 ? '↑' : '↓';
 const goodDirection = isExpense ? pct < 0 : pct> 0;
 el.textContent = arrow + ' ' + Math.abs(pct).toFixed(1) + '% vs prev';
 el.className = 'fin-kpi__delta ' + (Math.abs(pct) < 0.5 ? '' : (goodDirection ? 'up' : 'down'));
}

window.finRender = function() {
 if(!document.getElementById('financeSection')) return;
 const period = __finGetPeriod();
 const prev = __finGetPreviousPeriod();
 const lblEl = document.getElementById('finRangeLabel');
 if(lblEl) lblEl.textContent = '· ' + period.label;

 // KPIs
 const rev = __finSumRevenue(period.start, period.end);
 const exp = __finSumExpenses(period.start, period.end);
 const net = rev - exp;
 const margin = rev> 0 ? (net / rev) * 100 : 0;
 const ar = __finOutstandingAR();

 document.getElementById('finKpiRevenue').textContent = formatRM(rev);
 document.getElementById('finKpiExpense').textContent = formatRM(exp);
 const netEl = document.getElementById('finKpiNet');
 netEl.textContent = formatRM(net);
 netEl.style.color = net>= 0 ? '#10B981' : '#EF4444';
 document.getElementById('finKpiAR').textContent = formatRM(ar.sum);
 document.getElementById('finKpiARDelta').textContent = ar.count + ' invois';
 document.getElementById('finKpiMargin').textContent = margin.toFixed(1) + '%';

 // Deltas
 if(prev) {
 const prevRev = __finSumRevenue(prev.start, prev.end);
 const prevExp = __finSumExpenses(prev.start, prev.end);
 const prevNet = prevRev - prevExp;
 const prevMargin = prevRev> 0 ? (prevNet/prevRev)*100 : 0;
 __finRenderDelta('finKpiRevenueDelta', rev, prevRev, false);
 __finRenderDelta('finKpiExpenseDelta', exp, prevExp, true);
 __finRenderDelta('finKpiNetDelta', net, prevNet, false);
 __finRenderDelta('finKpiMarginDelta', margin, prevMargin, false);
 } else {
 ['finKpiRevenueDelta','finKpiExpenseDelta','finKpiNetDelta','finKpiMarginDelta'].forEach(id => {
 const el = document.getElementById(id); if(el) { el.textContent = '—'; el.className = 'fin-kpi__delta'; }
 });
 }

 // Insights — auto-flagged alerts
 __finRenderInsights({ rev, exp, net, margin, ar, period, prev });

 // Donuts
 __finRenderRevenueDonut(period);
 __finRenderExpenseDonut(period);

 // Trend chart
 __finRenderTrendChart();

 // Ledger
 __finRenderLedger();
};

function __finRenderInsights(ctx) {
 const wrap = document.getElementById('finInsights');
 if(!wrap) return;
 const insights = [];
 // Negative net
 if(ctx.net < 0) insights.push({ type:'danger', icon:'', text:`Net loss: ${formatRM(Math.abs(ctx.net))}. Kena cut OPEX atau push revenue.` });
 // Expense spike
 if(ctx.prev) {
 const prevExp = __finSumExpenses(ctx.prev.start, ctx.prev.end);
 if(prevExp> 0 && (ctx.exp - prevExp) / prevExp> 0.2) {
 insights.push({ type:'warn', icon:'', text:`Expense naik ${(((ctx.exp-prevExp)/prevExp)*100).toFixed(0)}% vs period sebelum (${formatRM(prevExp)} → ${formatRM(ctx.exp)}). Review.` });
 }
 }
 // Outstanding AR
 if(ctx.ar.count>= 3) insights.push({ type:'warn', icon:'', text:`${ctx.ar.count} invois belum dibayar (${formatRM(ctx.ar.sum)}). Hantar reminder.` });
 // Healthy margin
 if(ctx.margin>= 30 && ctx.rev> 0) insights.push({ type:'ok', icon:'', text:`Margin sihat: ${ctx.margin.toFixed(1)}%. Keep it up.` });
 // No revenue
 if(ctx.rev === 0 && window.__finRange !== 'all') insights.push({ type:'info', icon:'ℹ', text:`Tiada sales recorded period ni. Cek tab Sales Ledger atau pastikan data sync.` });

 wrap.innerHTML = insights.map(i =>
 `<div class="fin-insight fin-insight--${i.type}">${i.icon} ${escapeHtml(i.text)}</div>`
).join('');
}

function escapeHtml(s) { return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function __finRenderRevenueDonut(period) {
 const ctx = document.getElementById('finRevDonut');
 if(!ctx) return;
 // Split: POS (sales without invoice ref) vs B2B Invoices vs Quote conversions
 let pos = 0, b2b = 0, quoteConv = 0;
 (salesHistory || []).forEach(s => {
 const d = new Date(s.created_at || s.timestamp);
 if(isNaN(d) || d < period.start || d> period.end) return;
 const amt = parseFloat(s.amount || s.total || 0);
 if(amt <= 0) return;
 const meta = s.metadata || {};
 if(meta.from_quote || s.from_quote_ref) quoteConv += amt;
 else if(meta.is_b2b || s.customer_tin || meta.invoice_ref) b2b += amt;
 else pos += amt;
 });
 const data = [pos, b2b, quoteConv];
 const labels = ['POS Cashier', 'B2B Invoice', 'Quote → Sale'];
 const colors = ['#10B981', '#3B82F6', '#8B5CF6'];
 if(__finRevDonut) __finRevDonut.destroy();
 if(typeof Chart === 'undefined') return;
 __finRevDonut = new Chart(ctx, {
 type: 'doughnut',
 data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#FFF' }] },
 options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
 });
 const total = data.reduce((a,b)=>a+b,0);
 document.getElementById('finRevLegend').innerHTML = labels.map((l,i) =>
 `<span class="fin-legend__item"><span class="fin-legend__dot" style="background:${colors[i]}"></span>${l}: <strong>${formatRM(data[i])}</strong> ${total>0?'('+(data[i]/total*100).toFixed(0)+'%)':''}</span>`
).join('');
}

function __finRenderExpenseDonut(period) {
 const ctx = document.getElementById('finExpDonut');
 if(!ctx) return;
 const cats = { OPEX: 0, COGS: 0, CAPEX: 0 };
 (financeRecords || []).forEach(f => {
 const monthIdx = FIN_MONTHS.indexOf(f.month);
 if(monthIdx < 0) return;
 const recDate = new Date(parseInt(f.year), monthIdx, 15);
 if(recDate < period.start || recDate> period.end) return;
 if(cats[f.category] !== undefined) cats[f.category] += parseFloat(f.amount || 0);
 });
 const data = [cats.OPEX, cats.COGS, cats.CAPEX];
 const labels = ['OPEX', 'COGS', 'CAPEX'];
 const colors = ['#EF4444', '#F59E0B', '#8B5CF6'];
 if(__finExpDonut) __finExpDonut.destroy();
 if(typeof Chart === 'undefined') return;
 __finExpDonut = new Chart(ctx, {
 type: 'doughnut',
 data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#FFF' }] },
 options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
 });
 const total = data.reduce((a,b)=>a+b,0);
 document.getElementById('finExpLegend').innerHTML = labels.map((l,i) =>
 `<span class="fin-legend__item"><span class="fin-legend__dot" style="background:${colors[i]}"></span>${l}: <strong>${formatRM(data[i])}</strong> ${total>0?'('+(data[i]/total*100).toFixed(0)+'%)':''}</span>`
).join('');
}

function __finRenderTrendChart() {
 const ctx = document.getElementById('financeChart');
 if(!ctx || typeof Chart === 'undefined') return;
 // Last 12 months
 const now = new Date();
 const labels = [], revData = [], expData = [], netData = [];
 for(let i = 11; i>= 0; i--) {
 const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
 const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23,59,59);
 const r = __finSumRevenue(d, end);
 const e = __finSumExpenses(d, end);
 labels.push(FIN_MONTHS[d.getMonth()] + ' ' + (d.getFullYear() % 100));
 revData.push(r); expData.push(e); netData.push(r - e);
 }
 if(financeChartInstance) financeChartInstance.destroy();
 financeChartInstance = new Chart(ctx, {
 type: 'bar',
 data: { labels, datasets: [
 { label: 'Revenue', data: revData, backgroundColor: 'rgba(16,185,129,0.6)', borderColor:'#10B981', borderWidth:1 },
 { label: 'Expense', data: expData, backgroundColor: 'rgba(239,68,68,0.6)', borderColor:'#EF4444', borderWidth:1 },
 { label: 'Net', data: netData, type: 'line', borderColor: '#B45309', backgroundColor: 'rgba(180,83,9,0.1)', tension: 0.3, fill: true }
]},
 options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
 });
}

function __finRenderLedger() {
 const tbody = document.getElementById('financeLedgerBody');
 if(!tbody) return;
 const period = __finGetPeriod();
 const catFilter = (document.getElementById('finLedgerCatFilter')||{}).value || '';
 const search = ((document.getElementById('finLedgerSearch')||{}).value || '').toLowerCase();
 let rows = (financeRecords || []).slice().filter(f => {
 const monthIdx = FIN_MONTHS.indexOf(f.month);
 if(monthIdx < 0) return false;
 const d = new Date(parseInt(f.year), monthIdx, 15);
 if(d < period.start || d> period.end) return false;
 if(catFilter && f.category !== catFilter) return false;
 if(search && !(f.description||'').toLowerCase().includes(search)) return false;
 return true;
 });
 rows.sort((a,b)=> (parseInt(b.year)-parseInt(a.year)) || (FIN_MONTHS.indexOf(b.month)-FIN_MONTHS.indexOf(a.month)));
 if(!rows.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:24px; color:#9CA3AF;">Tiada rekod untuk filter ni.</td></tr>'; return; }
 const catColors = { OPEX:'#EF4444', COGS:'#F59E0B', CAPEX:'#8B5CF6' };
 let total = 0;
 tbody.innerHTML = rows.map(f => {
 total += parseFloat(f.amount || 0);
 const color = catColors[f.category] || '#6B7280';
 return `<tr>
 <td>${escapeHtml(f.month)} ${f.year}</td>
 <td><span style="background:${color}; color:#FFF; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700;">${escapeHtml(f.category)}</span></td>
 <td>${escapeHtml(f.description||'')}</td>
 <td style="text-align:right; color:#EF4444; font-weight:700;">-${formatRM(f.amount)}</td>
 <td><button onclick="window.deleteFinance(${f.id})" class="fin-btn fin-btn--ghost" style="padding:3px 8px; font-size:11px;" title="Padam"></button></td>
 </tr>`;
 }).join('');
 const sum = document.getElementById('finLedgerSummary');
 if(sum) sum.innerHTML = `<strong>${rows.length}</strong> rekod · Total expense period: <strong style="color:#EF4444;">${formatRM(total)}</strong>`;
}

// ===== EXPENSE MODAL =====
window.finOpenExpenseModal = function() {
 const overlay = document.getElementById('finExpenseModal');
 if(!overlay) return;
 const now = new Date();
 document.getElementById('expMonth').value = FIN_MONTHS[now.getMonth()];
 document.getElementById('expYear').value = now.getFullYear();
 document.getElementById('expCategory').value = 'OPEX';
 document.getElementById('expAmount').value = '';
 document.getElementById('expNote').value = '';
 overlay.style.display = 'flex';
 setTimeout(()=>document.getElementById('expAmount').focus(), 100);
 if(window.lucide && lucide.createIcons) lucide.createIcons();
};
window.finCloseExpenseModal = function() {
 const overlay = document.getElementById('finExpenseModal');
 if(overlay) overlay.style.display = 'none';
};

// ===== EXPORT CSV =====
window.finExportCSV = function() {
 const period = __finGetPeriod();
 const header = ['Month','Year','Category','Description','Amount (RM)'];
 const rows = (financeRecords||[]).filter(f => {
 const idx = FIN_MONTHS.indexOf(f.month); if(idx<0) return false;
 const d = new Date(parseInt(f.year), idx, 15);
 return d>= period.start && d <= period.end;
 }).map(f => [f.month, f.year, f.category, (f.description||'').replace(/,/g,';'), parseFloat(f.amount||0).toFixed(2)]);
 const csv = [header,...rows].map(r => r.join(',')).join('\n');
 const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url; a.download = 'expenses_' + period.label.replace(/\s/g,'_') + '.csv';
 a.click(); URL.revokeObjectURL(url);
 if(typeof showToast === 'function') showToast('CSV exported: ' + rows.length + ' rows', 'success');
};

// ===== PRINT P&L =====
window.finPrintPL = function() {
 const period = __finGetPeriod();
 const rev = __finSumRevenue(period.start, period.end);
 const exp = __finSumExpenses(period.start, period.end);
 const net = rev - exp;
 const opex = __finSumExpenses(period.start, period.end, 'OPEX');
 const cogs = __finSumExpenses(period.start, period.end, 'COGS');
 const capex = __finSumExpenses(period.start, period.end, 'CAPEX');
 const shop = (function(){ try { return JSON.parse(localStorage.getItem('complianceSettings_v1')||'{}').shop || {}; } catch(e){ return {}; } })();
 const w = window.open('', '_blank', 'width=800,height=900');
 w.document.write(`<!DOCTYPE html><html><head><title>P&L ${period.label}</title>
 <style>body{font-family:system-ui,sans-serif;padding:30px;color:#111;} h1{color:#B45309;border-bottom:2px solid #B45309;padding-bottom:6px;}
 table{width:100%;border-collapse:collapse;margin-top:20px;} td,th{padding:8px 12px;text-align:left;border-bottom:1px solid #E5E7EB;}
 th{background:#FFFBEB;color:#92400E;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;}
.num{text-align:right;font-variant-numeric:tabular-nums;}.net{font-weight:900;background:#FFFBEB;font-size:16px;}
.pos{color:#10B981;}.neg{color:#EF4444;}.footer{margin-top:40px;font-size:11px;color:#6B7280;}</style>
 </head><body>
 <h1> Profit & Loss Statement</h1>
 <p><strong>${escapeHtml(shop.name||'10 CAMP')}</strong> · ${escapeHtml(shop.address||'')}<br>
 Period: <strong>${period.label}</strong> · Generated: ${new Date().toLocaleString('en-MY')}</p>
 <table><tr><th>Item</th><th class="num">Amount (RM)</th></tr>
 <tr><td>Gross Revenue</td><td class="num pos">${formatRM(rev)}</td></tr>
 <tr><td colspan="2" style="background:#F9FAFB;font-weight:700;">Less: Expenses</td></tr>
 <tr><td style="padding-left:24px;">— COGS (Cost of Goods Sold)</td><td class="num neg">-${formatRM(cogs)}</td></tr>
 <tr><td style="padding-left:24px;">— OPEX (Operating Expenses)</td><td class="num neg">-${formatRM(opex)}</td></tr>
 <tr><td style="padding-left:24px;">— CAPEX (Capital Expenditure)</td><td class="num neg">-${formatRM(capex)}</td></tr>
 <tr><td>Total Expenses</td><td class="num neg">-${formatRM(exp)}</td></tr>
 <tr class="net"><td>Net Profit / (Loss)</td><td class="num ${net>=0?'pos':'neg'}">${formatRM(net)}</td></tr>
 <tr><td>Profit Margin</td><td class="num">${rev>0?((net/rev)*100).toFixed(1):'0.0'}%</td></tr>
 </table>
 <p class="footer">Auto-generated dari 10 CAMP POS · For internal review only · Bukan dokumen rasmi LHDN.</p>
 <script>window.print();</script>
 </body></html>`);
 w.document.close();
};

// ===== MEMO PERSISTENCE + UI =====
window.finMemoSave = function() {
 const text = document.getElementById('finMemoText').value.trim();
 const active = document.getElementById('finMemoToggle').checked;
 if(active && !text) { if(typeof showToast==='function') showToast('Sila isi teks memo dulu', 'warn'); return; }
 globalMemo.active = active;
 globalMemo.text = text;
 try {
 localStorage.setItem('globalMemo_v1', JSON.stringify({
 active, text, updated_at: new Date().toISOString(),
 updated_by: (window.currentUser||currentUser||{}).name || 'System'
 }));
 } catch(e){}
 // Mirror to legacy hidden inputs (so renderMgmtPlaceholders doesn't break)
 const lt = document.getElementById('memoInputText'); if(lt) lt.value = text;
 const lc = document.getElementById('memoToggle'); if(lc) lc.checked = active;
 window.finRefreshMemoUI();
 if(typeof showToast==='function') showToast(active ? ' Memo aktif — semua staf akan nampak masa login' : ' Memo dimatikan', 'success');
};
window.finMemoTest = function() {
 const text = document.getElementById('finMemoText').value.trim();
 if(!text) { if(typeof showToast==='function') showToast('Tulis memo dulu sebelum test', 'warn'); return; }
 if(typeof showToast==='function') showToast(' PENGUMUMAN: ' + text, 'warn');
};
window.finRefreshMemoUI = function() {
 const pill = document.getElementById('finMemoStatusPill');
 const last = document.getElementById('finMemoLastUpdate');
 if(pill) {
 pill.textContent = globalMemo.active ? 'AKTIF' : 'MATI';
 pill.className = 'fin-memo-pill ' + (globalMemo.active ? 'fin-memo-pill--on' : 'fin-memo-pill--off');
 }
 if(last) {
 try {
 const meta = JSON.parse(localStorage.getItem('globalMemo_v1')||'{}');
 if(meta.updated_at) last.textContent = '· dikemaskini ' + new Date(meta.updated_at).toLocaleString('en-MY') + (meta.updated_by ? ' oleh ' + meta.updated_by : '');
 } catch(e){}
 }
};
window.finMemoLoad = function() {
 try {
 const saved = JSON.parse(localStorage.getItem('globalMemo_v1')||'null');
 if(saved && typeof saved === 'object') {
 globalMemo.active = !!saved.active;
 globalMemo.text = saved.text || '';
 }
 } catch(e){}
 const t = document.getElementById('finMemoText'); if(t) t.value = globalMemo.text;
 const tg = document.getElementById('finMemoToggle'); if(tg) tg.checked = globalMemo.active;
 window.finRefreshMemoUI();
};

// Wrapper to keep legacy renderFinance() callers working
function renderFinance() {
 window.finMemoLoad();
 window.finRender();
}

document.getElementById("saveExpenseBtn")?.addEventListener("click", async function() {
 const month = document.getElementById("expMonth").value.trim();
 const year = parseInt(document.getElementById("expYear").value);
 const category = document.getElementById("expCategory").value;
 const amount = parseFloat(document.getElementById("expAmount").value);
 const desc = document.getElementById("expNote").value.trim();

 if(!month || isNaN(year) || isNaN(amount) || amount <= 0 || !desc) {
 if(typeof showToast==='function') showToast('Sila isi semua field dengan betul', 'warn');
 else alert("Sila isi semua field dengan betul");
 return;
 }

 this.textContent = "Saving..."; this.disabled = true;

 let payload = { month, year, category, amount, description: desc };

 try {
 const { data, error } = await db.from('finance_records').insert([payload]).select();
 if(error && error.code !== "PGRST204") {
 console.warn("Supabase finance_records insert failed, saving locally:", error.message);
 payload.id = Date.now();
 financeRecords.push(payload);
 } else if(data) {
 financeRecords.unshift(data[0]);
 }
 } catch(e) {
 payload.id = Date.now();
 financeRecords.push(payload);
 }

 this.textContent = "Simpan Rekod"; this.disabled = false;
 if(typeof window.finCloseExpenseModal==='function') window.finCloseExpenseModal();
 if(typeof showToast==='function') showToast(' Expense recorded: ' + formatRM(amount), 'success');
 if(typeof window.finRender==='function') window.finRender();
});

window.deleteFinance = async function(id) {
 if(!confirm("Hapus rekod ini? Ini akan mengubah P&L bulanan.")) return;
 try {
 await db.from('finance_records').delete().eq('id', id);
 } catch(e) {}
 financeRecords = financeRecords.filter(f => f.id !== id);
 if(typeof window.finRender==='function') window.finRender();
 else renderFinance();
};

// ===================================
// MANAGEMENT EXECUTIVE MODULES
// ===================================
function renderMgmtPlaceholders() {
 // 1. Logic for determining identity
 let isZack = currentUser && currentUser.name === 'Zack';
 let isMoyy = currentUser && currentUser.name === 'Farhan Moyy';
 let isSuperior = currentUser && currentUser.role === 'superior';
 let isAliff = currentUser && currentUser.name === 'Aliff';

 // Management pills are removed, flattened to sidebar.
 renderPettyCash();
 renderMgmtStaffSales();
 renderCustomerIssues();
 
 if (isAliff || isSuperior || (!isZack && !isMoyy)) {
 renderStaffSchedule();
 loadAdminAttendance();
 }
 
 // Warehouse functions
 if (isZack || isSuperior) {
 renderWarehouseLowStock();
 }
 
 // Sales functions
 if (isMoyy || isSuperior) {
 renderSalesMgmtTarget();
 if(typeof renderSalesGraph === 'function') renderSalesGraph();
 }
 
 // update memo switch
 document.getElementById("memoToggle").checked = globalMemo.active;
 document.getElementById("memoStatusLabel").textContent = globalMemo.active ? "AKTIF" : "TIDAK AKTIF";
 document.getElementById("memoStatusLabel").style.color = globalMemo.active ? "#10B981" : "red";
 document.getElementById("memoInputText").value = globalMemo.text;
 
 // Global Staff Directory Rendering
 renderGlobalStaffDirectory();
 
 // HR Audit Logs Rendering
 if(typeof renderAuditLogs === 'function') renderAuditLogs();
}

function renderGlobalStaffDirectory() {
 const tbody = document.getElementById("staffDirectoryTbody");
 if(!tbody) return;

 let html = "";
 authUsers.forEach(u => {
 let los = "-";
 if(u.join_date) {
 const joinDate = new Date(u.join_date);
 const now = new Date();
 let years = now.getFullYear() - joinDate.getFullYear();
 let months = now.getMonth() - joinDate.getMonth();
 let days = now.getDate() - joinDate.getDate();

 if (days < 0) {
 months -= 1;
 const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
 days += prevMonth.getDate();
 }
 if (months < 0) {
 years -= 1;
 months += 12;
 }
 los = `${years} Years ${months} Months ${days} Days`;
 }
 
 let deptLabel = "";
 if(u.dept) deptLabel = `<br><span style="font-size:10px; color:#888;">${u.dept}</span>`;

 html += `<tr>
 <td style="font-weight:bold; color:var(--primary);">${u.staff_id || "-"}</td>
 <td>${u.name}</td>
 <td style="font-weight:bold;">${u.full_name || "-"}${deptLabel}</td>
 <td>${u.join_date || "-"}</td>
 <td>${los}</td>
 </tr>`;
 });
 
 tbody.innerHTML = html;
}

window.switchMgmtTab = function(tabId, pillId) {
 // Deprecated. Routed via switchHub now.
};

window.updateMoyySettings = function() {
 moyySettings.target = parseFloat(document.getElementById("moyyTargetInput").value) || 10000;
 moyySettings.commRate = parseFloat(document.getElementById("moyyCommInput").value) || 5;
 alert(`Sasaran Jualan dikemaskini: RM ${moyySettings.target} | Komisen: ${moyySettings.commRate}%`);
 renderSalesMgmtTarget();
};

function renderSalesMgmtTarget() {
 // 1. Tally Ariff and Irfan performance
 let ariffTotal = 0;
 let irfanTotal = 0;
 
 // Tally Omnichannel
 let channels = { 'In-Store': 0, 'Tiktok': 0, 'Shopee': 0, 'Website': 0, 'Lain-Lain': 0 };
 let totalSalesSystem = 0;
 let totalTransactions = salesHistory.length;

 salesHistory.forEach(sale => {
 let amt = parseFloat(sale.total_amount || sale.total || 0);
 
 if(sale.staff_name === 'Ariff') ariffTotal = round2(ariffTotal + amt);
 if(sale.staff_name === 'Irfan') irfanTotal = round2(irfanTotal + amt);
 
 // Taburan Omnichannel
 let ch = sale.channel || 'Lain-Lain';
 if(!channels[ch]) channels[ch] = 0;
 channels[ch] += amt;
 totalSalesSystem = round2(totalSalesSystem + amt);
 });
 
 // 2. Render Target & Commission
 const domAriff = document.getElementById("tgtAriffSales");
 const domIrfan = document.getElementById("tgtIrfanSales");
 const commAriff = document.getElementById("tgtAriffComm");
 const commIrfan = document.getElementById("tgtIrfanComm");
 const subtitle = document.getElementById("moyyTargetSubtitle");
 
 if(subtitle) subtitle.textContent = `Pantauan prestasi jualan Ariff & Irfan berbanding target bulanan (RM ${moyySettings.target.toLocaleString()}).`;
 
 let ariffPct = Math.min((ariffTotal / (moyySettings.target || 1)) * 100, 100);
 let irfanPct = Math.min((irfanTotal / (moyySettings.target || 1)) * 100, 100);
 
 if(domAriff) domAriff.innerHTML = `RM ${ariffTotal.toFixed(2)} / RM ${moyySettings.target} <br><div style="width:100%;background:#eee;height:5px;border-radius:5px;"><div style="width:${ariffPct}%;background:var(--primary);height:100%;border-radius:5px;"></div></div>`;
 if(domIrfan) domIrfan.innerHTML = `RM ${irfanTotal.toFixed(2)} / RM ${moyySettings.target} <br><div style="width:100%;background:#eee;height:5px;border-radius:5px;"><div style="width:${irfanPct}%;background:#10B981;height:100%;border-radius:5px;"></div></div>`;
 
 if(commAriff) commAriff.textContent = `RM ${(ariffTotal * (moyySettings.commRate / 100)).toFixed(2)}`;
 if(commIrfan) commIrfan.textContent = `RM ${(irfanTotal * (moyySettings.commRate / 100)).toFixed(2)}`;

 // 3. Render Omnichannel Dist
 const tbodyOmni = document.getElementById("salesChannelTbody");
 if(tbodyOmni) {
 let omniHtml = "";
 for (let ch in channels) {
 if(channels[ch]> 0 || ch === 'In-Store' || ch === 'Tiktok') {
 let pct = totalSalesSystem> 0 ? ((channels[ch] / totalSalesSystem) * 100).toFixed(1) : 0;
 let count = salesHistory.filter(s => (s.channel || 'Lain-Lain') === ch).length;
 omniHtml += `<tr>
 <td><strong>${ch}</strong></td>
 <td>${count} resit</td>
 <td>RM ${channels[ch].toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
 <td>${pct}%</td>
 </tr>`;
 }
 }
 tbodyOmni.innerHTML = omniHtml;
 }

 // 4. Render Pending / Unpaid Invoices (Follow up Tracker)
 const tbodyPending = document.getElementById("salesMgmtPendingTbody");
 if(tbodyPending) {
 let pendingRecords = salesHistory.filter(s => s.status === 'Unpaid' || s.status === 'To Fulfil');
 if(pendingRecords.length === 0) {
 tbodyPending.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:10px; color:#10B981; font-weight:bold;"> Hebat! Tiada sebarang hutang atau invois tergantung.</td></tr>`;
 } else {
 let phtml = "";
 pendingRecords.forEach(p => {
 let amt = parseFloat(p.total_amount || p.total || 0).toFixed(2);
 let phone = p.customer_phone || "Tiada";
 let btn = `<button onclick="window.open('https://wa.me/6${phone.replace(/[^0-9]/g, '')}', '_blank')" style="background:#25D366; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer;" ${phone === 'Tiada' ? 'disabled' : ''}>WhatsApp</button>`;
 phtml += `<tr>
 <td>#${p.id} <br><span style="font-size:9px; background:#fecaca; color:#7f1d1d; padding:2px 4px; border-radius:3px;">${p.status}</span></td>
 <td style="font-weight:bold;">${p.customer_name || 'Pelanggan'}</td>
 <td>${phone}</td>
 <td style="color:#b91c1c; font-weight:bold;">RM ${amt}</td>
 <td>${p.staff_name || '-'}</td>
 <td>${btn}</td>
 </tr>`;
 });
 tbodyPending.innerHTML = phtml;
 }
 }
}

// Staff Scheduling & HR Logic
window.toggleMcUpload = function(val) {
 const box = document.getElementById("mcAttachmentBox");
 if(box) box.style.display = (val === 'MC') ? 'block' : 'none';
};

window.saveHrSettings = function() {
 hrSettings.friBreak = document.getElementById("setRestFri").value;
 hrSettings.wedBreak = document.getElementById("setRestWed").value;
 hrSettings.normalBreak = document.getElementById("setRestNor").value;
 document.getElementById("hrSettingsModal").style.display='none';
 alert("Ketetapan masa rehat mingguan berjaya diselaraskan.");
 renderStaffSchedule();
};

function getBreakTimeString(dateStr) {
 const d = new Date(dateStr);
 const day = d.getDay(); // 0=Sun, 1=Mon,..., 3=Wed,..., 5=Fri, 6=Sat
 if(day === 5) return hrSettings.friBreak;
 if(day === 3) return hrSettings.wedBreak;
 return hrSettings.normalBreak;
}

document.getElementById("saveScheduleBtn")?.addEventListener('click', async () => {
 const name = document.getElementById("scheduleStaffName").value;
 const dateStrInput = document.getElementById("scheduleDate").value; // e.g. YYYY-MM-DD
 const shift = document.getElementById("scheduleShift").value;
 const fileInput = document.getElementById("scheduleMcFile");

 if(!name || !dateStrInput || !shift) {
 alert("Sila lengkapkan nama, tarikh, dan syif.");
 return;
 }

 const existingIndex = staffSchedules.findIndex(s => s.staff_name === name && s.date === dateStrInput);
 if(existingIndex !== -1) {
 // Pulangkan semula baki cuti jika rekod lama adalah AL
 let oldObj = staffSchedules[existingIndex];
 if(oldObj.shift === 'AL') {
 let profile = staffProfiles.find(p => p.name === name);
 if(profile) profile.leave_balance += 1;
 }
 // Buang rekod lama (Overwrite)
 await db.from('roster_schedules').delete().eq('id', oldObj.id);
 staffSchedules.splice(existingIndex, 1);
 }

 // Pemotongan Baki Cuti jika AL baru
 if(shift === 'AL') {
 let profile = staffProfiles.find(p => p.name === name);
 if(profile && profile.leave_balance <= 0) {
 if(!confirm(`Baki cuti (AL) ${name} telah habis! Teruskan potong baki negatif?`)) return;
 }
 if(profile) profile.leave_balance -= 1;
 }

 // MC logic
 let mcNameStr = "";
 if(shift === 'MC' && fileInput && fileInput.files.length> 0) {
 mcNameStr = fileInput.files[0].name;
 } else if (shift === 'MC') {
 mcNameStr = "Tiada Sijil";
 }

 let newSched = {
 id: Date.now(),
 staff_name: name,
 date: dateStrInput,
 shift: shift,
 mc_name: mcNameStr
 };
 staffSchedules.push(newSched);
 await db.from('roster_schedules').insert([newSched]);
 
 alert(`Jadual Harian (${shift}) berjaya ditetapkan untuk ${name}!`);
 renderStaffSchedule();
});

// Listener untuk butang Pemohonan Umum (Ordinary Staff Request)
document.getElementById("reqScheduleBtn")?.addEventListener('click', async () => {
 let name = currentUser ? currentUser.name : "Tarmizi"; // fallback if anon
 if (!currentUser) {
 alert("Sila Log Masuk (Login) terlebih dahulu untuk membuat permohonan.");
 return;
 }
 name = currentUser.name;

 const dateStrInput = document.getElementById("reqScheduleDate").value;
 const shift = document.getElementById("reqScheduleShift").value;
 const fileInput = document.getElementById("reqMcFile");

 if(!dateStrInput || !shift) {
 alert("Sila lengkapkan tarikh dan pilihan syif/cuti.");
 return;
 }

 let mcNameStr = "";
 if(shift === 'MC' && fileInput && fileInput.files.length> 0) {
 mcNameStr = fileInput.files[0].name;
 } else if (shift === 'MC') {
 mcNameStr = "Tiada Sijil";
 }

 let newReq = {
 id: Date.now(),
 staff_name: name,
 date: dateStrInput,
 shift: shift,
 mc_name: mcNameStr
 };
 pendingSchedules.push(newReq);
 await db.from('pending_requests').insert([newReq]);
 
 alert(`Permohonan ${shift} pada ${dateStrInput} dihantar! Sila tunggu kelulusan bos.`);
 document.getElementById("reqScheduleDate").value = '';
 renderPendingSchedules();
});

window.renderStaffSchedule = function() {
 const theadAdmin = document.getElementById("adminRosterThead");
 const tbodyAdmin = document.getElementById("scheduleTbody");
 const theadPublic = document.getElementById("publicRosterThead");
 const tbodyPublic = document.getElementById("publicRosterTbody");
 
 if(!tbodyAdmin && !tbodyPublic) return;

 // Fix: dynamically inject missing names from staffSchedules to prevent invisible rows
 let existingNames = staffProfiles.map(p => p.name);
 staffSchedules.forEach(s => {
 if(!existingNames.includes(s.staff_name)) {
 staffProfiles.push({ name: s.staff_name, leave_balance: 0 });
 existingNames.push(s.staff_name);
 }
 });
 // Fix: also from pendingSchedules so they appear in leave balances even if not approved yet
 pendingSchedules.forEach(s => {
 if(!existingNames.includes(s.staff_name)) {
 staffProfiles.push({ name: s.staff_name, leave_balance: 0 });
 existingNames.push(s.staff_name);
 }
 });

 // Refresh Leave Balance panel
 const leaveTbody = document.getElementById("leaveBalanceTbody");
 if(leaveTbody) {
 leaveTbody.innerHTML = staffProfiles.map(p => {
 let color = p.leave_balance> 3 ? "var(--text-main)" : "var(--danger)";
 return `<tr><td><b>${p.name}</b></td><td style="color:${color}; font-weight:bold;">${p.leave_balance} Hari</td></tr>`;
 }).join("");
 }

 // Tentukan bulan. (Guna Global Navigasi)
 const year = activeRosterYear;
 const month = activeRosterMonth;
 const daysInMonth = new Date(year, month + 1, 0).getDate();
 let baseDate = new Date(year, month, 1);

 // Lukis butang bulan di navigator
 const monthNames = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];
 let btnHtml = "";
 monthNames.forEach((mn, mIdx) => {
 let isAct = mIdx === month ? "background:var(--primary); color:#fff; font-weight:bold;" : "background:#efefef; color:#555;";
 btnHtml += `<button onclick="setRosterMonth(${mIdx})" style="${isAct} border:1px solid #ddd; padding:6px 12px; border-radius:4px; font-size:11px; cursor:pointer; flex:1; min-width:40px;">${mn}</button>`;
 });
 
 // Kemaskini Navigator (Public dan Admin jika wujud)
 const pubBtns = document.getElementById("publicMonthBtns");
 if(pubBtns) pubBtns.innerHTML = btnHtml;
 const pubYr = document.getElementById("publicRosterYear");
 if(pubYr) pubYr.value = year;

 const admBtns = document.getElementById("adminMonthBtns");
 if(admBtns) admBtns.innerHTML = btnHtml;
 const admYr = document.getElementById("adminRosterYear");
 if(admYr) admYr.value = year;

 // 1. Build Headers (1 to 31)
 let headerStr = `<tr><th style="min-width:120px; text-align:left; position:sticky; left:0; background:var(--secondary); z-index:3;">Staf / Tarikh<br><small style="font-weight:normal;">${baseDate.toLocaleString('default', { month: 'long' })} ${year}</small></th>`;
 
 for(let d=1; d<=daysInMonth; d++) {
 const loopDate = new Date(year, month, d);
 const hariArr = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
 const dayName = hariArr[loopDate.getDay()];
 let bgHead = loopDate.getDay() === 0 || loopDate.getDay() === 6 ? "#888" : "inherit"; // Gelapkan sikit hjg minggu
 headerStr += `<th style="min-width:30px; font-weight:bold; background:${bgHead}; border:1px solid rgba(255,255,255,0.2);">${d}<br><small style="font-size:9px; font-weight:normal;">${dayName}</small></th>`;
 }
 headerStr += `</tr>`;

 if(theadAdmin) theadAdmin.innerHTML = headerStr;
 if(theadPublic) theadPublic.innerHTML = headerStr;

 // 2. Build Grid Rows
 const generateTbody = (isAdmin) => {
 let rows = "";
 staffProfiles.forEach((staff, index) => {
 let rowBg = index % 2 === 0 ? "#FAFAFA" : "#FFF";
 rows += `<tr><td style="text-align:left; font-weight:600; font-size:11px; position:sticky; left:0; background:${rowBg}; border-right:1px solid #ccc;">${staff.name}</td>`;
 
 for(let d=1; d<=daysInMonth; d++) {
 let dayStr = d < 10 ? '0'+d : d;
 let monthStr = (month+1) < 10 ? '0'+(month+1) : (month+1);
 let targetDate = `${year}-${monthStr}-${dayStr}`;
 
 let shiftData = staffSchedules.find(s => s.staff_name === staff.name && s.date === targetDate);
 let code = '';
 if(shiftData) {
 code = shiftData.shift;
 } else if(publicHolidays.includes(targetDate)) {
 code = 'PH';
 } else {
 const loopDate = new Date(year, month, d);
 const dayOfWeek = loopDate.getDay();
 
 // Fixed Permanent Off Days
 const offDaysConfig = {
 "Aliff": 4, // Khamis
 "Fahmi": 5, // Jumaat
 "Tarmizi": 6, // Sabtu (Short Name UI)
 "Tarmizi Kael": 6, // Sabtu (Auth Name UI)
 "Irfan": 0, // Ahad
 "Ariff": 1, // Isnin
 "Farhan Moyy": 2, // Selasa
 "Zack": 3 // Rabu
 };

 if(offDaysConfig[staff.name] !== undefined && offDaysConfig[staff.name] === dayOfWeek) {
 code = 'OFF';
 } else if(staff.name === 'Zack' && dayOfWeek === 4) {
 code = 'B';
 } else {
 code = dayOfWeek === 3 ? 'B' : 'C'; // 3 is Wednesday default
 }
 }
 
 let bg = rowBg, col = "#333", fw = "normal";
 if(code === 'A') { bg = "#fde047"; fw = "bold"; }
 else if(code === 'B') { bg = "#86efac"; fw = "bold"; }
 else if(code === 'C') { bg = "#c4b5fd"; fw = "bold"; }
 else if(code === 'OFF') { col = "red"; fw = "bold"; }
 else if(code === 'AL') { bg = "#3b82f6"; col = "white"; fw = "bold"; }
 else if(code === 'MC') { bg = "#fbbf24"; fw = "bold"; }
 else if(code === 'EL') { bg = "#ef4444"; col = "white"; fw = "bold"; }
 else if(code === 'PH') { bg = "#f472b6"; col = "white"; fw = "bold"; }
 
 let attachStr = code === 'MC' && shiftData && shiftData.mc_name ? `<br><span style="font-size:9px;" title="${shiftData.mc_name}"></span>` : "";

 if(isAdmin && window.isRosterEditMode) {
 let selStr = `<select onchange="saveQuickShiftInline(this, '${staff.name}', '${targetDate}', ${shiftData ? shiftData.id : null}, this.value)" style="width:100%; height:100%; border:none; background:transparent; outline:none; text-align:center; font-size:11px; font-weight:${fw}; color:${col}; cursor:pointer; appearance:none; -webkit-appearance:none; padding:8px 2px;">`;
 selStr += `<option value="KOSONG" ${!code ? 'selected' : ''}>-</option>`;
 selStr += `<option value="A" ${code==='A' ? 'selected' : ''}>A</option>`;
 selStr += `<option value="B" ${code==='B' ? 'selected' : ''}>B</option>`;
 selStr += `<option value="C" ${code==='C' ? 'selected' : ''}>C</option>`;
 selStr += `<option value="OFF" ${code==='OFF' ? 'selected' : ''}>OFF</option>`;
 selStr += `<option value="AL" ${code==='AL' ? 'selected' : ''}>AL</option>`;
 selStr += `<option value="MC" ${code==='MC' ? 'selected' : ''}>MC</option>`;
 selStr += `<option value="EL" ${code==='EL' ? 'selected' : ''}>EL</option>`;
 selStr += `<option value="PH" ${code==='PH' ? 'selected' : ''}>PH</option>`;
 selStr += `</select>`;
 rows += `<td style="border:1px solid #aaa; background:${bg}; padding:0; min-width:35px;">${selStr}${attachStr}</td>`;
 } else {
 if(!code) {
 rows += `<td style="border:1px solid #ddd; background:${rowBg}; color:#ccc; text-align:center; font-size:10px;">-</td>`;
 } else {
 rows += `<td style="border:1px solid #ddd; background:${bg}; color:${col}; text-align:center; font-weight:${fw}; font-size:11px;">${code}${attachStr}</td>`;
 }
 }
 }
 rows += `</tr>`;
 });
 return rows;
 };

 if(tbodyAdmin) tbodyAdmin.innerHTML = generateTbody(true);
 if(tbodyPublic) tbodyPublic.innerHTML = generateTbody(false);
}

window.isRosterEditMode = false;

window.toggleRosterEditMode = function() {
 window.isRosterEditMode = !window.isRosterEditMode;
 let btnEdit = document.getElementById("btnEditRoster");
 let btnSubmit = document.getElementById("btnSubmitRoster");
 
 if(window.isRosterEditMode) {
 if(btnEdit) { btnEdit.style.background = "#4f46e5"; btnEdit.style.borderColor = "#4f46e5"; btnEdit.innerHTML = " KELUAR EDIT"; }
 if(btnSubmit) btnSubmit.style.display = "flex";
 } else {
 if(btnEdit) { btnEdit.style.background = "#6b7280"; btnEdit.style.borderColor = "#6b7280"; btnEdit.innerHTML = " MULA EDIT"; }
 if(btnSubmit) btnSubmit.style.display = "none";
 }
 renderStaffSchedule();
};

window.saveQuickShiftInline = function(el, staff, date, id, shiftCode) {
 // Kemaskini Memori RAM sahaja (Silent Local Sync)
 staffSchedules = staffSchedules.filter(s => !(s.staff_name === staff && s.date === date));
 
 if(shiftCode !== 'KOSONG') {
 let newId = id || (Math.floor(Date.now() / 100) + Math.floor(Math.random() * 9999));
 staffSchedules.push({
 id: newId,
 staff_name: staff,
 date: date,
 shift: shiftCode,
 mc_name: ''
 });
 }

 // Kemaskini visual kotak serta merta tanpa render seluruh jadual
 let bg = "#FAFAFA", col = "#333", fw = "normal";
 if(shiftCode === 'A') { bg = "#fde047"; fw = "bold"; }
 else if(shiftCode === 'B') { bg = "#86efac"; fw = "bold"; }
 else if(shiftCode === 'C') { bg = "#c4b5fd"; fw = "bold"; }
 else if(shiftCode === 'OFF') { bg = "#FAFAFA"; col = "red"; fw = "bold"; }
 else if(shiftCode === 'AL') { bg = "#3b82f6"; col = "white"; fw = "bold"; }
 else if(shiftCode === 'MC') { bg = "#fbbf24"; fw = "bold"; }
 else if(shiftCode === 'EL') { bg = "#ef4444"; col = "white"; fw = "bold"; }
 else { bg = "#FFF"; col = "#ccc"; }

 let td = el.parentElement;
 if(td) td.style.background = bg;
 el.style.color = col;
 el.style.fontWeight = fw;
};

window.submitBulkRoster = async function() {
 if(!confirm("Sahkan simpankan keseluruhan tarikh ini ke pelayan Awan (Supabase)?\\n\\nTindakan ini akan menggantikan rekod sedia ada bagi bulan ini.")) return;
 
 let btnSubmit = document.getElementById("btnSubmitRoster");
 if(btnSubmit) { btnSubmit.disabled = true; btnSubmit.innerHTML = " MENYIMPAN..."; }

 try {
 const year = activeRosterYear;
 const month = activeRosterMonth;
 const daysInMonth = new Date(year, month + 1, 0).getDate();
 let startD = `${year}-${(month+1).toString().padStart(2, '0')}-01`;
 let endD = `${year}-${(month+1).toString().padStart(2, '0')}-${daysInMonth}`;
 
 // 1. Flush API for current month
 await db.from('roster_schedules').delete().gte('date', startD).lte('date', endD);
 
 // 2. Filter local memory payload for current month
 let payload = staffSchedules.filter(s => s.date.startsWith(`${year}-${(month+1).toString().padStart(2, '0')}`));
 
 // 3. Chunk Bulk Insert
 const CHUNK_SIZE = 500;
 for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
 let chunk = payload.slice(i, i + CHUNK_SIZE);
 await db.from('roster_schedules').insert(chunk);
 }

 alert("Berjaya! Jadual telah di-'Upload' secara rasmi.");
 
 window.toggleRosterEditMode(); // Exit edit mode
 
 // Force refresh API fallback
 let { data: newRoster } = await db.from('roster_schedules').select('*');
 if(newRoster) {
 staffSchedules = newRoster;
 renderStaffSchedule();
 }
 
 } catch(err) {
 alert("Ralat Menyimpan Pukal: " + err.message);
 }
 
 if(btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = " SIMPAN PERUBAHAN"; }
};


window.renderPendingSchedules = function() {
 const tbody = document.getElementById("pendingRequestsTbody");
 if(!tbody) return;

 if(pendingSchedules.length === 0) {
 tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:10px;">Tiada permohonan terkini.</td></tr>';
 return;
 }

 let html = "";
 pendingSchedules.forEach(req => {
 let badgeBg = "#eee"; let col = "#333";
 if(req.shift === 'OFF') { col = "red"; }
 else if(req.shift === 'AL') { badgeBg = "#3b82f6"; col="white"; }
 else if(req.shift === 'MC') { badgeBg = "#fbbf24"; }
 else if(req.shift === 'EL') { badgeBg = "#ef4444"; col="white"; }

 let attachStr = req.shift === 'MC' ? ` ${req.mc_name}` : "-";

 html += `
 <tr style="border-bottom:1px solid #fee2e2;">
 <td style="font-weight:bold;">${req.staff_name}</td>
 <td>${req.date}</td>
 <td><span style="background:${badgeBg}; color:${col}; padding:3px 8px; border-radius:4px; font-weight:bold;">${req.shift}</span></td>
 <td><small>${attachStr}</small></td>
 <td>
 <button onclick="approveRequest(${req.id})" style="background:#10b981; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer; margin-right:5px;">Terima</button>
 <button onclick="rejectRequest(${req.id})" style="background:#ef4444; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer;">Tolak</button>
 </td>
 </tr>
 `;
 });
 tbody.innerHTML = html;
};

window.approveRequest = async function(id) {
 let reqIndex = pendingSchedules.findIndex(r => r.id === id);
 if(reqIndex === -1) return;
 let req = pendingSchedules[reqIndex];

 // Proses semakan Overwrite & Potong AL seperti admin biasa
 const existingIndex = staffSchedules.findIndex(s => s.staff_name === req.staff_name && s.date === req.date);
 if(existingIndex !== -1) {
 let oldSched = staffSchedules[existingIndex];
 if(oldSched.shift === 'AL') {
 let profile = staffProfiles.find(p => p.name === req.staff_name);
 if(profile) profile.leave_balance += 1;
 }
 await db.from('roster_schedules').delete().eq('id', oldSched.id);
 staffSchedules.splice(existingIndex, 1);
 }

 if(req.shift === 'AL') {
 let profile = staffProfiles.find(p => p.name === req.staff_name);
 if(profile && profile.leave_balance <= 0) {
 if(!confirm(`Baki AL pemohon habis! Teruskan meluluskan AL (baki jadi negatif)?`)) return;
 }
 if(profile) profile.leave_balance -= 1;
 }

 let newSched = {
 id: Date.now(),
 staff_name: req.staff_name,
 date: req.date,
 shift: req.shift,
 mc_name: req.mc_name
 };
 staffSchedules.push(newSched);
 await db.from('roster_schedules').insert([newSched]);

 pendingSchedules.splice(reqIndex, 1); // Remove from pending
 await db.from('pending_requests').delete().eq('id', id);
 
 // Inject Audit Log (Kelulusan)
 try {
 let adminName = currentUser ? currentUser.name : 'Sistem Automasi';
 await db.from('audit_logs').insert([{
 action_type: 'LULUS',
 actor_name: adminName,
 target_staff: req.staff_name,
 details: `Meluluskan ${req.shift} pada ${req.date}`
 }]);
 } catch(e) {}
 
 renderPendingSchedules();
 renderStaffSchedule();
 if(typeof renderAuditLogs === 'function') renderAuditLogs();
 alert(`Permohonan ${req.staff_name} DILULUSKAN!`);
};

window.rejectRequest = async function(id) {
 if(!confirm("Tolak permohonan staf ini?")) return;
 
 let reqIndex = pendingSchedules.findIndex(r => r.id === id);
 if(reqIndex !== -1) {
 let req = pendingSchedules[reqIndex];
 
 // Inject Audit Log (Penolakan)
 try {
 let adminName = currentUser ? currentUser.name : 'Sistem Automasi';
 await db.from('audit_logs').insert([{
 action_type: 'TOLAK',
 actor_name: adminName,
 target_staff: req.staff_name,
 details: `Menolak permohonan ${req.shift} pada ${req.date}`
 }]);
 } catch(e) {}
 }

 pendingSchedules = pendingSchedules.filter(r => r.id !== id);
 await db.from('pending_requests').delete().eq('id', id);
 renderPendingSchedules();
 if(typeof renderAuditLogs === 'function') renderAuditLogs();
};

window.renderAuditLogs = async function() {
 const tbody = document.getElementById("auditLogsTbody");
 if(!tbody) return;
 
 try {
 let { data: logs, error } = await db.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(20);
 if(error || !logs || logs.length === 0) {
 tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:10px;">Tiada rekod (atau jadual audit_logs belum wujud di Supabase).</td></tr>`;
 return;
 }

 let html = "";
 logs.forEach(log => {
 let actDate = new Date(log.created_at).toLocaleString('ms-MY', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
 let badge = log.action_type === 'LULUS' 
 ? `<span style="background:#10B981; color:white; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:10px;">LULUS</span>` 
 : `<span style="background:#ef4444; color:white; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:10px;">TOLAK</span>`;
 
 html += `<tr>
 <td style="font-size:11px; color:#555;">${actDate}</td>
 <td style="font-weight:bold; color:#4c1d95;">${log.actor_name}</td>
 <td>${badge} <span style="font-weight:bold;">${log.target_staff}</span></td>
 <td style="font-size:11px;">${log.details}</td>
 </tr>`;
 });
 tbody.innerHTML = html;
 
 } catch(err) {
 tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:10px; color:red;">Ralat mengambil data: ${err.message}</td></tr>`;
 }
};

// Call renderPending in main switchHub
const oldRenderStaffSchedule = renderStaffSchedule;
renderStaffSchedule = function() {
 oldRenderStaffSchedule();
 renderPendingSchedules();
};

function renderWarehouseLowStock() {
 const tbody = document.getElementById("whLowStockTbody");
 if(!tbody) return;

 // Sprint 2.5: per-SKU reorder_point (fallback to 10 if NULL)
 let lowStocks = [];
 masterProducts.forEach(p => {
 const total = inventoryBatches.filter(b => b.sku === p.sku)
.reduce((acc, b) => acc + parseInt(b.qty_remaining || 0), 0);
 const threshold = (p.reorder_point != null) ? parseInt(p.reorder_point) : 10;
 if(total < threshold) {
 lowStocks.push({
 sku: p.sku, name: p.name,
 remaining: total,
 threshold,
 reorderQty: p.reorder_qty,
 leadDays: p.lead_time_days
 });
 }
 });

 // Sort: 0-stock first, then by ratio
 lowStocks.sort((a, b) => {
 if(a.remaining === 0 && b.remaining !== 0) return -1;
 if(b.remaining === 0 && a.remaining !== 0) return 1;
 return (a.remaining / a.threshold) - (b.remaining / b.threshold);
 });

 if(lowStocks.length === 0) {
 tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#10B981;"> Semua stok di atas reorder point.</td></tr>';
 return;
 }

 tbody.innerHTML = lowStocks.slice(0, 50).map(s => {
 const color = s.remaining === 0 ? "#DC2626" : (s.remaining < s.threshold * 0.5 ? "#D97706" : "#CA8A04");
 const reorderHint = s.reorderQty
 ? `<br><span style="font-size:9px; color:#0EA5E9;"> Order ${s.reorderQty}${s.leadDays ? ' (lead ' + s.leadDays + 'd)' : ''}</span>`
 : '';
 return `
 <tr>
 <td><strong>${s.sku}</strong></td>
 <td>${(s.name || '').slice(0, 50)}${reorderHint}</td>
 <td style="color:${color}; font-weight:bold;">${s.remaining} <span style="color:#9CA3AF; font-weight:normal;">/ ${s.threshold}</span></td>
 </tr>`;
 }).join('');
}

// 1. Petty Cash Ledger
document.getElementById("savePettyBtn")?.addEventListener('click', () => {
 const type = document.getElementById("pcType").value;
 const amount = parseFloat(document.getElementById("pcAmount").value);
 const notes = document.getElementById("pcNotes").value.trim();
 
 if(!amount || !notes) return alert("Sila isi Amaun dan Nota!");
 
 pettyCashLedger.push({
 id: Date.now(),
 date: new Date().toISOString(),
 type: type,
 amount: amount,
 notes: notes
 });
 if(typeof window.persistPettyCash === 'function') window.persistPettyCash();

 alert("Buku tunai dikemaskini.");
 document.getElementById("pcAmount").value = "";
 document.getElementById("pcNotes").value = "";
 renderPettyCash();
});

function renderPettyCash() {
 const tbody = document.getElementById("pettyTbody");
 if(!tbody) return;
 
 if(pettyCashLedger.length === 0) {
 tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Tiada rekod.</td></tr>';
 return;
 }
 
 let runningBalance = 0;
 let html = "";
 
 // Sort chronological to build balance
 const sorted = [...pettyCashLedger].sort((a,b) => new Date(a.date) - new Date(b.date));
 
 sorted.forEach(p => {
 if(p.type === 'IN') runningBalance = round2(runningBalance + p.amount);
 else runningBalance = round2(runningBalance - p.amount);
 
 let color = p.type === 'IN' ? 'green' : 'red';
 let op = p.type === 'IN' ? '+' : '-';
 
 html += `<tr>
 <td>${new Date(p.date).toLocaleString('en-GB')}</td>
 <td><strong style="color:${color}">${p.type}</strong></td>
 <td>${p.notes}</td>
 <td style="color:${color}">${op} RM${p.amount.toFixed(2)}</td>
 <td style="font-weight:bold;">RM${runningBalance.toFixed(2)}</td>
 </tr>`;
 });
 
 // Render descending for view but balance remains correct
 tbody.innerHTML = html;
}

window.downloadPettyCSV = function() {
 if(pettyCashLedger.length === 0) return alert("Tiada data.");
 let csvStr = "Date,Type,Notes,Amount\n";
 pettyCashLedger.forEach(p => {
 csvStr += `"${p.date}","${p.type}","${p.notes}","${p.amount}"\n`;
 });
 
 const blob = new Blob([csvStr], { type: 'text/csv' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = `Petty_Cash_${new Date().getTime()}.csv`;
 document.body.appendChild(a);
 a.click();
 document.body.removeChild(a);
}

// 2. Memo Module
// Legacy memo button (hidden stub) — keep listener for backward compat
document.getElementById("saveMemoBtn")?.addEventListener('click', () => {
 if(typeof window.finMemoSave === 'function') window.finMemoSave();
});

// =============================================================
// p1_21 INVESTOR DASHBOARD — board-level metrics & cap table
// =============================================================
let __invGrowthChart = null, __invChannelChart = null, __invARChart = null;

function __invSafeSales() { return (typeof salesHistory !== 'undefined' && Array.isArray(salesHistory)) ? salesHistory : []; }
function __invSafeFin() { return (typeof financeRecords !== 'undefined' && Array.isArray(financeRecords)) ? financeRecords : []; }
function __invSafeCust() { return (typeof customersData !== 'undefined' && Array.isArray(customersData)) ? customersData : []; }
function __invSafeBatches(){ return (typeof inventoryBatches !== 'undefined' && Array.isArray(inventoryBatches)) ? inventoryBatches : []; }
function __invSafeMaster() { return (typeof masterProducts !== 'undefined' && Array.isArray(masterProducts)) ? masterProducts : []; }
function __invSafeQuotes() { return (typeof window.quotationsLog !== 'undefined' && Array.isArray(window.quotationsLog)) ? window.quotationsLog : []; }
function __invSafeStaff() { return (typeof authUsers !== 'undefined' && Array.isArray(authUsers)) ? authUsers.filter(u => u.role !== 'investor' && u.role !== 'superior') : []; }

function computeInvestorMetrics() {
 const now = new Date();
 const M = window.FIN_MONTHS || ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

 // === Revenue per month (last 12) ===
 const sales = __invSafeSales();
 const fin = __invSafeFin();
 const monthly = []; // [{label,start,end,rev,exp}]
 for(let i = 11; i>= 0; i--) {
 const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
 const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23,59,59);
 let rev = 0, refunds = 0;
 sales.forEach(s => {
 const d = new Date(s.created_at || s.timestamp || s.sale_date);
 if(isNaN(d) || d < start || d> end) return;
 const a = parseFloat(s.amount || s.total || s.total_amount || 0);
 if(a> 0) rev += a; else refunds += Math.abs(a);
 });
 let exp = 0;
 fin.forEach(f => {
 const idx = M.indexOf(f.month); if(idx < 0) return;
 const d = new Date(parseInt(f.year), idx, 15);
 if(d < start || d> end) return;
 exp += parseFloat(f.amount || 0);
 });
 monthly.push({ label: M[start.getMonth()] + ' ' + (start.getFullYear()%100), rev, exp, refunds, start, end });
 }

 const total12moRev = monthly.reduce((a,b)=>a+b.rev, 0);
 const total12moExp = monthly.reduce((a,b)=>a+b.exp, 0);
 const total12moRefunds = monthly.reduce((a,b)=>a+b.refunds, 0);
 const arr = total12moRev; // already last 12mo
 const mtd = monthly[monthly.length-1].rev;
 const lastMonthRev = monthly[monthly.length-2] ? monthly[monthly.length-2].rev : 0;
 const yoyRef = monthly[0] ? monthly[0].rev : 0; // ~12mo ago
 const mom = lastMonthRev> 0 ? ((mtd - lastMonthRev) / lastMonthRev) * 100 : null;
 const yoy = yoyRef> 0 ? ((mtd - yoyRef) / yoyRef) * 100 : null;

 // === COGS / margins ===
 let cogs12mo = 0, opex12mo = 0, capex12mo = 0;
 monthly.forEach(({start, end}) => {
 fin.forEach(f => {
 const idx = M.indexOf(f.month); if(idx < 0) return;
 const d = new Date(parseInt(f.year), idx, 15);
 if(d < start || d> end) return;
 const a = parseFloat(f.amount || 0);
 if(f.category === 'COGS') cogs12mo += a;
 else if(f.category === 'OPEX') opex12mo += a;
 else if(f.category === 'CAPEX') capex12mo += a;
 });
 });
 const grossMargin = total12moRev> 0 ? ((total12moRev - cogs12mo) / total12moRev) * 100 : 0;
 const netMargin = total12moRev> 0 ? ((total12moRev - total12moExp) / total12moRev) * 100 : 0;

 // === Burn / Runway ===
 const monthlyNet = monthly.map(m => m.rev - m.exp);
 const recentBurn = monthlyNet.slice(-3).reduce((a,b)=>a+b, 0) / 3; // last 3mo avg
 const isBurning = recentBurn < 0;
 // Cash position not tracked → estimate runway from positive net or N/A
 const runway = isBurning ? null : Infinity;

 // === Customers ===
 const customers = __invSafeCust();
 const custCount = customers.length;
 // Order frequency + repeat rate
 const orderCountByCust = {};
 let totalOrders = 0;
 sales.forEach(s => {
 if(parseFloat(s.amount || s.total || 0) <= 0) return; // skip refunds
 totalOrders++;
 const k = s.customer_phone || s.customer_id || s.customer_name || '_anon';
 orderCountByCust[k] = (orderCountByCust[k] || 0) + 1;
 });
 const repeatCustomers = Object.values(orderCountByCust).filter(c => c>= 2).length;
 const repeatRate = custCount> 0 ? (repeatCustomers / custCount) * 100 : 0;
 const aov = totalOrders> 0 ? total12moRev / totalOrders : 0;
 // LTV approximation: total revenue per known customer / customer count
 const ltv = custCount> 0 ? total12moRev / custCount : 0;

 // === Per-channel revenue ===
 let chPos = 0, chB2B = 0, chQuote = 0;
 sales.forEach(s => {
 const a = parseFloat(s.amount || s.total || 0);
 if(a <= 0) return;
 const meta = s.metadata || {};
 if(meta.from_quote || s.from_quote_ref) chQuote += a;
 else if(meta.is_b2b || s.customer_tin || meta.invoice_ref) chB2B += a;
 else chPos += a;
 });

 // === Inventory ===
 const batches = __invSafeBatches();
 let invValue = 0;
 batches.forEach(b => {
 const qty = parseFloat(b.qty_remaining || 0);
 const cost = parseFloat(b.cost_price || b.landed_cost || 0);
 if(qty> 0 && cost> 0) invValue += qty * cost;
 });
 // Turnover = annual COGS / avg inventory
 const turnover = invValue> 0 ? cogs12mo / invValue : 0;
 const dio = turnover> 0 ? Math.round(365 / turnover) : null;
 // Dead stock: batches inbound> 365d ago with qty_remaining> 0
 let deadValue = 0;
 const cutoff = new Date(now.getTime() - 365*24*3600*1000);
 batches.forEach(b => {
 const inb = b.inbound_date ? new Date(b.inbound_date) : null;
 if(!inb || inb> cutoff) return;
 const qty = parseFloat(b.qty_remaining || 0);
 const cost = parseFloat(b.cost_price || b.landed_cost || 0);
 if(qty> 0 && cost> 0) deadValue += qty * cost;
 });

 // === Top SKUs ===
 const skuRev = {};
 sales.forEach(s => {
 const items = s.items || s.cart || [];
 if(!Array.isArray(items)) return;
 items.forEach(it => {
 const sku = it.sku || it.SKU; if(!sku) return;
 const qty = parseFloat(it.qty || it.quantity || 1);
 const price = parseFloat(it.price || it.unit_price || 0);
 skuRev[sku] = (skuRev[sku] || 0) + (qty * price);
 });
 });
 const topSkus = Object.entries(skuRev).sort((a,b)=>b[1]-a[1]).slice(0,10);

 // === Customer concentration ===
 const custRev = {};
 sales.forEach(s => {
 const a = parseFloat(s.amount || s.total || 0);
 if(a <= 0) return;
 const k = s.customer_name || s.customer_phone || '_anon';
 custRev[k] = (custRev[k] || 0) + a;
 });
 const sortedCust = Object.entries(custRev).sort((a,b)=>b[1]-a[1]);
 const top5Sum = sortedCust.slice(0,5).reduce((s,[,v])=>s+v, 0);
 const top5Conc = total12moRev> 0 ? (top5Sum / total12moRev) * 100 : 0;

 // === Refund rate ===
 const refundRate = total12moRev> 0 ? (total12moRefunds / total12moRev) * 100 : 0;

 // === AR aging from quotationsLog (invoice type only) ===
 const quotes = __invSafeQuotes();
 const arBuckets = { current: 0, '30': 0, '60': 0, '90': 0 };
 let arTotal = 0, arCount = 0;
 quotes.forEach(q => {
 if(q.status === 'paid' || q.status === 'cancelled' || q.status === 'voided') return;
 if(q.doc_type !== 'invoice' && q.type !== 'invoice') return;
 const amt = parseFloat(q.grand_total || q.total || 0);
 if(amt <= 0) return;
 const d = new Date(q.created_at || q.date || q.generated_date);
 if(isNaN(d)) return;
 const age = (now - d) / (1000*3600*24);
 arTotal += amt; arCount++;
 if(age < 30) arBuckets.current += amt;
 else if(age < 60) arBuckets['30'] += amt;
 else if(age < 90) arBuckets['60'] += amt;
 else arBuckets['90'] += amt;
 });

 // === Revenue per staff ===
 const staffCount = Math.max(__invSafeStaff().length, 1);
 const revPerStaff = total12moRev / staffCount;

 // === Health Score (composite 0-100) ===
 // Revenue growth (25%): MoM scaled — full marks at +20% MoM
 const sRev = mom == null ? 50 : Math.max(0, Math.min(100, 50 + (mom * 2.5)));
 // Margin (25%): net margin — full at 30%, zero at <0
 const sMargin = Math.max(0, Math.min(100, (netMargin / 30) * 100));
 // Customer retention (20%): repeat rate — full at 40%
 const sRetention = Math.max(0, Math.min(100, (repeatRate / 40) * 100));
 // Inventory efficiency (15%): turnover — full at 6 (every 2mo), zero at <1/yr
 const sInv = Math.max(0, Math.min(100, ((turnover - 1) / 5) * 100));
 // AR/Cash (15%): low concentration + low refund + low AR>90d
 const sRisk = Math.max(0, 100 - (top5Conc * 0.5) - (refundRate * 5) - (arBuckets['90'] / Math.max(arTotal,1) * 100 * 0.5));
 const score = Math.round((sRev*0.25) + (sMargin*0.25) + (sRetention*0.20) + (sInv*0.15) + (sRisk*0.15));
 const grade = score>= 85 ? 'A' : score>= 70 ? 'B' : score>= 55 ? 'C' : score>= 40 ? 'D' : 'F';

 return {
 monthly, total12moRev, arr, mtd, mom, yoy, lastMonthRev,
 cogs12mo, opex12mo, capex12mo, grossMargin, netMargin,
 recentBurn, isBurning, runway,
 custCount, totalOrders, repeatRate, aov, ltv,
 chPos, chB2B, chQuote,
 invValue, turnover, dio, deadValue,
 topSkus, sortedCust, top5Conc, refundRate,
 arBuckets, arTotal, arCount,
 revPerStaff, score, grade,
 components: { sRev, sMargin, sRetention, sInv, sRisk }
 };
}

window.renderInvestor = function() {
 if(!document.getElementById('investorSection')) return;
 const m = computeInvestorMetrics();
 const fmt = window.formatRM || (n => 'RM ' + (parseFloat(n)||0).toFixed(2));
 const fmtShort = window.formatRMShort || (n => 'RM ' + Math.round(parseFloat(n)||0));

 document.getElementById('invGenTime').textContent = new Date().toLocaleString('en-MY');

 // Health score ring
 const ring = document.getElementById('invScoreRing');
 if(ring) {
 const C = 2 * Math.PI * 54;
 const offset = C - (C * m.score / 100);
 ring.setAttribute('stroke-dasharray', C);
 ring.setAttribute('stroke-dashoffset', offset);
 ring.setAttribute('stroke', m.score>= 70 ? '#10B981' : m.score>= 50 ? '#F59E0B' : '#EF4444');
 }
 document.getElementById('invScoreVal').textContent = m.score;
 document.getElementById('invScoreGrade').textContent = 'Grade ' + m.grade;

 // KPIs
 document.getElementById('invARR').textContent = fmtShort(m.arr);
 document.getElementById('invMTD').textContent = fmtShort(m.mtd);
 const mtdDeltaEl = document.getElementById('invMTDDelta');
 if(m.mom != null) {
 const arrow = m.mom>= 0 ? '↑' : '↓';
 mtdDeltaEl.textContent = arrow + ' ' + Math.abs(m.mom).toFixed(1) + '% vs last month';
 mtdDeltaEl.style.color = m.mom>= 0 ? '#10B981' : '#EF4444';
 } else mtdDeltaEl.textContent = 'no prior period';
 document.getElementById('invGM').textContent = m.grossMargin.toFixed(1) + '%';
 document.getElementById('invNM').textContent = m.netMargin.toFixed(1) + '%';
 document.getElementById('invBurn').textContent = (m.recentBurn>= 0 ? '+' : '') + fmtShort(m.recentBurn) + '/mo';
 document.getElementById('invBurnSub').textContent = m.isBurning ? ' burn rate' : ' profitable';
 document.getElementById('invRunway').textContent = m.isBurning ? ' N/A — track cash' : '∞ (profitable)';

 // Growth stats
 document.getElementById('invMoM').textContent = m.mom == null ? '—' : (m.mom>=0?'+':'') + m.mom.toFixed(1) + '%';
 document.getElementById('invYoY').textContent = m.yoy == null ? '—' : (m.yoy>=0?'+':'') + m.yoy.toFixed(1) + '%';
 document.getElementById('invAOV').textContent = fmt(m.aov);
 document.getElementById('invRepeat').textContent = m.repeatRate.toFixed(1) + '%';
 document.getElementById('invLTV').textContent = fmt(m.ltv);
 document.getElementById('invCustCount').textContent = m.custCount.toLocaleString();
 document.getElementById('invOrderCount').textContent = m.totalOrders.toLocaleString();
 document.getElementById('invRevPerStaff').textContent = fmtShort(m.revPerStaff);

 // Inventory
 document.getElementById('invInvValue').textContent = fmtShort(m.invValue);
 document.getElementById('invTurnover').textContent = m.turnover.toFixed(2) + 'x';
 document.getElementById('invDIO').textContent = m.dio == null ? '—' : m.dio + ' days';
 document.getElementById('invDead').textContent = fmtShort(m.deadValue);

 // Top SKUs
 const topSkuEl = document.getElementById('invTopSkus');
 if(topSkuEl) {
 const totalSkuRev = m.topSkus.reduce((s,[,v])=>s+v, 0);
 if(!m.topSkus.length) {
 topSkuEl.innerHTML = '<div style="color:#94A3B8; padding:10px; text-align:center;">No SKU data</div>';
 } else {
 topSkuEl.innerHTML = m.topSkus.map(([sku,rev],i) => {
 const pct = totalSkuRev> 0 ? (rev/totalSkuRev*100).toFixed(0) : 0;
 return `<div class="inv-top-sku-row"><span class="inv-top-sku-rank">#${i+1}</span><span class="inv-top-sku-name">${sku}</span><span class="inv-top-sku-rev">${fmtShort(rev)}</span><span class="inv-top-sku-pct">${pct}%</span></div>`;
 }).join('');
 }
 }

 // Risk radar
 document.getElementById('invConcCust').textContent = m.top5Conc.toFixed(1) + '%';
 document.getElementById('invRefundRate').textContent = m.refundRate.toFixed(2) + '%';
 document.getElementById('invARTotal').textContent = fmt(m.arTotal) + ' (' + m.arCount + ')';
 document.getElementById('invAR90').textContent = fmt(m.arBuckets['90']);

 // Strategic notes (auto-generated)
 const notes = [];
 if(m.score>= 70) notes.push('<span class="inv-flag inv-flag--green">Strong</span> Health score grade ' + m.grade + ' — bisnes dalam keadaan baik.');
 else if(m.score>= 55) notes.push('<span class="inv-flag inv-flag--amber">Stable</span> Health score grade ' + m.grade + ' — ada ruang penambahbaikan.');
 else notes.push('<span class="inv-flag inv-flag--red">At Risk</span> Health score grade ' + m.grade + ' — perlu intervention.');
 if(m.netMargin < 10) notes.push('<span class="inv-flag inv-flag--amber">Margin</span> Net margin ' + m.netMargin.toFixed(1) + '% rendah. Target retail biasa: 15-25%. Audit OPEX atau review pricing.');
 if(m.repeatRate < 20 && m.custCount> 50) notes.push('<span class="inv-flag inv-flag--amber">Retention</span> Repeat rate ' + m.repeatRate.toFixed(1) + '% rendah. Pertimbangkan loyalty program / re-engagement campaign.');
 if(m.top5Conc> 40) notes.push('<span class="inv-flag inv-flag--red">Risk</span> Top-5 customer = ' + m.top5Conc.toFixed(0) + '% revenue. Concentration risk tinggi — diversify customer base.');
 if(m.deadValue> m.invValue * 0.15) notes.push('<span class="inv-flag inv-flag--amber">Inventory</span> Dead stock (>365d) = ' + fmtShort(m.deadValue) + ' (' + (m.deadValue/Math.max(m.invValue,1)*100).toFixed(0) + '% of stock). Clear dengan promo/bundle.');
 if(m.turnover < 2 && m.invValue> 0) notes.push('<span class="inv-flag inv-flag--amber">Turnover</span> Inventory turnover ' + m.turnover.toFixed(1) + 'x/yr — slow. Tighten reorder policy.');
 if(m.arBuckets['90']> m.arTotal * 0.2 && m.arTotal> 0) notes.push('<span class="inv-flag inv-flag--red">AR Aging</span>>90d AR = ' + fmt(m.arBuckets['90']) + '. Chase or write-off.');
 if(m.mom != null && m.mom> 15) notes.push('<span class="inv-flag inv-flag--green">Growth</span> +' + m.mom.toFixed(1) + '% MoM — strong momentum.');
 if(m.isBurning) notes.push('<span class="inv-flag inv-flag--red">Cash</span> Avg burn ' + fmtShort(Math.abs(m.recentBurn)) + '/mo. Track bank balance manually — runway calc needs cash position input.');
 notes.push('<span class="inv-flag inv-flag--blue">Cap Table</span> brolantodak (51%) majority + Zaid (49%) operator — control sits with investor.');
 document.getElementById('invStrategicNotes').innerHTML = '<ul>' + notes.map(n => '<li>' + n + '</li>').join('') + '</ul>';

 // === Charts ===
 if(typeof Chart !== 'undefined') {
 const labels = m.monthly.map(x => x.label);
 // Growth chart
 if(__invGrowthChart) __invGrowthChart.destroy();
 const gctx = document.getElementById('invGrowthChart');
 if(gctx) __invGrowthChart = new Chart(gctx, {
 type: 'line',
 data: { labels, datasets: [
 { label: 'Revenue', data: m.monthly.map(x=>x.rev), borderColor: '#1E40AF', backgroundColor: 'rgba(30,64,175,0.1)', tension: 0.3, fill: true, pointRadius: 3 },
 { label: 'Net', data: m.monthly.map(x=>x.rev - x.exp), borderColor: '#10B981', backgroundColor: 'transparent', tension: 0.3, pointRadius: 2 }
]},
 options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
 });
 // Channel chart
 if(__invChannelChart) __invChannelChart.destroy();
 const cctx = document.getElementById('invChannelChart');
 if(cctx) __invChannelChart = new Chart(cctx, {
 type: 'doughnut',
 data: { labels: ['POS','B2B','Quote'], datasets: [{ data: [m.chPos, m.chB2B, m.chQuote], backgroundColor: ['#10B981','#1E40AF','#8B5CF6'], borderWidth: 2, borderColor: '#FFF' }] },
 options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 10 } } } } }
 });
 // AR chart
 if(__invARChart) __invARChart.destroy();
 const actx = document.getElementById('invARChart');
 if(actx) __invARChart = new Chart(actx, {
 type: 'bar',
 data: { labels: ['Current','30-59d','60-89d','90d+'], datasets: [{ data: [m.arBuckets.current, m.arBuckets['30'], m.arBuckets['60'], m.arBuckets['90']], backgroundColor: ['#10B981','#3B82F6','#F59E0B','#EF4444'] }] },
 options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
 });
 }
};

// =============================================================
// p1_19 MEMO BOARD — workflow approval (pending → approved/rejected)
// =============================================================
window.MEMO_KEY = 'memos_v1';
window.__memoStatus = 'approved'; // active status tab
window.__memoDept = 'all'; // active dept filter
window.__memoRejectId = null; // memo being rejected

window.memoLoad = function() {
 try { return JSON.parse(localStorage.getItem(window.MEMO_KEY) || '[]'); }
 catch(e) { return []; }
};
window.memoSaveAll = function(arr) {
 try { localStorage.setItem(window.MEMO_KEY, JSON.stringify(arr)); }
 catch(e) { console.warn('memoSaveAll failed:', e); }
};
window.memoCurrentUser = function() {
 return window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null);
};

// Submit memo flow
window.memoOpenSubmit = function() {
 const u = window.memoCurrentUser();
 if(!u) { if(typeof showToast==='function') showToast('Login dulu untuk hantar memo', 'warn'); return; }
 // Default dept based on user role
 const roleDeptMap = { sales: 'sales', inventory: 'inv', mgmt: 'admin', superior: 'general' };
 const dept = roleDeptMap[u.role] || 'general';
 document.getElementById('memoFormDept').value = dept;
 document.getElementById('memoFormTitle').value = '';
 document.getElementById('memoFormBody').value = '';
 document.getElementById('memoFormPinned').checked = false;
 document.getElementById('memoSubmitOverlay').style.display = 'flex';
 setTimeout(()=>document.getElementById('memoFormTitle').focus(), 100);
 if(window.lucide && lucide.createIcons) lucide.createIcons();
};
window.memoCloseSubmit = function() {
 document.getElementById('memoSubmitOverlay').style.display = 'none';
};
window.memoSubmit = function() {
 const u = window.memoCurrentUser();
 if(!u) return;
 const dept = document.getElementById('memoFormDept').value;
 const title = document.getElementById('memoFormTitle').value.trim();
 const body = document.getElementById('memoFormBody').value.trim();
 const pinned = document.getElementById('memoFormPinned').checked;
 if(!title) { if(typeof showToast==='function') showToast('Sila isi tajuk memo', 'warn'); return; }
 if(!body) { if(typeof showToast==='function') showToast('Sila isi kandungan memo', 'warn'); return; }

 const memos = window.memoLoad();
 const isSuperior = u.role === 'superior';
 const memo = {
 id: 'm' + Date.now() + Math.floor(Math.random()*1000),
 department: dept,
 title, body,
 pinned,
 posted_by_id: u.staff_id,
 posted_by_name: u.name,
 posted_at: new Date().toISOString(),
 // Superior memos auto-approved (no need to approve self)
 status: isSuperior ? 'approved' : 'pending',
 approved_by_name: isSuperior ? u.name : null,
 approved_at: isSuperior ? new Date().toISOString() : null,
 reject_reason: null
 };
 memos.unshift(memo);
 window.memoSaveAll(memos);
 window.memoCloseSubmit();
 if(typeof showToast === 'function') {
 showToast(isSuperior
 ? ' Memo terus aktif (auto-approved sebab Superior)'
 : ' Memo dihantar untuk approval. Bos akan review.', 'success');
 }
 // If superior posted, jump to Approved tab; else jump to Mine
 window.__memoStatus = isSuperior ? 'approved' : 'mine';
 window.renderMemoBoard();
};

// Approve / Reject (Superior only)
window.memoApprove = function(id) {
 const u = window.memoCurrentUser();
 if(!u || u.role !== 'superior') { if(typeof showToast==='function') showToast('Hanya Superior boleh approve', 'warn'); return; }
 const memos = window.memoLoad();
 const m = memos.find(x => x.id === id);
 if(!m) return;
 m.status = 'approved';
 m.approved_by_name = u.name;
 m.approved_at = new Date().toISOString();
 m.reject_reason = null;
 window.memoSaveAll(memos);
 if(typeof showToast === 'function') showToast(' Memo approved: ' + m.title, 'success');
 window.renderMemoBoard();
 // Audit log (best-effort)
 try {
 if(typeof db !== 'undefined' && db && db.from) {
 db.from('audit_logs').insert([{
 action_type: 'memo_approve',
 actor_name: u.name,
 target_staff: m.posted_by_name,
 details: JSON.stringify({ memo_id: m.id, dept: m.department, title: m.title }),
 created_at: new Date().toISOString()
 }]).then(()=>{}).catch(()=>{});
 }
 } catch(e){}
};
window.memoOpenReject = function(id) {
 const u = window.memoCurrentUser();
 if(!u || u.role !== 'superior') { if(typeof showToast==='function') showToast('Hanya Superior boleh reject', 'warn'); return; }
 const memos = window.memoLoad();
 const m = memos.find(x => x.id === id);
 if(!m) return;
 window.__memoRejectId = id;
 document.getElementById('memoRejectPreview').innerHTML =
 '<strong>' + escapeHtml(m.title) + '</strong><br>' +
 '<span style="color:#6B7280; font-size:11px;">Hantar oleh: ' + escapeHtml(m.posted_by_name) + ' · ' + escapeHtml(m.department) + '</span>';
 document.getElementById('memoRejectReason').value = '';
 document.getElementById('memoRejectOverlay').style.display = 'flex';
 setTimeout(()=>document.getElementById('memoRejectReason').focus(), 100);
};
window.memoCloseReject = function() {
 window.__memoRejectId = null;
 document.getElementById('memoRejectOverlay').style.display = 'none';
};
window.memoConfirmReject = function() {
 const reason = document.getElementById('memoRejectReason').value.trim();
 if(!reason) { if(typeof showToast==='function') showToast('Sila isi sebab reject', 'warn'); return; }
 const u = window.memoCurrentUser();
 const memos = window.memoLoad();
 const m = memos.find(x => x.id === window.__memoRejectId);
 if(!m) return;
 m.status = 'rejected';
 m.approved_by_name = u.name;
 m.approved_at = new Date().toISOString();
 m.reject_reason = reason;
 window.memoSaveAll(memos);
 window.memoCloseReject();
 if(typeof showToast === 'function') showToast('Memo rejected', 'success');
 window.renderMemoBoard();
 try {
 if(typeof db !== 'undefined' && db && db.from) {
 db.from('audit_logs').insert([{
 action_type: 'memo_reject',
 actor_name: u.name,
 target_staff: m.posted_by_name,
 details: JSON.stringify({ memo_id: m.id, dept: m.department, title: m.title, reason }),
 created_at: new Date().toISOString()
 }]).then(()=>{}).catch(()=>{});
 }
 } catch(e){}
};

// Delete (own pending OR Superior any)
window.memoDelete = function(id) {
 const u = window.memoCurrentUser();
 if(!u) return;
 const memos = window.memoLoad();
 const m = memos.find(x => x.id === id);
 if(!m) return;
 const canDelete = u.role === 'superior' || (m.posted_by_id === u.staff_id && m.status === 'pending');
 if(!canDelete) { if(typeof showToast==='function') showToast('Tak boleh padam memo ni', 'warn'); return; }
 if(!confirm('Padam memo "' + m.title + '"?')) return;
 const filtered = memos.filter(x => x.id !== id);
 window.memoSaveAll(filtered);
 if(typeof showToast === 'function') showToast('Memo dipadam', 'success');
 window.renderMemoBoard();
};

// Tab/filter setters
window.memoSetStatus = function(s, btn) {
 window.__memoStatus = s;
 document.querySelectorAll('[data-memo-status]').forEach(b => b.classList.toggle('memo-tab--active', b === btn));
 window.renderMemoBoard();
};
window.memoSetDept = function(d, btn) {
 window.__memoDept = d;
 document.querySelectorAll('[data-memo-dept]').forEach(b => b.classList.toggle('memo-dept--active', b === btn));
 window.renderMemoBoard();
};

// Counts
window.memoGetPendingCount = function() {
 return window.memoLoad().filter(m => m.status === 'pending').length;
};
window.memoRefreshSidebarBadge = function() {
 const badge = document.getElementById('memoBadgePending');
 if(!badge) return;
 const u = window.memoCurrentUser();
 const isSuperior = u && u.role === 'superior';
 const count = window.memoGetPendingCount();
 if(isSuperior && count> 0) {
 badge.style.display = 'inline-block';
 badge.textContent = count;
 } else {
 badge.style.display = 'none';
 }
};

// Get pinned approved memo (used for login toast)
window.memoGetPinnedActive = function() {
 return window.memoLoad().find(m => m.status === 'approved' && m.pinned);
};

// Department label helper
window.memoDeptLabel = function(d) {
 return ({ general:'General', sales:'Sales', inv:'Inventory', admin:'Admin', hr:'HR', finance:'Finance' })[d] || d;
};

// Format time ago
window.memoTimeAgo = function(iso) {
 if(!iso) return '';
 const d = new Date(iso);
 const now = new Date();
 const diff = (now - d) / 1000;
 if(diff < 60) return 'baru saja';
 if(diff < 3600) return Math.floor(diff/60) + ' min yang lepas';
 if(diff < 86400) return Math.floor(diff/3600) + ' jam yang lepas';
 if(diff < 604800) return Math.floor(diff/86400) + ' hari yang lepas';
 return d.toLocaleDateString('en-MY', { day:'2-digit', month:'short', year:'numeric' });
};
window.memoFormatFull = function(iso) {
 if(!iso) return '';
 const d = new Date(iso);
 const days = ['Ahad','Isnin','Selasa','Rabu','Khamis','Jumaat','Sabtu'];
 return days[d.getDay()] + ', ' + d.toLocaleDateString('en-MY', { day:'2-digit', month:'short', year:'numeric' }) + ' · ' + d.toLocaleTimeString('en-MY', { hour:'2-digit', minute:'2-digit' });
};

// Main render
window.renderMemoBoard = function() {
 const list = document.getElementById('memoBoardList');
 if(!list) return;
 const u = window.memoCurrentUser();
 const isSuperior = u && u.role === 'superior';

 // Hide Pending tab for non-superior (they only see their own pending in "Memo Saya")
 const pendingTab = document.getElementById('memoTabPending');
 if(pendingTab) pendingTab.style.display = isSuperior ? '' : 'none';

 const all = window.memoLoad();
 // Update counts (unfiltered by dept so counts reflect everything for this user)
 const counts = {
 approved: all.filter(m => m.status === 'approved').length,
 pending: all.filter(m => m.status === 'pending').length,
 rejected: all.filter(m => m.status === 'rejected').length,
 mine: u ? all.filter(m => m.posted_by_id === u.staff_id).length : 0
 };
 Object.keys(counts).forEach(k => {
 const el = document.getElementById('memoCount' + k.charAt(0).toUpperCase() + k.slice(1));
 if(el) el.textContent = counts[k];
 });

 // Filter
 let rows = all.filter(m => {
 if(window.__memoStatus === 'mine') {
 if(!u || m.posted_by_id !== u.staff_id) return false;
 } else {
 if(m.status !== window.__memoStatus) return false;
 }
 if(window.__memoDept !== 'all' && m.department !== window.__memoDept) return false;
 return true;
 });
 // Sort: pinned first, then newest
 rows.sort((a,b) => {
 if(a.pinned !== b.pinned) return a.pinned ? -1 : 1;
 return new Date(b.posted_at) - new Date(a.posted_at);
 });

 if(!rows.length) {
 const emptyMsg = {
 approved: 'Tiada memo approved untuk department ni.',
 pending: isSuperior ? 'Tiada memo pending approval. ' : 'Tiada memo pending — hanya Superior boleh tengok queue ni.',
 rejected: 'Tiada memo rejected. Bagus, semua quality.',
 mine: 'Awak belum pernah hantar memo. Klik "Memo Baru" untuk start.'
 }[window.__memoStatus] || 'Tiada memo.';
 list.innerHTML = '<div class="memo-empty">' + emptyMsg + '</div>';
 window.memoRefreshSidebarBadge();
 return;
 }

 list.innerHTML = rows.map(m => {
 const cardClass = 'memo-card' +
 (m.pinned && m.status === 'approved' ? ' memo-card--pinned' : '') +
 (m.status === 'pending' ? ' memo-card--pending' : '') +
 (m.status === 'rejected' ? ' memo-card--rejected' : '');
 const canApprove = isSuperior && m.status === 'pending';
 const canDelete = u && (u.role === 'superior' || (m.posted_by_id === u.staff_id && m.status === 'pending'));
 const actions = [];
 if(canApprove) {
 actions.push('<button class="memo-card__act memo-card__act--approve" onclick="window.memoApprove(\''+m.id+'\')"> Approve</button>');
 actions.push('<button class="memo-card__act memo-card__act--reject" onclick="window.memoOpenReject(\''+m.id+'\')"> Reject</button>');
 }
 if(canDelete) actions.push('<button class="memo-card__act memo-card__act--delete" onclick="window.memoDelete(\''+m.id+'\')" title="Padam"></button>');

 let reasonHtml = '';
 if(m.status === 'rejected' && m.reject_reason) {
 reasonHtml = '<div class="memo-reject-reason"> Sebab: ' + escapeHtml(m.reject_reason) + ' (oleh ' + escapeHtml(m.approved_by_name||'') + ')</div>';
 } else if(m.status === 'approved' && m.approved_by_name) {
 reasonHtml = '<div class="memo-approval-note"> Approved oleh ' + escapeHtml(m.approved_by_name) + ' · ' + window.memoTimeAgo(m.approved_at) + '</div>';
 }

 return `<div class="${cardClass}">
 <div class="memo-card__head">
 <h4 class="memo-card__title">${m.pinned ? '<span class="memo-pin-icon"> </span>' : ''}${escapeHtml(m.title)}</h4>
 </div>
 <div class="memo-card__meta">
 <span class="memo-dept-badge" data-dept="${m.department}">${escapeHtml(window.memoDeptLabel(m.department))}</span>
 <span class="memo-status-pill memo-status-pill--${m.status}">${m.status}</span>
 </div>
 <div class="memo-card__body">${escapeHtml(m.body)}</div>
 ${reasonHtml}
 <div class="memo-card__foot">
 <span class="memo-card__author" title="${window.memoFormatFull(m.posted_at)}">
 <strong>${escapeHtml(m.posted_by_name)}</strong> · ${window.memoTimeAgo(m.posted_at)}
 </span>
 <span class="memo-card__actions">${actions.join('')}</span>
 </div>
 </div>`;
 }).join('');
 window.memoRefreshSidebarBadge();
 if(window.lucide && lucide.createIcons) lucide.createIcons();
};

// Boot: load memo from localStorage so it survives reload (was bug — globalMemo was in-memory only)
(function __finMemoBoot(){
 try {
 const saved = JSON.parse(localStorage.getItem('globalMemo_v1')||'null');
 if(saved && typeof saved === 'object') {
 globalMemo.active = !!saved.active;
 globalMemo.text = saved.text || '';
 }
 } catch(e){}
})();

// 2.A Render Sales Graph (Time-Series Modes)
window.currentGraphMode = '7days';

window.changeGraphMode = function(mode) {
 window.currentGraphMode = mode;
 
 // Toggle active state on buttons
 ['btnGraph7', 'btnGraphMonth', 'btnGraphYear', 'btnGraphCustom'].forEach(id => {
 let btn = document.getElementById(id);
 if(!btn) return;
 btn.style.backgroundColor = 'var(--bg-light)';
 btn.style.color = 'var(--text-main)';
 btn.style.borderColor = 'var(--border-color)';
 });
 
 let activeBtnId = "";
 if(mode === '7days') activeBtnId = "btnGraph7";
 if(mode === 'thismonth') activeBtnId = "btnGraphMonth";
 if(mode === 'thisyear') activeBtnId = "btnGraphYear";
 if(mode === 'custom') activeBtnId = "btnGraphCustom";
 
 if(activeBtnId) {
 let activeBtn = document.getElementById(activeBtnId);
 if(activeBtn) {
 activeBtn.style.backgroundColor = '#3b82f6';
 activeBtn.style.color = '#fff';
 activeBtn.style.borderColor = '#3b82f6';
 }
 }

 const customBox = document.getElementById("graphCustomRangeBox");
 if(mode === 'custom') {
 if(customBox) customBox.style.display = 'flex';
 } else {
 if(customBox) customBox.style.display = 'none';
 renderSalesGraph(mode);
 }
};

window.applyCustomGraphRange = function() {
 renderSalesGraph('custom');
};

let adminSalesChartInstance = null;
window.renderSalesGraph = function(mode = window.currentGraphMode) {
 const canvas = document.getElementById("adminSalesChart");
 if(!canvas) return;

 let dailyTotals = {};
 let dailyTx = {};
 let now = new Date();
 
 let tStartKey = 0;
 let tEndKey = 0;

 if (mode === '7days') {
 for(let i=6; i>=0; i--) {
 let d = new Date();
 d.setDate(d.getDate() - i);
 let k = d.toLocaleDateString('ms-MY', { day:'2-digit', month:'short' });
 dailyTotals[k] = 0; dailyTx[k] = 0;
 }
 } else if (mode === 'thismonth') {
 let daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
 for(let i=1; i<=daysInMonth; i++) {
 let d = new Date(now.getFullYear(), now.getMonth(), i);
 let k = d.toLocaleDateString('ms-MY', { day:'2-digit', month:'short' });
 dailyTotals[k] = 0; dailyTx[k] = 0;
 }
 } else if (mode === 'thisyear') {
 const monthNames = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];
 for(let m=0; m<12; m++) {
 dailyTotals[monthNames[m]] = 0; dailyTx[monthNames[m]] = 0;
 }
 } else if (mode === 'custom') {
 let s = document.getElementById("graphStartDate").value;
 let e = document.getElementById("graphEndDate").value;
 if(!s || !e) return alert("Sila masukkan kedua-dua tarikh Mula dan Akhir sebelum papar.");
 let sDate = new Date(s); sDate.setHours(0,0,0,0);
 let eDate = new Date(e); eDate.setHours(23,59,59,999);
 if(sDate> eDate) return alert("Tarikh Mula tidak boleh mendahului Tarikh Akhir.");
 
 let loop = new Date(sDate);
 // limit loop visual span to avoid killing memory (e.g. max 90 days visual)
 let daysDiff = (eDate - sDate) / (1000 * 3600 * 24);
 if(daysDiff> 100) return alert("Julat carian tidak boleh melebihi 100 hari untuk graf harian.");
 
 while(loop <= eDate) {
 let k = loop.toLocaleDateString('ms-MY', { day:'2-digit', month:'short' });
 dailyTotals[k] = 0; dailyTx[k] = 0;
 loop.setDate(loop.getDate() + 1);
 }
 tStartKey = sDate.getTime();
 tEndKey = eDate.getTime();
 }

 salesHistory.forEach(sale => {
 let ts = sale.created_at || sale.date; 
 if(!ts) return;
 let sDate = new Date(ts);
 
 // Logical Filters
 if (mode === 'thisyear' && sDate.getFullYear() !== now.getFullYear()) return;
 if (mode === 'thismonth' && (sDate.getMonth() !== now.getMonth() || sDate.getFullYear() !== now.getFullYear())) return;
 if (mode === 'custom') {
 if (sDate.getTime() < tStartKey || sDate.getTime()> tEndKey) return;
 }

 let key = "";
 if(mode === 'thisyear') {
 const monthNames = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];
 key = monthNames[sDate.getMonth()];
 } else {
 key = sDate.toLocaleDateString('ms-MY', { day:'2-digit', month:'short' });
 }
 
 if(dailyTotals[key] !== undefined) {
 dailyTotals[key] = round2((dailyTotals[key] || 0) + parseFloat(sale.total_amount || sale.total || 0));
 dailyTx[key]++;
 } else if (mode === '7days') {
 // Out of 7 days scope, safely ignore
 }
 });

 let labels = Object.keys(dailyTotals);
 let dataPoints = Object.values(dailyTotals);
 
 if(adminSalesChartInstance) {
 adminSalesChartInstance.destroy();
 }
 
 const ctx = canvas.getContext('2d');
 adminSalesChartInstance = new window.Chart(ctx, {
 type: mode === 'thisyear' ? 'bar' : 'line',
 data: {
 labels: labels,
 datasets: [{
 label: 'Gross Sales (RM)',
 data: dataPoints,
 borderColor: '#3b82f6',
 backgroundColor: mode === 'thisyear' ? 'rgba(59, 130, 246, 0.6)' : 'rgba(59, 130, 246, 0.2)',
 borderWidth: 2,
 pointBackgroundColor: '#fff',
 pointBorderColor: '#3b82f6',
 pointRadius: 4,
 fill: true,
 tension: 0.3
 }]
 },
 options: {
 responsive: true,
 maintainAspectRatio: false,
 plugins: {
 legend: { display: false },
 tooltip: {
 callbacks: {
 label: function(c) { return 'RM ' + c.raw.toFixed(2); },
 afterLabel: function(c) { return 'Resit Cetak: ' + dailyTx[c.label]; }
 }
 }
 },
 scales: {
 y: { beginAtZero: true, grid: { color: '#f3f4f6' } },
 x: { grid: { display: false } }
 }
 }
 });
};

// 3. Staff Leaderboard (Mgmt Only)
function renderMgmtStaffSales() {
 const tbody = document.getElementById("mgmtStaffSalesTbody");
 if(!tbody) return;
 
 const targetStaff = ["Aliff", "Irfan", "Ariff", "Tarmizi Kael", "Farhan Moyy"];
 let performance = {};
 
 targetStaff.forEach(s => performance[s] = { txCount: 0, gross: 0 });
 
 salesHistory.forEach(sale => {
 let name = sale.staff_name;
 if(name && performance[name]) {
 performance[name].txCount++;
 performance[name].gross = round2(performance[name].gross + parseFloat(sale.total || 0));
 }
 });
 
 const sortedPerformers = Object.entries(performance)
.map(([name, data]) => ({name,...data}))
.sort((a,b) => b.gross - a.gross);
 
 tbody.innerHTML = sortedPerformers.map((p, index) => `
 <tr>
 <td><h3>#${index+1}</h3></td>
 <td><strong>${p.name}</strong></td>
 <td>${p.txCount} Resit</td>
 <td style="color:green; font-weight:bold;">RM ${p.gross.toFixed(2)}</td>
 </tr>
 `).join('');
}

// 4. Customer Issues Tracker
document.getElementById("saveIssueBtn")?.addEventListener('click', () => {
 const cust = document.getElementById("issueCustName").value.trim();
 const desc = document.getElementById("issueDesc").value.trim();
 if(!cust || !desc) return alert("Maklumat pelanggan & aduan wajib diisi.");
 
 customerIssues.unshift({
 id: Date.now(),
 cust: cust,
 desc: desc,
 status: 'OPEN'
 });
 
 document.getElementById("issueCustName").value = "";
 document.getElementById("issueDesc").value = "";
 renderCustomerIssues();
});

function renderCustomerIssues() {
 const tbody = document.getElementById("issueTbody");
 if(!tbody) return;
 
 if(customerIssues.length === 0) {
 tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Tiada isu dilaporkan.</td></tr>';
 return;
 }
 
 tbody.innerHTML = customerIssues.map(c => `
 <tr>
 <td><strong>${c.cust}</strong></td>
 <td>${c.desc}</td>
 <td>
 ${c.status === 'OPEN' 
 ? `<button class="btn-success" style="padding:2px 8px; font-size:10px; background:var(--secondary);" onclick="resolveIssue(${c.id})">Mark Resolved</button>` 
 : `<span style="color:#10B981; font-weight:bold;">TUTUP </span>`}
 </td>
 </tr>
 `).join('');
}

window.resolveIssue = function(id) {
 const issue = customerIssues.find(c => c.id === id);
 if(issue) issue.status = 'RESOLVED';
 renderCustomerIssues();
}

// ===================================
// STAFF ATTENDANCE MODULE (CLOCK)
// ===================================
let clockStream = null;
let currentAttendanceStatus = null; // null | IN | OUT

// 1. Math Formula for Distance
function calculateDistance(lat1, lon1, lat2, lon2) {
 const R = 6371e3; // metres
 const φ1 = lat1 * Math.PI/180;
 const φ2 = lat2 * Math.PI/180;
 const Δφ = (lat2-lat1) * Math.PI/180;
 const Δλ = (lon2-lon1) * Math.PI/180;
 const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
 const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
 return R * c; 
}

// 2. Fetch or Mock DB
async function checkMyAttendanceStatus() {
 if(!currentUser) return;
 document.getElementById("floatingClockBtn").style.display = "flex";
 
 const today = new Date().toISOString().split('T')[0];
 
 if(db) {
 let { data, error } = await db.from('staff_attendance').select('*').eq('staff_name', currentUser.name).eq('date', today);
 if(data && data.length> 0) {
 let record = data[0];
 if(record.clock_out_time) {
 currentAttendanceStatus = "OUT";
 document.getElementById("lblClockFace").textContent = "Anda Telah Clock-Out";
 document.getElementById("floatingClockBtn").style.background = "linear-gradient(135deg, #6B7280, #4B5563)";
 document.getElementById("floatingClockBtn").style.pointerEvents = "none";
 document.getElementById("floatingClockBtn").style.animation = "none";
 } else {
 currentAttendanceStatus = "IN";
 document.getElementById("lblClockFace").textContent = "Clock Out Sekarang";
 document.getElementById("floatingClockBtn").style.background = "linear-gradient(135deg, #EF4444, #DC2626)";
 }
 } else {
 currentAttendanceStatus = null;
 document.getElementById("lblClockFace").textContent = "Clock In Sekarang";
 document.getElementById("floatingClockBtn").style.background = "linear-gradient(135deg, #10B981, #059669)";
 }
 }
}

window.setPremiseLocation = function() {
 if(!navigator.geolocation) return alert("Browser tak support GPS.");
 navigator.geolocation.getCurrentPosition(pos => {
 let lat = pos.coords.latitude;
 let lng = pos.coords.longitude;
 localStorage.setItem("premise_lat", lat);
 localStorage.setItem("premise_lng", lng);
 alert(`Koordinat Kedai diset pada:\nLat: ${lat}\nLng: ${lng}`);
 document.getElementById("txtPremiseDist").textContent = "400";
 }, err => alert("Gagal dpt GPS: " + err.message));
}

window.openClockModal = function() {
 let pLat = localStorage.getItem("premise_lat") || 2.9250;
 let pLng = localStorage.getItem("premise_lng") || 101.6570;
 let radius = 400; // 400 meters

 document.getElementById("clockInOutModal").style.display = "flex";
 const statusTxt = document.getElementById("clockModalStatus");
 const btn = document.getElementById("btnSubmitAttendance");
 const video = document.getElementById("clockVideoFeed");
 const loadTxt = document.getElementById("cameraLoadingText");

 statusTxt.textContent = " Mengesan koordinat GPS anda...";
 statusTxt.style.color = "#0369a1";
 statusTxt.style.background = "#e0f2fe";
 btn.style.display = "none";
 video.style.display = "none";
 loadTxt.style.display = "block";

 navigator.geolocation.getCurrentPosition(pos => {
 let cLat = pos.coords.latitude;
 let cLng = pos.coords.longitude;
 let dist = calculateDistance(pLat, pLng, cLat, cLng);

 if(dist <= radius) {
 statusTxt.textContent = ` Disahkan: Anda berada ${Math.round(dist)}m dari Premis. Mengaktifkan Kamera...`;
 statusTxt.style.color = "#065f46";
 statusTxt.style.background = "#d1fae5";
 
 // Invoke Camera
 navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
.then(stream => {
 clockStream = stream;
 video.srcObject = stream;
 video.style.display = "block";
 loadTxt.style.display = "none";
 btn.style.display = "block";
 btn.disabled = false;
 })
.catch(err => {
 statusTxt.textContent = " Kamera Gagal Diakses. Sila allow permission.";
 statusTxt.style.color = "#991b1b";
 statusTxt.style.background = "#fee2e2";
 loadTxt.textContent = "Akses Ditolak";
 });

 } else {
 statusTxt.textContent = ` Terkeluar Jarak! Anda sejauh ${Math.round(dist)}m (Maksima ${radius}m).`;
 statusTxt.style.color = "#991b1b";
 statusTxt.style.background = "#fee2e2";
 loadTxt.textContent = "Kamera tidak diperlukan";
 }

 }, err => {
 statusTxt.textContent = " Gagal mengesan GPS anda. Pastikan Location dibenarkan.";
 statusTxt.style.color = "#991b1b";
 statusTxt.style.background = "#fee2e2";
 }, { enableHighAccuracy: true });
}

window.closeClockModal = function() {
 if(clockStream) {
 clockStream.getTracks().forEach(t => t.stop());
 }
 document.getElementById("clockInOutModal").style.display = "none";
}

window.submitAttendance = async function() {
 const video = document.getElementById("clockVideoFeed");
 const canvas = document.getElementById("clockSnapshotCanvas");
 const btn = document.getElementById("btnSubmitAttendance");
 
 btn.textContent = " Memproses Rekod...";
 btn.disabled = true;

 // Squeeze Image
 canvas.width = 300;
 canvas.height = 300;
 let ctx = canvas.getContext("2d");
 
 // Crop center
 let size = Math.min(video.videoWidth, video.videoHeight);
 let sx = (video.videoWidth - size) / 2;
 let sy = (video.videoHeight - size) / 2;
 ctx.drawImage(video, sx, sy, size, size, 0, 0, 300, 300);
 
 // Convert base64
 let b64 = canvas.toDataURL("image/jpeg", 0.5); 
 
 let timeStr = new Date().toTimeString().split(' ')[0];
 let today = new Date().toISOString().split('T')[0];

 if(!db) { alert("Tiada akses DB."); closeClockModal(); return; }

 if(currentAttendanceStatus === "IN") {
 // Must Clock Out
 let { error } = await db.from('staff_attendance')
.update({ clock_out_time: timeStr, clock_out_photo: b64 })
.eq('staff_name', currentUser.name).eq('date', today);
 
 if(!error) { alert("Berjaya Clock-Out!"); }
 else { alert("Gagal Clock-Out: " + (error.message || JSON.stringify(error))); }
 } else {
 // Must Clock In
 let { error } = await db.from('staff_attendance')
.insert([{ staff_name: currentUser.name, date: today, clock_in_time: timeStr, clock_in_photo: b64 }]);
 
 if(!error) { alert("Berjaya Clock-In. Mulakan kerja anda!"); }
 else { alert("Gagal Clock-In: " + (error.message || JSON.stringify(error))); }
 }
 
 closeClockModal();
 checkMyAttendanceStatus();
 if(typeof loadAdminAttendance === 'function') loadAdminAttendance();
}

window.loadAdminAttendance = async function() {
 const tbody = document.getElementById("attendanceAdminTbody");
 const distT = document.getElementById("txtPremiseDist");
 if(distT) distT.textContent = (localStorage.getItem("premise_lat") ? "400" : "400");
 
 if(!tbody || !db) return;
 
 const today = new Date().toISOString().split('T')[0];
 let { data, error } = await db.from('staff_attendance').select('*').eq('date', today);
 
 if(error) {
 tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:10px; color:red;">RALAT PANGKALAN DATA: ${error.message}. Adakah jadual ini belum dicipta?</td></tr>`;
 return;
 }
 
 if(!data || data.length === 0) {
 tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:10px;">Belum ada staf clock in hari ini.</td></tr>';
 return;
 }
 
 let html = "";
 data.forEach(r => {
 let p1 = r.clock_in_photo ? `<img src="${r.clock_in_photo}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;">` : "-";
 let p2 = r.clock_out_photo ? `<img src="${r.clock_out_photo}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;">` : "-";
 
 let warnAuto = r.is_auto_clockout ? `<br><small style="color:red;">(Auto 8PM)</small>` : "";
 let cout = r.clock_out_time ? (r.clock_out_time + warnAuto) : "-";

 html += `
 <tr>
 <td style="font-weight:bold;">${r.staff_name}</td>
 <td>${r.date}</td>
 <td style="color:#10B981;">${r.clock_in_time}</td>
 <td>${p1}</td>
 <td style="color:#EF4444;">${cout}</td>
 <td>${p2}</td>
 </tr>
 `;
 });
 tbody.innerHTML = html;
}

// p4_1: per-staff commission rate lookup with fallback chain
function __getCommissionRate(staffName) {
 let rates = {}; try { rates = JSON.parse(localStorage.getItem('staffCommissionRates_v1')||'{}'); } catch(e){}
 const u = (typeof authUsers !== 'undefined' && Array.isArray(authUsers))
 ? authUsers.find(a => a.name === staffName) : null;
 if (u && rates[u.staff_id] !== undefined) return parseFloat(rates[u.staff_id])||0;
 if (u && u.commission_rate !== undefined) return parseFloat(u.commission_rate)||0;
 // Legacy fallback to moyySettings if defined
 if (typeof moyySettings !== 'undefined' && moyySettings.commRate !== undefined) return parseFloat(moyySettings.commRate)||0;
 return 5; // sensible default
}

// Commission period state
window.__cmRange = window.__cmRange || 'month';
window.__cmSetRange = function(range, btn) {
 window.__cmRange = range;
 document.querySelectorAll('.cm-pill').forEach(p => p.classList.toggle('active', p === btn));
 renderPersonalCommission();
};

function __cmGetDateRange() {
 const now = new Date();
 const startOf = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
 const endOf = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
 const r = window.__cmRange || 'month';
 if (r === 'month') { const s = new Date(now.getFullYear(), now.getMonth(), 1); return { start:startOf(s), end:endOf(now), label: now.toLocaleDateString('en-MY', {month:'long', year:'numeric'}) }; }
 if (r === 'lastmonth') { const s = new Date(now.getFullYear(), now.getMonth()-1, 1); const e = new Date(now.getFullYear(), now.getMonth(), 0); return { start:startOf(s), end:endOf(e), label: s.toLocaleDateString('en-MY', {month:'long', year:'numeric'}) }; }
 if (r === 'week') { const s = new Date(now); s.setDate(s.getDate() - s.getDay()); return { start:startOf(s), end:endOf(now), label: 'This week' }; }
 if (r === 'ytd') { const s = new Date(now.getFullYear(), 0, 1); return { start:startOf(s), end:endOf(now), label: now.getFullYear() + ' YTD' }; }
 return { start: null, end: null, label: 'All time' };
}

window.renderPersonalCommission = function() {
 if (!currentUser) return;
 const isManager = currentUser.role === 'mgmt' || currentUser.role === 'superior';
 const range = __cmGetDateRange();

 // Filter sales by date range
 const sales = (Array.isArray(salesHistory) ? salesHistory : []).filter(s => {
 if (!range.start || !range.end) return true;
 const t = s.created_at ? new Date(s.created_at).getTime() : 0;
 return t>= range.start.getTime() && t <= range.end.getTime();
 });

 // Header label + badge
 const lbl = document.getElementById('cmRangeLabel'); if (lbl) lbl.textContent = '· ' + range.label;
 const badge = document.getElementById('cmHeaderBadge');
 if (badge) badge.textContent = isManager ? 'Manager view · all staff' : ('Personal view · ' + currentUser.name);

 // Per-staff aggregator
 function aggregateForStaff(staffName) {
 const own = sales.filter(s => s.staff_name === staffName);
 let gross = 0, refunds = 0, txCount = 0, refundCount = 0;
 own.forEach(s => {
 const amt = parseFloat(s.total_amount || s.total || 0);
 if (amt < 0) { refunds = round2(refunds + Math.abs(amt)); refundCount++; }
 else { gross = round2(gross + amt); txCount++; }
 });
 const net = round2(gross - refunds);
 const rate = __getCommissionRate(staffName);
 const earned = round2(net * rate / 100);
 return { staffName, gross, refunds, net, rate, earned, txCount, refundCount, sales: own };
 }

 // === Personal stats (always show for current user) ===
 const personal = aggregateForStaff(currentUser.name);
 const fmt = (n) => 'RM ' + Number(n).toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2});
 document.getElementById('cmGross').textContent = fmt(personal.gross);
 document.getElementById('cmRefunds').textContent = '−' + fmt(personal.refunds);
 document.getElementById('cmNet').textContent = fmt(personal.net);
 document.getElementById('cmCommission').textContent = fmt(personal.earned);
 document.getElementById('cmTxCount').textContent = personal.txCount;
 document.getElementById('cmRefundCount').textContent = personal.refundCount;
 document.getElementById('cmRateInfo').textContent = 'at ' + personal.rate + '%';

 // === Manager view: all staff ===
 const mgrWrap = document.getElementById('cmManagerWrap');
 if (mgrWrap) mgrWrap.style.display = isManager ? 'block' : 'none';
 if (isManager) {
 const mgrTbody = document.getElementById('cmManagerTbody');
 if (mgrTbody) {
 const allStaff = (typeof authUsers !== 'undefined') ? authUsers : [];
 let inactive = []; try { inactive = JSON.parse(localStorage.getItem('staffInactive_v1')||'[]'); } catch(e){}
 const rows = allStaff
.filter(u => !inactive.includes(u.staff_id))
.map(u => aggregateForStaff(u.name))
.sort((a,b) => b.earned - a.earned);
 mgrTbody.innerHTML = rows.length ? rows.map(r => {
 const u = allStaff.find(a => a.name === r.staffName) || {};
 const isMe = r.staffName === currentUser.name;
 const rowStyle = isMe ? ' style="background:#fffbeb;"' : '';
 return '<tr'+rowStyle+'>'
 + '<td style="padding:8px 10px;"><strong>'+r.staffName+'</strong>'+(isMe?' <span style="font-size:10px; color:var(--primary);">(you)</span>':'')+'</td>'
 + '<td style="padding:8px 10px;"><span style="font-size:10.5px; padding:2px 7px; background:#e5e7eb; border-radius:10px; font-weight:700;">'+(u.role||'—')+'</span></td>'
 + '<td style="padding:8px 10px;">'+r.txCount+(r.refundCount?' <span style="color:#dc2626; font-size:11px;">/'+r.refundCount+'rf</span>':'')+'</td>'
 + '<td style="padding:8px 10px; text-align:right;">'+fmt(r.gross)+'</td>'
 + '<td style="padding:8px 10px; text-align:right; color:#dc2626;">'+(r.refunds>0?'−'+fmt(r.refunds):'—')+'</td>'
 + '<td style="padding:8px 10px; text-align:right; font-weight:700;">'+fmt(r.net)+'</td>'
 + '<td style="padding:8px 10px; text-align:right;">'+r.rate+'%</td>'
 + '<td style="padding:8px 10px; text-align:right; color:var(--primary); font-weight:800;">'+fmt(r.earned)+'</td>'
 + '</tr>';
 }).join('') : '<tr><td colspan="8" style="text-align:center; padding:18px; color:var(--text-muted);">No staff data in range.</td></tr>';
 }
 }

 // === Detail table for current user ===
 const tbody = document.getElementById("myCommissionTbody");
 if (tbody) {
 if (personal.sales.length === 0) {
 tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:18px; color:var(--text-muted);">Tiada rekod dalam '+range.label+'.</td></tr>';
 } else {
 const rate = personal.rate;
 tbody.innerHTML = personal.sales
.slice().sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
.map(s => {
 const amt = parseFloat(s.total_amount || s.total || 0);
 const dateStr = new Date(s.created_at).toLocaleDateString('en-MY', {day:'numeric', month:'short', year:'numeric'});
 const ref = s.id ? '#'+s.id : '—';
 const isRefund = amt < 0;
 const comm = round2(amt * rate / 100);
 const amtCol = isRefund ? '#dc2626' : '#059669';
 return '<tr>'
 + '<td>'+dateStr+'</td>'
 + '<td>'+ref+(isRefund?' <span style="font-size:10px; color:#dc2626; font-weight:700;">REFUND</span>':'')+'</td>'
 + '<td>'+(s.customer_name||'Walk-in')+'</td>'
 + '<td style="text-align:right; color:'+amtCol+'; font-weight:bold;">'+(isRefund?'−':'')+'RM '+Math.abs(amt).toFixed(2)+'</td>'
 + '<td style="text-align:right; color:'+amtCol+'; font-weight:bold;">'+(isRefund?'−':'')+'RM '+Math.abs(comm).toFixed(2)+'</td>'
 + '</tr>';
 }).join('');
 }
 }

 // Backwards-compat hidden spans
 const domSales = document.getElementById("myCommissionSalesTotal"); if (domSales) domSales.textContent = fmt(personal.gross);
 const domEst = document.getElementById("myCommissionEstTotal"); if (domEst) domEst.textContent = fmt(personal.earned);
};

// Auto Clock Out Check Function
async function autoClockOutUnclosed() {
 if(!db) return;
 const now = new Date();
 const isPast8PM = now.getHours()>= 20;
 
 if(isPast8PM) {
 const today = new Date().toISOString().split('T')[0];
 // Fetch anybody who clocked in today but no out yet
 let { data } = await db.from('staff_attendance').select('*').eq('date', today).is('clock_out_time', null);
 if(data && data.length> 0) {
 for(let p of data) {
 await db.from('staff_attendance').update({
 clock_out_time: "20:00:00",
 is_auto_clockout: true
 }).eq('id', p.id);
 }
 }
 }
}


// ============================================
// QUOTATIONS & RENTALS MODULE
// ============================================
let quoteCart = [];
let quoteHistoryLogs = []; // Array of saved quotes
let currentQuoteRef = null; // e.g. "QT-1001"
let currentQuoteVersion = 1; // e.g. 1
let nextQuoteIdNum = 1001;

window.renderQuotePOS = function(searchTerm = "") {
 const list = document.getElementById('quoteProductsList');
 if (!list) return;
 list.innerHTML = "";
 
 // Filter published products
 let activeProducts = masterProducts.filter(p => isPublished(p));
 
 if(searchTerm) {
 let q = searchTerm.toLowerCase();
 activeProducts = activeProducts.filter(p => 
 p.name.toLowerCase().includes(q) || 
 p.sku.toLowerCase().includes(q) || 
 (p.brand && p.brand.toLowerCase().includes(q))
);
 }
 
 activeProducts.slice(0, 50).forEach(product => {
 const hasStock = true; // Use master inventory logic if needed in future
 const stockStatusHtml = `<p class="product-stock" style="color:#10B981">Available</p>`;
 
 const card = document.createElement('div');
 card.className = "product-card";
 card.onclick = () => window.addToQuoteCart(product.sku);
 
 // Find main image
 let imgUrl = (product.images && product.images.length> 0) ? product.images[0] : "https://placehold.co/150x150?text=No+Photo";
 
 card.innerHTML = `
 <img src="${imgUrl}" alt="${product.name}" class="product-img">
 <h3 class="product-title">${product.name}</h3>
 <p class="product-sku">${product.sku}</p>
 ${stockStatusHtml}
 <p class="product-price">RM ${parseFloat(product.price).toFixed(2)}</p>
 `;
 list.appendChild(card);
 });
};

window.addToQuoteCart = function(sku) {
 const product = masterProducts.find(p => p.sku === sku);
 if (!product) return;

 const existing = quoteCart.find(item => item.sku === sku);
 if (existing) {
 existing.qty += 1;
 } else {
 quoteCart.push({
 sku: product.sku,
 name: product.name,
 price: parseFloat(product.price),
 qty: 1
 });
 }
 window.renderQuoteCart();
};

window.updateQuoteCartQty = function(sku, change) {
 const item = quoteCart.find(i => i.sku === sku);
 if (!item) return;
 
 item.qty += change;
 if (item.qty <= 0) {
 quoteCart = quoteCart.filter(i => i.sku !== sku);
 }
 window.renderQuoteCart();
};

window.updateQuoteCartPrice = function(sku, val) {
 const item = quoteCart.find(i => i.sku === sku);
 if (!item) return;
 let np = parseFloat(val);
 item.price = isNaN(np) ? 0 : np;
 window.renderQuoteCart();
};

window.renderQuoteCart = function() {
 const container = document.getElementById('quoteCartItems');
 let total = 0;
 container.innerHTML = "";

 const emptyState = document.getElementById('quoteEmptyState');
 if (emptyState) emptyState.style.display = quoteCart.length === 0 ? "block" : "none";

 if (quoteCart.length === 0) {
 container.innerHTML = ``;
 document.getElementById('quoteTotalPrice').innerText = "0.00";
 return;
 }

 quoteCart.forEach(item => {
 let lineTotal = round2(item.price * item.qty);
 total = round2(total + lineTotal);
 const div = document.createElement('div');
 div.className = "cart-item";
 div.style.display = "flex";
 div.style.flexDirection = "column";
 div.innerHTML = `
 <div style="display:flex; justify-content:space-between; width:100%; margin-bottom:5px;">
 <span style="font-weight:600; font-size:13px;">${item.name} <br><small style="color:#888;">${item.sku}</small></span>
 <span style="font-weight:bold; color:var(--primary);">RM ${lineTotal.toFixed(2)}</span>
 </div>
 <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
 <div style="display:flex; align-items:center; gap:5px;">
 RM <input type="number" step="0.01" value="${item.price.toFixed(2)}" onchange="updateQuoteCartPrice('${item.sku}', this.value)" style="width:70px; padding:2px; text-align:center; border:1px solid #ccc;">
 </div>
 <div class="cart-qty-controls">
 <button class="qty-btn" onclick="updateQuoteCartQty('${item.sku}', -1)">-</button>
 <span>${item.qty}</span>
 <button class="qty-btn" onclick="updateQuoteCartQty('${item.sku}', 1)">+</button>
 </div>
 </div>
 `;
 container.appendChild(div);
 });

 document.getElementById('quoteTotalPrice').innerText = total.toFixed(2);
};

window.toggleQuoteFields = function() {
 const type = document.getElementById("quoteType").value;
 const rentalDiv = document.getElementById("quoteRentalFields");
 const termsEl = document.getElementById("quoteTerms");
 
 if (type === "Rental") {
 rentalDiv.style.display = "block";
 termsEl.value = "1. Penyewa bertanggungjawab menjaga kelengkapan dengan baik.\n2. Denda akan dikenakan jika barang rosak atau hilang mengikut kos ganti.\n3. Barang perlu dipulangkan sebelum 12 tengahari pada tarikh pulang.\n4. Deposit (Cagaran) akan dipulangkan dlm masa 3 hari bekerja slepas barang dipulangkan dengan kuantiti & kondisi yang sama disewa.";
 } else {
 rentalDiv.style.display = "none";
 termsEl.value = "Harga sah untuk 7 hari. Bayaran penuh diperlukan sebelum penyerahan bermula.";
 }
};

window.calculateRentalDays = function() {
 const sStr = document.getElementById("quoteStartDate").value;
 const eStr = document.getElementById("quoteEndDate").value;
 const durEl = document.getElementById("quoteDuration");
 
 if (sStr && eStr) {
 let d1 = new Date(sStr);
 let d2 = new Date(eStr);
 let timeDiff = d2.getTime() - d1.getTime();
 let daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
 if (daysDiff <= 0) daysDiff = 1; // at least 1 day minimum
 durEl.value = daysDiff;
 }
};

window.clearQuoteCart = function() {
 quoteCart = [];
 currentQuoteRef = null;
 currentQuoteVersion = 1;
 document.getElementById("quoteEditIndicator").style.display = "none";
 document.getElementById("quoteType").value = "Sales";
 document.getElementById("quoteCustDetail").value = "";
 document.getElementById("quoteStartDate").value = "";
 document.getElementById("quoteEndDate").value = "";
 document.getElementById("quoteDeposit").value = "";
 document.getElementById("quoteTerms").value = "";
 window.renderQuoteCart();
};

window.saveAndPreviewQuotationParams = async function(docType, docTitle, isViewOnly = false) {
 // Removed the block constraint so the template can be blank
 // if (quoteCart.length === 0) return alert("Sila tambahkan barang ke dalam senarai Quotation dahulu.");
 
 // Only inject default terms if the box is completely empty (prevent overwriting loaded logs)
 document.getElementById("quoteType").value = docType;
 if (!document.getElementById("quoteTerms").value.trim()) {
 if(docType === "Rental") {
 document.getElementById("quoteTerms").value = "1. Penyewa bertanggungjawab menjaga kelengkapan dengan baik.\n2. Denda akan dikenakan jika hilang/rosak.\n3. Deposit cagaran akan dipulangkan dlm masa 3 hari bekerja slepas barang dipulangkan dengan kuantiti & kondisi asal.";
 } else {
 document.getElementById("quoteTerms").value = "Harga sah untuk 7 hari. Bayaran penuh diperlukan sebelum penyerahan bermula.";
 }
 }

 const type = docType;
 document.getElementById("quoteValProjectName").innerText = "Sila taip acara/projek";
 const custDetail = document.getElementById("quoteCustDetail").value || "Walk-In / Guest";
 const terms = document.getElementById("quoteTerms").value;
 
 let subtotal = parseFloat(document.getElementById("quoteTotalPrice").innerText) || 0;
 
 // Logic for Quotation Saving and Versioning
 if (!isViewOnly) {
 let isNew = !currentQuoteRef;
 if(isNew) {
 currentQuoteRef = "QT-" + nextQuoteIdNum++;
 currentQuoteVersion = 1;
 } else {
 currentQuoteVersion++;
 }
 }

 let qId = currentQuoteRef + "-v" + currentQuoteVersion;
 
 let genDateInput = document.getElementById("quoteGeneratedDate") ? document.getElementById("quoteGeneratedDate").value : "";
 let selectedDate = genDateInput ? new Date(genDateInput) : new Date();
 let displayDate = selectedDate.toLocaleDateString('en-GB');

 document.getElementById("quoteHeaderTitle").innerText = docTitle;
 document.getElementById("quoteHeaderSubmitDate").innerText = displayDate;
 document.getElementById("quoteValCurrentDate").innerText = displayDate;
 document.getElementById("quoteValQuoteId").innerText = qId;
 
 let parts = custDetail.split("-");
 document.getElementById("quoteValCustName").innerText = custDetail;
 
 // Rental UI now just uses the deposit row
 let depositBlock = document.getElementById("quoteDepositRowUI");
 
 let grandTotal = round2(subtotal);
 let deposit = 0;
 let rentalData = null;

 if (type === "Rental") {
 const sStr = document.getElementById("quoteStartDate").value;
 const eStr = document.getElementById("quoteEndDate").value;
 const dur = parseInt(document.getElementById("quoteDuration").value) || 1;
 deposit = parseFloat(document.getElementById("quoteDeposit").value) || 0;

 // Rental meta added to project name
 document.getElementById("quoteValProjectName").innerText = `Rental: ${sStr||"TBD"} - ${eStr||"TBD"} (${dur} Hari)`;

 document.getElementById("quotePreviewValDeposit").innerText = deposit.toFixed(2);
 depositBlock.style.display = "flex";

 grandTotal = round2(subtotal + deposit);
 rentalData = { startDate: sStr, endDate: eStr, duration: dur, deposit: deposit };
 } else {
 // no rental container anymore
 depositBlock.style.display = "none";
 }
 
 const tbody = document.getElementById("quoteItemsTableBody");
 tbody.innerHTML = "";
 
 let workingCart = [...quoteCart];
 if(workingCart.length === 0) {
 workingCart = [{
 sku: "CUST-ITEM",
 name: "[Sila Edit Nama Servis/Barang]",
 price: 0.00,
 qty: 1
 }];
 }

 subtotal = 0;
 let rowCount = 0;
 workingCart.forEach((item, index) => {
 let line = round2(item.price * item.qty);
 subtotal = round2(subtotal + line);
 let bg = rowCount % 2 === 0 ? "#F8F8F8" : "#FFFFFF";
 tbody.innerHTML += `
 <tr class="editable-row" style="background-color: ${bg}; border-bottom:1px solid #f1f1f1;">
 <td style="padding:8px 10px; color:#555;">
 <div style="font-style:italic; font-weight:bold; color:#000;" contenteditable="true" spellcheck="false" class="editable-field editable-name">${item.name}</div>
 </td>
 <td style="text-align:center; padding:8px 10px; color:#555;">
 <span contenteditable="true" class="editable-field editable-qty" oninput="window.calculateEditableTotal()">${item.qty}</span>
 </td>
 <td style="text-align:right; padding:8px 10px; color:#555;">
 <span contenteditable="true" class="editable-field editable-price" oninput="window.calculateEditableTotal()">RM ${item.price.toFixed(2)}</span>
 </td>
 <td style="text-align:right; padding:8px 10px; color:#555; font-weight:bold;">
 RM <span class="row-total">${line.toFixed(2)}</span>
 </td>
 </tr>
 `;
 rowCount++;
 });
 
 if (type === "Rental") grandTotal = round2(subtotal + deposit);
 else grandTotal = round2(subtotal);

 document.getElementById("quotePreviewGrandTotal").innerText = grandTotal.toFixed(2);
 document.getElementById("quoteSubtotal").innerText = "RM " + subtotal.toFixed(2);
 document.getElementById("quoteValSubtotal").innerText = subtotal.toFixed(2);
 document.getElementById("quoteGrandTotal").innerText = "RM " + grandTotal.toFixed(2);
 
 // Fix: Match correct ID from index.html (quotePreviewTnc instead of quoteTermsText)
 const tncNode = document.getElementById("quotePreviewTnc") || document.getElementById("quoteTermsText");
 if(tncNode) tncNode.innerText = terms;
 
 // Save to Log History Array
 const logEntry = {
 id: qId,
 ref: currentQuoteRef,
 version: currentQuoteVersion,
 type: type,
 customer: custDetail,
 terms: terms,
 subtotal: subtotal,
 grand_total: grandTotal,
 rental_data: rentalData,
 items: JSON.parse(JSON.stringify(quoteCart)),
 superseded: false
 };
 if(genDateInput) logEntry.created_at = selectedDate.toISOString();

 // Mark previous instances of this ref as superseded in Cloud
 if (!isViewOnly) {
 try {
 if(currentQuoteVersion> 1) {
 await db.from('quotations_log')
.update({ superseded: true })
.eq('ref', currentQuoteRef)
.lt('version', currentQuoteVersion);

 // Update local state temporarily mapping
 quoteHistoryLogs.forEach(log => {
 if(log.ref === currentQuoteRef && log.version < currentQuoteVersion) {
 log.superseded = true;
 }
 });

 // p4_12: release prior version reservations (new version will reserve fresh)
 if(typeof window.releaseReservationsForQuote === 'function') {
 try { await window.releaseReservationsForQuote(currentQuoteRef); } catch(e){}
 }
 }

 let { data, error } = await db.from('quotations_log').insert([logEntry]).select();
 if(data && data.length> 0) {
 // Convert to camelCase locally for UI consistency (Supabase uses snake_case based on our SQL script)
 let sc = data[0];
 quoteHistoryLogs.unshift({
 id: sc.id,
 ref: sc.ref,
 version: sc.version,
 type: sc.type,
 customer: sc.customer,
 terms: sc.terms,
 subtotal: sc.subtotal,
 grandTotal: sc.grand_total,
 rentalData: sc.rental_data,
 items: sc.items,
 createdAt: sc.created_at,
 superseded: sc.superseded
 });

 // p4_12: auto-reserve stock for SKUs in master (custom lines skipped)
 if(typeof window.reserveItemsForQuote === 'function' && Array.isArray(sc.items)) {
 try {
 const rr = await window.reserveItemsForQuote(sc.ref, sc.items);
 const failed = (rr.results || []).filter(x => x.ok === false);
 if(failed.length && typeof showToast === 'function') {
 showToast(` ${failed.length} item gagal reserve (stock kurang) — quote masih saved`, 'warn');
 }
 } catch(e) { console.error('reserve failed:', e); }
 }
 } else if (error) {
 console.error("Supabase Save Quote Error:", error.message);
 alert("Fail saving to Cloud: " + error.message);
 }
 } catch(e) {
 console.error("Save Quote Exception:", e);
 }
 }

 // Update Editing Indicator UI
 document.getElementById("quoteEditRefLabel").innerText = currentQuoteRef + " (v" + currentQuoteVersion + ")";
 document.getElementById("quoteEditIndicator").style.display = "flex";

 document.getElementById("quoteModal").style.display = "flex";
};

window.deleteQuoteLog = async function(logId) {
 if(!confirm('Adakah anda pasti mahu memadam Quotation/Invoice ini secara kekal?')) return;
 try {
 // p4_12: release reservations linked to this quote ref BEFORE delete
 const log = quoteHistoryLogs.find(l => l.id === logId);
 if(log && log.ref && typeof window.releaseReservationsForQuote === 'function') {
 try { await window.releaseReservationsForQuote(log.ref); } catch(e){}
 }
 if(db) await db.from('quotations_log').delete().eq('id', logId);
 quoteHistoryLogs = quoteHistoryLogs.filter(l => l.id !== logId);
 window.renderQuoteLogs();
 alert('Rekod berjaya dipadam.');
 } catch(e) {
 alert('Gagal memadam rekod: ' + e.message);
 }
};

window.renderQuoteLogs = function() {
 const tbody = document.getElementById("quoteLogsTableBody");
 if (!tbody) return;
 
 if (quoteHistoryLogs.length === 0) {
 tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px;">Tiada Sebut Harga. Sila buat satu.</td></tr>`;
 document.getElementById("quoteLogsModal").style.display = "flex";
 return;
 }
 
 let searchInput = document.getElementById("quoteLogSearch");
 let filterVal = searchInput ? searchInput.value.toLowerCase() : "";
 let yearInput = document.getElementById("quoteLogYearFilter");
 let yearFilter = yearInput ? yearInput.value : "All";

 tbody.innerHTML = "";
 let filteredLogs = [...quoteHistoryLogs];
 if(filterVal) {
 filteredLogs = filteredLogs.filter(l => (l.id && l.id.toLowerCase().includes(filterVal)) || (l.customer && l.customer.toLowerCase().includes(filterVal)));
 }
 if(yearFilter !== "All") {
 filteredLogs = filteredLogs.filter(l => {
 let d = new Date(l.createdAt || l.created_at);
 return d.getFullYear().toString() === yearFilter;
 });
 }

 if(filteredLogs.length === 0) {
 tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px;">Tiada rekod jumpa.</td></tr>`;
 }

 filteredLogs.forEach(log => {
 let isSuper = log.superseded ? `<span style="background:#EF4444; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">Lama</span>` : `<span style="background:#10B981; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">Latest</span>`;
 let custPart = (log.customer || "").split("-")[0] || "Guest";
 let dateObj = new Date(log.createdAt || log.created_at);
 let logYear = isNaN(dateObj) ? "-" : dateObj.getFullYear();
 let displayStr = isNaN(dateObj) ? "Tiada Tarikh" : dateObj.toLocaleString('ms-MY');
 
 tbody.innerHTML += `
 <tr style="background:${log.superseded ? '#f9f9f9' : '#fff'}; color:${log.superseded ? '#888' : '#000'}">
 <td><strong>${log.id}</strong><br><small style="color:#aaa;">${displayStr}</small></td>
 <td><strong>${logYear}</strong></td>
 <td>${custPart}</td>
 <td>${log.type}</td>
 <td>RM ${(log.subtotal || 0).toFixed(2)}</td>
 <td>v${log.version} ${isSuper}</td>
 <td>
 <button onclick="window.loadQuoteIntoCart('${log.id}')" class="btn-dark" style="padding:6px 10px; font-size:10px; margin:0; margin-right:5px;">Edit / Load</button>
 <button onclick="window.deleteQuoteLog('${log.id}')" class="btn-primary" style="background:#EF4444; padding:6px 10px; font-size:10px; margin:0;">Delete</button>
 </td>
 </tr>
 `;
 });
 
 document.getElementById("quoteLogsModal").style.display = "flex";
};

window.loadQuoteIntoCart = function(logId) {
 const log = quoteHistoryLogs.find(l => l.id === logId);
 if(!log) return;
 
 if(!confirm(`Adakah anda pasti mahu edit ` + logId + `? Ini akan memadamkan troli sekarang.`)) return;
 
 // Set variables
 currentQuoteRef = log.ref;
 currentQuoteVersion = log.version;
 
 quoteCart = JSON.parse(JSON.stringify(log.items));
 
 // Fill UI
 document.getElementById("quoteType").value = log.type;
 document.getElementById("quoteCustDetail").value = log.customer;
 document.getElementById("quoteTerms").value = log.terms;
 
 if (log.createdAt || log.created_at) {
 let d = new Date(log.createdAt || log.created_at);
 if (!isNaN(d)) {
 let yyyy = d.getFullYear();
 let mm = String(d.getMonth() + 1).padStart(2, '0');
 let dd = String(d.getDate()).padStart(2, '0');
 let qDateEl = document.getElementById("quoteGeneratedDate");
 if(qDateEl) qDateEl.value = `${yyyy}-${mm}-${dd}`;
 }
 } else {
 let qDateEl = document.getElementById("quoteGeneratedDate");
 if(qDateEl) qDateEl.value = "";
 }
 
 if(log.rentalData) {
 document.getElementById("quoteStartDate").value = log.rentalData.startDate || log.rentalData.start_date || "";
 document.getElementById("quoteEndDate").value = log.rentalData.endDate || log.rentalData.end_date || "";
 document.getElementById("quoteDuration").value = log.rentalData.duration || 1;
 document.getElementById("quoteDeposit").value = log.rentalData.deposit !== undefined ? log.rentalData.deposit.toFixed(2) : "";
 }
 
 window.renderQuoteCart();
 
 document.getElementById("quoteEditRefLabel").innerText = currentQuoteRef + " (Loading v" + currentQuoteVersion + "...)";
 document.getElementById("quoteEditIndicator").style.display = "flex";
 document.getElementById("quoteLogsModal").style.display = "none";
 
 // Auto-open PDF Preview in View-Only state to satisfy user UX
 let dTitle = log.type === 'Rental' ? 'RENTAL QUO.' : 'QUOTATION';
 window.saveAndPreviewQuotationParams(log.type, dTitle, true);
};

document.getElementById('quoteSearchInput')?.addEventListener('input', (e) => {
 renderQuotePOS(e.target.value);
});
window.syncQuoteModalToCloud = async function() {
 window.calculateEditableTotal();
 
 if(!confirm("Anda pasti mahu merakam rekod ini dan menjadikannya versi rasmi baharu (v+)?")) return;
 
 // 1. Kutip kesemua HTML dari tag dalam modal supaya susunan bold/font tersimpan
 let updatedCart = [];
 document.querySelectorAll('#quoteItemsTableBody tr').forEach(row => {
 let nameEl = row.querySelector('.editable-name');
 let qtyEl = row.querySelector('.editable-qty');
 let priceEl = row.querySelector('.editable-price');
 if(nameEl && qtyEl && priceEl) {
 updatedCart.push({
 sku: "CUST-ITEM",
 name: nameEl.innerHTML,
 qty: parseFloat(qtyEl.innerText.replace(/[^0-9.-]+/g,"")) || 1,
 price: parseFloat(priceEl.innerText.replace(/[^0-9.-]+/g,"")) || 0
 });
 }
 });
 
 if(updatedCart.length === 0) return alert("Sila isikan sekurang-kurangnya 1 item.");
 
 quoteCart = updatedCart;
 window.renderQuoteCart();
 
 // 2. Petik tajuk supaya kekal cantik
 let custVal = document.getElementById("quoteValCustName").innerText;
 let titleVal = document.getElementById("quoteHeaderTitle").innerText;
 let tncVal = document.getElementById("quotePreviewTnc").innerHTML;
 
 document.getElementById("quoteCustDetail").value = custVal;
 document.getElementById("quoteTerms").value = tncVal;
 
 // 3. Tolak ke Supabase sbg versi baharu
 await window.saveAndPreviewQuotationParams(document.getElementById("quoteType").value, titleVal, false);
 
 alert("Kerja Berjaya! Versi telah disimpan dengan sempurna. Sila tekan Print PDF.");
};

window.addNewQuoteRow = function() {
 const tbody = document.getElementById("quoteItemsTableBody");
 if(!tbody) return;
 
 let rowsCount = document.querySelectorAll('#quoteItemsTableBody tr').length;
 let bg = rowsCount % 2 === 0 ? "#F8F8F8" : "#FFFFFF";
 
 let newTr = document.createElement("tr");
 newTr.className = "editable-row";
 newTr.style.cssText = `background-color: ${bg}; border-bottom:1px solid #f1f1f1;`;
 
 newTr.innerHTML = `
 <td style="padding:8px 10px; color:#555;">
 <div style="font-style:italic; font-weight:bold; color:#000;" contenteditable="true" spellcheck="false" class="editable-field editable-name">[Nama Item Baru]</div>
 </td>
 <td style="text-align:center; padding:8px 10px; color:#555;">
 <span contenteditable="true" class="editable-field editable-qty" oninput="window.calculateEditableTotal()">1</span>
 </td>
 <td style="text-align:right; padding:8px 10px; color:#555;">
 <span contenteditable="true" class="editable-field editable-price" oninput="window.calculateEditableTotal()">RM 0.00</span>
 </td>
 <td style="text-align:right; padding:8px 10px; color:#555; font-weight:bold;">
 RM <span class="row-total">0.00</span>
 </td>
 `;
 
 tbody.appendChild(newTr);
};

window.calculateEditableTotal = function() {
 let subtotal = 0;
 const rows = document.querySelectorAll('#quoteItemsTableBody tr');
 
 rows.forEach(row => {
 let qtyEl = row.querySelector('.editable-qty');
 let priceEl = row.querySelector('.editable-price');
 let rowTotalEl = row.querySelector('.row-total');
 
 if(qtyEl && priceEl && rowTotalEl) {
 let q = parseFloat(qtyEl.innerText.replace(/[^0-9.-]+/g,"")) || 0;
 let p = parseFloat(priceEl.innerText.replace(/[^0-9.-]+/g,"")) || 0;
 let lineTotal = round2(q * p);
 subtotal = round2(subtotal + lineTotal);
 rowTotalEl.innerText = lineTotal.toFixed(2);
 }
 });

 let depositEl = document.getElementById("quotePreviewValDeposit");
 let deposit = 0;
 if(depositEl) deposit = parseFloat(depositEl.innerText.replace(/[^0-9.-]+/g,"")) || 0;

 let discountEl = document.getElementById("quoteValDiscount");
 let discount = 0;
 if(discountEl) discount = parseFloat(discountEl.innerText.replace(/[^0-9.-]+/g,"")) || 0;

 let grandTotal = round2(subtotal + deposit - discount);
 let gtEl = document.getElementById("quotePreviewGrandTotal");
 if(gtEl) gtEl.innerText = grandTotal.toFixed(2);
 
 let subEl2 = document.getElementById("quoteValSubtotal");
 if(subEl2) subEl2.innerText = subtotal.toFixed(2);
 
 // Hidden inputs update
 let subEl = document.getElementById("quoteSubtotal");
 if(subEl) subEl.innerText = subtotal.toFixed(2);
 let gtEl2 = document.getElementById("quoteGrandTotal");
 if(gtEl2) gtEl2.innerText = grandTotal.toFixed(2);
};
// ===================================
// PRODUCT REGISTRATION MODE
// ===================================
window.saveMasterProduct = async function() {
 const get = (id) => (document.getElementById(id)?.value || '').trim();
 const getNum = (id) => {
 const v = document.getElementById(id)?.value;
 return v === '' || v == null ? null : parseFloat(v);
 };

 const name = get('mpName');
 const sku = get('mpSku').toUpperCase();
 const price = getNum('mpPrice');

 if(!name || !sku || price == null || isNaN(price)) {
 return showToast('Nama, SKU, Harga Jualan wajib diisi.', 'warn');
 }

 if(masterProducts.find(p => p.sku === sku)) {
 return showToast(`SKU "${sku}" sudah wujud. Guna Edit untuk update.`, 'warn');
 }

 const imageUrl = get('mpImageUrl');
 const payload = {
 sku, name,
 unit: get('mpUnit') || 'pcs',
 price,
 cost_price: getNum('mpCostPrice'),
 category: get('mpCategory') || null,
 brand: get('mpBrand') || null,
 model_no: get('mpModelNo') || null,
 parent_sku: get('mpParentSku').toUpperCase() || null,
 erp_barcode: get('mpErpBarcode') || null,
 variant_color: get('mpVariantColor') || null,
 variant_size: get('mpVariantSize') || null,
 weight_kg: getNum('mpWeightKg'),
 length_cm: getNum('mpLengthCm'),
 width_cm: getNum('mpWidthCm'),
 height_cm: getNum('mpHeightCm'),
 location_bin: get('mpLocationBin') || null,
 description: get('mpDescription') || null,
 commission_rate: getNum('mpCommissionRate'),
 reorder_point: getNum('mpReorderPoint'),
 reorder_qty: getNum('mpReorderQty'),
 lead_time_days: getNum('mpLeadTimeDays'),
 images: imageUrl ? [imageUrl] : null,
 is_published: get('mpIsPublished') === 'true'
 };

 // Strip null fields so PG defaults / nulls land cleanly
 const cleaned = {};
 for(const [k, v] of Object.entries(payload)) {
 if(v !== null && v !== '' && !(typeof v === 'number' && isNaN(v))) cleaned[k] = v;
 }

 const { data: newProd, error } = await db.from('products_master').insert([cleaned]).select();
 if(error) {
 console.error('Master Product insert error:', error);
 return showToast('Ralat: ' + error.message, 'error');
 }
 if(newProd && newProd.length> 0) masterProducts.push(newProd[0]);

 try {
 await db.from('audit_logs').insert([{
 action_type: 'master_product_create',
 actor_name: currentUser ? currentUser.name : 'System',
 details: JSON.stringify({ sku, name, brand: cleaned.brand, price, published: cleaned.is_published }),
 created_at: new Date().toISOString()
 }]);
 } catch(_){}

 showToast(`Profil "${name}" (${sku}) berjaya dicipta!`, 'success');

 // Clear all fields
 ['mpName','mpSku','mpBrand','mpCategory','mpModelNo','mpParentSku','mpPrice','mpCostPrice',
 'mpVariantColor','mpVariantSize','mpErpBarcode','mpWeightKg','mpLengthCm','mpWidthCm','mpHeightCm',
 'mpLocationBin','mpDescription','mpImageUrl','mpCommissionRate',
 'mpReorderPoint','mpReorderQty','mpLeadTimeDays'
].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
 const unitEl = document.getElementById('mpUnit'); if(unitEl) unitEl.value = 'pcs';
 const pubEl = document.getElementById('mpIsPublished'); if(pubEl) pubEl.value = 'false';
};

// Auto-populate brand & category datalists from existing products
window.refreshMpDatalists = function() {
 const bList = document.getElementById('mpBrandList');
 const cList = document.getElementById('mpCategoryList');
 if(!bList || !cList || typeof masterProducts === 'undefined') return;
 const brands = [...new Set(masterProducts.map(p => p.brand).filter(Boolean))].sort();
 const cats = [...new Set(masterProducts.map(p => p.category).filter(Boolean))].sort();
 bList.innerHTML = brands.map(b => `<option value="${b}">`).join('');
 cList.innerHTML = cats.map(c => `<option value="${c}">`).join('');
};
window.saveProductRegistration = async function() {
 let shipmentNo = document.getElementById("prShipmentNo").value.trim();
 let shipmentDate = document.getElementById("prShipmentDate").value;
 let sku = document.getElementById("prSku").value.trim().toUpperCase();
 let priceRmb = document.getElementById("prPriceRmb").value;
 let units = document.getElementById("prUnitPurchased").value;
 let shippingCost = document.getElementById("prShippingCost").value;
 
 if(!shipmentNo || !shipmentDate || !sku || !priceRmb || !units || !shippingCost) {
 alert("Sila lengkapkan semua maklumat pendaftaran produk.");
 return;
 }
 
 // Parse values
 let qtyReceived = parseInt(units);
 
 // Only send columns that are proven to exist in inventory_batches
 const batchPayload = {
 sku: sku,
 batch_year: new Date(shipmentDate).getFullYear() || new Date().getFullYear(),
 inbound_date: shipmentDate,
 qty_received: qtyReceived,
 qty_remaining: qtyReceived
 };
 
 // Insert to Supabase (inventory_batches)
 let { data: newBatch, error: batchErr } = await db.from('inventory_batches').insert([batchPayload]).select();
 
 if(batchErr) {
 console.error("Batch Insert Error:", batchErr);
 alert("Ralat menyimpan Batch. Pastikan SKU wujud di Master Product.");
 return;
 }

 // Combine extra data into the reason text for tracking
 let trackingInfo = `PO: ${shipmentNo} | RMB: ${priceRmb} | Ship: RM${shippingCost}`;

 // Insert Transaction Audit Trail
 const txnPayload = {
 sku: sku,
 transaction_type: 'PO_IN',
 qty: qtyReceived,
 reason: trackingInfo,
 staff_name: currentUser ? currentUser.name : 'System',
 created_at: new Date().toISOString()
 };
 
 let { data: newTxn, error: txnErr } = await db.from('inventory_transactions').insert([txnPayload]).select();
 
 if(txnErr) {
 console.error("Transaction Insert Error:", txnErr);
 }
 
 // Update Local State
 if(newBatch && newBatch.length> 0) inventoryBatches.push(newBatch[0]);
 if(newTxn && newTxn.length> 0) inventoryTransactions.unshift(newTxn[0]);
 
 alert(`Batch PO (${shipmentNo}) Berjaya Didaftarkan untuk SKU: ${sku}!`);
 
 // Clear fields
 document.getElementById("prShipmentNo").value = "";
 document.getElementById("prShipmentDate").value = "";
 document.getElementById("prSku").value = "";
 document.getElementById("prPriceRmb").value = "";
 document.getElementById("prUnitPurchased").value = "";
 document.getElementById("prShippingCost").value = "";
 
 // Refresh relevant UI if they are open
 if(typeof renderLowStockAlert === "function") renderLowStockAlert();
};

window.populateEditSkuList = function() {
 const list = document.getElementById('editSkuList');
 if(!list) return;
 list.innerHTML = masterProducts.map(p => `<option value="${p.sku}">${p.name}</option>`).join('');
};

window.loadProductForEdit = function(sku) {
 if(!sku) return;
 const prod = masterProducts.find(p => p.sku === sku);
 if(!prod) return alert("SKU tidak dijumpai di Gudang Pusat.");
 
 document.getElementById('epName').value = prod.name || '';
 document.getElementById('epCategory').value = prod.category || '';
 document.getElementById('epPrice').value = prod.price || 0;
 document.getElementById('epCost').value = prod.cost_price || 0;
 document.getElementById('epImages').value = (prod.images || []).join(', ');
 
 // Parse location_bin assuming format "RACK-TIER-BIN" or just text
 let loc = prod.location_bin || '';
 let locParts = loc.split('-');
 document.getElementById('epRack').value = locParts[0] || '';
 document.getElementById('epTier').value = locParts[1] || '';
 document.getElementById('epBin').value = locParts[2] || '';

 
 document.getElementById('editProductFields').style.display = 'grid';
};

window.saveProductEdit = async function() {
 const sku = document.getElementById('editSkuSearch').value;
 if(!sku) return;
 
 const name = document.getElementById('epName').value;
 const category = document.getElementById('epCategory').value;
 const price = parseFloat(document.getElementById('epPrice').value) || 0;
 const cost = parseFloat(document.getElementById('epCost').value) || 0;
 const imagesRaw = document.getElementById('epImages').value;
 const images = imagesRaw ? imagesRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
 
 const rack = document.getElementById('epRack').value.trim();
 const tier = document.getElementById('epTier').value.trim();
 const bin = document.getElementById('epBin').value.trim();
 const locationStr = [rack, tier, bin].filter(Boolean).join('-');

 
 const updatePayload = {
 name: name,
 category: category,
 price: price,
 cost_price: cost,
 images: images,
 location_bin: locationStr
 };
 
 try {
 let { error } = await db.from('products_master').update(updatePayload).eq('sku', sku);
 if(error) throw error;
 
 alert(`Berjaya kemas kini profil SKU: ${sku}`);
 await window.initApp(); // reload masterProducts
 document.getElementById('editProductFields').style.display = 'none';
 document.getElementById('editSkuSearch').value = '';
 } catch(e) {
 alert("Ralat mengemaskini produk: " + e.message);
 }
};

window.populateMovementSkuList = function() {
 const list = document.getElementById('movementSkuList');
 if(!list) return;
 list.innerHTML = masterProducts.map(p => `<option value="${p.sku}">${p.name}</option>`).join('');
};

window.processInbound = async function() {
 const sku = (document.getElementById('inboundSkuSearch').value || '').trim();
 const qty = parseInt(document.getElementById('inboundQty').value) || 0;
 const costEl = document.getElementById('inboundCost');
 const cost = costEl ? parseFloat(costEl.value) : null;
 const supplier = (document.getElementById('inboundSupplier')?.value || '').trim();
 const ref = (document.getElementById('inboundRef').value || '').trim();

 if(!sku || qty <= 0) return showToast('SKU & kuantiti wajib.', 'warn');
 const prod = masterProducts.find(p => p.sku === sku);
 if(!prod) return showToast('SKU tak wujud dalam Master Product.', 'warn');

 try {
 const batchPayload = {
 sku, qty_received: qty, qty_remaining: qty,
 inbound_date: new Date().toISOString().split('T')[0]
 };
 if(!isNaN(cost) && cost != null && cost> 0) {
 batchPayload.cost_price = cost;
 batchPayload.landed_cost = cost;
 }
 if(supplier) batchPayload.supplier_name = supplier;
 if(ref) batchPayload.notes = ref;

 const { error } = await db.from('inventory_batches').insert([batchPayload]);
 if(error) throw error;

 const reasonText = `Manual Inbound${supplier ? ' from ' + supplier : ''}${ref ? ' (' + ref + ')' : ''}${cost ? ' @ RM' + cost.toFixed(2) : ''}`;
 await db.from('inventory_transactions').insert([{
 sku, transaction_type: 'IN', qty, reason: reasonText,
 staff_name: currentUser ? currentUser.name : 'System',
 created_at: new Date().toISOString()
 }]);

 showToast(`+${qty} ${sku} diterima${cost ? ' @ RM' + cost.toFixed(2) : ''}`, 'success');
 ['inboundSkuSearch','inboundQty','inboundCost','inboundSupplier','inboundRef'].forEach(id => {
 const el = document.getElementById(id); if(el) el.value = '';
 });
 await window.initApp();
 } catch(e) {
 showToast('Ralat Inbound: ' + e.message, 'error');
 }
};

window.processOutbound = async function() {
 const sku = document.getElementById('outboundSkuSearch').value.trim();
 const qty = parseInt(document.getElementById('outboundQty').value) || 0;
 const reason = document.getElementById('outboundReason').value;
 const note = document.getElementById('outboundNote').value.trim();

 if(!sku || qty <= 0) return showToast("Sila isikan SKU dan kuantiti sah untuk Outbound.", 'warn');

 let relevantBatches = inventoryBatches.filter(b => b.sku === sku && b.qty_remaining> 0)
.sort((a, b) => new Date(a.inbound_date) - new Date(b.inbound_date));
 let totalStock = relevantBatches.reduce((sum, b) => sum + b.qty_remaining, 0);
 if(totalStock < qty) return showToast(`Stok tak cukup. Baki sistem: ${totalStock}`, 'warn');

 // Compute write-off RM value (rough — uses master price)
 const prod = masterProducts.find(p => p.sku === sku);
 const unitCost = prod ? (prod.cost_price || prod.price || 0) : 0;
 const writeoffValue = unitCost * qty;

 // Decide if Manager PIN required
 const HIGH_RISK = ['Kerosakan / Pecah', 'Lain-lain'];
 const VALUE_THRESHOLD = 100; // RM
 const needsPin = HIGH_RISK.includes(reason) || writeoffValue>= VALUE_THRESHOLD;

 let approval = null;
 if(needsPin) {
 const detailsHtml = `
 <strong>SKU:</strong> ${sku}<br>
 <strong>Qty keluar:</strong> ${qty} unit<br>
 <strong>Sebab dari staf:</strong> ${reason}${note ? ' — ' + note : ''}<br>
 <strong>Anggaran nilai write-off:</strong> RM ${writeoffValue.toFixed(2)}
 `;
 approval = await requireManagerPin({
 title: 'Kelulusan Write-Off / Outbound',
 subtitle: 'Outbound bernilai tinggi atau berisiko fraud — perlu sahkan dengan Manager PIN.',
 detailsHtml,
 reasons: [
 'Sah — kerosakan diperakui',
 'Sah — transfer cawangan',
 'Sah — display/marketing',
 'Sah — promosi / sample',
 'Sah — kos operasi',
 'Lain-lain (catat dalam note)'
]
 });
 if(!approval) return showToast('Outbound dibatalkan (tiada kelulusan).', 'warn');
 }

 try {
 let remaining = qty;
 for(const batch of relevantBatches) {
 if(remaining <= 0) break;
 const deduct = Math.min(batch.qty_remaining, remaining);
 const { error } = await db.from('inventory_batches')
.update({ qty_remaining: batch.qty_remaining - deduct }).eq('id', batch.id);
 if(error) throw error;
 remaining -= deduct;
 }

 const fullReason = approval
 ? `${reason} | Approved by: ${approval.manager.name} (${approval.reason})${approval.note ? ' — ' + approval.note : ''}${note ? ' | Staf note: ' + note : ''}`
 : reason + (note ? ' - ' + note : '');

 await db.from('inventory_transactions').insert([{
 sku, transaction_type: 'OUT', qty, reason: fullReason,
 staff_name: currentUser ? currentUser.name : 'System',
 created_at: new Date().toISOString()
 }]);

 if(approval) {
 await db.from('audit_logs').insert([{
 action_type: 'outbound_writeoff',
 actor_name: approval.manager.name,
 target_staff: currentUser ? currentUser.name : null,
 details: JSON.stringify({
 sku, qty, reason, staff_note: note,
 approver_reason: approval.reason, approver_note: approval.note,
 estimated_value_rm: writeoffValue
 }),
 created_at: new Date().toISOString()
 }]);
 }

 showToast(`${qty} unit ${sku} ditolak. ${approval ? 'Approved by ' + approval.manager.name : ''}`, 'success');
 document.getElementById('outboundSkuSearch').value = '';
 document.getElementById('outboundQty').value = '';
 document.getElementById('outboundNote').value = '';
 await window.initApp();
 } catch(e) {
 showToast('Ralat Outbound: ' + e.message, 'error');
 }
};

window.loadAuditProduct = function() {
 const sku = document.getElementById('auditSku').value.trim();
 if(!sku) return;
 
 const prod = masterProducts.find(p => p.sku === sku);
 if(!prod) return; // Silent return if not found, wait for full typing
 
 const myBatches = inventoryBatches.filter(b => b.sku === sku && b.qty_remaining> 0);
 const totalStock = myBatches.reduce((sum, b) => sum + b.qty_remaining, 0);
 
 document.getElementById('auditSysQty').value = totalStock;
 document.getElementById('auditPhysQty').focus();
};

window.submitStockAudit = async function() {
 const sku = document.getElementById('auditSku').value.trim();
 const sysQty = parseInt(document.getElementById('auditSysQty').value) || 0;
 const physQtyStr = document.getElementById('auditPhysQty').value;
 
 if(!sku || physQtyStr === '') return alert("Sila isikan SKU dan Kuantiti Fizikal.");
 const physQty = parseInt(physQtyStr);
 
 if(sysQty === physQty) {
 alert(`Tiada perbezaan stok untuk ${sku}. Selesai audit.`);
 document.getElementById('auditSku').value = '';
 document.getElementById('auditSysQty').value = '';
 document.getElementById('auditPhysQty').value = '';
 return;
 }
 
 const diff = physQty - sysQty;
 const diffText = diff> 0 ? `+${diff} (Berlebihan)` : `${diff} (Hilang/Rosak)`;
 
 const confirmAudit = confirm(`Perbezaan dikesan: ${diffText}\nKuantiti Sistem: ${sysQty}\nKuantiti Fizikal: ${physQty}\n\nAdakah anda pasti mahu hantar laporan Discrepancy ini?`);
 if(!confirmAudit) return;
 
 try {
 const payload = {
 request_type: 'Discrepancy',
 status: 'Pending',
 metadata: {
 sku: sku,
 system_qty: sysQty,
 physical_qty: physQty,
 difference: diff,
 reported_by: currentUser ? currentUser.name : 'Unknown'
 }
 };
 let { error } = await db.from('pending_requests').insert([payload]);
 if(error) throw error;
 
 alert(`Laporan Discrepancy ${sku} berjaya dihantar untuk kelulusan.`);
 document.getElementById('auditSku').value = '';
 document.getElementById('auditSysQty').value = '';
 document.getElementById('auditPhysQty').value = '';
 // Wait for realtime UI update
 } catch(e) {
 alert("Ralat menghantar laporan audit: " + e.message);
 }
};

window.renderWhAudit = function() {
 const tbody = document.getElementById("whAuditTbody");
 if(!tbody) return;
 
 const audits = pendingSchedules.filter(r => r.request_type === 'Discrepancy' && r.status === 'Pending');
 if(audits.length === 0) {
 tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#888;">Tiada laporan Discrepancy yang menunggu kelulusan.</td></tr>`;
 return;
 }
 
 tbody.innerHTML = audits.map(a => {
 let meta = a.metadata || {};
 let diffColor = meta.difference> 0 ? '#10B981' : '#EF4444';
 return `
 <tr>
 <td><strong>${meta.sku || 'N/A'}</strong><br><span style="color:${diffColor}; font-weight:bold;">${meta.difference> 0 ? '+'+meta.difference : meta.difference} unit</span></td>
 <td>${meta.reported_by || 'Staf'}</td>
 <td>
 <button class="btn-success" style="padding:4px 8px; font-size:10px; margin-bottom:4px;" onclick="window.approveDiscrepancy('${a.id}', '${meta.sku}', ${meta.difference})">Lulus</button><br>
 <button class="btn-primary" style="background:#EF4444; border:none; padding:4px 8px; font-size:10px;" onclick="window.rejectRequest('${a.id}')">Tolak</button>
 </td>
 </tr>
 `;
 }).join('');
};

window.approveDiscrepancy = async function(reqId, sku, difference) {
 if(!confirm(`Luluskan pelarasan stok ${difference> 0 ? '+'+difference : difference} unit untuk ${sku}?`)) return;
 
 try {
 // Find batch to adjust
 if(difference> 0) {
 // Surplus, create a new inbound batch
 await db.from('inventory_batches').insert([{
 sku: sku, qty_received: difference, qty_remaining: difference, inbound_date: new Date().toISOString().split('T')[0]
 }]);
 } else {
 // Shortage, deduct from oldest batch (similar to outbound)
 let qtyToDeduct = Math.abs(difference);
 let relevantBatches = inventoryBatches.filter(b => b.sku === sku && b.qty_remaining> 0).sort((a,b) => new Date(a.inbound_date) - new Date(b.inbound_date));
 
 for(let batch of relevantBatches) {
 if(qtyToDeduct <= 0) break;
 let deductAmount = Math.min(batch.qty_remaining, qtyToDeduct);
 await db.from('inventory_batches').update({ qty_remaining: batch.qty_remaining - deductAmount }).eq('id', batch.id);
 qtyToDeduct -= deductAmount;
 }
 }
 
 await db.from('pending_requests').update({status: 'Approved'}).eq('id', reqId);
 
 await db.from('inventory_transactions').insert([{
 sku: sku,
 transaction_type: 'ADJUSTMENT',
 qty: difference,
 reason: 'Audit Discrepancy Approved',
 staff_name: currentUser ? currentUser.name : 'System',
 created_at: new Date().toISOString()
 }]);
 
 alert(`Discrepancy diluluskan. Baki stok ${sku} telah diselaraskan.`);
 await window.initApp();
 } catch(e) {
 alert("Ralat menyelaraskan stok: " + e.message);
 }
};

window.rejectRequest = async function(reqId) {
 if(!confirm('Tolak permintaan ini secara rasmi?')) return;
 try {
 await db.from('pending_requests').update({status: 'Rejected'}).eq('id', reqId);
 alert('Permintaan ditolak.');
 await window.initApp();
 } catch(e) {
 alert("Ralat menolak permintaan: " + e.message);
 }
};

// ===================================
// PRODUCT DETAILS PAGE (PDP) MODAL
// ===================================

let currentPdpMetafields = {};

window.openPdpModal = function(sku) {
 const prod = masterProducts.find(p => p.sku === sku);
 if(!prod) return alert("Product not found");

 document.getElementById('pdpOriginalSku').value = prod.sku;
 document.getElementById('pdpHeaderTitle').innerText = `${prod.sku} | ${prod.name}`;
 document.getElementById('pdpStatus').value = isPublished(prod) ? "true" : "false";
 document.getElementById('pdpName').value = prod.name || '';
 document.getElementById('pdpCategory').value = prod.category || '';
 document.getElementById('pdpBrand').value = prod.brand || '';
 document.getElementById('pdpPrice').value = prod.price || 0;
 document.getElementById('pdpCost').value = prod.cost_price || 0;

 // Media
 let imgs = prod.images || [];
 document.getElementById('pdpMediaUrls').value = imgs.join(',');
 renderPdpMediaGallery(imgs);

 // Inventory
 const myBatches = inventoryBatches.filter(b => b.sku === sku && b.qty_remaining> 0);
 const totalStock = myBatches.reduce((sum, b) => sum + b.qty_remaining, 0);
 document.getElementById('pdpStockAvailable').innerText = totalStock;

 // Metafields
 currentPdpMetafields = {};
 if(prod.metafields) {
 try {
 currentPdpMetafields = typeof prod.metafields === 'string' ? JSON.parse(prod.metafields) : prod.metafields;
 } catch(e) {}
 }
 renderMetafields();

 document.getElementById('pdpModal').style.display = 'block';
};

window.renderPdpMediaGallery = function(urls) {
 const container = document.getElementById('pdpMediaGallery');
 container.innerHTML = '';
 urls.forEach((url, idx) => {
 container.innerHTML += `
 <div style="position:relative; width:80px; height:80px; border-radius:8px; border:1px solid #e1e3e5; overflow:hidden; flex-shrink:0;">
 <img src="${url}" style="width:100%; height:100%; object-fit:cover;">
 <button onclick="window.removePdpMedia(${idx})" style="position:absolute; top:2px; right:2px; background:rgba(255,255,255,0.8); border:none; border-radius:50%; width:20px; height:20px; font-size:10px; cursor:pointer; color:red;"></button>
 </div>
 `;
 });
};

window.addPdpMedia = function() {
 let url = prompt("Enter Image URL:");
 if(url) {
 let currentStr = document.getElementById('pdpMediaUrls').value;
 let urls = currentStr ? currentStr.split(',') : [];
 urls.push(url.trim());
 document.getElementById('pdpMediaUrls').value = urls.join(',');
 renderPdpMediaGallery(urls);
 }
};

window.removePdpMedia = function(idx) {
 let currentStr = document.getElementById('pdpMediaUrls').value;
 let urls = currentStr ? currentStr.split(',') : [];
 urls.splice(idx, 1);
 document.getElementById('pdpMediaUrls').value = urls.join(',');
 renderPdpMediaGallery(urls);
};

window.renderMetafields = function() {
 const container = document.getElementById('pdpMetafieldsContainer');
 container.innerHTML = '';
 for(let key in currentPdpMetafields) {
 container.innerHTML += `
 <div style="display:flex; gap:10px; align-items:center;">
 <input type="text" class="login-input" value="${key}" disabled style="flex:1; background:#f9fafb; margin:0;">
 <input type="text" class="login-input" value="${currentPdpMetafields[key]}" onchange="window.updateMetafield('${key}', this.value)" style="flex:2; margin:0;">
 <button onclick="window.removeMetafield('${key}')" style="background:none; border:none; color:#d82c0d; cursor:pointer; padding:5px;"></button>
 </div>
 `;
 }
};

window.addMetafieldRow = function() {
 let key = prompt("Enter Field Name (e.g. Color, Hardware material):");
 if(key && !currentPdpMetafields[key]) {
 currentPdpMetafields[key] = "";
 renderMetafields();
 }
};

window.updateMetafield = function(key, val) {
 currentPdpMetafields[key] = val;
};

window.removeMetafield = function(key) {
 delete currentPdpMetafields[key];
 renderMetafields();
};

window.savePdpData = async function() {
 const sku = document.getElementById('pdpOriginalSku').value;
 const updatePayload = {
 name: document.getElementById('pdpName').value.trim(),
 category: document.getElementById('pdpCategory').value.trim(),
 brand: document.getElementById('pdpBrand').value.trim(),
 price: parseFloat(document.getElementById('pdpPrice').value) || 0,
 cost_price: parseFloat(document.getElementById('pdpCost').value) || 0,
 is_published: document.getElementById('pdpStatus').value === "true",
 metafields: JSON.stringify(currentPdpMetafields)
 };

 let imgStr = document.getElementById('pdpMediaUrls').value;
 updatePayload.images = imgStr ? imgStr.split(',').map(s=>s.trim()).filter(Boolean) : [];

 try {
 let { error } = await db.from('products_master').update(updatePayload).eq('sku', sku);
 if(error) throw error;
 
 alert("Product saved successfully.");
 document.getElementById('pdpModal').style.display = 'none';
 await window.initApp(); // reload everything
 } catch(e) {
 alert("Error saving product: " + e.message);
 }
};

window.renderMgmtInventory = function() {
 const tbody = document.getElementById("mgmtInventoryTableBody");
 if(!tbody) return;
 tbody.innerHTML = "";

 let htmlBuf = "";

 masterProducts.forEach(p => {
 const myBatches = inventoryBatches.filter(b => b.sku === p.sku && b.qty_remaining> 0);
 const totalStock = myBatches.reduce((sum, b) => sum + b.qty_remaining, 0);
 
 let thumb = "https://placehold.co/100x100?text=Img";
 let imgs = p.images || []; if(imgs.length> 0) thumb = imgs[0];

 let sBadge = isPublished(p) ? `<span style="color:green;font-size:10px;">Active</span>` : `<span style="color:red;font-size:10px;">Draft</span>`;

 let metaHtml = "";
 try {
 if (p.metafields) {
 let m = typeof p.metafields === 'string' ? JSON.parse(p.metafields) : p.metafields;
 for (let k in m) {
 metaHtml += `<span style="display:inline-block; background:#e5e7eb; color:#374151; padding:2px 6px; border-radius:4px; font-size:10px; margin:2px 2px 0 0;"><b>${k}:</b> ${m[k]}</span>`;
 }
 }
 } catch(e) {}
 if (!metaHtml) metaHtml = `<span style="color:#aaa; font-style:italic; font-size:11px;">Tiada data</span>`;

 htmlBuf += `
 <tr>
 <td>
 <img src="${thumb}" style="width:45px; height:45px; object-fit:cover; border-radius:6px; background:#eee;"><br>
 ${sBadge}
 </td>
 <td>
 <span class="sku-badge">${p.sku}</span> <span class="cat-badge">${p.category||'Uncategorized'}</span> ${p.location_bin ? `<span style="background:#fef08a; color:#854d0e; padding:3px 6px; border-radius:4px; font-size:10px;"> Loc: ${p.location_bin}</span>` : ''}<br>
 <strong>${p.name}</strong><br>
 <small style="color:#888;">Jenama: <strong>${p.brand || 'N/A'}</strong></small>
 </td>
 <td>
 <div style="font-size:12px; color:#555;">
 Model: ${p.model_no || '-'}<br>
 Variant: ${p.variant_size || '-'} / ${p.variant_color || '-'}<br>
 Dimensi: ${p.dimensions || '-'} (${p.weight_kg ? p.weight_kg+'Kg' : '-'})
 </div>
 </td>
 <td>
 ${metaHtml}
 </td>
 <td style="font-weight:bold; color:${totalStock <= 0 ? 'red' : 'green'};">
 ${totalStock} ${p.unit||'Pcs'}<br>
 <small style="font-weight:normal; color:#888;">${myBatches.length} batch(es)</small>
 ${myBatches.length> 0 ? (() => {
 const sources = [...new Set(myBatches.map(b => b.po_number).filter(Boolean))];
 const suppliers = [...new Set(myBatches.map(b => b.supplier_name).filter(Boolean))];
 let trace = '';
 if(sources.length) trace += `<br><span style="font-weight:normal; color:#0EA5E9; font-size:10px;"> ${sources.slice(0,2).join(', ')}${sources.length> 2 ? '+' : ''}</span>`;
 if(suppliers.length) trace += `<br><span style="font-weight:normal; color:#7C3AED; font-size:10px;"> ${suppliers.slice(0,2).join(', ')}${suppliers.length> 2 ? '+' : ''}</span>`;
 return trace;
 })() : ''}
 </td>
 <td>
 <div style="background:#F3F4F6; padding:5px; border-radius:4px; font-family:monospace; font-size:12px; border:1px solid #ddd; display:inline-block;">
 ${p.location_bin || "Tiada Maklumat Rak"}
 </div>
 </td>
 <td>
 <small>Cost: RM${parseFloat(p.cost_price||0).toFixed(2)}</small><br>
 <strong>Sell: RM${parseFloat(p.price).toFixed(2)}</strong>
 </td>
 <td>
 <button class="btn-success" style="padding:4px 8px; font-size:12px; cursor:pointer; width:100%; white-space:nowrap; background:#F59E0B;" onclick="window.openPricingCalc('${p.sku}')"> Harga</button>
 </td>
 <td>
 <button class="btn-primary" style="padding:4px 8px; font-size:12px; cursor:pointer; width:100%; white-space:nowrap;" onclick="window.openPdpModal('${p.sku}')"> Edit Details</button>
 </td>
 </tr>
 `;
 });
 tbody.innerHTML = htmlBuf;
};

// ===================================
// PRICING CALCULATOR LOGIC
// ===================================

window.openPricingCalc = function(sku) {
 const p = masterProducts.find(x => x.sku === sku);
 if(!p) return;

 document.getElementById('calcSku').value = sku;
 document.getElementById('calcSkuTitle').innerText = `SKU: ${sku} | ${p.name}`;
 
 // Parse existing Metafields for calculator memory
 let m = {};
 try {
 if(p.metafields) m = typeof p.metafields === 'string' ? JSON.parse(p.metafields) : p.metafields;
 } catch(e) {}

 document.getElementById('calcBaseCost').value = p.cost_price || 0;
 document.getElementById('calcShipping').value = parseFloat(m['_calc_shipping']) || 0;
 document.getElementById('calcLabor').value = parseFloat(m['_calc_labor']) || 0;
 document.getElementById('calcMarginPct').value = parseFloat(m['_calc_margin_pct']) || 20; // default 20%
 document.getElementById('calcCommPct').value = parseFloat(m['_calc_comm_pct']) || 5; // default 5%

 window.calcPricing();
 document.getElementById('pricingCalcModal').style.display = 'flex';
};

window.calcPricing = function() {
 let base = parseFloat(document.getElementById('calcBaseCost').value) || 0;
 let ship = parseFloat(document.getElementById('calcShipping').value) || 0;
 let labor = parseFloat(document.getElementById('calcLabor').value) || 0;
 let marginPct = parseFloat(document.getElementById('calcMarginPct').value) || 0;
 let commPct = parseFloat(document.getElementById('calcCommPct').value) || 0;

 let totalCost = base + ship + labor;
 document.getElementById('calcTotalCost').value = totalCost.toFixed(2);

 let profit = totalCost * (marginPct / 100);
 let grossPrice = totalCost + profit;
 
 // finalPrice = grossPrice / (1 - commPct)
 let finalPrice = 0;
 if(commPct>= 100) finalPrice = grossPrice; // avoid division by zero/negative
 else finalPrice = grossPrice / (1 - (commPct / 100));

 let commAmount = finalPrice * (commPct / 100);

 document.getElementById('calcProfitAmount').innerText = profit.toFixed(2);
 document.getElementById('calcCommAmount').innerText = commAmount.toFixed(2);
 document.getElementById('calcFinalPrice').innerText = finalPrice.toFixed(2);
};

window.applyCalculatedPrice = async function() {
 const sku = document.getElementById('calcSku').value;
 const p = masterProducts.find(x => x.sku === sku);
 if(!p) return;

 let finalPrice = parseFloat(document.getElementById('calcFinalPrice').innerText);
 let baseCost = parseFloat(document.getElementById('calcBaseCost').value) || 0;
 let ship = parseFloat(document.getElementById('calcShipping').value) || 0;
 let labor = parseFloat(document.getElementById('calcLabor').value) || 0;
 let marginPct = parseFloat(document.getElementById('calcMarginPct').value) || 0;
 let commPct = parseFloat(document.getElementById('calcCommPct').value) || 0;

 let m = {};
 try {
 if(p.metafields) m = typeof p.metafields === 'string' ? JSON.parse(p.metafields) : p.metafields;
 } catch(e) {}

 // Save calculation config to metafields
 m['_calc_shipping'] = ship;
 m['_calc_labor'] = labor;
 m['_calc_margin_pct'] = marginPct;
 m['_calc_comm_pct'] = commPct;

 const payload = {
 cost_price: baseCost,
 price: finalPrice,
 metafields: JSON.stringify(m)
 };

 try {
 const { error } = await db.from('products_master').update(payload).eq('sku', sku);
 if(error) throw error;
 
 alert("Harga Jualan & Data Kalkulator berjaya disimpan!");
 document.getElementById('pricingCalcModal').style.display = 'none';
 await window.initApp(); // reload everything to update UI
 } catch(e) {
 alert("Ralat semasa menyimpan: " + e.message);
 }
};

// Start Ledger UI Logic
window.renderInventoryLedger = function() {
 const tbody = document.getElementById('inventoryLedgerTbody');
 if(!tbody) return;
 
 if(!inventoryTransactions || inventoryTransactions.length === 0) {
 tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Tiada log direkodkan atau sedang dimuatkan...</td></tr>';
 return;
 }
 
 const recentTxns = inventoryTransactions.slice(0, 100);
 
 tbody.innerHTML = recentTxns.map(t => {
 const dateObj = new Date(t.created_at);
 const dateStr = dateObj.toLocaleDateString('ms-MY') + ' ' + dateObj.toLocaleTimeString('ms-MY', {hour: '2-digit', minute:'2-digit'});
 
 let qtyColor = t.transaction_type === 'OUT' || t.qty < 0 ? '#EF4444' : '#10B981';
 let qtyPrefix = (t.transaction_type === 'OUT' || t.qty < 0) && t.qty> 0 ? '-' : (t.qty> 0 ? '+' : '');
 let actionStr = t.transaction_type; 
 
 if(t.transaction_type === 'SALE') { actionStr = '<span style="background:#DBEAFE; color:#1E40AF; padding:2px 6px; border-radius:4px; font-weight:bold;">SALE</span>'; }
 else if(t.transaction_type === 'IN') { actionStr = '<span style="background:#D1FAE5; color:#065F46; padding:2px 6px; border-radius:4px; font-weight:bold;">INBOUND</span>'; }
 else if(t.transaction_type === 'OUT') { actionStr = '<span style="background:#FEE2E2; color:#991B1B; padding:2px 6px; border-radius:4px; font-weight:bold;">OUTBOUND</span>'; }
 else if(t.transaction_type === 'ADJUSTMENT') { actionStr = '<span style="background:#FEF3C7; color:#92400E; padding:2px 6px; border-radius:4px; font-weight:bold;">AUDIT ADJUST</span>'; }

 return `
 <tr>
 <td>${dateStr}</td>
 <td style="font-weight:bold;">${t.staff_name || 'System'}</td>
 <td>${actionStr}</td>
 <td>${t.sku}</td>
 <td style="color:${qtyColor}; font-weight:bold; font-size:14px;">${qtyPrefix}${Math.abs(t.qty)}</td>
 <td>${t.reason || '-'}</td>
 </tr>
 `;
 }).join('');
};

window.downloadLedgerCsv = function() {
 if(!inventoryTransactions || inventoryTransactions.length === 0) return alert("Tiada data untuk dieksport.");
 let csv = "Tarikh,Staf,Jenis,SKU,Kuantiti,Rujukan/Sebab\n";
 inventoryTransactions.forEach(t => {
 csv += `"${t.created_at}","${t.staff_name || 'System'}","${t.transaction_type}","${t.sku}","${t.qty}","${t.reason || ''}"\n`;
 });
 
 const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
 const link = document.createElement("a");
 const url = URL.createObjectURL(blob);
 link.setAttribute("href", url);
 link.setAttribute("download", `Inventory_Ledger_${new Date().toISOString().split('T')[0]}.csv`);
 link.style.visibility = 'hidden';
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
};
// End Ledger UI Logic

// Start Purchase Order (PO) Module Logic
window.addPoItemLine = function() {
 const sku = document.getElementById("poSkuSearch").value.trim();
 const qty = parseInt(document.getElementById("poQtyInput").value);
 const cost = parseFloat(document.getElementById("poCostInput").value);
 
 if(!sku || isNaN(qty) || qty <= 0 || isNaN(cost) || cost < 0) {
 return alert("Sila masukkan SKU, Kuantiti, dan Kos yang sah.");
 }
 
 const prod = masterProducts.find(p => p.sku === sku);
 if(!prod) {
 return alert("SKU tidak wujud di dalam sistem utama.");
 }
 
 poDraftItems.push({ sku, qty, cost, total: qty * cost });
 document.getElementById("poSkuSearch").value = "";
 document.getElementById("poQtyInput").value = "";
 document.getElementById("poCostInput").value = "";
 
 renderPoDraftTable();
};

window.renderPoDraftTable = function() {
 const tbody = document.getElementById("poDraftTbody");
 const totalCostEl = document.getElementById("poTotalCost");
 
 if(poDraftItems.length === 0) {
 tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#999;">Belum ada barang dimasukkan.</td></tr>';
 totalCostEl.textContent = "RM 0.00";
 return;
 }
 
 let html = "";
 let grandTotal = 0;
 
 poDraftItems.forEach((item, index) => {
 grandTotal = round2(grandTotal + item.total);
 html += `
 <tr>
 <td style="font-weight:bold;">${item.sku}</td>
 <td>${item.qty}</td>
 <td>RM ${item.cost.toFixed(2)}</td>
 <td style="font-weight:bold;">RM ${item.total.toFixed(2)}</td>
 <td><button class="btn-danger" style="padding:2px 8px; font-size:10px;" onclick="removePoDraftItem(${index})">X</button></td>
 </tr>
 `;
 });
 
 tbody.innerHTML = html;
 totalCostEl.textContent = `RM ${grandTotal.toFixed(2)}`;
};

window.removePoDraftItem = function(index) {
 poDraftItems.splice(index, 1);
 renderPoDraftTable();
};

window.submitPurchaseOrder = async function() {
 const poNo = document.getElementById("poNumber").value.trim() || `PO-${Date.now()}`;
 const supplier = document.getElementById("poSupplier").value.trim();
 const eta = document.getElementById("poEtaDate").value;
 
 if(!supplier || !eta) return alert("Sila masukkan Nama Pembekal dan Tarikh ETA.");
 if(poDraftItems.length === 0) return alert("Tiada barang dalam draf PO.");
 
 const newPO = {
 po_number: poNo,
 supplier: supplier,
 eta_date: eta,
 status: 'Pending',
 items: JSON.stringify(poDraftItems),
 created_at: new Date().toISOString()
 };
 
 try {
 let { error } = await db.from('purchase_orders').insert([newPO]);
 if(error) throw error;
 } catch(e) {
 console.log("Saving PO locally as fallback.");
 purchaseOrders.push(newPO);
 localStorage.setItem('local_purchase_orders', JSON.stringify(purchaseOrders));
 }
 
 alert(`Purchase Order ${poNo} berjaya dicipta!`);
 
 // Reset Form
 poDraftItems = [];
 document.getElementById("poNumber").value = "";
 document.getElementById("poSupplier").value = "";
 document.getElementById("poEtaDate").value = "";
 renderPoDraftTable();
 
 await window.initApp();
};

window.renderPoSection = function() {
 const tbody = document.getElementById("poListTbody");
 if(!tbody) return;
 
 if(!purchaseOrders || purchaseOrders.length === 0) {
 tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Tiada Purchase Order dijumpai.</td></tr>';
 return;
 }
 
 const html = purchaseOrders.map(po => {
 let items = [];
 try { items = typeof po.items === 'string' ? JSON.parse(po.items) : po.items; } catch(e){}
 
 let skus = items.map(i => `${i.sku} (${i.qty})`).join(', ');
 if(skus.length> 50) skus = skus.substring(0, 50) + '...';
 
 let statusBadge = po.status === 'Completed' 
 ? '<span style="background:#D1FAE5; color:#065F46; padding:2px 6px; border-radius:4px; font-weight:bold;">Completed</span>' 
 : '<span style="background:#FEF3C7; color:#92400E; padding:2px 6px; border-radius:4px; font-weight:bold;">Pending</span>';
 
 let actionBtn = po.status === 'Pending' 
 ? `<button class="btn-success" style="font-size:10px; padding:4px 8px; margin:0;" onclick="receivePO('${po.po_number}')">Terima Stok (Receive)</button>` 
 : '-';
 
 return `
 <tr>
 <td style="font-weight:bold;">${po.po_number}</td>
 <td>${po.supplier}</td>
 <td>${po.eta_date}</td>
 <td>${statusBadge}</td>
 <td style="font-size:11px;">${skus}</td>
 <td>${actionBtn}</td>
 </tr>
 `;
 }).join('');
 
 tbody.innerHTML = html;
};

window.receivePO = async function(poNo) {
 if(!confirm(`Adakah anda pasti stok fizikal untuk ${poNo} telah tiba di gudang dan sedia untuk di-Inbound?`)) return;
 
 const po = purchaseOrders.find(p => p.po_number === poNo);
 if(!po) return;
 
 let items = [];
 try { items = typeof po.items === 'string' ? JSON.parse(po.items) : po.items; } catch(e){}
 
 try {
 for(let item of items) {
 // Add to batches
 await db.from('inventory_batches').insert([{
 sku: item.sku,
 qty_received: item.qty,
 qty_remaining: item.qty,
 inbound_date: new Date().toISOString().split('T')[0]
 }]);
 
 // Add to transactions ledger
 await db.from('inventory_transactions').insert([{
 sku: item.sku,
 transaction_type: 'IN',
 qty: item.qty,
 reason: `PO Received: ${poNo} from ${po.supplier}`,
 staff_name: currentUser ? currentUser.name : 'System',
 created_at: new Date().toISOString()
 }]);
 }
 
 // Update PO Status
 try {
 await db.from('purchase_orders').update({status: 'Completed'}).eq('po_number', poNo);
 } catch(e) {
 po.status = 'Completed';
 localStorage.setItem('local_purchase_orders', JSON.stringify(purchaseOrders));
 }
 
 alert(`Semua item dari ${poNo} berjaya di-Inbound!`);
 await window.initApp();
 } catch(e) {
 alert("Ralat semasa Inbound PO: " + e.message);
 }
};
// End PO Logic

// Start Smart Picking List Module Logic
let pickingListItems = [];

window.addPickingItem = function() {
 const sku = document.getElementById("pickingSkuSearch").value.trim().toUpperCase();
 if(!sku) return;
 
 const p = masterProducts.find(x => x.sku === sku);
 if(!p) return alert("SKU tidak wujud.");
 
 // Check if already in list
 if(pickingListItems.find(x => x.sku === sku)) {
 return alert("SKU ini sudah ada dalam senarai kutipan.");
 }
 
 const loc = p.location_bin || p.loc_level || 'ZZZZZ-NO-LOCATION'; // Items without location go to bottom
 pickingListItems.push({ sku: p.sku, name: p.name, location: loc });
 
 document.getElementById("pickingSkuSearch").value = "";
 renderPickingListUI();
};

window.generatePickingPath = function() {
 if(pickingListItems.length === 0) return alert("Sila tambah barang dahulu.");
 
 // Sort alphanumerically by location string to generate the shortest path
 pickingListItems.sort((a, b) => {
 if(a.location> b.location) return 1;
 if(a.location < b.location) return -1;
 return 0;
 });
 
 renderPickingListUI(true);
};

window.clearPickingList = function() {
 pickingListItems = [];
 renderPickingListUI();
};

window.renderPickingListUI = function(isSorted = false) {
 const container = document.getElementById("pickingListContainer");
 if(!container) return;
 
 if(pickingListItems.length === 0) {
 container.innerHTML = '<p style="color:#999; text-align:center; margin-top:20px;">Senarai item kutipan kosong.</p>';
 return;
 }
 
 let html = isSorted ? `<h3 style="color:#10B981; margin-bottom:15px; font-size:16px;">▶ Laluan Kutipan Dijana</h3>` : `<h3 style="color:#6B7280; margin-bottom:15px; font-size:14px;">Senarai Draf (Belum Disusun)</h3>`;
 
 html += '<div style="display:flex; flex-direction:column; gap:10px;">';
 
 pickingListItems.forEach((item, idx) => {
 let stepNum = isSorted ? `<div style="background:#10B981; color:white; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:12px;">${idx+1}</div>` : '';
 let locBadge = item.location.includes('ZZZZZ') ? `<span style="color:#EF4444; font-weight:bold;">Tiada Lokasi Ditetapkan</span>` : `<span style="background:#E0E7FF; color:#3730A3; padding:4px 8px; border-radius:4px; font-weight:bold; font-family:monospace;">${item.location}</span>`;
 
 html += `
 <div style="background:white; border:1px solid #D1D5DB; border-radius:8px; padding:15px; display:flex; align-items:center; gap:15px; box-shadow:0 2px 4px rgba(0,0,0,0.02);">
 ${stepNum}
 <div style="flex:1;">
 <p style="margin:0; font-weight:bold; font-size:14px;">${item.sku}</p>
 <p style="margin:0; font-size:12px; color:#666;">${item.name}</p>
 </div>
 <div style="text-align:right;">
 <p style="margin:0; font-size:10px; color:#888; margin-bottom:4px;">Lokasi</p>
 ${locBadge}
 </div>
 ${!isSorted ? `<button class="btn-danger" style="padding:4px 8px; font-size:12px; margin:0;" onclick="pickingListItems.splice(${idx}, 1); renderPickingListUI();">X</button>` : ''}
 </div>
 `;
 });
 
 html += '</div>';
};

// Start Barcode Generator Logic
window.generateBarcodes = function() {
 const sku = document.getElementById("barcodeSkuInput").value.trim().toUpperCase();
 const qty = parseInt(document.getElementById("barcodeQtyInput").value) || 1;
 const printArea = document.getElementById("printLabelArea");
 
 if(!sku) return alert("Sila masukkan SKU produk.");
 if(qty < 1) return alert("Kuantiti tidak sah.");
 
 const p = masterProducts.find(x => x.sku === sku);
 const productName = p ? p.name : "Produk Am";
 const price = p && p.price ? `RM ${p.price.toFixed(2)}` : "";
 
 printArea.innerHTML = ""; // Clear area
 
 for(let i=0; i<qty; i++) {
 // Create wrapper for thermal roll standard (1 label per row)
 const wrapper = document.createElement("div");
 wrapper.className = "barcode-label-wrapper";
 wrapper.style.cssText = "padding:10px; border:1px solid #ccc; width:240px; text-align:center; background:#fff; font-family:sans-serif;";
 
 // Header (Store Name)
 const header = document.createElement("div");
 header.style.cssText = "font-weight:900; font-size:14px; margin-bottom:2px;";
 header.innerText = "10CAMP STORE";
 wrapper.appendChild(header);
 
 // Product Name (Truncated if long)
 const title = document.createElement("div");
 title.style.cssText = "font-size:10px; font-weight:bold; margin-bottom:5px; line-height:1.2; height:24px; overflow:hidden;";
 title.innerText = productName.length> 35 ? productName.substring(0, 32) + '...' : productName;
 wrapper.appendChild(title);
 
 // Barcode SVG Element
 const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
 wrapper.appendChild(svg);
 
 // Price Tag
 if(price) {
 const priceTag = document.createElement("div");
 priceTag.style.cssText = "font-weight:bold; font-size:14px; margin-top:3px;";
 priceTag.innerText = price;
 wrapper.appendChild(priceTag);
 }
 
 printArea.appendChild(wrapper);
 
 // Generate Barcode Graphic
 try {
 if(typeof JsBarcode === 'undefined') {
 throw new Error("JsBarcode library belum dimuatkan.");
 }
 JsBarcode(svg, sku, {
 format: "CODE128",
 width: 1.8,
 height: 40,
 displayValue: true,
 fontSize: 12,
 margin: 5
 });
 } catch(e) {
 console.error("Barcode generation failed:", e);
 printArea.innerHTML = `<p style="color:red; text-align:center;">Ralat: Sila pastikan ada capaian internet untuk memuat turun skrip Barcode.</p>`;
 break;
 }
 }
};

window.printBarcodes = function() {
 const printArea = document.getElementById("printLabelArea");
 if(printArea.innerHTML.includes("Prebiu label") || printArea.innerHTML === "") {
 return alert("Sila jana kod bar dahulu sebelum mencetak.");
 }
 window.print();
};
// End Barcode Generator Logic

// Start Stock Valuation Logic
window.renderValuationSection = function() {
 // Sprint 2.3: prefer per-batch cost (weighted-avg) over master fallback
 let totalCostAsset = 0;
 let totalRetailAsset = 0;
 let assetsData = [];

 masterProducts.forEach(p => {
 const stockBatches = inventoryBatches.filter(b => b.sku === p.sku && b.qty_remaining> 0);
 const stockQty = stockBatches.reduce((sum, b) => sum + b.qty_remaining, 0);

 if(stockQty> 0) {
 // Compute weighted-avg cost: sum(qty × batch_cost) / total_qty
 // Fall back to master cost_price for batches without their own cost.
 const masterCost = parseFloat(p.cost_price) || 0;
 let weightedCost = 0;
 stockBatches.forEach(b => {
 const c = (b.cost_price != null) ? parseFloat(b.cost_price) : masterCost;
 weightedCost += b.qty_remaining * c;
 });
 const cost = stockQty> 0 ? weightedCost / stockQty : masterCost;
 const retail = parseFloat(p.price) || 0;

 const totalCost = weightedCost;
 const totalRetail = retail * stockQty;

 totalCostAsset = round2(totalCostAsset + totalCost);
 totalRetailAsset = round2(totalRetailAsset + totalRetail);

 assetsData.push({
 sku: p.sku, name: p.name, stock: stockQty,
 cost: cost, totalCost: totalCost
 });
 }
 });

 const projectedProfit = totalRetailAsset - totalCostAsset;

 document.getElementById("valTotalCost").innerText = `RM ${totalCostAsset.toFixed(2)}`;
 document.getElementById("valTotalRetail").innerText = `RM ${totalRetailAsset.toFixed(2)}`;
 document.getElementById("valTotalProfit").innerText = `RM ${projectedProfit.toFixed(2)}`;

 // Sort descending by totalCost to find Top 10 High Value Assets
 assetsData.sort((a, b) => b.totalCost - a.totalCost);
 const top10 = assetsData.slice(0, 10);

 const tbody = document.getElementById("valuationTableBody");
 if(!tbody) return;

 if(top10.length === 0) {
 tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Tiada aset bernilai ditemui.</td></tr>';
 return;
 }

 let html = '';
 top10.forEach((item, index) => {
 html += `
 <tr>
 <td><b>${index + 1}</b></td>
 <td><span class="sku-badge">${item.sku}</span></td>
 <td>${item.name}</td>
 <td><span style="font-weight:bold; color:var(--primary);">${item.stock}</span></td>
 <td>RM ${item.cost.toFixed(2)}</td>
 <td><b style="color:#991B1B;">RM ${item.totalCost.toFixed(2)}</b></td>
 </tr>
 `;
 });
 tbody.innerHTML = html;
};
// End Stock Valuation Logic

// Danger Zone: Wipe Data
window.wipeAllProductsData = async function() {
 let passcode = prompt("AMARAN Keras: Ini akan memadam KESEMUA data produk dan stok secara kekal dari pangkalan data.\n\nSila taip 'PADAM' (huruf besar) untuk sahkan:");
 if(passcode !== 'PADAM') {
 alert("Operasi dibatalkan.");
 return;
 }
 
 if(!db) return alert("Pangkalan data belum disambungkan.");

 try {
 // Delete inventory batches
 await db.from('inventory_batches').delete().neq('id', 0);
 
 // Delete master products (primary key is sku)
 await db.from('products_master').delete().neq('sku', 'DUMMY_SKU_HANTU');
 
 alert("Bagus! Kesemua data produk telah berjaya dipadam bersih. Sistem akan di muat semula.");
 window.location.reload();
 } catch(e) {
 console.error(e);
 alert("Gagal memadam data. Sila semak console log atau padam secara manual di Supabase.");
 }
};

// ===================================
// BULK OPERATIONS (Sprint 1.2)
// ===================================
let bulkSelected = new Set(); // SKUs currently ticked
let bulkVisibleSkus = []; // SKUs in current filtered render

window.bulkComputeStock = function(sku) {
 if(typeof inventoryBatches === 'undefined') return 0;
 return inventoryBatches.filter(b => b.sku === sku)
.reduce((s, b) => s + (b.qty_remaining || 0), 0);
};

window.bulkPopulateFilters = function() {
 const brandSel = document.getElementById('bulkFilterBrand');
 const catSel = document.getElementById('bulkFilterCategory');
 if(!brandSel || !catSel) return;
 const prevB = brandSel.value, prevC = catSel.value;
 const brands = [...new Set(masterProducts.map(p => p.brand).filter(Boolean))].sort();
 const cats = [...new Set(masterProducts.map(p => p.category).filter(Boolean))].sort();
 brandSel.innerHTML = '<option value="">Semua Brand</option>' +
 brands.map(b => `<option value="${b}"${b === prevB ? ' selected' : ''}>${b}</option>`).join('');
 catSel.innerHTML = '<option value="">Semua Kategori</option>' +
 cats.map(c => `<option value="${c}"${c === prevC ? ' selected' : ''}>${c}</option>`).join('');
};

window.renderBulkOps = function() {
 const tbody = document.getElementById('bulkOpsTbody');
 if(!tbody) return;
 bulkPopulateFilters();

 const q = (document.getElementById('bulkSearchInput').value || '').trim().toLowerCase();
 const filterBrand = document.getElementById('bulkFilterBrand').value;
 const filterCat = document.getElementById('bulkFilterCategory').value;
 const filterStatus = document.getElementById('bulkFilterStatus').value;
 const pageSize = parseInt(document.getElementById('bulkPageSize').value) || 100;

 let filtered = masterProducts.filter(p => {
 if(filterBrand && p.brand !== filterBrand) return false;
 if(filterCat && p.category !== filterCat) return false;
 if(filterStatus === 'draft' && isPublished(p)) return false;
 if(filterStatus === 'published' && !isPublished(p)) return false;
 if(q) {
 const hay = `${p.sku||''} ${p.name||''} ${p.brand||''} ${p.category||''}`.toLowerCase();
 if(!hay.includes(q)) return false;
 }
 return true;
 });

 const total = filtered.length;
 filtered = filtered.slice(0, pageSize);
 bulkVisibleSkus = filtered.map(p => p.sku);

 document.getElementById('bulkSummaryLine').innerHTML =
 `Match: <strong>${total}</strong> produk · Tunjuk: <strong>${filtered.length}</strong>` +
 (total> filtered.length ? ` <span style="color:#DC2626;">(turunkan saiz halaman atau tightenkan filter untuk lihat semua)</span>` : '');

 if(filtered.length === 0) {
 tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:30px; color:#999;">Tiada produk match filter. Cuba tukar Status ke "Semua".</td></tr>';
 bulkUpdateActionBar();
 return;
 }

 const html = filtered.map(p => {
 const stock = bulkComputeStock(p.sku);
 const checked = bulkSelected.has(p.sku) ? 'checked' : '';
 const thumb = (p.images && p.images[0]) ? p.images[0] : 'https://placehold.co/40x40?text=?';
 const pub = isPublished(p);
 const statusBadge = pub
 ? '<span style="background:#D1FAE5; color:#065F46; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:10px;">PUBLISHED</span>'
 : '<span style="background:#FEE2E2; color:#991B1B; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:10px;">DRAFT</span>';
 const stockTakeBadge = (p.description || '').includes('STOK BELUM DISAHKAN')
 ? ' <span title="Stock-take pending" style="background:#FEF3C7; color:#92400E; padding:1px 5px; border-radius:3px; font-weight:bold; font-size:9px;"></span>'
 : '';
 return `
 <tr>
 <td><input type="checkbox" data-sku="${p.sku}" ${checked} onchange="bulkToggleRow('${p.sku.replace(/'/g, "\\'")}', this.checked)"></td>
 <td><img src="${thumb}" style="width:40px; height:40px; object-fit:cover; border-radius:4px; background:#F3F4F6;" loading="lazy" onerror="this.src='https://placehold.co/40x40?text=?'"></td>
 <td style="font-family:monospace; font-size:11px;">${p.sku}</td>
 <td>${(p.name || '').slice(0, 90)}${stockTakeBadge}</td>
 <td>${p.brand || '-'}</td>
 <td>${p.category || '-'}</td>
 <td style="text-align:right; font-weight:bold;">RM ${(p.price || 0).toFixed(2)}</td>
 <td style="text-align:right; color:#666;">${p.cost_price != null ? 'RM ' + Number(p.cost_price).toFixed(2) : '-'}</td>
 <td style="text-align:right; ${stock <= 0 ? 'color:#DC2626;' : ''}">${stock}</td>
 <td style="text-align:center;">${statusBadge}</td>
 </tr>
 `;
 }).join('');
 tbody.innerHTML = html;
 bulkUpdateActionBar();
 if(typeof lucide !== 'undefined') lucide.createIcons();
};

window.bulkToggleRow = function(sku, checked) {
 if(checked) bulkSelected.add(sku); else bulkSelected.delete(sku);
 bulkUpdateActionBar();
};

window.bulkToggleAll = function(checkbox) {
 bulkVisibleSkus.forEach(sku => {
 if(checkbox.checked) bulkSelected.add(sku); else bulkSelected.delete(sku);
 });
 document.querySelectorAll('#bulkOpsTbody input[type="checkbox"][data-sku]').forEach(cb => {
 cb.checked = checkbox.checked;
 });
 bulkUpdateActionBar();
};

window.bulkUpdateActionBar = function() {
 const c = document.getElementById('bulkSelectedCount');
 const v = document.getElementById('bulkVisibleCount');
 if(c) c.textContent = bulkSelected.size;
 if(v) v.textContent = `· ${bulkVisibleSkus.length} terlihat`;
 const all = document.getElementById('bulkSelectAll');
 if(all && bulkVisibleSkus.length) {
 const visTicked = bulkVisibleSkus.filter(s => bulkSelected.has(s)).length;
 all.checked = visTicked === bulkVisibleSkus.length;
 all.indeterminate = visTicked> 0 && visTicked < bulkVisibleSkus.length;
 }
};

window.bulkAction = async function(action) {
 if(bulkSelected.size === 0) return showToast('Pilih sekurang-kurangnya 1 produk dulu', 'warn');
 const skus = [...bulkSelected];
 let confirmMsg, payload, descNote;
 if(action === 'publish') {
 confirmMsg = `Publish ${skus.length} produk? Mereka akan muncul dalam Cashier mode.`;
 payload = { is_published: true };
 } else if(action === 'unpublish') {
 confirmMsg = `Unpublish ${skus.length} produk? Mereka akan disorok dari Cashier mode.`;
 payload = { is_published: false };
 } else if(action === 'strip-stocktake-tag') {
 confirmMsg = `Buang tag "STOK BELUM DISAHKAN" dari ${skus.length} produk? Gunakan ini selepas stock-take fizikal selesai.`;
 descNote = 'strip';
 } else { return; }
 if(!confirm(confirmMsg)) return;

 let ok = 0, fail = 0;
 for(const sku of skus) {
 try {
 if(descNote === 'strip') {
 const p = masterProducts.find(x => x.sku === sku);
 if(!p) { fail++; continue; }
 const cleaned = (p.description || '').replace(/^\[STOK BELUM DISAHKAN[^\]]*\]\s*\n*\n*/, '').trim();
 const { error } = await db.from('products_master').update({ description: cleaned }).eq('sku', sku);
 if(error) { fail++; continue; }
 p.description = cleaned;
 ok++;
 } else {
 const { error } = await db.from('products_master').update(payload).eq('sku', sku);
 if(error) { fail++; continue; }
 const p = masterProducts.find(x => x.sku === sku);
 if(p) p.is_published = payload.is_published;
 ok++;
 }
 } catch(e) { fail++; }
 }

 try {
 await db.from('audit_logs').insert([{
 action_type: 'bulk_' + action,
 actor_name: currentUser ? currentUser.name : 'System',
 details: JSON.stringify({ sku_count: skus.length, succeeded: ok, failed: fail, sample_skus: skus.slice(0, 5) }),
 created_at: new Date().toISOString()
 }]);
 } catch(_){}

 showToast(`Bulk ${action}: ${ok} berjaya, ${fail} gagal`, fail ? 'warn' : 'success');
 bulkSelected.clear();
 renderBulkOps();
};

window.bulkOpenPriceModal = function() {
 if(bulkSelected.size === 0) return showToast('Pilih produk dulu', 'warn');
 const mode = prompt(`Edit harga untuk ${bulkSelected.size} produk.\n\n` +
 `Pilih cara:\n` +
 `1 = Set harga absolute (e.g. 99.00)\n` +
 `2 = Tambah % (e.g. 10 = naik 10%)\n` +
 `3 = Tolak % (e.g. 5 = turun 5%)\n\n` +
 `Taip 1, 2 atau 3:`
);
 if(!['1', '2', '3'].includes(mode)) return;
 const valStr = prompt(mode === '1' ? 'Harga baru (RM):' : 'Peratus (%):');
 const v = parseFloat(valStr);
 if(isNaN(v) || v < 0) return showToast('Nilai tak sah', 'warn');
 bulkApplyPrice(mode, v);
};

window.bulkApplyPrice = async function(mode, val) {
 const skus = [...bulkSelected];
 if(!confirm(`Apply price change ke ${skus.length} produk?`)) return;
 let ok = 0, fail = 0;
 for(const sku of skus) {
 const p = masterProducts.find(x => x.sku === sku);
 if(!p) { fail++; continue; }
 let newPrice = p.price;
 if(mode === '1') newPrice = val;
 else if(mode === '2') newPrice = Number((p.price * (1 + val/100)).toFixed(2));
 else if(mode === '3') newPrice = Number((p.price * (1 - val/100)).toFixed(2));
 try {
 const { error } = await db.from('products_master').update({ price: newPrice }).eq('sku', sku);
 if(error) { fail++; continue; }
 p.price = newPrice;
 ok++;
 } catch(e) { fail++; }
 }
 try {
 await db.from('audit_logs').insert([{
 action_type: 'bulk_price_update',
 actor_name: currentUser ? currentUser.name : 'System',
 details: JSON.stringify({ mode, value: val, sku_count: skus.length, succeeded: ok, failed: fail }),
 created_at: new Date().toISOString()
 }]);
 } catch(_){}
 showToast(`Price update: ${ok} berjaya, ${fail} gagal`, fail ? 'warn' : 'success');
 bulkSelected.clear();
 renderBulkOps();
};

window.bulkOpenCategoryModal = function() {
 if(bulkSelected.size === 0) return showToast('Pilih produk dulu', 'warn');
 const newCat = prompt(`Reassign ${bulkSelected.size} produk ke kategori baru.\n\nKategori baru (kosongkan untuk clear):`);
 if(newCat === null) return;
 bulkApplyCategory(newCat.trim() || null);
};

window.bulkApplyCategory = async function(newCat) {
 const skus = [...bulkSelected];
 if(!confirm(`Set category = "${newCat || '(kosong)'}" untuk ${skus.length} produk?`)) return;
 let ok = 0, fail = 0;
 for(const sku of skus) {
 try {
 const { error } = await db.from('products_master').update({ category: newCat }).eq('sku', sku);
 if(error) { fail++; continue; }
 const p = masterProducts.find(x => x.sku === sku);
 if(p) p.category = newCat;
 ok++;
 } catch(e) { fail++; }
 }
 try {
 await db.from('audit_logs').insert([{
 action_type: 'bulk_category_update',
 actor_name: currentUser ? currentUser.name : 'System',
 details: JSON.stringify({ new_category: newCat, sku_count: skus.length, succeeded: ok, failed: fail }),
 created_at: new Date().toISOString()
 }]);
 } catch(_){}
 showToast(`Category update: ${ok} berjaya, ${fail} gagal`, fail ? 'warn' : 'success');
 bulkSelected.clear();
 renderBulkOps();
};

// ===================================
// MANAGER PIN APPROVAL MODAL (Sprint 1.3 + 1.4)
// ===================================
// Generic reusable modal — opens, returns Promise that resolves with
// { manager, reason, note } on success or null on cancel/wrong-PIN.
let __mgrPinResolver = null;

window.requireManagerPin = function(opts) {
 return new Promise((resolve) => {
 __mgrPinResolver = resolve;
 const overlay = document.getElementById('mgrPinOverlay');
 if(!overlay) { resolve(null); return; }

 document.getElementById('mgrPinTitle').textContent = opts.title || 'Kelulusan Manager Diperlukan';
 document.getElementById('mgrPinSubtitle').textContent = opts.subtitle || '';
 document.getElementById('mgrPinDetails').innerHTML = opts.detailsHtml || '';
 document.getElementById('mgrPinError').textContent = '';
 document.getElementById('mgrPinInput').value = '';
 document.getElementById('mgrPinNote').value = '';

 // Manager dropdown — only mgmt/superior, active only
 const inactive = JSON.parse(localStorage.getItem('staffInactive_v1') || '[]');
 const managers = (typeof authUsers !== 'undefined' ? authUsers : [])
.filter(u => (u.role === 'mgmt' || u.role === 'superior') && !inactive.includes(u.staff_id));
 const sel = document.getElementById('mgrPinStaff');
 sel.innerHTML = managers.map(m =>
 `<option value="${m.staff_id}">${m.name} (${m.role})</option>`
).join('') || '<option value="">Tiada manager aktif</option>';

 // Reason dropdown
 const reasons = opts.reasons || ['Lain-lain'];
 const reasonSel = document.getElementById('mgrPinReason');
 reasonSel.innerHTML = reasons.map(r => `<option value="${r}">${r}</option>`).join('');

 // Wire submit
 const submitBtn = document.getElementById('mgrPinSubmit');
 submitBtn.onclick = window.__mgrPinSubmit;

 // Enter key on PIN
 document.getElementById('mgrPinInput').onkeyup = function(e) {
 if(e.key === 'Enter') window.__mgrPinSubmit();
 };

 overlay.style.display = 'flex';
 setTimeout(() => document.getElementById('mgrPinInput').focus(), 100);
 });
};

window.__mgrPinSubmit = async function() {
 const errEl = document.getElementById('mgrPinError');
 const staffId = document.getElementById('mgrPinStaff').value;
 const pin = (document.getElementById('mgrPinInput').value || '').trim();
 const reason = document.getElementById('mgrPinReason').value;
 const note = document.getElementById('mgrPinNote').value.trim();

 if(!staffId) { errEl.textContent = 'Sila pilih manager.'; return; }
 if(!/^\d{4,8}$/.test(pin)) { errEl.textContent = 'PIN mesti 4-8 digit.'; return; }

 const manager = authUsers.find(u => u.staff_id === staffId);
 if(!manager) { errEl.textContent = 'Manager tak dijumpai.'; return; }

 // Lockout check
 const state = JSON.parse(localStorage.getItem('pinLockout_v1') || '{}');
 const rec = state[staffId] || { attempts: 0, lockedUntil: 0 };
 if(rec.lockedUntil && rec.lockedUntil> Date.now()) {
 const mins = Math.ceil((rec.lockedUntil - Date.now()) / 60000);
 errEl.textContent = `Akaun terkunci. Cuba semula ~${mins} min.`;
 return;
 }

 const computed = await hashPin(staffId, pin);
 if(computed !== manager.pin_hash) {
 rec.attempts = (rec.attempts || 0) + 1;
 if(rec.attempts>= 5) {
 rec.lockedUntil = Date.now() + 5 * 60 * 1000;
 rec.attempts = 0;
 errEl.textContent = `Salah PIN 5 kali. Akaun dikunci 5 minit.`;
 } else {
 errEl.textContent = `PIN salah. Tinggal ${5 - rec.attempts} cubaan.`;
 }
 state[staffId] = rec;
 localStorage.setItem('pinLockout_v1', JSON.stringify(state));
 return;
 }

 // Success
 delete state[staffId];
 localStorage.setItem('pinLockout_v1', JSON.stringify(state));
 document.getElementById('mgrPinOverlay').style.display = 'none';
 if(__mgrPinResolver) {
 __mgrPinResolver({ manager, reason, note });
 __mgrPinResolver = null;
 }
};

window.mgrPinCancel = function() {
 document.getElementById('mgrPinOverlay').style.display = 'none';
 if(__mgrPinResolver) { __mgrPinResolver(null); __mgrPinResolver = null; }
};

// ===================================
// DISCREPANCY APPROVAL — REWIRED (Sprint 1.3)
// Replaces the previous direct-approve flow with PIN gate + audit log + reason capture.
// ===================================
const DISCREPANCY_REASONS = [
 'Hilang (suspect theft)',
 'Rosak / Pecah masa storan',
 'Salah kira sebelumnya',
 'Salah masuk sistem (data entry)',
 'Stok belum direkod (newly arrived)',
 'Sample / Display unit',
 'Lain-lain'
];

// Override the old approveDiscrepancy with PIN-gated version
const __originalApproveDiscrepancy = window.approveDiscrepancy;
window.approveDiscrepancy = async function(reqId, sku, difference) {
 const detailsHtml = `
 <strong>SKU:</strong> ${sku}<br>
 <strong>Variance:</strong> ${difference> 0 ? '+' + difference : difference} unit
 ${difference> 0 ? ' <em>(stok berlebihan)</em>' : ' <em>(stok kurang)</em>'}
 `;
 const result = await requireManagerPin({
 title: 'Lulus Pelarasan Stok',
 subtitle: 'Manager kena sahkan & rekod sebab perbezaan ini.',
 detailsHtml,
 reasons: DISCREPANCY_REASONS
 });
 if(!result) return;

 // Pre-flight: confirm enough stock for shortage
 if(difference < 0) {
 const totalStock = (typeof inventoryBatches !== 'undefined' ? inventoryBatches : [])
.filter(b => b.sku === sku && b.qty_remaining> 0)
.reduce((s, b) => s + b.qty_remaining, 0);
 if(totalStock < Math.abs(difference)) {
 return showToast(`Tak boleh tolak ${Math.abs(difference)} unit — sistem cuma ada ${totalStock}.`, 'warn');
 }
 }

 try {
 if(difference> 0) {
 await db.from('inventory_batches').insert([{
 sku, qty_received: difference, qty_remaining: difference,
 inbound_date: new Date().toISOString().split('T')[0]
 }]);
 } else {
 let qtyToDeduct = Math.abs(difference);
 const batches = (typeof inventoryBatches !== 'undefined' ? inventoryBatches : [])
.filter(b => b.sku === sku && b.qty_remaining> 0)
.sort((a, b) => new Date(a.inbound_date) - new Date(b.inbound_date));
 for(const batch of batches) {
 if(qtyToDeduct <= 0) break;
 const deduct = Math.min(batch.qty_remaining, qtyToDeduct);
 const { error } = await db.from('inventory_batches')
.update({ qty_remaining: batch.qty_remaining - deduct })
.eq('id', batch.id);
 if(error) throw error;
 qtyToDeduct -= deduct;
 }
 }

 await db.from('pending_requests').update({
 status: 'Approved',
 metadata: { approved_by: result.manager.name, reason: result.reason, note: result.note }
 }).eq('id', reqId);

 await db.from('inventory_transactions').insert([{
 sku, transaction_type: 'ADJUSTMENT', qty: difference,
 reason: `Discrepancy: ${result.reason}${result.note ? ' — ' + result.note : ''}`,
 staff_name: currentUser ? currentUser.name : 'System',
 created_at: new Date().toISOString()
 }]);

 await db.from('audit_logs').insert([{
 action_type: 'discrepancy_approved',
 actor_name: result.manager.name,
 target_staff: currentUser ? currentUser.name : null,
 details: JSON.stringify({
 sku, difference, reason: result.reason,
 note: result.note, request_id: reqId
 }),
 created_at: new Date().toISOString()
 }]);

 showToast(`Discrepancy ${sku} diluluskan oleh ${result.manager.name}`, 'success');
 await window.initApp();
 } catch(e) {
 showToast(`Ralat: ${e.message}`, 'error');
 }
};

// ===================================
// SPRINT 2.2 — SUPPLIERS CRUD
// ===================================
let suppliersList = [];
let purchaseOrdersV2 = []; // new DB-backed PO list
let purchaseOrderItemsV2 = [];

window.loadSuppliers = async function() {
 try {
 const { data, error } = await db.from('suppliers').select('*').order('name');
 if(error) throw error;
 suppliersList = data || [];
 } catch(e) {
 console.error('loadSuppliers:', e);
 suppliersList = [];
 }
 renderSupplierList();
 refreshSupplierDropdowns();
};

window.renderSupplierList = function() {
 const tbody = document.getElementById('supplierListTbody');
 if(!tbody) return;
 if(!suppliersList.length) {
 tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#999;">Tiada pembekal lagi. Klik "+ Tambah" untuk daftar.</td></tr>';
 return;
 }
 tbody.innerHTML = suppliersList.map(s => `
 <tr>
 <td><a href="#" onclick="event.preventDefault(); window.openSupplierModal(${s.id})" style="color:var(--primary); font-weight:bold; text-decoration:none;">${s.name}</a><br><span style="color:#888; font-size:10px;">${s.contact_person || ''}</span></td>
 <td>${s.country || '-'}</td>
 <td>${s.lead_time_days ? s.lead_time_days + 'd' : '-'}</td>
 <td>${s.is_active ? '<span style="color:#10B981; font-weight:bold;">Aktif</span>' : '<span style="color:#9CA3AF;">Tak Aktif</span>'}</td>
 <td><button class="btn-danger" style="font-size:10px; padding:2px 6px; margin:0;" onclick="window.toggleSupplierActive(${s.id}, ${!s.is_active})">${s.is_active ? 'Disable' : 'Enable'}</button></td>
 </tr>
 `).join('');
};

window.openSupplierModal = function(id) {
 document.getElementById('supplierEditId').value = id || '';
 const titleEl = document.getElementById('supplierModalTitle');
 if(id) {
 const s = suppliersList.find(x => x.id === id);
 if(!s) return;
 titleEl.textContent = `Edit Pembekal: ${s.name}`;
 document.getElementById('supplierName').value = s.name || '';
 document.getElementById('supplierCountry').value = s.country || '';
 document.getElementById('supplierContact').value = s.contact_person || '';
 document.getElementById('supplierPhone').value = s.phone || '';
 document.getElementById('supplierEmail').value = s.email || '';
 document.getElementById('supplierCurrency').value = s.currency || 'RM';
 document.getElementById('supplierLeadTime').value = s.lead_time_days || '';
 document.getElementById('supplierPayTerms').value = s.payment_terms || '';
 document.getElementById('supplierNotes').value = s.notes || '';
 document.getElementById('supplierActive').checked = s.is_active !== false;
 } else {
 titleEl.textContent = 'Pembekal Baru';
 ['supplierName','supplierCountry','supplierContact','supplierPhone','supplierEmail',
 'supplierLeadTime','supplierPayTerms','supplierNotes'].forEach(i => document.getElementById(i).value = '');
 document.getElementById('supplierCurrency').value = 'RM';
 document.getElementById('supplierActive').checked = true;
 }
 document.getElementById('supplierModal').style.display = 'flex';
};

window.saveSupplier = async function() {
 const id = document.getElementById('supplierEditId').value;
 const name = document.getElementById('supplierName').value.trim();
 if(!name) return showToast('Nama pembekal wajib.', 'warn');

 const payload = {
 name,
 country: document.getElementById('supplierCountry').value.trim() || null,
 contact_person: document.getElementById('supplierContact').value.trim() || null,
 phone: document.getElementById('supplierPhone').value.trim() || null,
 email: document.getElementById('supplierEmail').value.trim() || null,
 currency: document.getElementById('supplierCurrency').value,
 lead_time_days: parseInt(document.getElementById('supplierLeadTime').value) || null,
 payment_terms: document.getElementById('supplierPayTerms').value.trim() || null,
 notes: document.getElementById('supplierNotes').value.trim() || null,
 is_active: document.getElementById('supplierActive').checked
 };

 try {
 if(id) {
 const { error } = await db.from('suppliers').update(payload).eq('id', parseInt(id));
 if(error) throw error;
 } else {
 const { error } = await db.from('suppliers').insert([payload]);
 if(error) throw error;
 }
 showToast(id ? 'Pembekal dikemaskini' : 'Pembekal ditambah', 'success');
 document.getElementById('supplierModal').style.display = 'none';
 await loadSuppliers();
 } catch(e) {
 showToast('Ralat: ' + e.message, 'error');
 }
};

window.toggleSupplierActive = async function(id, newState) {
 try {
 const { error } = await db.from('suppliers').update({ is_active: newState }).eq('id', id);
 if(error) throw error;
 await loadSuppliers();
 } catch(e) {
 showToast('Ralat: ' + e.message, 'error');
 }
};

window.refreshSupplierDropdowns = function() {
 // PO supplier dropdown — replace input with list-backed select if exists
 const datalist = document.getElementById('supplierDatalist') || (() => {
 const dl = document.createElement('datalist');
 dl.id = 'supplierDatalist';
 document.body.appendChild(dl);
 return dl;
 })();
 datalist.innerHTML = suppliersList.filter(s => s.is_active)
.map(s => `<option value="${s.name}" data-id="${s.id}">${s.country || ''}</option>`).join('');
 const poSupplierInput = document.getElementById('poSupplier');
 if(poSupplierInput && !poSupplierInput.getAttribute('list')) {
 poSupplierInput.setAttribute('list', 'supplierDatalist');
 }
};

// ===================================
// SPRINT 2.1 — PO V2 (DB-BACKED)
// ===================================
window.loadPosV2 = async function() {
 try {
 const [poRes, itemRes] = await Promise.all([
 db.from('purchase_orders').select('*').order('created_at', { ascending: false }),
 db.from('purchase_order_items').select('*')
]);
 purchaseOrdersV2 = poRes.data || [];
 purchaseOrderItemsV2 = itemRes.data || [];
 } catch(e) {
 console.error('loadPosV2:', e);
 purchaseOrdersV2 = []; purchaseOrderItemsV2 = [];
 }
 if(typeof renderPoSection === 'function') renderPoSection();
};

// Override submitPurchaseOrder to use DB tables
window.submitPurchaseOrder = async function() {
 const poNo = (document.getElementById('poNumber').value || '').trim() || `PO-${Date.now()}`;
 const supplierName = (document.getElementById('poSupplier').value || '').trim();
 const eta = document.getElementById('poEtaDate').value;

 if(!supplierName || !eta) return showToast('Nama Pembekal + ETA wajib.', 'warn');
 if(!poDraftItems || poDraftItems.length === 0) return showToast('Tiada barang dalam draf PO.', 'warn');

 // Resolve supplier_id (create on-fly if not in DB)
 let supplier = suppliersList.find(s => s.name === supplierName);
 if(!supplier) {
 const created = await db.from('suppliers').insert([{ name: supplierName, is_active: true }]).select();
 if(created.data && created.data.length) {
 supplier = created.data[0];
 suppliersList.push(supplier);
 }
 }

 const subtotal = poDraftItems.reduce((s, i) => s + (i.qty * (i.cost || 0)), 0);

 try {
 const { data: poRow, error: poErr } = await db.from('purchase_orders').insert([{
 po_number: poNo,
 supplier_id: supplier ? supplier.id : null,
 supplier_name: supplierName,
 eta_date: eta,
 status: 'Pending',
 currency: supplier ? supplier.currency : 'RM',
 subtotal_rm: subtotal, total_rm: subtotal,
 created_by: currentUser ? currentUser.name : 'System'
 }]).select();
 if(poErr) throw poErr;
 const newPo = poRow[0];

 const itemRows = poDraftItems.map(i => ({
 po_id: newPo.id,
 po_number: poNo,
 sku: i.sku,
 qty_ordered: i.qty,
 qty_received: 0,
 unit_cost_rm: i.cost || 0,
 line_total_rm: i.qty * (i.cost || 0)
 }));
 const { error: itemErr } = await db.from('purchase_order_items').insert(itemRows);
 if(itemErr) throw itemErr;

 showToast(`PO ${poNo} dicipta · RM ${subtotal.toFixed(2)}`, 'success');
 poDraftItems = [];
 ['poNumber','poSupplier','poEtaDate'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
 if(typeof renderPoDraftTable === 'function') renderPoDraftTable();
 await loadPosV2();
 } catch(e) {
 showToast('Ralat cipta PO: ' + e.message, 'error');
 }
};

// Override renderPoSection to read from V2 tables
window.renderPoSection = function() {
 const tbody = document.getElementById('poListTbody');
 if(!tbody) return;
 if(!purchaseOrdersV2 || !purchaseOrdersV2.length) {
 tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#999;">Tiada Purchase Order. Cipta PO baru di atas.</td></tr>';
 return;
 }
 tbody.innerHTML = purchaseOrdersV2.map(po => {
 const items = purchaseOrderItemsV2.filter(i => i.po_id === po.id);
 const skus = items.map(i => `${i.sku} (${i.qty_received}/${i.qty_ordered})`).join(', ').slice(0, 60);
 const statusColor = {
 'Draft': { bg:'#F3F4F6', fg:'#374151' },
 'Pending': { bg:'#FEF3C7', fg:'#92400E' },
 'Partial': { bg:'#DBEAFE', fg:'#1E40AF' },
 'Completed': { bg:'#D1FAE5', fg:'#065F46' },
 'Cancelled': { bg:'#FEE2E2', fg:'#991B1B' }
 }[po.status] || { bg:'#F3F4F6', fg:'#374151' };
 const action = (po.status === 'Pending' || po.status === 'Partial')
 ? `<button class="btn-success" style="font-size:10px; padding:4px 8px; margin:0;" onclick="window.openReceivePOModal(${po.id})">Terima Stok</button>`
 : '-';
 return `
 <tr>
 <td style="font-weight:bold; font-family:monospace;">${po.po_number}</td>
 <td>${po.supplier_name || '-'}</td>
 <td>${po.eta_date || '-'}</td>
 <td><span style="background:${statusColor.bg}; color:${statusColor.fg}; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:10px;">${po.status}</span></td>
 <td style="font-size:11px;">${skus}${items.length> 3 ? '...' : ''}</td>
 <td>${action}</td>
 </tr>
 `;
 }).join('');
};

window.openReceivePOModal = async function(poId) {
 const po = purchaseOrdersV2.find(p => p.id === poId);
 if(!po) return;
 const items = purchaseOrderItemsV2.filter(i => i.po_id === poId);

 // Build per-line rows
 const linesHtml = items.map((it, idx) => {
 const remaining = it.qty_ordered - it.qty_received;
 const prod = masterProducts.find(p => p.sku === it.sku);
 const barcode = prod?.erp_barcode || '';
 return `
 <tr id="grnRow_${idx}" data-sku="${it.sku}" data-barcode="${barcode}">
 <td><strong>${it.sku}</strong>${barcode ? '<br><span style="font-size:10px; color:#9CA3AF;"> ' + barcode + '</span>' : ''}<br><span style="font-size:10px; color:#666;">${(prod?.name || '').slice(0,40)}</span></td>
 <td style="text-align:center;">${it.qty_ordered}</td>
 <td style="text-align:center;">${it.qty_received}</td>
 <td><input type="number" id="grnQty_${idx}" data-itemid="${it.id}" data-sku="${it.sku}" min="0" max="${remaining}" value="${remaining}" class="login-input" style="margin:0; padding:4px; width:70px; text-align:center;"></td>
 <td><input type="number" id="grnCost_${idx}" min="0" step="0.01" value="${it.unit_cost_rm}" class="login-input" style="margin:0; padding:4px; width:80px;"></td>
 </tr>
 `;
 }).join('');

 const modalHtml = `
 <div id="grnOverlay" class="login-overlay" style="display:flex; z-index:3700; align-items:center; justify-content:center;">
 <div class="login-box" style="max-width:820px; width:96%; padding:24px;">
 <button onclick="document.getElementById('grnOverlay').remove()" style="float:right; border:none; background:none; font-size:24px; cursor:pointer; color:var(--text-muted);">×</button>
 <h2 style="font-weight:800; font-size:20px; margin-bottom:6px;"> Goods Received Note (GRN)</h2>
 <p style="font-size:12px; color:#666; margin-bottom:14px;">PO <strong>${po.po_number}</strong> · Pembekal: <strong>${po.supplier_name}</strong> · ETA: ${po.eta_date || '-'}</p>

 <!-- Scanner input -->
 <div style="background:#EFF6FF; border:2px dashed #60A5FA; padding:10px; border-radius:6px; margin-bottom:12px;">
 <label class="small-lbl" style="color:#1E40AF; font-weight:bold;"> Scan Barcode untuk auto-tick qty (atau taip SKU + Enter)</label>
 <input type="text" id="grnScannerInput" class="login-input" placeholder="Beep!" style="text-align:center; font-weight:bold; letter-spacing:1px; margin:6px 0 0;" onkeyup="window.handleGrnScan(event)" autofocus>
 <p id="grnScanFeedback" style="font-size:11px; color:#666; margin-top:4px; min-height:14px;"></p>
 </div>

 <div class="table-responsive" style="max-height:300px; border:1px solid var(--border-color);">
 <table class="data-table" style="font-size:12px;">
 <thead style="position:sticky; top:0; background:#FAFAFA;"><tr><th>SKU / Barcode / Nama</th><th>Ordered</th><th>Sebelum</th><th>Terima Sekarang</th><th>Kos/Unit (RM)</th></tr></thead>
 <tbody>${linesHtml}</tbody>
 </table>
 </div>

 <label class="small-lbl" style="margin-top:12px;">Catatan (kondisi barang, kerosakan, dsb)</label>
 <textarea id="grnNotes" class="login-input" rows="2" placeholder="3 box ada kemek di sudut, foto disertakan via WhatsApp..."></textarea>

 <div style="display:flex; gap:8px; margin-top:14px;">
 <button onclick="document.getElementById('grnOverlay').remove()" class="login-btn" style="background:#6B7280; flex:1;">Tutup</button>
 <button onclick="window.printGrn(${poId})" class="login-btn" style="background:#0EA5E9; flex:1;"> Print GRN Slip</button>
 <button onclick="window.confirmReceivePO(${poId})" class="login-btn" style="flex:2;"> Sahkan Penerimaan</button>
 </div>
 </div>
 </div>
 `;
 document.body.insertAdjacentHTML('beforeend', modalHtml);
 setTimeout(() => document.getElementById('grnScannerInput')?.focus(), 200);
};

// Scanner handler — match by SKU OR barcode, increment that line's "terima" qty
window.handleGrnScan = function(e) {
 if(e.key !== 'Enter') return;
 const input = e.target;
 const code = input.value.trim().toUpperCase();
 const fb = document.getElementById('grnScanFeedback');
 if(!code) return;
 let found = false;
 document.querySelectorAll('#grnOverlay tr[data-sku]').forEach((row, idx) => {
 const sku = (row.dataset.sku || '').toUpperCase();
 const bc = (row.dataset.barcode || '').toUpperCase();
 if(sku === code || (bc && bc === code)) {
 const qtyInput = row.querySelector('input[id^="grnQty_"]');
 if(qtyInput) {
 const cur = parseInt(qtyInput.value) || 0;
 const max = parseInt(qtyInput.max) || 9999;
 qtyInput.value = Math.min(cur + 1, max);
 row.style.background = '#D1FAE5';
 setTimeout(() => row.style.background = '', 600);
 fb.innerHTML = ` <strong style="color:#065F46;">${sku}</strong> +1 → ${qtyInput.value}`;
 found = true;
 }
 }
 });
 if(!found) fb.innerHTML = ` <span style="color:#DC2626;">"${code}" tiada dalam PO ini</span>`;
 input.value = '';
};

// Printable GRN — opens new window with formatted slip
window.printGrn = function(poId) {
 const po = purchaseOrdersV2.find(p => p.id === poId);
 if(!po) return;
 const items = purchaseOrderItemsV2.filter(i => i.po_id === poId);

 // Read current form state for "received now" qty + cost
 const lines = items.map((it, idx) => {
 const qty = parseInt(document.getElementById(`grnQty_${idx}`)?.value) || 0;
 const cost = parseFloat(document.getElementById(`grnCost_${idx}`)?.value) || 0;
 const prod = masterProducts.find(p => p.sku === it.sku);
 return { sku: it.sku, name: prod?.name || '', ordered: it.qty_ordered, prevReceived: it.qty_received, qty, cost };
 });
 const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);
 const notes = (document.getElementById('grnNotes')?.value || '').trim();

 const settings = JSON.parse(localStorage.getItem('complianceSettings_v1') || '{}').shop || {};
 const shopName = settings.name || '10 CAMP STORE';
 const shopAddr = settings.address || '';
 const ssm = settings.ssm || '';
 const today = new Date().toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });

 const win = window.open('', '_blank', 'width=800,height=900');
 win.document.write(`<!DOCTYPE html><html><head><title>GRN ${po.po_number}</title>
 <style>
 body { font-family: 'Helvetica Neue', Arial, sans-serif; max-width:780px; margin:auto; padding:30px; color:#111; }
 h1 { font-size:22px; margin:0 0 4px; }
.header { border-bottom:3px solid #111; padding-bottom:10px; margin-bottom:20px; }
.meta { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:20px; }
.meta div { font-size:13px; }
 table { width:100%; border-collapse:collapse; font-size:12px; margin-bottom:20px; }
 th, td { border:1px solid #999; padding:6px 8px; text-align:left; }
 th { background:#f3f4f6; }
.right { text-align:right; }
.center { text-align:center; }
.total-row { font-weight:bold; background:#fef3c7; }
.signoff { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:50px; }
.signoff div { border-top:1px solid #111; padding-top:6px; font-size:11px; }
.notes { background:#fff7ed; border:1px solid #fed7aa; padding:10px; border-radius:4px; margin-bottom:20px; font-size:12px; }
 @media print { @page { margin:1.5cm; } button { display:none; } }
 </style>
 </head><body>
 <div class="header">
 <h1>${shopName}</h1>
 <p style="margin:0; font-size:11px; color:#666;">${shopAddr}${ssm ? ' · SSM: ' + ssm : ''}</p>
 <h2 style="font-size:18px; margin:12px 0 0; color:#0EA5E9;"> GOODS RECEIVED NOTE (GRN)</h2>
 </div>
 <div class="meta">
 <div><strong>GRN #:</strong> GRN-${po.po_number}-${Date.now().toString(36).slice(-4).toUpperCase()}</div>
 <div><strong>Tarikh:</strong> ${today}</div>
 <div><strong>PO No.:</strong> ${po.po_number}</div>
 <div><strong>Pembekal:</strong> ${po.supplier_name || '-'}</div>
 <div><strong>ETA:</strong> ${po.eta_date || '-'}</div>
 <div><strong>Penerima:</strong> ${currentUser ? currentUser.name : '___________'}</div>
 </div>
 <table>
 <thead><tr><th>#</th><th>SKU</th><th>Nama Produk</th><th class="center">Ordered</th><th class="center">Diterima Kini</th><th class="right">Kos/Unit (RM)</th><th class="right">Total (RM)</th></tr></thead>
 <tbody>
 ${lines.map((l, i) => `
 <tr>
 <td>${i + 1}</td>
 <td><strong>${l.sku}</strong></td>
 <td>${(l.name || '').slice(0, 60)}</td>
 <td class="center">${l.ordered}</td>
 <td class="center"><strong>${l.qty}</strong></td>
 <td class="right">${l.cost.toFixed(2)}</td>
 <td class="right">${(l.qty * l.cost).toFixed(2)}</td>
 </tr>
 `).join('')}
 <tr class="total-row">
 <td colspan="6" class="right">TOTAL DITERIMA (RM):</td>
 <td class="right">${total.toFixed(2)}</td>
 </tr>
 </tbody>
 </table>
 ${notes ? `<div class="notes"><strong>Catatan:</strong> ${notes}</div>` : ''}
 <div class="signoff">
 <div><strong>Penerima (Receiver)</strong><br><br>Nama: ___________________________<br>Tandatangan: ________________________<br>Tarikh: ${today}</div>
 <div><strong>Lulus Manager (Approver)</strong><br><br>Nama: ___________________________<br>Tandatangan: ________________________<br>Tarikh: ___________</div>
 </div>
 <p style="margin-top:30px; font-size:10px; color:#999; text-align:center;">Auto-generated by 10 CAMP POS · GRN-${po.po_number}-${Date.now().toString(36).toUpperCase()}</p>
 <button onclick="window.print()" style="position:fixed; top:20px; right:20px; padding:10px 20px; background:#0EA5E9; color:white; border:none; border-radius:6px; font-weight:bold; cursor:pointer;"> Print</button>
 </body></html>`);
 win.document.close();
};

window.confirmReceivePO = async function(poId) {
 const po = purchaseOrdersV2.find(p => p.id === poId);
 if(!po) return;
 const items = purchaseOrderItemsV2.filter(i => i.po_id === poId);
 const notes = document.getElementById('grnNotes').value.trim();

 // Read each line's qty + cost
 const receipts = [];
 items.forEach((it, idx) => {
 const qtyEl = document.getElementById(`grnQty_${idx}`);
 const costEl = document.getElementById(`grnCost_${idx}`);
 const qty = parseInt(qtyEl.value) || 0;
 const cost = parseFloat(costEl.value) || 0;
 if(qty> 0) receipts.push({ item: it, qty, cost });
 });

 if(receipts.length === 0) return showToast('Tiada qty diterima.', 'warn');

 if(!confirm(`Sahkan penerimaan ${receipts.length} item untuk ${po.po_number}?`)) return;

 try {
 const inboundDate = new Date().toISOString().split('T')[0];
 // Insert one batch per received line — with cost + PO link
 const batchRows = receipts.map(r => ({
 sku: r.item.sku,
 qty_received: r.qty,
 qty_remaining: r.qty,
 inbound_date: inboundDate,
 cost_price: r.cost,
 landed_cost: r.cost, // for now equal; freight/tax can be added later
 po_number: po.po_number,
 supplier_name: po.supplier_name,
 notes: notes || null
 }));
 const { error: bErr } = await db.from('inventory_batches').insert(batchRows);
 if(bErr) throw bErr;

 // Update PO line qty_received
 for(const r of receipts) {
 const newQtyReceived = r.item.qty_received + r.qty;
 await db.from('purchase_order_items').update({ qty_received: newQtyReceived }).eq('id', r.item.id);
 }

 // Update PO status
 const updatedItems = purchaseOrderItemsV2.filter(i => i.po_id === poId).map(it => {
 const r = receipts.find(x => x.item.id === it.id);
 return r ? {...it, qty_received: it.qty_received + r.qty } : it;
 });
 const allComplete = updatedItems.every(i => i.qty_received>= i.qty_ordered);
 const someReceived = updatedItems.some(i => i.qty_received> 0);
 const newStatus = allComplete ? 'Completed' : (someReceived ? 'Partial' : 'Pending');

 await db.from('purchase_orders').update({
 status: newStatus,
 received_date: allComplete ? inboundDate : po.received_date,
 received_by: currentUser ? currentUser.name : 'System'
 }).eq('id', poId);

 // Inventory transactions log
 await db.from('inventory_transactions').insert(receipts.map(r => ({
 sku: r.item.sku,
 transaction_type: 'IN',
 qty: r.qty,
 reason: `PO ${po.po_number} received from ${po.supplier_name}${notes ? ' — ' + notes : ''}`,
 staff_name: currentUser ? currentUser.name : 'System',
 created_at: new Date().toISOString()
 })));

 // Audit log
 await db.from('audit_logs').insert([{
 action_type: 'po_received',
 actor_name: currentUser ? currentUser.name : 'System',
 details: JSON.stringify({
 po_number: po.po_number, supplier: po.supplier_name,
 items_count: receipts.length,
 total_qty: receipts.reduce((s, r) => s + r.qty, 0),
 new_status: newStatus, notes
 }),
 created_at: new Date().toISOString()
 }]);

 document.getElementById('grnOverlay').remove();
 showToast(`PO ${po.po_number} → ${newStatus}`, 'success');
 await loadPosV2();
 await window.initApp();
 } catch(e) {
 showToast('Ralat: ' + e.message, 'error');
 }
};

// ===================================
// SPRINT 2.4 — BIN LOCATION BULK IMPORT
// ===================================
let __binImportRows = []; // parsed + validated rows ready to commit

window.bulkImportBinPreview = function() {
 const txt = ((document.getElementById('binImportTextarea2') || document.getElementById('binImportTextarea')).value || '').trim();
 const preview = (document.getElementById('binImportPreview2') || document.getElementById('binImportPreview'));
 const confirmBtn = (document.getElementById('binImportConfirmBtn2') || document.getElementById('binImportConfirmBtn'));
 if(!txt) { preview.innerHTML = ''; confirmBtn.disabled = true; return; }

 const lines = txt.split('\n').map(l => l.trim()).filter(Boolean);
 const parsed = [];
 const errors = [];
 lines.forEach((line, idx) => {
 const parts = line.split(',').map(s => s.trim());
 if(parts.length < 2) {
 errors.push(`Baris ${idx + 1}: format salah ("${line}")`);
 return;
 }
 const sku = parts[0].toUpperCase();
 const loc = parts.slice(1).join(',').trim();
 const prod = masterProducts.find(p => p.sku === sku);
 if(!prod) {
 errors.push(`Baris ${idx + 1}: SKU "${sku}" tak wujud`);
 return;
 }
 parsed.push({ sku, name: prod.name, oldLoc: prod.location_bin || '-', newLoc: loc });
 });

 __binImportRows = parsed;

 let html = `<div style="background:#EFF6FF; border:1px solid #BFDBFE; padding:10px; border-radius:6px; margin-bottom:8px;">
 <strong>${parsed.length}</strong> baris valid · <strong>${errors.length}</strong> baris error
 </div>`;
 if(parsed.length> 0) {
 html += `<div style="max-height:240px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px;">
 <table class="data-table" style="font-size:11px;">
 <thead style="background:#FAFAFA; position:sticky; top:0;"><tr><th>SKU</th><th>Nama</th><th>Sebelum</th><th>Selepas</th></tr></thead>
 <tbody>${parsed.slice(0, 100).map(r => `
 <tr><td><strong>${r.sku}</strong></td><td>${r.name.slice(0,50)}</td><td style="color:#999;">${r.oldLoc}</td><td style="color:#10B981; font-weight:bold;">${r.newLoc}</td></tr>
 `).join('')}</tbody>
 </table>
 </div>`;
 if(parsed.length> 100) html += `<p style="font-size:11px; color:#666; margin-top:6px;">+ ${parsed.length - 100} baris lagi (akan diimport semua)</p>`;
 }
 if(errors.length> 0) {
 html += `<details style="margin-top:8px;"><summary style="cursor:pointer; color:#DC2626;">Lihat ${errors.length} error</summary>
 <ul style="font-size:11px; color:#991B1B; margin-top:6px;">${errors.slice(0, 50).map(e => `<li>${e}</li>`).join('')}</ul>
 </details>`;
 }
 preview.innerHTML = html;
 confirmBtn.disabled = parsed.length === 0;
};

window.bulkImportBinConfirm = async function() {
 if(__binImportRows.length === 0) return;
 if(!confirm(`Update lokasi bin untuk ${__binImportRows.length} produk?`)) return;

 let ok = 0, fail = 0;
 for(const row of __binImportRows) {
 try {
 const { error } = await db.from('products_master').update({ location_bin: row.newLoc }).eq('sku', row.sku);
 if(error) { fail++; continue; }
 const p = masterProducts.find(x => x.sku === row.sku);
 if(p) p.location_bin = row.newLoc;
 ok++;
 } catch(e) { fail++; }
 }

 try {
 await db.from('audit_logs').insert([{
 action_type: 'bulk_bin_import',
 actor_name: currentUser ? currentUser.name : 'System',
 details: JSON.stringify({ count: __binImportRows.length, succeeded: ok, failed: fail }),
 created_at: new Date().toISOString()
 }]);
 } catch(_){}

 showToast(`Bin import: ${ok} berjaya, ${fail} gagal`, fail ? 'warn' : 'success');
 __binImportRows = [];
 (document.getElementById('binImportTextarea2') || document.getElementById('binImportTextarea')).value = '';
 (document.getElementById('binImportPreview2') || document.getElementById('binImportPreview')).innerHTML = '';
 (document.getElementById('binImportConfirmBtn2') || document.getElementById('binImportConfirmBtn')).disabled = true;
};

// ===================================
// SPRINT 3.4 — STOCK RESERVATION
// ===================================
let stockReservations = [];

window.loadReservations = async function() {
 try {
 const { data } = await db.from('stock_reservations').select('*').is('released_at', null);
 stockReservations = data || [];
 } catch(e) { stockReservations = []; }
};

window.getAvailableQty = function(sku) {
 // Total physical stock minus active reservations
 const stock = (inventoryBatches || [])
.filter(b => b.sku === sku && b.qty_remaining> 0)
.reduce((s, b) => s + b.qty_remaining, 0);
 const reserved = stockReservations
.filter(r => r.sku === sku && !r.released_at)
.reduce((s, r) => s + (r.qty || 0), 0);
 return Math.max(0, stock - reserved);
};

window.reserveStock = async function(sku, qty, sourceType, sourceRef, notes) {
 const avail = getAvailableQty(sku);
 if(avail < qty) return { ok: false, error: `Hanya ${avail} unit available untuk reserve.` };
 try {
 const { data, error } = await db.from('stock_reservations').insert([{
 sku, qty, source_type: sourceType || 'manual',
 source_ref: sourceRef || null,
 reserved_by: currentUser ? currentUser.name : 'System',
 expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days default
 notes: notes || null
 }]).select();
 if(error) throw error;
 if(data?.length) stockReservations.push(data[0]);
 return { ok: true, reservation: data[0] };
 } catch(e) {
 return { ok: false, error: e.message };
 }
};

window.releaseReservation = async function(reservationId) {
 try {
 const { error } = await db.from('stock_reservations')
.update({ released_at: new Date().toISOString() })
.eq('id', reservationId);
 if(error) throw error;
 stockReservations = stockReservations.filter(r => r.id !== reservationId);
 return { ok: true };
 } catch(e) {
 return { ok: false, error: e.message };
 }
};

// ----- p4_12 (wired): reservations bound to quote/invoice flow -----
window.reserveItemsForQuote = async function(quoteRef, items) {
 if(!quoteRef || !Array.isArray(items)) return { ok:false, error:'no quote ref / items' };
 const results = [];
 for(const it of items) {
 const sku = (it.sku || '').toUpperCase();
 const qty = parseInt(it.qty) || 0;
 if(!sku || sku === 'CUST-ITEM' || qty < 1) continue;
 // Only reserve if SKU exists in master_products (else skip — custom line)
 const exists = (masterProducts || []).find(p => p.sku === sku);
 if(!exists) continue;
 const r = await window.reserveStock(sku, qty, 'quote', quoteRef, `Auto-reserved for ${quoteRef}`);
 results.push({ sku, qty,...r });
 }
 return { ok:true, results };
};

window.releaseReservationsForQuote = async function(quoteRef) {
 if(!quoteRef) return { ok:false };
 try {
 const { error } = await db.from('stock_reservations')
.update({ released_at: new Date().toISOString() })
.eq('source_ref', quoteRef)
.is('released_at', null);
 if(error) throw error;
 stockReservations = stockReservations.filter(r => r.source_ref !== quoteRef);
 return { ok:true };
 } catch(e) {
 return { ok:false, error:e.message };
 }
};

window.getReservedQty = function(sku) {
 if(!sku) return 0;
 return (stockReservations || [])
.filter(r => r.sku === sku && !r.released_at)
.reduce((s, r) => s + (parseInt(r.qty)||0), 0);
};

// ----- Stock Reservations panel (Inventory Dept) -----
window.renderStockReservations = function() {
 const tbody = document.getElementById('reservationsTbody');
 const summaryEl = document.getElementById('reservationsSummary');
 if(!tbody) return;

 const active = (stockReservations || []).filter(r => !r.released_at);
 const now = Date.now();

 if(summaryEl) {
 const totalQty = active.reduce((s, r) => s + (parseInt(r.qty)||0), 0);
 const distinctSkus = new Set(active.map(r => r.sku)).size;
 const expiringSoon = active.filter(r => r.expires_at && new Date(r.expires_at).getTime() - now < 24*3600*1000).length;
 summaryEl.innerHTML = `
 <div style="background:#FEF3C7; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#92400E;">Active Reservations</div><div style="font-size:18px; font-weight:bold;">${active.length}</div></div>
 <div style="background:#EFF6FF; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#1E40AF;">Locked Qty</div><div style="font-size:18px; font-weight:bold;">${totalQty}</div></div>
 <div style="background:#F0FDF4; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#166534;">Distinct SKUs</div><div style="font-size:18px; font-weight:bold;">${distinctSkus}</div></div>
 <div style="background:#FEE2E2; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#991B1B;">Expiring &lt; 24h</div><div style="font-size:18px; font-weight:bold;">${expiringSoon}</div></div>
 `;
 }

 if(!active.length) {
 tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#999; padding:20px;">Tiada reservation aktif. Setiap kali create quotation, stock akan auto-lock di sini.</td></tr>';
 return;
 }

 active.sort((a, b) => (b.created_at||'').localeCompare(a.created_at||''));
 tbody.innerHTML = active.map(r => {
 const prod = (masterProducts || []).find(p => p.sku === r.sku);
 const name = prod ? prod.name.slice(0, 50) : r.sku;
 const expires = r.expires_at ? new Date(r.expires_at) : null;
 const expSoon = expires && (expires.getTime() - now < 24*3600*1000);
 const expStr = expires ? expires.toLocaleString('en-MY', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '-';
 return `
 <tr>
 <td style="font-family:monospace; font-size:11px;">${r.sku}</td>
 <td>${name}</td>
 <td style="text-align:right; font-weight:bold;">${r.qty}</td>
 <td><span class="badge ${r.source_type==='quote'?'badge--info':'badge--neutral'}">${r.source_type||'-'}</span></td>
 <td style="font-family:monospace; font-size:11px;">${r.source_ref || '-'}</td>
 <td style="color:${expSoon?'#DC2626':'#6B7280'}; ${expSoon?'font-weight:bold;':''}">${expStr}${expSoon?' ':''}</td>
 <td>
 <button class="btn btn--secondary btn--sm" onclick="window.__manualReleaseReservation('${r.id}')">Release</button>
 </td>
 </tr>
 `;
 }).join('');
};

window.__manualReleaseReservation = async function(rid) {
 if(!confirm('Release reservation ni? Stock akan jadi available semula.')) return;
 const r = await window.releaseReservation(rid);
 if(r.ok) {
 if(typeof showToast==='function') showToast('Reservation released ', 'success');
 window.renderStockReservations();
 } else {
 if(typeof showToast==='function') showToast('Release failed: ' + (r.error||''), 'error');
 }
};

// ===================================
// SPRINT 3.5 + 3.6 — AGING REPORT + MONTHLY SNAPSHOT
// ===================================
window.renderInventoryAging = function() {
 const tbody = document.getElementById('agingTbody');
 const summaryEl = document.getElementById('agingSummary');
 if(!tbody) return;

 const now = Date.now();
 const buckets = {
 '0-30': { label: '0–30 hari (fresh)', min: 0, max: 30, qty: 0, cost: 0, retail: 0, items: [] },
 '31-90': { label: '31–90 hari', min: 31, max: 90, qty: 0, cost: 0, retail: 0, items: [] },
 '91-180': { label: '91–180 hari', min: 91, max: 180, qty: 0, cost: 0, retail: 0, items: [] },
 '181-365':{ label: '181–365 hari', min: 181, max: 365, qty: 0, cost: 0, retail: 0, items: [] },
 '>365': { label: '> 365 hari (dead?)', min: 366, max: 99999, qty: 0, cost: 0, retail: 0, items: [] }
 };

 inventoryBatches.filter(b => b.qty_remaining> 0).forEach(b => {
 const ageDays = Math.floor((now - new Date(b.inbound_date).getTime()) / (24 * 60 * 60 * 1000));
 const prod = masterProducts.find(p => p.sku === b.sku);
 const cost = b.cost_price != null ? parseFloat(b.cost_price) : (prod?.cost_price || 0);
 const retail = prod?.price || 0;
 const lineCost = b.qty_remaining * cost;
 const lineRetail = b.qty_remaining * retail;

 for(const k in buckets) {
 const bk = buckets[k];
 if(ageDays>= bk.min && ageDays <= bk.max) {
 bk.qty += b.qty_remaining;
 bk.cost += lineCost;
 bk.retail += lineRetail;
 bk.items.push({ sku: b.sku, name: prod?.name || '?', age: ageDays, qty: b.qty_remaining, cost: lineCost, batch: b });
 break;
 }
 }
 });

 const totalQty = Object.values(buckets).reduce((s, b) => s + b.qty, 0);
 const totalCost = Object.values(buckets).reduce((s, b) => s + b.cost, 0);
 const totalRetail = Object.values(buckets).reduce((s, b) => s + b.retail, 0);

 if(summaryEl) {
 const deadPct = totalCost> 0 ? (buckets['>365'].cost / totalCost * 100).toFixed(1) : '0';
 summaryEl.innerHTML = `
 <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px;">
 <div style="background:#F0FDF4; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#166534;">Total Stock</div><div style="font-size:18px; font-weight:bold;">${totalQty} unit</div></div>
 <div style="background:#EFF6FF; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#1E40AF;">Modal Diikat</div><div style="font-size:18px; font-weight:bold;">RM ${totalCost.toFixed(2)}</div></div>
 <div style="background:#FEF3C7; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#92400E;">Potensi Jualan</div><div style="font-size:18px; font-weight:bold;">RM ${totalRetail.toFixed(2)}</div></div>
 <div style="background:#FEE2E2; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#991B1B;">Dead Stock %</div><div style="font-size:18px; font-weight:bold;">${deadPct}%</div></div>
 </div>
 `;
 }

 let html = '';
 Object.values(buckets).forEach(bk => {
 const pct = totalCost> 0 ? (bk.cost / totalCost * 100) : 0;
 const color = bk.min>= 366 ? '#DC2626' : bk.min>= 181 ? '#D97706' : bk.min>= 91 ? '#CA8A04' : '#10B981';
 html += `
 <tr style="background:${bk.qty> 0 ? '#FFF' : '#FAFAFA'};">
 <td><strong style="color:${color};">${bk.label}</strong></td>
 <td style="text-align:right;">${bk.qty}</td>
 <td style="text-align:right;">RM ${bk.cost.toFixed(2)}</td>
 <td style="text-align:right;">RM ${bk.retail.toFixed(2)}</td>
 <td style="text-align:right;">
 <div style="background:#E5E7EB; border-radius:4px; height:8px; position:relative; width:80px; display:inline-block;">
 <div style="background:${color}; height:8px; border-radius:4px; width:${pct}%;"></div>
 </div>
 <span style="margin-left:6px;">${pct.toFixed(0)}%</span>
 </td>
 <td>
 ${bk.items.length> 0 ? `<button class="btn-primary" style="font-size:10px; padding:2px 8px; margin:0;" onclick="window.showAgingDrilldown('${bk.label.replace(/'/g, '\\\'')}')">${bk.items.length} item</button>` : '-'}
 </td>
 </tr>
 `;
 });
 tbody.innerHTML = html;

 // Stash for drilldown
 window.__agingBuckets = buckets;
};

window.showAgingDrilldown = function(bucketLabel) {
 const bucket = Object.values(window.__agingBuckets || {}).find(b => b.label === bucketLabel);
 if(!bucket) return;
 bucket.items.sort((a, b) => b.cost - a.cost);
 const top20 = bucket.items.slice(0, 50);
 const html = `
 <div id="agingDrillOverlay" class="login-overlay" style="display:flex; z-index:3700;">
 <div class="login-box" style="max-width:760px; width:96%; padding:24px;">
 <button onclick="document.getElementById('agingDrillOverlay').remove()" style="float:right; border:none; background:none; font-size:24px; cursor:pointer;">×</button>
 <h2 style="margin-bottom:14px;">Drilldown: ${bucket.label}</h2>
 <p style="font-size:12px; color:#666; margin-bottom:10px;">${bucket.items.length} item · ${bucket.qty} unit · modal RM ${bucket.cost.toFixed(2)}</p>
 <div class="table-responsive" style="max-height:400px;">
 <table class="data-table" style="font-size:12px;">
 <thead><tr><th>SKU</th><th>Nama</th><th style="text-align:right;">Age (hari)</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Total Modal</th></tr></thead>
 <tbody>
 ${top20.map(it => `
 <tr>
 <td><strong>${it.sku}</strong></td>
 <td>${(it.name || '').slice(0, 60)}</td>
 <td style="text-align:right;">${it.age}</td>
 <td style="text-align:right;">${it.qty}</td>
 <td style="text-align:right;">RM ${it.cost.toFixed(2)}</td>
 </tr>
 `).join('')}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 `;
 document.body.insertAdjacentHTML('beforeend', html);
};

window.exportInventorySnapshot = async function() {
 const dateStr = document.getElementById('snapshotDate')?.value;
 if(!dateStr) return showToast('Pilih tarikh dulu.', 'warn');
 const cutoff = new Date(dateStr + 'T23:59:59Z').toISOString();

 try {
 // Approximate snapshot: current batches that were created on or before cutoff
 // Plus replay txns to reconstruct historical qty (safer)
 const [{ data: batches }, { data: txns }] = await Promise.all([
 db.from('inventory_batches').select('*').lte('inbound_date', cutoff),
 db.from('inventory_transactions').select('*').lte('created_at', cutoff)
]);

 // Build per-SKU qty by replaying txns (approximate; current state minus everything after cutoff)
 const allTxns = await db.from('inventory_transactions').select('*');
 const txnsAfter = (allTxns.data || []).filter(t => new Date(t.created_at)> new Date(cutoff));

 const skuQty = {};
 masterProducts.forEach(p => {
 const cur = inventoryBatches.filter(b => b.sku === p.sku).reduce((s, b) => s + b.qty_remaining, 0);
 // Reverse-apply post-cutoff transactions: IN → subtract, OUT → add, ADJUSTMENT → flip sign
 const adj = txnsAfter.filter(t => t.sku === p.sku).reduce((s, t) => {
 if(t.transaction_type === 'IN') return s - t.qty;
 if(t.transaction_type === 'OUT') return s + t.qty;
 return s - t.qty; // ADJUSTMENT (positive added forward, so subtract)
 }, 0);
 skuQty[p.sku] = cur + adj;
 });

 const rows = masterProducts.filter(p => (skuQty[p.sku] || 0)> 0).map(p => {
 const qty = skuQty[p.sku] || 0;
 const cost = parseFloat(p.cost_price) || 0;
 const retail = parseFloat(p.price) || 0;
 return { sku: p.sku, name: p.name, brand: p.brand, category: p.category, qty, cost, retail, total_cost: qty * cost, total_retail: qty * retail };
 });

 // CSV download
 const header = ['SKU', 'Name', 'Brand', 'Category', 'Qty', 'Cost/Unit (RM)', 'Retail/Unit (RM)', 'Total Modal (RM)', 'Total Retail (RM)'];
 const csv = [header.join(',')].concat(rows.map(r => [r.sku, `"${(r.name || '').replace(/"/g, '""')}"`, `"${r.brand || ''}"`, `"${r.category || ''}"`,
 r.qty, r.cost.toFixed(2), r.retail.toFixed(2), r.total_cost.toFixed(2), r.total_retail.toFixed(2)].join(','))
).join('\n');

 const totalCost = rows.reduce((s, r) => s + r.total_cost, 0);
 const totalRetail = rows.reduce((s, r) => s + r.total_retail, 0);
 const summary = `\n,,,,SUMMARY,,,${totalCost.toFixed(2)},${totalRetail.toFixed(2)}\n,,,,Sebagai pada ${dateStr},,,RM ${totalCost.toFixed(2)},RM ${totalRetail.toFixed(2)}`;

 const blob = new Blob([csv + summary], { type: 'text/csv;charset=utf-8;' });
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.href = url;
 link.download = `stock_snapshot_${dateStr}.csv`;
 link.click();

 showToast(`Snapshot ${dateStr}: ${rows.length} SKU, modal RM ${totalCost.toFixed(2)}`, 'success');
 } catch(e) {
 showToast('Ralat: ' + e.message, 'error');
 }
};

// ===================================
// SALES LEDGER + PRODUCT SALES SUMMARY (post-Shopify migration)
// ===================================
let __ledgerPage = 1;
let __prodSalesCache = null; // memoised (sku → stats) — invalidated when sales/products reload

window.renderSalesLedger = function() {
 const tbody = document.getElementById('ledgerTbody');
 if(!tbody) return;
 if(typeof salesHistory === 'undefined' || !Array.isArray(salesHistory)) {
 tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:30px; color:#999;">No sales history loaded yet.</td></tr>';
 return;
 }

 // Populate filter dropdowns lazily
 const channels = [...new Set(salesHistory.map(s => s.channel).filter(Boolean))].sort();
 const staff = [...new Set(salesHistory.map(s => s.staff_name).filter(Boolean))].sort();
 const chSel = document.getElementById('ledgerChannel');
 const stSel = document.getElementById('ledgerStaff');
 if(chSel && chSel.options.length <= 1) {
 chSel.innerHTML = '<option value="">Semua Channel</option>' + channels.map(c => `<option value="${c}">${c}</option>`).join('');
 }
 if(stSel && stSel.options.length <= 1) {
 stSel.innerHTML = '<option value="">Semua</option>' + staff.map(s => `<option value="${s}">${s}</option>`).join('') + '<option value="__null__">(Pending Backfill)</option>';
 }

 // Read filters
 const q = (document.getElementById('ledgerSearch').value || '').trim().toLowerCase();
 const filterCh = document.getElementById('ledgerChannel').value;
 const filterStaff = document.getElementById('ledgerStaff').value;
 const filterStatus = document.getElementById('ledgerStatus').value;
 const dateFrom = document.getElementById('ledgerDateFrom').value;
 const dateTo = document.getElementById('ledgerDateTo').value;
 const pageSize = parseInt(document.getElementById('ledgerPageSize').value) || 50;

 let filtered = salesHistory.filter(s => {
 if(filterCh && s.channel !== filterCh) return false;
 if(filterStaff === '__null__') {
 if(s.staff_name) return false;
 } else if(filterStaff && s.staff_name !== filterStaff) return false;
 if(filterStatus && s.status !== filterStatus) return false;
 if(dateFrom && s.created_at && s.created_at.slice(0, 10) < dateFrom) return false;
 if(dateTo && s.created_at && s.created_at.slice(0, 10)> dateTo) return false;
 if(q) {
 const orderRef = (s.metadata?.shopify_order_name || s.id || '').toString().toLowerCase();
 const cust = (s.customer_name || '').toLowerCase();
 const items = (s.items || []).map(i => `${i.sku||''} ${i.name||''}`).join(' ').toLowerCase();
 if(!orderRef.includes(q) && !cust.includes(q) && !items.includes(q)) return false;
 }
 return true;
 });

 // Sort by date desc
 filtered.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

 // Stats summary
 const totalRev = filtered.filter(s => s.total> 0).reduce((sum, s) => sum + (s.total || 0), 0);
 const refundTotal = filtered.filter(s => s.total < 0).reduce((sum, s) => sum + (s.total || 0), 0);
 const summaryEl = document.getElementById('ledgerSummary');
 if(summaryEl) {
 summaryEl.innerHTML = `
 <div style="background:#EFF6FF; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#1E40AF;">Match</div><div style="font-size:18px; font-weight:bold;">${filtered.length} orders</div></div>
 <div style="background:#F0FDF4; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#166534;">Revenue</div><div style="font-size:18px; font-weight:bold;">RM ${totalRev.toFixed(2)}</div></div>
 <div style="background:#FEF2F2; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#991B1B;">Refunds</div><div style="font-size:18px; font-weight:bold;">RM ${refundTotal.toFixed(2)}</div></div>
 <div style="background:#FAF5FF; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#6B21A8;">Net</div><div style="font-size:18px; font-weight:bold;">RM ${(totalRev + refundTotal).toFixed(2)}</div></div>
 `;
 }

 document.getElementById('ledgerSummaryLine').innerHTML =
 `Match: <strong>${filtered.length}</strong> · sorted by date (newest first) · page ${__ledgerPage} of ${Math.max(1, Math.ceil(filtered.length / pageSize))}`;

 // Pagination
 const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
 if(__ledgerPage> totalPages) __ledgerPage = totalPages;
 const start = (__ledgerPage - 1) * pageSize;
 const slice = filtered.slice(start, start + pageSize);

 const pagEl = document.getElementById('ledgerPagination');
 if(pagEl) {
 pagEl.innerHTML = `
 <div style="font-size:12px; color:#666;">Showing ${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length}</div>
 <div style="display:flex; gap:6px;">
 <button class="btn-primary" style="padding:4px 10px; font-size:12px; margin:0;" onclick="window.ledgerGoPage(1)" ${__ledgerPage <= 1 ? 'disabled' : ''}>« First</button>
 <button class="btn-primary" style="padding:4px 10px; font-size:12px; margin:0;" onclick="window.ledgerGoPage(${__ledgerPage - 1})" ${__ledgerPage <= 1 ? 'disabled' : ''}>‹ Prev</button>
 <span style="padding:4px 10px; font-size:12px;">${__ledgerPage} / ${totalPages}</span>
 <button class="btn-primary" style="padding:4px 10px; font-size:12px; margin:0;" onclick="window.ledgerGoPage(${__ledgerPage + 1})" ${__ledgerPage>= totalPages ? 'disabled' : ''}>Next ›</button>
 <button class="btn-primary" style="padding:4px 10px; font-size:12px; margin:0;" onclick="window.ledgerGoPage(${totalPages})" ${__ledgerPage>= totalPages ? 'disabled' : ''}>Last »</button>
 </div>
 `;
 }

 if(slice.length === 0) {
 tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:30px; color:#999;">Tiada baris match filter.</td></tr>';
 return;
 }

 tbody.innerHTML = slice.map((s, i) => {
 const dateStr = (s.created_at || '').replace('T', ' ').slice(0, 16);
 const orderRef = s.metadata?.shopify_order_name || `#${s.id}`;
 const items = s.items || [];
 const itemCount = items.reduce((n, it) => n + (it.qty || 1), 0);
 const cust = s.customer_name || '<span style="color:#999;">-</span>';
 const total = (s.total || 0);
 const channel = s.channel || '-';
 const staff = s.staff_name || (s.metadata?.pending_staff_backfill ? '<span style="color:#D97706; font-style:italic;">⏳ Pending</span>' : '-');
 const totalColor = total < 0 ? '#DC2626' : '#111';
 const statusColor = {
 'Completed': { bg:'#D1FAE5', fg:'#065F46' },
 'Refunded': { bg:'#FEE2E2', fg:'#991B1B' },
 'Refund': { bg:'#FEE2E2', fg:'#991B1B' },
 'Voided': { bg:'#F3F4F6', fg:'#6B7280' },
 'Pending': { bg:'#FEF3C7', fg:'#92400E' },
 }[s.status] || { bg:'#F3F4F6', fg:'#374151' };
 const rowId = `ledger_row_${start + i}`;
 return `
 <tr style="cursor:pointer;" onclick="window.ledgerToggleExpand('${rowId}', ${start + i})">
 <td>▸</td>
 <td style="white-space:nowrap;">${dateStr}</td>
 <td style="font-family:monospace; font-size:11px;">${orderRef}</td>
 <td>${cust}</td>
 <td style="text-align:center;">${itemCount} <span style="color:#999;">(${items.length} sku)</span></td>
 <td style="text-align:right; font-weight:bold; color:${totalColor};">${total < 0 ? '−' : ''}${Math.abs(total).toFixed(2)}</td>
 <td><span style="background:#E0E7FF; color:#3730A3; padding:2px 6px; border-radius:4px; font-size:10px;">${channel}</span></td>
 <td>${staff}</td>
 <td style="text-align:center;"><span style="background:${statusColor.bg}; color:${statusColor.fg}; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:10px;">${s.status || 'Completed'}</span></td>
 </tr>
 <tr id="${rowId}_detail" style="display:none; background:#F9FAFB;">
 <td colspan="9" style="padding:12px 20px;">
 <strong>Line items:</strong>
 <table style="width:100%; font-size:11px; margin-top:6px;">
 <thead><tr style="border-bottom:1px solid #ddd;"><th style="text-align:left;">SKU</th><th style="text-align:left;">Name</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Subtotal</th></tr></thead>
 <tbody>
 ${items.map(it => `<tr><td style="font-family:monospace;">${it.sku||'-'}</td><td>${(it.name||'').slice(0, 80)}</td><td style="text-align:right;">${it.qty||1}</td><td style="text-align:right;">RM ${(it.price||0).toFixed(2)}</td><td style="text-align:right;">RM ${((it.qty||1) * (it.price||0)).toFixed(2)}</td></tr>`).join('')}
 </tbody>
 </table>
 ${s.payment_method ? `<p style="font-size:11px; color:#666; margin-top:6px;"> Payment: ${s.payment_method}</p>` : ''}
 ${s.metadata?.shopify_order_id ? `<p style="font-size:11px; color:#666;">Shopify ID: ${s.metadata.shopify_order_id}</p>` : ''}
 </td>
 </tr>
 `;
 }).join('');
};

window.ledgerGoPage = function(n) {
 __ledgerPage = Math.max(1, n);
 renderSalesLedger();
};

window.ledgerToggleExpand = function(rowId, idx) {
 const detail = document.getElementById(rowId + '_detail');
 if(!detail) return;
 detail.style.display = detail.style.display === 'none' ? 'table-row' : 'none';
};

window.exportSalesLedgerCsv = function() {
 if(typeof salesHistory === 'undefined') return showToast('No data', 'warn');
 const q = (document.getElementById('ledgerSearch').value || '').trim().toLowerCase();
 const filterCh = document.getElementById('ledgerChannel').value;
 const filterStaff = document.getElementById('ledgerStaff').value;
 const filterStatus = document.getElementById('ledgerStatus').value;
 const dateFrom = document.getElementById('ledgerDateFrom').value;
 const dateTo = document.getElementById('ledgerDateTo').value;

 const filtered = salesHistory.filter(s => {
 if(filterCh && s.channel !== filterCh) return false;
 if(filterStaff === '__null__') { if(s.staff_name) return false; }
 else if(filterStaff && s.staff_name !== filterStaff) return false;
 if(filterStatus && s.status !== filterStatus) return false;
 if(dateFrom && (s.created_at || '').slice(0, 10) < dateFrom) return false;
 if(dateTo && (s.created_at || '').slice(0, 10)> dateTo) return false;
 if(q) {
 const orderRef = (s.metadata?.shopify_order_name || s.id || '').toString().toLowerCase();
 const cust = (s.customer_name || '').toLowerCase();
 if(!orderRef.includes(q) && !cust.includes(q)) return false;
 }
 return true;
 }).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

 const header = ['Date','Order','Customer','Phone','Items_Count','Total_RM','Channel','Staff','Status','Payment','SKUs'];
 const csv = [header.join(',')].concat(filtered.map(s => {
 const items = s.items || [];
 const skus = items.map(i => `${i.sku||'?'} x${i.qty||1}`).join('; ');
 return [
 (s.created_at || '').replace('T', ' ').slice(0, 19),
 s.metadata?.shopify_order_name || s.id || '',
 `"${(s.customer_name || '').replace(/"/g, '""')}"`,
 s.customer_phone || '',
 items.reduce((n, it) => n + (it.qty || 1), 0),
 (s.total || 0).toFixed(2),
 s.channel || '',
 `"${s.staff_name || ''}"`,
 s.status || 'Completed',
 `"${s.payment_method || ''}"`,
 `"${skus.replace(/"/g, '""')}"`
].join(',');
 })).join('\n');

 const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.href = url;
 link.download = `sales_ledger_${new Date().toISOString().slice(0,10)}.csv`;
 link.click();
 showToast(`Exported ${filtered.length} rows`, 'success');
};

// ===================================
// PRODUCT SALES SUMMARY (with negative balance flag)
// ===================================
function __computeProductSales() {
 if(__prodSalesCache) return __prodSalesCache;
 const cutoff6mo = Date.now() - 180 * 24 * 60 * 60 * 1000;
 const stats = new Map();
 masterProducts.forEach(p => {
 stats.set(p.sku, {
 sku: p.sku, name: p.name, brand: p.brand, category: p.category,
 price: parseFloat(p.price) || 0,
 cost: parseFloat(p.cost_price) || 0,
 reorder_point: p.reorder_point,
 stock: 0, totalSold: 0, recentSold: 0, revenue: 0, lastSale: null
 });
 });
 // Compute current stock
 inventoryBatches.forEach(b => {
 const st = stats.get(b.sku);
 if(st) st.stock += (b.qty_remaining || 0);
 });
 // Walk sales_history
 (salesHistory || []).forEach(s => {
 if(s.total <= 0) return; // skip refunds for "sold" tally — they reduce gross but separate count
 const dt = s.created_at ? new Date(s.created_at).getTime() : 0;
 (s.items || []).forEach(it => {
 const sku = (it.sku || '').toUpperCase();
 const qty = parseFloat(it.qty) || 0;
 const price = parseFloat(it.price) || 0;
 const st = stats.get(sku);
 if(!st || qty <= 0) return;
 st.totalSold += qty;
 st.revenue += qty * price;
 if(dt>= cutoff6mo) st.recentSold += qty;
 if(!st.lastSale || dt> new Date(st.lastSale).getTime()) st.lastSale = s.created_at;
 });
 });
 // Subtract refunds from totalSold
 (salesHistory || []).forEach(s => {
 if(s.total>= 0) return;
 (s.items || []).forEach(it => {
 const sku = (it.sku || '').toUpperCase();
 const qty = parseFloat(it.qty) || 0;
 const st = stats.get(sku);
 if(st && qty> 0) {
 st.totalSold = Math.max(0, st.totalSold - qty);
 st.revenue -= qty * (parseFloat(it.price) || 0);
 }
 });
 });
 __prodSalesCache = stats;
 return stats;
}

window.invalidateProductSalesCache = function() { __prodSalesCache = null; };

window.renderProductSales = function() {
 const tbody = document.getElementById('prodSalesTbody');
 if(!tbody) return;

 const stats = __computeProductSales();
 const all = [...stats.values()];

 // Populate brand filter
 const brandSel = document.getElementById('prodSalesBrand');
 if(brandSel && brandSel.options.length <= 1) {
 const brands = [...new Set(all.map(s => s.brand).filter(Boolean))].sort();
 brandSel.innerHTML = '<option value="">Semua</option>' + brands.map(b => `<option value="${b}">${b}</option>`).join('');
 }

 const q = (document.getElementById('prodSalesSearch').value || '').trim().toLowerCase();
 const filterBrand = document.getElementById('prodSalesBrand').value;
 const filterMode = document.getElementById('prodSalesFilter').value;
 const sortMode = document.getElementById('prodSalesSort').value;
 const pageSize = parseInt(document.getElementById('prodSalesPageSize').value) || 100;

 // Compute balance
 all.forEach(r => {
 r.balance = r.stock - r.totalSold;
 });

 let filtered = all.filter(r => {
 if(filterBrand && r.brand !== filterBrand) return false;
 if(filterMode === 'negative' && r.balance>= 0) return false;
 if(filterMode === 'zero_stock' && r.stock !== 0) return false;
 if(filterMode === 'movers' && r.totalSold === 0) return false;
 if(filterMode === 'dead' && r.totalSold> 0) return false;
 if(q) {
 const hay = `${r.sku} ${r.name||''} ${r.brand||''}`.toLowerCase();
 if(!hay.includes(q)) return false;
 }
 return true;
 });

 // Sort
 filtered.sort((a, b) => {
 switch(sortMode) {
 case 'balance_asc': return a.balance - b.balance;
 case 'sold_desc': return b.totalSold - a.totalSold;
 case 'recent_desc': return b.recentSold - a.recentSold;
 case 'stock_asc': return a.stock - b.stock;
 case 'sku': return a.sku.localeCompare(b.sku);
 default: return a.balance - b.balance;
 }
 });

 const total = filtered.length;
 const slice = filtered.slice(0, pageSize);

 // Stats cards
 const totalSold = all.reduce((s, r) => s + r.totalSold, 0);
 const totalRevenue = all.reduce((s, r) => s + r.revenue, 0);
 const negativeBalance = all.filter(r => r.balance < 0).length;
 const zeroStock = all.filter(r => r.stock === 0).length;
 document.getElementById('prodSalesSummaryStats').innerHTML = `
 <div style="background:#EFF6FF; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#1E40AF;">Total Unit Sold</div><div style="font-size:18px; font-weight:bold;">${totalSold.toLocaleString()}</div></div>
 <div style="background:#F0FDF4; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#166534;">Total Revenue</div><div style="font-size:18px; font-weight:bold;">RM ${totalRevenue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
 <div style="background:#FEF2F2; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#991B1B;">Negative Balance</div><div style="font-size:18px; font-weight:bold;">${negativeBalance} SKU</div></div>
 <div style="background:#FEF3C7; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#92400E;">Zero Stock</div><div style="font-size:18px; font-weight:bold;">${zeroStock} SKU</div></div>
 `;

 document.getElementById('prodSalesSummaryLine').innerHTML =
 `Match: <strong>${total}</strong> · Show: <strong>${slice.length}</strong>${total> slice.length ? ` <span style="color:#DC2626;">(turunkan saiz halaman / tightenkan filter untuk lihat semua)</span>` : ''}`;

 if(slice.length === 0) {
 tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:30px; color:#999;">Tiada produk match filter.</td></tr>';
 return;
 }

 tbody.innerHTML = slice.map(r => {
 const balanceColor = r.balance < 0 ? '#DC2626' : (r.balance < 5 ? '#D97706' : '#10B981');
 const balanceText = r.balance < 0 ? `−${Math.abs(r.balance).toFixed(0)}` : r.balance.toFixed(0);
 const lastSaleStr = r.lastSale ? new Date(r.lastSale).toISOString().slice(0,10) : '-';
 const lastSaleColor = r.lastSale && (Date.now() - new Date(r.lastSale).getTime()) < 90*86400000 ? '#10B981' : '#9CA3AF';
 const stockColor = r.stock === 0 ? '#DC2626' : (r.stock < (r.reorder_point || 5) ? '#D97706' : '#111');
 const recentBadge = r.recentSold> 0 ? `<span style="background:#D1FAE5; color:#065F46; padding:1px 5px; border-radius:3px; font-size:10px; margin-left:4px;"></span>` : '';
 return `
 <tr>
 <td style="font-family:monospace; font-size:11px;"><strong>${r.sku}</strong></td>
 <td style="max-width:280px;"><div>${(r.name || '').slice(0, 70)}</div><span style="color:#888; font-size:10px;">${r.brand || '-'} · ${r.category || '-'}</span></td>
 <td style="text-align:right; font-weight:bold;">${r.totalSold.toFixed(0)}</td>
 <td style="text-align:right;">${r.recentSold.toFixed(0)}${recentBadge}</td>
 <td style="text-align:right; color:${stockColor}; font-weight:bold;">${r.stock}</td>
 <td style="text-align:right; color:${balanceColor}; font-weight:bold; font-size:14px;">${balanceText}</td>
 <td style="text-align:right; color:#666;">${r.reorder_point ?? '-'}</td>
 <td style="text-align:right; color:#666;">${r.revenue.toFixed(2)}</td>
 <td style="text-align:center; color:${lastSaleColor}; font-size:11px;">${lastSaleStr}</td>
 </tr>
 `;
 }).join('');
};

window.exportProductSalesCsv = function() {
 const stats = __computeProductSales();
 const all = [...stats.values()];
 all.forEach(r => r.balance = r.stock - r.totalSold);
 all.sort((a, b) => a.balance - b.balance);

 const header = ['SKU','Name','Brand','Category','Total_Sold_Lifetime','Last_6mo_Sold','Stock_Now','Balance','Reorder_Point','Revenue_RM','Last_Sale_Date'];
 const csv = [header.join(',')].concat(all.map(r => [
 r.sku,
 `"${(r.name || '').replace(/"/g, '""')}"`,
 `"${r.brand || ''}"`,
 `"${r.category || ''}"`,
 r.totalSold.toFixed(0),
 r.recentSold.toFixed(0),
 r.stock,
 r.balance.toFixed(0),
 r.reorder_point ?? '',
 r.revenue.toFixed(2),
 r.lastSale ? new Date(r.lastSale).toISOString().slice(0,10) : ''
].join(','))).join('\n');

 const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.href = url;
 link.download = `product_sales_summary_${new Date().toISOString().slice(0,10)}.csv`;
 link.click();
 showToast(`Exported ${all.length} rows`, 'success');
};

// ===================================
// CRM V2 — enriched customers + segments
// ===================================
window.renderCustomersV2 = function() {
 const tbody = document.getElementById('customersTableBody');
 if(!tbody) return;
 if(typeof customersData === 'undefined' || !Array.isArray(customersData)) {
 tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#999;">Loading customer data...</td></tr>';
 return;
 }

 const all = customersData;
 const q = (document.getElementById('crmSearch')?.value || '').trim().toLowerCase();
 const segment = document.getElementById('crmSegment')?.value || '';
 const sortMode = document.getElementById('crmSort')?.value || 'spent_desc';
 const pageSize = parseInt(document.getElementById('crmPageSize')?.value) || 50;

 let filtered = all.filter(c => {
 if(q) {
 const hay = `${c.name||''} ${c.phone||''} ${c.email||''} ${c.tags||''}`.toLowerCase();
 if(!hay.includes(q)) return false;
 }
 switch(segment) {
 case 'vip': if(!c.is_member) return false; break;
 case 'email_consent': if(!c.accepts_email_marketing) return false; break;
 case 'sms_consent': if(!c.accepts_sms_marketing) return false; break;
 case 'tiktok': if(!(c.tags||'').toLowerCase().includes('tiktok')) return false; break;
 case 'shopee': if(!(c.tags||'').toLowerCase().includes('shopee')) return false; break;
 case 'never_bought': if((c.total_orders||0)> 0) return false; break;
 case 'big_spender': if((c.total_spent||0) < 1000) return false; break;
 }
 return true;
 });

 filtered.sort((a, b) => {
 switch(sortMode) {
 case 'spent_desc': return (b.total_spent||0) - (a.total_spent||0);
 case 'orders_desc': return (b.total_orders||0) - (a.total_orders||0);
 case 'recent': return (b.created_at||'').localeCompare(a.created_at||'');
 case 'name': return (a.name||'').localeCompare(b.name||'');
 }
 return 0;
 });

 const totalSpent = filtered.reduce((s, c) => s + (c.total_spent||0), 0);
 const totalOrders = filtered.reduce((s, c) => s + (c.total_orders||0), 0);
 const vipCount = filtered.filter(c => c.is_member).length;
 const emailConsent = filtered.filter(c => c.accepts_email_marketing).length;

 document.getElementById('crmStats').innerHTML = `
 <div style="background:#EFF6FF; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#1E40AF;">Match</div><div style="font-size:18px; font-weight:bold;">${filtered.length}</div></div>
 <div style="background:#F0FDF4; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#166534;">Total Spent</div><div style="font-size:18px; font-weight:bold;">RM ${totalSpent.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
 <div style="background:#FEF3C7; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#92400E;">Total Orders</div><div style="font-size:18px; font-weight:bold;">${totalOrders}</div></div>
 <div style="background:#FAF5FF; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#6B21A8;">VIP Members</div><div style="font-size:18px; font-weight:bold;">${vipCount}</div></div>
 <div style="background:#FEE2E2; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#991B1B;">Email Consent</div><div style="font-size:18px; font-weight:bold;">${emailConsent}</div></div>
 `;

 const slice = filtered.slice(0, pageSize);
 document.getElementById('crmSummaryLine').innerHTML =
 `Match: <strong>${filtered.length}</strong> · Show: <strong>${slice.length}</strong>`;

 if(slice.length === 0) {
 tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#999;">Tiada customer match filter.</td></tr>';
 return;
 }

 tbody.innerHTML = slice.map(c => {
 const consent = [];
 if(c.accepts_email_marketing) consent.push('<span title="Email consent" style="color:#10B981;"></span>');
 if(c.accepts_sms_marketing) consent.push('<span title="SMS consent" style="color:#10B981;"></span>');
 const tags = (c.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 3);
 const tagBadges = tags.map(t => `<span style="background:#E0E7FF; color:#3730A3; padding:1px 6px; border-radius:3px; font-size:9px; margin-right:2px;">${t}</span>`).join('');
 const memberBadge = c.is_member
 ? '<span style="background:#FEF3C7; color:#92400E; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:10px;">⭐ VIP</span>'
 : '<span style="color:#999; font-size:11px;">-</span>';
 return `
 <tr>
 <td><strong>${(c.name||'').slice(0, 50)}</strong></td>
 <td style="font-family:monospace; font-size:11px;">${c.phone || '-'}</td>
 <td style="font-size:11px;">${c.email || '-'}</td>
 <td style="text-align:right; font-weight:bold; color:${(c.total_spent||0)> 1000 ? '#10B981' : '#111'};">${(c.total_spent||0).toFixed(2)}</td>
 <td style="text-align:right;">${c.total_orders || 0}</td>
 <td style="text-align:right; color:#F59E0B; font-weight:bold;">${c.points || 0}</td>
 <td style="text-align:center;">${memberBadge}</td>
 <td style="text-align:center; font-size:14px;">${consent.join(' ') || '<span style="color:#999;">-</span>'}</td>
 <td>${tagBadges || '-'}</td>
 </tr>
 `;
 }).join('');
};

window.exportCustomersCsv = function() {
 if(typeof customersData === 'undefined') return showToast('No data', 'warn');
 const q = (document.getElementById('crmSearch')?.value || '').trim().toLowerCase();
 const segment = document.getElementById('crmSegment')?.value || '';
 const all = customersData.filter(c => {
 if(q) {
 const hay = `${c.name||''} ${c.phone||''} ${c.email||''}`.toLowerCase();
 if(!hay.includes(q)) return false;
 }
 switch(segment) {
 case 'vip': return c.is_member;
 case 'email_consent': return c.accepts_email_marketing;
 case 'sms_consent': return c.accepts_sms_marketing;
 case 'tiktok': return (c.tags||'').toLowerCase().includes('tiktok');
 case 'shopee': return (c.tags||'').toLowerCase().includes('shopee');
 case 'never_bought': return (c.total_orders||0) === 0;
 case 'big_spender': return (c.total_spent||0)>= 1000;
 }
 return true;
 });

 const header = ['Name','Phone','Email','Total_Spent_RM','Total_Orders','Points','Is_Member','Email_Consent','SMS_Consent','Tags','Address_City','Address_State'];
 const csv = [header.join(',')].concat(all.map(c => {
 const addr = c.address || {};
 return [
 `"${(c.name||'').replace(/"/g, '""')}"`,
 c.phone || '',
 c.email || '',
 (c.total_spent||0).toFixed(2),
 c.total_orders || 0,
 c.points || 0,
 c.is_member ? 'yes' : 'no',
 c.accepts_email_marketing ? 'yes' : 'no',
 c.accepts_sms_marketing ? 'yes' : 'no',
 `"${(c.tags||'').replace(/"/g, '""')}"`,
 `"${addr.city || ''}"`,
 `"${addr.state || ''}"`
].join(',');
 })).join('\n');

 const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.href = url;
 link.download = `customers_${new Date().toISOString().slice(0,10)}.csv`;
 link.click();
 showToast(`Exported ${all.length} customers`, 'success');
};

// ===================================
// EMAIL BLAST GENERATOR (mailto fallback)
// ===================================
window.openEmailBlast = function() {
 if(typeof customersData === 'undefined') return showToast('No customer data', 'warn');
 const segment = document.getElementById('crmSegment')?.value || '';
 // Auto-suggest: if user already filtered email_consent, use that. Else default to consent-only.
 const eligible = customersData.filter(c => c.email && c.accepts_email_marketing);
 document.getElementById('emailBlastRecipients').innerHTML =
 `<strong>${eligible.length}</strong> customers dengan email consent · ${customersData.filter(c => c.accepts_sms_marketing).length} dengan SMS consent.<br>` +
 `<span style="color:#666;">Email blast ni ambik HANYA yang ada email + accepts_email_marketing=true (compliance).</span>`;
 document.getElementById('emailBlastOverlay').style.display = 'flex';
};

window.generateEmailBlast = function() {
 const subject = (document.getElementById('emailBlastSubject').value || '').trim();
 const body = (document.getElementById('emailBlastBody').value || '').trim();
 if(!subject || !body) return showToast('Subject + body wajib diisi.', 'warn');

 const eligible = customersData.filter(c => c.email && c.accepts_email_marketing);
 if(eligible.length === 0) return showToast('Tiada customer dengan email consent.', 'warn');

 const bccList = eligible.map(c => c.email).join(', ');
 const fileContent =
 `EMAIL BLAST PACKAGE — Generated ${new Date().toISOString()}\n` +
 `Total recipients: ${eligible.length}\n` +
 `=====================================\n\n` +
 `SUBJECT:\n${subject}\n\n` +
 `BODY:\n${body}\n\n` +
 `=====================================\n` +
 `BCC LIST (${eligible.length} addresses, comma-separated):\n${bccList}\n\n` +
 `=====================================\n` +
 `BCC LIST (one per line):\n${eligible.map(c => c.email).join('\n')}\n`;

 const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8;' });
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.href = url;
 link.download = `email_blast_${new Date().toISOString().slice(0,16).replace(':','')}.txt`;
 link.click();

 // Audit log
 try {
 db.from('audit_logs').insert([{
 action_type: 'email_blast_generated',
 actor_name: currentUser ? currentUser.name : 'System',
 details: JSON.stringify({ subject, recipient_count: eligible.length, segment: 'email_consent' }),
 created_at: new Date().toISOString()
 }]).then(() => {});
 } catch(_){}

 showToast(`Email package generated for ${eligible.length} recipients`, 'success');
 document.getElementById('emailBlastOverlay').style.display = 'none';
};

// ===================================
// VIP AUTO-DISCOUNT
// ===================================
window.__currentCheckoutVip = null;

function getVipDiscountPercent() {
 try {
 const s = JSON.parse(localStorage.getItem('complianceSettings_v1') || '{}');
 return parseFloat(s?.vip?.discountPercent) || 5; // default 5%
 } catch(e) { return 5; }
}

function normalisePhoneForMatch(raw) {
 if(!raw) return null;
 const digits = String(raw).replace(/\D/g, '');
 if(!digits || digits.length < 7) return null;
 if(digits.startsWith('60')) return digits;
 if(digits.startsWith('0')) return '60' + digits.slice(1);
 return digits;
}

window.checkoutVipLookup = function() {
 const nameEl = document.getElementById('customerName');
 const phoneEl = document.getElementById('customerPhone');
 const badge = document.getElementById('checkoutVipBadge');
 const totalDisplay = document.getElementById('paymentTotalDisplay');
 if(!badge) return;

 const name = (nameEl?.value || '').trim().toLowerCase();
 const phoneRaw = (phoneEl?.value || '').trim();
 const phone = normalisePhoneForMatch(phoneRaw);

 let match = null;
 if(typeof customersData !== 'undefined' && Array.isArray(customersData)) {
 if(phone) {
 match = customersData.find(c => c.phone === phone);
 }
 if(!match && name && name.length>= 3) {
 match = customersData.find(c => (c.name || '').toLowerCase() === name);
 }
 }

 window.__currentCheckoutVip = null;
 if(!match) {
 badge.style.display = 'none';
 recomputeCheckoutTotal();
 return;
 }

 if(match.is_member) {
 const pct = getVipDiscountPercent();
 window.__currentCheckoutVip = {
 customer_id: match.id,
 customer_name: match.name,
 customer_phone: match.phone,
 discount_pct: pct,
 total_orders: match.total_orders || 0,
 total_spent: match.total_spent || 0
 };
 badge.style.background = '#FEF3C7';
 badge.style.color = '#92400E';
 badge.style.border = '2px solid #FCD34D';
 badge.style.display = 'block';
 badge.innerHTML = `⭐ <strong>VIP MEMBER</strong> · ${match.name} · ${match.total_orders} orders · RM${(match.total_spent||0).toFixed(0)} spent — auto-discount <strong>${pct}%</strong> applied`;
 } else {
 badge.style.background = '#EFF6FF';
 badge.style.color = '#1E40AF';
 badge.style.border = '1px solid #BFDBFE';
 badge.style.display = 'block';
 badge.innerHTML = ` Customer found · ${match.name} · ${match.total_orders||0} order(s) · RM${(match.total_spent||0).toFixed(0)} spent — needs ${3 - (match.total_orders||0)} more order to unlock VIP`;
 }
 recomputeCheckoutTotal();
};

window.recomputeCheckoutTotal = function() {
 const totalEl = document.getElementById('paymentTotalDisplay');
 if(!totalEl) return;
 // Read raw cart total
 const cart = (typeof window.cart !== 'undefined' && Array.isArray(window.cart)) ? window.cart : (typeof cart !== 'undefined' ? cart : []);
 let raw = 0;
 cart.forEach(it => { raw += (it.qty || 1) * (parseFloat(it.price) || 0); });
 let final = raw;
 let discountAmt = 0;
 if(window.__currentCheckoutVip) {
 discountAmt = round2(raw * window.__currentCheckoutVip.discount_pct / 100);
 final = round2(raw - discountAmt);
 }
 totalEl.textContent = final.toFixed(2);
 // Tag in DOM as data-attrs for downstream
 totalEl.setAttribute('data-raw', raw.toFixed(2));
 totalEl.setAttribute('data-discount', discountAmt.toFixed(2));
 totalEl.setAttribute('data-final', final.toFixed(2));

 // Update line if exists
 let vipLine = document.getElementById('checkoutVipDiscountLine');
 if(window.__currentCheckoutVip && discountAmt> 0) {
 if(!vipLine) {
 const parent = totalEl.closest('p, div');
 if(parent) {
 parent.insertAdjacentHTML('afterend',
 `<p id="checkoutVipDiscountLine" style="font-size:12px; color:#92400E; margin:-12px 0 12px 0;">⭐ VIP discount: −RM <strong>${discountAmt.toFixed(2)}</strong> (${window.__currentCheckoutVip.discount_pct}% off RM ${raw.toFixed(2)})</p>`);
 }
 } else {
 vipLine.innerHTML = `⭐ VIP discount: −RM <strong>${discountAmt.toFixed(2)}</strong> (${window.__currentCheckoutVip.discount_pct}% off RM ${raw.toFixed(2)})`;
 vipLine.style.display = 'block';
 }
 } else if(vipLine) {
 vipLine.style.display = 'none';
 }
};

// =============================================================
// SPRINT A — OPERATIONS POLISH
// =============================================================

// ============= p4_3 MANAGER DASHBOARD =============
let __dashPeriod = '30d';

window.dashSetPeriod = function(p) {
 __dashPeriod = p;
 document.querySelectorAll('.dash-period-btn').forEach(b => b.classList.toggle('active', b.dataset.period === p));
 renderManagerDashboard();
};

function dashGetCutoff() {
 const now = Date.now();
 const day = 24 * 60 * 60 * 1000;
 switch(__dashPeriod) {
 case '7d': return now - 7 * day;
 case '30d': return now - 30 * day;
 case '90d': return now - 90 * day;
 case 'ytd': {
 const yr = new Date(); yr.setMonth(0, 1); yr.setHours(0,0,0,0);
 return yr.getTime();
 }
 case 'all': return 0;
 }
 return now - 30 * day;
}

// ===== Helpers (sparkline, donut, comparison) =====
function fmtCurrency(n) { return Number(n||0).toLocaleString('en-MY', { maximumFractionDigits: 0 }); }
function fmtCompact(n) {
 if(n>= 1e6) return (n/1e6).toFixed(1) + 'M';
 if(n>= 1e3) return (n/1e3).toFixed(1) + 'K';
 return Math.round(n);
}
function dashCompareLabel(curr, prev) {
 if(prev === 0 && curr === 0) return '—';
 if(prev === 0) return `<span class="up">+∞</span> vs prev period`;
 const diff = curr - prev;
 const pct = (diff / prev * 100);
 const sign = pct>= 0 ? 'up' : 'down';
 const arrow = pct>= 0 ? '↑' : '↓';
 return `<span class="${sign}">${arrow} ${Math.abs(pct).toFixed(1)}%</span> vs prev period`;
}
function dashSparkline(svgEl, values, opts) {
 if(!svgEl || values.length === 0) return;
 const o = opts || {};
 const W = svgEl.viewBox.baseVal.width || 240;
 const H = svgEl.viewBox.baseVal.height || 50;
 const max = Math.max(...values, 1);
 const min = Math.min(...values, 0);
 const range = max - min || 1;
 const stepX = values.length> 1 ? W / (values.length - 1) : 0;
 const points = values.map((v, i) => `${(i*stepX).toFixed(2)},${(H - ((v - min)/range)*(H-4) - 2).toFixed(2)}`);
 const path = points.join(' L ');
 const fillPath = `M 0,${H} L ${points.join(' L ')} L ${W},${H} Z`;
 const stroke = o.stroke || '#FFF';
 const fill = o.fill || 'rgba(255,255,255,0.18)';
 const strokeWidth = o.strokeWidth || 2;
 svgEl.innerHTML = `
 <path d="${fillPath}" fill="${fill}" stroke="none"/>
 <path d="M ${path}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>
 `;
}
function dashDonut(slices) {
 if(!slices.length) return '<svg class="dash-donut__svg" viewBox="0 0 130 130"><circle cx="65" cy="65" r="50" fill="none" stroke="#E5E7EB" stroke-width="20"/></svg>';
 const total = slices.reduce((s, x) => s + x.value, 0) || 1;
 const palette = ['#CD7C32', '#3B82F6', '#10B981', '#A855F7', '#F59E0B', '#EF4444', '#6B7280'];
 const C = 2 * Math.PI * 50;
 let offset = 0;
 let segs = '';
 slices.forEach((sl, i) => {
 const frac = sl.value / total;
 const dash = C * frac;
 const color = palette[i % palette.length];
 sl._color = color;
 segs += `<circle cx="65" cy="65" r="50" fill="none" stroke="${color}" stroke-width="20"
 stroke-dasharray="${dash.toFixed(2)} ${(C-dash).toFixed(2)}"
 stroke-dashoffset="${(-offset).toFixed(2)}"
 transform="rotate(-90 65 65)"/>`;
 offset += dash;
 });
 return `
 <svg class="dash-donut__svg" viewBox="0 0 130 130">
 ${segs}
 <text x="65" y="62" text-anchor="middle" font-size="11" fill="#6B7280" font-weight="600">Total</text>
 <text x="65" y="78" text-anchor="middle" font-size="14" fill="#111" font-weight="800">RM ${fmtCompact(total)}</text>
 </svg>
 `;
}
function dashAvatarColor(name) {
 let hash = 0;
 for(let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
 const palette = ['#CD7C32', '#3B82F6', '#10B981', '#A855F7', '#F59E0B', '#EF4444', '#0EA5E9', '#EC4899'];
 return palette[Math.abs(hash) % palette.length];
}
function dashInitials(name) {
 return (name||'?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}

// Target editor modal (p1_31)
window.dashOpenTargetEditor = function() {
    const current = parseFloat(localStorage.getItem('dashMonthlyTarget_v1') || '0');
    const overlay = document.createElement('div');
    overlay.className = 'dash-target-modal';
    overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
        <div class="dash-target-modal__inner">
            <h3>Set Monthly Revenue Target</h3>
            <p>Track progress vs target throughout the month. Used in dashboard hero. Set realistic — based on last 3 months avg + growth ambition.</p>
            <label>Monthly target (RM)</label>
            <input type="number" id="dashTargetInput" min="0" step="100" placeholder="30000" value="${current || ''}">
            <p style="font-size:11px; color:#9CA3AF; margin-top:8px;">Stored locally. Adjust anytime — affects dashboard view only.</p>
            <div class="dash-target-modal__actions">
                <button class="dash-icon-btn" style="padding:8px 14px; font-size:12px; font-weight:700;" onclick="this.closest('.dash-target-modal').remove()">Cancel</button>
                <button style="padding:8px 16px; background:var(--primary-500); color:#FFF; border:none; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer;" onclick="window.dashSaveTarget()">Save Target</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => document.getElementById('dashTargetInput')?.focus(), 100);
};
window.dashSaveTarget = function() {
    const v = parseFloat(document.getElementById('dashTargetInput').value || '0');
    if(v < 0) return;
    if(v === 0) localStorage.removeItem('dashMonthlyTarget_v1');
    else localStorage.setItem('dashMonthlyTarget_v1', String(v));
    document.querySelector('.dash-target-modal')?.remove();
    if(typeof showToast === 'function') showToast(v > 0 ? 'Target saved: RM ' + v.toLocaleString() : 'Target cleared', 'success');
    window.renderManagerDashboard();
};

window.renderManagerDashboard = function() {
 if(typeof salesHistory === 'undefined') return;

 const cutoff = dashGetCutoff();
 const periodMs = (Date.now() - cutoff) || (1000 * 60 * 60 * 24 * 30);
 const prevCutoff = cutoff - periodMs;

 const sales = salesHistory.filter(s => {
 const dt = s.created_at ? new Date(s.created_at).getTime() : 0;
 return dt>= cutoff;
 });
 const prevSales = salesHistory.filter(s => {
 const dt = s.created_at ? new Date(s.created_at).getTime() : 0;
 return dt>= prevCutoff && dt < cutoff;
 });
 const positives = sales.filter(s => (s.total||0)> 0);
 const refunds = sales.filter(s => (s.total||0) < 0);
 const prevPositives = prevSales.filter(s => (s.total||0)> 0);
 const prevRefunds = prevSales.filter(s => (s.total||0) < 0);

 const totalRev = positives.reduce((s, x) => s + (x.total||0), 0);
 const refundTotal = Math.abs(refunds.reduce((s, x) => s + (x.total||0), 0));
 const netRev = totalRev - refundTotal;
 const prevNetRev = prevPositives.reduce((s, x) => s + (x.total||0), 0) - Math.abs(prevRefunds.reduce((s, x) => s + (x.total||0), 0));

 const orderCount = positives.length;
 const prevOrders = prevPositives.length;
 const aov = orderCount> 0 ? totalRev / orderCount : 0;
 const prevAov = prevOrders> 0 ? prevPositives.reduce((s, x) => s + (x.total||0), 0) / prevOrders : 0;

 const periodCustomers = new Set(positives.map(s => s.customer_phone || s.customer_name).filter(Boolean));
 const prevCustomers = new Set(prevPositives.map(s => s.customer_phone || s.customer_name).filter(Boolean));

 // Period label with date range
 const periodNames = { '7d':'last 7 days', '30d':'last 30 days', '90d':'last 90 days', 'ytd':'year-to-date', 'all':'all time' };
 const startD = new Date(cutoff);
 const endD = new Date();
 const dateRange = __dashPeriod === 'all'
 ? `${sales.length} orders ever`
 : `${startD.toLocaleDateString('en-MY',{day:'numeric',month:'short'})} → ${endD.toLocaleDateString('en-MY',{day:'numeric',month:'short'})}`;
 const lbl = document.getElementById('dashPeriodLabel');
 if(lbl) lbl.textContent = `${periodNames[__dashPeriod]} · ${dateRange}`;

 // ---------- HERO ----------
 document.getElementById('heroRevValue').textContent = fmtCurrency(netRev);
 document.getElementById('heroRevCompare').innerHTML = dashCompareLabel(netRev, prevNetRev);

 // Hero sparkline — daily revenue
 const dayMap = {};
 positives.forEach(s => {
 const d = (s.created_at||'').slice(0, 10);
 if(d) dayMap[d] = (dayMap[d] || 0) + (s.total||0);
 });
 const sortedDays = Object.keys(dayMap).sort();
 const sparkVals = sortedDays.map(d => dayMap[d]);
 if(sparkVals.length> 0) dashSparkline(document.getElementById('heroSparkline'), sparkVals, {});

 // ---------- SECONDARY STATS ----------
 document.getElementById('statOrdersValue').textContent = orderCount;
 document.getElementById('statOrdersCompare').innerHTML = dashCompareLabel(orderCount, prevOrders);

 // Orders sparkline (count per day)
 const dayCountMap = {};
 positives.forEach(s => {
 const d = (s.created_at||'').slice(0, 10);
 if(d) dayCountMap[d] = (dayCountMap[d] || 0) + 1;
 });
 const orderSparkVals = sortedDays.map(d => dayCountMap[d] || 0);
 if(orderSparkVals.length> 0) dashSparkline(document.getElementById('statOrdersSpark'), orderSparkVals, { stroke:'#CD7C32', fill:'rgba(205,124,50,0.18)', strokeWidth:1.5 });

 document.getElementById('statAovValue').textContent = aov.toFixed(2);
 document.getElementById('statAovCompare').innerHTML = dashCompareLabel(aov, prevAov);

 document.getElementById('statCustValue').textContent = periodCustomers.size;
 document.getElementById('statCustCompare').innerHTML = dashCompareLabel(periodCustomers.size, prevCustomers.size);

 // ---------- p1_31: GM enhancements ----------
 // (a) Last refreshed timestamp
 const refEl = document.getElementById('dashLastRefresh');
 if(refEl) refEl.textContent = new Date().toLocaleTimeString('en-MY', { hour:'2-digit', minute:'2-digit' });

 // (b) Gross Margin — uses financeRecords COGS for period (or proportion estimate)
 try {
   const fin = (typeof financeRecords !== 'undefined' && Array.isArray(financeRecords)) ? financeRecords : [];
   // Period bounds for COGS: only count finance_records dated within selected window
   const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
   let cogsTotal = 0;
   fin.forEach(f => {
     if(f.category !== 'COGS') return;
     const idx = M.indexOf(f.month);
     if(idx < 0) return;
     const d = new Date(parseInt(f.year), idx, 15).getTime();
     if(d >= cutoff && d <= Date.now()) cogsTotal += parseFloat(f.amount || 0);
   });
   const gmEl = document.getElementById('heroMarginValue');
   if(gmEl) {
     if(totalRev > 0) {
       const gmPct = ((totalRev - cogsTotal) / totalRev) * 100;
       gmEl.textContent = gmPct.toFixed(1) + '%';
       gmEl.style.color = gmPct >= 30 ? '#86EFAC' : gmPct >= 15 ? '#FCD34D' : '#FCA5A5';
     } else {
       gmEl.textContent = '—';
     }
   }
 } catch(e){}

 // (c) Repeat purchase rate (within period)
 try {
   const orderCountByCust = {};
   positives.forEach(s => {
     const k = s.customer_phone || s.customer_name;
     if(!k) return;
     orderCountByCust[k] = (orderCountByCust[k] || 0) + 1;
   });
   const repeaters = Object.values(orderCountByCust).filter(c => c >= 2).length;
   const total = Object.keys(orderCountByCust).length;
   const repeatRate = total > 0 ? (repeaters / total) * 100 : 0;
   const rrEl = document.getElementById('statRepeatRate');
   if(rrEl) rrEl.textContent = repeatRate.toFixed(0) + '%';
 } catch(e){}

 // (d) Money at risk = (low-stock SKU value at retail) + (AR > 30 days)
 try {
   const stockMap = {};
   (typeof inventoryBatches !== 'undefined' ? inventoryBatches : []).forEach(b => {
     stockMap[b.sku] = (stockMap[b.sku] || 0) + (parseFloat(b.qty_remaining) || 0);
   });
   let lowStockValue = 0, lowStockCount = 0;
   (typeof masterProducts !== 'undefined' ? masterProducts : []).forEach(p => {
     if(!p.is_published && !p.published_at) return;
     const stock = stockMap[p.sku] || 0;
     const reorder = parseInt(p.reorder_point) || 5;
     if(stock <= reorder) {
       lowStockCount++;
       lowStockValue += (parseFloat(p.price) || 0) * Math.max(0, reorder - stock);
     }
   });
   // AR > 30 days from quotationsLog (invoices unpaid)
   let arOverdueValue = 0, arOverdueCount = 0;
   const now30 = Date.now() - 30 * 24 * 3600 * 1000;
   (typeof window.quotationsLog !== 'undefined' ? window.quotationsLog : []).forEach(q => {
     if(q.status === 'paid' || q.status === 'cancelled' || q.status === 'voided') return;
     if(q.doc_type !== 'invoice' && q.type !== 'invoice') return;
     const d = new Date(q.created_at || q.date || q.generated_date).getTime();
     if(isNaN(d) || d > now30) return;
     const amt = parseFloat(q.grand_total || q.total || 0);
     if(amt > 0) { arOverdueValue += amt; arOverdueCount++; }
   });
   const totalRisk = lowStockValue + arOverdueValue;
   const rEl = document.getElementById('statRiskValue');
   if(rEl) rEl.textContent = (window.formatRMShort ? window.formatRMShort(totalRisk).replace('RM ', '') : Math.round(totalRisk).toLocaleString());
   const rbEl = document.getElementById('statRiskBreakdown');
   if(rbEl) rbEl.innerHTML = `${lowStockCount} low-stock · ${arOverdueCount} AR overdue`;
 } catch(e){}

 // (e) Anomaly alert banner — pull top critical/warning from p8_4 detector
 try {
   if(typeof __aaComputeAnomalies === 'function') {
     // Temporarily set to 7d for banner detection
     const prevPeriod = window.__aaPeriod;
     window.__aaPeriod = '7d';
     const anomalies = __aaComputeAnomalies();
     window.__aaPeriod = prevPeriod;
     const reviewed = (typeof __aaLoadReviewed === 'function') ? __aaLoadReviewed() : new Set();
     const top = anomalies.filter(a => !reviewed.has(a.id) && (a.severity === 'critical' || a.severity === 'warning'))[0];
     const bannerEl = document.getElementById('dashAlertBanner');
     if(bannerEl) {
       if(top) {
         bannerEl.style.display = 'flex';
         bannerEl.className = 'dash-alert-banner dash-alert-banner--' + top.severity;
         bannerEl.innerHTML = `
           <i data-lucide="${top.icon || 'alert-triangle'}" class="dash-alert-banner__icon"></i>
           <div class="dash-alert-banner__text">
             <strong>${top.title}</strong> — ${top.desc}
           </div>
           <a class="dash-alert-banner__cta" onclick="document.querySelector('[data-tab=&quot;admin_audit_alerts&quot;]')?.click()">Investigate →</a>
         `;
       } else {
         bannerEl.style.display = 'none';
       }
     }
   }
 } catch(e){}

 // (f) Monthly target progress bar
 try {
   const targetMonthly = parseFloat(localStorage.getItem('dashMonthlyTarget_v1') || '0');
   const targetEl = document.getElementById('dashTargetBar');
   const fillEl = document.getElementById('dashTargetFill');
   const pctEl = document.getElementById('dashTargetPct');
   const curEl = document.getElementById('dashTargetCurrent');
   const goalEl = document.getElementById('dashTargetGoal');
   const statusEl = document.getElementById('dashTargetStatus');
   const footEl = document.getElementById('dashTargetFoot');

   if(!targetMonthly || targetMonthly <= 0) {
     if(curEl) curEl.textContent = 'RM —';
     if(goalEl) goalEl.textContent = 'set target';
     if(pctEl) pctEl.textContent = '—';
     if(fillEl) fillEl.style.width = '0%';
     if(statusEl) { statusEl.textContent = 'Not Set'; statusEl.className = 'dash-target-bar__status dash-target-bar__status--unset'; }
     if(footEl) footEl.textContent = 'Click target icon to set monthly revenue target.';
   } else {
     // Calc month-to-date revenue
     const now = new Date();
     const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
     const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
     const daysIntoMonth = Math.ceil((Date.now() - monthStart) / (24*3600*1000));
     const totalDaysInMonth = Math.ceil((monthEnd - monthStart) / (24*3600*1000));
     const expectedAtThisPoint = targetMonthly * (daysIntoMonth / totalDaysInMonth);
     let mtdRev = 0;
     salesHistory.forEach(s => {
       const dt = s.created_at ? new Date(s.created_at).getTime() : 0;
       const t = parseFloat(s.total || 0);
       if(dt >= monthStart && t > 0) mtdRev += t;
     });
     const pct = (mtdRev / targetMonthly) * 100;
     const fmt = (n) => 'RM ' + Math.round(n).toLocaleString();
     if(curEl) curEl.textContent = fmt(mtdRev);
     if(goalEl) goalEl.textContent = fmt(targetMonthly);
     if(pctEl) pctEl.textContent = pct.toFixed(0) + '%';
     if(fillEl) {
       fillEl.style.width = Math.min(100, pct) + '%';
       fillEl.className = 'dash-target-bar__fill' + (pct >= 100 ? ' dash-target-bar__fill--complete' : (mtdRev < expectedAtThisPoint * 0.85 ? ' dash-target-bar__fill--behind' : ''));
     }
     // Status pill
     let status = 'On Track';
     let statusClass = 'ontrack';
     if(pct >= 100) { status = 'Target Hit'; statusClass = 'ahead'; }
     else if(mtdRev > expectedAtThisPoint * 1.05) { status = 'Ahead'; statusClass = 'ahead'; }
     else if(mtdRev < expectedAtThisPoint * 0.85) { status = 'Behind'; statusClass = 'behind'; }
     if(statusEl) { statusEl.textContent = status; statusEl.className = 'dash-target-bar__status dash-target-bar__status--' + statusClass; }
     // Foot — pace info
     const remainingDays = totalDaysInMonth - daysIntoMonth;
     const remainingTarget = Math.max(0, targetMonthly - mtdRev);
     const dailyNeeded = remainingDays > 0 ? remainingTarget / remainingDays : 0;
     if(footEl) {
       if(pct >= 100) footEl.textContent = `Target hit. ${remainingDays} days left in month — every ringgit beyond is bonus.`;
       else footEl.textContent = `${remainingDays} day(s) left · need RM ${Math.round(dailyNeeded).toLocaleString()}/day to hit target · expected by today: RM ${Math.round(expectedAtThisPoint).toLocaleString()}`;
     }
   }
 } catch(e) { console.warn('[dashboard] target bar fail', e); }

 // re-render lucide icons (banner uses dynamic icon)
 if(typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();

 // ---------- REVENUE TREND ----------
 const canvas = document.getElementById('dashRevenueChart');
 if(canvas) drawRevenueChart(canvas, positives, cutoff);

 // ---------- CHANNEL DONUT ----------
 const channelTotals = {};
 positives.forEach(s => {
 const ch = s.channel || 'Unknown';
 channelTotals[ch] = (channelTotals[ch] || 0) + (s.total||0);
 });
 const slices = Object.entries(channelTotals).sort((a,b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
 const donutContainer = document.getElementById('dashChannelDonut');
 if(donutContainer) {
 const grandCh = slices.reduce((s, x) => s + x.value, 0) || 1;
 donutContainer.innerHTML = `
 ${dashDonut(slices)}
 <div class="dash-donut__legend">
 ${slices.length === 0 ? '<span style="color:var(--neutral-500); font-size:12px;">Tiada data.</span>' :
 slices.slice(0, 6).map(sl => `
 <div class="dash-donut__legend-item">
 <span class="dash-donut__legend-swatch" style="background:${sl._color};"></span>
 <span class="dash-donut__legend-name">${sl.name}</span>
 <span class="dash-donut__legend-val">${(sl.value/grandCh*100).toFixed(0)}%</span>
 </div>
 `).join('')}
 </div>
 `;
 }

 // ---------- TOP 10 SKUs ----------
 const skuQty = {}; const skuRev = {};
 positives.forEach(s => (s.items||[]).forEach(it => {
 const sku = (it.sku || 'NO_SKU').toUpperCase();
 const qty = parseInt(it.qty || 1);
 skuQty[sku] = (skuQty[sku] || 0) + qty;
 skuRev[sku] = (skuRev[sku] || 0) + qty * (parseFloat(it.price)||0);
 }));
 const topSku = Object.entries(skuQty).sort((a,b) => b[1] - a[1]).slice(0, 8);
 const maxSku = topSku[0]?.[1] || 1;
 document.getElementById('dashTopSkus').innerHTML = topSku.length === 0
 ? '<div class="empty-state" style="padding:20px;"><div class="empty-state__icon" style="font-size:32px;"></div><div class="empty-state__desc">Tiada sales dalam period ini.</div></div>'
 : topSku.map(([sku, qty], i) => {
 const p = masterProducts.find(p => p.sku === sku);
 const name = p ? (p.name || '').slice(0, 40) : sku;
 const rankCls = i === 0 ? 'dash-rank-badge--gold' : i === 1 ? 'dash-rank-badge--silver' : i === 2 ? 'dash-rank-badge--bronze' : '';
 const widthPct = (qty / maxSku * 100);
 return `
 <div class="dash-ranked-item">
 <div class="dash-rank-badge ${rankCls}">${i+1}</div>
 <div class="dash-ranked-item__main">
 <div class="dash-ranked-item__title">${name}</div>
 <div class="dash-ranked-item__sub">${sku} · RM ${(skuRev[sku]||0).toFixed(0)}</div>
 </div>
 <div class="dash-ranked-item__share"><div class="dash-ranked-item__share-fill" style="width:${widthPct}%;"></div></div>
 <div class="dash-ranked-item__value">${qty}</div>
 </div>
 `;
 }).join('');

 // ---------- TOP STAFF ----------
 const staffStats = {};
 positives.forEach(s => {
 const sn = s.staff_name || '(Unassigned)';
 if(!staffStats[sn]) staffStats[sn] = { rev:0, orders:0 };
 staffStats[sn].rev += (s.total||0);
 staffStats[sn].orders++;
 });
 const topStaff = Object.entries(staffStats).sort((a,b) => b[1].rev - a[1].rev).slice(0, 8);
 const maxStaff = topStaff[0]?.[1].rev || 1;
 document.getElementById('dashTopStaff').innerHTML = topStaff.length === 0
 ? '<div class="empty-state" style="padding:20px;"><div class="empty-state__icon" style="font-size:32px;"></div><div class="empty-state__desc">Tiada attribution.</div></div>'
 : topStaff.map(([name, st], i) => {
 const widthPct = (st.rev / maxStaff * 100);
 const initials = dashInitials(name);
 const color = dashAvatarColor(name);
 return `
 <div class="dash-ranked-item">
 <div class="dash-avatar" style="background:${color};">${initials}</div>
 <div class="dash-ranked-item__main">
 <div class="dash-ranked-item__title">${name}</div>
 <div class="dash-ranked-item__sub">${st.orders} orders</div>
 </div>
 <div class="dash-ranked-item__share"><div class="dash-ranked-item__share-fill" style="width:${widthPct}%;"></div></div>
 <div class="dash-ranked-item__value">RM ${fmtCompact(st.rev)}</div>
 </div>
 `;
 }).join('');

 // ---------- LOW STOCK ALERTS ----------
 const low = [];
 masterProducts.forEach(p => {
 const stock = inventoryBatches.filter(b => b.sku === p.sku).reduce((s, b) => s + (b.qty_remaining||0), 0);
 const rp = p.reorder_point || 10;
 if(stock < rp && skuQty[p.sku]) low.push({ sku:p.sku, name:p.name, stock, rp, recent:skuQty[p.sku], brand:p.brand });
 });
 low.sort((a,b) => b.recent - a.recent);
 document.getElementById('dashLowStock').innerHTML = low.length === 0
 ? '<div class="empty-state" style="padding:20px;"><div class="empty-state__icon" style="font-size:32px; color:var(--success-500); opacity:1;"></div><div class="empty-state__title" style="color:var(--success-700);">All healthy</div><div class="empty-state__desc">Semua SKU di atas reorder point.</div></div>'
 : low.slice(0, 8).map(it => {
 const isMed = it.stock> 0;
 return `
 <div class="dash-lowstock-item ${isMed ? 'dash-lowstock-item--med' : ''}">
 <div class="dash-lowstock-item__main">
 <div class="dash-lowstock-item__sku">${it.sku} <span style="color:var(--neutral-500); font-weight:normal;">${it.brand||''}</span></div>
 <div class="dash-lowstock-item__name">${(it.name||'').slice(0, 50)}</div>
 </div>
 <div class="dash-lowstock-item__stock">${it.stock}/${it.rp}</div>
 </div>
 `;
 }).join('');

 // ---------- TOP CUSTOMERS ----------
 const custStats = {};
 positives.forEach(s => {
 const key = s.customer_phone || s.customer_name;
 if(!key || key === 'Walk-In') return;
 if(!custStats[key]) custStats[key] = { name:s.customer_name||'Unknown', spend:0, orders:0, phone:s.customer_phone };
 custStats[key].spend += (s.total||0);
 custStats[key].orders++;
 });
 const topCust = Object.values(custStats).sort((a,b) => b.spend - a.spend).slice(0, 8);
 const maxCust = topCust[0]?.spend || 1;
 document.getElementById('dashTopCustomers').innerHTML = topCust.length === 0
 ? '<div class="empty-state" style="padding:20px;"><div class="empty-state__icon" style="font-size:32px;"></div><div class="empty-state__desc">Tiada customer dalam period.</div></div>'
 : topCust.map((c, i) => {
 const widthPct = (c.spend / maxCust * 100);
 const initials = dashInitials(c.name);
 const color = dashAvatarColor(c.name);
 // Look up tier from customersData
 const cust = (customersData||[]).find(x => x.phone === c.phone || x.name === c.name);
 const tier = cust && typeof getCustomerTier === 'function' ? getCustomerTier(cust) : null;
 const tierBadge = tier ? `<span class="badge badge--${tier.toLowerCase()}" style="margin-left:6px;">${(typeof getTierColor === 'function' ? getTierColor(tier).emoji : '')} ${tier}</span>` : '';
 return `
 <div class="dash-ranked-item">
 <div class="dash-avatar" style="background:${color};">${initials}</div>
 <div class="dash-ranked-item__main">
 <div class="dash-ranked-item__title">${(c.name||'').slice(0, 30)}${tierBadge}</div>
 <div class="dash-ranked-item__sub">${c.orders} orders</div>
 </div>
 <div class="dash-ranked-item__share"><div class="dash-ranked-item__share-fill" style="width:${widthPct}%;"></div></div>
 <div class="dash-ranked-item__value">RM ${fmtCompact(c.spend)}</div>
 </div>
 `;
 }).join('');

 // ---------- COHORT BAR CHART ----------
 const monthSet = {};
 if(typeof customersData !== 'undefined') {
 customersData.forEach(c => {
 if(!c.created_at) return;
 const m = c.created_at.slice(0, 7);
 monthSet[m] = (monthSet[m] || 0) + 1;
 });
 }
 const sortedMonthsAsc = Object.entries(monthSet).sort((a,b) => a[0].localeCompare(b[0])).slice(-12);
 const maxMonth = Math.max(...sortedMonthsAsc.map(([_, n]) => n), 1);
 const totalCohort = sortedMonthsAsc.reduce((s, [_, n]) => s + n, 0);
 const cohortTotal = document.getElementById('dashCohortTotal');
 if(cohortTotal) cohortTotal.textContent = `${totalCohort} new`;
 document.getElementById('dashCohortBars').innerHTML = sortedMonthsAsc.length === 0
 ? '<div style="color:var(--neutral-500); font-size:12px; padding:20px; text-align:center; flex:1;">No cohort data.</div>'
 : sortedMonthsAsc.map(([m, n]) => `
 <div class="dash-cohort-bar" style="height:${(n/maxMonth*100).toFixed(0)}%;" data-tooltip="${m}: ${n} new"></div>
 `).join('');
 document.getElementById('dashCohortLabels').innerHTML = sortedMonthsAsc.length === 0 ? ''
 : sortedMonthsAsc.map(([m]) => {
 const dt = new Date(m + '-01');
 return `<span>${dt.toLocaleDateString('en-MY', { month: 'short' })}</span>`;
 }).join('');

 if(typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
};

// dashSetPeriod uses.is-active class (new); keep.active for backward compat too
const __originalDashSetPeriod = window.dashSetPeriod;
window.dashSetPeriod = function(p) {
 __dashPeriod = p;
 document.querySelectorAll('.dash-period-bar button').forEach(b => b.classList.toggle('is-active', b.dataset.period === p));
 // Keep legacy class working too
 document.querySelectorAll('.dash-period-btn').forEach(b => b.classList.toggle('active', b.dataset.period === p));
 renderManagerDashboard();
};

function drawRevenueChart(canvas, sales, cutoff) {
 const ctx = canvas.getContext('2d');
 canvas.width = canvas.offsetWidth * 2;
 canvas.height = 240 * 2;
 canvas.style.height = '240px';
 ctx.scale(2, 2);
 const W = canvas.offsetWidth, H = 240;
 ctx.clearRect(0, 0, W, H);

 if(sales.length === 0) {
 ctx.fillStyle = '#9CA3AF'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
 ctx.fillText('No data for this period', W/2, H/2); return;
 }

 // Bucket by day
 const dayMap = {};
 sales.forEach(s => {
 const dt = s.created_at ? new Date(s.created_at).toISOString().slice(0,10) : null;
 if(!dt) return;
 dayMap[dt] = (dayMap[dt] || 0) + (s.total||0);
 });
 const days = Object.keys(dayMap).sort();
 const maxRev = Math.max(...Object.values(dayMap), 1);

 // Axes + line
 const padL = 50, padR = 20, padT = 20, padB = 30;
 const plotW = W - padL - padR, plotH = H - padT - padB;
 ctx.strokeStyle = '#E5E7EB'; ctx.lineWidth = 1;
 ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, H-padB); ctx.lineTo(W-padR, H-padB); ctx.stroke();

 // Grid + Y labels
 ctx.fillStyle = '#9CA3AF'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
 for(let i = 0; i <= 4; i++) {
 const y = padT + plotH * (1 - i/4);
 const v = maxRev * i / 4;
 ctx.fillText('RM ' + v.toFixed(0), padL - 6, y + 3);
 ctx.strokeStyle = '#F3F4F6';
 ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W-padR, y); ctx.stroke();
 }

 // Line
 if(days.length> 1) {
 ctx.strokeStyle = '#CD7C32'; ctx.lineWidth = 2;
 ctx.beginPath();
 days.forEach((d, i) => {
 const x = padL + plotW * i / (days.length - 1);
 const y = padT + plotH * (1 - dayMap[d] / maxRev);
 if(i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
 });
 ctx.stroke();
 // Fill area
 ctx.fillStyle = 'rgba(205, 124, 50, 0.1)';
 ctx.lineTo(padL + plotW, H - padB);
 ctx.lineTo(padL, H - padB);
 ctx.closePath(); ctx.fill();
 }

 // X labels (first / mid / last)
 ctx.fillStyle = '#666'; ctx.textAlign = 'center';
 if(days.length) {
 ctx.fillText(days[0].slice(5), padL, H - padB + 16);
 ctx.fillText(days[days.length-1].slice(5), padL + plotW, H - padB + 16);
 if(days.length> 5) {
 const mid = Math.floor(days.length / 2);
 ctx.fillText(days[mid].slice(5), padL + plotW/2, H - padB + 16);
 }
 }
}

// ============= p4_4 LOW STOCK PUSH NOTIFICATIONS =============
window.checkLowStockNotify = async function() {
 // Compute low-stock list regardless of browser permission — notification center always logs it.
 const low = (masterProducts || []).filter(p => {
 const stock = (inventoryBatches || []).filter(b => b.sku === p.sku).reduce((s, b) => s + (b.qty_remaining||0), 0);
 const rp = p.reorder_point || 10;
 return isPublished(p) && stock < rp;
 });
 if(low.length === 0) return;

 // Always push into notification center (deduped 30s by title+body).
 if (window.notify) {
 window.notify.add({
 title: 'Low stock alert',
 body: `${low.length} produk bawah reorder point. Top 3: ${low.slice(0,3).map(p => p.sku).join(', ')}`,
 type: 'warning'
 });
 }

 // Browser push notification (separate gating: permission + 4hr throttle).
 if(!('Notification' in window)) return;
 const enabled = localStorage.getItem('lowStockNotifyEnabled_v1') === 'true';
 if(!enabled || Notification.permission !== 'granted') return;
 const lastNotify = parseInt(localStorage.getItem('lowStockLastNotify_v1') || '0');
 if(Date.now() - lastNotify < 4 * 60 * 60 * 1000) return;

 new Notification(' 10 CAMP — Low Stock Alert', {
 body: `${low.length} produk bawah reorder point. Top 3: ${low.slice(0,3).map(p => p.sku).join(', ')}`,
 icon: 'https://placehold.co/64x64?text=10C',
 tag: 'low-stock'
 });
 localStorage.setItem('lowStockLastNotify_v1', String(Date.now()));
};

window.requestNotifyPermission = async function() {
 if(!('Notification' in window)) return showToast('Browser tak support notification', 'warn');
 const r = await Notification.requestPermission();
 if(r === 'granted') {
 localStorage.setItem('lowStockNotifyEnabled_v1', 'true');
 showToast('Low stock notifications enabled. Akan check setiap 4 jam.', 'success');
 checkLowStockNotify();
 } else {
 showToast('Permission denied. Boleh enable balik dari browser settings.', 'warn');
 }
};

// ============= SC1 p4_2 ROSTER ↔ ATTENDANCE RECONCILIATION =============
window.renderRosterRecon = async function() {
 const tbody = document.getElementById('rrTbody');
 if(!tbody) return;

 // Default date range: last 30 days
 const fromEl = document.getElementById('rrFromDate');
 const toEl = document.getElementById('rrToDate');
 if(fromEl && !fromEl.value) {
 const d = new Date(); d.setDate(d.getDate() - 30);
 fromEl.value = d.toISOString().slice(0,10);
 }
 if(toEl && !toEl.value) toEl.value = new Date().toISOString().slice(0,10);

 const fromDate = fromEl?.value || '';
 const toDate = toEl?.value || '';
 const filterStaff = document.getElementById('rrStaff')?.value || '';

 let rosters = [], attendance = [];
 try {
 const r1 = await db.from('roster_schedules').select('*');
 const r2 = await db.from('staff_attendance').select('*');
 rosters = r1.data || [];
 attendance = r2.data || [];
 } catch(e) {
 tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#999;">Error: ${e.message}</td></tr>`;
 return;
 }

 // Populate staff filter
 const staffSel = document.getElementById('rrStaff');
 if(staffSel && staffSel.options.length <= 1) {
 const names = [...new Set([...rosters,...attendance].map(r => r.staff_name).filter(Boolean))].sort();
 staffSel.innerHTML = '<option value="">Semua</option>' + names.map(n => `<option value="${n}">${n}</option>`).join('');
 }

 // Build per-day-per-staff records
 const byKey = {};
 rosters.forEach(r => {
 const date = (r.shift_date || r.date || '').slice(0, 10);
 if(!date) return;
 if(fromDate && date < fromDate) return;
 if(toDate && date> toDate) return;
 if(filterStaff && r.staff_name !== filterStaff) return;
 const key = `${date}|${r.staff_name||''}`;
 if(!byKey[key]) byKey[key] = { date, staff:r.staff_name||'-', plan:null, in:null, out:null };
 byKey[key].plan = `${r.shift_start||r.start||'09:00'}–${r.shift_end||r.end||'18:00'}`;
 });
 attendance.forEach(a => {
 const date = (a.attendance_date || a.created_at || '').slice(0, 10);
 if(!date) return;
 if(fromDate && date < fromDate) return;
 if(toDate && date> toDate) return;
 if(filterStaff && a.staff_name !== filterStaff) return;
 const key = `${date}|${a.staff_name||''}`;
 if(!byKey[key]) byKey[key] = { date, staff:a.staff_name||'-', plan:null, in:null, out:null };
 byKey[key].in = a.check_in || a.clock_in || null;
 byKey[key].out = a.check_out || a.clock_out || null;
 });

 const rows = Object.values(byKey).sort((a,b) => b.date.localeCompare(a.date));
 let onTime = 0, late = 0, noShow = 0, unscheduled = 0;
 rows.forEach(r => {
 if(r.plan && !r.in) { r.status = 'NO-SHOW'; noShow++; }
 else if(!r.plan && r.in) { r.status = 'UNSCHEDULED'; unscheduled++; }
 else if(r.plan && r.in) {
 const planStart = (r.plan.split('–')[0] || '09:00').slice(0, 5);
 const inTime = (r.in.match(/\d{2}:\d{2}/) || ['09:00'])[0];
 if(inTime> planStart) { r.status = 'LATE'; late++; }
 else { r.status = 'ON-TIME'; onTime++; }
 } else { r.status = '-'; }
 });

 document.getElementById('rrSummary').innerHTML = `
 <div style="background:#F0FDF4; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#166534;">On-Time</div><div style="font-size:18px; font-weight:bold;">${onTime}</div></div>
 <div style="background:#FEF3C7; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#92400E;">Late</div><div style="font-size:18px; font-weight:bold;">${late}</div></div>
 <div style="background:#FEE2E2; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#991B1B;">No-Show</div><div style="font-size:18px; font-weight:bold;">${noShow}</div></div>
 <div style="background:#EFF6FF; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#1E40AF;">Unscheduled</div><div style="font-size:18px; font-weight:bold;">${unscheduled}</div></div>
 <div style="background:#FAF5FF; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#6B21A8;">Total Days</div><div style="font-size:18px; font-weight:bold;">${rows.length}</div></div>
 `;

 if(rows.length === 0) {
 tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#999;">Tiada data dalam tempoh ini. (Roster + Attendance kena ada data dulu.)</td></tr>';
 return;
 }

 tbody.innerHTML = rows.slice(0, 200).map(r => {
 const colors = {
 'ON-TIME': { bg:'#D1FAE5', fg:'#065F46' },
 'LATE': { bg:'#FEF3C7', fg:'#92400E' },
 'NO-SHOW': { bg:'#FEE2E2', fg:'#991B1B' },
 'UNSCHEDULED': { bg:'#DBEAFE', fg:'#1E40AF' },
 '-': { bg:'#F3F4F6', fg:'#6B7280' }
 };
 const c = colors[r.status] || colors['-'];
 return `<tr><td>${r.date}</td><td>${r.staff}</td><td style="font-family:monospace; font-size:11px;">${r.plan||'-'}</td><td>${r.in||'-'}</td><td>${r.out||'-'}</td><td>${r.plan && r.in ? 'auto' : '-'}</td><td><span style="background:${c.bg}; color:${c.fg}; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:10px;">${r.status}</span></td></tr>`;
 }).join('');
};

// =============================================================
// SPRINT B — GROWTH & LOYALTY
// =============================================================

// ============= p7_1 TIERED LOYALTY =============
// Tier rules: Bronze (3-9 orders), Silver (10-29), Gold (30+).
// Discount % per tier configurable in settings (defaults: 3 / 5 / 10).
window.getCustomerTier = function(customer) {
 const orders = customer ? (customer.total_orders || 0) : 0;
 if(orders>= 30) return 'Gold';
 if(orders>= 10) return 'Silver';
 if(orders>= 3) return 'Bronze';
 return null;
};

window.getTierDiscount = function(tier) {
 try {
 const s = JSON.parse(localStorage.getItem('complianceSettings_v1') || '{}');
 const t = s.tiers || {};
 const defaults = { Bronze: 3, Silver: 5, Gold: 10 };
 return parseFloat(t[tier]) || defaults[tier] || 0;
 } catch(e) { return 0; }
};

window.getTierColor = function(tier) {
 const map = {
 Bronze: { bg:'#FED7AA', fg:'#9A3412', emoji:'' },
 Silver: { bg:'#E5E7EB', fg:'#374151', emoji:'' },
 Gold: { bg:'#FEF3C7', fg:'#92400E', emoji:'' }
 };
 return map[tier] || { bg:'#E5E7EB', fg:'#6B7280', emoji:'•' };
};

// Override checkoutVipLookup to use tier system
const __originalCheckoutVipLookup = window.checkoutVipLookup;
window.checkoutVipLookup = function() {
 const nameEl = document.getElementById('customerName');
 const phoneEl = document.getElementById('customerPhone');
 const badge = document.getElementById('checkoutVipBadge');
 if(!badge) return;

 const name = (nameEl?.value || '').trim().toLowerCase();
 const phoneRaw = (phoneEl?.value || '').trim();
 const phone = (typeof normalisePhoneForMatch === 'function') ? normalisePhoneForMatch(phoneRaw) : phoneRaw;

 let match = null;
 if(typeof customersData !== 'undefined') {
 if(phone) match = customersData.find(c => c.phone === phone);
 if(!match && name && name.length>= 3) match = customersData.find(c => (c.name || '').toLowerCase() === name);
 }

 window.__currentCheckoutVip = null;
 if(!match) {
 badge.style.display = 'none';
 recomputeCheckoutTotal();
 return;
 }

 const tier = getCustomerTier(match);
 if(tier) {
 const pct = getTierDiscount(tier);
 const c = getTierColor(tier);
 window.__currentCheckoutVip = {
 customer_id: match.id,
 customer_name: match.name,
 customer_phone: match.phone,
 tier, discount_pct: pct,
 total_orders: match.total_orders || 0,
 total_spent: match.total_spent || 0
 };
 badge.style.background = c.bg;
 badge.style.color = c.fg;
 badge.style.border = `2px solid ${c.fg}`;
 badge.style.display = 'block';
 badge.innerHTML = `${c.emoji} <strong>${tier.toUpperCase()} TIER</strong> · ${match.name} · ${match.total_orders} orders · RM${(match.total_spent||0).toFixed(0)} spent — auto-discount <strong>${pct}%</strong> applied`;
 } else {
 const orders = match.total_orders || 0;
 const need = 3 - orders;
 badge.style.background = '#EFF6FF';
 badge.style.color = '#1E40AF';
 badge.style.border = '1px solid #BFDBFE';
 badge.style.display = 'block';
 badge.innerHTML = ` ${match.name} · ${orders} order(s) · ${need> 0 ? need + ' more order to unlock Bronze' : 'qualifies next checkout'}`;
 }
 recomputeCheckoutTotal();
};

// ============= p7_3 PROMO ENGINE (rules-based) =============
let __activePromos = [];

window.loadPromotions = async function() {
 try {
 const { data } = await db.from('promotions').select('*').eq('active', true);
 __activePromos = data || [];
 } catch(e) { __activePromos = []; }
};

window.evaluatePromos = function(cart, customer) {
 if(!cart || cart.length === 0) return [];
 const today = new Date().toISOString().slice(0, 10);
 const cartTotal = cart.reduce((s, it) => s + (it.qty||it.quantity||1) * (it.price||0), 0);
 const cartQty = cart.reduce((s, it) => s + (it.qty||it.quantity||1), 0);
 const tier = customer ? getCustomerTier(customer) : null;

 const eligible = [];
 __activePromos.forEach(p => {
 if(!p.active) return;
 if(p.start_date && p.start_date> today) return;
 if(p.end_date && p.end_date < today) return;
 if(p.max_uses && (p.uses_count || 0)>= p.max_uses) return;
 if(p.min_spend && cartTotal < p.min_spend) return;
 if(p.min_qty && cartQty < p.min_qty) return;
 if(p.customer_tier && p.customer_tier !== tier) return;

 // Compute discount based on scope
 let discount = 0;
 const dv = parseFloat(p.discount_value) || 0;
 const matchItems = (p.scope === 'cart_total')
 ? cart
 : cart.filter(it => {
 if(p.scope === 'sku') return (it.sku || '').toUpperCase() === (p.scope_value || '').toUpperCase();
 if(p.scope === 'brand') {
 const prod = masterProducts.find(m => m.sku === it.sku);
 return prod && (prod.brand || '').toLowerCase() === (p.scope_value || '').toLowerCase();
 }
 if(p.scope === 'category') {
 const prod = masterProducts.find(m => m.sku === it.sku);
 return prod && (prod.category || '').toLowerCase() === (p.scope_value || '').toLowerCase();
 }
 return false;
 });
 if(matchItems.length === 0 && p.scope !== 'cart_total') return;

 const matchTotal = matchItems.reduce((s, it) => s + (it.qty||it.quantity||1) * (it.price||0), 0);

 if(p.discount_type === 'percent') {
 discount = matchTotal * dv / 100;
 } else if(p.discount_type === 'fixed') {
 discount = Math.min(dv, matchTotal);
 } else if(p.discount_type === 'bogo') {
 // Buy 1 get 1 — half the qty pairs get free
 const matchQty = matchItems.reduce((s, it) => s + (it.qty||it.quantity||1), 0);
 const freeQty = Math.floor(matchQty / 2);
 const avgPrice = matchTotal / matchQty;
 discount = freeQty * avgPrice;
 }

 if(discount> 0) {
 eligible.push({ promo: p, discount, applies_to: p.scope, value_target: p.scope_value });
 }
 });

 // Sort by priority (lower number = higher priority) then by discount desc
 eligible.sort((a, b) => (a.promo.priority||100) - (b.promo.priority||100) || b.discount - a.discount);
 return eligible;
};

// ============= p7_4 CUSTOMER SEGMENTS / RFM =============
window.renderSegments = function() {
 if(typeof customersData === 'undefined' || typeof salesHistory === 'undefined') return;

 // RFM compute
 const now = Date.now();
 const customerAgg = {};
 salesHistory.filter(s => (s.total||0)> 0).forEach(s => {
 const key = s.customer_phone || s.customer_name;
 if(!key || key === 'Walk-In') return;
 if(!customerAgg[key]) customerAgg[key] = { phone:s.customer_phone, name:s.customer_name||'-', orders:0, spent:0, lastOrder:null };
 customerAgg[key].orders++;
 customerAgg[key].spent += (s.total||0);
 if(!customerAgg[key].lastOrder || (s.created_at||'')> customerAgg[key].lastOrder) customerAgg[key].lastOrder = s.created_at;
 });

 // Classify per RFM
 const buckets = {
 'Champion': { desc:'High recency + freq + spend', filter:c => daysSince(c.lastOrder) < 60 && c.orders>= 5 && c.spent>= 1000 },
 'Loyal': { desc:'Frequent + recent', filter:c => daysSince(c.lastOrder) < 90 && c.orders>= 3 },
 'Potential Loyalist': { desc:'Recent but low frequency', filter:c => daysSince(c.lastOrder) < 60 && c.orders < 3 },
 'New Customer': { desc:'1 order, recent', filter:c => c.orders === 1 && daysSince(c.lastOrder) < 30 },
 'At Risk': { desc:'Last bought 90-180 days ago', filter:c => daysSince(c.lastOrder)>= 90 && daysSince(c.lastOrder) < 180 && c.orders>= 2 },
 'Hibernating': { desc:'Inactive 180+ days', filter:c => daysSince(c.lastOrder)>= 180 },
 };

 const segmentMap = {};
 Object.keys(buckets).forEach(k => segmentMap[k] = []);

 Object.values(customerAgg).forEach(c => {
 for(const [name, b] of Object.entries(buckets)) {
 if(b.filter(c)) { segmentMap[name].push(c); break; }
 }
 });

 // Stats cards
 const totalCust = Object.values(customerAgg).length;
 const totalSpent = Object.values(customerAgg).reduce((s, c) => s + c.spent, 0);
 const totalOrders = Object.values(customerAgg).reduce((s, c) => s + c.orders, 0);
 const avgAOV = totalOrders> 0 ? totalSpent / totalOrders : 0;
 document.getElementById('segStats').innerHTML = `
 <div style="background:#EFF6FF; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#1E40AF;">Active Customers</div><div style="font-size:18px; font-weight:bold;">${totalCust}</div></div>
 <div style="background:#F0FDF4; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#166534;">Total Spent</div><div style="font-size:18px; font-weight:bold;">RM ${totalSpent.toLocaleString(undefined,{maximumFractionDigits:0})}</div></div>
 <div style="background:#FEF3C7; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#92400E;">Avg Order Value</div><div style="font-size:18px; font-weight:bold;">RM ${avgAOV.toFixed(2)}</div></div>
 <div style="background:#FAF5FF; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#6B21A8;">Champions</div><div style="font-size:18px; font-weight:bold;">${segmentMap['Champion'].length}</div></div>
 <div style="background:#FEE2E2; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#991B1B;">At Risk + Hibernating</div><div style="font-size:18px; font-weight:bold;">${segmentMap['At Risk'].length + segmentMap['Hibernating'].length}</div></div>
 `;

 // RFM table
 const segColors = {
 'Champion': '#10B981',
 'Loyal': '#3B82F6',
 'Potential Loyalist': '#A855F7',
 'New Customer': '#F59E0B',
 'At Risk': '#EF4444',
 'Hibernating': '#9CA3AF'
 };
 document.getElementById('segRfmTbody').innerHTML = Object.entries(segmentMap).map(([name, list]) => {
 const spend = list.reduce((s, c) => s + c.spent, 0);
 const orders = list.reduce((s, c) => s + c.orders, 0);
 const aov = orders> 0 ? spend / orders : 0;
 return `<tr>
 <td><span style="background:${segColors[name]}; color:#FFF; padding:2px 8px; border-radius:50px; font-weight:bold; font-size:10px;">${name}</span><br><span style="font-size:10px; color:#888;">${buckets[name].desc}</span></td>
 <td style="text-align:right; font-weight:bold;">${list.length}</td>
 <td style="text-align:right;">RM ${spend.toFixed(0)}</td>
 <td style="text-align:right;">RM ${aov.toFixed(2)}</td>
 </tr>`;
 }).join('');

 // Cohort
 const cohort = {};
 customersData.forEach(c => {
 if(!c.created_at) return;
 const m = c.created_at.slice(0, 7);
 if(!cohort[m]) cohort[m] = { count:0, spent:0 };
 cohort[m].count++;
 cohort[m].spent += (c.total_spent||0);
 });
 const sortedCohort = Object.entries(cohort).sort((a,b) => b[0].localeCompare(a[0])).slice(0, 12);
 document.getElementById('segCohortTbody').innerHTML = sortedCohort.map(([m, d]) =>
 `<tr><td>${m}</td><td style="text-align:right;">${d.count}</td><td style="text-align:right;">RM ${d.spent.toFixed(0)}</td><td style="text-align:right;">RM ${(d.spent / d.count).toFixed(2)}</td></tr>`
).join('') || '<tr><td colspan="4" style="text-align:center; color:#999;">No data.</td></tr>';

 // Top 20
 const top = Object.values(customerAgg).sort((a,b) => b.spent - a.spent).slice(0, 20);
 document.getElementById('segTopTbody').innerHTML = top.map((c, i) => {
 // tier
 const cust = customersData.find(cu => cu.phone === c.phone || cu.name === c.name);
 const tier = getCustomerTier(cust);
 const tierBadge = tier ? `<span style="background:${getTierColor(tier).bg}; color:${getTierColor(tier).fg}; padding:1px 6px; border-radius:50px; font-weight:bold; font-size:10px;">${getTierColor(tier).emoji} ${tier}</span>` : '-';
 const aov = c.orders> 0 ? c.spent / c.orders : 0;
 const lastDate = c.lastOrder ? c.lastOrder.slice(0, 10) : '-';
 return `<tr>
 <td><strong>#${i+1}</strong></td>
 <td>${(c.name||'').slice(0, 40)}</td>
 <td style="font-family:monospace; font-size:11px;">${c.phone||'-'}</td>
 <td>${tierBadge}</td>
 <td style="text-align:right;">${c.orders}</td>
 <td style="text-align:right; font-weight:bold;">${c.spent.toFixed(2)}</td>
 <td style="text-align:right;">${aov.toFixed(2)}</td>
 <td style="font-size:11px;">${lastDate}</td>
 </tr>`;
 }).join('');
};

function daysSince(iso) {
 if(!iso) return 999999;
 return Math.floor((Date.now() - new Date(iso).getTime()) / (24*60*60*1000));
}

// ============= p7_5 FESTIVAL TEMPLATES =============
const FESTIVAL_TEMPLATES = [
 { id:'raya', label:' Hari Raya Aidilfitri', code:'RAYA2026', type:'percent', value:20, scope:'cart_total', minSpend:200, desc:'Diskaun 20% sempena Raya untuk pembelian melebihi RM200' },
 { id:'cny', label:' Chinese New Year', code:'CNY2026', type:'percent', value:15, scope:'cart_total', minSpend:150, desc:'Diskaun 15% sempena CNY untuk pembelian melebihi RM150' },
 { id:'depavali',label:' Deepavali', code:'DEEPAVALI', type:'percent', value:15, scope:'cart_total', minSpend:150, desc:'Diskaun 15% sempena Deepavali' },
 { id:'merdeka', label:'🇲🇾 Hari Merdeka', code:'MERDEKA31', type:'percent', value:31, scope:'cart_total', minSpend:300, desc:'31% off sempena Merdeka untuk pembelian melebihi RM300' },
 { id:'malaysia',label:'🇲🇾 Hari Malaysia', code:'MALAYSIA16', type:'percent', value:16, scope:'cart_total', minSpend:200, desc:'16% off sempena Hari Malaysia' },
 { id:'xmas', label:' Christmas', code:'XMAS2026', type:'fixed', value:50, scope:'cart_total', minSpend:300, desc:'RM50 off sempena Christmas untuk pembelian melebihi RM300' },
 { id:'newyear', label:' New Year', code:'NY2026', type:'percent', value:10, scope:'cart_total', desc:'10% off New Year sale' },
 { id:'pekerja', label:' Hari Pekerja', code:'WORKER', type:'fixed', value:30, scope:'cart_total', minSpend:200, desc:'RM30 off Hari Pekerja' },
 { id:'campday', label:' 10 CAMP Anniversary', code:'TENCAMP', type:'percent', value:10, scope:'cart_total', desc:'10% off semua sempena anniversary 10 CAMP' },
];

window.openFestivalTemplates = function() {
 const html = `
 <div id="festOverlay" class="login-overlay" style="display:flex; z-index:3700;">
 <div class="login-box" style="max-width:760px; width:96%; padding:24px;">
 <button onclick="document.getElementById('festOverlay').remove()" style="float:right; border:none; background:none; font-size:24px; cursor:pointer; color:var(--text-muted);">×</button>
 <h2 style="margin:0 0 8px;"> Festival Promo Templates</h2>
 <p style="font-size:13px; color:#666; margin-bottom:14px;">One-click recipe untuk promo festival. Klik "Add" untuk insert ke promotions table sebagai inactive — pergi Promotions section untuk activate.</p>
 <div style="max-height:520px; overflow-y:auto; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
 ${FESTIVAL_TEMPLATES.map(t => `
 <div style="background:#FFF; border:1px solid var(--border-color); border-radius:8px; padding:14px;">
 <h4 style="margin:0 0 4px; font-size:14px;">${t.label}</h4>
 <p style="font-size:11px; color:#666; margin:0 0 8px; min-height:30px;">${t.desc}</p>
 <div style="font-size:11px; margin-bottom:8px;">
 <span style="background:#F3F4F6; padding:1px 6px; border-radius:3px; font-family:monospace;">${t.code}</span>
 · ${t.type === 'percent' ? t.value + '%' : 'RM' + t.value}
 ${t.minSpend ? ' · min RM' + t.minSpend : ''}
 </div>
 <button class="btn-success" style="width:100%; padding:6px; font-size:11px; margin:0;" onclick="window.applyFestivalTemplate('${t.id}')">+ Add to Promotions</button>
 </div>
 `).join('')}
 </div>
 </div>
 </div>
 `;
 document.body.insertAdjacentHTML('beforeend', html);
};

window.applyFestivalTemplate = async function(id) {
 const t = FESTIVAL_TEMPLATES.find(x => x.id === id);
 if(!t) return;
 try {
 const { error } = await db.from('promotions').insert([{
 code: t.code,
 discount_type: t.type,
 discount_value: t.value,
 scope: t.scope,
 min_spend: t.minSpend || null,
 description: t.desc,
 active: false // start inactive — admin must enable
 }]);
 if(error) throw error;
 showToast(`${t.label} added (inactive). Activate dari Promotions.`, 'success');
 await loadPromotions();
 } catch(e) {
 showToast('Ralat: ' + e.message, 'error');
 }
};

// Promo Engine — improved Promotions section render
window.renderPromotionsV2 = async function() {
 const tbody = document.getElementById('promotionsTableBody');
 if(!tbody) return;
 try {
 const { data: promos } = await db.from('promotions').select('*').order('priority').order('id', {ascending:false});
 if(!promos || promos.length === 0) {
 tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#999;">Tiada promo. Klik "+ Festival Templates" untuk add satu set.</td></tr>';
 return;
 }
 tbody.innerHTML = promos.map(p => {
 const today = new Date().toISOString().slice(0, 10);
 const isLive = p.active && (!p.start_date || p.start_date <= today) && (!p.end_date || p.end_date>= today);
 const valDisp = p.discount_type === 'percent' ? p.discount_value + '%' : (p.discount_type === 'fixed' ? 'RM' + parseFloat(p.discount_value).toFixed(2) : 'BOGO');
 const cond = [];
 if(p.scope && p.scope !== 'cart_total') cond.push(`${p.scope}=${p.scope_value||'-'}`);
 if(p.min_spend) cond.push(`min RM${p.min_spend}`);
 if(p.min_qty) cond.push(`${p.min_qty}+ items`);
 if(p.customer_tier) cond.push(`${p.customer_tier} tier`);
 const condStr = cond.length ? cond.join(' · ') : 'all carts';
 return `<tr>
 <td><strong>${p.code||'-'}</strong><br><span style="font-size:10px; color:#666;">${p.description||''}</span></td>
 <td>${p.discount_type||'-'}<br><span style="font-size:10px; color:#666;">${condStr}</span></td>
 <td style="font-weight:bold;">${valDisp}</td>
 <td>
 ${isLive ? '<span style="color:#10B981; font-weight:bold;"> Active</span>' : (p.active ? '<span style="color:#F59E0B;">⏰ Scheduled</span>' : '<span style="color:#9CA3AF;"> Inactive</span>')}
 <br><button onclick="window.togglePromoActive(${p.id}, ${!p.active})" class="btn-primary" style="font-size:10px; padding:2px 8px; margin-top:4px;">${p.active ? 'Disable' : 'Enable'}</button>
 </td>
 </tr>`;
 }).join('');
 } catch(e) {
 tbody.innerHTML = `<tr><td colspan="4" style="color:#DC2626;">Error: ${e.message}</td></tr>`;
 }
};

window.togglePromoActive = async function(id, newState) {
 try {
 await db.from('promotions').update({ active: newState }).eq('id', id);
 showToast(`Promo ${newState ? 'enabled' : 'disabled'}`, 'success');
 await loadPromotions();
 renderPromotionsV2();
 } catch(e) { showToast('Ralat: ' + e.message, 'error'); }
};

// Override the old renderPromotions
window.renderPromotions = window.renderPromotionsV2;

// =============================================================
// SPRINT C — CLOSE THE LOOP
// =============================================================

// ============= SC2 p4_5 EOD CLOSE / DAILY Z-REPORT =============
window.openEodClose = async function() {
 const today = new Date().toISOString().slice(0, 10);
 const todaySales = (salesHistory || []).filter(s => (s.created_at||'').slice(0, 10) === today);

 if(todaySales.length === 0) {
 return showToast('Tiada transaksi hari ini.', 'warn');
 }

 // Aggregate
 const positives = todaySales.filter(s => (s.total||0)> 0);
 const refunds = todaySales.filter(s => (s.total||0) < 0);
 const totalRev = positives.reduce((s, x) => s + (x.total||0), 0);
 const refundTotal = Math.abs(refunds.reduce((s, x) => s + (x.total||0), 0));
 const netRev = totalRev - refundTotal;

 const byPayment = {};
 positives.forEach(s => {
 const pm = s.payment_method || '(Unknown)';
 byPayment[pm] = (byPayment[pm] || 0) + (s.total||0);
 });
 const byChannel = {};
 positives.forEach(s => {
 const ch = s.channel || '(Unknown)';
 byChannel[ch] = (byChannel[ch] || 0) + (s.total||0);
 });
 const byStaff = {};
 positives.forEach(s => {
 const st = s.staff_name || '(Unassigned)';
 if(!byStaff[st]) byStaff[st] = { rev:0, orders:0 };
 byStaff[st].rev += (s.total||0);
 byStaff[st].orders++;
 });

 const detailsHtml = `
 <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; font-size:11px;">
 <div><strong>Tarikh:</strong> ${today}</div>
 <div><strong>Orders:</strong> ${positives.length} (+${refunds.length} refunds)</div>
 <div><strong>Net Revenue:</strong> RM ${netRev.toFixed(2)}</div>
 </div>
 `;

 const result = await requireManagerPin({
 title: 'End-of-Day Close',
 subtitle: `Lock ${today} sales — generate Z-report dan rekod ke finance_records.`,
 detailsHtml,
 reasons: ['Closing — normal day', 'Closing — high variance day', 'Closing — manual reconciliation needed', 'Lain-lain']
 });
 if(!result) return;

 // Build Z-report html for printing
 const settings = JSON.parse(localStorage.getItem('complianceSettings_v1') || '{}').shop || {};
 const shopName = settings.name || '10 CAMP STORE';
 const win = window.open('', '_blank', 'width=600,height=900');
 win.document.write(`<!DOCTYPE html><html><head><title>Z-Report ${today}</title>
 <style>
 body { font-family: monospace; padding:20px; max-width:580px; margin:auto; font-size:12px; }
 h1 { font-size:16px; text-align:center; margin:0 0 4px; }
 h2 { font-size:13px; margin:14px 0 4px; border-bottom:2px solid #111; padding-bottom:4px; }
.row { display:flex; justify-content:space-between; padding:2px 0; }
.total { font-weight:bold; border-top:2px solid #111; padding-top:4px; margin-top:6px; }
.meta { font-size:10px; color:#666; text-align:center; margin-bottom:14px; }
 @media print { @page { margin:1cm; } button { display:none; } }
 </style></head><body>
 <h1>${shopName}</h1>
 <p class="meta">Z-REPORT (DAILY CLOSE)</p>
 <p class="meta">${today} · Approved by ${result.manager.name}</p>

 <h2>Summary</h2>
 <div class="row"><span>Total Orders:</span><span>${positives.length}</span></div>
 <div class="row"><span>Refunds:</span><span>${refunds.length}</span></div>
 <div class="row"><span>Gross Revenue:</span><span>RM ${totalRev.toFixed(2)}</span></div>
 <div class="row"><span>Refund Total:</span><span>−RM ${refundTotal.toFixed(2)}</span></div>
 <div class="row total"><span>NET REVENUE:</span><span>RM ${netRev.toFixed(2)}</span></div>

 <h2>By Payment Method</h2>
 ${Object.entries(byPayment).map(([k, v]) => `<div class="row"><span>${k}</span><span>RM ${v.toFixed(2)}</span></div>`).join('')}

 <h2>By Channel</h2>
 ${Object.entries(byChannel).map(([k, v]) => `<div class="row"><span>${k}</span><span>RM ${v.toFixed(2)}</span></div>`).join('')}

 <h2>By Staff</h2>
 ${Object.entries(byStaff).map(([k, v]) => `<div class="row"><span>${k} (${v.orders})</span><span>RM ${v.rev.toFixed(2)}</span></div>`).join('')}

 <h2>Approval Reason</h2>
 <p style="font-size:11px;">${result.reason}${result.note ? ' — '+result.note : ''}</p>

 <p class="meta" style="margin-top:30px;">Generated by 10 CAMP POS · ${new Date().toLocaleString()}</p>
 <button onclick="window.print()" style="margin-top:20px; padding:8px 16px; background:#0EA5E9; color:#FFF; border:none; border-radius:4px; cursor:pointer;"> Print Z-Report</button>
 </body></html>`);
 win.document.close();

 // Persist to finance_records + audit_logs
 try {
 await db.from('finance_records').insert([{
 month: new Date().toLocaleString('en-MY', { month:'short' }),
 year: new Date().getFullYear(),
 category: 'EOD_CLOSE',
 amount: netRev,
 description: `Z-Report ${today} · ${positives.length} orders · approved by ${result.manager.name}`,
 metadata: { date: today, gross: totalRev, refunds: refundTotal, net: netRev, byPayment, byChannel, byStaff }
 }]);
 } catch(e) { /* finance_records may have different schema; non-blocking */ }

 try {
 await db.from('audit_logs').insert([{
 action_type: 'eod_close',
 actor_name: result.manager.name,
 target_staff: currentUser ? currentUser.name : null,
 details: JSON.stringify({ date:today, orders:positives.length, refunds:refunds.length, net:netRev, reason:result.reason, note:result.note }),
 created_at: new Date().toISOString()
 }]);
 } catch(_){}

 showToast(`Z-Report ${today} generated · approved by ${result.manager.name}`, 'success');
};

// ============= SC3 p8_1+p8_2 IN-APP VELOCITY ANALYSIS =============
window.openVelocityAnalysis = function() {
 if(typeof salesHistory === 'undefined' || !salesHistory.length) {
 return showToast('Tiada sales data. Run velocity selepas ada data.', 'warn');
 }

 // Compute velocity per SKU
 const now = Date.now();
 const window6mo = now - 180 * 24*60*60*1000;
 const skuStats = new Map();
 masterProducts.forEach(p => {
 skuStats.set(p.sku, {
 sku:p.sku, name:p.name, brand:p.brand,
 recent:0, lifetime:0, firstSale:null, lastSale:null,
 stock: 0,
 currentRP: p.reorder_point, currentRQ: p.reorder_qty,
 lead: p.lead_time_days || 14
 });
 });
 inventoryBatches.forEach(b => {
 const st = skuStats.get(b.sku);
 if(st) st.stock += (b.qty_remaining||0);
 });
 salesHistory.filter(s => (s.total||0)> 0).forEach(s => {
 const dt = s.created_at ? new Date(s.created_at).getTime() : 0;
 (s.items || []).forEach(it => {
 const sku = (it.sku||'').toUpperCase();
 const qty = parseFloat(it.qty) || 0;
 const st = skuStats.get(sku);
 if(!st || qty <= 0) return;
 st.lifetime += qty;
 if(dt>= window6mo) st.recent += qty;
 if(!st.firstSale || dt < new Date(st.firstSale).getTime()) st.firstSale = s.created_at;
 if(!st.lastSale || dt> new Date(st.lastSale).getTime()) st.lastSale = s.created_at;
 });
 });
 salesHistory.filter(s => (s.total||0) < 0).forEach(s => {
 (s.items || []).forEach(it => {
 const sku = (it.sku||'').toUpperCase();
 const st = skuStats.get(sku);
 if(st) st.lifetime = Math.max(0, st.lifetime - (parseFloat(it.qty)||0));
 });
 });

 // Compute recommendations
 const SAFETY_FACTOR = 1.5, COVER_MONTHS = 2.0, MIN_RP = 2;
 const recs = [];
 skuStats.forEach(st => {
 let avgMonthly = 0, window = 'no-sales';
 if(st.recent> 0) { avgMonthly = st.recent / 6; window = '6mo'; }
 else if(st.lifetime> 0 && st.firstSale && st.lastSale) {
 const months = Math.max(1, (new Date(st.lastSale) - new Date(st.firstSale)) / (1000*60*60*24*30));
 avgMonthly = st.lifetime / months; window = `lifetime(${Math.round(months)}mo)`;
 }
 let newRP = avgMonthly === 0 ? MIN_RP : Math.max(MIN_RP, Math.ceil(avgMonthly/30 * st.lead * SAFETY_FACTOR));
 let newRQ = avgMonthly === 0 ? 5 : Math.max(MIN_RP, Math.ceil(avgMonthly * COVER_MONTHS));
 const isStale = st.lastSale && (now - new Date(st.lastSale).getTime())> 180*24*60*60*1000 && st.lifetime> 0;
 if(isStale) { newRP = MIN_RP; newRQ = 5; }
 recs.push({...st, avgMonthly, window, newRP, newRQ, isStale, urgent: st.recent> 0 && st.stock < newRP });
 });

 // Stats
 const totalUpdate = recs.length;
 const moving = recs.filter(r => r.recent> 0).length;
 const stale = recs.filter(r => r.isStale).length;
 const urgent = recs.filter(r => r.urgent).length;
 const recsSorted = recs.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || b.recent - a.recent);

 const html = `
 <div id="velocityOverlay" class="login-overlay" style="display:flex; z-index:3700;">
 <div class="login-box" style="max-width:880px; width:96%; padding:24px;">
 <button onclick="document.getElementById('velocityOverlay').remove()" style="float:right; border:none; background:none; font-size:24px; cursor:pointer; color:var(--text-muted);">×</button>
 <h2 style="margin:0 0 8px;"> Velocity Analysis (in-app)</h2>
 <p style="font-size:12px; color:#666; margin-bottom:14px;">Auto-suggest reorder_point + reorder_qty based on real sales velocity. Window: 6 months recent, fallback to lifetime.</p>

 <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; margin-bottom:14px;">
 <div style="background:#EFF6FF; padding:10px; border-radius:6px; text-align:center;"><div style="font-size:10px; color:#1E40AF;">Total SKU</div><div style="font-size:18px; font-weight:bold;">${totalUpdate}</div></div>
 <div style="background:#F0FDF4; padding:10px; border-radius:6px; text-align:center;"><div style="font-size:10px; color:#166534;">Active (6mo)</div><div style="font-size:18px; font-weight:bold;">${moving}</div></div>
 <div style="background:#FEF3C7; padding:10px; border-radius:6px; text-align:center;"><div style="font-size:10px; color:#92400E;">Stale (180d+)</div><div style="font-size:18px; font-weight:bold;">${stale}</div></div>
 <div style="background:#FEE2E2; padding:10px; border-radius:6px; text-align:center;"><div style="font-size:10px; color:#991B1B;"> Urgent (under-stocked)</div><div style="font-size:18px; font-weight:bold;">${urgent}</div></div>
 </div>

 <div style="max-height:380px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px; margin-bottom:14px;">
 <table class="data-table" style="font-size:11px;"><thead style="position:sticky; top:0; background:#FAFAFA;"><tr><th>SKU</th><th>Brand</th><th style="text-align:right;">6mo Qty</th><th style="text-align:right;">Avg/mo</th><th style="text-align:right;">Cur RP</th><th style="text-align:right;">New RP</th><th style="text-align:right;">New RQ</th><th style="text-align:right;">Stock</th></tr></thead><tbody>
 ${recsSorted.slice(0, 100).map(r => `
 <tr style="${r.urgent ? 'background:#FEF2F2;' : (r.isStale ? 'color:#9CA3AF;' : '')}">
 <td><strong>${r.sku}</strong>${r.urgent ? ' ' : ''}${r.isStale ? ' ' : ''}</td>
 <td>${(r.brand||'-').slice(0, 14)}</td>
 <td style="text-align:right;">${r.recent.toFixed(0)}</td>
 <td style="text-align:right;">${r.avgMonthly.toFixed(1)}</td>
 <td style="text-align:right; color:#666;">${r.currentRP||'-'}</td>
 <td style="text-align:right; font-weight:bold;">${r.newRP}</td>
 <td style="text-align:right;">${r.newRQ}</td>
 <td style="text-align:right; color:${r.stock===0?'#DC2626':'#111'};">${r.stock}</td>
 </tr>
 `).join('')}
 ${recsSorted.length> 100 ? `<tr><td colspan="8" style="text-align:center; color:#666;">+ ${recsSorted.length - 100} lagi (akan diupdate juga)</td></tr>` : ''}
 </tbody></table>
 </div>

 <div style="background:#FEF3C7; padding:10px; border-radius:6px; margin-bottom:14px; font-size:11px; color:#92400E;">
 Klik "Apply" untuk update reorder_point + reorder_qty pada ${totalUpdate} produk. Boleh re-run anytime, akan recompute dari latest sales data.
 </div>

 <div style="display:flex; gap:8px;">
 <button onclick="document.getElementById('velocityOverlay').remove()" class="login-btn" style="background:#6B7280; flex:1;">Tutup</button>
 <button onclick="window.applyVelocityRecs()" class="login-btn" style="flex:2;"> Apply ke ${totalUpdate} Produk</button>
 </div>
 </div>
 </div>
 `;
 document.body.insertAdjacentHTML('beforeend', html);
 window.__pendingVelocityRecs = recsSorted;
};

window.applyVelocityRecs = async function() {
 const recs = window.__pendingVelocityRecs || [];
 if(recs.length === 0) return;
 if(!confirm(`Apply velocity recommendations ke ${recs.length} produk?`)) return;

 let ok = 0, fail = 0;
 const chunk = 50;
 for(let i = 0; i < recs.length; i += chunk) {
 const slice = recs.slice(i, i + chunk);
 await Promise.all(slice.map(async r => {
 try {
 await db.from('products_master').update({
 reorder_point: r.newRP,
 reorder_qty: r.newRQ,
 lead_time_days: r.lead
 }).eq('sku', r.sku);
 const p = masterProducts.find(x => x.sku === r.sku);
 if(p) { p.reorder_point = r.newRP; p.reorder_qty = r.newRQ; p.lead_time_days = r.lead; }
 ok++;
 } catch(e) { fail++; }
 }));
 }

 try {
 await db.from('audit_logs').insert([{
 action_type: 'velocity_reorder_applied',
 actor_name: currentUser ? currentUser.name : 'System',
 details: JSON.stringify({ updated:ok, failed:fail, total:recs.length }),
 created_at: new Date().toISOString()
 }]);
 } catch(_){}

 showToast(`Velocity update: ${ok} berjaya, ${fail} gagal`, fail ? 'warn' : 'success');
 document.getElementById('velocityOverlay').remove();
};

// =============================================================
// SPRINT UX-2 — MODE BAR + CTRL+K + BREADCRUMBS
// =============================================================

// ============= UX-2.3 BREADCRUMBS =============
window.updateBreadcrumb = function(sectionTitle) {
 const el = document.getElementById('bcCurrent');
 if(!el) return;
 const mode = (localStorage.getItem('uxMode_v1') || 'cashier');
 const modeLabel = { cashier:'Cashier', operations:'Operations', manager:'Manager', management:'Management' }[mode] || 'Manager';
 const wrapper = document.getElementById('headerBreadcrumb');
 if(wrapper) {
 wrapper.innerHTML = `
 <span class="breadcrumb__item">${modeLabel}</span>
 <span class="breadcrumb__separator">›</span>
 <span class="breadcrumb__item breadcrumb__item--current" id="bcCurrent">${sectionTitle || 'Overview'}</span>
 `;
 }
};

// ============= PER-MODE ACCESS — granular per-staff overlay (p1_20) =============
// Replaces single management-only checkbox (p1_18) with 4 separate per-mode checkboxes.
// Superior auto-true (locked); others toggled via Staff Mgmt UI → staffModeAccess_v1
// p1_37: 'hq' added — control centre mode (HR + Finance + Setup + Investor entry).
// 'management' kept as legacy alias gate for hq access (back-compat).
window.MODE_LIST = ['cashier','operations','manager','management','hq','investor'];

// One-time migration: convert staffMgmtAccess_v1 (p1_18) → staffModeAccess_v1 (p1_20)
(function __migrateModeAccess(){
 const SENTINEL = 'staffModeAccess_migrated_v1';
 if(localStorage.getItem(SENTINEL)) return;
 try {
 const old = JSON.parse(localStorage.getItem('staffMgmtAccess_v1') || '{}');
 const next = JSON.parse(localStorage.getItem('staffModeAccess_v1') || '{}');
 Object.keys(old).forEach(staffId => {
 if(old[staffId] === true && !next[staffId]) {
 // Preserve management access; leave other modes as null (fall back to role caps)
 next[staffId] = { management: true };
 }
 });
 localStorage.setItem('staffModeAccess_v1', JSON.stringify(next));
 localStorage.setItem(SENTINEL, '1');
 } catch(e) { console.warn('staffModeAccess migration failed:', e); }
})();

// Returns {cashier, operations, manager, management} for a given user.
// Superior → all true. Others: read overlay; missing key → fallback to ROLE_CAPS.modes
window.getModesAccess = function(user) {
 user = user || window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null);
 const out = { cashier:false, operations:false, manager:false, management:false, hq:false, investor:false };
 if(!user) return out;
 if(user.role === 'superior') return { cashier:true, operations:true, manager:true, management:true, hq:true, investor:true };
 let overlay = {};
 try { overlay = (JSON.parse(localStorage.getItem('staffModeAccess_v1')||'{}')[user.staff_id]) || {}; } catch(e){}
 // Role-based defaults (back-compat for staff with no overlay entry)
 const cap = (typeof ROLE_CAPS !== 'undefined' && ROLE_CAPS[user.role]) ? ROLE_CAPS[user.role] : { modes: ['cashier'] };
 window.MODE_LIST.forEach(m => {
 if(overlay[m] !== undefined) out[m] = !!overlay[m];
 else out[m] = cap.modes.includes(m); // fallback
 });
 // p1_37: 'hq' is the new control-centre mode. Back-compat: any user with the
 // legacy 'management' flag (from p1_18/p1_20 era) inherits hq access automatically.
 if (overlay.hq === undefined && out.management) out.hq = true;
 return out;
};

// Default landing mode picker (p1_32 — Pengurusan merged into Pengurus).
// Rule: Cashier is universal entry point. Investor-only persona → Investor.
// Bos (Superior) → Manager mode (now includes HR + Finance), lands on Finance Dashboard.
// Everyone else → Cashier.
window.pickDefaultMode = function(user) {
 user = user || window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null);
 const access = window.getModesAccess(user);
 const onlyInvestor = access.investor && !access.cashier && !access.operations && !access.manager && !access.hq;
 if(onlyInvestor) return 'investor';
 // p1_37: Bos (and any user with hq access) lands on HQ → Finance Dashboard.
 if(user && user.role === 'superior') return 'hq';
 if(access.cashier) return 'cashier';
 // Fallbacks for users without cashier access
 if(access.hq) return 'hq';
 if(access.manager) return 'manager';
 if(access.operations) return 'operations';
 if(access.investor) return 'investor';
 return 'cashier';
};

// Back-compat shim — old code may still call hasManagementAccess()
window.hasManagementAccess = function(user) {
 return window.getModesAccess(user).management;
};

// Refresh ALL mode tabs visibility based on per-staff access overlay.
// Overrides applyRoleCapabilities() since access is per-staff, not just per-role.
// p1_32: 'management' tab hidden permanently — merged into 'manager'.
window.refreshAllModeTabsVisibility = function() {
 const access = window.getModesAccess();
 document.querySelectorAll('.mode-tab[data-mode-set]').forEach(tab => {
 const m = tab.dataset.modeSet;
 if(m === 'management') { tab.style.display = 'none'; tab.disabled = true; return; }
 const allowed = !!access[m];
 tab.style.display = allowed ? '' : 'none';
 tab.disabled = !allowed;
 });
};
// Back-compat alias
window.refreshManagementTabVisibility = window.refreshAllModeTabsVisibility;

// ============= UX-2.1 MODE BAR =============
window.setMode = function(mode) {
 if(!['cashier','operations','manager','management','hq','investor'].includes(mode)) return;
 // p1_32: Pengurusan merged into Pengurus — redirect any 'management' calls
 if(mode === 'management') mode = 'manager';
 // Guard: every mode now checked against per-staff access overlay (p1_20)
 const access = (typeof window.getModesAccess === 'function') ? window.getModesAccess() : null;
 if(access && !access[mode]) {
 const labels = { cashier:'Kaunter', operations:'Operasi', manager:'Pengurus', management:'Pengurusan', hq:'HQ', investor:'Investor' };
 if(typeof showToast === 'function') showToast('Tiada akses ke ' + (labels[mode]||mode) + ' mode', 'warn');
 return;
 }
 localStorage.setItem('uxMode_v1', mode);

 // Update tabs UI
 document.querySelectorAll('.mode-tab').forEach(t => {
 const isActive = t.dataset.modeSet === mode;
 t.classList.toggle('is-active', isActive);
 t.setAttribute('aria-selected', isActive ? 'true' : 'false');
 });

 // p1_45: Superior (Bos) gets full sidebar bypass — sees every item regardless of active mode.
 // Mode bar still triggers landing-page redirects for context, but nothing is hidden.
 const __u = window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null);
 const __isSuperior = !!(__u && __u.role === 'superior');

 // Filter sidebar items via mode-hidden class (additive — respects existing role classes)
 const items = document.querySelectorAll('#appSidebar .menu-item');
 items.forEach(it => {
 const isSales = it.classList.contains('sales-only');
 const isInv = it.classList.contains('inv-only');
 const isMgmtOnly = it.classList.contains('mgmt-only');
 const isHq = it.classList.contains('hq-only'); // p1_37: HR + Finance + Setup live in HQ mode
 const isInvestor = it.classList.contains('investor-only');
 const dataGroup = it.getAttribute('data-group');
 const groupToggle = it.getAttribute('data-group-toggle');
 const dataTab = it.getAttribute('data-tab');
 // Roadmap button + Memo Board — keep visible in all modes (p1_19)
 if(it.id === 'sidebarRoadmapBtn' || dataTab === 'memo_board') { it.classList.remove('mode-hidden'); return; }
 // p1_45: Superior bypass — Bos always sees everything, mode-class hiding skipped entirely
 if(__isSuperior) { it.classList.remove('mode-hidden'); return; }

 let show = false;
 if(mode === 'cashier') {
 show = isSales || (groupToggle === 'sales');
 } else if(mode === 'operations') {
 show = isInv || (groupToggle === 'inv');
 } else if(mode === 'investor') {
 show = isInvestor; // Investor dashboard only — locked-down view
 } else if(mode === 'hq') {
 // p1_37: control centre — only HQ items (HR + Finance + Setup groups)
 show = isHq;
 } else { // manager — wide view: Sales + Inventory + Customers + Admin (everything except HQ + Investor)
 if(isHq || isInvestor) show = false;
 else show = true;
 }
 it.classList.toggle('mode-hidden', !show);
 });

 // p1_42: per-tab override layer. Even if mode says show, an explicit deny in
 // staffSidebarAccess_v1 forces the item hidden. Skipped for superior (full access).
 if (__u && !__isSuperior && window.sidebarAccess) {
 document.querySelectorAll('#appSidebar .menu-item[data-tab]').forEach(it => {
 const tabId = it.getAttribute('data-tab');
 const overridden = window.sidebarAccess.isAllowed(__u.staff_id, tabId);
 if (overridden === false) it.classList.add('mode-hidden');
 // overridden === true is a no-op here — mode rules already decided visibility,
 // explicit grant doesn't bypass mode-level deny.
 });
 }

 // Auto-expand relevant group + redirect to first item if current section not in mode
 const groups = {
 cashier: 'sales',
 operations: 'inv',
 manager: 'admin',
 management: 'admin', // p1_32: management merged into manager
 hq: 'hr' // p1_37: HQ opens HR; finance + hq_setup auto-expanded below
 };
 // Auto-expand the group for current mode (legacy applySidebarGroupState takes name+collapsed)
 if(groups[mode] && typeof window.applySidebarGroupState === 'function') {
 try { window.applySidebarGroupState(groups[mode], false); } catch(e){}
 // HQ mode opens all three executive groups
 if(mode === 'hq') {
 try { window.applySidebarGroupState('finance', false); } catch(e){}
 try { window.applySidebarGroupState('hq_setup', false); } catch(e){}
 }
 }

 // Auto-jump to logical home for that mode.
 // p1_18 fix: also jump if currently-active section's sidebar item is now mode-hidden
 // (else user sees stale section content while sidebar shows other items).
 const activeMenu = document.querySelector('#appSidebar .menu-item.active');
 const activeHidden = activeMenu && activeMenu.classList.contains('mode-hidden');
 const shouldJump = (window.__modeJumping === false || window.__modeJumping === undefined) || activeHidden;
 if(shouldJump) {
 if(mode === 'cashier') {
 const cashierBtn = document.querySelector('[data-tab="sales_cashier"]');
 if(cashierBtn) cashierBtn.click();
 } else if(mode === 'operations') {
 const inv = document.querySelector('[data-tab="inv_database"]');
 if(inv) inv.click();
 } else if(mode === 'hq' || mode === 'management') {
 // p1_37: HQ lands on Finance Dashboard (preserves Bos's prior Pengurusan landing)
 const fin = document.querySelector('[data-tab="finance_main"]');
 if(fin) fin.click();
 } else if(mode === 'investor') {
 const inv = document.querySelector('[data-tab="investor_overview"]');
 if(inv) inv.click();
 } else {
 const dash = document.querySelector('[data-tab="admin_dashboard"]');
 if(dash) dash.click();
 }
 }

 if(typeof updateBreadcrumb === 'function') {
 const cur = document.getElementById('bcCurrent');
 const t = cur ? cur.textContent : 'Overview';
 updateBreadcrumb(t);
 }
};

// Apply persisted mode at boot — without auto-jumping (so user's last section restores).
// Pre-login (no currentUser): skip entirely — there's no session to restore and
// access checks would fire spurious "Tiada akses" warnings into the notification center.
window.__initMode = function() {
 const u = window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null);
 if (!u) return;
 let saved = localStorage.getItem('uxMode_v1');
 // p1_32: any saved 'management' → migrate to 'manager'
 if(saved === 'management') { saved = 'manager'; localStorage.setItem('uxMode_v1', saved); }
 const MIGRATION_KEY = 'uxMode_p1_18_migrated';
 // One-time migration: pick highest-tier accessible mode for existing users
 if(!localStorage.getItem(MIGRATION_KEY)) {
 if(typeof window.pickDefaultMode === 'function') saved = window.pickDefaultMode();
 localStorage.setItem(MIGRATION_KEY, '1');
 }
 // p1_37 migration: HQ mode is new. Users who had hq access (via legacy management flag)
 // and were sitting on 'manager' should land on 'hq' once so they discover where HR+Finance went.
 const MIGRATION_KEY_37 = 'uxMode_p1_37_migrated';
 if (!localStorage.getItem(MIGRATION_KEY_37)) {
 try {
 const access37 = (typeof window.getModesAccess === 'function') ? window.getModesAccess() : null;
 if (access37 && access37.hq && (saved === 'manager' || !saved)) saved = 'hq';
 } catch(e) {}
 localStorage.setItem(MIGRATION_KEY_37, '1');
 }
 // First-time login → highest accessible mode
 if(!saved && typeof window.pickDefaultMode === 'function') saved = window.pickDefaultMode();
 if(!saved) saved = 'cashier';
 // Defensive: if saved mode no longer accessible, fall back to highest accessible
 const access = (typeof window.getModesAccess === 'function') ? window.getModesAccess() : null;
 if(access && !access[saved] && typeof window.pickDefaultMode === 'function') {
 saved = window.pickDefaultMode();
 }
 window.__modeJumping = true; // prevent auto-jump on initial restore
 setMode(saved);
 window.__modeJumping = false;
};

// ============= UX-2.2 COMMAND PALETTE (Ctrl+K) =============
const CMDK_INDEX = []; // built lazily

function buildCmdkIndex() {
 if(CMDK_INDEX.length> 0) return;
 // p1_42: respect per-tab access overlay so Cmd+K palette doesn't expose denied items
 const __u = window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null);
 const __overlay = (__u && __u.role !== 'superior' && window.sidebarAccess)
 ? window.sidebarAccess.forStaff(__u.staff_id) : {};
 document.querySelectorAll('#appSidebar .menu-item[data-tab]').forEach(item => {
 const tabId = item.getAttribute('data-tab');
 if (__overlay[tabId] === false) return; // denied — skip from palette
 const label = item.textContent.trim().replace(/\s+/g, ' ').slice(0, 80);
 const onclickStr = item.getAttribute('onclick');
 const groupCls = (item.classList.contains('sales-only') ? 'Sales' :
 item.classList.contains('inv-only') ? 'Inventory' :
 item.dataset.group === 'admin' ? 'HR & Admin' : 'General');
 CMDK_INDEX.push({
 type: 'section',
 label,
 subtitle: groupCls,
 icon: 'arrow-right',
 action: () => item.click()
 });
 });
 // Common actions
 const actions = [
 { label:'Open Customer Display (2nd screen)', subtitle:'Action · Cashier', icon:'monitor', action:() => window.openCustomerDisplay && openCustomerDisplay() },
 { label:'Run EOD Close (Z-Report)', subtitle:'Action · Manager', icon:'lock', action:() => window.openEodClose && openEodClose() },
 { label:'Run Velocity Analysis', subtitle:'Action · Inventory', icon:'trending-up', action:() => window.openVelocityAnalysis && openVelocityAnalysis() },
 { label:'Open Festival Templates', subtitle:'Action · Promotions', icon:'gift', action:() => window.openFestivalTemplates && openFestivalTemplates() },
 { label:'Switch to Cashier Mode', subtitle:'Mode', icon:'shopping-cart', action:() => setMode('cashier') },
 { label:'Switch to Operations Mode', subtitle:'Mode', icon:'package', action:() => setMode('operations') },
 { label:'Switch to Manager Mode', subtitle:'Mode', icon:'layout-dashboard', action:() => setMode('manager') },
];
 CMDK_INDEX.push(...actions.map(a => ({...a, type:'action' })));
}

let __cmdkCursor = 0;

window.openCmdK = function() {
 buildCmdkIndex();
 const overlay = document.getElementById('cmdkOverlay');
 const input = document.getElementById('cmdkInput');
 if(!overlay || !input) return;
 overlay.classList.add('is-open');
 input.value = '';
 __cmdkCursor = 0;
 renderCmdkResults('');
 setTimeout(() => input.focus(), 50);
};

window.closeCmdK = function() {
 const overlay = document.getElementById('cmdkOverlay');
 if(overlay) overlay.classList.remove('is-open');
};

function renderCmdkResults(query) {
 const list = document.getElementById('cmdkList');
 if(!list) return;
 const q = (query || '').trim().toLowerCase();
 let results = CMDK_INDEX;
 if(q) {
 results = CMDK_INDEX.filter(it => {
 const hay = (it.label + ' ' + (it.subtitle||'')).toLowerCase();
 return q.split(/\s+/).every(token => hay.includes(token));
 });
 }
 // Add dynamic results: customers + products if query is meaningful
 if(q && q.length>= 2) {
 // Customers — search top 5
 if(typeof customersData !== 'undefined') {
 const custMatches = customersData.filter(c =>
 (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q)
).slice(0, 5);
 custMatches.forEach(c => {
 results.push({
 type:'customer',
 label: c.name + (c.phone ? ` · ${c.phone}` : ''),
 subtitle: `Customer · ${c.total_orders||0} orders · RM${(c.total_spent||0).toFixed(0)}`,
 icon: 'user',
 action: () => {
 const btn = document.querySelector('[data-tab="sales_crm"]');
 if(btn) btn.click();
 setTimeout(() => {
 const s = document.getElementById('crmSearch');
 if(s) { s.value = c.name; s.dispatchEvent(new Event('input')); }
 }, 200);
 }
 });
 });
 }
 // Products — search top 5
 if(typeof masterProducts !== 'undefined') {
 const prodMatches = masterProducts.filter(p =>
 (p.sku||'').toLowerCase().includes(q) || (p.name||'').toLowerCase().includes(q) || (p.brand||'').toLowerCase().includes(q)
).slice(0, 5);
 prodMatches.forEach(p => {
 results.push({
 type:'product',
 label: `[${p.sku}] ${p.name||''}`.slice(0, 80),
 subtitle: `Product · ${p.brand||'-'} · RM${(p.price||0).toFixed(2)}`,
 icon: 'package',
 action: () => {
 const btn = document.querySelector('[data-tab="inv_database"]');
 if(btn) btn.click();
 }
 });
 });
 }
 }

 if(results.length === 0) {
 list.innerHTML = '<div class="cmdk-empty">Nothing matches "' + q + '". Try section names like "dashboard" or actions like "EOD".</div>';
 return;
 }
 if(__cmdkCursor>= results.length) __cmdkCursor = 0;
 if(__cmdkCursor < 0) __cmdkCursor = results.length - 1;
 list.innerHTML = results.slice(0, 30).map((r, i) => `
 <div class="cmdk-item ${i === __cmdkCursor ? 'is-active' : ''}" data-idx="${i}" onmouseenter="window.__cmdkSetCursor(${i})" onclick="window.__cmdkSelect(${i})">
 <div class="cmdk-item__icon"><i data-lucide="${r.icon||'arrow-right'}" style="width:14px; height:14px;"></i></div>
 <div class="cmdk-item__main">
 <div class="cmdk-item__title">${r.label}</div>
 <div class="cmdk-item__subtitle">${r.subtitle||''}</div>
 </div>
 ${r.type === 'action' ? '<span class="cmdk-item__shortcut">action</span>' : ''}
 </div>
 `).join('');
 if(typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
 window.__cmdkResults = results;
}

window.__cmdkSetCursor = function(i) {
 __cmdkCursor = i;
 document.querySelectorAll('#cmdkList.cmdk-item').forEach((el, idx) => el.classList.toggle('is-active', idx === i));
};

window.__cmdkSelect = function(i) {
 const r = (window.__cmdkResults || [])[i];
 if(!r || !r.action) return;
 closeCmdK();
 setTimeout(r.action, 50);
};

document.addEventListener('keydown', function(e) {
 // Open palette
 if((e.metaKey || e.ctrlKey) && e.key === 'k') {
 e.preventDefault();
 openCmdK();
 return;
 }
 // While palette open
 const overlay = document.getElementById('cmdkOverlay');
 if(!overlay || !overlay.classList.contains('is-open')) return;

 if(e.key === 'Escape') { closeCmdK(); return; }
 if(e.key === 'ArrowDown') { e.preventDefault(); __cmdkCursor++; renderCmdkResults(document.getElementById('cmdkInput').value); return; }
 if(e.key === 'ArrowUp') { e.preventDefault(); __cmdkCursor--; renderCmdkResults(document.getElementById('cmdkInput').value); return; }
 if(e.key === 'Enter') { e.preventDefault(); __cmdkSelect(__cmdkCursor); return; }
});

// Re-render on input typing
document.addEventListener('DOMContentLoaded', () => {
 const input = document.getElementById('cmdkInput');
 if(input) input.addEventListener('input', e => { __cmdkCursor = 0; renderCmdkResults(e.target.value); });
 // Apply persisted mode at boot — defer so sidebar items rendered
 setTimeout(() => { if(typeof __initMode === 'function') __initMode(); }, 300);
});

// =============================================================
// SPRINT UX-3 — CHECKOUT SIDE PANEL (replaces modal flow)
// =============================================================

let __cpLastSale = null; // last successful sale info — for receipt/WA/email
let __cpAcCursor = 0;
let __cpAcResults = [];

window.openCheckoutPanel = function() {
 if(typeof cart === 'undefined' || cart.length === 0) {
 return showToast('Cart kosong.', 'warn');
 }
 // Hide success view, show form view
 document.getElementById('cpFormView').classList.remove('is-hidden');
 document.getElementById('cpSuccessView').classList.add('is-hidden');
 document.getElementById('cpFooter').classList.remove('is-hidden');

 // Reset VIP state
 window.__currentCheckoutVip = null;
 const banner = document.getElementById('cpVipBanner');
 if(banner) { banner.classList.remove('is-shown'); banner.innerHTML = ''; }
 document.getElementById('cpDiscountLine').style.display = 'none';

 // Reset form
 ['cpCustName','cpCustPhone','cpCustEmail','cpBuyerTin','cpEwalletRef'].forEach(id => {
 const el = document.getElementById(id); if(el) el.value = '';
 });
 document.getElementById('cpChannel').value = 'In-Store';
 document.getElementById('cpStatus').value = 'Completed';
 cpSetPayment('Cash');

 // Compute & show total
 cpRecomputeTotal();

 // Open
 document.getElementById('checkoutPanelOverlay').classList.add('is-open');
 const panel = document.getElementById('checkoutPanel');
 panel.classList.add('is-open');
 panel.setAttribute('aria-hidden', 'false');

 // Populate e-wallet dropdown if applicable
 cpPopulateEwallets();

 // Focus customer name
 setTimeout(() => document.getElementById('cpCustName').focus(), 320);
 if(typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeCheckoutPanel = function() {
 document.getElementById('checkoutPanelOverlay').classList.remove('is-open');
 const panel = document.getElementById('checkoutPanel');
 panel.classList.remove('is-open');
 panel.setAttribute('aria-hidden', 'true');
};

window.cpSetPayment = function(method) {
 document.getElementById('cpPaymentMethod').value = method;
 document.querySelectorAll('#cpPayPills.cp-pay-pill').forEach(b => {
 b.classList.toggle('is-active', b.dataset.method === method);
 });
 const ewl = document.getElementById('cpEwalletInline');
 if(method === 'E-Wallet') {
 ewl.classList.remove('is-hidden');
 cpPopulateEwallets();
 } else {
 ewl.classList.add('is-hidden');
 }
};

window.cpPopulateEwallets = function() {
 const sel = document.getElementById('cpEwalletProvider');
 const empty = document.getElementById('cpEwalletEmptyMsg');
 if(!sel) return;
 let s = {};
 try { s = JSON.parse(localStorage.getItem('complianceSettings_v1') || '{}'); } catch(e){}
 const wallets = s.ewallets || {};
 const enabled = Object.entries(wallets).filter(([_, v]) => v && v.enabled);
 sel.innerHTML = '<option value="">— Pilih e-wallet —</option>' +
 enabled.map(([k, _]) => `<option value="${k}">${k}</option>`).join('');
 if(empty) empty.classList.toggle('is-hidden', enabled.length> 0);
};

window.cpRecomputeTotal = function() {
 let raw = 0;
 (typeof cart !== 'undefined' ? cart : []).forEach(it => {
 raw += (it.quantity || it.qty || 1) * (parseFloat(it.price) || 0);
 });
 raw = round2(raw);
 let final = raw;
 let discount = 0;
 if(window.__currentCheckoutVip && window.__currentCheckoutVip.discount_pct) {
 discount = round2(raw * window.__currentCheckoutVip.discount_pct / 100);
 final = round2(raw - discount);
 }
 document.getElementById('cpTotalDisplay').textContent = final.toFixed(2);
 document.getElementById('cpConfirmAmount').textContent = final.toFixed(2);
 const discLine = document.getElementById('cpDiscountLine');
 if(discount> 0 && window.__currentCheckoutVip) {
 discLine.style.display = 'block';
 discLine.innerHTML = `${window.__currentCheckoutVip.tier} discount −RM ${discount.toFixed(2)} (subtotal RM ${raw.toFixed(2)})`;
 } else {
 discLine.style.display = 'none';
 }
 // Also keep legacy modal display in sync (in case modal opened too)
 const legacy = document.getElementById('paymentTotalDisplay');
 if(legacy) legacy.textContent = final.toFixed(2);
};

// p1_33 — Walk-in quick toggle: skip customer info for fast counter sales
window.cpToggleWalkin = function() {
    const btn = document.getElementById('cpWalkinBtn');
    const lbl = document.getElementById('cpWalkinBtnLabel');
    const section = btn ? btn.closest('.cp-section') : null;
    const fields = ['cpCustName', 'cpCustPhone', 'cpCustEmail', 'cpBuyerTin'].map(id => document.getElementById(id));
    const isActive = btn.classList.toggle('is-active');
    if(isActive) {
        // Activate: fill Walk-in, clear others, lock fields
        if(fields[0]) fields[0].value = 'Walk-in';
        for(let i = 1; i < fields.length; i++) if(fields[i]) fields[i].value = '';
        fields.forEach(f => f && (f.readOnly = true));
        if(section) section.classList.add('is-walkin');
        if(lbl) lbl.textContent = 'Walk-in ✓';
        if(btn) btn.title = 'Klik untuk tukar ke registered customer';
        // Clear VIP banner if any
        const vipBanner = document.getElementById('cpVipBanner');
        if(vipBanner) { vipBanner.style.display = 'none'; vipBanner.innerHTML = ''; }
    } else {
        // Deactivate: unlock fields, clear name back to placeholder
        if(fields[0] && fields[0].value === 'Walk-in') fields[0].value = '';
        fields.forEach(f => f && (f.readOnly = false));
        if(section) section.classList.remove('is-walkin');
        if(lbl) lbl.textContent = 'Walk-in';
        if(btn) btn.title = 'Skip customer info untuk walk-in cepat';
        if(fields[0]) fields[0].focus();
    }
};

// VIP lookup integrated with new panel
window.cpVipLookup = function() {
 const name = (document.getElementById('cpCustName').value || '').trim().toLowerCase();
 const phoneRaw = (document.getElementById('cpCustPhone').value || '').trim();
 const phone = (typeof normalisePhoneForMatch === 'function') ? normalisePhoneForMatch(phoneRaw) : phoneRaw;

 let match = null;
 if(typeof customersData !== 'undefined') {
 if(phone) match = customersData.find(c => c.phone === phone);
 if(!match && name && name.length>= 3) match = customersData.find(c => (c.name || '').toLowerCase() === name);
 }

 window.__currentCheckoutVip = null;
 const banner = document.getElementById('cpVipBanner');
 if(!match) { banner.classList.remove('is-shown'); banner.innerHTML = ''; cpRecomputeTotal(); return; }

 const tier = (typeof getCustomerTier === 'function') ? getCustomerTier(match) : null;
 if(tier) {
 const pct = (typeof getTierDiscount === 'function') ? getTierDiscount(tier) : 0;
 window.__currentCheckoutVip = {
 customer_id: match.id, customer_name: match.name, customer_phone: match.phone,
 tier, discount_pct: pct,
 total_orders: match.total_orders || 0, total_spent: match.total_spent || 0
 };
 const tierClass = tier.toLowerCase();
 banner.className = `cp-vip-banner is-shown cp-vip-banner--${tierClass}`;
 const emoji = (typeof getTierColor === 'function') ? getTierColor(tier).emoji : '⭐';
 banner.innerHTML = `${emoji} <strong>${tier} TIER</strong> · ${match.name} · ${match.total_orders} orders · RM${(match.total_spent||0).toFixed(0)} spent → auto-discount <strong>${pct}% applied</strong>`;
 // auto-fill email if empty
 if(match.email && !document.getElementById('cpCustEmail').value) {
 document.getElementById('cpCustEmail').value = match.email;
 }
 if(match.phone && !document.getElementById('cpCustPhone').value) {
 document.getElementById('cpCustPhone').value = match.phone;
 }
 } else {
 const orders = match.total_orders || 0;
 const need = Math.max(0, 3 - orders);
 banner.className = 'cp-vip-banner is-shown cp-vip-banner--info';
 banner.innerHTML = ` ${match.name} · ${orders} order${orders===1?'':'s'} ${need> 0 ? '· '+need+' more order to unlock Bronze' : '· qualifies next checkout'}`;
 if(match.phone && !document.getElementById('cpCustPhone').value) {
 document.getElementById('cpCustPhone').value = match.phone;
 }
 if(match.email && !document.getElementById('cpCustEmail').value) {
 document.getElementById('cpCustEmail').value = match.email;
 }
 }
 cpRecomputeTotal();
};

// Customer autocomplete (UX-3.2)
window.cpCustAutocomplete = function() {
 const q = (document.getElementById('cpCustName').value || '').trim().toLowerCase();
 const dd = document.getElementById('cpCustAcDropdown');
 if(typeof customersData === 'undefined' || customersData.length === 0) { dd.classList.remove('is-open'); return; }

 let results;
 if(!q) {
 // Show top spenders when input empty
 results = [...customersData].sort((a,b) => (b.total_spent||0) - (a.total_spent||0)).slice(0, 8);
 } else {
 results = customersData.filter(c => {
 const hay = `${c.name||''} ${c.phone||''} ${c.email||''}`.toLowerCase();
 return hay.includes(q);
 }).slice(0, 8);
 }
 __cpAcResults = results;
 __cpAcCursor = 0;

 if(results.length === 0) {
 dd.innerHTML = '<div class="cp-autocomplete-item" style="cursor:default; color:var(--neutral-500); font-size:12px;">Tiada match — taip nama untuk customer baru</div>';
 dd.classList.add('is-open');
 return;
 }
 dd.innerHTML = results.map((c, i) => {
 const tier = (typeof getCustomerTier === 'function') ? getCustomerTier(c) : null;
 const tierColor = tier ? (typeof getTierColor === 'function' ? getTierColor(tier) : null) : null;
 const tierBadge = tier && tierColor ?
 `<span class="badge badge--${tier.toLowerCase()}">${tierColor.emoji} ${tier}</span>` : '';
 return `
 <div class="cp-autocomplete-item ${i === __cpAcCursor ? 'is-active' : ''}" data-idx="${i}" onmousedown="window.cpCustPick(${i})">
 <div class="cp-ac-main">
 <div class="cp-ac-name">${(c.name||'').slice(0, 50)}</div>
 <div class="cp-ac-meta">${c.phone || '-'} ${c.email ? '· '+c.email.slice(0,30) : ''} · ${c.total_orders||0} orders · RM${(c.total_spent||0).toFixed(0)}</div>
 </div>
 ${tierBadge}
 </div>
 `;
 }).join('');
 dd.classList.add('is-open');
};

window.cpCustAutocompleteClose = function() {
 document.getElementById('cpCustAcDropdown').classList.remove('is-open');
};

window.cpCustPick = function(i) {
 const c = __cpAcResults[i];
 if(!c) return;
 document.getElementById('cpCustName').value = c.name || '';
 document.getElementById('cpCustPhone').value = c.phone || '';
 if(c.email) document.getElementById('cpCustEmail').value = c.email;
 cpCustAutocompleteClose();
 cpVipLookup();
};

// Confirm sale — re-uses processNewCheckout logic by syncing fields back to legacy modal IDs first
window.cpConfirmSale = async function() {
 // Validate
 const name = (document.getElementById('cpCustName').value || '').trim();
 if(!name) {
 // Auto-fill Walk-In
 document.getElementById('cpCustName').value = 'Walk-In';
 }
 const pm = document.getElementById('cpPaymentMethod').value;
 if(pm === 'E-Wallet') {
 const provider = document.getElementById('cpEwalletProvider').value;
 const ref = document.getElementById('cpEwalletRef').value.trim();
 if(!provider) return showToast('Pilih e-wallet provider.', 'warn');
 if(!ref) return showToast('Ref # e-wallet wajib.', 'warn');
 }

 // Sync to legacy modal IDs (so processNewCheckout can read same fields)
 const sync = (cpId, legacyId) => {
 const cp = document.getElementById(cpId), leg = document.getElementById(legacyId);
 if(cp && leg) leg.value = cp.value;
 };
 sync('cpCustName', 'customerName');
 sync('cpCustPhone', 'customerPhone');
 sync('cpCustEmail', 'customerEmail');
 sync('cpBuyerTin', 'customerBuyerTin');
 sync('cpChannel', 'checkoutChannel');
 sync('cpStatus', 'checkoutStatus');
 sync('cpPaymentMethod', 'paymentMethod');
 sync('cpEwalletProvider', 'ewalletProvider');
 sync('cpEwalletRef', 'ewalletRef');

 // Disable button while processing
 const btn = document.getElementById('cpConfirmBtn');
 btn.disabled = true; btn.classList.add('is-disabled');
 btn.innerHTML = '<i data-lucide="loader" style="width:16px; height:16px;"></i> Processing…';

 // Capture sale info for receipt
 const finalTotal = parseFloat(document.getElementById('cpTotalDisplay').textContent) || 0;
 const itemSnapshot = [...cart];

 // Hijack alert/showToast to capture invoice ID etc — actually existing processNewCheckout opens
 // its own receipt modal at the end. Block that by stubbing showReceiptModal temporarily.
 const origShow = window.showReceiptModal;
 let invIdCaptured = null;
 window.showReceiptModal = function(invId, custName, email, total, items) {
 invIdCaptured = invId;
 // Don't open the legacy modal — UX-3 success state replaces it
 };

 try {
 await window.processNewCheckout();
 } catch(e) {
 showToast('Ralat checkout: ' + e.message, 'error');
 btn.disabled = false; btn.classList.remove('is-disabled');
 btn.innerHTML = '<i data-lucide="check-circle" style="width:18px; height:18px;"></i> Sahkan Bayaran (RM ' + finalTotal.toFixed(2) + ')';
 window.showReceiptModal = origShow;
 return;
 }
 window.showReceiptModal = origShow;

 // Save last sale for receipt actions
 __cpLastSale = {
 invId: invIdCaptured || ('INV-' + Date.now().toString(36).toUpperCase()),
 customer_name: document.getElementById('cpCustName').value || 'Walk-In',
 customer_phone: document.getElementById('cpCustPhone').value || '',
 customer_email: document.getElementById('cpCustEmail').value || '',
 total: finalTotal,
 items: itemSnapshot,
 payment_method: pm,
 timestamp: new Date().toISOString()
 };

 // Show success state
 document.getElementById('cpFormView').classList.add('is-hidden');
 document.getElementById('cpSuccessView').classList.remove('is-hidden');
 document.getElementById('cpFooter').classList.add('is-hidden');
 document.getElementById('cpSuccessAmount').textContent = finalTotal.toFixed(2);
 document.getElementById('cpSuccessSub').innerHTML =
 `Resit <strong>${__cpLastSale.invId}</strong> dah disimpan. ${__cpLastSale.customer_email ? 'Email-resit boleh dihantar.' : 'Walk-in customer.'}`;

 if(typeof lucide !== 'undefined') lucide.createIcons();
};

window.cpReceiptPrint = function() {
 if(!__cpLastSale) return;
 if(typeof window.showReceiptModal === 'function') {
 showReceiptModal(__cpLastSale.invId, __cpLastSale.customer_name, __cpLastSale.customer_email, __cpLastSale.total, __cpLastSale.items);
 } else {
 showToast('Resit handler missing', 'warn');
 }
};

window.cpReceiptWhatsApp = function() {
 if(!__cpLastSale) return;
 const phone = __cpLastSale.customer_phone || '';
 if(!phone) return showToast('Tiada phone number untuk WhatsApp.', 'warn');
 const phoneNorm = phone.replace(/\D/g, '').replace(/^0/, '60');
 const settings = JSON.parse(localStorage.getItem('complianceSettings_v1') || '{}').shop || {};
 const shopName = settings.name || '10 CAMP';
 const itemList = __cpLastSale.items.map(it => `• ${it.name||it.sku} x${it.quantity||1} = RM${((it.quantity||1)*(it.price||0)).toFixed(2)}`).join('\n');
 const msg = `Salam dari *${shopName}*!\n\nResit: ${__cpLastSale.invId}\n${itemList}\n\n*Total: RM ${__cpLastSale.total.toFixed(2)}*\n\nTerima kasih atas pembelian!`;
 const url = `https://wa.me/${phoneNorm}?text=${encodeURIComponent(msg)}`;
 window.open(url, '_blank');
};

window.cpReceiptEmail = function() {
 if(!__cpLastSale) return;
 const email = __cpLastSale.customer_email || '';
 if(!email) return showToast('Tiada email untuk hantar.', 'warn');
 const settings = JSON.parse(localStorage.getItem('complianceSettings_v1') || '{}').shop || {};
 const shopName = settings.name || '10 CAMP';
 const itemList = __cpLastSale.items.map(it => `${it.name||it.sku} x${it.quantity||1} - RM${((it.quantity||1)*(it.price||0)).toFixed(2)}`).join('%0D%0A');
 const subject = encodeURIComponent(`E-Resit ${__cpLastSale.invId} dari ${shopName}`);
 const body = encodeURIComponent(`Salam,\n\nResit: ${__cpLastSale.invId}\n\n`) + itemList + encodeURIComponent(`\n\nTotal: RM ${__cpLastSale.total.toFixed(2)}\n\nTerima kasih!`);
 window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
};

// Hijack openPaymentModal → openCheckoutPanel (the new flow becomes default)
window.__originalOpenPaymentModal = window.openPaymentModal;
window.openPaymentModal = function() {
 return window.openCheckoutPanel();
};

// Keyboard shortcuts within panel
document.addEventListener('keydown', e => {
 const panel = document.getElementById('checkoutPanel');
 if(!panel || !panel.classList.contains('is-open')) return;
 if(e.key === 'Escape') { closeCheckoutPanel(); return; }
 // Customer autocomplete arrow nav
 const dd = document.getElementById('cpCustAcDropdown');
 if(dd && dd.classList.contains('is-open') && document.activeElement.id === 'cpCustName') {
 if(e.key === 'ArrowDown') {
 e.preventDefault();
 __cpAcCursor = Math.min(__cpAcCursor + 1, __cpAcResults.length - 1);
 cpCustAutocomplete();
 } else if(e.key === 'ArrowUp') {
 e.preventDefault();
 __cpAcCursor = Math.max(__cpAcCursor - 1, 0);
 cpCustAutocomplete();
 } else if(e.key === 'Enter' && __cpAcResults.length) {
 e.preventDefault();
 cpCustPick(__cpAcCursor);
 }
 }
});

// =============================================================
// SPRINT UX-4 — POLISH (Dark mode + Skeleton helper)
// =============================================================

window.toggleTheme = function() {
 const html = document.documentElement;
 const current = html.getAttribute('data-theme');
 const next = current === 'dark' ? 'light' : 'dark';
 html.setAttribute('data-theme', next);
 localStorage.setItem('uxTheme_v1', next);
 // Update icon
 const icon = document.getElementById('themeIcon');
 if(icon) {
 icon.setAttribute('data-lucide', next === 'dark' ? 'sun' : 'moon');
 if(typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
 }
};

window.__initTheme = function() {
 const saved = localStorage.getItem('uxTheme_v1') || 'light';
 document.documentElement.setAttribute('data-theme', saved);
 const icon = document.getElementById('themeIcon');
 if(icon && saved === 'dark') {
 icon.setAttribute('data-lucide', 'sun');
 if(typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
 }
};

// Reusable skeleton row generator
window.skelRows = function(rows, cols) {
 const rowsHtml = [];
 for(let r = 0; r < rows; r++) {
 let tds = '';
 for(let c = 0; c < cols; c++) tds += '<td><span class="skeleton skeleton--text"></span></td>';
 rowsHtml.push(`<tr class="skel-row" aria-hidden="true">${tds}</tr>`);
 }
 return rowsHtml.join('');
};

// Init theme + skip link focus on Tab from URL
document.addEventListener('DOMContentLoaded', () => {
 if(typeof __initTheme === 'function') __initTheme();
});

// =============================================================
// PRODUCT DATABASE — REDESIGN (UX-6, design-led grid + table)
// =============================================================
let __pdView = 'grid';

window.pdSetView = function(v) {
 __pdView = v;
 document.querySelectorAll('.pd-view-toggle button').forEach(b => b.classList.toggle('is-active', b.dataset.view === v));
 document.getElementById('pdGridView').style.display = v === 'grid' ? 'grid' : 'none';
 document.getElementById('pdTableView').style.display = v === 'table' ? 'block' : 'none';
 renderProductDatabase();
};

// p1_28: Status pill setter + active filter chips
window.pdbSetStatus = function(status, btn) {
 const hidden = document.getElementById('pdStatus');
 if(hidden) hidden.value = status;
 document.querySelectorAll('#pdbStatusPills .pdb-pill').forEach(b => b.classList.toggle('pdb-pill--active', b === btn));
 window.renderProductDatabase();
};
window.pdbClearFilters = function() {
 ['pdSearch','pdBrand','pdCategory'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
 const allPill = document.querySelector('#pdbStatusPills .pdb-pill[data-status=""]');
 if(allPill) window.pdbSetStatus('', allPill);
 else window.renderProductDatabase();
};

window.renderProductDatabase = function() {
 const gridEl = document.getElementById('pdGridView');
 const tableBody = document.getElementById('pdTableBody');
 if(!gridEl || typeof masterProducts === 'undefined') return;

 // Populate filter dropdowns lazily
 const brandSel = document.getElementById('pdBrand');
 const catSel = document.getElementById('pdCategory');
 if(brandSel && brandSel.options.length <= 1) {
 const brands = [...new Set(masterProducts.map(p => p.brand).filter(Boolean))].sort();
 brandSel.innerHTML = '<option value="">All brands</option>' + brands.map(b => `<option value="${b}">${b}</option>`).join('');
 }
 if(catSel && catSel.options.length <= 1) {
 const cats = [...new Set(masterProducts.map(p => p.category).filter(Boolean))].sort();
 catSel.innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
 }

 // Read filters
 const q = (document.getElementById('pdSearch')?.value || '').trim().toLowerCase();
 const fBrand = document.getElementById('pdBrand')?.value || '';
 const fCat = document.getElementById('pdCategory')?.value || '';
 const fStatus = document.getElementById('pdStatus')?.value || '';
 const sort = document.getElementById('pdSort')?.value || 'name';
 const perPage = parseInt(document.getElementById('pdPerPage')?.value) || 48;

 // Stock map
 const stockMap = new Map();
 (typeof inventoryBatches !== 'undefined' ? inventoryBatches : []).forEach(b => {
 stockMap.set(b.sku, (stockMap.get(b.sku) || 0) + (b.qty_remaining || 0));
 });

 // Filter
 let list = masterProducts.filter(p => {
 if(fBrand && p.brand !== fBrand) return false;
 if(fCat && p.category !== fCat) return false;
 const stock = stockMap.get(p.sku) || 0;
 const reorder = parseInt(p.reorder_point) || 5;
 if(fStatus === 'published' && !isPublished(p)) return false;
 if(fStatus === 'draft' && isPublished(p)) return false;
 if(fStatus === 'oos' && stock > 0) return false;
 if(fStatus === 'low' && (stock === 0 || stock > reorder)) return false;
 if(fStatus === 'noimage') {
   const hasImg = (Array.isArray(p.images) && p.images[0]) || (typeof p.images === 'string' && p.images);
   if(hasImg) return false;
 }
 if(q) {
 const hay = `${p.sku||''} ${p.name||''} ${p.brand||''} ${p.category||''} ${p.erp_barcode||''}`.toLowerCase();
 if(!hay.includes(q)) return false;
 }
 return true;
 });

 // Sort
 const sortFns = {
 'name': (a, b) => (a.name||'').localeCompare(b.name||''),
 'price-desc': (a, b) => (b.price||0) - (a.price||0),
 'price-asc': (a, b) => (a.price||0) - (b.price||0),
 'stock-desc': (a, b) => (stockMap.get(b.sku)||0) - (stockMap.get(a.sku)||0),
 'brand': (a, b) => (a.brand||'').localeCompare(b.brand||'') || (a.name||'').localeCompare(b.name||'')
 };
 list.sort(sortFns[sort] || sortFns.name);

 // Stats cards (whole catalog, not just filtered)
 const totalProducts = masterProducts.length;
 const publishedCount = masterProducts.filter(p => isPublished(p)).length;
 const draftCount = totalProducts - publishedCount;
 const lowStockCount = masterProducts.filter(p => {
   const stk = stockMap.get(p.sku) || 0;
   const ro = parseInt(p.reorder_point) || 5;
   return stk > 0 && stk <= ro;
 }).length;
 const oosCount = masterProducts.filter(p => (stockMap.get(p.sku) || 0) === 0).length;
 const totalRetailValue = masterProducts.reduce((s, p) => s + (stockMap.get(p.sku)||0) * (p.price||0), 0);

 // Update header sub counts
 const grandEl = document.getElementById('pdGrandCount'); if(grandEl) grandEl.textContent = totalProducts.toLocaleString();
 const liveEl = document.getElementById('pdbLiveCount'); if(liveEl) liveEl.textContent = publishedCount.toLocaleString();
 const draftEl = document.getElementById('pdbDraftCount'); if(draftEl) draftEl.textContent = draftCount.toLocaleString();

 // New stat cards (pdb-stat class)
 const statsEl = document.getElementById('pdStats');
 if(statsEl) {
 statsEl.innerHTML = `
 <div class="pdb-stat"><div class="pdb-stat__label">Total catalog</div><div class="pdb-stat__value">${totalProducts.toLocaleString()}</div><div class="pdb-stat__hint">${list.length.toLocaleString()} match filter</div></div>
 <div class="pdb-stat pdb-stat--success"><div class="pdb-stat__label">Live</div><div class="pdb-stat__value">${publishedCount.toLocaleString()}</div><div class="pdb-stat__hint">Visible in Cashier</div></div>
 <div class="pdb-stat pdb-stat--warning"><div class="pdb-stat__label">Draft</div><div class="pdb-stat__value">${draftCount.toLocaleString()}</div><div class="pdb-stat__hint">Awaiting review</div></div>
 <div class="pdb-stat pdb-stat--danger"><div class="pdb-stat__label">Low / OOS</div><div class="pdb-stat__value">${(lowStockCount + oosCount).toLocaleString()}</div><div class="pdb-stat__hint">${lowStockCount} low · ${oosCount} out</div></div>
 <div class="pdb-stat pdb-stat--info"><div class="pdb-stat__label">Stock value</div><div class="pdb-stat__value">RM ${totalRetailValue.toLocaleString(undefined,{maximumFractionDigits:0})}</div><div class="pdb-stat__hint">At retail price</div></div>
 `;
 }

 // Active filter chips
 const chipsEl = document.getElementById('pdbActiveChips');
 if(chipsEl) {
 const chips = [];
 if(q) chips.push({label: 'Search: "' + q + '"', clear: "document.getElementById('pdSearch').value=''; window.renderProductDatabase();"});
 if(fBrand) chips.push({label: 'Brand: ' + fBrand, clear: "document.getElementById('pdBrand').value=''; window.renderProductDatabase();"});
 if(fCat) chips.push({label: 'Category: ' + fCat, clear: "document.getElementById('pdCategory').value=''; window.renderProductDatabase();"});
 if(fStatus) {
   const map = { published:'Live', draft:'Draft', oos:'Out of Stock', low:'Low Stock', noimage:'No Image' };
   const allPill = "document.querySelectorAll('#pdbStatusPills .pdb-pill').forEach(b=>b.classList.remove('pdb-pill--active'));document.querySelector('#pdbStatusPills .pdb-pill[data-status=\\\"\\\"]').classList.add('pdb-pill--active');document.getElementById('pdStatus').value='';window.renderProductDatabase();";
   chips.push({label: 'Status: ' + (map[fStatus] || fStatus), clear: allPill});
 }
 if(chips.length > 0) {
   chipsEl.innerHTML =
     '<span class="pdb-active-chips__label">Filtering by:</span>' +
     chips.map(c => `<span class="pdb-active-chip">${c.label}<button onclick="${c.clear.replace(/"/g, '&quot;')}" aria-label="Remove">×</button></span>`).join('') +
     '<button class="pdb-active-clear" onclick="window.pdbClearFilters()">Clear all</button>';
   chipsEl.style.display = 'flex';
 } else {
   chipsEl.style.display = 'none';
 }
 }

 // Summary line
 const summaryEl = document.getElementById('pdSummary');
 if(summaryEl) {
 summaryEl.innerHTML = `Match: <strong>${list.length}</strong> · Show: <strong>${Math.min(list.length, perPage)}</strong>${list.length> perPage ? ' <span style="color:var(--warning-700);">(turunkan saiz halaman atau tighten filter untuk lihat semua)</span>' : ''}`;
 }

 const slice = list.slice(0, perPage);

 if(slice.length === 0) {
 const empty = `<div class="empty-state" style="grid-column:1/-1;">
 <div class="empty-state__icon"></div>
 <div class="empty-state__title">Tiada produk match filter</div>
 <div class="empty-state__desc">Cuba clear filter atau tukar status ke "Semua".</div>
 <button class="btn btn--secondary" onclick="document.getElementById('pdSearch').value='';document.getElementById('pdBrand').value='';document.getElementById('pdCategory').value='';document.getElementById('pdStatus').value='';renderProductDatabase()">Reset Filter</button>
 </div>`;
 gridEl.innerHTML = empty;
 if(tableBody) tableBody.innerHTML = `<tr><td colspan="8">${empty}</td></tr>`;
 return;
 }

 // Render Grid
 if(__pdView === 'grid') {
 gridEl.innerHTML = slice.map(p => {
 const stock = stockMap.get(p.sku) || 0;
 const reorder = p.reorder_point || 5;
 const stockClass = stock === 0 ? 'out' : (stock < reorder ? 'low' : '');
 const stockLabel = stock === 0 ? 'OOS' : `${stock} ${p.unit || 'pcs'}`;
 const img = (p.images && p.images[0]) || '';
 const pub = isPublished(p);
 const statusBadge = pub
 ? '<span class="badge badge--success pd-card__status-badge">Live</span>'
 : '<span class="badge badge--warning pd-card__status-badge">Draft</span>';
 const cost = p.cost_price ? Number(p.cost_price).toFixed(2) : null;
 return `
 <div class="pd-card" onclick="window.openPdpModal('${p.sku.replace(/'/g, "\\'")}')" tabindex="0" role="button" aria-label="Edit ${p.sku}">
 ${statusBadge}
 <span class="pd-card__stock-pill ${stockClass}">${stockLabel}</span>
 <div class="pd-card__image-wrap">
 ${img
 ? `<img class="pd-card__image" src="${img}" alt="${(p.name||'').replace(/"/g,'&quot;')}" loading="lazy" onerror="this.style.display='none';this.parentNode.innerHTML+='<span class=&quot;pd-card__image-placeholder&quot;></span>'">`
 : `<span class="pd-card__image-placeholder"></span>`}
 </div>
 <div class="pd-card__body">
 <span class="pd-card__brand">${p.brand || p.category || '·'}</span>
 <span class="pd-card__title">${(p.name || '').slice(0, 90)}</span>
 <span class="pd-card__sku">${p.sku}</span>
 <span class="pd-card__price">RM ${(p.price || 0).toFixed(2)}${cost ? `<span class="pd-card__price-sub">cost RM ${cost}</span>` : ''}</span>
 </div>
 <div class="pd-card__footer">
 <span>${p.category || '—'}</span>
 <span style="display:inline-flex; gap:6px; align-items:center;">
 <button onclick="event.stopPropagation(); window.shareProductWA('${p.sku.replace(/'/g, "\\'")}')" aria-label="Share to WhatsApp" title="Share ke WhatsApp" style="background:none; border:none; cursor:pointer; padding:2px 4px; color:#25D366;"><i data-lucide="message-circle" style="width:14px; height:14px;"></i></button>
 <button onclick="event.stopPropagation(); window.shareProduct('${p.sku.replace(/'/g, "\\'")}')" aria-label="Share public-safe description" title="Share (copy / native)" style="background:none; border:none; cursor:pointer; padding:2px 4px; color:var(--neutral-700);"><i data-lucide="share-2" style="width:13px; height:13px;"></i></button>
 <button onclick="event.stopPropagation(); window.openPdpModal('${p.sku.replace(/'/g, "\\'")}')" aria-label="Edit details">Edit ›</button>
 </span>
 </div>
 </div>
 `;
 }).join('');
 } else if(tableBody) {
 // Render Table
 tableBody.innerHTML = slice.map(p => {
 const stock = stockMap.get(p.sku) || 0;
 const reorder = p.reorder_point || 5;
 const stockColor = stock === 0 ? 'var(--danger-600)' : (stock < reorder ? 'var(--warning-600)' : 'var(--neutral-700)');
 const img = (p.images && p.images[0]) || '';
 const pub = isPublished(p);
 return `
 <tr onclick="window.openPdpModal('${p.sku.replace(/'/g, "\\'")}')" tabindex="0" role="button">
 <td>${img ? `<img src="${img}" class="pd-row-img" loading="lazy" alt="">` : '<div class="pd-row-img" style="display:flex;align-items:center;justify-content:center;color:var(--neutral-400);"></div>'}</td>
 <td><span class="pd-row-name">${(p.name||'').slice(0, 70)}</span><span class="pd-row-meta">${p.sku}${p.erp_barcode ? ' · '+p.erp_barcode : ''}</span></td>
 <td>${p.brand || '—'}</td>
 <td>${p.category || '—'}</td>
 <td style="text-align:right;" class="pd-row-price">RM ${(p.price||0).toFixed(2)}</td>
 <td style="text-align:right; color:${stockColor}; font-weight:var(--weight-bold);">${stock}</td>
 <td style="text-align:center;">${pub ? '<span class="badge badge--success">Live</span>' : '<span class="badge badge--warning">Draft</span>'}</td>
 <td>
 <button class="btn btn--ghost btn--sm" onclick="event.stopPropagation(); window.openPdpModal('${p.sku.replace(/'/g, "\\'")}')">Edit</button>
 <button class="btn btn--ghost btn--sm" style="padding:4px 8px; margin-left:4px; color:#25D366;" onclick="event.stopPropagation(); window.shareProductWA('${p.sku.replace(/'/g, "\\'")}')" title="Share ke WhatsApp"><i data-lucide="message-circle" style="width:13px; height:13px;"></i></button>
 <button class="btn btn--ghost btn--sm" style="padding:4px 8px; margin-left:4px;" onclick="event.stopPropagation(); window.shareProduct('${p.sku.replace(/'/g, "\\'")}')" title="Share (copy / native)"><i data-lucide="share-2" style="width:13px; height:13px;"></i></button>
 </td>
 </tr>
 `;
 }).join('');
 }

 if(typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
};

// Initial render when section opens — wire to nav click
document.addEventListener('DOMContentLoaded', () => {
 const dbBtn = document.querySelector('[data-tab="inv_database"]');
 if(dbBtn) dbBtn.addEventListener('click', () => setTimeout(renderProductDatabase, 100));
});

// =============================================================
// Compliance section — open with category filter (3 sidebar entries)
// =============================================================
window.openComplianceFiltered = function(category, defaultTab, title) {
 // Show the section
 if(typeof switchHub === 'function') switchHub(['complianceSection'], title || 'Compliance', null);
 if(typeof renderCompliancePanel === 'function') renderCompliancePanel();

 // Filter visible tabs to the category
 document.querySelectorAll('#complTabBar.compl-tab').forEach(t => {
 const cat = t.getAttribute('data-category');
 const matches = !category || cat === category;
 t.style.display = matches ? '' : 'none';
 });

 // Switch to default tab (must be in visible category)
 if(defaultTab && typeof window.__switchComplTab === 'function') {
 setTimeout(() => window.__switchComplTab(defaultTab), 50);
 }

 // Update breadcrumb if the function exists
 if(typeof updateBreadcrumb === 'function') updateBreadcrumb(title);
};

// Reset filter (show all tabs)
window.openComplianceAll = function() {
 document.querySelectorAll('#complTabBar.compl-tab').forEach(t => { t.style.display = ''; });
 if(typeof switchHub === 'function') switchHub(['complianceSection'], 'Compliance & Settings', null);
 if(typeof renderCompliancePanel === 'function') renderCompliancePanel();
};

// =============================================================
// B2B / Wholesale Customers (p1_17)
// =============================================================
window.renderB2BCustomers = function() {
 const tbody = document.getElementById('b2bTbody');
 const statsEl = document.getElementById('b2bStats');
 if(!tbody) return;
 if(typeof customersData === 'undefined' || !Array.isArray(customersData)) {
 tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#999;">Loading...</td></tr>';
 return;
 }

 const all = customersData.filter(c => c.is_b2b === true);
 const q = (document.getElementById('b2bSearch')?.value || '').trim().toLowerCase();
 const status = document.getElementById('b2bStatus')?.value || 'all';
 const sortMode = document.getElementById('b2bSort')?.value || 'spent_desc';

 let filtered = all.filter(c => {
 if(q) {
 const hay = `${c.company_name||''} ${c.name||''} ${c.phone||''} ${c.pic_phone||''} ${c.buyer_tin||''}`.toLowerCase();
 if(!hay.includes(q)) return false;
 }
 if(status === 'active' && (c.total_orders||0) === 0) return false;
 if(status === 'inactive' && (c.total_orders||0)> 0) return false;
 return true;
 });

 filtered.sort((a, b) => {
 switch(sortMode) {
 case 'spent_desc': return (b.total_spent||0) - (a.total_spent||0);
 case 'orders_desc': return (b.total_orders||0) - (a.total_orders||0);
 case 'recent': return (b.created_at||'').localeCompare(a.created_at||'');
 case 'name': return (a.company_name||a.name||'').localeCompare(b.company_name||b.name||'');
 }
 return 0;
 });

 if(statsEl) {
 const totalSpent = filtered.reduce((s, c) => s + (c.total_spent||0), 0);
 const totalCredit = filtered.reduce((s, c) => s + (parseFloat(c.credit_limit)||0), 0);
 const activeCount = filtered.filter(c => (c.total_orders||0)> 0).length;
 statsEl.innerHTML = `
 <div style="background:#EFF6FF; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#1E40AF;">B2B Total</div><div style="font-size:18px; font-weight:bold;">${filtered.length}</div></div>
 <div style="background:#F0FDF4; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#166534;">Active (≥1 order)</div><div style="font-size:18px; font-weight:bold;">${activeCount}</div></div>
 <div style="background:#FEF3C7; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#92400E;">Total Spent</div><div style="font-size:18px; font-weight:bold;">RM ${totalSpent.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
 <div style="background:#FAF5FF; padding:10px; border-radius:6px;"><div style="font-size:10px; color:#6B21A8;">Credit Exposure</div><div style="font-size:18px; font-weight:bold;">RM ${totalCredit.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
 `;
 }

 if(filtered.length === 0) {
 tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#999; padding:20px;">Tiada B2B customer. Klik <strong>Tambah B2B</strong> untuk register first wholesale account.</td></tr>';
 return;
 }

 tbody.innerHTML = filtered.map(c => {
 const company = (c.company_name || c.name || '(no name)').slice(0, 50);
 const pic = c.name && c.company_name ? c.name : '-';
 const tin = c.buyer_tin || '-';
 const terms = c.payment_terms || '-';
 const cl = c.credit_limit ? `RM ${parseFloat(c.credit_limit).toFixed(2)}` : '-';
 const spent = (c.total_spent||0).toFixed(2);
 const orders = c.total_orders || 0;
 return `
 <tr>
 <td><strong>${company}</strong>${c.pic_phone?`<br><span style="color:#999;font-size:10px;">${c.pic_phone}</span>`:''}</td>
 <td>${pic}</td>
 <td style="font-family:monospace; font-size:11px;">${tin}</td>
 <td>${terms}</td>
 <td style="text-align:right;">${cl}</td>
 <td style="text-align:right; font-weight:bold; color:${spent>1000?'#10B981':'#111'};">RM ${spent}</td>
 <td style="text-align:right;">${orders}</td>
 <td>
 <button class="btn btn--secondary btn--sm" onclick="window.openB2BEditModal('${c.id}')">Edit</button>
 </td>
 </tr>
 `;
 }).join('');
};

window.openB2BAddModal = function() {
 document.getElementById('b2bModalTitle').textContent = 'B2B Customer Baru';
 document.getElementById('b2bEditId').value = '';
 ['b2bCompany','b2bPicName','b2bPicPhone','b2bPicEmail','b2bTin','b2bCreditLimit','b2bAddress','b2bNotes'].forEach(id => {
 const el = document.getElementById(id); if(el) el.value = '';
 });
 document.getElementById('b2bPaymentTerms').value = '';
 document.getElementById('b2bModal').style.display = 'flex';
};

window.openB2BEditModal = function(id) {
 const c = (customersData || []).find(x => String(x.id) === String(id));
 if(!c) { if(typeof showToast==='function') showToast('Customer tak jumpa', 'error'); return; }
 document.getElementById('b2bModalTitle').textContent = 'Edit B2B Customer';
 document.getElementById('b2bEditId').value = c.id;
 document.getElementById('b2bCompany').value = c.company_name || c.name || '';
 document.getElementById('b2bPicName').value = c.company_name ? (c.name || '') : '';
 document.getElementById('b2bPicPhone').value = c.pic_phone || c.phone || '';
 document.getElementById('b2bPicEmail').value = c.pic_email || c.email || '';
 document.getElementById('b2bTin').value = c.buyer_tin || '';
 document.getElementById('b2bPaymentTerms').value= c.payment_terms || '';
 document.getElementById('b2bCreditLimit').value = c.credit_limit || '';
 document.getElementById('b2bAddress').value = c.address || '';
 document.getElementById('b2bNotes').value = c.b2b_notes || '';
 document.getElementById('b2bModal').style.display = 'flex';
};

window.saveB2BCustomer = async function() {
 const company = (document.getElementById('b2bCompany').value || '').trim();
 if(!company) { if(typeof showToast==='function') showToast('Company name wajib diisi', 'error'); return; }

 const pic = (document.getElementById('b2bPicName').value || '').trim();
 const phone = (document.getElementById('b2bPicPhone').value || '').trim();
 const email = (document.getElementById('b2bPicEmail').value || '').trim();
 const tin = (document.getElementById('b2bTin').value || '').trim();
 const terms = document.getElementById('b2bPaymentTerms').value || null;
 const cl = parseFloat(document.getElementById('b2bCreditLimit').value) || null;
 const addr = (document.getElementById('b2bAddress').value || '').trim();
 const notes = (document.getElementById('b2bNotes').value || '').trim();
 const editId = document.getElementById('b2bEditId').value;

 const payload = {
 is_b2b: true,
 company_name: company,
 name: pic || company,
 phone: phone || null,
 email: email || null,
 pic_phone: phone || null,
 pic_email: email || null,
 buyer_tin: tin || null,
 payment_terms: terms,
 credit_limit: cl,
 address: addr || null,
 b2b_notes: notes || null
 };

 try {
 if(editId) {
 const { error } = await db.from('customers').update(payload).eq('id', editId);
 if(error) throw error;
 if(typeof showToast==='function') showToast('B2B customer updated ', 'success');
 } else {
 const { data, error } = await db.from('customers').insert([payload]).select();
 if(error) throw error;
 if(data && data[0] && Array.isArray(customersData)) customersData.push(data[0]);
 if(typeof showToast==='function') showToast('B2B customer saved ', 'success');
 }
 // Reload list
 const { data: fresh } = await db.from('customers').select('*');
 if(fresh) window.customersData = fresh;
 document.getElementById('b2bModal').style.display = 'none';
 window.renderB2BCustomers();
 } catch(e) {
 console.error(e);
 if(typeof showToast==='function') showToast('Save failed: ' + (e.message||'').slice(0,80), 'error');
 }
};

// =============================================================
// Data & Backup section (Finance Dept · surfaced from Sync)
// =============================================================
window.renderDataBackup = function() {
 // Last backup timestamp
 const tsEl = document.getElementById('dbLastBackupText');
 if(tsEl) {
 const ts = localStorage.getItem('lastFullBackup_v1');
 tsEl.innerHTML = ts
 ? `Last backup: <strong>${new Date(ts).toLocaleString('en-MY')}</strong>`
 : 'Last backup: <em>belum ada</em>';
 }

 // Conflict log
 const logEl = document.getElementById('dbConflictLog');
 if(logEl) {
 let log = [];
 try {
 log = (window.SyncGuard && typeof window.SyncGuard.getLog === 'function')
 ? window.SyncGuard.getLog()
 : JSON.parse(localStorage.getItem('syncConflictLog_v1') || '[]');
 } catch(e) { log = []; }
 if(!log.length) {
 logEl.innerHTML = '<em style="color:#10B981;"> Tiada conflict — bagus!</em>';
 } else {
 logEl.innerHTML = `
 <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
 <strong>${log.length} conflict(s) · last 50</strong>
 <button class="btn btn--secondary btn--sm" onclick="if(window.SyncGuard&&window.SyncGuard.clearLog){window.SyncGuard.clearLog();window.renderDataBackup();}">Clear log</button>
 </div>
 <div style="max-height:300px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px;">
 <table class="data-table" style="font-size:11px; margin:0;">
 <thead><tr><th>When</th><th>Table</th><th>ID</th><th>Expected v.</th></tr></thead>
 <tbody>
 ${log.slice().reverse().map(e => `
 <tr>
 <td>${e.when ? new Date(e.when).toLocaleString('en-MY') : '-'}</td>
 <td><code>${e.table || '-'}</code></td>
 <td style="font-family:monospace;">${(e.id||'').toString().slice(0,12)}</td>
 <td>${e.expectedVersion ?? '-'}</td>
 </tr>
 `).join('')}
 </tbody>
 </table>
 </div>
 `;
 }
 }
};

// =============================================================
// p3_5 — Light i18n (BM ↔ EN)
// =============================================================
window.I18N = {
 lang: localStorage.getItem('lang_v1') || 'bm',
 dict: {
 // Mode bar
 mode_cashier: { bm: 'Kaunter', en: 'Cashier' },
 mode_operations: { bm: 'Operasi', en: 'Operations' },
 mode_manager: { bm: 'Pengurus', en: 'Manager' },
 mode_management: { bm: 'Pengurusan', en: 'Management' },
 mode_hq: { bm: 'HQ', en: 'HQ' },
 mode_investor: { bm: 'Investor', en: 'Investor' },

 // Sidebar groups
 dept_sales: { bm: 'Jabatan Jualan', en: 'Sales Department' },
 dept_inventory: { bm: 'Jabatan Stok', en: 'Inventory Department' },
 dept_admin: { bm: 'Jabatan Admin', en: 'Admin Department' },
 dept_finance: { bm: 'Jabatan Kewangan', en: 'Finance Department' },
 dept_hr: { bm: 'Jabatan HR', en: 'HR Department' },
 dept_customers: { bm: 'Pelanggan', en: 'Customers' },
 dept_setup: { bm: 'Tetapan', en: 'Setup' },

 // Common buttons
 btn_save: { bm: 'Simpan', en: 'Save' },
 btn_cancel: { bm: 'Batal', en: 'Cancel' },
 btn_delete: { bm: 'Padam', en: 'Delete' },
 btn_edit: { bm: 'Edit', en: 'Edit' },
 btn_add: { bm: 'Tambah', en: 'Add' },
 btn_search: { bm: 'Cari', en: 'Search' },
 btn_close: { bm: 'Tutup', en: 'Close' },
 btn_release: { bm: 'Lepaskan', en: 'Release' },

 // Status / labels
 status_active: { bm: 'Aktif', en: 'Active' },
 status_inactive: { bm: 'Tak aktif',en: 'Inactive' },
 status_completed: { bm: 'Selesai', en: 'Completed' },
 status_pending: { bm: 'Menunggu', en: 'Pending' },
 label_loading: { bm: 'Loading…', en: 'Loading…' },
 label_total: { bm: 'Jumlah', en: 'Total' }
 }
};

window.t = function(key) {
 const e = window.I18N.dict[key];
 if(!e) return key;
 return e[window.I18N.lang] || e.en || key;
};

window.applyI18N = function() {
 document.querySelectorAll('[data-i18n]').forEach(el => {
 const key = el.getAttribute('data-i18n');
 const val = window.t(key);
 if(val) el.textContent = val;
 });
 // Update lang button label
 const lbl = document.getElementById('langLabel');
 if(lbl) lbl.textContent = window.I18N.lang.toUpperCase();
 document.documentElement.setAttribute('lang', window.I18N.lang === 'bm' ? 'ms' : 'en');
};

window.setLang = function(lang) {
 if(!['bm','en'].includes(lang)) return;
 window.I18N.lang = lang;
 try { localStorage.setItem('lang_v1', lang); } catch(e){}
 window.applyI18N();
 if(typeof showToast === 'function') {
 showToast(lang === 'bm' ? 'Bahasa: Bahasa Malaysia ' : 'Language: English ', 'success');
 }
};

window.toggleLang = function() {
 window.setLang(window.I18N.lang === 'bm' ? 'en' : 'bm');
};

// Boot — apply on DOM ready
document.addEventListener('DOMContentLoaded', () => {
 setTimeout(() => { try { window.applyI18N(); } catch(e){} }, 100);
});

// =============================================================
// p8_4 — Audit Anomaly Alerts (rule-based fraud/risk detector)
// =============================================================
window.AA_REVIEWED_KEY = 'auditAlertsReviewed_v1';
window.__aaPeriod = '7d';
window.__aaShowReviewed = false;

function __aaPeriodCutoff() {
    const now = new Date();
    if(window.__aaPeriod === 'today') {
        const d = new Date(now); d.setHours(0,0,0,0); return d;
    }
    const days = window.__aaPeriod === '30d' ? 30 : 7;
    return new Date(now.getTime() - days * 24 * 3600 * 1000);
}

function __aaLoadReviewed() {
    try { return new Set(JSON.parse(localStorage.getItem(window.AA_REVIEWED_KEY) || '[]')); }
    catch(e) { return new Set(); }
}
function __aaSaveReviewed(set) {
    try { localStorage.setItem(window.AA_REVIEWED_KEY, JSON.stringify(Array.from(set))); } catch(e){}
}

window.aaSetPeriod = function(p, btn) {
    window.__aaPeriod = p;
    document.querySelectorAll('.aa-pill').forEach(b => b.classList.toggle('aa-pill--active', b === btn));
    window.renderAuditAlerts();
};
window.aaShowReviewed = function() {
    window.__aaShowReviewed = !window.__aaShowReviewed;
    const btn = document.getElementById('aaToggleReviewed');
    if(btn) btn.textContent = window.__aaShowReviewed ? 'Hide reviewed' : 'Show reviewed';
    window.renderAuditAlerts();
};
window.aaClearReviewed = function() {
    if(!confirm('Clear all reviewed flags? Anomaly cards yang dah marked as reviewed akan re-appear.')) return;
    localStorage.removeItem(window.AA_REVIEWED_KEY);
    window.renderAuditAlerts();
};
window.aaToggleCard = function(anomalyId) {
    const el = document.querySelector('[data-aa-id="' + anomalyId + '"]');
    if(el) el.classList.toggle('is-open');
};
window.aaMarkReviewed = function(anomalyId, reviewed) {
    const set = __aaLoadReviewed();
    if(reviewed) set.add(anomalyId);
    else set.delete(anomalyId);
    __aaSaveReviewed(set);
    window.renderAuditAlerts();
};

// === DETECTION RULES ===
function __aaComputeAnomalies() {
    const sales = (typeof salesHistory !== 'undefined' && Array.isArray(salesHistory)) ? salesHistory : [];
    const cutoff = __aaPeriodCutoff();
    const inWindow = sales.filter(s => {
        const d = new Date(s.created_at || s.timestamp || s.sale_date);
        return !isNaN(d) && d >= cutoff;
    });

    const anomalies = [];

    // === RULE 1: Refund spike (single day > 2x daily avg) ===
    try {
        const refundsByDay = {};
        sales.forEach(s => {
            const total = parseFloat(s.total || s.amount || s.total_amount || 0);
            if(total >= 0) return;
            const d = new Date(s.created_at || s.timestamp);
            if(isNaN(d)) return;
            const key = d.toISOString().slice(0,10);
            refundsByDay[key] = (refundsByDay[key] || 0) + 1;
        });
        const days = Object.keys(refundsByDay);
        if(days.length >= 7) {
            const avg = days.reduce((s,k) => s + refundsByDay[k], 0) / days.length;
            const spikeThreshold = Math.max(avg * 2, 3); // at least 3
            const spikes = days.filter(k => {
                const ts = new Date(k).getTime();
                return refundsByDay[k] >= spikeThreshold && ts >= cutoff.getTime();
            });
            if(spikes.length > 0) {
                const items = spikes.map(date => ({
                    date,
                    staff: '—',
                    info: refundsByDay[date] + ' refunds (avg ' + avg.toFixed(1) + '/day)',
                    amount: 0
                }));
                anomalies.push({
                    id: 'refund_spike',
                    severity: 'critical',
                    title: 'Refund spike day(s) detected',
                    desc: spikes.length + ' day' + (spikes.length>1?'s':'') + ' with refunds ≥ 2× daily average. Possible fraud or product issue.',
                    icon: 'trending-down',
                    iconBg: '#DC2626',
                    count: spikes.length,
                    items,
                    suggestion: 'Review refund reasons — high concentration on single day suggests batch-fraud or systemic product defect.'
                });
            }
        }
    } catch(e) {}

    // === RULE 2: Void/Refund luar jam (outside 9am-9pm) ===
    try {
        const afterHours = inWindow.filter(s => {
            const total = parseFloat(s.total || s.amount || 0);
            const status = String(s.status || '').toLowerCase();
            const isVoidOrRefund = total < 0 || status === 'voided' || status === 'refunded';
            if(!isVoidOrRefund) return false;
            const d = new Date(s.created_at);
            const h = d.getHours();
            return h < 9 || h >= 21;
        });
        if(afterHours.length > 0) {
            const items = afterHours.slice(0, 50).map(s => ({
                date: new Date(s.created_at).toLocaleString('en-MY', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }),
                staff: s.staff_name || '?',
                info: 'Status: ' + (s.status || 'refund') + ' · Receipt: ' + (s.id || s.invoice_id || '?'),
                amount: parseFloat(s.total || s.amount || 0)
            }));
            anomalies.push({
                id: 'after_hours_refund',
                severity: afterHours.length >= 3 ? 'critical' : 'warning',
                title: 'Voids / refunds outside business hours',
                desc: afterHours.length + ' transaction' + (afterHours.length>1?'s':'') + ' processed before 9am or after 9pm. Verify legitimate.',
                icon: 'clock-alert',
                iconBg: '#F59E0B',
                count: afterHours.length,
                items,
                suggestion: 'Cross-check shift roster — staff yang process refund luar jam patut ada attendance log untuk masa tu.'
            });
        }
    } catch(e) {}

    // === RULE 3: Large discount no approval ===
    try {
        const flagged = inWindow.filter(s => {
            const meta = s.metadata || {};
            const discount = parseFloat(meta.discount || meta.vip_discount_amount || 0);
            const hasApprover = !!(meta.approved_by_id || meta.approver_name);
            return discount > 50 && !hasApprover;
        });
        if(flagged.length > 0) {
            const items = flagged.slice(0, 50).map(s => {
                const meta = s.metadata || {};
                return {
                    date: new Date(s.created_at).toLocaleString('en-MY', { day:'2-digit', month:'short', hour:'2-digit' }),
                    staff: s.staff_name || '?',
                    info: 'Discount RM ' + parseFloat(meta.discount || meta.vip_discount_amount || 0).toFixed(2) + ' · No approver logged',
                    amount: parseFloat(s.total || 0)
                };
            });
            anomalies.push({
                id: 'discount_no_approval',
                severity: 'warning',
                title: 'Large discount without approval',
                desc: flagged.length + ' sale' + (flagged.length>1?'s':'') + ' with > RM 50 discount but no approver_id in metadata.',
                icon: 'percent',
                iconBg: '#F59E0B',
                count: flagged.length,
                items,
                suggestion: 'Set discount threshold rule — anything above RM 50 should require Manager PIN approval going forward.'
            });
        }
    } catch(e) {}

    // === RULE 4: Inactive staff sale ===
    try {
        let inactive = [];
        try { inactive = JSON.parse(localStorage.getItem('staffInactive_v1') || '[]'); } catch(e){}
        const inactiveNames = new Set();
        if(typeof authUsers !== 'undefined') {
            authUsers.forEach(u => {
                if(inactive.includes(u.staff_id)) inactiveNames.add(u.name);
            });
        }
        if(inactiveNames.size > 0) {
            const flagged = inWindow.filter(s => s.staff_name && inactiveNames.has(s.staff_name));
            if(flagged.length > 0) {
                const items = flagged.slice(0, 50).map(s => ({
                    date: new Date(s.created_at).toLocaleString('en-MY', { day:'2-digit', month:'short', hour:'2-digit' }),
                    staff: s.staff_name + ' (DEACTIVATED)',
                    info: 'Status: ' + (s.status || 'completed'),
                    amount: parseFloat(s.total || 0)
                }));
                anomalies.push({
                    id: 'inactive_staff_sale',
                    severity: 'critical',
                    title: 'Sales by deactivated staff',
                    desc: flagged.length + ' sale' + (flagged.length>1?'s':'') + ' processed under deactivated staff name. Should not happen.',
                    icon: 'user-x',
                    iconBg: '#DC2626',
                    count: flagged.length,
                    items,
                    suggestion: 'Investigate — either deactivation belum effective in POS, atau someone else is using ex-staff credentials.'
                });
            }
        }
    } catch(e) {}

    // === RULE 5: Multi-refund same staff same day (>3) ===
    try {
        const refundsByStaffDay = {};
        inWindow.forEach(s => {
            const total = parseFloat(s.total || s.amount || 0);
            if(total >= 0) return;
            const d = new Date(s.created_at);
            const key = (s.staff_name || '?') + '|' + d.toISOString().slice(0,10);
            refundsByStaffDay[key] = (refundsByStaffDay[key] || []).concat([s]);
        });
        const flagged = Object.keys(refundsByStaffDay).filter(k => refundsByStaffDay[k].length >= 3);
        if(flagged.length > 0) {
            const items = flagged.flatMap(k => {
                const [staff, day] = k.split('|');
                const list = refundsByStaffDay[k];
                return [{
                    date: day,
                    staff: staff,
                    info: list.length + ' refunds in single day',
                    amount: list.reduce((sum, s) => sum + parseFloat(s.total || 0), 0)
                }];
            });
            anomalies.push({
                id: 'multi_refund_staff',
                severity: 'warning',
                title: 'Multiple refunds by same staff in single day',
                desc: flagged.length + ' staff-day combination' + (flagged.length>1?'s':'') + ' with ≥ 3 refunds. Possible refund fraud pattern.',
                icon: 'refresh-ccw',
                iconBg: '#F59E0B',
                count: flagged.length,
                items,
                suggestion: 'Audit each staff-day combo — confirm legitimate (e.g. customer return event) vs suspicious (single staff refunding to associate).'
            });
        }
    } catch(e) {}

    // === RULE 6: High-value cash sale (> RM 500) ===
    try {
        const flagged = inWindow.filter(s => {
            const pm = String(s.payment_method || '').toLowerCase();
            const total = parseFloat(s.total || s.amount || 0);
            return total > 500 && pm.includes('cash');
        });
        if(flagged.length > 0) {
            const items = flagged.slice(0, 50).map(s => ({
                date: new Date(s.created_at).toLocaleString('en-MY', { day:'2-digit', month:'short', hour:'2-digit' }),
                staff: s.staff_name || '?',
                info: 'Cash · ' + (s.customer_name || 'Walk-in'),
                amount: parseFloat(s.total || 0)
            }));
            anomalies.push({
                id: 'high_value_cash',
                severity: 'info',
                title: 'High-value cash sales (> RM 500)',
                desc: flagged.length + ' cash transaction' + (flagged.length>1?'s':'') + ' above RM 500. Bank deposit needed; risk of staff carrying large cash.',
                icon: 'banknote',
                iconBg: '#3B82F6',
                count: flagged.length,
                items,
                suggestion: 'Encourage card/QR for high-value sales. Bank deposit large cash same-day untuk reduce safe risk.'
            });
        }
    } catch(e) {}

    // === RULE 7: Post-EOD sale (created after EOD lock) ===
    try {
        const eodLocks = []; // future: read from finance_records or audit_logs
        // For now just check if sale created at unusual hour (>10pm)
        const veryLate = inWindow.filter(s => {
            const d = new Date(s.created_at);
            return d.getHours() >= 23 || d.getHours() < 6;
        });
        if(veryLate.length >= 2) {
            const items = veryLate.slice(0, 50).map(s => ({
                date: new Date(s.created_at).toLocaleString('en-MY', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }),
                staff: s.staff_name || '?',
                info: 'Possible after-EOD entry',
                amount: parseFloat(s.total || 0)
            }));
            anomalies.push({
                id: 'post_eod_sale',
                severity: 'warning',
                title: 'Sales between 11pm–6am',
                desc: veryLate.length + ' transaction' + (veryLate.length>1?'s':'') + ' very late or very early. Verify if backfill or unauthorised.',
                icon: 'moon',
                iconBg: '#F59E0B',
                count: veryLate.length,
                items,
                suggestion: 'Lock POS sales after EOD close. Backfill should require Manager PIN with reason.'
            });
        }
    } catch(e) {}

    return anomalies;
}

window.renderAuditAlerts = function() {
    const wrap = document.getElementById('auditAlertsSection');
    if(!wrap) return;
    const anomalies = __aaComputeAnomalies();
    const reviewed = __aaLoadReviewed();

    // Summary
    let crit = 0, warn = 0, info = 0;
    anomalies.forEach(a => {
        if(reviewed.has(a.id) && !window.__aaShowReviewed) return;
        if(a.severity === 'critical') crit++;
        else if(a.severity === 'warning') warn++;
        else info++;
    });
    const sumEl = document.getElementById('aaSummary');
    if(sumEl) {
        if(crit + warn + info === 0) {
            sumEl.innerHTML = '<span class="aa-sum-clean">All clean — no anomalies in this window</span>';
        } else {
            sumEl.innerHTML = (crit ? `<span class="aa-sum-critical">${crit} critical</span>` : '')
                + (warn ? `<span class="aa-sum-warning">${warn} warning</span>` : '')
                + (info ? `<span class="aa-sum-info">${info} info</span>` : '');
        }
    }

    // Update sidebar badge (only critical + warning)
    const badge = document.getElementById('auditAlertBadge');
    if(badge) {
        const total = crit + warn;
        if(total > 0) { badge.style.display = 'inline-block'; badge.textContent = total; }
        else { badge.style.display = 'none'; }
    }

    // Filter
    const visible = anomalies.filter(a => window.__aaShowReviewed || !reviewed.has(a.id));

    const listEl = document.getElementById('aaAlertsList');
    if(!listEl) return;
    if(!visible.length) {
        const period = window.__aaPeriod === 'today' ? 'today' : window.__aaPeriod === '30d' ? 'last 30 days' : 'last 7 days';
        listEl.innerHTML = '<div class="aa-empty"><strong>All clean</strong>No anomalies detected for ' + period + '. Either operations are smooth or rules need tuning for your scale.</div>';
        if(typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
        return;
    }

    // Sort by severity (critical first)
    const sevOrder = { critical: 0, warning: 1, info: 2 };
    visible.sort((a, b) => (sevOrder[a.severity] || 9) - (sevOrder[b.severity] || 9));

    listEl.innerHTML = visible.map(a => {
        const isRev = reviewed.has(a.id);
        const fmtRM = window.formatRM || (n => 'RM ' + (parseFloat(n)||0).toFixed(2));
        const itemsHtml = (a.items || []).map(it => `
            <div class="aa-detail-row">
                <span class="aa-detail-row__date">${it.date}</span>
                <span class="aa-detail-row__staff">${it.staff}</span>
                <span class="aa-detail-row__info">${it.info || ''}</span>
                <span class="aa-detail-row__amt ${(it.amount||0) < 0 ? 'aa-detail-row__amt--neg' : ''}">${(it.amount||0) !== 0 ? fmtRM(it.amount) : '—'}</span>
            </div>
        `).join('');
        return `<div class="aa-card ${isRev ? 'is-reviewed' : ''}" data-aa-id="${a.id}">
            <div class="aa-card__head" onclick="window.aaToggleCard('${a.id}')">
                <div class="aa-card__icon" style="background:${a.iconBg};">
                    <i data-lucide="${a.icon}" style="width:18px; height:18px;"></i>
                </div>
                <div class="aa-card__main">
                    <div class="aa-card__title">${a.title}<span class="aa-card__sev aa-card__sev--${a.severity}">${a.severity}</span></div>
                    <div class="aa-card__desc">${a.desc}</div>
                </div>
                <div class="aa-card__count">${a.count}</div>
                <button class="aa-card__expand">▾</button>
            </div>
            <div class="aa-card__body">
                <div class="aa-card__details">${itemsHtml || '<div style="padding:14px; text-align:center; color:#9CA3AF; font-size:12px;">No detail rows.</div>'}</div>
                <div class="aa-card__footer">
                    <div class="aa-suggestion">${a.suggestion}</div>
                    ${isRev
                        ? `<button class="aa-card__act aa-card__act--unreview" onclick="window.aaMarkReviewed('${a.id}', false)">Unmark</button>`
                        : `<button class="aa-card__act aa-card__act--review" onclick="window.aaMarkReviewed('${a.id}', true)">✓ Mark reviewed</button>`}
                </div>
            </div>
        </div>`;
    }).join('');
    if(typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
};

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector('[data-tab="admin_audit_alerts"]');
    if(btn) btn.addEventListener('click', () => setTimeout(window.renderAuditAlerts, 100));
    // Initial badge update on app boot
    setTimeout(() => { try { window.renderAuditAlerts(); } catch(e){} }, 3000);
});

// =============================================================
// p1_30 — System Test Guide (QA checklist for shipped features)
// =============================================================
window.TG_KEY = 'testGuideStatus_v1';
window.__tgFilter = 'all';

window.TG_TESTS = [
    { phase: 'Phase 1: Stabilize', id: 'p1_22', title: 'PIN-only login (auto-detect user)',
      steps: [
        'Logout dari mana-mana session',
        'Klik butang "Internal Mode" / "Staff Login" kat header',
        'Modal terbuka dengan PIN dots ●●●○○○',
        'Type any valid PIN (cuba 1999 atau 8888)',
        'Tunggu 400ms — auto-submit kena fire'
      ],
      expected: 'Welcome screen muncul dengan name yang betul; tak perlu pilih nama dari dropdown.'
    },
    { phase: 'Phase 1: Stabilize', id: 'p1_22-fail', title: 'PIN-only login wrong PIN handling',
      steps: [
        'Buka login modal',
        'Type random wrong PIN (e.g. 0000)',
        'Tunggu auto-submit'
      ],
      expected: 'Error message generic "PIN salah. Cubaan tinggal: N". 10× wrong → device lock 5 min.'
    },
    { phase: 'Phase 1: Stabilize', id: 'p1_25', title: 'Tester persona (PIN 8888)',
      steps: [
        'Login dengan PIN 8888',
        'Welcome screen tunjuk "Tester · External Demo Account"',
        'Lepas auto-dismiss, tengok mode bar'
      ],
      expected: 'Hanya tab "Kaunter" visible. Tab Pengurus/Pengurusan/Investor hidden. Landing kat POS Cashier.'
    },
    { phase: 'Phase 1: Stabilize', id: 'p1_26', title: 'Welcome screen redesign',
      steps: [
        'Logout, login mana-mana role',
        'Perhatikan welcome overlay',
        'Tengok greeting (Selamat pagi/tengahari/petang/malam ikut waktu)',
        'Tengok avatar warna ikut tier role',
        'Tunggu progress bar drain (~2.4s)'
      ],
      expected: 'Navy/orange gradient bg + dot pattern; tier-coloured avatar dengan pulse + ring; tagline ikut role; mode chip; smooth fade in/out.'
    },
    { phase: 'Phase 1: Stabilize', id: 'p1_27', title: 'Default landing flip',
      steps: [
        'Login Bos (1999) → check landing',
        'Logout, login Aliff (1111) → check landing',
        'Logout, login Tarmizi (6666) → check landing',
        'Logout, login brolantodak (1102) → check landing'
      ],
      expected: 'Bos→Finance Dashboard, Aliff→POS Cashier, Tarmizi→POS Cashier (NOT Browse Products), brolantodak→Investor Dashboard.'
    },
    { phase: 'Phase 1: Stabilize', id: 'p1_19', title: 'Memo Board with approval workflow',
      steps: [
        'Login any non-superior staff',
        'Sidebar atas → Memo Board',
        'Klik "Memo Baru" → tulis title + body → Submit',
        'Tab "Memo Saya" tunjuk memo dengan status pending',
        'Logout, login Bos',
        'Memo Board → tab Pending Approval (red badge sidebar)',
        'Klik Approve atau Reject (kalau reject, isi sebab)'
      ],
      expected: 'Memo workflow: pending → approved/rejected. Bos sahaja boleh approve. Rejected shows reason. Approved memos appear di tab Approved untuk semua orang nampak.'
    },
    { phase: 'Phase 1: Stabilize', id: 'p1_18', title: 'Management mode (4th tab)',
      steps: [
        'Login Bos (1999)',
        'Default landing kena di Pengurusan mode (gold tab dengan crown icon)',
        'Sidebar tunjuk HR Department + Finance Department only',
        'Klik tab "Pengurus" → sidebar tukar ke Admin Dept'
      ],
      expected: 'Mode bar ada 4-5 tabs (Kaunter/Operasi/Pengurus/Pengurusan + Investor untuk Bos). HR + Finance segregated dari operational Manager mode.'
    },
    { phase: 'Phase 1: Stabilize', id: 'p1_20', title: 'Per-mode access checkbox',
      steps: [
        'Login Bos → Pengurusan → HR → Staff Management',
        'Edit mana-mana staff (e.g. Aliff)',
        'Scroll sampai jumpa "Mode Access" card kuning',
        'Tengok 4-5 checkbox: Kaunter / Operasi / Pengurus / Pengurusan / Investor',
        'Tick/untick → save'
      ],
      expected: 'Hanya Bos boleh ubah. Staff lain edit modal tunjuk checkbox disabled. Self-revoke trigger confirm dialog.'
    },
    { phase: 'Phase 1: Stabilize', id: 'p1_21', title: 'Investor Mode dashboard',
      steps: [
        'Logout, login PIN 1102 (brolantodak)',
        'Auto-landing kat Investor Dashboard'
      ],
      expected: 'Navy/gold hero dengan health score ring (grade A-F). Cap Table strip 51% brolantodak / 49% Zaid. 6 KPI cards (ARR, MTD, Margin, Burn, Runway). Growth + unit economics + inventory + risk radar sections. Strategic outlook auto-generated.'
    },
    { phase: 'Phase 1: Stabilize', id: 'p1_23', title: 'Public landing page',
      steps: [
        'Logout sepenuhnya',
        'Browse main page (https://pos-system-test.netlify.app/)',
        'Scroll: header logo, hero hikers, brands marquee, collections, products, about, newsletter, footer'
      ],
      expected: 'Logo PNG kat header. Hero dengan hikers bg + tagline "Healing in style with 10 CAMP" + 2 CTA. Brands marquee auto-scroll 11 logo. Featured collections (UNITY apparel + Naturehike + Sale).'
    },
    { phase: 'Phase 1: Stabilize', id: 'p1_24', title: 'POS Product Detail Modal',
      steps: [
        'Login any cashier → POS Cashier',
        'Klik gambar atau nama mana-mana produk',
        'Modal terbuka — tengok gallery, description, variants, specs grid, add-to-cart'
      ],
      expected: 'Gallery dengan thumbnails strip + ‹/› nav + counter "n/m". Title clean (no SKU prefix). 2-col specs grid. Stock pill colored (green/amber/red). Variants pills kalau ada parent_sku siblings. ESC tutup, arrow keys cycle images.'
    },
    { phase: 'Phase 1: Stabilize', id: 'p1_28', title: 'Product Database redesign',
      steps: [
        'Login Bos → Pengurus mode',
        'Sidebar Inventory → Browse Products',
        'Tengok header (live/draft inline counts)',
        'Filter bar (search + brand + category + sort + per-page)',
        'Status pills: All / Live / Draft / OOS / Low Stock / No Image',
        'Klik mana-mana pill → list filter, active chips appear',
        '5-stat row at top'
      ],
      expected: 'Bersih, scan-friendly. Default filter "All" (bukan Draft). Bin Import + Danger Zone TIADA dalam page ni (moved to Bulk Ops).'
    },
    { phase: 'Phase 1: Stabilize', id: 'p1_29-push', title: 'EasyStore push (POS sale → online stock)',
      steps: [
        'Login any cashier → POS',
        'Add cheap item to cart (e.g. CD082 RM 8)',
        'Open browser DevTools → Network tab',
        'Checkout dengan Cash payment',
        'Confirm sale',
        'Cari POST /api/easystore-push dalam Network'
      ],
      expected: 'Response succeeded:1, before/after qty values shown. Login EasyStore admin → variant qty turun -1.'
    },
    { phase: 'Phase 1: Stabilize', id: 'p1_29-webhook', title: 'EasyStore webhook (online order → POS)',
      steps: [
        'Buka 10camp.com sebagai customer',
        'Add cheap item to cart, checkout, pay',
        'Tunggu ~5 saat',
        'Login Bos → Tanya 10 CAMP AI tab',
        'Tanya: "Latest order from website?"'
      ],
      expected: 'Order baru appear dalam sales_history dengan channel "EasyStore Online" + metadata.migrated_from = "easystore_webhook". Inventory_batches qty turun untuk SKU yang dibeli.'
    },
    { phase: 'Phase 4: Operations', id: 'p4_5', title: 'EOD Close / Z-Report',
      steps: [
        'Login Bos → Pengurusan',
        'Finance Dashboard → "EOD Close" button',
        'Manager PIN required',
        'Z-Report generated'
      ],
      expected: 'Daily Z-report print window open dengan sales by payment/channel/staff. Persisted to finance_records + audit_logs.'
    },
    { phase: 'Phase 4: Operations', id: 'p4_3', title: 'Manager Dashboard',
      steps: [
        'Login Bos → Pengurus mode',
        'Admin Dept → Manager Dashboard'
      ],
      expected: '5 KPI cards (revenue, orders, AOV, etc), period filter buttons, revenue chart, channel mix donut, top SKUs, top staff, low-stock alerts, top customers.'
    },
    { phase: 'Phase 7: Growth & Loyalty', id: 'p7_2', title: 'Re-engage Campaign',
      steps: [
        'Login Bos → Pengurus → Admin Dept → Re-engage Campaign',
        '3 tier cards (Sleeping/Cold/Lost) tunjuk count + value',
        'Klik mana-mana tier (e.g. Cold)',
        'Tengok customer list with checkbox',
        'Select 2-3 customers',
        'Klik "Send next 10 via WhatsApp"'
      ],
      expected: 'Confirm dialog. Lepas confirm, batch WhatsApp tabs open (200ms stagger). Activity logged. Re-test selepas 1 min: customers yang dah dimessage akan tag SENT-Nd-AGO + checkbox disabled.'
    },
    { phase: 'Phase 7: Growth & Loyalty', id: 'p7_1', title: 'Loyalty tier auto-detect',
      steps: [
        'Login any cashier → POS',
        'Customer search by phone (existing customer >3 orders = Bronze)',
        'Add to cart, proceed to checkout',
        'Tengok price modal'
      ],
      expected: 'Tier badge displayed (Bronze/Silver/Gold based on order count: 3-9/10-29/30+). Auto-discount applied per tier %.'
    },
    { phase: 'Phase 8: Intelligence', id: 'p8_3', title: 'Tanya 10 CAMP AI',
      steps: [
        'Login Bos → Pengurus → Admin Dept → Tanya 10 CAMP',
        'Type question (e.g. "Top 5 SKU bulan ni?")',
        'Send'
      ],
      expected: 'Response dari Claude Haiku 4.5 dengan answer berdasarkan auto-built context (sales 7d/30d, top products, low stock, top customers). Memerlukan ANTHROPIC_API_KEY env var di Netlify.'
    },
    { phase: 'Phase 2: Compliance', id: 'p2_2', title: 'DuitNow QR generator',
      steps: [
        'Login → POS → Add item to cart',
        'Checkout → pilih DuitNow QR sebagai payment',
        'QR code generate'
      ],
      expected: 'EMVCo TLV QR generated dengan CRC-16/CCITT. Customer scan dengan banking app, ref# entered untuk confirm.'
    }
];

function __tgLoadStatus() {
    try { return JSON.parse(localStorage.getItem(window.TG_KEY) || '{}'); }
    catch(e) { return {}; }
}
function __tgSaveStatus(s) {
    try { localStorage.setItem(window.TG_KEY, JSON.stringify(s)); } catch(e){}
}

window.tgFilter = function(f, btn) {
    window.__tgFilter = f;
    document.querySelectorAll('.tg-pill').forEach(b => b.classList.toggle('tg-pill--active', b === btn));
    window.renderTestGuide();
};

window.tgSetStatus = function(testId, status) {
    const all = __tgLoadStatus();
    if(status === 'reset') delete all[testId];
    else all[testId] = { status, ts: new Date().toISOString() };
    __tgSaveStatus(all);
    window.renderTestGuide();
};

window.tgSetNote = function(testId, note) {
    const all = __tgLoadStatus();
    all[testId] = Object.assign({}, all[testId] || {}, { note, ts: new Date().toISOString() });
    __tgSaveStatus(all);
};

window.tgToggleTest = function(testId) {
    const el = document.querySelector('[data-tg-id="' + testId + '"]');
    if(el) el.classList.toggle('is-open');
};

window.tgExpandAll = function() {
    document.querySelectorAll('.tg-test').forEach(el => el.classList.add('is-open'));
};
window.tgCollapseAll = function() {
    document.querySelectorAll('.tg-test').forEach(el => el.classList.remove('is-open'));
};

window.tgResetAll = function() {
    if(!confirm('Reset SEMUA test status (passed + failed + notes)? Tindakan ini tidak boleh dibatalkan.')) return;
    localStorage.removeItem(window.TG_KEY);
    if(typeof showToast === 'function') showToast('All test status cleared', 'success');
    window.renderTestGuide();
};

window.tgExportReport = function() {
    const status = __tgLoadStatus();
    const lines = [];
    lines.push('# 10 CAMP POS — System Test Report');
    lines.push('Generated: ' + new Date().toLocaleString('en-MY'));
    lines.push('Tester: ' + ((window.currentUser || {}).name || 'unknown'));
    lines.push('');
    const phases = {};
    window.TG_TESTS.forEach(t => {
        if(!phases[t.phase]) phases[t.phase] = [];
        phases[t.phase].push(t);
    });
    Object.keys(phases).forEach(ph => {
        lines.push('## ' + ph);
        phases[ph].forEach(t => {
            const s = status[t.id] || {};
            const sym = s.status === 'passed' ? '[PASS]' : s.status === 'failed' ? '[FAIL]' : '[ ]';
            lines.push(`${sym} ${t.id} — ${t.title}`);
            if(s.note) lines.push(`     Note: ${s.note}`);
        });
        lines.push('');
    });
    const text = lines.join('\n');
    if(navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            if(typeof showToast === 'function') showToast('Report copied to clipboard', 'success');
        });
    } else {
        alert(text);
    }
};

window.renderTestGuide = function() {
    const status = __tgLoadStatus();
    const total = window.TG_TESTS.length;
    let passed = 0, failed = 0, untested = 0;
    window.TG_TESTS.forEach(t => {
        const s = (status[t.id] || {}).status;
        if(s === 'passed') passed++;
        else if(s === 'failed') failed++;
        else untested++;
    });

    // Summary pills
    const sumEl = document.getElementById('tgSummary');
    if(sumEl) {
        sumEl.innerHTML = `
            <span class="tg-sum-pass">${passed} passed</span>
            <span class="tg-sum-fail">${failed} failed</span>
            <span class="tg-sum-untest">${untested} untested</span>
        `;
    }

    // Progress bar
    const tested = passed + failed;
    const pct = total > 0 ? (tested / total) * 100 : 0;
    const fill = document.getElementById('tgProgressFill');
    if(fill) fill.style.width = pct + '%';
    const lbl = document.getElementById('tgProgressLabel');
    if(lbl) lbl.textContent = tested + ' / ' + total + ' tested (' + pct.toFixed(0) + '%)';

    // Filter
    let visible = window.TG_TESTS;
    if(window.__tgFilter !== 'all') {
        visible = visible.filter(t => {
            const s = (status[t.id] || {}).status;
            if(window.__tgFilter === 'untested') return !s;
            return s === window.__tgFilter;
        });
    }

    // Group by phase
    const phases = {};
    visible.forEach(t => {
        if(!phases[t.phase]) phases[t.phase] = [];
        phases[t.phase].push(t);
    });

    const listEl = document.getElementById('tgList');
    if(!listEl) return;
    if(!visible.length) {
        listEl.innerHTML = '<div style="text-align:center; padding:40px; color:#9CA3AF; font-size:13px;">Tiada test match filter ni.</div>';
        return;
    }

    listEl.innerHTML = Object.keys(phases).map(ph => {
        const tests = phases[ph];
        return `<div class="tg-phase">
            <div class="tg-phase__head">
                <span class="tg-phase__title">${ph}</span>
                <span class="tg-phase__count">${tests.length} test${tests.length>1?'s':''}</span>
            </div>
            ${tests.map(t => {
                const s = status[t.id] || {};
                const cur = s.status;
                const cls = cur === 'passed' ? 'tg-test--passed' : cur === 'failed' ? 'tg-test--failed' : '';
                const statusBadge = cur ? `<span class="tg-test__status tg-test__status--${cur}">${cur}</span>` : `<span class="tg-test__status tg-test__status--untested">untested</span>`;
                const stepsHtml = '<ol class="tg-test__steps">' + t.steps.map(s => '<li>' + s + '</li>').join('') + '</ol>';
                return `<div class="tg-test ${cls}" data-tg-id="${t.id}">
                    <div class="tg-test__head">
                        <div>
                            <span class="tg-test__id">${t.id}</span>
                            <span class="tg-test__title">${t.title}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            ${statusBadge}
                            <button class="tg-test__expand" onclick="window.tgToggleTest('${t.id}')">Expand ▾</button>
                        </div>
                    </div>
                    <div class="tg-test__body">
                        ${stepsHtml}
                        <div class="tg-test__expected"><strong>Expected:</strong> ${t.expected}</div>
                        <div class="tg-test__actions">
                            <button class="tg-test__act tg-test__act--pass ${cur==='passed'?'is-current':''}" onclick="window.tgSetStatus('${t.id}', 'passed')">✓ Pass</button>
                            <button class="tg-test__act tg-test__act--fail ${cur==='failed'?'is-current':''}" onclick="window.tgSetStatus('${t.id}', 'failed')">✗ Fail</button>
                            ${cur ? `<button class="tg-test__act tg-test__act--reset" onclick="window.tgSetStatus('${t.id}', 'reset')">Reset</button>` : ''}
                            ${s.ts ? `<span style="font-size:10px; color:#9CA3AF; margin-left:auto;">Last: ${new Date(s.ts).toLocaleString('en-MY', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>` : ''}
                        </div>
                        <input type="text" class="tg-test__note" placeholder="Note bug atau finding (optional)" value="${(s.note||'').replace(/"/g,'&quot;')}" oninput="window.tgSetNote('${t.id}', this.value)">
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    }).join('');
};

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector('[data-tab="admin_test_guide"]');
    if(btn) btn.addEventListener('click', () => setTimeout(window.renderTestGuide, 100));
});

// =============================================================
// p7_2 — Re-engage Campaign (auto-detect dormant + tier outreach)
// =============================================================
window.RE_LOG_KEY = 'reengageLog_v1';
window.RE_SPAM_GUARD_DAYS = 30; // skip customer if messaged within this window
window.__reCurrentTier = null;
window.__reSelected = new Set();
window.__reSendCursor = 0;

window.RE_TEMPLATES = {
    sleeping: 'Hi {name}, dah {last_order_days} hari tak nampak kat 10 CAMP! \n\nStok baru sampai — Naturehike, Mobi Garden, Chanodug. Mungkin ada gear baru yang sesuai untuk next adventure.\n\nSinggah online: 10camp.com\nAtau drop by kedai Cyberjaya.\n\nTeam 10 CAMP',
    cold: 'Hi {name}, dah {last_order_days} hari tak ada update dari kami. Kami terlepas pandang ke?\n\nNak tarik balik perhatian — *RM10 off* untuk pembelian RM 100+.\nCode: *{promo_code}*\nValid 14 hari je.\n\nShop: 10camp.com\n\nNak tanya apa-apa, reply mesej ni.',
    lost: 'Hi {name}, dah {last_order_days} hari... rindu sangat customer macam awak.\n\nSatu offer terakhir untuk welcome you back — *20% off* satu store, no minimum.\nCode: *{promo_code}*\nValid 7 hari sahaja, satu kali pakai.\n\nShop: 10camp.com\n\nKalau dah tak berminat, no hard feelings. Kalau still suka outdoor — adventure menunggu kat sini.\n\nTerima kasih atas semua memori dengan 10 CAMP.'
};

window.RE_SUGGESTED_PROMO = {
    sleeping: 'COMEBACK',
    cold: 'WELCOME10',
    lost: 'MISSYOU20'
};

function __reLoadLog() {
    try { return JSON.parse(localStorage.getItem(window.RE_LOG_KEY) || '[]'); }
    catch(e) { return []; }
}
function __reSaveLog(arr) {
    try { localStorage.setItem(window.RE_LOG_KEY, JSON.stringify(arr.slice(-200))); } catch(e){}
}

// Returns ms-since-last-engagement-message-to-this-customer, or Infinity if never
function __reLastMessagedMs(customerKey) {
    const log = __reLoadLog();
    let mostRecent = 0;
    log.forEach(entry => {
        (entry.targets || []).forEach(t => {
            if(t === customerKey) {
                const ts = new Date(entry.ts).getTime();
                if(ts > mostRecent) mostRecent = ts;
            }
        });
    });
    if(!mostRecent) return Infinity;
    return Date.now() - mostRecent;
}

function __reCustomerKey(c) {
    return c.phone || c.email || c.id || c.name;
}

// Tier customers by days since last_order_at
window.reTierCustomers = function() {
    const out = { sleeping: [], cold: [], lost: [] };
    if(typeof customersData === 'undefined' || !Array.isArray(customersData)) return out;
    const now = Date.now();
    customersData.forEach(c => {
        if(!c.phone) return; // can't message via wa.me
        if(!c.last_order_at) return; // no purchase history
        const days = (now - new Date(c.last_order_at).getTime()) / (24*3600*1000);
        if(days >= 30 && days < 60) out.sleeping.push(c);
        else if(days >= 60 && days < 90) out.cold.push(c);
        else if(days >= 90) out.lost.push(c);
    });
    return out;
};

window.renderReengage = function() {
    const tiers = window.reTierCustomers();
    const fmt = window.formatRMShort || (n => 'RM ' + Math.round(n));
    ['sleeping', 'cold', 'lost'].forEach(t => {
        const list = tiers[t];
        const cntEl = document.getElementById('reCount' + t.charAt(0).toUpperCase() + t.slice(1));
        const valEl = document.getElementById('reValue' + t.charAt(0).toUpperCase() + t.slice(1));
        if(cntEl) cntEl.textContent = list.length;
        if(valEl) valEl.textContent = fmt(list.reduce((s, c) => s + (parseFloat(c.total_spent) || 0), 0));
    });
    // Render history
    const histEl = document.getElementById('reHistoryList');
    if(histEl) {
        const log = __reLoadLog().slice(-10).reverse();
        if(!log.length) {
            histEl.innerHTML = '<p class="re-empty">No re-engagement campaigns sent yet.</p>';
        } else {
            histEl.innerHTML = log.map(e => `
                <div class="re-history-row">
                    <span>${new Date(e.ts).toLocaleString('en-MY', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
                    <span style="font-weight:700; text-transform:uppercase; color:${e.tier==='sleeping'?'#B45309':e.tier==='cold'?'#C2410C':'#991B1B'};">${e.tier}</span>
                    <span style="color:#6B7280;">to ${(e.targets||[]).length} customer${(e.targets||[]).length>1?'s':''} · code ${e.promo || '—'}</span>
                    <span style="text-align:right; color:#9CA3AF;">${e.sender||'?'}</span>
                </div>
            `).join('');
        }
    }
    // Re-render selected tier list if any
    if(window.__reCurrentTier) window.reSelectTier(window.__reCurrentTier, true);
    if(window.lucide && lucide.createIcons) lucide.createIcons();
};

window.reSelectTier = function(tier, suppressScroll) {
    window.__reCurrentTier = tier;
    window.__reSelected = new Set();
    window.__reSendCursor = 0;
    document.querySelectorAll('.re-tier').forEach(el => el.classList.toggle('is-active', el.dataset.tier === tier));
    document.getElementById('reDetail').style.display = 'block';

    const labels = {
        sleeping: 'Sleeping customers (30–59 days)',
        cold: 'Cold customers (60–89 days)',
        lost: 'Lost customers (90+ days)'
    };
    document.getElementById('reDetailTitle').textContent = labels[tier];
    document.getElementById('reTierLabel').textContent = '· ' + tier + ' tier';

    const ta = document.getElementById('reMessage');
    if(ta) ta.value = window.RE_TEMPLATES[tier] || '';
    const promoEl = document.getElementById('rePromoCode');
    if(promoEl) promoEl.value = window.RE_SUGGESTED_PROMO[tier] || '';

    // Filter eligible (skip those messaged within spam guard window)
    const tiers = window.reTierCustomers();
    const list = tiers[tier] || [];
    const guardMs = window.RE_SPAM_GUARD_DAYS * 24 * 3600 * 1000;
    const annotated = list.map(c => {
        const lastMs = __reLastMessagedMs(__reCustomerKey(c));
        const daysSinceMsg = lastMs === Infinity ? null : Math.floor(lastMs / (24*3600*1000));
        const skip = lastMs < guardMs;
        return { c, lastMs, daysSinceMsg, skip };
    });
    const eligible = annotated.filter(x => !x.skip);
    document.getElementById('reEligibleCount').textContent = eligible.length + ' of ' + list.length;

    // Sort: highest spender first
    annotated.sort((a, b) => (parseFloat(b.c.total_spent)||0) - (parseFloat(a.c.total_spent)||0));

    const listEl = document.getElementById('reList');
    const fmt = window.formatRMShort || (n => 'RM ' + Math.round(n));
    if(!annotated.length) {
        listEl.innerHTML = '<p class="re-empty">No customers in this tier. Excellent — no one falling through the cracks.</p>';
    } else {
        listEl.innerHTML = annotated.map(x => {
            const c = x.c;
            const days = Math.floor((Date.now() - new Date(c.last_order_at).getTime()) / (24*3600*1000));
            const key = __reCustomerKey(c).replace(/'/g, "\\'");
            const dayClass = tier === 'sleeping' ? 'sleeping' : tier === 'cold' ? 'cold' : 'lost';
            const skipTag = x.skip ? `<span class="re-row__skip-tag">SENT ${x.daysSinceMsg}d AGO</span>` : '';
            return `
                <label class="re-row" data-key="${key}">
                    <input type="checkbox" ${x.skip ? 'disabled' : ''} onchange="window.reToggleSelect('${key}', this.checked)">
                    <div>
                        <div class="re-row__name">${(c.name || '(no name)').slice(0, 40)}</div>
                        <div class="re-row__phone">${c.phone || ''}</div>
                    </div>
                    <div style="text-align:right;">
                        <div class="re-row__days re-row__days--${dayClass}">${days}d ago</div>
                        <div style="font-size:10px; color:#9CA3AF;">${c.total_orders || 0} order${(c.total_orders||0)>1?'s':''}</div>
                    </div>
                    <div class="re-row__spent">${fmt(c.total_spent || 0)}</div>
                    ${skipTag || '<span></span>'}
                </label>
            `;
        }).join('');
    }
    window.reUpdateSelectionUI();
    if(!suppressScroll) document.getElementById('reDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.reToggleSelect = function(key, checked) {
    if(checked) window.__reSelected.add(key);
    else window.__reSelected.delete(key);
    document.querySelectorAll('.re-row').forEach(r => r.classList.toggle('is-checked', window.__reSelected.has(r.dataset.key)));
    window.reUpdateSelectionUI();
};

window.reSelectAllVisible = function() {
    document.querySelectorAll('.re-row input[type="checkbox"]:not(:disabled)').forEach(cb => {
        cb.checked = true;
        const row = cb.closest('.re-row');
        if(row) {
            window.__reSelected.add(row.dataset.key);
            row.classList.add('is-checked');
        }
    });
    window.reUpdateSelectionUI();
};

window.reClearSelection = function() {
    window.__reSelected = new Set();
    window.__reSendCursor = 0;
    document.querySelectorAll('.re-row input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('.re-row').forEach(r => r.classList.remove('is-checked'));
    window.reUpdateSelectionUI();
};

window.reUpdateSelectionUI = function() {
    const cnt = window.__reSelected.size;
    document.getElementById('reSelectedCount').textContent = cnt;
    let totalRev = 0;
    customersData.forEach(c => {
        if(window.__reSelected.has(__reCustomerKey(c))) totalRev += parseFloat(c.total_spent) || 0;
    });
    const fmt = window.formatRMShort || (n => 'RM ' + Math.round(n));
    document.getElementById('reSelectedRev').textContent = fmt(totalRev);
    const btn = document.getElementById('reSendBtn');
    if(btn) btn.disabled = cnt === 0;
};

window.reSendBatch = function() {
    if(!window.__reSelected.size) return;
    const tier = window.__reCurrentTier;
    const tplText = document.getElementById('reMessage').value;
    const promo = (document.getElementById('rePromoCode').value || 'PROMO').trim();
    if(!tplText.trim()) {
        if(typeof showToast === 'function') showToast('Tulis template message dulu', 'warn');
        return;
    }

    // Build target list of customer objects
    const selectedKeys = Array.from(window.__reSelected);
    const targets = selectedKeys.map(k => customersData.find(c => __reCustomerKey(c) === k)).filter(Boolean);
    if(!targets.length) return;

    const start = window.__reSendCursor;
    const end = Math.min(start + 10, targets.length);
    const batch = targets.slice(start, end);

    if(!batch.length) {
        if(typeof showToast === 'function') showToast('Re-engage campaign complete', 'success');
        return;
    }

    if(start === 0) {
        if(!confirm(`Open ${batch.length} WhatsApp tabs untuk customer #1-${end}? (Total: ${targets.length})\n\nMessage tier: ${tier}\nPromo code: ${promo}`)) return;
    }

    batch.forEach((c, i) => {
        const phoneNorm = String(c.phone).replace(/\D/g, '').replace(/^0/, '60');
        const text = (typeof __waFillVars === 'function')
            ? __waFillVars(tplText, c, promo)
            : tplText.replace(/\{name\}/g, (c.name||'').split(' ')[0] || 'kawan').replace(/\{promo_code\}/g, promo);
        const url = `https://wa.me/${phoneNorm}?text=${encodeURIComponent(text)}`;
        setTimeout(() => window.open(url, '_blank'), i * 200);
    });

    // Log this batch
    const log = __reLoadLog();
    log.push({
        ts: new Date().toISOString(),
        tier,
        promo,
        targets: batch.map(c => __reCustomerKey(c)),
        sender: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.name : 'unknown'
    });
    __reSaveLog(log);

    window.__reSendCursor = end;
    const remaining = targets.length - end;
    if(typeof showToast === 'function') {
        showToast('Sent batch ' + (start+1) + '–' + end + ' of ' + targets.length + (remaining > 0 ? ' (klik Send lagi untuk continue)' : ' — DONE'), 'success');
    }

    // Audit log to Supabase (best-effort)
    try {
        if(typeof db !== 'undefined' && db && db.from) {
            db.from('audit_logs').insert([{
                action_type: 'reengage_send',
                actor_name: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.name : 'System',
                details: JSON.stringify({ tier, promo, batch_size: batch.length, total_in_campaign: targets.length, batch_index: start+1 }),
                created_at: new Date().toISOString()
            }]).then(()=>{}).catch(()=>{});
        }
    } catch(e){}

    if(remaining === 0) {
        // Refresh tier view to reflect anti-spam tags
        setTimeout(() => window.renderReengage(), 500);
    }
};

// Initial render hook when section opens
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector('[data-tab="admin_reengage"]');
    if(btn) btn.addEventListener('click', () => setTimeout(window.renderReengage, 100));
});

// =============================================================
// p3_2 — WhatsApp Broadcast (wa.me click-to-send · batched)
// =============================================================
const WA_TEMPLATES = {
 raya: 'Selamat Hari Raya {name}! \n\nSpecial diskaun *20% off* untuk member 10 CAMP.\nUse code: *{promo_code}*\nValid sampai 30 Apr.\n\nShop online: 10camp.com\n Visit kedai kami di Setapak.\n\nTerima kasih, semoga raya ceria! ',
 cny: 'Gong Xi Fa Cai {name}! \n\nCelebrate dengan diskaun *8% off* satu store.\nCode: *{promo_code}*\nValid sampai 15 Feb.\n\nShop: 10camp.com\n\nMay your year be filled with adventure! ',
 deepavali: 'Happy Deepavali {name}! \n\nDiskaun spesial *15% off* untuk semua camping gear.\nCode: *{promo_code}*\nValid sampai 7 hari.\n\nShop: 10camp.com\n\nTerima kasih, semoga cahaya membawa kebahagiaan! ',
 merdeka: 'Selamat Hari Merdeka {name}! 🇲🇾\n\nMerdeka deal *RM57 off* untuk pembelian RM 300+.\nCode: *{promo_code}*\nValid 28 Aug – 16 Sep.\n\nShop: 10camp.com\n\nMerdeka! Merdeka! Merdeka! ',
 vip_nudge: 'Hi {name}, VIP member 10 CAMP yang dihormati ⭐\n\nAnda ada *{points} points* dalam akaun.\nRedeem untuk diskaun atau free items sebelum expire.\n\nLogin: 10camp.com/account\n\nTerima kasih atas sokongan!',
 reorder_nudge: 'Hi {name} \n\nDah {last_order_days} hari last shopping kat 10 CAMP. Rindu! \n\nKalau nak refresh gear, ada banyak new arrival.\nCheckout: 10camp.com\n\nNak tanya apa-apa? Reply je message ni. ',
 generic: 'Hi {name}! \n\nNew update dari 10 CAMP:\n[Tulis announcement di sini]\n\nUse code *{promo_code}* untuk diskaun (kalau ada).\n\nThanks!\n10 CAMP team'
};

window.__waCurrentMatches = [];

function __waMatchCustomers(filter) {
 if(typeof customersData === 'undefined' || !Array.isArray(customersData)) return [];
 const now = Date.now();
 return customersData.filter(c => {
 if(!c.phone) return false;
 switch(filter) {
 case 'vip': return c.is_member;
 case 'sms_consent': return c.accepts_sms_marketing;
 case 'big_spender': return (c.total_spent || 0)>= 1000;
 case 'dormant': {
 if(!c.last_order_at) return (c.total_orders || 0) === 0;
 const days = (now - new Date(c.last_order_at).getTime()) / (24*3600*1000);
 return days> 60;
 }
 default: return true;
 }
 });
}

function __waFillVars(template, c, promoCode) {
 const days = c && c.last_order_at
 ? Math.floor((Date.now() - new Date(c.last_order_at).getTime()) / (24*3600*1000))
 : 0;
 return template
.replace(/\{name\}/g, (c && (c.name || '').split(' ')[0]) || 'kawan')
.replace(/\{points\}/g, String(c?.points || 0))
.replace(/\{total_spent\}/g, ((c?.total_spent) || 0).toFixed(2))
.replace(/\{last_order_days\}/g, String(days))
.replace(/\{promo_code\}/g, promoCode || 'PROMO');
}

window.__waPreviewMessage = function(skipReset) {
 const tpl = document.getElementById('waTemplate')?.value || 'generic';
 const ta = document.getElementById('waMessage');
 if(!ta) return;
 if(!skipReset) ta.value = WA_TEMPLATES[tpl] || '';
 const promo = document.getElementById('waPromoCode')?.value || 'PROMO';
 const matches = window.__waCurrentMatches.length ? window.__waCurrentMatches : __waMatchCustomers(document.getElementById('waAudience')?.value || 'all');
 const sample = matches[0];
 const previewEl = document.getElementById('waSamplePreview');
 if(previewEl) {
 previewEl.textContent = sample
 ? __waFillVars(ta.value, sample, promo)
 : '(no audience match — pilih filter lain)';
 }
};

window.__waPreviewCount = function() {
 const filter = document.getElementById('waAudience')?.value || 'all';
 window.__waCurrentMatches = __waMatchCustomers(filter);
 const el = document.getElementById('waMatchCount');
 if(el) el.textContent = window.__waCurrentMatches.length;
 window.__waPreviewMessage(true);
};

window.__waSendCursor = 0;

window.__waSendBroadcast = function() {
 const matches = window.__waCurrentMatches.length ? window.__waCurrentMatches : __waMatchCustomers(document.getElementById('waAudience')?.value || 'all');
 if(!matches.length) {
 if(typeof showToast==='function') showToast('Tiada customer match. Pilih filter lain.', 'warn');
 return;
 }
 const tplText = document.getElementById('waMessage')?.value || '';
 const promo = document.getElementById('waPromoCode')?.value || '';
 const start = window.__waSendCursor;
 const end = Math.min(start + 10, matches.length);
 const batch = matches.slice(start, end);

 if(!batch.length) {
 if(typeof showToast==='function') showToast('Broadcast complete ', 'success');
 return;
 }

 if(start === 0) {
 if(!confirm(`Open ${batch.length} WhatsApp tabs untuk customer #1-${end}? (Total: ${matches.length})`)) return;
 }

 batch.forEach((c, i) => {
 const phoneNorm = String(c.phone).replace(/\D/g, '').replace(/^0/, '60');
 const text = __waFillVars(tplText, c, promo);
 const url = `https://wa.me/${phoneNorm}?text=${encodeURIComponent(text)}`;
 // Stagger by 200ms to avoid popup blocker
 setTimeout(() => window.open(url, '_blank'), i * 200);
 });

 window.__waSendCursor = end;
 const remaining = matches.length - end;
 const status = document.getElementById('waSendStatus');
 if(status) {
 status.innerHTML = `
 <div style="background:#F0FDF4; padding:10px; border-radius:6px; border-left:4px solid #10B981;">
 Sent batch ${start+1}–${end} of ${matches.length}.
 ${remaining> 0
 ? `<br><strong>${remaining}</strong> customer left. Klik <em>Send batch</em> untuk continue.`
 : '<br><strong>All done!</strong>'}
 </div>
 `;
 }

 // Log to localStorage
 try {
 const log = JSON.parse(localStorage.getItem('waBroadcastLog_v1') || '[]');
 log.push({
 ts: new Date().toISOString(),
 template: document.getElementById('waTemplate')?.value,
 audience: document.getElementById('waAudience')?.value,
 count: batch.length,
 sender: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.name : 'unknown'
 });
 if(log.length> 100) log.splice(0, log.length - 100);
 localStorage.setItem('waBroadcastLog_v1', JSON.stringify(log));
 } catch(e){}
};

window.__waResetBroadcast = function() {
 window.__waSendCursor = 0;
 const status = document.getElementById('waSendStatus');
 if(status) status.innerHTML = '';
 if(typeof showToast==='function') showToast('Cursor reset ke 0. Klik Send batch untuk start over.', 'success');
};

window.renderWABroadcast = function() {
 window.__waSendCursor = 0;
 window.__waPreviewCount();
 window.__waPreviewMessage();
};

// =============================================================
// p8_3 — Tanya 10 CAMP (Claude API proxy)
// =============================================================
function __askBuildContextSummary() {
 // Build a compact data brief for Claude — summary of sales / inventory / customers
 const lines = [];
 const now = Date.now();

 // ----- SALES (last 7d, last 30d, all-time) -----
 if(typeof salesHistory !== 'undefined' && Array.isArray(salesHistory)) {
 const positive = salesHistory.filter(s => (s.total||0)> 0);
 const last7 = positive.filter(s => s.created_at && (now - new Date(s.created_at).getTime() < 7*24*3600*1000));
 const last30 = positive.filter(s => s.created_at && (now - new Date(s.created_at).getTime() < 30*24*3600*1000));
 const prev30 = positive.filter(s => {
 if(!s.created_at) return false;
 const d = now - new Date(s.created_at).getTime();
 return d>= 30*24*3600*1000 && d < 60*24*3600*1000;
 });
 const sum = arr => arr.reduce((s, x) => s + (x.total||0), 0);
 lines.push('## Sales');
 lines.push(`- Last 7 days: ${last7.length} orders, RM ${sum(last7).toFixed(2)} revenue`);
 lines.push(`- Last 30 days: ${last30.length} orders, RM ${sum(last30).toFixed(2)} revenue`);
 lines.push(`- Prev 30 days (30-60d ago): ${prev30.length} orders, RM ${sum(prev30).toFixed(2)} revenue`);
 lines.push(`- All-time: ${positive.length} orders, RM ${sum(positive).toFixed(2)} revenue`);
 const aov = last30.length ? (sum(last30)/last30.length) : 0;
 lines.push(`- AOV (last 30d): RM ${aov.toFixed(2)}`);

 // Top products last 30d
 const skuTally = {};
 last30.forEach(s => (s.items||[]).forEach(it => {
 const k = it.sku || it.name || 'unknown';
 skuTally[k] = skuTally[k] || { qty: 0, revenue: 0, name: it.name||k };
 skuTally[k].qty += parseInt(it.qty)||0;
 skuTally[k].revenue += (parseFloat(it.price)||0) * (parseInt(it.qty)||0);
 }));
 const topProducts = Object.entries(skuTally).sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,10);
 if(topProducts.length) {
 lines.push('### Top 10 products (last 30d, by revenue):');
 topProducts.forEach(([sku, d]) => {
 lines.push(` - ${d.name} (${sku}): ${d.qty} units, RM ${d.revenue.toFixed(2)}`);
 });
 }
 }

 // ----- INVENTORY (low stock + total qty) -----
 if(typeof inventoryBatches !== 'undefined' && Array.isArray(inventoryBatches) &&
 typeof masterProducts !== 'undefined' && Array.isArray(masterProducts)) {
 const totalQty = inventoryBatches.reduce((s, b) => s + (b.qty_remaining||0), 0);
 const skuQty = {};
 inventoryBatches.forEach(b => {
 if((b.qty_remaining||0)> 0) skuQty[b.sku] = (skuQty[b.sku]||0) + b.qty_remaining;
 });
 const lowStock = masterProducts
.map(p => ({ sku: p.sku, name: p.name, qty: skuQty[p.sku] || 0 }))
.filter(x => x.qty < 5)
.slice(0, 20);
 lines.push('\n## Inventory');
 lines.push(`- Total products in master: ${masterProducts.length}`);
 lines.push(`- Total stock units across all batches: ${totalQty}`);
 if(lowStock.length) {
 lines.push(`### Low stock (qty < 5, max 20 shown):`);
 lowStock.forEach(x => lines.push(` - ${x.name} (${x.sku}): ${x.qty}`));
 }
 }

 // ----- CUSTOMERS (top spenders, total) -----
 if(typeof customersData !== 'undefined' && Array.isArray(customersData)) {
 const sorted = [...customersData].sort((a,b)=>(b.total_spent||0)-(a.total_spent||0));
 const vip = sorted.filter(c => c.is_member).length;
 const b2b = sorted.filter(c => c.is_b2b).length;
 lines.push('\n## Customers');
 lines.push(`- Total customers: ${customersData.length} (VIP: ${vip}, B2B: ${b2b})`);
 lines.push('### Top 10 by lifetime spend (names anonymized):');
 sorted.slice(0,10).forEach((c, i) => {
 const initial = (c.name||'?').split(' ').map(w=>w[0]).join('').slice(0,3);
 lines.push(` - #${i+1} ${initial}*** : RM ${(c.total_spent||0).toFixed(2)} (${c.total_orders||0} orders)`);
 });
 }

 // ----- STAFF perf (sales-by-staff last 30d) -----
 if(typeof salesHistory !== 'undefined' && Array.isArray(salesHistory)) {
 const last30 = salesHistory.filter(s => s.created_at && (now - new Date(s.created_at).getTime() < 30*24*3600*1000) && (s.total||0)>0);
 const staffTally = {};
 last30.forEach(s => {
 const name = s.staff_name || 'Unattributed';
 staffTally[name] = staffTally[name] || { count:0, rev:0 };
 staffTally[name].count++;
 staffTally[name].rev += (s.total||0);
 });
 const staffSorted = Object.entries(staffTally).sort((a,b)=>b[1].rev-a[1].rev);
 if(staffSorted.length) {
 lines.push('\n## Staff performance (last 30d):');
 staffSorted.forEach(([name, d]) => lines.push(` - ${name}: ${d.count} orders, RM ${d.rev.toFixed(2)}`));
 }
 }

 lines.push(`\n## Snapshot generated: ${new Date().toLocaleString('en-MY')}`);
 return lines.join('\n');
}

window.__askExample = function(q) {
 const inp = document.getElementById('askInput');
 if(inp) { inp.value = q; window.__askSend(); }
};

window.__askSend = async function() {
 const inp = document.getElementById('askInput');
 const thread = document.getElementById('askThread');
 if(!inp || !thread) return;
 const q = inp.value.trim();
 if(!q) return;
 inp.value = '';

 // Append user bubble
 const userBubble = document.createElement('div');
 userBubble.className = 'card';
 userBubble.style.cssText = 'padding:12px; background:#EFF6FF; border-left:4px solid #3B82F6;';
 userBubble.innerHTML = `<div style="font-size:11px; color:#1E40AF; font-weight:700; margin-bottom:4px;"> Anda</div><div style="white-space:pre-wrap;">${q.replace(/[<>]/g, c=>({ '<':'&lt;','>':'&gt;'})[c])}</div>`;
 thread.prepend(userBubble);

 // Pending bubble
 const aiBubble = document.createElement('div');
 aiBubble.className = 'card';
 aiBubble.style.cssText = 'padding:12px; background:#F0FDF4; border-left:4px solid #10B981;';
 aiBubble.innerHTML = `<div style="font-size:11px; color:#166534; font-weight:700; margin-bottom:4px;"> 10 CAMP AI</div><div style="color:#666;"><em>Berfikir…</em></div>`;
 thread.prepend(aiBubble);

 try {
 const ctx = __askBuildContextSummary();
 const r = await fetch('/api/ask', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ question: q, context_summary: ctx })
 });
 const data = await r.json();
 if(!r.ok || !data.ok) {
 const errMsg = data.error || 'unknown';
 const help = errMsg.includes('ANTHROPIC_API_KEY')
 ? '<br><small style="color:#666;">Setup: tambah <code>ANTHROPIC_API_KEY</code> di Netlify dashboard → Site settings → Environment variables → Save → Re-deploy.</small>'
 : '';
 aiBubble.innerHTML = `<div style="font-size:11px; color:#991B1B; font-weight:700; margin-bottom:4px;"> Error</div><div>${errMsg}${help}</div>`;
 return;
 }
 const ans = (data.answer||'').replace(/[<>]/g, c=>({ '<':'&lt;','>':'&gt;'})[c]);
 const formatted = ans.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
 aiBubble.innerHTML = `<div style="font-size:11px; color:#166534; font-weight:700; margin-bottom:4px;"> 10 CAMP AI <span style="font-weight:400; color:#999;">· ${data.usage_input||0} in / ${data.usage_output||0} out tokens</span></div><div>${formatted}</div>`;
 } catch(e) {
 aiBubble.innerHTML = `<div style="font-size:11px; color:#991B1B; font-weight:700; margin-bottom:4px;"> Network error</div><div>${(e.message||'').slice(0,200)}</div>`;
 }
};

window.renderAskSection = async function() {
 // Probe API status
 const statusEl = document.getElementById('askApiStatus');
 if(statusEl) {
 statusEl.innerHTML = '<em>Checking API…</em>';
 try {
 const r = await fetch('/api/ask');
 const d = await r.json();
 if(d.ok && d.api_key_configured) {
 statusEl.innerHTML = ` AI ready · model: <code>${d.model}</code>`;
 statusEl.style.color = '#10B981';
 } else if(d.ok && !d.api_key_configured) {
 statusEl.innerHTML = ` <code>ANTHROPIC_API_KEY</code> not set in Netlify env vars. <a href="https://app.netlify.com" target="_blank">Setup →</a>`;
 statusEl.style.color = '#D97706';
 } else {
 statusEl.innerHTML = ` API endpoint not deployed yet (waiting for Netlify build).`;
 statusEl.style.color = '#D97706';
 }
 } catch(e) {
 statusEl.innerHTML = ` Network: ${e.message}. Try after deploy.`;
 statusEl.style.color = '#DC2626';
 }
 }
};

// ============= p1_38 PERMISSIONS CENTRE =============
// Bos-only matrix view + audit trail for per-staff mode access.
// Source of truth: staffModeAccess_v1 localStorage. Audit: audit_logs Supabase
// (action_type='update_mode_access'). Reuses existing overlay format from p1_20.
(function(){
 const PERM_MODES = ['cashier','operations','manager','hq','investor'];
 const PERM_LABELS = { cashier:'Kaunter', operations:'Operasi', manager:'Pengurus', hq:'HQ', investor:'Investor' };

 function escAttr(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
 function actor() { return window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null); }
 function isSuperior() { const a = actor(); return !!(a && a.role === 'superior'); }
 function readOverlay() { try { return JSON.parse(localStorage.getItem('staffModeAccess_v1') || '{}'); } catch(e) { return {}; } }
 function writeOverlay(map) { try { localStorage.setItem('staffModeAccess_v1', JSON.stringify(map)); } catch(e){} }
 function inactiveSet() {
 try { return new Set(JSON.parse(localStorage.getItem('staffInactive_v1') || '[]')); } catch(e) { return new Set(); }
 }

 window.renderPermissions = function() {
 // Default: matrix tab
 window.permTab('matrix');
 };

 window.permTab = function(name) {
 const matrix = document.getElementById('permPaneMatrix');
 const audit = document.getElementById('permPaneAudit');
 const sidebarPane = document.getElementById('permPaneSidebar');
 const tplPane = document.getElementById('permPaneTemplates');
 if (!matrix || !audit) return;
 document.querySelectorAll('.perm-tab').forEach(t => {
 const isActive = t.dataset.permTab === name;
 t.classList.toggle('is-active', isActive);
 t.setAttribute('aria-selected', isActive ? 'true' : 'false');
 });
 // Hide all panes first
 matrix.hidden = true; audit.hidden = true;
 if (sidebarPane) sidebarPane.hidden = true;
 if (tplPane) tplPane.hidden = true;
 if (name === 'audit') { audit.hidden = false; window.renderPermissionsAudit(); }
 else if (name === 'sidebar') { if (sidebarPane) sidebarPane.hidden = false; window.renderPermSidebarPicker(); }
 else if (name === 'templates') { if (tplPane) tplPane.hidden = false; window.renderPermTemplates(); }
 else { matrix.hidden = false; window.renderPermissionsMatrix(); }
 // Guard banner if not superior
 const guard = document.getElementById('permGuard');
 if (guard) guard.hidden = isSuperior();
 };

 window.renderPermissionsMatrix = function() {
 const tbody = document.getElementById('permMatrixBody');
 if (!tbody) return;
 const list = (typeof authUsers !== 'undefined' && Array.isArray(authUsers)) ? authUsers.slice() : [];
 if (list.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--neutral-500);">Tiada staff dijumpai.</td></tr>'; return; }
 const overlay = readOverlay();
 const inactive = inactiveSet();
 const canEdit = isSuperior();
 // Sort: superior first, then by role, then by name
 const roleOrder = { superior:0, mgmt:1, inventory:2, sales:3, investor:4 };
 list.sort((a,b) => (roleOrder[a.role]||9) - (roleOrder[b.role]||9) || (a.name||'').localeCompare(b.name||''));
 tbody.innerHTML = list.map(u => {
 const access = (typeof window.getModesAccess === 'function') ? window.getModesAccess(u) : {};
 const lockedAll = u.role === 'superior'; // Bos all locked-true, can't be untoggled
 const isInact = inactive.has(u.staff_id);
 const rowCls = isInact ? 'perm-row perm-row--inactive' : 'perm-row';
 const expiry = (window.permExpiry ? window.permExpiry.forStaff(u.staff_id) : {});
 const cells = PERM_MODES.map(m => {
 const checked = !!access[m];
 const disabled = !canEdit || lockedAll;
 const cellCls = m === 'hq' ? 'perm-cell perm-cell--hq' : 'perm-cell';
 const exp = expiry['mode:' + m];
 const expBadge = (checked && exp) ? '<span class="perm-cell-exp" title="Auto-revoke ' + new Date(exp).toLocaleString('en-MY') + '">' + escAttr(window.permExpiry.formatRemaining(exp)) + '</span>' : '';
 return '<td class="' + cellCls + '"><label class="perm-cb"><input type="checkbox"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + ' onchange="window.togglePermission(\'' + escAttr(u.staff_id) + '\', \'' + m + '\', this.checked, this)"><span></span></label>' + expBadge + '</td>';
 }).join('');
 const meta = '<div class="perm-staff-meta"><strong>' + escAttr(u.name) + '</strong><span>' + escAttr(u.staff_id) + ' · ' + escAttr(u.role) + (isInact ? ' · INACTIVE' : '') + (lockedAll ? ' · auto-true' : '') + '</span></div>';
 return '<tr class="' + rowCls + '" data-staff-id="' + escAttr(u.staff_id) + '"><td class="perm-staff-col">' + meta + '</td>' + cells + '</tr>';
 }).join('');
 if (window.lucide && typeof window.lucide.createIcons === 'function') { try { window.lucide.createIcons(); } catch(e){} }
 };

 window.togglePermission = function(staffId, mode, value, checkboxEl) {
 if (!isSuperior()) {
 if (typeof showToast === 'function') showToast('Hanya Superior boleh ubah permissions', 'warn');
 if (checkboxEl) checkboxEl.checked = !value;
 return;
 }
 if (!staffId || !mode) return;
 const list = (typeof authUsers !== 'undefined' && Array.isArray(authUsers)) ? authUsers : [];
 const target = list.find(u => u.staff_id === staffId);
 if (!target) return;
 if (target.role === 'superior') {
 if (typeof showToast === 'function') showToast('Superior auto-true, tak boleh ubah', 'warn');
 if (checkboxEl) checkboxEl.checked = true;
 return;
 }
 // Self-lockout warning
 const a = actor();
 if (a && a.staff_id === staffId && !value) {
 const overlayProbe = readOverlay();
 const hypotheticalNext = Object.assign({}, overlayProbe[staffId] || {}, { [mode]: false });
 const stillHasAny = ['cashier','operations','manager','hq'].some(m => {
 if (hypotheticalNext[m] !== undefined) return hypotheticalNext[m];
 const cap = (typeof ROLE_CAPS !== 'undefined' && ROLE_CAPS[target.role]) ? ROLE_CAPS[target.role] : { modes:[] };
 return cap.modes.includes(m);
 });
 if (!stillHasAny) {
 if (!confirm('AMARAN: Awak akan kunci diri sendiri keluar SEMUA mode operational!\nLepas reload, awak takleh masuk app lagi.\n\nPasti?')) {
 if (checkboxEl) checkboxEl.checked = true;
 return;
 }
 }
 }
 // Persist
 const overlay = readOverlay();
 if (!overlay[staffId]) overlay[staffId] = {};
 const before = overlay[staffId][mode];
 overlay[staffId][mode] = !!value;
 // p1_37 alias: if writing 'hq', mirror to 'management' so legacy modal stays in sync
 if (mode === 'hq') overlay[staffId].management = !!value;
 writeOverlay(overlay);
 // Audit log
 try {
 if (typeof db !== 'undefined' && db && db.from) {
 db.from('audit_logs').insert([{
 action_type: 'update_mode_access',
 actor_name: a ? a.name : 'Unknown',
 target_staff: target.name + ' (' + target.staff_id + ')',
 details: JSON.stringify({ staff_id: target.staff_id, role: target.role, changes: [{ mode, granted: !!value, prev: before }], source: 'permissions_centre' }),
 created_at: new Date().toISOString()
 }]).then(()=>{}).catch(()=>{});
 }
 } catch(e){}
 // If editing self, refresh mode tab visibility immediately
 if (a && a.staff_id === staffId && typeof window.refreshAllModeTabsVisibility === 'function') {
 try { window.refreshAllModeTabsVisibility(); } catch(e){}
 }
 if (typeof showToast === 'function') showToast(target.name + ' · ' + PERM_LABELS[mode] + ' = ' + (value ? 'GRANTED' : 'REVOKED'), 'success');
 };

 window.renderPermissionsAudit = async function() {
 const list = document.getElementById('permAuditList');
 if (!list) return;
 list.innerHTML = '<p style="text-align:center; padding:24px; color:var(--neutral-500);">Loading audit logs…</p>';
 if (typeof db === 'undefined' || !db || !db.from) {
 list.innerHTML = '<p style="text-align:center; padding:24px; color:var(--neutral-500);">Database not ready — login dulu.</p>';
 return;
 }
 try {
 const { data, error } = await db.from('audit_logs')
 .select('*')
 .eq('action_type', 'update_mode_access')
 .order('created_at', { ascending: false })
 .limit(50);
 if (error) throw error;
 if (!data || data.length === 0) {
 list.innerHTML = '<p style="text-align:center; padding:32px; color:var(--neutral-500);">Tiada perubahan permission lagi. Toggle satu kat tab Mode Access untuk start audit trail.</p>';
 return;
 }
 list.innerHTML = data.map(row => {
 let parsed = {};
 try { parsed = typeof row.details === 'string' ? JSON.parse(row.details) : (row.details || {}); } catch(e){}
 const changes = parsed.changes || [];
 const changeText = changes.map(c => {
 const lbl = PERM_LABELS[c.mode] || c.mode;
 const verb = c.granted ? 'GRANT' : 'REVOKE';
 const cls = c.granted ? 'perm-audit-grant' : 'perm-audit-revoke';
 return '<span class="' + cls + '">' + verb + ' ' + escAttr(lbl) + '</span>';
 }).join(' ');
 const ts = new Date(row.created_at);
 const tsStr = ts.toLocaleString('en-MY', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
 const source = parsed.source ? ' · via ' + escAttr(parsed.source).replace(/_/g,' ') : '';
 return '<div class="perm-audit-item">' +
 '<div class="perm-audit-head"><strong>' + escAttr(row.actor_name || 'Unknown') + '</strong> → <em>' + escAttr(row.target_staff || '') + '</em></div>' +
 '<div class="perm-audit-changes">' + (changeText || '<span style="color:var(--neutral-500);">no recorded changes</span>') + '</div>' +
 '<div class="perm-audit-time">' + escAttr(tsStr) + escAttr(source) + '</div>' +
 '</div>';
 }).join('');
 } catch(e) {
 list.innerHTML = '<p style="text-align:center; padding:24px; color:#DC2626;">Audit query failed: ' + escAttr(e.message || e) + '</p>';
 }
 };

 // p1_42 — Sidebar Items tab: per-staff per-tab grant/deny.
 // Maps sidebar group attribute → human-readable section name (matches groupMap in Staff Mgmt).
 const SB_GROUP_LABEL = {
 sales: 'Sales (Kaunter mode)',
 inv: 'Inventory (Operasi mode)',
 customers: 'Customers (Pengurus mode)',
 admin: 'Admin (Pengurus mode)',
 hr: 'HR Department (HQ mode)',
 finance: 'Finance Department (HQ mode)',
 hq_setup: 'Setup (HQ mode)',
 other: 'Other'
 };

 function collectSidebarItems() {
 // Returns array of {tabId, label, group, classList}
 const out = [];
 document.querySelectorAll('#appSidebar .menu-item[data-tab]:not([data-group-toggle])').forEach(item => {
 const tabId = item.getAttribute('data-tab');
 if (!tabId) return;
 let label = item.textContent.trim().split('\n')[0].trim().replace(/\s+/g, ' ');
 label = label.replace(/\s*P\d+\s*$/, '').trim();
 const group = item.getAttribute('data-group') || 'other';
 out.push({ tabId, label, group, isHq: item.classList.contains('hq-only'), isInvestor: item.classList.contains('investor-only'), isSuperior: item.classList.contains('superior-only') });
 });
 return out;
 }

 window.renderPermSidebarPicker = function() {
 const sel = document.getElementById('permSidebarStaff');
 if (!sel) return;
 const list = (typeof authUsers !== 'undefined' && Array.isArray(authUsers)) ? authUsers.slice() : [];
 // Filter out superior (auto-true full access)
 const eligible = list.filter(u => u.role !== 'superior');
 const roleOrder = { mgmt:0, inventory:1, sales:2, investor:3 };
 eligible.sort((a,b) => (roleOrder[a.role]||9) - (roleOrder[b.role]||9) || (a.name||'').localeCompare(b.name||''));
 const prev = sel.value;
 sel.innerHTML = '<option value="">— pilih staff —</option>' + eligible.map(u => {
 const denied = window.sidebarAccess ? window.sidebarAccess.deniedTabs(u.staff_id).length : 0;
 const badge = denied > 0 ? ' (' + denied + ' denied)' : '';
 return '<option value="' + escAttr(u.staff_id) + '">' + escAttr(u.name) + ' · ' + escAttr(u.role) + escAttr(badge) + '</option>';
 }).join('');
 if (prev) sel.value = prev;
 if (sel.value) window.renderPermSidebarFor(sel.value);
 else { document.getElementById('permSidebarBody').innerHTML = '<p style="text-align:center; padding:24px; color:var(--neutral-500);">Pilih staff untuk start.</p>'; document.getElementById('permSidebarReset').style.display = 'none'; }
 };

 window.renderPermSidebarFor = function(staffId) {
 const body = document.getElementById('permSidebarBody');
 const resetBtn = document.getElementById('permSidebarReset');
 if (!body) return;
 if (!staffId) { body.innerHTML = '<p style="text-align:center; padding:24px; color:var(--neutral-500);">Pilih staff untuk start.</p>'; if (resetBtn) resetBtn.style.display = 'none'; return; }
 const list = (typeof authUsers !== 'undefined' && Array.isArray(authUsers)) ? authUsers : [];
 const target = list.find(u => u.staff_id === staffId);
 if (!target) { body.innerHTML = '<p>Staff tak dijumpai.</p>'; return; }
 if (resetBtn) resetBtn.style.display = '';
 const access = (typeof window.getModesAccess === 'function') ? window.getModesAccess(target) : {};
 const overlay = window.sidebarAccess ? window.sidebarAccess.forStaff(staffId) : {};
 const canEdit = isSuperior();
 const items = collectSidebarItems();
 // Group by sidebar group
 const groups = {};
 items.forEach(it => { (groups[it.group] = groups[it.group] || []).push(it); });
 const orderedGroups = ['sales','inv','customers','admin','hr','finance','hq_setup','other'];
 const html = orderedGroups.filter(g => groups[g] && groups[g].length).map(g => {
 const rows = groups[g].map(it => {
 // Mode-level access decides if this row is even reachable; show but mark "no mode access"
 // Map group → governing mode for the "reachable" hint
 const modeMap = { sales:'cashier', inv:'operations', customers:'manager', admin:'manager', hr:'hq', finance:'hq', hq_setup:'hq' };
 const govMode = modeMap[g];
 const hasMode = govMode ? !!access[govMode] : true;
 const explicitDeny = overlay[it.tabId] === false;
 const isVisible = hasMode && !explicitDeny;
 const checked = !explicitDeny; // ticked = allowed (default or explicit), unticked = explicit deny
 const disabled = !canEdit;
 const hint = !hasMode ? '<span class="perm-sb-hint">no mode access</span>' : '';
 return '<label class="perm-sb-row' + (isVisible ? '' : ' is-hidden') + '">' +
 '<input type="checkbox"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') +
 ' onchange="window.togglePermSidebar(\'' + escAttr(staffId) + '\', \'' + escAttr(it.tabId) + '\', this.checked, this)">' +
 '<span class="perm-sb-label">' + escAttr(it.label) + '</span>' +
 hint +
 '</label>';
 }).join('');
 return '<div class="perm-sb-group"><h4>' + escAttr(SB_GROUP_LABEL[g] || g) + '</h4>' + rows + '</div>';
 }).join('');
 body.innerHTML = html || '<p>Tiada items.</p>';
 };

 window.togglePermSidebar = function(staffId, tabId, checked, el) {
 if (!isSuperior()) {
 if (typeof showToast === 'function') showToast('Hanya Superior boleh ubah permissions', 'warn');
 if (el) el.checked = !checked;
 return;
 }
 if (!staffId || !tabId || !window.sidebarAccess) return;
 const a = actor();
 const list = (typeof authUsers !== 'undefined' && Array.isArray(authUsers)) ? authUsers : [];
 const target = list.find(u => u.staff_id === staffId);
 if (!target) return;
 const before = window.sidebarAccess.isAllowed(staffId, tabId);
 if (checked) {
 // ticked = allowed → clear any explicit deny (revert to inherit)
 window.sidebarAccess.clear(staffId, tabId);
 } else {
 // unticked = explicit deny
 window.sidebarAccess.set(staffId, tabId, false);
 }
 // Audit log
 try {
 if (typeof db !== 'undefined' && db && db.from) {
 db.from('audit_logs').insert([{
 action_type: 'update_sidebar_access',
 actor_name: a ? a.name : 'Unknown',
 target_staff: target.name + ' (' + target.staff_id + ')',
 details: JSON.stringify({ staff_id: target.staff_id, role: target.role, tab: tabId, granted: checked, prev: before, source: 'permissions_centre' }),
 created_at: new Date().toISOString()
 }]).then(()=>{}).catch(()=>{});
 }
 } catch(e){}
 // If editing self, refresh sidebar visibility so change is immediate
 if (a && a.staff_id === staffId) {
 const savedMode = localStorage.getItem('uxMode_v1') || 'cashier';
 if (typeof window.setMode === 'function') { try { window.__modeJumping = true; window.setMode(savedMode); window.__modeJumping = false; } catch(e){} }
 }
 // Invalidate Cmd+K cache so palette reflects new state
 if (typeof CMDK_INDEX !== 'undefined' && CMDK_INDEX.length) CMDK_INDEX.length = 0;
 if (typeof showToast === 'function') showToast(target.name + ' · ' + tabId + ' = ' + (checked ? 'ALLOWED' : 'DENIED'), 'success');
 // Re-render dropdown to refresh badge counts
 window.renderPermSidebarPicker();
 };

 window.permSidebarResetAll = function() {
 const sel = document.getElementById('permSidebarStaff');
 if (!sel || !sel.value) return;
 const staffId = sel.value;
 const a = actor();
 const list = (typeof authUsers !== 'undefined' && Array.isArray(authUsers)) ? authUsers : [];
 const target = list.find(u => u.staff_id === staffId);
 if (!target) return;
 if (!confirm('Reset semua sidebar overrides untuk ' + target.name + '? Semua item akan kembali default (ikut mode access).')) return;
 if (window.sidebarAccess) window.sidebarAccess.clearAll(staffId);
 try {
 if (typeof db !== 'undefined' && db && db.from) {
 db.from('audit_logs').insert([{
 action_type: 'update_sidebar_access',
 actor_name: a ? a.name : 'Unknown',
 target_staff: target.name + ' (' + target.staff_id + ')',
 details: JSON.stringify({ staff_id: target.staff_id, action: 'reset_all', source: 'permissions_centre' }),
 created_at: new Date().toISOString()
 }]).then(()=>{}).catch(()=>{});
 }
 } catch(e){}
 if (typeof CMDK_INDEX !== 'undefined' && CMDK_INDEX.length) CMDK_INDEX.length = 0;
 if (typeof showToast === 'function') showToast('Reset done · ' + target.name + ' kembali ke default sidebar access', 'success');
 window.renderPermSidebarFor(staffId);
 window.renderPermSidebarPicker();
 };

 // Audit Trail extended — query both update_mode_access AND update_sidebar_access
 const __origRenderAudit = window.renderPermissionsAudit;
 window.renderPermissionsAudit = async function() {
 const list = document.getElementById('permAuditList');
 if (!list) return;
 list.innerHTML = '<p style="text-align:center; padding:24px; color:var(--neutral-500);">Loading audit logs…</p>';
 if (typeof db === 'undefined' || !db || !db.from) {
 list.innerHTML = '<p style="text-align:center; padding:24px; color:var(--neutral-500);">Database not ready — login dulu.</p>';
 return;
 }
 try {
 const { data, error } = await db.from('audit_logs')
 .select('*')
 .in('action_type', ['update_mode_access', 'update_sidebar_access'])
 .order('created_at', { ascending: false })
 .limit(50);
 if (error) throw error;
 if (!data || data.length === 0) {
 list.innerHTML = '<p style="text-align:center; padding:32px; color:var(--neutral-500);">Tiada perubahan permission lagi.</p>';
 return;
 }
 list.innerHTML = data.map(row => {
 let parsed = {};
 try { parsed = typeof row.details === 'string' ? JSON.parse(row.details) : (row.details || {}); } catch(e){}
 let changeText = '';
 if (row.action_type === 'update_mode_access') {
 const changes = parsed.changes || [];
 changeText = changes.map(c => {
 const lbl = ({ cashier:'Kaunter', operations:'Operasi', manager:'Pengurus', hq:'HQ', investor:'Investor', management:'Pengurusan' })[c.mode] || c.mode;
 const verb = c.granted ? 'GRANT' : 'REVOKE';
 const cls = c.granted ? 'perm-audit-grant' : 'perm-audit-revoke';
 return '<span class="' + cls + '">' + verb + ' ' + escAttr(lbl) + '</span>';
 }).join(' ');
 } else if (row.action_type === 'update_sidebar_access') {
 if (parsed.action === 'reset_all') {
 changeText = '<span class="perm-audit-grant">RESET ALL sidebar overrides</span>';
 } else {
 const verb = parsed.granted ? 'ALLOW' : 'DENY';
 const cls = parsed.granted ? 'perm-audit-grant' : 'perm-audit-revoke';
 changeText = '<span class="' + cls + '">' + verb + ' sidebar:' + escAttr(parsed.tab || '?') + '</span>';
 }
 }
 const ts = new Date(row.created_at);
 const tsStr = ts.toLocaleString('en-MY', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
 const source = parsed.source ? ' · via ' + escAttr(parsed.source).replace(/_/g,' ') : '';
 return '<div class="perm-audit-item">' +
 '<div class="perm-audit-head"><strong>' + escAttr(row.actor_name || 'Unknown') + '</strong> → <em>' + escAttr(row.target_staff || '') + '</em></div>' +
 '<div class="perm-audit-changes">' + (changeText || '<span style="color:var(--neutral-500);">no recorded changes</span>') + '</div>' +
 '<div class="perm-audit-time">' + escAttr(tsStr) + escAttr(source) + '</div>' +
 '</div>';
 }).join('');
 } catch(e) {
 list.innerHTML = '<p style="text-align:center; padding:24px; color:#DC2626;">Audit query failed: ' + escAttr(e.message || e) + '</p>';
 }
 };
})();

// ============= p1_39 PRODUCT SHARE — public-safe text =============
// Bos shares product description to public/customers without exposing
// cost_price, selling price, numeric stock, or internal metadata.
window.shareProduct = function(sku) {
 if (!sku) return;
 const list = (typeof masterProducts !== 'undefined' && Array.isArray(masterProducts)) ? masterProducts : [];
 const p = list.find(x => x.sku === sku);
 if (!p) {
 if (typeof showToast === 'function') showToast('Produk ' + sku + ' tak dijumpai', 'error');
 return;
 }

 // Clean title — strip leading "SKU |" or "CODE _" pollution from EasyStore.
 let cleanName = (p.name || 'Produk').toString();
 cleanName = cleanName.replace(/^[A-Z0-9-]+\s*[|_]\s*/i, '').trim();
 cleanName = cleanName.replace(/\s*[_]\s*/g, ' — ').replace(/\s{2,}/g, ' ').trim();
 const letters = cleanName.replace(/[^A-Za-z]/g, '');
 const upperRatio = letters.length ? (letters.match(/[A-Z]/g)||[]).length / letters.length : 0;
 if (upperRatio > 0.7 && letters.length > 6) {
 cleanName = cleanName.toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
 }

 // Clean description — strip internal tags + duplicate header lines.
 let desc = (p.description || '').toString();
 desc = desc.replace(/\[EASYSTORE-ID:[^\]]+\]\s*/g, '');
 desc = desc.replace(/\[STOK BELUM DISAHKAN[^\]]*\]\s*/g, '');
 desc = desc.replace(/^Product name:\s*[^\n]*\n/i, '');
 desc = desc.replace(/\n{3,}/g, '\n\n').trim();

 // Stock availability — boolean text only, NEVER numeric (avoid leaking inventory levels).
 const totalStock = (typeof inventoryBatches !== 'undefined' && Array.isArray(inventoryBatches))
 ? inventoryBatches.filter(b => b.sku === sku).reduce((s, b) => s + (b.qty_remaining||0), 0) : 0;
 const stockText = totalStock > 0 ? 'Stok ada' : 'Habis stok — sila tanya untuk restock';

 // Specs — only safe public fields. Skip cost_price, price, bin, internal metadata.
 const specs = [];
 if (p.brand) specs.push('Jenama: ' + p.brand);
 if (p.category) specs.push('Kategori: ' + p.category);
 if (p.weight) specs.push('Berat: ' + p.weight);
 if (p.dimensions) specs.push('Saiz: ' + p.dimensions);
 if (p.material) specs.push('Bahan: ' + p.material);
 if (p.color) specs.push('Warna: ' + p.color);

 // Public URL — deep link to EasyStore product if mapping exists, else attribute to 10camp.com.
 let url = 'https://10camp.com';
 try {
 const meta = p.metadata || {};
 if (meta.easystore_product_id) url = 'https://10camp.com/products/' + meta.easystore_product_id;
 else if (p.public_url) url = p.public_url;
 } catch(e){}

 // Assemble public-safe message.
 const lines = [];
 lines.push(cleanName);
 lines.push('SKU: ' + sku);
 if (specs.length) { lines.push(''); lines.push(specs.join('\n')); }
 if (desc) { lines.push(''); lines.push(desc); }
 lines.push('');
 lines.push(stockText);
 lines.push('');
 lines.push('— 10 CAMP');
 lines.push(url);
 const text = lines.join('\n');

 // Try Web Share API (native share sheet on mobile + recent desktop browsers).
 const sharePayload = { title: cleanName + ' — 10 CAMP', text: text, url: url };
 if (navigator.share && typeof navigator.share === 'function') {
 navigator.share(sharePayload).then(() => {
 if (typeof showToast === 'function') showToast('Shared', 'success');
 }).catch((err) => {
 // User cancelled or share unsupported — fall back to clipboard
 if (err && err.name === 'AbortError') return; // silent on cancel
 __copyShareText(text);
 });
 return;
 }
 __copyShareText(text);
};

function __copyShareText(text) {
 if (navigator.clipboard && navigator.clipboard.writeText) {
 navigator.clipboard.writeText(text).then(() => {
 if (typeof showToast === 'function') showToast('Description disalin ke clipboard — boleh paste di WhatsApp / FB / IG', 'success');
 }).catch(() => __copyFallback(text));
 } else {
 __copyFallback(text);
 }
}

function __copyFallback(text) {
 try {
 const ta = document.createElement('textarea');
 ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.top = '-1000px';
 document.body.appendChild(ta); ta.select();
 const ok = document.execCommand('copy');
 document.body.removeChild(ta);
 if (typeof showToast === 'function') showToast(ok ? 'Description disalin ke clipboard' : 'Copy gagal — pilih manual dari modal', ok ? 'success' : 'warn');
 } catch(e) {
 if (typeof showToast === 'function') showToast('Copy gagal: ' + e.message, 'error');
 }
}

// p1_39 — WhatsApp shortcut: opens wa.me with same public-safe text pre-filled.
// Works on desktop (WhatsApp Web) + mobile (native WA app).
window.shareProductWA = function(sku) {
 if (!sku) return;
 const list = (typeof masterProducts !== 'undefined' && Array.isArray(masterProducts)) ? masterProducts : [];
 const p = list.find(x => x.sku === sku);
 if (!p) {
 if (typeof showToast === 'function') showToast('Produk ' + sku + ' tak dijumpai', 'error');
 return;
 }
 // Reuse the same text builder as shareProduct by extracting it; for simplicity, mirror logic inline.
 let cleanName = (p.name || 'Produk').toString();
 cleanName = cleanName.replace(/^[A-Z0-9-]+\s*[|_]\s*/i, '').trim();
 cleanName = cleanName.replace(/\s*[_]\s*/g, ' — ').replace(/\s{2,}/g, ' ').trim();
 const letters = cleanName.replace(/[^A-Za-z]/g, '');
 const upperRatio = letters.length ? (letters.match(/[A-Z]/g)||[]).length / letters.length : 0;
 if (upperRatio > 0.7 && letters.length > 6) cleanName = cleanName.toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase());

 let desc = (p.description || '').toString();
 desc = desc.replace(/\[EASYSTORE-ID:[^\]]+\]\s*/g, '');
 desc = desc.replace(/\[STOK BELUM DISAHKAN[^\]]*\]\s*/g, '');
 desc = desc.replace(/^Product name:\s*[^\n]*\n/i, '');
 desc = desc.replace(/\n{3,}/g, '\n\n').trim();

 const totalStock = (typeof inventoryBatches !== 'undefined' && Array.isArray(inventoryBatches))
 ? inventoryBatches.filter(b => b.sku === sku).reduce((s, b) => s + (b.qty_remaining||0), 0) : 0;
 const stockText = totalStock > 0 ? 'Stok ada' : 'Habis stok — sila tanya untuk restock';

 const specs = [];
 if (p.brand) specs.push('Jenama: ' + p.brand);
 if (p.category) specs.push('Kategori: ' + p.category);
 if (p.weight) specs.push('Berat: ' + p.weight);
 if (p.dimensions) specs.push('Saiz: ' + p.dimensions);
 if (p.material) specs.push('Bahan: ' + p.material);
 if (p.color) specs.push('Warna: ' + p.color);

 let url = 'https://10camp.com';
 try {
 const meta = p.metadata || {};
 if (meta.easystore_product_id) url = 'https://10camp.com/products/' + meta.easystore_product_id;
 else if (p.public_url) url = p.public_url;
 } catch(e){}

 // WhatsApp uses *bold* for asterisks. Wrap title in *...* for prominence.
 const lines = [];
 lines.push('*' + cleanName + '*');
 lines.push('SKU: ' + sku);
 if (specs.length) { lines.push(''); lines.push(specs.join('\n')); }
 if (desc) { lines.push(''); lines.push(desc); }
 lines.push('');
 lines.push(stockText);
 lines.push('');
 lines.push('— 10 CAMP');
 lines.push(url);
 const text = lines.join('\n');

 // wa.me universal link — opens WhatsApp Web/app with text pre-filled, no recipient yet.
 const waUrl = 'https://wa.me/?text=' + encodeURIComponent(text);
 const win = window.open(waUrl, '_blank', 'noopener,noreferrer');
 if (!win) {
 if (typeof showToast === 'function') showToast('Pop-up blocked. Allow pop-ups untuk buka WhatsApp.', 'warn');
 } else {
 if (typeof showToast === 'function') showToast('WhatsApp dibuka — pilih contact untuk hantar', 'success');
 }
};

// ============= p1_42 SIDEBAR-ITEM PERMISSIONS (Tier 1) =============
// Granular per-tab access on top of staffModeAccess. Lets Bos hide specific
// sidebar items from staff who otherwise have full mode access.
// Storage: staffSidebarAccess_v1 → {staffId: {tabId: bool}}
//   true  = explicitly grant (visible if mode access allows)
//   false = explicitly deny (hide regardless of mode access)
//   undef = inherit from mode access (default — back-compat)
(function(){
 const KEY = 'staffSidebarAccess_v1';

 function readAll() {
 try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e) { return {}; }
 }
 function writeAll(map) { try { localStorage.setItem(KEY, JSON.stringify(map)); } catch(e){} }

 const api = {
 forStaff(staffId) { return (readAll()[staffId]) || {}; },
 isAllowed(staffId, tabId) {
 // Return null = inherit (default), true = explicit grant, false = explicit deny
 const o = api.forStaff(staffId);
 return (tabId in o) ? !!o[tabId] : null;
 },
 set(staffId, tabId, value) {
 const all = readAll();
 if (!all[staffId]) all[staffId] = {};
 all[staffId][tabId] = !!value;
 writeAll(all);
 },
 clear(staffId, tabId) {
 const all = readAll();
 if (all[staffId] && tabId in all[staffId]) {
 delete all[staffId][tabId];
 if (Object.keys(all[staffId]).length === 0) delete all[staffId];
 writeAll(all);
 }
 },
 clearAll(staffId) {
 const all = readAll();
 if (all[staffId]) { delete all[staffId]; writeAll(all); }
 },
 // Returns array of denied tab IDs for a staff (for UI summary)
 deniedTabs(staffId) {
 const o = api.forStaff(staffId);
 return Object.keys(o).filter(k => o[k] === false);
 }
 };
 window.sidebarAccess = api;
})();

// ============= p1_43 ROLE TEMPLATES (Tier 2) =============
// Preset + custom permission templates. Apply = bulk write to both
// staffModeAccess_v1 and staffSidebarAccess_v1 in one transaction.
(function(){
 const KEY = 'permTemplates_v1'; // custom templates only

 // Built-in presets. Modes lists what's GRANTED (anything not listed = false override).
 // sidebarDeny lists tab IDs that are explicitly denied even when the mode would allow.
 const PRESETS = [
 { id:'cashier_strict', name:'Cashier (strict)', desc:'POS only — pure cashier workflow.',
 modes:{ cashier:true, operations:false, manager:false, hq:false, investor:false }, sidebarDeny:[] },
 { id:'inventory_clerk', name:'Inventory clerk', desc:'POS + stock ops, no admin tools.',
 modes:{ cashier:true, operations:true, manager:false, hq:false, investor:false }, sidebarDeny:[] },
 { id:'manager_light', name:'Manager (light)', desc:'POS + stock + manager view, but no Bulk Edit / Re-engage / Test Guide.',
 modes:{ cashier:true, operations:true, manager:true, hq:false, investor:false },
 sidebarDeny:['admin_bulk_ops','admin_reengage','admin_test_guide'] },
 { id:'manager_full', name:'Manager (full)', desc:'POS + stock + manager full access. No HQ / Investor.',
 modes:{ cashier:true, operations:true, manager:true, hq:false, investor:false }, sidebarDeny:[] },
 { id:'hq_basic', name:'HQ basic (delegate)', desc:'Manager + HQ control centre. No System Test Guide.',
 modes:{ cashier:true, operations:true, manager:true, hq:true, investor:false },
 sidebarDeny:['admin_test_guide'] },
 { id:'hq_full', name:'HQ full', desc:'All modes including HQ. No Investor.',
 modes:{ cashier:true, operations:true, manager:true, hq:true, investor:false }, sidebarDeny:[] }
 ];

 function readCustom() {
 try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch(e) { return []; }
 }
 function writeCustom(arr) { try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch(e){} }
 function actor() { return window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null); }
 function isSuperior() { const a = actor(); return !!(a && a.role === 'superior'); }
 function escAttr(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

 function allTemplates() {
 return PRESETS.map(p => ({ ...p, source:'preset' }))
 .concat(readCustom().map(c => ({ ...c, source:'custom' })));
 }

 window.renderPermTemplates = function() {
 const list = document.getElementById('permTemplatesList');
 if (!list) return;
 const tpls = allTemplates();
 const staff = (typeof authUsers !== 'undefined' && Array.isArray(authUsers))
 ? authUsers.filter(u => u.role !== 'superior') : [];
 const roleOrder = { mgmt:0, inventory:1, sales:2, investor:3 };
 staff.sort((a,b) => (roleOrder[a.role]||9) - (roleOrder[b.role]||9) || (a.name||'').localeCompare(b.name||''));
 const staffOpts = '<option value="">— pilih staff —</option>' + staff.map(u =>
 '<option value="' + escAttr(u.staff_id) + '">' + escAttr(u.name) + ' · ' + escAttr(u.role) + '</option>').join('');
 list.innerHTML = tpls.map(t => {
 const modesGranted = Object.keys(t.modes || {}).filter(m => t.modes[m]);
 const denyCount = (t.sidebarDeny || []).length;
 const sourceTag = t.source === 'preset'
 ? '<span class="perm-tpl-tag perm-tpl-tag--preset">PRESET</span>'
 : '<span class="perm-tpl-tag perm-tpl-tag--custom">CUSTOM</span>';
 const deleteBtn = t.source === 'custom'
 ? '<button type="button" class="perm-tpl-del" onclick="window.permDeleteTemplate(\'' + escAttr(t.id) + '\')" title="Delete custom template"><i data-lucide="trash-2" style="width:13px; height:13px;"></i></button>'
 : '';
 return '<div class="perm-tpl-card">' +
 '<div class="perm-tpl-card__head">' +
 '<div><strong>' + escAttr(t.name) + '</strong> ' + sourceTag + '</div>' +
 deleteBtn +
 '</div>' +
 '<p class="perm-tpl-desc">' + escAttr(t.desc || '') + '</p>' +
 '<div class="perm-tpl-meta">' +
 '<span><i data-lucide="check-circle-2" style="width:12px; height:12px; color:#047857;"></i> Modes: ' + (modesGranted.length ? modesGranted.join(', ') : '<em>none</em>') + '</span>' +
 (denyCount ? '<span><i data-lucide="ban" style="width:12px; height:12px; color:#B91C1C;"></i> ' + denyCount + ' sidebar deny</span>' : '') +
 '</div>' +
 '<div class="perm-tpl-apply">' +
 '<select id="permTplStaff_' + escAttr(t.id) + '" style="flex:1; padding:6px 10px; border:1px solid var(--neutral-200); border-radius:6px; font-size:12.5px;">' + staffOpts + '</select>' +
 '<select id="permTplDuration_' + escAttr(t.id) + '" style="padding:6px 8px; border:1px solid var(--neutral-200); border-radius:6px; font-size:12px;" title="Expiry duration">' +
 '<option value="0">Permanent</option>' +
 '<option value="1">1 day</option>' +
 '<option value="7">7 days</option>' +
 '<option value="30">30 days</option>' +
 '</select>' +
 '<button type="button" class="perm-tpl-apply-btn" onclick="(function(id){var d=parseInt((document.getElementById(\'permTplDuration_\'+id)||{}).value)||0; if(d>0){window.permApplyTemplateWithExpiry(id,d);} else {window.permApplyTemplate(id);}})(\'' + escAttr(t.id) + '\')"><i data-lucide="zap" style="width:13px; height:13px;"></i> Apply</button>' +
 '</div>' +
 '</div>';
 }).join('');
 if (window.lucide && typeof window.lucide.createIcons === 'function') { try { window.lucide.createIcons(); } catch(e){} }
 };

 window.permApplyTemplate = function(tplId) {
 if (!isSuperior()) {
 if (typeof showToast === 'function') showToast('Hanya Superior boleh apply template', 'warn');
 return;
 }
 const tpls = allTemplates();
 const tpl = tpls.find(t => t.id === tplId);
 if (!tpl) return;
 const sel = document.getElementById('permTplStaff_' + tplId);
 const staffId = sel ? sel.value : '';
 if (!staffId) {
 if (typeof showToast === 'function') showToast('Pilih staff dulu sebelum apply', 'warn');
 return;
 }
 const list = (typeof authUsers !== 'undefined' && Array.isArray(authUsers)) ? authUsers : [];
 const target = list.find(u => u.staff_id === staffId);
 if (!target) return;
 if (target.role === 'superior') {
 if (typeof showToast === 'function') showToast('Superior auto-true, takyah apply template', 'warn');
 return;
 }
 if (!confirm('Apply "' + tpl.name + '" ke ' + target.name + '?\n\nIni akan overwrite mode access + sidebar access yang sedia ada untuk staff ni.')) return;

 // Write mode access overlay
 try {
 const modeOverlay = JSON.parse(localStorage.getItem('staffModeAccess_v1') || '{}');
 modeOverlay[staffId] = Object.assign({}, modeOverlay[staffId] || {}, tpl.modes || {});
 // p1_37 alias: keep management flag in sync with hq for back-compat
 if (typeof modeOverlay[staffId].hq !== 'undefined') modeOverlay[staffId].management = modeOverlay[staffId].hq;
 localStorage.setItem('staffModeAccess_v1', JSON.stringify(modeOverlay));
 } catch(e){}

 // Write sidebar overlay — replace deny list (clear all then set deny)
 if (window.sidebarAccess) {
 window.sidebarAccess.clearAll(staffId);
 (tpl.sidebarDeny || []).forEach(tabId => window.sidebarAccess.set(staffId, tabId, false));
 }

 // Audit log (one combined entry)
 try {
 if (typeof db !== 'undefined' && db && db.from) {
 db.from('audit_logs').insert([{
 action_type: 'apply_perm_template',
 actor_name: actor() ? actor().name : 'Unknown',
 target_staff: target.name + ' (' + target.staff_id + ')',
 details: JSON.stringify({ staff_id: target.staff_id, template_id: tpl.id, template_name: tpl.name, modes: tpl.modes, sidebarDeny: tpl.sidebarDeny || [], source: 'permissions_centre' }),
 created_at: new Date().toISOString()
 }]).then(()=>{}).catch(()=>{});
 }
 } catch(e){}

 // If editing self, refresh
 const a = actor();
 if (a && a.staff_id === staffId && typeof window.refreshAllModeTabsVisibility === 'function') {
 try { window.refreshAllModeTabsVisibility(); } catch(e){}
 const savedMode = localStorage.getItem('uxMode_v1') || 'cashier';
 if (typeof window.setMode === 'function') { try { window.__modeJumping = true; window.setMode(savedMode); window.__modeJumping = false; } catch(e){} }
 }
 if (typeof CMDK_INDEX !== 'undefined' && CMDK_INDEX.length) CMDK_INDEX.length = 0;
 if (typeof showToast === 'function') showToast('Template "' + tpl.name + '" applied to ' + target.name, 'success');
 };

 window.permSaveTemplateFromCurrent = function() {
 if (!isSuperior()) {
 if (typeof showToast === 'function') showToast('Hanya Superior boleh save template', 'warn');
 return;
 }
 // Snapshot the currently-selected staff in the Sidebar Items tab
 const staffSel = document.getElementById('permSidebarStaff');
 const staffId = staffSel ? staffSel.value : '';
 if (!staffId) {
 alert('Pilih staff dulu di Sidebar Items tab — saya snapshot mode + sidebar access dia jadi template baru.');
 return;
 }
 const list = (typeof authUsers !== 'undefined' && Array.isArray(authUsers)) ? authUsers : [];
 const target = list.find(u => u.staff_id === staffId);
 if (!target) return;
 const name = prompt('Nama template baru?', target.name + ' setup');
 if (!name) return;

 // Snapshot mode access + sidebar denies
 let modeOverlay = {};
 try { modeOverlay = (JSON.parse(localStorage.getItem('staffModeAccess_v1') || '{}'))[staffId] || {}; } catch(e){}
 const denies = window.sidebarAccess ? window.sidebarAccess.deniedTabs(staffId) : [];

 const customs = readCustom();
 const newTpl = {
 id: 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
 name: name.slice(0, 60),
 desc: 'Custom template — saved from ' + target.name + "'s setup",
 modes: { cashier:!!modeOverlay.cashier, operations:!!modeOverlay.operations, manager:!!modeOverlay.manager, hq:!!modeOverlay.hq, investor:!!modeOverlay.investor },
 sidebarDeny: denies.slice()
 };
 customs.push(newTpl);
 writeCustom(customs);
 if (typeof showToast === 'function') showToast('Template "' + name + '" saved', 'success');
 // Re-render templates if pane visible
 const pane = document.getElementById('permPaneTemplates');
 if (pane && !pane.hidden) window.renderPermTemplates();
 };

 window.permDeleteTemplate = function(tplId) {
 if (!isSuperior()) return;
 const customs = readCustom();
 const idx = customs.findIndex(t => t.id === tplId);
 if (idx < 0) return;
 if (!confirm('Delete custom template "' + customs[idx].name + '"?')) return;
 customs.splice(idx, 1);
 writeCustom(customs);
 if (typeof showToast === 'function') showToast('Template deleted', 'success');
 window.renderPermTemplates();
 };
})();

// ============= p1_44 PERMISSION EXPIRY (Tier 3) =============
// Time-bound mode grants. Auto-revoke on past expiry. 24h pre-expiry notification.
// Storage: staffPermExpiry_v1 → {staffId: {modeKey: timestamp_ms}}
//   modeKey: 'mode:hq', 'mode:manager', etc.
(function(){
 const KEY = 'staffPermExpiry_v1';
 const NOTIFIED_KEY = 'permExpiryNotified_v1'; // tracks which expiry already had its 24h alert fired
 const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
 const PRE_WARN_MS = 24 * 60 * 60 * 1000; // notify 24h before expiry

 function readAll() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e) { return {}; } }
 function writeAll(map) { try { localStorage.setItem(KEY, JSON.stringify(map)); } catch(e){} }
 function readNotified() { try { return JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '{}'); } catch(e) { return {}; } }
 function writeNotified(map) { try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(map)); } catch(e){} }

 const api = {
 forStaff(staffId) { return readAll()[staffId] || {}; },
 set(staffId, key, expiresAt) {
 const all = readAll();
 if (!all[staffId]) all[staffId] = {};
 if (!expiresAt) { delete all[staffId][key]; if (Object.keys(all[staffId]).length === 0) delete all[staffId]; }
 else { all[staffId][key] = expiresAt; }
 writeAll(all);
 },
 clear(staffId, key) { api.set(staffId, key, null); },
 // Returns { remaining_ms, expired, target_ts } for a key, or null if no expiry
 status(staffId, key) {
 const m = api.forStaff(staffId);
 if (!m[key]) return null;
 const remaining = m[key] - Date.now();
 return { target_ts: m[key], remaining_ms: remaining, expired: remaining <= 0 };
 },
 // Sweep all expiry entries — revoke past ones from staffModeAccess_v1, fire 24h warning toasts
 scan() {
 const all = readAll();
 if (Object.keys(all).length === 0) return;
 const now = Date.now();
 const notified = readNotified();
 let modeOverlay = {};
 try { modeOverlay = JSON.parse(localStorage.getItem('staffModeAccess_v1') || '{}'); } catch(e){}
 const list = (typeof authUsers !== 'undefined' && Array.isArray(authUsers)) ? authUsers : [];
 let modeChanged = false;

 Object.keys(all).forEach(staffId => {
 const target = list.find(u => u.staff_id === staffId);
 const targetName = target ? target.name : staffId;
 Object.keys(all[staffId]).forEach(key => {
 const ts = all[staffId][key];
 const remaining = ts - now;
 // Past expiry — auto-revoke
 if (remaining <= 0) {
 if (key.startsWith('mode:')) {
 const mode = key.slice(5);
 if (modeOverlay[staffId] && modeOverlay[staffId][mode]) {
 modeOverlay[staffId][mode] = false;
 modeChanged = true;
 // Audit log
 try {
 if (typeof db !== 'undefined' && db && db.from) {
 db.from('audit_logs').insert([{
 action_type: 'auto_revoke_expired',
 actor_name: 'system',
 target_staff: targetName + ' (' + staffId + ')',
 details: JSON.stringify({ staff_id: staffId, mode, expired_at: new Date(ts).toISOString() }),
 created_at: new Date().toISOString()
 }]).then(()=>{}).catch(()=>{});
 }
 } catch(e){}
 if (window.notify) {
 window.notify.add({ title:'Permission expired', body:targetName + ' · ' + mode + ' mode auto-revoked', type:'info' });
 }
 }
 }
 // Clear the expiry record
 delete all[staffId][key];
 // Clear notified flag
 const nKey = staffId + '|' + key;
 if (notified[nKey]) { delete notified[nKey]; }
 }
 // Approaching expiry (within 24h) — notify once
 else if (remaining <= PRE_WARN_MS) {
 const nKey = staffId + '|' + key;
 if (!notified[nKey]) {
 notified[nKey] = now;
 const hoursLeft = Math.max(1, Math.round(remaining / (60*60*1000)));
 if (window.notify) {
 const label = key.startsWith('mode:') ? key.slice(5) : key;
 window.notify.add({
 title: 'Permission expiring soon',
 body: targetName + ' · ' + label + ' expires in ' + hoursLeft + 'h',
 type: 'warning'
 });
 }
 }
 }
 });
 // Drop empty staff entries
 if (Object.keys(all[staffId]).length === 0) delete all[staffId];
 });

 if (modeChanged) {
 try { localStorage.setItem('staffModeAccess_v1', JSON.stringify(modeOverlay)); } catch(e){}
 // If currently logged-in user lost mode, refresh UI
 const u = window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null);
 if (u && typeof window.refreshAllModeTabsVisibility === 'function') {
 try { window.refreshAllModeTabsVisibility(); } catch(e){}
 }
 }
 writeAll(all);
 writeNotified(notified);
 },
 // Format helper for UI
 formatRemaining(ts) {
 if (!ts) return '';
 const remaining = ts - Date.now();
 if (remaining <= 0) return 'expired';
 const days = Math.floor(remaining / (24*60*60*1000));
 if (days >= 1) return 'expires in ' + days + 'd';
 const hours = Math.max(1, Math.round(remaining / (60*60*1000)));
 return 'expires in ' + hours + 'h';
 }
 };

 window.permExpiry = api;

 // Run scan on boot (after app fully loaded) and periodically.
 if (document.readyState === 'loading') {
 document.addEventListener('DOMContentLoaded', () => setTimeout(api.scan, 2000));
 } else { setTimeout(api.scan, 2000); }
 setInterval(api.scan, SCAN_INTERVAL_MS);
 // Also scan when tab becomes visible after being hidden (e.g. left tab open overnight)
 document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') api.scan(); });
})();

// ============= p1_44 — Apply template with optional expiry =============
// Wraps the Tier 2 template apply to optionally set expiry on granted modes.
window.permApplyTemplateWithExpiry = function(tplId, durationDays) {
 const sel = document.getElementById('permTplStaff_' + tplId);
 const staffId = sel ? sel.value : '';
 if (!staffId) {
 if (typeof showToast === 'function') showToast('Pilih staff dulu', 'warn');
 return;
 }
 // Apply template normally first
 if (typeof window.permApplyTemplate === 'function') window.permApplyTemplate(tplId);
 // Then attach expiry to all granted modes if duration > 0
 if (durationDays > 0 && window.permExpiry) {
 const expiresAt = Date.now() + durationDays * 24 * 60 * 60 * 1000;
 // Read what was just granted
 try {
 const modeOverlay = (JSON.parse(localStorage.getItem('staffModeAccess_v1') || '{}'))[staffId] || {};
 ['cashier','operations','manager','hq','investor'].forEach(m => {
 if (modeOverlay[m]) window.permExpiry.set(staffId, 'mode:' + m, expiresAt);
 });
 } catch(e){}
 if (typeof showToast === 'function') showToast('Expiry set: ' + durationDays + ' days from now', 'info');
 if (typeof window.renderPermTemplates === 'function') window.renderPermTemplates();
 if (typeof window.renderPermissionsMatrix === 'function') window.renderPermissionsMatrix();
 }
};

// =============================================================
// p1_50 — Q1 2026 ALIFF REPORT SEED (idempotent, boot-time auto-run)
// =============================================================
// Imports data from Aliff's Q1 Pentadbiran/HR/Finance report (14.03.2026):
//   - 5 memos issued (HR/sales/admin departments)
//   - 7 petty cash entries (1 baki carry + 3 TODAK top-ups + 3 monthly spend lumps)
//     Final baki RM 1,262.14 matches Aliff's Mac 2026 figure.
//   - 6 finance_records (3 project CAPEX: SSM/pagar/lesen-parking + 3 monthly payment summaries)
// Idempotent via SEED_Q1_ALIFF_FLAG so refresh won't duplicate.
// Manual re-run: window.seedQ1Aliff({force:true}).
// Reset: localStorage.removeItem('q1AliffSeeded_v1') then refresh.
window.SEED_Q1_ALIFF_FLAG = 'q1AliffSeeded_v1';

window.seedQ1Aliff = async function(opts) {
 opts = opts || {};
 if(!opts.force && localStorage.getItem(window.SEED_Q1_ALIFF_FLAG)) {
 console.log('[seedQ1Aliff] Already seeded. Pass {force:true} to re-run.');
 return { skipped: true };
 }

 const aliffId = 'CMP008';
 const aliffName = 'Muhammad Aliff Ashraf Bin Johar';
 const summary = { memos: 0, petty: 0, finance: 0, errors: [] };

 // ---- 1. MEMOS (5) ------------------------------------------------------
 const Q1_MEMOS = [
 { dept: 'hr', title: 'Memo Waktu Rehat & Solat',
 body: 'Penyelarasan waktu rehat dan waktu solat sepanjang minggu.\n\nDikeluarkan: 23.01.2026\nKuatkuasa: 24.01.2026\n\nRujukan asal: https://drive.google.com/file/d/1bHtroLcitMCLkZ6OLvPfAXPRiG9uWQ25/view',
 posted_at: '2026-01-23T09:00:00.000Z' },
 { dept: 'sales', title: 'Memo Komisen Live TikTok & Shopee',
 body: 'Penyelarasan kadar komisen untuk live session TikTok dan Shopee.\n\nDikeluarkan & Kuatkuasa: 03.02.2026\n\nRujukan asal: https://drive.google.com/file/d/1eb0VpbnMiwWMFYRYnCn-dOzgnKq0Xz58/view',
 posted_at: '2026-02-03T09:00:00.000Z' },
 { dept: 'hr', title: 'Memo Cuti Awal Ramadhan & Waktu Operasi',
 body: 'Pengumuman cuti awal Ramadhan dan jadual operasi kedai sepanjang bulan puasa.\n\nDikeluarkan: 17.02.2026\nKuatkuasa: 19.02.2026\n\nRujukan asal: https://drive.google.com/file/d/1ZNxeZMwQ8PhRIP44t02y_rer_2Pxin5W/view',
 posted_at: '2026-02-17T09:00:00.000Z' },
 { dept: 'hr', title: 'Memo Cuti Mingguan & Cuti Raya Aidilfitri',
 body: 'Jadual cuti mingguan dan cuti Aidilfitri 2026.\n\nDikeluarkan: 14.03.2026\nKuatkuasa: 16.03.2026\n\nRujukan asal: https://drive.google.com/file/d/1LdojmoCvMu3hRj9WMRCZ20PTNOrng1Ve/view',
 posted_at: '2026-03-14T09:00:00.000Z' },
 { dept: 'admin', title: 'Memo Operasi Kedai Selepas Cuti Raya',
 body: 'Jadual operasi kedai selepas Aidilfitri.\n\nDikeluarkan: 14.03.2026\nKuatkuasa: 25.03.2026\n\nRujukan asal: https://drive.google.com/file/d/1jhEyMVcIRKtYiDzhw3-b0n_r2XoGJFGc/view',
 posted_at: '2026-03-14T09:00:00.000Z' }
 ];
 try {
 const memos = (typeof window.memoLoad === 'function') ? window.memoLoad() : [];
 const existing = new Set(memos.map(m => m.title));
 Q1_MEMOS.forEach((m, i) => {
 if(existing.has(m.title)) return;
 memos.unshift({
 id: 'q1aliff_memo_' + i + '_' + Date.now(),
 department: m.dept,
 title: m.title,
 body: m.body,
 pinned: false,
 posted_by_id: aliffId,
 posted_by_name: aliffName,
 posted_at: m.posted_at,
 status: 'approved',
 approved_by_name: 'Zaid (auto-import Q1 Aliff Report)',
 approved_at: m.posted_at,
 reject_reason: null
 });
 summary.memos++;
 });
 if(typeof window.memoSaveAll === 'function') window.memoSaveAll(memos);
 } catch(e) { summary.errors.push('memos: ' + e.message); }

 // ---- 2. PETTY CASH (9 entries — opening balance, top-ups, monthly spend) ----
 const Q1_PETTY = [
 { date: '2026-01-01T00:00:00.000Z', type: 'IN', amount: 1303.63, notes: 'Q1 Aliff: Baki Petty Cash bawa ke Januari 2026' },
 { date: '2026-01-05T00:00:00.000Z', type: 'IN', amount: 1500.00, notes: 'Q1 Aliff: Top-up TODAK (Januari)' },
 { date: '2026-01-31T23:59:00.000Z', type: 'OUT', amount: 1829.39, notes: 'Q1 Aliff: Perbelanjaan Januari (rumusan bulanan)' },
 { date: '2026-02-05T00:00:00.000Z', type: 'IN', amount: 1500.00, notes: 'Q1 Aliff: Top-up TODAK (Februari)' },
 { date: '2026-02-28T23:59:00.000Z', type: 'OUT', amount: 1580.90, notes: 'Q1 Aliff: Perbelanjaan Februari (rumusan bulanan)' },
 { date: '2026-03-05T00:00:00.000Z', type: 'IN', amount: 1500.00, notes: 'Q1 Aliff: Top-up TODAK (Mac)' },
 { date: '2026-03-31T23:59:00.000Z', type: 'OUT', amount: 1131.20, notes: 'Q1 Aliff: Perbelanjaan Mac (rumusan bulanan)' }
 ];
 try {
 const existingPetty = new Set(pettyCashLedger.map(p => p.notes));
 Q1_PETTY.forEach((p, i) => {
 if(existingPetty.has(p.notes)) return;
 pettyCashLedger.push({
 id: 'q1aliff_petty_' + i + '_' + Date.now(),
 date: p.date,
 type: p.type,
 amount: p.amount,
 notes: p.notes
 });
 summary.petty++;
 });
 if(typeof window.persistPettyCash === 'function') window.persistPettyCash();
 if(typeof renderPettyCash === 'function') renderPettyCash();
 } catch(e) { summary.errors.push('petty: ' + e.message); }

 // ---- 3. FINANCE RECORDS (projects + monthly payment summaries) ----
 // 3 project CAPEX: SSM (Dec 2025), Pagar (Jan), Lesen Parking (Feb)
 // 3 monthly summary: Jan RM 11,790.80, Feb RM 8,500, Mar RM 5,688
 const Q1_FINANCE = [
 { month: 'December', year: 2025, category: 'CAPEX', amount: 285.00, description: 'Q1 Aliff: Pembaharuan Lesen Perniagaan SSM 10Camp Enterprise 2026 (22.12.2025)' },
 { month: 'January', year: 2026, category: 'CAPEX', amount: 12020.00, description: 'Q1 Aliff: Pemasangan Pagar & Pintu Pagar parking tingkat bawah (14.01.2026)' },
 { month: 'February', year: 2026, category: 'CAPEX', amount: 2385.00, description: 'Q1 Aliff: Lesen Parking Kenderaan Tambahan 2026 (Apr-Dec, lulus 01.04.2026)' },
 { month: 'January', year: 2026, category: 'OPEX', amount: 11790.80, description: 'Q1 Aliff: Rumusan 5 Payment Januari (Pembelian Barang, Petty Cash, Pemasaran, Renovasi Pagar)' },
 { month: 'February', year: 2026, category: 'OPEX', amount: 8500.00, description: 'Q1 Aliff: Rumusan 4 Payment Februari (Petty Cash, Pemasaran, Lesen Parking, Event)' },
 { month: 'March', year: 2026, category: 'OPEX', amount: 5688.00, description: 'Q1 Aliff: Rumusan 3 Payment Mac (Petty Cash, Pemasaran, Pembelian Barang)' }
 ];
 try {
 // Build a set of existing descriptions to dedupe by Q1 Aliff prefix.
 const fr = (typeof financeRecords !== 'undefined' && Array.isArray(financeRecords)) ? financeRecords : [];
 const existingFin = new Set(fr.map(f => (f.description || '')));
 for(const rec of Q1_FINANCE) {
 if(existingFin.has(rec.description)) continue;
 const payload = Object.assign({}, rec);
 let inserted = false;
 try {
 if(typeof db !== 'undefined' && db && db.from) {
 const { data, error } = await db.from('finance_records').insert([payload]).select();
 if(!error && data) {
 if(Array.isArray(financeRecords)) financeRecords.unshift(data[0]);
 inserted = true;
 }
 }
 } catch(e) {}
 if(!inserted) {
 payload.id = Date.now() + Math.floor(Math.random()*1000);
 if(Array.isArray(financeRecords)) financeRecords.push(payload);
 }
 summary.finance++;
 }
 if(typeof window.finRender === 'function') window.finRender();
 } catch(e) { summary.errors.push('finance: ' + e.message); }

 // ---- Mark seeded so boot won't re-run ----
 localStorage.setItem(window.SEED_Q1_ALIFF_FLAG, new Date().toISOString());

 console.log('[seedQ1Aliff] Done.', summary);
 if(typeof showToast === 'function') {
 showToast('Q1 Aliff Report imported: ' + summary.memos + ' memos, ' + summary.petty + ' petty cash, ' + summary.finance + ' finance records', 'success');
 }
 return summary;
};

// Boot-time auto-seed (idempotent — only runs once per browser).
// Defer to let core data load first.
document.addEventListener('DOMContentLoaded', () => {
 setTimeout(() => {
 if(!localStorage.getItem(window.SEED_Q1_ALIFF_FLAG)) {
 console.log('[seedQ1Aliff] First boot — auto-seeding Q1 Aliff Report...');
 window.seedQ1Aliff().catch(e => console.warn('[seedQ1Aliff] auto-seed failed:', e));
 }
 }, 3500);
});

// =============================================================
// p1_50 — ESYNC HEALTH BADGE (HQ → Sync section)
// =============================================================
// Reads sync_status table (written by GH Actions cron) + counts EasyStore
// orders in sales_history. Renders status pill + last-run timestamp + manual
// refresh button. Auto-refreshes every 60s while syncSection is visible.
window.__esSyncTimer = null;

window.esSyncFmtAge = function(ts) {
 if(!ts) return { text: 'Never', mins: Infinity, color: 'red' };
 const t = new Date(ts).getTime();
 if(isNaN(t)) return { text: 'Unknown', mins: Infinity, color: 'red' };
 const mins = Math.floor((Date.now() - t) / 60000);
 let text, color;
 if(mins < 1) text = 'Just now';
 else if(mins < 60) text = mins + ' min ago';
 else if(mins < 1440) text = Math.floor(mins/60) + ' jam ' + (mins%60) + ' min ago';
 else text = Math.floor(mins/1440) + ' hari ago';
 if(mins < 30) color = 'green';
 else if(mins < 60) color = 'amber';
 else color = 'red';
 return { text, mins, color };
};

window.esSyncRefresh = async function() {
 const badge = document.getElementById('esSyncBadge');
 const badgeTxt = document.getElementById('esSyncBadgeText');
 const lastRunEl = document.getElementById('esSyncLastRun');
 const webhookEl = document.getElementById('esSyncWebhookStatus');
 const orderCountEl = document.getElementById('esSyncOrderCount');
 const card = document.getElementById('esSyncHealthCard');
 if(!badge || !badgeTxt) return; // section not rendered

 if(!db) {
 badgeTxt.textContent = 'DB Offline';
 return;
 }

 // 1. Last cron run timestamp
 let lastRunTs = null;
 try {
 const { data } = await db.from('sync_status').select('last_run_at,note').eq('source', 'easystore_cron').maybeSingle();
 if(data && data.last_run_at) lastRunTs = data.last_run_at;
 } catch(e) { /* table may not exist yet — first cron tick creates it */ }

 // 2. EasyStore order count + latest order time
 let esOrderCount = 0, latestOrderTs = null;
 try {
 const { count } = await db.from('sales_history').select('id', { count: 'exact', head: true }).ilike('channel', 'EasyStore%');
 esOrderCount = count || 0;
 const { data: latest } = await db.from('sales_history').select('created_at').ilike('channel', 'EasyStore%').order('created_at', { ascending: false }).limit(1).maybeSingle();
 if(latest && latest.created_at) latestOrderTs = latest.created_at;
 } catch(e) {}

 // 3. Webhook health (HEAD/GET /api/easystore-webhook returns {ok:true,hmac_configured:true,...})
 let webhookOk = null;
 try {
 const r = await fetch('/api/easystore-webhook', { method: 'GET' });
 if(r.ok) {
 const j = await r.json();
 webhookOk = !!(j.ok && j.hmac_configured && j.supabase_configured);
 } else { webhookOk = false; }
 } catch(e) { webhookOk = false; }

 // Render. Status pill reflects WORST of (cron freshness, latest order freshness).
 // If cron has run within 30 min OR a real order arrived within 30 min, healthy.
 const cronAge = window.esSyncFmtAge(lastRunTs);
 const orderAge = window.esSyncFmtAge(latestOrderTs);
 const bestColor = (cronAge.color === 'green' || orderAge.color === 'green') ? 'green'
 : ((cronAge.color === 'amber' || orderAge.color === 'amber') ? 'amber' : 'red');

 if(lastRunEl) lastRunEl.textContent = cronAge.text + (lastRunTs ? '' : ' (cron not run yet — first tick within 15 min)');
 if(webhookEl) webhookEl.textContent = webhookOk === null ? 'Checking…' : (webhookOk ? 'Endpoint OK' : 'Endpoint DOWN');
 if(orderCountEl) orderCountEl.textContent = esOrderCount + ' orders · latest ' + orderAge.text;

 // Badge styling
 badge.classList.remove('armed', 'unarmed');
 if(card) card.style.borderLeftColor = '';
 if(bestColor === 'green') {
 badge.classList.add('armed');
 badgeTxt.textContent = 'Healthy';
 if(card) card.style.borderLeftColor = 'var(--success)';
 } else if(bestColor === 'amber') {
 badge.classList.add('unarmed');
 badgeTxt.textContent = 'Stale (' + Math.min(cronAge.mins, orderAge.mins) + ' min)';
 if(card) card.style.borderLeftColor = 'var(--warning)';
 } else {
 badge.classList.add('unarmed');
 badge.style.color = '#DC2626';
 badge.style.background = 'rgba(239,68,68,.12)';
 badgeTxt.textContent = 'STALE — check webhook';
 if(card) card.style.borderLeftColor = 'var(--danger)';
 }
};

// Wrap renderSyncSection so the badge auto-refreshes when section opens + every 60s.
document.addEventListener('DOMContentLoaded', () => {
 const installEsSyncHook = () => {
 const orig = window.renderSyncSection;
 if(typeof orig !== 'function' || orig.__esSyncWrapped) return;
 window.renderSyncSection = function() {
 const r = orig.apply(this, arguments);
 setTimeout(() => window.esSyncRefresh(), 50);
 if(window.__esSyncTimer) clearInterval(window.__esSyncTimer);
 window.__esSyncTimer = setInterval(() => {
 const sec = document.getElementById('syncSection');
 if(sec && sec.style.display !== 'none') window.esSyncRefresh();
 else if(window.__esSyncTimer) { clearInterval(window.__esSyncTimer); window.__esSyncTimer = null; }
 }, 60000);
 return r;
 };
 window.renderSyncSection.__esSyncWrapped = true;
 };
 // renderSyncSection is defined inside an IIFE in index.html — install after DOM ready.
 setTimeout(installEsSyncHook, 1500);
 setTimeout(installEsSyncHook, 4000); // backstop
});
