// marketing.js — p1_1027: MARKETING MODULE diekstrak dari app.js (Social Media / Content Schedule / Ads / Reports).
// LAZY-loaded (classic <script>, BUKAN module) bila page Marketing dibuka → kurangkan ~61KB parse boot app.js.
// Baca db / masterProducts / salesHistory / currentUser dari GLOBAL LEXICAL SCOPE app.js — MESTI load SELEPAS app.js.

// ============================================================================
// p1_467 — MARKETING MODULE (Social Media / Content Schedule / Ads / Reports)
// ============================================================================
window.__mktEsc = function(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
window.__mktPlat = { tiktok:{label:'TikTok',color:'#111'}, instagram:{label:'Instagram',color:'#C13584'}, facebook:{label:'FB Page',color:'#1877F2'}, threads:{label:'Threads',color:'#5C5C5C'}, shopee:{label:'Shopee Reels',color:'#EE4D2D'} }; // p1_1102 — 5 saluran rasmi 10 CAMP
window.__mktContentTypes = ['reel','post','story','live','carousel','video'];
// p1_1094 — PIPELINE PRODUKSI penuh (Zaid: "schedule marketing — record, editing, copywriting,
// post, ads, analytics"). Aliran: Idea → Rakam → Edit → Copywriting → Dijadual → Disiarkan → Ads → Selesai.
// Warna ikut brand-lock: neutral/amber/bronze/green shj (status exception). 'draft' lama dipetakan ke 'copy'.
window.__mktContentStatuses = [
 ['idea',      'Idea',        '#F3F4F6',                        '#6B7280'],
 ['rakam',     'Rakaman',     '#F8EFD7',                        '#7A5410'],
 ['edit',      'Editing',     '#F8EFD7',                        '#7A5410'],
 ['copy',      'Copywriting', 'var(--primary-100,#FFEDD5)',     'var(--primary-800,#7C4A1A)'],
 ['scheduled', 'Dijadual',    'var(--primary-100,#FFEDD5)',     'var(--primary-800,#7C4A1A)'],
 ['posted',    'Disiarkan',   '#E4EFE2',                        '#345E43'],
 ['ads',       'Ads / Boost', '#F8EFD7',                        '#7A5410'],
 ['done',      'Selesai',     '#E4EFE2',                        '#345E43']
];
window.__mktStageFlow = ['idea','rakam','edit','copy','scheduled','posted','ads','done'];
window.__mktStageHints = {
 idea:'Tulis idea + pilih produk & platform', rakam:'Shoot video/gambar — nota dlm kad',
 edit:'Potong video, subtitle, thumbnail', copy:'Tulis caption + hook (guna butang AI)',
 scheduled:'Siap semua — tunggu tarikh siar', posted:'Dah siar — tampal link + isi views',
 ads:'Boost post berprestasi — rekod di tab Ads', done:'Analitik diisi — siap!'
};
window.__mktAdPlatforms = [['tiktok_ads','TikTok Ads'],['meta','Meta (FB/IG)'],['shopee_ads','Shopee Ads'],['google','Google']];
window.__mktAdStatuses = [['active','Aktif','#E4EFE2','#345E43'],['paused','Dijeda','#F8EFD7','#7A5410'],['ended','Tamat','#F3F4F6','#6B7280']];

window.__mktRangeMs = function(range){
 const now = Date.now(); const day = 86400000; let span;
 if(range==='7d') span = 7*day; else if(range==='90d') span = 90*day;
 else if(range==='ytd') span = now - new Date(new Date().getFullYear(),0,1).getTime();
 else span = 30*day;
 return { from: now-span, to: now, prevFrom: now-2*span, prevTo: now-span, span };
};
window.__mktPills = function(currentRange, fnName){
 const opts = [['7d','7 hari'],['30d','30 hari'],['90d','90 hari'],['ytd','YTD']];
 return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">'+opts.map(function(o){ return '<button onclick="'+fnName+'(\''+o[0]+'\')" style="padding:5px 14px;border-radius:50px;border:1px solid '+(currentRange===o[0]?'var(--primary)':'var(--border-color)')+';background:'+(currentRange===o[0]?'var(--primary)':'#fff')+';color:'+(currentRange===o[0]?'#fff':'#6B7280')+';font-size:12px;font-weight:700;cursor:pointer;">'+o[1]+'</button>'; }).join('')+'</div>';
};
window.__mktDelta = function(cur, prev){
 if(!prev) return cur>0 ? '<span style="color:#4E7C4A;font-size:11px;font-weight:700;">▲ baru</span>' : '<span style="color:#9CA3AF;font-size:11px;">—</span>';
 const d = Math.round((cur-prev)/prev*100);
 if(d===0) return '<span style="color:#9CA3AF;font-size:11px;">0%</span>';
 return d>0 ? '<span style="color:#4E7C4A;font-size:11px;font-weight:700;">▲ '+d+'%</span>' : '<span style="color:#B23A2E;font-size:11px;font-weight:700;">▼ '+Math.abs(d)+'%</span>';
};
window.__mktProdImg = function(sku){ try { return (typeof window.__aoImgFor==='function') ? window.__aoImgFor(sku) : ''; } catch(e){ return ''; } };
window.__mktProdName = function(sku){ try { const p=(typeof masterProducts!=='undefined'&&masterProducts)?masterProducts.find(function(x){return x.sku===sku;}):null; return p?(p.name||''):''; } catch(e){ return ''; } };
window.__mktThumb = function(sku, size){
 const s = size||44; const img = window.__mktProdImg(sku);
 if(img) return '<img src="'+window.__mktEsc(img)+'" alt="" style="width:'+s+'px;height:'+s+'px;object-fit:cover;border-radius:6px;border:1px solid #E5E7EB;flex-shrink:0;" onerror="this.style.display=\'none\'">';
 return '<div style="width:'+s+'px;height:'+s+'px;border-radius:6px;background:#F3F4F6;border:1px solid #E5E7EB;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i data-lucide="image-off" style="width:16px;height:16px;color:#9CA3AF;"></i></div>';
};

// ---- shared loaders (cached) ----
window.__mktWeeklyCache = null;
window.__mktLoadWeekly = async function(force){
 if(window.__mktWeeklyCache && !force) return window.__mktWeeklyCache;
 try { const r = await db.from('staff_report_submissions').select('*').eq('submission_type','marketing_weekly').order('period_key',{ascending:false}).limit(300); window.__mktWeeklyCache = r.data||[]; }
 catch(e){ window.__mktWeeklyCache = []; }
 return window.__mktWeeklyCache;
};
window.__mktAggWeekly = function(rows, fromMs, toMs){
 const agg = { tiktok:{posts:0,views:0,likes:0,leads:0}, instagram:{posts:0,views:0,likes:0,leads:0}, facebook:{posts:0,views:0,likes:0,leads:0} };
 (rows||[]).forEach(function(r){
  const t = new Date(r.period_key||0).getTime();
  if(isNaN(t) || t<fromMs || t>toMs) return;
  const p = r.payload||{};
  ['tiktok','instagram','facebook'].forEach(function(pl){ const d=p[pl]||{}; agg[pl].posts+=Number(d.posts)||0; agg[pl].views+=Number(d.views)||0; agg[pl].likes+=Number(d.likes)||0; agg[pl].leads+=Number(d.leads)||0; });
 });
 return agg;
};
window.__mktContentCache = [];
window.__mktLoadContent = async function(){ try { const r = await db.from('marketing_content').select('*').order('scheduled_date',{ascending:true}); window.__mktContentCache = r.data||[]; } catch(e){ window.__mktContentCache=[]; } return window.__mktContentCache; };
window.__mktAdsCache = [];
window.__mktLoadAds = async function(){ try { const r = await db.from('marketing_ads').select('*').order('start_date',{ascending:false}); window.__mktAdsCache = r.data||[]; } catch(e){ window.__mktAdsCache=[]; } return window.__mktAdsCache; };

// =================== 1) SOCIAL MEDIA ===================
window.__mktRangeSocial = '30d';
window.__mktSetSocialRange = function(r){ window.__mktRangeSocial = r; window.renderSocialMedia(); };
window.__mktGetAccounts = function(){ try { return JSON.parse(localStorage.getItem('mktSocialAccounts_v1')||'{}')||{}; } catch(e){ return {}; } };
window.__mktSaveAccounts = function(){
 const acc = {};
 ['tiktok','instagram','facebook','threads','shopee'].forEach(function(pl){ const el=document.getElementById('mktAcc_'+pl); if(el) acc[pl]=el.value.trim(); });
 try { localStorage.setItem('mktSocialAccounts_v1', JSON.stringify(acc)); } catch(e){}
 if(typeof showToast==='function') showToast('Akaun sosial disimpan.', 'success');
};
// p1_705 — Social Media dashboard helpers: followers (latest dlm tempoh), input mingguan inline, sparkline trend.
window.__smLatestFollowers = function(rows, fromMs, toMs){
 const out = { tiktok:0, instagram:0, facebook:0 }, lt = { tiktok:-1, instagram:-1, facebook:-1 };
 (rows||[]).forEach(function(r){
  const t = new Date(r.period_key||0).getTime(); if(isNaN(t)||t<fromMs||t>toMs) return;
  const p = r.payload||{};
  ['tiktok','instagram','facebook'].forEach(function(pl){ const f=Number(p[pl]&&p[pl].followers)||0; if(f>0 && t>lt[pl]){ lt[pl]=t; out[pl]=f; } });
 });
 return out;
};
window.__smWeekViews = function(rows, n){
 const byWeek = {};
 (rows||[]).forEach(function(r){ const k=r.period_key; if(!k) return; const p=r.payload||{}; byWeek[k]=byWeek[k]||{tiktok:0,instagram:0,facebook:0}; ['tiktok','instagram','facebook'].forEach(function(pl){ byWeek[k][pl]+=Number(p[pl]&&p[pl].views)||0; }); });
 const weeks = Object.keys(byWeek).sort().slice(-n);
 return weeks.map(function(w){ return byWeek[w]; });
};
window.__smSpark = function(vals, color){
 const max = Math.max.apply(null, vals.concat([1]));
 if(!vals.length) return '<div style="font-size:10px;color:#D1D5DB;">tiada data</div>';
 const bars = vals.map(function(v){ const h = Math.round((v/max)*26)+2; return '<div title="'+(Number(v)||0).toLocaleString()+'" style="flex:1;min-width:7px;max-width:16px;height:'+h+'px;background:'+color+';border-radius:2px;opacity:'+(v>0?1:0.2)+';"></div>'; }).join('');
 return '<div style="display:flex;align-items:flex-end;gap:3px;height:30px;">'+bars+'</div>';
};
window.__smLoadWeekInputs = async function(){
 const ws = document.getElementById('smWeek'); if(!ws||!ws.value) return;
 const u = window.currentUser||{};
 const set = function(id,v){ const el=document.getElementById(id); if(el) el.value = (v!=null&&v!==0)?v:''; };
 try {
  const { data } = await db.from('staff_report_submissions').select('payload').eq('submission_type','marketing_weekly').eq('period_key',ws.value).eq('staff_id', u.staff_id||'unknown').maybeSingle();
  const p = (data&&data.payload)||{};
  [['tiktok','Tt'],['instagram','Ig'],['facebook','Fb']].forEach(function(x){ const d=p[x[0]]||{}, k=x[1]; set('sm'+k+'Posts',d.posts); set('sm'+k+'Views',d.views); set('sm'+k+'Likes',d.likes); set('sm'+k+'Leads',d.leads); set('sm'+k+'Foll',d.followers); });
 } catch(e){}
};
window.__smSaveWeek = async function(){
 const ws = document.getElementById('smWeek'); if(!ws||!ws.value){ if(window.showToast) showToast('Pilih minggu dulu.','warn'); return; }
 const weekStart = ws.value; const g = function(id){ const v=document.getElementById(id); return v?(Number(v.value)||0):0; };
 const u = window.currentUser||{};
 const mk = function(k){ return { posts:g('sm'+k+'Posts'), views:g('sm'+k+'Views'), likes:g('sm'+k+'Likes'), leads:g('sm'+k+'Leads'), followers:g('sm'+k+'Foll') }; };
 let existing = {};
 try { const { data } = await db.from('staff_report_submissions').select('payload').eq('submission_type','marketing_weekly').eq('period_key',weekStart).eq('staff_id', u.staff_id||'unknown').maybeSingle(); existing = (data&&data.payload)||{}; } catch(e){}
 const payload = Object.assign({}, existing, { tiktok:mk('Tt'), instagram:mk('Ig'), facebook:mk('Fb'), __updated_at:new Date().toISOString() });
 try {
  const { error } = await db.from('staff_report_submissions').upsert({ staff_id:u.staff_id||'unknown', staff_name:u.name||'Unknown', submission_type:'marketing_weekly', period_key:weekStart, payload, submitted_at:new Date().toISOString(), bos_read_at:null }, { onConflict:'staff_id,submission_type,period_key' });
  if(error) throw error;
  window.__mktWeeklyCache = null;
  if(window.showToast) showToast('Data sosial minggu '+weekStart+' disimpan.','success');
  window.renderSocialMedia();
 } catch(e){ if(window.showToast) showToast('Gagal simpan: '+e.message,'error'); }
};

window.renderSocialMedia = async function(){
 const body = document.getElementById('socialMediaBody');
 if(!body) return;
 body.innerHTML = '<p style="color:#9CA3AF;padding:30px;text-align:center;">Memuatkan…</p>';
 const rows = await window.__mktLoadWeekly(true);
 const rg = window.__mktRangeMs(window.__mktRangeSocial);
 const cur = window.__mktAggWeekly(rows, rg.from, rg.to);
 const prev = window.__mktAggWeekly(rows, rg.prevFrom, rg.prevTo);
 const fCur = window.__smLatestFollowers(rows, rg.from, rg.to);
 const fPrev = window.__smLatestFollowers(rows, rg.prevFrom, rg.prevTo);
 const trend = window.__smWeekViews(rows, 8);
 let posted = [];
 try { const r = await db.from('marketing_content').select('*').eq('status','posted').order('posted_at',{ascending:false}).limit(60); posted = r.data||[]; } catch(e){}
 // p1_1109 — AUTO-TARIK FB Page dari Meta Graph (token kekal p1_1081 dah hidup): followers live
 // + post/likes/komen terkini. IG tunggu App Review (parked); TikTok/Threads/Shopee tiada API stats
 // organik utk SME — kekal manual. Gagal/tak connect → senyap, kad kekal manual.
 let fbLive = null;
 try {
  const H = (typeof window.__authHeaderSync==='function') ? window.__authHeaderSync({}) : {};
  const pg = await fetch('/.netlify/functions/meta-insights?mode=page', { headers:H }).then(function(r){return r.json();});
  if(pg && pg.page && pg.page.followers != null) fbLive = { followers:Number(pg.page.followers)||0, reach:pg.reach_28d };
  const po = await fetch('/.netlify/functions/meta-insights?mode=posts', { headers:H }).then(function(r){return r.json();});
  if(po && Array.isArray(po.posts) && po.posts.length){
   fbLive = fbLive || {};
   fbLive.posts = po.posts.length;
   fbLive.likes = po.posts.reduce(function(t,x){ return t+(Number(x.likes)||0); },0);
   fbLive.comments = po.posts.reduce(function(t,x){ return t+(Number(x.comments)||0); },0);
  }
 } catch(e){}
 const acc = window.__mktGetAccounts();
 const E = window.__mktEsc;
 const cards = ['tiktok','instagram','facebook'].map(function(pl){
  const m = window.__mktPlat[pl]; const c = cur[pl]; const p = prev[pl];
  const eng = c.views>0 ? ((c.likes/c.views)*100).toFixed(1)+'%' : '—';
  const sv = trend.map(function(d){ return d[pl]; });
  // p1_1109 — FB: followers LIVE dari Meta (auto); posts/likes live dipakai bila manual kosong
  const isFbAuto = (pl==='facebook' && fbLive);
  const follVal = isFbAuto ? fbLive.followers : (fCur[pl]||0);
  const autoBadge = isFbAuto ? ' <span title="Auto-tarik live dari Meta Graph API" style="font-size:8.5px;font-weight:800;color:#fff;background:#2e7d32;padding:1px 7px;border-radius:50px;vertical-align:2px;">AUTO</span>' : '';
  const fbStrip = isFbAuto ? '<div style="margin:-2px 0 8px;font-size:10px;color:#2e7d32;font-weight:600;">Live dari Meta: '+(fbLive.posts!=null?fbLive.posts+' post terkini · '+(fbLive.likes||0).toLocaleString()+' likes · '+(fbLive.comments||0).toLocaleString()+' komen':'followers sahaja')+(fbLive.reach!=null?' · reach 28hr '+Number(fbLive.reach).toLocaleString():'')+'</div>' : '';
  return '<div class="admin-card" style="padding:16px;border-top:3px solid '+m.color+';">'
   + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;"><strong style="font-size:14px;">'+m.label+autoBadge+'</strong>'+window.__mktDelta(c.views,p.views)+'</div>'
   + '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px;"><div><div style="font-size:10px;color:#9CA3AF;text-transform:uppercase;">Followers</div><div style="font-size:22px;font-weight:800;">'+follVal.toLocaleString()+'</div></div>'+(isFbAuto?'':window.__mktDelta(fCur[pl],fPrev[pl]))+'</div>'
   + fbStrip
   + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">'
   + '<div><div style="font-size:9px;color:#9CA3AF;text-transform:uppercase;">Posts</div><div style="font-size:15px;font-weight:800;">'+c.posts+'</div></div>'
   + '<div><div style="font-size:9px;color:#9CA3AF;text-transform:uppercase;">Views</div><div style="font-size:15px;font-weight:800;">'+c.views.toLocaleString()+'</div></div>'
   + '<div><div style="font-size:9px;color:#9CA3AF;text-transform:uppercase;">Likes</div><div style="font-size:15px;font-weight:800;">'+c.likes.toLocaleString()+'</div></div>'
   + '<div><div style="font-size:9px;color:#9CA3AF;text-transform:uppercase;">Engage</div><div style="font-size:15px;font-weight:800;">'+eng+'</div></div>'
   + '<div><div style="font-size:9px;color:#9CA3AF;text-transform:uppercase;">Leads</div><div style="font-size:15px;font-weight:800;color:var(--primary);">'+c.leads+'</div></div>'
   + '</div>'
   + '<div style="margin-top:10px;"><div style="font-size:8.5px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">Views 8 minggu</div>'+window.__smSpark(sv, m.color)+'</div>'
   + '</div>';
 }).join('');
 const inp = function(id,ph){ return '<input id="'+id+'" type="number" min="0" placeholder="'+ph+'" style="width:100%;padding:6px 7px;border:1px solid var(--border-color);border-radius:6px;font-size:12px;">'; };
 const inRow = function(label, k, color){
  return '<div style="display:grid;grid-template-columns:80px repeat(5,1fr);gap:6px;align-items:center;margin-bottom:6px;">'
   + '<span style="font-size:12px;font-weight:700;color:'+color+';">'+label+'</span>'
   + inp('sm'+k+'Posts','Posts') + inp('sm'+k+'Views','Views') + inp('sm'+k+'Likes','Likes') + inp('sm'+k+'Leads','Leads') + inp('sm'+k+'Foll','Foll')
   + '</div>';
 };
 const hdr = function(t){ return '<span style="font-size:9px;color:#9CA3AF;text-transform:uppercase;text-align:center;">'+t+'</span>'; };
 const quickInput = '<div class="admin-card" style="padding:16px;margin-bottom:18px;">'
  + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;"><strong style="font-size:13px;"><i data-lucide="edit-3" style="width:14px;height:14px;vertical-align:-2px;"></i> Input Mingguan Pantas</strong>'
  + '<div style="display:flex;align-items:center;gap:8px;"><label style="font-size:11px;color:#6B7280;">Minggu mula</label><input type="date" id="smWeek" style="padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;font-size:12px;"><button onclick="window.__smSaveWeek()" style="padding:7px 18px;background:var(--primary);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;">Simpan</button></div></div>'
  + '<div style="display:grid;grid-template-columns:80px repeat(5,1fr);gap:6px;margin-bottom:4px;"><span></span>'+hdr('Posts')+hdr('Views')+hdr('Likes')+hdr('Leads')+hdr('Followers')+'</div>'
  + inRow('TikTok','Tt','#111') + inRow('Instagram','Ig','#C13584') + inRow('Facebook','Fb','#1877F2')
  + '<p style="font-size:10.5px;color:#9CA3AF;margin-top:8px;">Isi nombor dari analytics app sosial → pilih minggu → Simpan. Kad &amp; graf atas auto-update. NOTA: Followers FB dah AUTO dari Meta (tak perlu isi); views/leads FB + semua TikTok &amp; IG masih manual — TikTok tak bagi API stats, IG menunggu kelulusan Meta App Review.</p>'
  + '</div>';
 const accRow = ['tiktok','instagram','facebook','threads','shopee'].map(function(pl){
  const m = window.__mktPlat[pl];
  return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="width:78px;font-size:12px;font-weight:700;color:'+m.color+';">'+m.label+'</span>'
   + '<input id="mktAcc_'+pl+'" value="'+E(acc[pl]||'')+'" placeholder="@handle atau link" style="flex:1;padding:7px 10px;border:1px solid var(--border-color);border-radius:7px;font-size:12px;">'
   + (acc[pl]?('<a href="'+E(acc[pl].indexOf('http')===0?acc[pl]:'https://'+acc[pl])+'" target="_blank" style="padding:6px 9px;background:#F3F4F6;border-radius:6px;font-size:11px;color:#374151;text-decoration:none;font-weight:700;">Buka</a>'):'')
   + '</div>';
 }).join('');
 // p1_706 — Top Posts: kandungan disiarkan dlm tempoh, susun ikut Views, papar metrik prestasi
 const inRange = (posted||[]).filter(function(c){ if(!c.posted_at) return false; const t=new Date(c.posted_at).getTime(); return t>=rg.from && t<=rg.to; });
 const topPosts = inRange.sort(function(a,b){ return (Number(b.views)||0)-(Number(a.views)||0); }).slice(0,10);
 const metric = function(lbl,val,col){ return '<div style="text-align:center;min-width:48px;"><div style="font-size:9px;color:#9CA3AF;text-transform:uppercase;">'+lbl+'</div><div style="font-size:13px;font-weight:800;'+(col?'color:'+col+';':'')+'">'+val+'</div></div>'; };
 const postedList = topPosts.length ? topPosts.map(function(c){
  const plats = (c.platforms||'').split(',').filter(Boolean).map(function(pl){ const m=window.__mktPlat[pl]; return m?('<span style="font-size:9px;font-weight:700;color:'+m.color+';border:1px solid '+m.color+';padding:1px 5px;border-radius:4px;">'+m.label+'</span>'):''; }).join(' ');
  const dt = c.posted_at ? new Date(c.posted_at).toLocaleDateString('en-MY',{day:'numeric',month:'short'}) : '';
  const vw=Number(c.views)||0, lk=Number(c.likes)||0, ld=Number(c.leads)||0;
  const eng = vw>0 ? ((lk/vw)*100).toFixed(1)+'%' : '—';
  return '<div style="display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #F3F4F6;flex-wrap:wrap;">'+window.__mktThumb(c.product_sku,42)
   + '<div style="flex:1;min-width:140px;"><div style="font-size:12.5px;font-weight:700;">'+E((c.title||'').slice(0,55))+'</div><div style="font-size:10.5px;color:#9CA3AF;margin-top:2px;">'+plats+(c.product_sku?(' · <span style="color:#374151;font-weight:700;">'+E(c.product_sku)+'</span>'):'')+' · '+dt+'</div></div>'
   + metric('Views',vw.toLocaleString()) + metric('Likes',lk.toLocaleString()) + metric('Engage',eng) + metric('Leads',ld,'var(--primary)')
   + (c.link?('<a onclick="event.stopPropagation()" href="'+E(c.link)+'" target="_blank" style="font-size:11px;color:var(--primary);font-weight:700;text-decoration:none;margin-left:4px;">Tengok</a>'):'')+'</div>';
 }).join('') : '<p style="color:#9CA3AF;font-size:12px;padding:14px 0;text-align:center;">Tiada kandungan disiarkan dalam tempoh ni. Tandakan "posted" + isi Views/Likes/Leads di Content Schedule.</p>';
 // p1_707 — Attribution: jualan POS ikut lead_source yang cashier rekod masa checkout
 const socialSet = { Instagram:'#C13584', Facebook:'#1877F2', TikTok:'#111', WhatsApp:'#25D366' };
 const isReal = window.__isRealSale || function(){ return true; };
 const attr = {};
 ((typeof salesHistory!=='undefined' && Array.isArray(salesHistory)) ? salesHistory : []).forEach(function(s){
  if(!s || !s.lead_source || !isReal(s)) return;
  const t = new Date(s.created_at||0).getTime(); if(t<rg.from || t>rg.to) return;
  const k = s.lead_source; attr[k]=attr[k]||{n:0,rm:0}; attr[k].n++; attr[k].rm += Number(s.total||s.total_amount||0);
 });
 const attrKeys = Object.keys(attr).sort(function(a,b){ return attr[b].rm-attr[a].rm; });
 const attrTotal = attrKeys.reduce(function(s,k){ return s+attr[k].rm; }, 0);
 const socialRm = attrKeys.filter(function(k){ return socialSet[k]; }).reduce(function(s,k){ return s+attr[k].rm; }, 0);
 const attrRows = attrKeys.length ? attrKeys.map(function(k){
  const a=attr[k], col=socialSet[k]||'#6B7280', isSoc=!!socialSet[k], pct=attrTotal>0?Math.round(a.rm/attrTotal*100):0;
  return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #F3F4F6;"><span style="width:10px;height:10px;border-radius:50%;background:'+col+';flex-shrink:0;"></span><span style="flex:1;font-size:13px;font-weight:'+(isSoc?'800':'600')+';color:'+(isSoc?col:'#374151')+';">'+E(k)+(isSoc?' <span style="font-size:8.5px;background:'+col+';color:#fff;padding:1px 5px;border-radius:4px;">sosial</span>':'')+'</span><span style="font-size:12px;color:#9CA3AF;">'+a.n+' order</span><strong style="font-size:13px;min-width:92px;text-align:right;">RM '+a.rm.toFixed(2)+'</strong><span style="font-size:11px;color:#9CA3AF;min-width:36px;text-align:right;">'+pct+'%</span></div>';
 }).join('') : '<p style="color:#9CA3AF;font-size:12px;padding:14px 0;text-align:center;">Belum ada data sumber. Cashier pilih "Sumber pelanggan" masa checkout → attribution muncul di sini.</p>';
 const attrCard = '<div class="admin-card" style="padding:16px;margin-bottom:18px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:6px;"><strong style="font-size:13px;"><i data-lucide="git-merge" style="width:14px;height:14px;vertical-align:-2px;"></i> Sumber Jualan (Attribution)</strong>'+(attrTotal>0?'<span style="font-size:11px;color:#345E43;font-weight:800;">Sosial bawa RM '+socialRm.toFixed(2)+' dari RM '+attrTotal.toFixed(2)+'</span>':'')+'</div><p style="font-size:10.5px;color:#9CA3AF;margin:0 0 8px;">Jualan POS (walk-in) ikut sumber yang cashier rekod masa checkout. Tempoh ikut pilihan atas.</p>'+attrRows+'</div>';

 body.innerHTML = '<div class="rp-wrap">'
  + '<div class="rp-header" style="margin-bottom:6px;"><div><h2 class="rp-title"><i data-lucide="share-2" style="width:22px;height:22px;color:var(--primary);"></i> Social Media</h2><p class="rp-subtitle">Followers, views, engagement + trend mingguan TikTok/IG/FB. Isi nombor terus di bawah (Input Mingguan Pantas).</p></div></div>'
  + window.__mktPills(window.__mktRangeSocial, 'window.__mktSetSocialRange')
  + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-bottom:18px;">'+cards+'</div>'
  + quickInput
  + attrCard
  + '<div class="admin-card" style="padding:16px;margin-bottom:18px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;"><strong style="font-size:13px;"><i data-lucide="link" style="width:14px;height:14px;vertical-align:-2px;"></i> Direktori Akaun</strong><button onclick="window.__mktSaveAccounts()" style="padding:6px 14px;background:var(--primary);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;">Simpan</button></div>'+accRow+'</div>'
  + '<div class="admin-card" style="padding:16px;"><strong style="font-size:13px;"><i data-lucide="trending-up" style="width:14px;height:14px;vertical-align:-2px;"></i> Top Posts — Prestasi Kandungan</strong><div style="margin-top:10px;">'+postedList+'</div></div>'
  + '</div>';
 const __wk = document.getElementById('smWeek');
 if(__wk){ if(!__wk.value){ try{ __wk.value = window.__mwGetWeekStart(new Date()).toISOString().slice(0,10); }catch(e){} } __wk.onchange = window.__smLoadWeekInputs; window.__smLoadWeekInputs(); }
 if(window.lucide && lucide.createIcons) try{ lucide.createIcons(); }catch(e){}
};

// =================== 2) CONTENT SCHEDULE ===================
window.__mktContentFilter = { status:'all', platform:'all', date:'all' };
window.__mktSetContentFilter = function(k,v){ window.__mktContentFilter[k]=v; window.renderContentSchedule(); };
// p1_1101 — kad kandungan (dikongsi paparan Kalendar + Senarai)
window.__mktContentCard = function(c){
 const E = window.__mktEsc;
 const st = window.__mktContentStatuses.find(function(s){return s[0]===c.status;}) || ['idea','Idea','#F3F4F6','#6B7280'];
 const flowIdx = window.__mktStageFlow.indexOf(c.status);
 const nextKey = flowIdx >= 0 && flowIdx < window.__mktStageFlow.length-1 ? window.__mktStageFlow[flowIdx+1] : null;
 const nextSt = nextKey ? window.__mktContentStatuses.find(function(s){return s[0]===nextKey;}) : null;
 const plats = (c.platforms||'').split(',').filter(Boolean).map(function(pl){ const m=window.__mktPlat[pl]; return m?('<span style="font-size:9px;font-weight:700;color:'+m.color+';border:1px solid '+m.color+';padding:1px 5px;border-radius:4px;">'+m.label+'</span>'):''; }).join(' ');
 const dt = c.scheduled_date ? new Date(c.scheduled_date).toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}) : 'tiada tarikh';
 const metrics = (c.views||c.likes||c.leads) ? ('<div style="font-size:11px;color:#345E43;margin-top:4px;font-weight:600;"><i data-lucide="bar-chart-2" style="width:10px;height:10px;vertical-align:-1px;"></i> '+Number(c.views||0).toLocaleString()+' views · '+Number(c.likes||0).toLocaleString()+' likes · '+Number(c.leads||0).toLocaleString()+' leads</div>') : '';
 const preCopy = ['idea','rakam','edit','copy'].indexOf(c.status)!==-1;
 // p1_1103 — SELURUH kad boleh-klik → buka Edit (Zaid); butang dalaman stopPropagation
 return '<div onclick="window.__mktContentModal('+c.id+')" title="Klik untuk edit" style="display:flex;gap:12px;align-items:center;padding:12px;border:1px solid var(--border-color);border-radius:9px;margin-bottom:8px;background:#fff;cursor:pointer;" onmouseover="this.style.borderColor=\'var(--primary)\'" onmouseout="this.style.borderColor=\'\'">'+window.__mktThumb(c.product_sku,48)
  + '<div style="flex:1;min-width:0;">'
  + '<div style="font-size:13px;font-weight:700;">'+E((c.title||'').slice(0,70))+'</div>'
  + '<div style="font-size:11px;color:#9CA3AF;margin-top:3px;">'+plats+' · '+E(c.content_type||'')+' · <i data-lucide="calendar" style="width:10px;height:10px;vertical-align:-1px;"></i> '+dt+(c.assigned_to_name?(' · '+E(c.assigned_to_name)):'')+'</div>'
  + (c.caption?('<div style="font-size:11px;color:#6B7280;margin-top:4px;font-style:italic;">'+E((c.caption||'').slice(0,90))+'</div>'):'')
  + metrics
  + '</div>'
  + '<div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;">'
  + '<span title="'+E(window.__mktStageHints[c.status]||'')+'" style="padding:3px 9px;border-radius:50px;background:'+st[2]+';color:'+st[3]+';font-size:10px;font-weight:700;">'+(flowIdx>=0?(flowIdx+1)+'/'+window.__mktStageFlow.length+' · ':'')+st[1]+'</span>'
  + '<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">'
  + (nextSt?('<button onclick="event.stopPropagation(); window.__mktAdvanceStage('+c.id+')" title="'+E(window.__mktStageHints[nextKey]||'')+'" style="background:var(--primary);border:none;color:#fff;padding:4px 9px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700;"><i data-lucide="arrow-right" style="width:10px;height:10px;vertical-align:-1px;"></i> '+nextSt[1]+'</button>'):'')
  + (preCopy?('<button onclick="event.stopPropagation(); window.__mktAiCopy('+c.id+')" title="Minta Tanya AI draf caption" style="background:none;border:1px solid var(--primary);color:var(--primary);padding:4px 8px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700;">AI Copy</button>'):'')
  + (c.status==='scheduled' && (c.platforms||'').indexOf('facebook')!==-1?('<button onclick="event.stopPropagation(); window.__mktSendToAutoPost('+c.id+')" title="Prefill Auto-Post FB" style="background:none;border:1px solid var(--primary);color:var(--primary);padding:4px 8px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700;">Post FB</button>'):'')
  + (c.status==='ads'?('<button onclick="event.stopPropagation(); window.__mktHubGo(\'playbook\',\'ads\')" title="Rekod kempen di tab Ads" style="background:none;border:1px solid var(--primary);color:var(--primary);padding:4px 8px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700;">Buka Ads</button>'):'')
  + (c.link?('<a onclick="event.stopPropagation()" href="'+E(c.link)+'" target="_blank" style="background:#F3F4F6;color:#374151;padding:4px 8px;border-radius:5px;font-size:10px;font-weight:700;text-decoration:none;">Link</a>'):'')
  + '<button onclick="event.stopPropagation(); window.__mktContentModal('+c.id+')" title="Edit" style="background:none;border:1px solid var(--border-color);color:#6B7280;padding:4px 8px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700;">Edit</button>'
  + '<button onclick="event.stopPropagation(); window.__mktDeleteContent('+c.id+')" title="Padam" style="background:none;border:1px solid #E0B3A9;color:#7C2A20;padding:4px 7px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700;"><i data-lucide="trash-2" style="width:11px;height:11px;"></i></button>'
  + '</div></div></div>';
};
// p1_1101 — paparan KALENDAR (default; Zaid: "display calendar, tekan tarikh keluar semua planning hari tu")
window.__mktContentView = window.__mktContentView || 'cal';
window.__mktSetView = function(v){ window.__mktContentView = v; window.renderContentSchedule(); };
window.__mktCalNav = function(d){
 const p = (window.__mktCalMonth||'').split('-');
 const nd = new Date(Number(p[0]), Number(p[1])-1+d, 1);
 window.__mktCalMonth = nd.getFullYear()+'-'+String(nd.getMonth()+1).padStart(2,'0');
 window.renderContentSchedule();
};
window.__mktCalPick = function(iso){ window.__mktCalSel = iso; window.renderContentSchedule(); };
// p1_1106 — JANA RENTAK MINGGU: 1 klik cipta 5 kad aktiviti mingguan Irfan utk minggu tarikh dipilih.
// Skip kalau minggu tu dah ada kad [PLAN] (elak duplicate).
// p1_1107 — GANJARAN KONTEN IRFAN (SKIM CADANGAN — angka final keputusan Bos, bayar ikut Aliff).
// (a) Bonus views per konten (tier), (b) komisen % dari MARGIN jualan SKU berkaitan
// dalam 7 hari selepas siar (auto-anggar dari salesHistory; SKU mesti diisi pada kad).
window.__mktBonusTiers = [[500000,300],[100000,150],[50000,80],[10000,30]]; // [views, RM]
window.__mktKomisenPct = 5; // % dari margin
window.__mktGanjaranHtml = function(all){
 const u = window.currentUser || {};
 const boss = (typeof window.isBoss==='function' && window.isBoss(u));
 if(!(boss || u.name==='Irfan')) return '';
 const E = window.__mktEsc;
 const posted = all.filter(function(c){ return ['posted','ads','done'].indexOf(c.status)!==-1 && (c.title||'').indexOf('[')!==0; });
 const tierOf = function(v){ const t=(window.__mktBonusTiers||[]).find(function(x){return v>=x[0];}); return t?t[1]:0; };
 let totBonus=0, totKom=0;
 const rows = posted.map(function(c){
  const views = Number(c.views)||0;
  const bonus = tierOf(views); totBonus += bonus;
  let salesRM=0, marginRM=0, adaKos=true;
  if(c.product_sku && c.posted_at && typeof salesHistory!=='undefined' && Array.isArray(salesHistory)){
   const t0 = new Date(c.posted_at).getTime(), t1 = t0 + 7*86400000;
   const prod = (typeof masterProducts!=='undefined' && masterProducts) ? masterProducts.find(function(p){return p.sku===c.product_sku;}) : null;
   const kos = prod ? (parseFloat(prod.cost_price)||0) : 0;
   if(!kos) adaKos=false;
   salesHistory.forEach(function(sale){
    const ts = new Date(sale.created_at).getTime();
    if(!(ts>=t0 && ts<=t1)) return;
    if(typeof window.__isRealSale==='function' && !window.__isRealSale(sale)) return;
    let items=[]; try{ items = typeof sale.items==='string' ? JSON.parse(sale.items||'[]') : (sale.items||[]); }catch(e){}
    items.forEach(function(it){
     if((it.sku||'')!==c.product_sku) return;
     const q = parseInt(it.qty!=null?it.qty:(it.quantity!=null?it.quantity:1))||0;
     const pr = parseFloat(it.price!=null?it.price:it.unit_price)||0;
     salesRM += q*pr;
     if(kos) marginRM += q*Math.max(0, pr-kos);
    });
   });
  }
  const kom = Math.round(marginRM * (window.__mktKomisenPct/100) * 100)/100; totKom += kom;
  return '<tr style="border-bottom:1px solid #F3F4F6;">'
   + '<td style="padding:7px 9px;font-size:12px;">'+E((c.title||'').slice(0,45))+'</td>'
   + '<td style="padding:7px 9px;text-align:right;font-size:12px;">'+views.toLocaleString()+'</td>'
   + '<td style="padding:7px 9px;text-align:right;font-size:12px;font-weight:700;color:'+(bonus?'#345E43':'#9CA3AF')+';">'+(bonus?('RM '+bonus):'—')+'</td>'
   + '<td style="padding:7px 9px;text-align:right;font-size:12px;">'+(c.product_sku?('RM '+Math.round(salesRM).toLocaleString()):'—')+'</td>'
   + '<td style="padding:7px 9px;text-align:right;font-size:12px;font-weight:700;color:'+(kom?'#345E43':'#9CA3AF')+';">'+(kom?('RM '+kom.toFixed(2)):(adaKos?'—':'kos SKU belum diisi'))+'</td>'
   + '</tr>';
 }).join('');
 const tiersTxt = (window.__mktBonusTiers||[]).slice().reverse().map(function(t){ return (t[0]/1000)+'k views = RM'+t[1]; }).join(' · ');
 return '<div style="background:#fff;border:1.5px solid var(--primary-100,#FFEDD5);border-radius:14px;padding:14px 16px;margin-top:20px;">'
  + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px;">'
  + '<div style="font-size:13.5px;font-weight:800;color:var(--text-main);"><i data-lucide="award" style="width:15px;height:15px;vertical-align:-2px;color:var(--primary);"></i> Ganjaran Konten — Irfan <span style="font-size:10px;font-weight:800;color:#fff;background:#CE9420;padding:2px 8px;border-radius:50px;vertical-align:1px;">SKIM CADANGAN</span></div>'
  + '<div style="font-size:12.5px;font-weight:800;color:#345E43;">Anggaran bulan ini: RM '+(totBonus+totKom).toFixed(2)+'</div></div>'
  + '<p style="margin:0 0 10px;font-size:11.5px;color:var(--text-muted);line-height:1.5;">Bonus views: '+tiersTxt+' (per konten). Komisen: '+window.__mktKomisenPct+'% dari MARGIN jualan SKU berkaitan dalam 7 hari selepas siar (auto-anggar — isi SKU pada kad!). Angka rasmi & bayaran: keputusan Bos / Aliff.</p>'
  + (posted.length
    ? '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#FAFAFA;"><th style="text-align:left;padding:7px 9px;font-size:10px;text-transform:uppercase;color:#9CA3AF;">Konten</th><th style="text-align:right;padding:7px 9px;font-size:10px;text-transform:uppercase;color:#9CA3AF;">Views</th><th style="text-align:right;padding:7px 9px;font-size:10px;text-transform:uppercase;color:#9CA3AF;">Bonus</th><th style="text-align:right;padding:7px 9px;font-size:10px;text-transform:uppercase;color:#9CA3AF;">Jualan SKU 7hr</th><th style="text-align:right;padding:7px 9px;font-size:10px;text-transform:uppercase;color:#9CA3AF;">Komisen</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
    : '<p style="margin:0;font-size:12px;color:#9CA3AF;padding:8px;border:1.5px dashed var(--border-color);border-radius:9px;text-align:center;">Belum ada konten Disiarkan. Bila post pertama naik & views diisi, ganjaran terpapar di sini automatik.</p>')
  + '</div>';
};
window.__mktGenWeek = async function(){
 const selIso = window.__mktCalSel; if(!selIso) return;
 const d = new Date(selIso + 'T00:00:00'); if(isNaN(d.getTime())) return;
 const mon = new Date(d); mon.setDate(mon.getDate() - ((mon.getDay()+6)%7));
 const iso = function(x){ return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };
 const day = function(off){ const x = new Date(mon); x.setDate(x.getDate()+off); return iso(x); };
 const wkLbl = mon.toLocaleDateString('ms-MY',{day:'numeric',month:'short'});
 const exists = (window.__mktContentCache||[]).some(function(c){ const dd=(c.scheduled_date||'').slice(0,10); return dd >= day(0) && dd <= day(6) && (c.title||'').indexOf('[PLAN]')===0; });
 if(exists){ if(typeof showToast==='function') showToast('Rentak minggu '+wkLbl+' dah wujud — tak jana dua kali.','warn'); return; }
 if(!confirm('Cipta 5 kad aktiviti mingguan (PLAN Isnin / RAKAM Selasa / EDIT Rabu / COPY Khamis / REVIEW Sabtu — Ahad Irfan OFF) untuk minggu bermula Isnin '+wkLbl+'? Semua auto-assign Irfan.')) return;
 const P = 'tiktok,facebook,instagram';
 const rows = [
  { title:'[PLAN] Planning mingguan — semak prestasi minggu lepas, pilih 3 idea + script', scheduled_date:day(0), status:'idea',  content_type:'post',  caption:'Duduk 1 jam: tengok review Ahad lepas (format mana menang?), sahkan 3 konten minggu ni, tulis script pendek + shot list + pilih TALENT tiap satu.' },
  { title:'[RAKAM] Batch shoot konten minggu ini', scheduled_date:day(1), status:'rakam', content_type:'video', caption:'Shoot 3 konten berturut di kedai (Irfan arah, talent ikut plan Isnin). Phone + gimbal, lighting tepi tingkap. 2-3 jam.' },
  { title:'[EDIT] Edit video — potong, subtitle, thumbnail', scheduled_date:day(2), status:'edit', content_type:'video', caption:'CapCut: hook 3 saat pertama, subtitle BM, logo hujung. Simpan 9:16 (TikTok/IG) + 1:1 (FB). Thumbnail teks besar.' },
  { title:'[COPY] Caption semua konten + jadualkan', scheduled_date:day(3), status:'copy', content_type:'post', caption:'Guna butang AI Copy pada tiap kad konten, edit ikut suara 10 CAMP, sertakan harga + CTA. Lepas siap gerakkan kad ke Dijadual.' },
  { title:'[REVIEW] Review mingguan — isi analitik + calon boost', scheduled_date:day(5), status:'done', content_type:'post', caption:'SABTU (Ahad Irfan OFF): isi views/likes/leads semua post minggu ni (butang Edit). Post terbaik = calon boost Ads (rekod di tab Ads, minta approve Bos). Post Ahad? Jadualkan awal via Business Suite. Sedia idea minggu depan.' }
 ].map(function(r){ r.platforms = P; r.assigned_to_name = 'Irfan'; r.created_by = 'rentak_mingguan'; r.created_by_name = 'Jana Rentak'; r.updated_at = new Date().toISOString(); return r; });
 try {
  const res = await db.from('marketing_content').insert(rows);
  if(res.error) throw res.error;
  if(typeof showToast==='function') showToast('5 kad aktiviti minggu '+wkLbl+' dicipta — semua assign Irfan.','success');
  window.__mktCalSel = day(0); window.__mktCalMonth = day(0).slice(0,7);
  await window.__mktLoadContent(); window.renderContentSchedule();
 } catch(e){ if(typeof showToast==='function') showToast('Gagal jana: '+e.message,'error'); }
};
window.renderContentSchedule = async function(){
 const body = document.getElementById('contentScheduleBody');
 if(!body) return;
 body.innerHTML = '<p style="color:#9CA3AF;padding:30px;text-align:center;">Memuatkan…</p>';
 const all = await window.__mktLoadContent();
 const E = window.__mktEsc;
 all.forEach(function(r){ if(r.status==='draft') r.status='copy'; });
 const now = new Date();
 const todayIso = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
 if(!window.__mktCalMonth) window.__mktCalMonth = todayIso.slice(0,7);
 if(!window.__mktCalSel) window.__mktCalSel = todayIso;
 const isCal = window.__mktContentView !== 'list';
 const viewToggle = '<div style="display:flex;gap:6px;margin-bottom:12px;">'
  + [['cal','Kalendar','calendar-days'],['list','Senarai','list']].map(function(v){
    const on = (isCal && v[0]==='cal') || (!isCal && v[0]==='list');
    return '<button onclick="window.__mktSetView(\''+v[0]+'\')" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:50px;font-size:12px;font-weight:700;cursor:pointer;border:1.5px solid '+(on?'var(--primary)':'var(--border-color)')+';background:'+(on?'var(--primary)':'#fff')+';color:'+(on?'#fff':'#6B7280')+';"><i data-lucide="'+v[2]+'" style="width:12px;height:12px;"></i>'+v[1]+'</button>';
   }).join('')
  + '<button onclick="window.__mktGenWeek()" title="Cipta 5 kad aktiviti mingguan (PLAN Isnin / RAKAM Selasa / EDIT Rabu / COPY Khamis / REVIEW Ahad) untuk minggu tarikh yang dipilih" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:50px;font-size:12px;font-weight:700;cursor:pointer;border:1.5px dashed var(--primary);background:#fff;color:var(--primary);margin-left:auto;"><i data-lucide="repeat" style="width:12px;height:12px;"></i> Jana Rentak Minggu</button></div>';
 const header = '<div class="rp-header"><div><h2 class="rp-title"><i data-lucide="calendar-days" style="width:22px;height:22px;color:var(--primary);"></i> Jadual Marketing</h2><p class="rp-subtitle">Tekan tarikh untuk lihat semua planning hari tu. Pipeline: Idea → Rakam → Edit → Copy → Jadual → Siar → Ads → Analitik.</p></div><button onclick="window.__mktContentModal(null, window.__mktCalSel)" style="padding:9px 18px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;"><i data-lucide="plus" style="width:14px;height:14px;vertical-align:-2px;"></i> Tambah Kandungan</button></div>';
 let main = '';
 if(isCal){
  const p = window.__mktCalMonth.split('-');
  const y = Number(p[0]), m = Number(p[1]);
  const first = new Date(y, m-1, 1);
  const daysInM = new Date(y, m, 0).getDate();
  const startDow = (first.getDay()+6)%7; // Isnin = 0
  const byDay = {};
  all.forEach(function(c){ const d=(c.scheduled_date||'').slice(0,10); if(d) (byDay[d]=byDay[d]||[]).push(c); });
  const undated = all.filter(function(c){ return !(c.scheduled_date||'').slice(0,10); });
  // p1_1106 — audit "mudahkan Irfan": (a) TERTUNGGAK dijerit atas sekali, (b) ringkasan minggu sekali pandang
  const preLive = ['idea','rakam','edit','copy','scheduled'];
  const overdue = all.filter(function(c){ const d=(c.scheduled_date||'').slice(0,10); return d && d < todayIso && preLive.indexOf(c.status)!==-1; });
  const wkStart = new Date(now); wkStart.setHours(0,0,0,0); wkStart.setDate(wkStart.getDate() - ((wkStart.getDay()+6)%7));
  const isoOf = function(dt){ return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); };
  const wkS = isoOf(wkStart), wkE = isoOf(new Date(wkStart.getTime()+6*86400000));
  const wkItems = all.filter(function(c){ const d=(c.scheduled_date||'').slice(0,10); return d>=wkS && d<=wkE; });
  const wkPending = wkItems.filter(function(c){ return preLive.indexOf(c.status)!==-1; }).length;
  const chip = function(lbl,val,warn){ return '<div style="flex:1;min-width:110px;background:'+(warn?'#FCF6F4':'#fff')+';border:1px solid '+(warn?'#E0B3A9':'var(--border-color)')+';border-radius:10px;padding:9px 13px;"><div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:'+(warn?'#7C2A20':'#9CA3AF')+';">'+lbl+'</div><div style="font-size:18px;font-weight:900;color:'+(warn?'#7C2A20':'var(--text-main)')+';">'+val+'</div></div>'; };
  const summary = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">'
   + chip('Hari ini', (byDay[todayIso]||[]).length+' planning', false)
   + chip('Minggu ini belum siap', wkPending+' / '+wkItems.length, wkPending>0)
   + chip('Tertunggak', overdue.length, overdue.length>0)
   + '</div>';
  const overdueHtml = overdue.length
   ? '<div style="border:1.5px solid #E0B3A9;background:#FCF6F4;border-radius:12px;padding:12px 12px 4px;margin-bottom:14px;">'
     + '<div style="font-size:12px;font-weight:800;color:#7C2A20;margin-bottom:8px;"><i data-lucide="alert-triangle" style="width:13px;height:13px;vertical-align:-2px;"></i> TERTUNGGAK ('+overdue.length+') — tarikh dah lepas tapi belum disiar. Siapkan atau tukar tarikh (klik kad).</div>'
     + overdue.map(window.__mktContentCard).join('') + '</div>'
   : '';
  const monthLbl = first.toLocaleDateString('ms-MY',{month:'long',year:'numeric'});
  const dows = ['Isn','Sel','Rab','Kha','Jum','Sab','Ahd'];
  let cells = dows.map(function(d){ return '<div style="text-align:center;font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#9CA3AF;padding:4px 0;">'+d+'</div>'; }).join('');
  for(let i=0;i<startDow;i++) cells += '<div></div>';
  for(let d=1; d<=daysInM; d++){
   const iso = y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
   const items = byDay[iso]||[];
   const isSel = iso===window.__mktCalSel, isToday = iso===todayIso;
   const allDone = items.length && items.every(function(c){ return ['posted','ads','done'].indexOf(c.status)!==-1; });
   const badge = items.length
    ? '<div style="margin-top:2px;"><span style="display:inline-block;min-width:17px;padding:1px 5px;border-radius:50px;font-size:10px;font-weight:800;background:'+(isSel?'#fff':(allDone?'#E4EFE2':'var(--primary-100,#FFEDD5)'))+';color:'+(isSel?'var(--primary)':(allDone?'#345E43':'var(--primary-800,#7C4A1A)'))+';">'+items.length+'</span></div>'
    : '<div style="margin-top:2px;font-size:10px;visibility:hidden;">0</div>';
   cells += '<button onclick="window.__mktCalPick(\''+iso+'\')" style="padding:6px 2px 5px;border-radius:10px;cursor:pointer;text-align:center;border:1.5px solid '+(isSel?'var(--primary)':(isToday?'var(--primary-300,#F3B577)':'transparent'))+';background:'+(isSel?'var(--primary)':'#fff')+';">'
    + '<div style="font-size:13px;font-weight:'+((isToday||isSel)?'800':'600')+';color:'+(isSel?'#fff':(isToday?'var(--primary)':'#374151'))+';">'+d+'</div>'+badge+'</button>';
  }
  const navBtn = 'style="width:34px;height:34px;border-radius:9px;border:1.5px solid var(--border-color);background:#fff;color:#374151;font-size:17px;font-weight:800;cursor:pointer;line-height:1;"';
  const cal = '<div style="background:#fff;border:1px solid var(--border-color);border-radius:14px;padding:12px 12px 8px;margin-bottom:16px;">'
   + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
   + '<button onclick="window.__mktCalNav(-1)" '+navBtn+'>&lsaquo;</button>'
   + '<div style="font-size:14.5px;font-weight:800;color:var(--text-main);text-transform:capitalize;">'+monthLbl+'</div>'
   + '<button onclick="window.__mktCalNav(1)" '+navBtn+'>&rsaquo;</button></div>'
   + '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;">'+cells+'</div></div>';
  const selItems = (byDay[window.__mktCalSel]||[]);
  const selLbl = new Date(window.__mktCalSel+'T00:00:00').toLocaleDateString('ms-MY',{weekday:'long', day:'numeric', month:'long'});
  const dayPanel = '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin:2px 0 10px;flex-wrap:wrap;">'
   + '<div style="font-size:14px;font-weight:800;color:var(--text-main);text-transform:capitalize;">'+selLbl+' <span style="font-weight:600;color:#9CA3AF;font-size:12px;">· '+selItems.length+' planning</span></div>'
   + '<button onclick="window.__mktContentModal(null, \''+window.__mktCalSel+'\')" style="font-size:11.5px;font-weight:700;color:var(--primary);background:#fff;border:1.5px solid var(--primary);padding:5px 12px;border-radius:50px;cursor:pointer;">+ Tambah hari ni</button></div>'
   + (selItems.length ? selItems.map(window.__mktContentCard).join('') : '<p style="color:#9CA3AF;padding:20px;text-align:center;border:1.5px dashed var(--border-color);border-radius:10px;">Tiada planning pada hari ni. Tekan "+ Tambah hari ni" untuk mula.</p>');
  const undatedHtml = undated.length
   ? '<div style="margin-top:20px;"><div style="font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#9CA3AF;margin-bottom:8px;">Tiada tarikh ('+undated.length+') — set tarikh melalui Edit</div>'+undated.map(window.__mktContentCard).join('')+'</div>'
   : '';
  main = summary + overdueHtml + cal + dayPanel + window.__mktGanjaranHtml(all) + undatedHtml;
 } else {
  let rows = all.slice();
  if(window.__mktContentFilter.status!=='all') rows = rows.filter(function(r){ return r.status===window.__mktContentFilter.status; });
  if(window.__mktContentFilter.platform!=='all') rows = rows.filter(function(r){ return (r.platforms||'').indexOf(window.__mktContentFilter.platform)!==-1; });
  const counts = {}; window.__mktContentStatuses.forEach(function(s){ counts[s[0]] = all.filter(function(r){return r.status===s[0];}).length; });
  const statusPills = '<button onclick="window.__mktSetContentFilter(\'status\',\'all\')" style="padding:5px 12px;border-radius:50px;border:1px solid '+(window.__mktContentFilter.status==='all'?'var(--primary)':'var(--border-color)')+';background:'+(window.__mktContentFilter.status==='all'?'var(--primary)':'#fff')+';color:'+(window.__mktContentFilter.status==='all'?'#fff':'#6B7280')+';font-size:12px;font-weight:700;cursor:pointer;">Semua ('+all.length+')</button>'
   + window.__mktContentStatuses.map(function(s){ const on=window.__mktContentFilter.status===s[0]; return '<button onclick="window.__mktSetContentFilter(\'status\',\''+s[0]+'\')" style="padding:5px 12px;border-radius:50px;border:1px solid '+(on?'var(--primary)':'var(--border-color)')+';background:'+(on?'var(--primary)':'#fff')+';color:'+(on?'#fff':'#6B7280')+';font-size:12px;font-weight:700;cursor:pointer;">'+s[1]+' ('+counts[s[0]]+')</button>'; }).join('');
  const platPills = '<button onclick="window.__mktSetContentFilter(\'platform\',\'all\')" style="padding:5px 12px;border-radius:50px;border:1px solid '+(window.__mktContentFilter.platform==='all'?'var(--primary)':'var(--border-color)')+';background:'+(window.__mktContentFilter.platform==='all'?'var(--primary)':'#fff')+';color:'+(window.__mktContentFilter.platform==='all'?'#fff':'#6B7280')+';font-size:12px;font-weight:700;cursor:pointer;">Semua platform</button>'
   + ['tiktok','instagram','facebook','threads','shopee'].map(function(pl){ const on=window.__mktContentFilter.platform===pl; const mm=window.__mktPlat[pl]; return '<button onclick="window.__mktSetContentFilter(\'platform\',\''+pl+'\')" style="padding:5px 12px;border-radius:50px;border:1px solid '+(on?mm.color:'var(--border-color)')+';background:'+(on?mm.color:'#fff')+';color:'+(on?'#fff':'#6B7280')+';font-size:12px;font-weight:700;cursor:pointer;">'+mm.label+'</button>'; }).join('');
  const list = rows.length ? rows.map(window.__mktContentCard).join('') : '<p style="color:#9CA3AF;padding:30px;text-align:center;">Tiada kandungan padan tapisan. Tekan "Tambah Kandungan".</p>';
  main = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">'+statusPills+'</div>'
   + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">'+platPills+'</div>' + list;
 }
 body.innerHTML = '<div class="rp-wrap">' + header + viewToggle + main + '</div>';
 if(window.lucide && lucide.createIcons) try{ lucide.createIcons(); }catch(e){}
};
// p1_1094 — gerak kad ke tahap seterusnya dlm pipeline (posted → cap posted_at automatik)
window.__mktAdvanceStage = async function(id){
 const c = (window.__mktContentCache||[]).find(function(x){return x.id===id;}); if(!c) return;
 const cur = c.status==='draft' ? 'copy' : c.status;
 const i = window.__mktStageFlow.indexOf(cur);
 if(i < 0 || i >= window.__mktStageFlow.length-1) return;
 const next = window.__mktStageFlow[i+1];
 const patch = { status: next, updated_at: new Date().toISOString() };
 if(next==='posted' && !c.posted_at) patch.posted_at = new Date().toISOString();
 try {
  const r = await db.from('marketing_content').update(patch).eq('id', id); if(r.error) throw r.error;
  const lbl = (window.__mktContentStatuses.find(function(s){return s[0]===next;})||[])[1]||next;
  if(typeof showToast==='function') showToast('"'+(c.title||'').slice(0,40)+'" → '+lbl+'. '+(window.__mktStageHints[next]||''), 'success');
  await window.__mktLoadContent(); window.renderContentSchedule();
 } catch(e){ if(typeof showToast==='function') showToast('Gagal: '+e.message, 'error'); }
};
// p1_1094 — Tanya AI draf caption: buka panel AI + prefill soalan (staf tekan hantar je)
window.__mktAiCopy = function(id){
 const c = (window.__mktContentCache||[]).find(function(x){return x.id===id;}); if(!c) return;
 const p = (typeof masterProducts!=='undefined' && c.product_sku) ? (masterProducts.find(function(x){return x.sku===c.product_sku;})||{}) : {};
 const plat = (c.platforms||'').split(',').filter(Boolean).join('/') || 'sosial media';
 const q = 'Tolong draf 3 pilihan caption '+plat+' dalam BM santai untuk '+(c.content_type||'post')
  + ' bertajuk "'+(c.title||'')+'"'
  + (p.name?(' — produk: '+p.name+(p.price?(' (RM'+p.price+')'):'')):'')
  + '. Ada hook kuat baris pertama + CTA ke kedai/Shopee. Emoji jangan.';
 try {
  if(typeof window.__posAppOpenAI==='function') window.__posAppOpenAI();
  else if(typeof window.__saToggle==='function' && !window.__saOpen) window.__saToggle();
  setTimeout(function(){ const i=document.getElementById('saInput'); if(i){ i.value=q; i.focus(); } }, 400);
 } catch(e){}
};
// p1_1094 — hantar kad ke Auto-Post FB: navigate + prefill caption/link
window.__mktSendToAutoPost = function(id){
 const c = (window.__mktContentCache||[]).find(function(x){return x.id===id;}); if(!c) return;
 try {
  window.__mktHubGo('digital','autopost');
  setTimeout(function(){
   const cap=document.getElementById('apCaption'), lnk=document.getElementById('apLink');
   if(cap) cap.value = (c.caption || c.title || '');
   if(lnk && c.link) lnk.value = c.link;
   if(typeof showToast==='function') showToast('Caption diisi dari Jadual Marketing — semak & tekan post. Lepas siar, balik tandai kad → Disiarkan.', 'info');
  }, 700);
 } catch(e){}
};
window.__mktContentModal = function(id, presetDate){
 const c = id ? (window.__mktContentCache.find(function(x){return x.id===id;})||{}) : {};
 if(!id && presetDate) c.scheduled_date = presetDate; // p1_1101 — prefill tarikh dari kalendar
 const E = window.__mktEsc;
 const old = document.getElementById('mktContentModal'); if(old) old.remove();
 const selPlats = (c.platforms||'').split(',').filter(Boolean);
 const platChecks = ['tiktok','instagram','facebook','threads','shopee'].map(function(pl){ const m=window.__mktPlat[pl]; return '<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;margin-right:12px;cursor:pointer;"><input type="checkbox" class="mktCPlat" value="'+pl+'"'+(selPlats.indexOf(pl)!==-1?' checked':'')+'> '+m.label+'</label>'; }).join('');
 const typeOpts = window.__mktContentTypes.map(function(t){ return '<option value="'+t+'"'+(c.content_type===t?' selected':'')+'>'+t+'</option>'; }).join('');
 const statusOpts = window.__mktContentStatuses.map(function(s){ return '<option value="'+s[0]+'"'+(c.status===s[0]?' selected':'')+'>'+s[1]+'</option>'; }).join('');
 // p1_1105 — PIC marketing = Irfan (Zaid 14 Jul): kad BARU auto-assign Irfan; staf lain = talent (tulis dlm caption)
 const selStaff = c.assigned_to_name || (!id ? 'Irfan' : '');
 const staffOpts = '<option value="">— pilih staf —</option>'+(typeof authUsers!=='undefined'?authUsers:[]).map(function(u){ return '<option value="'+E(u.name)+'"'+(selStaff===u.name?' selected':'')+'>'+E(u.name)+'</option>'; }).join('');
 const ov = document.createElement('div');
 ov.id = 'mktContentModal';
 ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9990;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(2px);overflow:auto;';
 ov.onclick = function(e){ if(e.target===ov) ov.remove(); };
 ov.innerHTML = '<div style="background:#fff;border-radius:14px;width:100%;max-width:480px;max-height:92vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.3);font-family:var(--font-main,Poppins),sans-serif;" onclick="event.stopPropagation()">'
  + '<div style="padding:16px 20px;border-bottom:1px solid #F3F4F6;"><strong style="font-size:15px;">'+(id?'Edit Kandungan':'Tambah Kandungan')+'</strong></div>'
  + '<div style="padding:18px 20px;">'
  + '<label style="font-size:11.5px;font-weight:700;color:#374151;">Tajuk / Idea</label><input id="mktCTitle" value="'+E(c.title||'')+'" placeholder="cth: Review khemah BD063 untuk hujung minggu" style="width:100%;box-sizing:border-box;margin:5px 0 13px;padding:9px 11px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;">'
  + '<label style="font-size:11.5px;font-weight:700;color:#374151;">Platform</label><div style="margin:6px 0 13px;">'+platChecks+'</div>'
  + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:13px;"><div><label style="font-size:11.5px;font-weight:700;color:#374151;">Jenis</label><select id="mktCType" style="width:100%;box-sizing:border-box;margin-top:5px;padding:9px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;">'+typeOpts+'</select></div><div><label style="font-size:11.5px;font-weight:700;color:#374151;">Tarikh Jadual</label><input id="mktCDate" type="date" value="'+E(c.scheduled_date||'')+'" style="width:100%;box-sizing:border-box;margin-top:5px;padding:8px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;"></div></div>'
  + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:13px;"><div><label style="font-size:11.5px;font-weight:700;color:#374151;">Status</label><select id="mktCStatus" style="width:100%;box-sizing:border-box;margin-top:5px;padding:9px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;">'+statusOpts+'</select></div><div><label style="font-size:11.5px;font-weight:700;color:#374151;">Assign Staf</label><select id="mktCStaff" style="width:100%;box-sizing:border-box;margin-top:5px;padding:9px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;">'+staffOpts+'</select></div></div>'
  + '<label style="font-size:11.5px;font-weight:700;color:#374151;">SKU Produk (optional)</label><input id="mktCSku" list="mktSkuList" value="'+E(c.product_sku||'')+'" placeholder="cth: BD063" style="width:100%;box-sizing:border-box;margin:5px 0 13px;padding:9px 11px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;"><datalist id="mktSkuList">'+((typeof masterProducts!=='undefined'?masterProducts:[]).slice(0,1500).map(function(p){ return '<option value="'+E(p.sku)+'">'+E((p.name||'').slice(0,40))+'</option>'; }).join(''))+'</datalist>'
  + '<label style="font-size:11.5px;font-weight:700;color:#374151;">Caption / Nota</label><textarea id="mktCCaption" rows="2" placeholder="idea caption / hook" style="width:100%;box-sizing:border-box;margin:5px 0 13px;padding:9px 11px;border:1.5px solid var(--border-color);border-radius:8px;font-size:12.5px;font-family:var(--font-main,Poppins),sans-serif;resize:vertical;">'+E(c.caption||'')+'</textarea>'
  + '<label style="font-size:11.5px;font-weight:700;color:#374151;">Link (jika dah siar)</label><input id="mktCLink" value="'+E(c.link||'')+'" placeholder="https://..." style="width:100%;box-sizing:border-box;margin:5px 0 13px;padding:9px 11px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;">'
  + '<label style="font-size:11.5px;font-weight:700;color:#374151;">Prestasi (isi bila dah siar)</label><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:5px 0 16px;"><div><div style="font-size:10px;color:#9CA3AF;">Views</div><input id="mktCViews" type="number" min="0" value="'+(c.views||'')+'" placeholder="0" style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;"></div><div><div style="font-size:10px;color:#9CA3AF;">Likes</div><input id="mktCLikes" type="number" min="0" value="'+(c.likes||'')+'" placeholder="0" style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;"></div><div><div style="font-size:10px;color:#9CA3AF;">Leads</div><input id="mktCLeads" type="number" min="0" value="'+(c.leads||'')+'" placeholder="0" style="width:100%;box-sizing:border-box;padding:8px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;"></div></div>'
  + '<button onclick="window.__mktSaveContent('+(id||'null')+')" style="width:100%;background:var(--primary);color:#fff;border:none;padding:12px;border-radius:9px;font-size:13.5px;font-weight:700;cursor:pointer;">Simpan</button>'
  + '<button onclick="document.getElementById(\'mktContentModal\').remove()" style="width:100%;margin-top:8px;background:none;border:none;color:#9CA3AF;padding:6px;cursor:pointer;font-size:12px;font-weight:600;">Tutup</button>'
  + '</div></div>';
 document.body.appendChild(ov);
 if(window.lucide && lucide.createIcons) try{ lucide.createIcons(); }catch(e){}
};
window.__mktSaveContent = async function(id){
 const g = function(x){ const el=document.getElementById(x); return el?el.value.trim():''; };
 const title = g('mktCTitle');
 if(!title){ if(typeof showToast==='function') showToast('Tajuk wajib diisi.', 'warn'); return; }
 const plats = Array.prototype.slice.call(document.querySelectorAll('.mktCPlat:checked')).map(function(c){return c.value;}).join(',');
 const u = window.currentUser||{};
 const status = g('mktCStatus');
 const gn = function(x){ const el=document.getElementById(x); return el?(Number(el.value)||0):0; };
 const rec = { title:title, platforms:plats, content_type:g('mktCType'), scheduled_date:g('mktCDate')||null, status:status, product_sku:g('mktCSku')||null, caption:g('mktCCaption')||null, assigned_to_name:g('mktCStaff')||null, link:g('mktCLink')||null, views:gn('mktCViews'), likes:gn('mktCLikes'), leads:gn('mktCLeads'), updated_at:new Date().toISOString() };
 if(status==='posted' && !id) rec.posted_at = new Date().toISOString();
 try {
  if(id){ const r = await db.from('marketing_content').update(rec).eq('id', id); if(r.error) throw r.error; }
  else { rec.created_by = u.staff_id||'unknown'; rec.created_by_name = u.name||'Unknown'; const r = await db.from('marketing_content').insert([rec]); if(r.error) throw r.error; }
  if(typeof showToast==='function') showToast('Kandungan disimpan.', 'success');
  const m = document.getElementById('mktContentModal'); if(m) m.remove();
  // p1_1101 — kalendar lompat ke tarikh yang disimpan supaya kad terus nampak
  if(rec.scheduled_date){ window.__mktCalSel = String(rec.scheduled_date).slice(0,10); window.__mktCalMonth = window.__mktCalSel.slice(0,7); }
  await window.__mktLoadContent(); window.renderContentSchedule();
 } catch(e){ if(typeof showToast==='function') showToast('Simpan gagal: '+e.message, 'error'); }
};
window.__mktMarkPosted = async function(id){
 try { const r = await db.from('marketing_content').update({ status:'posted', posted_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('id', id); if(r.error) throw r.error;
  if(typeof showToast==='function') showToast('Ditandai disiarkan.', 'success');
  await window.__mktLoadContent(); window.renderContentSchedule();
 } catch(e){ if(typeof showToast==='function') showToast('Gagal: '+e.message, 'error'); }
};
window.__mktDeleteContent = async function(id){
 if(!confirm('Padam kandungan ni?')) return;
 try { const r = await db.from('marketing_content').delete().eq('id', id); if(r.error) throw r.error;
  await window.__mktLoadContent(); window.renderContentSchedule();
 } catch(e){ if(typeof showToast==='function') showToast('Padam gagal: '+e.message, 'error'); }
};

// =================== 2b) TIKTOK LIVE (p1_1111) ===================
// Ariff (atau mana-mana staf) log masa sesi LIVE TikTok → sistem kira order channel
// "TikTok Shop" yang masuk DALAM tempoh tu → komisen 5% dari MARGIN (SKIM — rasmi Bos/Aliff).
window.__liveSessCache = [];
window.__liveLoadSess = async function(){ try { const r = await db.from('live_sessions').select('*').order('start_at',{ascending:false}).limit(120); window.__liveSessCache = r.data||[]; } catch(e){ window.__liveSessCache=[]; } return window.__liveSessCache; };
window.__liveKomisenPct = 5;
window.__liveCalc = function(sess){
 const out = { orders:0, jualan:0, margin:0, adaKosSemua:true };
 if(typeof salesHistory==='undefined' || !Array.isArray(salesHistory)) return out;
 const t0 = new Date(sess.start_at).getTime(), t1 = new Date(sess.end_at).getTime();
 const kosOf = {};
 ((typeof masterProducts!=='undefined' && masterProducts)||[]).forEach(function(p){ kosOf[p.sku] = parseFloat(p.cost_price)||0; });
 salesHistory.forEach(function(sale){
  if(String(sale.channel||'') !== 'TikTok Shop') return;
  const ts = new Date(sale.created_at).getTime();
  if(!(ts>=t0 && ts<=t1)) return;
  if(typeof window.__isRealSale==='function' && !window.__isRealSale(sale)) return;
  out.orders++;
  let items=[]; try{ items = typeof sale.items==='string' ? JSON.parse(sale.items||'[]') : (sale.items||[]); }catch(e){}
  items.forEach(function(it){
   const q = parseInt(it.qty!=null?it.qty:(it.quantity!=null?it.quantity:1))||0;
   const pr = parseFloat(it.price!=null?it.price:it.unit_price)||0;
   out.jualan += q*pr;
   const kos = kosOf[it.sku]||0;
   if(kos) out.margin += q*Math.max(0, pr-kos); else out.adaKosSemua = false;
  });
 });
 return out;
};
window.__liveSaveSess = async function(){
 const g = function(id){ const el=document.getElementById(id); return el?el.value:''; };
 const tarikh = g('lvDate'), mula = g('lvStart'), tamat = g('lvEnd');
 if(!tarikh || !mula || !tamat){ if(window.showToast) showToast('Isi tarikh + masa mula + masa tamat.','warn'); return; }
 let start = new Date(tarikh+'T'+mula), end = new Date(tarikh+'T'+tamat);
 if(end <= start) end = new Date(end.getTime() + 86400000); // live lepas tengah malam
 const u = window.currentUser||{};
 const staf = g('lvStaff') || u.name || 'Unknown';
 try {
  const r = await db.from('live_sessions').insert([{ staff_name:staf, platform:'tiktok', start_at:start.toISOString(), end_at:end.toISOString(), notes:(g('lvNotes')||'').trim()||null, created_by:u.name||null }]);
  if(r.error) throw r.error;
  if(window.showToast) showToast('Sesi LIVE '+staf+' direkod.','success');
  window.renderTikTokLive();
 } catch(e){ if(window.showToast) showToast('Gagal simpan: '+e.message,'error'); }
};
window.__liveDelSess = async function(id){
 if(!confirm('Padam sesi live ni?')) return;
 try { const r = await db.from('live_sessions').delete().eq('id',id); if(r.error) throw r.error; window.renderTikTokLive(); }
 catch(e){ if(window.showToast) showToast('Gagal padam: '+e.message,'error'); }
};
window.renderTikTokLive = async function(){
 const body = document.getElementById('tiktokLiveBody');
 if(!body) return;
 body.innerHTML = '<p style="color:#9CA3AF;padding:30px;text-align:center;">Memuatkan…</p>';
 const sess = await window.__liveLoadSess();
 const u = window.currentUser||{};
 const boss = (typeof window.isBoss==='function' && window.isBoss(u));
 const E = window.__mktEsc;
 const staffOpts = ((typeof authUsers!=='undefined'&&authUsers)||[]).filter(function(x){return (x.dept||'').indexOf('External')===-1;}).map(function(x){ return '<option value="'+E(x.name)+'"'+(x.name===(u.name||'')?' selected':'')+'>'+E(x.name)+'</option>'; }).join('');
 const form = '<div class="admin-card" style="padding:16px;margin-bottom:16px;">'
  + '<strong style="font-size:13.5px;"><i data-lucide="radio" style="width:15px;height:15px;vertical-align:-2px;color:var(--primary);"></i> Rekod Sesi LIVE</strong>'
  + '<p style="font-size:11.5px;color:var(--text-muted);margin:4px 0 12px;">Lepas habis live, masukkan masa mula & tamat. Sistem sendiri kira order TikTok Shop yang masuk DALAM tempoh tu dan komisen '+window.__liveKomisenPct+'% dari margin. Live lepas tengah malam? Sistem faham (tamat < mula = esok).</p>'
  + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;align-items:end;">'
  + '<div><label style="font-size:10.5px;font-weight:700;color:#374151;">Staf</label><select id="lvStaff" style="width:100%;padding:8px;border:1px solid var(--border-color);border-radius:7px;font-size:12.5px;">'+staffOpts+'</select></div>'
  + '<div><label style="font-size:10.5px;font-weight:700;color:#374151;">Tarikh</label><input type="date" id="lvDate" style="width:100%;padding:8px;border:1px solid var(--border-color);border-radius:7px;font-size:12.5px;"></div>'
  + '<div><label style="font-size:10.5px;font-weight:700;color:#374151;">Mula</label><input type="time" id="lvStart" style="width:100%;padding:8px;border:1px solid var(--border-color);border-radius:7px;font-size:12.5px;"></div>'
  + '<div><label style="font-size:10.5px;font-weight:700;color:#374151;">Tamat</label><input type="time" id="lvEnd" style="width:100%;padding:8px;border:1px solid var(--border-color);border-radius:7px;font-size:12.5px;"></div>'
  + '<div style="grid-column:span 2;"><label style="font-size:10.5px;font-weight:700;color:#374151;">Nota (produk fokus, optional)</label><input id="lvNotes" placeholder="cth: push lampu BD085 + khemah BD063" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border-color);border-radius:7px;font-size:12.5px;"></div>'
  + '<button onclick="window.__liveSaveSess()" style="padding:9px 16px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:700;cursor:pointer;">Simpan Sesi</button>'
  + '</div></div>';
 let totKom = 0;
 const rows = sess.map(function(x){
  const c = window.__liveCalc(x);
  const kom = Math.round(c.margin * (window.__liveKomisenPct/100) * 100)/100;
  const boleh = boss || x.staff_name === (u.name||'');
  if(boleh) totKom += (x.staff_name===(u.name||'')||boss) ? kom : 0;
  const d0 = new Date(x.start_at), d1 = new Date(x.end_at);
  const masa = d0.toLocaleDateString('ms-MY',{day:'numeric',month:'short'})+' '+d0.toLocaleTimeString('ms-MY',{hour:'2-digit',minute:'2-digit'})+' – '+d1.toLocaleTimeString('ms-MY',{hour:'2-digit',minute:'2-digit'});
  return '<tr style="border-bottom:1px solid #F3F4F6;">'
   + '<td style="padding:8px 10px;font-size:12px;font-weight:700;">'+E(x.staff_name)+'</td>'
   + '<td style="padding:8px 10px;font-size:12px;">'+masa+(x.notes?('<div style="font-size:10.5px;color:#9CA3AF;">'+E(x.notes.slice(0,50))+'</div>'):'')+'</td>'
   + '<td style="padding:8px 10px;text-align:right;font-size:12px;">'+c.orders+'</td>'
   + '<td style="padding:8px 10px;text-align:right;font-size:12px;">RM '+Math.round(c.jualan).toLocaleString()+'</td>'
   + '<td style="padding:8px 10px;text-align:right;font-size:12px;font-weight:800;color:'+(boleh?'#345E43':'#9CA3AF')+';">'+(boleh?('RM '+kom.toFixed(2)+(c.adaKosSemua?'':' *')):'—')+'</td>'
   + '<td style="padding:8px 10px;text-align:center;">'+((boss||x.created_by===(u.name||''))?('<button onclick="window.__liveDelSess('+x.id+')" style="background:none;border:1px solid #E0B3A9;color:#7C2A20;padding:3px 8px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700;">Padam</button>'):'')+'</td>'
   + '</tr>';
 }).join('');
 const table = sess.length
  ? '<div class="admin-card" style="padding:16px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><strong style="font-size:13px;">Sesi LIVE ('+sess.length+')</strong>'+((boss||sess.some(function(x){return x.staff_name===(u.name||'');}))?('<span style="font-size:12px;font-weight:800;color:#345E43;">Jumlah komisen anggaran: RM '+totKom.toFixed(2)+'</span>'):'')+'</div>'
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#FAFAFA;"><th style="text-align:left;padding:8px 10px;font-size:10px;text-transform:uppercase;color:#9CA3AF;">Staf</th><th style="text-align:left;padding:8px 10px;font-size:10px;text-transform:uppercase;color:#9CA3AF;">Masa LIVE</th><th style="text-align:right;padding:8px 10px;font-size:10px;text-transform:uppercase;color:#9CA3AF;">Order TikTok</th><th style="text-align:right;padding:8px 10px;font-size:10px;text-transform:uppercase;color:#9CA3AF;">Jualan</th><th style="text-align:right;padding:8px 10px;font-size:10px;text-transform:uppercase;color:#9CA3AF;">Komisen 5% margin</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'
    + '<p style="font-size:10.5px;color:#9CA3AF;margin:8px 0 0;">Komisen = '+window.__liveKomisenPct+'% dari MARGIN (jualan − kos) order channel TikTok Shop dalam tempoh live. Tanda * = ada item tanpa kos (margin dikira kurang). SKIM ANGGARAN — bayaran rasmi keputusan Bos / Aliff. Nota: order TikTok sync masuk POS berkala — angka mungkin ambil masa sikit untuk penuh.</p></div>'
  : '<div class="admin-card" style="padding:24px;text-align:center;color:#9CA3AF;font-size:12.5px;">Belum ada sesi direkod. Lepas habis live TikTok, rekod masa kat atas — komisen dikira automatik.</div>';
 body.innerHTML = '<div class="rp-wrap">'
  + '<div class="rp-header"><div><h2 class="rp-title"><i data-lucide="radio" style="width:22px;height:22px;color:var(--primary);"></i> TikTok LIVE</h2><p class="rp-subtitle">Rekod masa sesi live — order TikTok Shop dalam tempoh tu dikira, komisen '+window.__liveKomisenPct+'% dari margin untuk host.</p></div></div>'
  + form + table + '</div>';
 try { const d=document.getElementById('lvDate'); if(d && !d.value){ const n=new Date(); d.value = n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0'); } } catch(e){}
 if(window.lucide && lucide.createIcons) try{ lucide.createIcons(); }catch(e){}
};

// =================== 3) ADS (money behind PIN) ===================
window.__mktAdsFilter = { status:'all', platform:'all' };
window.__mktSetAdsFilter = function(k,v){ window.__mktAdsFilter[k]=v; window.renderAds(); };
window.__mktMoney = function(v, show){ return show ? ('RM '+Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})) : '•••'; };
window.__mktRoas = function(rev, spend, show){ if(!show) return '•••'; const s=Number(spend)||0; if(s<=0) return '—'; const r=(Number(rev)||0)/s; return r.toFixed(2)+'x'; };
window.__mktRoasColor = function(rev, spend){ const s=Number(spend)||0; if(s<=0) return '#9CA3AF'; const r=(Number(rev)||0)/s; return r>=2?'#4E7C4A':(r>=1?'#7A5410':'#B23A2E'); };
window.renderAds = async function(){
 const body = document.getElementById('adsBody');
 if(!body) return;
 body.innerHTML = '<p style="color:#9CA3AF;padding:30px;text-align:center;">Memuatkan…</p>';
 const all = await window.__mktLoadAds();
 const E = window.__mktEsc;
 const showMoney = !!(window.__confIsUnlocked && window.__confIsUnlocked());
 let rows = all.slice();
 if(window.__mktAdsFilter.status!=='all') rows = rows.filter(function(r){ return r.status===window.__mktAdsFilter.status; });
 if(window.__mktAdsFilter.platform!=='all') rows = rows.filter(function(r){ return r.platform===window.__mktAdsFilter.platform; });
 let tSpend=0, tRev=0, tOrders=0;
 all.forEach(function(a){ tSpend+=Number(a.spend)||0; tRev+=Number(a.revenue)||0; tOrders+=Number(a.orders)||0; });
 const blendedRoas = tSpend>0 ? (tRev/tSpend) : 0;
 const costPerOrder = tOrders>0 ? (tSpend/tOrders) : 0;
 const kpi = function(label, val, sub){ return '<div class="stat-card" style="padding:14px;"><div style="font-size:10px;color:#9CA3AF;text-transform:uppercase;font-weight:700;">'+label+'</div><div style="font-size:20px;font-weight:800;margin-top:3px;">'+val+'</div>'+(sub?'<div style="font-size:10px;color:#9CA3AF;margin-top:2px;">'+sub+'</div>':'')+'</div>'; };
 const lockBanner = showMoney ? '' : '<div class="admin-card" style="padding:12px 16px;margin-bottom:14px;background:#FDF0E2;border:1px solid #F0C896;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;"><span style="font-size:12.5px;color:#7A5410;"><i data-lucide="lock" style="width:13px;height:13px;vertical-align:-2px;"></i> Data kewangan iklan (spend / revenue / ROAS) disorok.</span><button onclick="window.__confidentialGate(function(){ window.renderAds(); })" style="padding:7px 16px;background:var(--primary);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;">Buka dengan PIN</button></div>';
 const tbl = rows.length ? '<div style="overflow-x:auto;border:1px solid var(--border-color);border-radius:8px;"><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead style="background:#F9FAFB;"><tr>'
  + '<th style="text-align:left;padding:9px 10px;font-size:10px;color:#6B7280;text-transform:uppercase;">Kempen</th><th style="text-align:left;padding:9px;font-size:10px;color:#6B7280;text-transform:uppercase;">Platform</th><th style="text-align:center;padding:9px;font-size:10px;color:#6B7280;text-transform:uppercase;">Status</th><th style="text-align:right;padding:9px;font-size:10px;color:#6B7280;text-transform:uppercase;">Spend</th><th style="text-align:right;padding:9px;font-size:10px;color:#6B7280;text-transform:uppercase;">Revenue</th><th style="text-align:right;padding:9px;font-size:10px;color:#6B7280;text-transform:uppercase;">Orders</th><th style="text-align:right;padding:9px;font-size:10px;color:#6B7280;text-transform:uppercase;">ROAS</th><th style="padding:9px;"></th></tr></thead><tbody>'
  + rows.map(function(a){
   const plat = (window.__mktAdPlatforms.find(function(p){return p[0]===a.platform;})||[a.platform,a.platform])[1];
   const st = window.__mktAdStatuses.find(function(s){return s[0]===a.status;}) || ['active','Aktif','#E4EFE2','#345E43'];
   const dr = (a.start_date?new Date(a.start_date).toLocaleDateString('en-MY',{day:'numeric',month:'short'}):'')+(a.end_date?(' – '+new Date(a.end_date).toLocaleDateString('en-MY',{day:'numeric',month:'short'})):'');
   return '<tr style="border-bottom:1px solid #F3F4F6;"><td style="padding:9px 10px;"><strong>'+E(a.name||'')+'</strong><div style="font-size:10px;color:#9CA3AF;">'+E(dr)+(a.orders?(' · '+a.clicks+' klik'):'')+'</div></td>'
    + '<td style="padding:9px;">'+E(plat)+'</td>'
    + '<td style="padding:9px;text-align:center;"><span style="padding:2px 8px;border-radius:50px;background:'+st[2]+';color:'+st[3]+';font-size:10px;font-weight:700;">'+st[1]+'</span></td>'
    + '<td style="padding:9px;text-align:right;">'+window.__mktMoney(a.spend, showMoney)+'</td>'
    + '<td style="padding:9px;text-align:right;">'+window.__mktMoney(a.revenue, showMoney)+'</td>'
    + '<td style="padding:9px;text-align:right;font-weight:700;">'+(a.orders||0)+'</td>'
    + '<td style="padding:9px;text-align:right;font-weight:800;color:'+(showMoney?window.__mktRoasColor(a.revenue,a.spend):'#9CA3AF')+';">'+window.__mktRoas(a.revenue,a.spend,showMoney)+'</td>'
    + '<td style="padding:9px;text-align:center;white-space:nowrap;"><button onclick="window.__mktAdModal('+a.id+')" style="background:none;border:1px solid var(--border-color);color:#6B7280;padding:4px 8px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700;">Edit</button> <button onclick="window.__mktDeleteAd('+a.id+')" style="background:none;border:1px solid #E0B3A9;color:#7C2A20;padding:4px 7px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700;"><i data-lucide="trash-2" style="width:11px;height:11px;"></i></button></td></tr>';
  }).join('') + '</tbody></table></div>' : '<p style="color:#9CA3AF;padding:30px;text-align:center;">Tiada kempen iklan. Tekan "Tambah Kempen".</p>';
 const statusPills = '<button onclick="window.__mktSetAdsFilter(\'status\',\'all\')" style="padding:5px 12px;border-radius:50px;border:1px solid '+(window.__mktAdsFilter.status==='all'?'var(--primary)':'var(--border-color)')+';background:'+(window.__mktAdsFilter.status==='all'?'var(--primary)':'#fff')+';color:'+(window.__mktAdsFilter.status==='all'?'#fff':'#6B7280')+';font-size:12px;font-weight:700;cursor:pointer;">Semua</button>'+window.__mktAdStatuses.map(function(s){ const on=window.__mktAdsFilter.status===s[0]; return '<button onclick="window.__mktSetAdsFilter(\'status\',\''+s[0]+'\')" style="padding:5px 12px;border-radius:50px;border:1px solid '+(on?'var(--primary)':'var(--border-color)')+';background:'+(on?'var(--primary)':'#fff')+';color:'+(on?'#fff':'#6B7280')+';font-size:12px;font-weight:700;cursor:pointer;">'+s[1]+'</button>'; }).join('');
 body.innerHTML = '<div class="rp-wrap">'
  + '<div class="rp-header"><div><h2 class="rp-title"><i data-lucide="badge-dollar-sign" style="width:22px;height:22px;color:var(--primary);"></i> Ads</h2><p class="rp-subtitle">Jejak kempen iklan berbayar (TikTok/Meta/Shopee) — spend vs hasil + ROAS. Input manual.</p></div><button onclick="window.__mktAdModal()" style="padding:9px 18px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;"><i data-lucide="plus" style="width:14px;height:14px;vertical-align:-2px;"></i> Tambah Kempen</button></div>'
  + lockBanner
  + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px;">'
  + kpi('Total Spend', window.__mktMoney(tSpend, showMoney))
  + kpi('Revenue', window.__mktMoney(tRev, showMoney))
  + kpi('Blended ROAS', showMoney?(tSpend>0?blendedRoas.toFixed(2)+'x':'—'):'•••')
  + kpi('Conversions', String(tOrders), 'orders')
  + kpi('Kos / Order', window.__mktMoney(costPerOrder, showMoney))
  + '</div>'
  + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">'+statusPills+'</div>'
  + tbl + '</div>';
 if(window.lucide && lucide.createIcons) try{ lucide.createIcons(); }catch(e){}
};
window.__mktAdModal = function(id){
 const a = id ? (window.__mktAdsCache.find(function(x){return x.id===id;})||{}) : {};
 const E = window.__mktEsc;
 const old = document.getElementById('mktAdModal'); if(old) old.remove();
 const platOpts = window.__mktAdPlatforms.map(function(p){ return '<option value="'+p[0]+'"'+(a.platform===p[0]?' selected':'')+'>'+p[1]+'</option>'; }).join('');
 const objOpts = [['awareness','Awareness'],['traffic','Traffic'],['conversion','Conversion']].map(function(o){ return '<option value="'+o[0]+'"'+(a.objective===o[0]?' selected':'')+'>'+o[1]+'</option>'; }).join('');
 const statusOpts = window.__mktAdStatuses.map(function(s){ return '<option value="'+s[0]+'"'+(a.status===s[0]?' selected':'')+'>'+s[1]+'</option>'; }).join('');
 const num = function(lbl,key,val){ return '<div><label style="font-size:11.5px;font-weight:700;color:#374151;">'+lbl+'</label><input id="mktA_'+key+'" type="number" step="any" value="'+(val!=null&&val!==''?val:'')+'" style="width:100%;box-sizing:border-box;margin-top:5px;padding:9px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;"></div>'; };
 const ov = document.createElement('div');
 ov.id = 'mktAdModal';
 ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9990;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(2px);overflow:auto;';
 ov.onclick = function(e){ if(e.target===ov) ov.remove(); };
 ov.innerHTML = '<div style="background:#fff;border-radius:14px;width:100%;max-width:500px;max-height:92vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.3);font-family:var(--font-main,Poppins),sans-serif;" onclick="event.stopPropagation()">'
  + '<div style="padding:16px 20px;border-bottom:1px solid #F3F4F6;"><strong style="font-size:15px;">'+(id?'Edit Kempen':'Tambah Kempen Iklan')+'</strong></div>'
  + '<div style="padding:18px 20px;">'
  + '<label style="font-size:11.5px;font-weight:700;color:#374151;">Nama Kempen</label><input id="mktA_name" value="'+E(a.name||'')+'" placeholder="cth: Raya Khemah Promo - TikTok" style="width:100%;box-sizing:border-box;margin:5px 0 13px;padding:9px 11px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;">'
  + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:13px;"><div><label style="font-size:11.5px;font-weight:700;color:#374151;">Platform</label><select id="mktA_platform" style="width:100%;box-sizing:border-box;margin-top:5px;padding:9px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;">'+platOpts+'</select></div><div><label style="font-size:11.5px;font-weight:700;color:#374151;">Objektif</label><select id="mktA_objective" style="width:100%;box-sizing:border-box;margin-top:5px;padding:9px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;">'+objOpts+'</select></div><div><label style="font-size:11.5px;font-weight:700;color:#374151;">Status</label><select id="mktA_status" style="width:100%;box-sizing:border-box;margin-top:5px;padding:9px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;">'+statusOpts+'</select></div></div>'
  + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:13px;"><div><label style="font-size:11.5px;font-weight:700;color:#374151;">Mula</label><input id="mktA_start_date" type="date" value="'+E(a.start_date||'')+'" style="width:100%;box-sizing:border-box;margin-top:5px;padding:8px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;"></div><div><label style="font-size:11.5px;font-weight:700;color:#374151;">Tamat</label><input id="mktA_end_date" type="date" value="'+E(a.end_date||'')+'" style="width:100%;box-sizing:border-box;margin-top:5px;padding:8px;border:1.5px solid var(--border-color);border-radius:8px;font-size:13px;"></div></div>'
  + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:13px;">'+num('Budget (RM)','budget',a.budget)+num('Spend (RM)','spend',a.spend)+'</div>'
  + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:13px;">'+num('Impressions','impressions',a.impressions)+num('Clicks','clicks',a.clicks)+num('Orders','orders',a.orders)+num('Revenue','revenue',a.revenue)+'</div>'
  + '<label style="font-size:11.5px;font-weight:700;color:#374151;">Nota</label><textarea id="mktA_notes" rows="2" placeholder="produk/koleksi disasarkan, audience, dll" style="width:100%;box-sizing:border-box;margin:5px 0 16px;padding:9px 11px;border:1.5px solid var(--border-color);border-radius:8px;font-size:12.5px;font-family:var(--font-main,Poppins),sans-serif;resize:vertical;">'+E(a.notes||'')+'</textarea>'
  + '<button onclick="window.__mktSaveAd('+(id||'null')+')" style="width:100%;background:var(--primary);color:#fff;border:none;padding:12px;border-radius:9px;font-size:13.5px;font-weight:700;cursor:pointer;">Simpan</button>'
  + '<button onclick="document.getElementById(\'mktAdModal\').remove()" style="width:100%;margin-top:8px;background:none;border:none;color:#9CA3AF;padding:6px;cursor:pointer;font-size:12px;font-weight:600;">Tutup</button>'
  + '</div></div>';
 document.body.appendChild(ov);
 if(window.lucide && lucide.createIcons) try{ lucide.createIcons(); }catch(e){}
};
window.__mktSaveAd = async function(id){
 const g = function(x){ const el=document.getElementById(x); return el?el.value.trim():''; };
 const n = function(x){ const v=parseFloat(g(x)); return isNaN(v)?0:v; };
 const name = g('mktA_name');
 if(!name){ if(typeof showToast==='function') showToast('Nama kempen wajib.', 'warn'); return; }
 const u = window.currentUser||{};
 const rec = { name:name, platform:g('mktA_platform'), objective:g('mktA_objective'), status:g('mktA_status'), start_date:g('mktA_start_date')||null, end_date:g('mktA_end_date')||null, budget:n('mktA_budget'), spend:n('mktA_spend'), impressions:Math.round(n('mktA_impressions')), clicks:Math.round(n('mktA_clicks')), orders:Math.round(n('mktA_orders')), revenue:n('mktA_revenue'), notes:g('mktA_notes')||null, updated_at:new Date().toISOString() };
 try {
  if(id){ const r = await db.from('marketing_ads').update(rec).eq('id', id); if(r.error) throw r.error; }
  else { rec.created_by=u.staff_id||'unknown'; rec.created_by_name=u.name||'Unknown'; const r = await db.from('marketing_ads').insert([rec]); if(r.error) throw r.error; }
  if(typeof showToast==='function') showToast('Kempen disimpan.', 'success');
  const m = document.getElementById('mktAdModal'); if(m) m.remove();
  await window.__mktLoadAds(); window.renderAds();
 } catch(e){ if(typeof showToast==='function') showToast('Simpan gagal: '+e.message, 'error'); }
};
window.__mktDeleteAd = async function(id){
 if(!confirm('Padam kempen iklan ni?')) return;
 try { const r = await db.from('marketing_ads').delete().eq('id', id); if(r.error) throw r.error; await window.__mktLoadAds(); window.renderAds(); }
 catch(e){ if(typeof showToast==='function') showToast('Padam gagal: '+e.message, 'error'); }
};

// =================== 4) MARKETING REPORTS ===================
window.__mktRangeReports = '30d';
window.__mktSetReportsRange = function(r){ window.__mktRangeReports = r; window.renderMarketingReports(); };
window.renderMarketingReports = async function(){
 const body = document.getElementById('marketingReportsBody');
 if(!body) return;
 body.innerHTML = '<p style="color:#9CA3AF;padding:30px;text-align:center;">Memuatkan…</p>';
 const weekly = await window.__mktLoadWeekly();
 const content = await window.__mktLoadContent();
 const ads = await window.__mktLoadAds();
 const E = window.__mktEsc;
 const showMoney = !!(window.__confIsUnlocked && window.__confIsUnlocked());
 const rg = window.__mktRangeMs(window.__mktRangeReports);
 const cur = window.__mktAggWeekly(weekly, rg.from, rg.to);
 const prev = window.__mktAggWeekly(weekly, rg.prevFrom, rg.prevTo);
 const sumKey = function(o,k){ return o.tiktok[k]+o.instagram[k]+o.facebook[k]; };
 // social block
 const socRows = ['tiktok','instagram','facebook'].map(function(pl){ const m=window.__mktPlat[pl]; const c=cur[pl]; return '<tr style="border-bottom:1px solid #F3F4F6;"><td style="padding:8px 10px;font-weight:700;color:'+m.color+';">'+m.label+'</td><td style="padding:8px;text-align:right;">'+c.posts+'</td><td style="padding:8px;text-align:right;">'+c.views.toLocaleString()+'</td><td style="padding:8px;text-align:right;">'+c.likes.toLocaleString()+'</td><td style="padding:8px;text-align:right;font-weight:700;color:var(--primary);">'+c.leads+'</td></tr>'; }).join('');
 const totLeads = sumKey(cur,'leads'), prevLeads = sumKey(prev,'leads');
 const socBlock = '<div class="admin-card" style="padding:16px;margin-bottom:14px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><strong style="font-size:13px;"><i data-lucide="share-2" style="width:14px;height:14px;vertical-align:-2px;"></i> Prestasi Sosial</strong><span style="font-size:11px;">Leads: <strong>'+totLeads+'</strong> '+window.__mktDelta(totLeads,prevLeads)+'</span></div>'
  + '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead style="background:#F9FAFB;"><tr><th style="text-align:left;padding:8px 10px;font-size:10px;color:#6B7280;">PLATFORM</th><th style="text-align:right;padding:8px;font-size:10px;color:#6B7280;">POSTS</th><th style="text-align:right;padding:8px;font-size:10px;color:#6B7280;">VIEWS</th><th style="text-align:right;padding:8px;font-size:10px;color:#6B7280;">LIKES</th><th style="text-align:right;padding:8px;font-size:10px;color:#6B7280;">LEADS</th></tr></thead><tbody>'+socRows+'</tbody></table></div>';
 // content output block
 const cByStatus = {}; window.__mktContentStatuses.forEach(function(s){ cByStatus[s[0]]=content.filter(function(c){return c.status===s[0];}).length; });
 const contentBlock = '<div class="admin-card" style="padding:16px;margin-bottom:14px;"><strong style="font-size:13px;"><i data-lucide="calendar-days" style="width:14px;height:14px;vertical-align:-2px;"></i> Output Kandungan</strong><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:12px;">'
  + window.__mktContentStatuses.map(function(s){ return '<div style="text-align:center;padding:10px;background:'+s[2]+';border-radius:8px;"><div style="font-size:22px;font-weight:800;color:'+s[3]+';">'+(cByStatus[s[0]]||0)+'</div><div style="font-size:10px;color:'+s[3]+';font-weight:700;">'+s[1]+'</div></div>'; }).join('')
  + '</div></div>';
 // ads block (money gated)
 let aSpend=0,aRev=0,aOrders=0; ads.forEach(function(a){ aSpend+=Number(a.spend)||0; aRev+=Number(a.revenue)||0; aOrders+=Number(a.orders)||0; });
 const aRoas = aSpend>0?(aRev/aSpend):0;
 const adsBlock = '<div class="admin-card" style="padding:16px;margin-bottom:14px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><strong style="font-size:13px;"><i data-lucide="badge-dollar-sign" style="width:14px;height:14px;vertical-align:-2px;"></i> Prestasi Iklan</strong>'+(showMoney?'':'<button onclick="window.__confidentialGate(function(){ window.renderMarketingReports(); })" style="padding:5px 12px;background:var(--primary);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">Buka PIN</button>')+'</div>'
  + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">'
  + '<div style="text-align:center;"><div style="font-size:10px;color:#9CA3AF;text-transform:uppercase;">Spend</div><div style="font-size:18px;font-weight:800;">'+window.__mktMoney(aSpend,showMoney)+'</div></div>'
  + '<div style="text-align:center;"><div style="font-size:10px;color:#9CA3AF;text-transform:uppercase;">Revenue</div><div style="font-size:18px;font-weight:800;">'+window.__mktMoney(aRev,showMoney)+'</div></div>'
  + '<div style="text-align:center;"><div style="font-size:10px;color:#9CA3AF;text-transform:uppercase;">ROAS</div><div style="font-size:18px;font-weight:800;color:'+(showMoney?window.__mktRoasColor(aRev,aSpend):'#9CA3AF')+';">'+(showMoney?(aSpend>0?aRoas.toFixed(2)+'x':'—'):'•••')+'</div></div>'
  + '<div style="text-align:center;"><div style="font-size:10px;color:#9CA3AF;text-transform:uppercase;">Conversions</div><div style="font-size:18px;font-weight:800;">'+aOrders+'</div></div>'
  + '</div></div>';
 // submission accountability
 const submitters = {}; (weekly||[]).forEach(function(r){ const t=new Date(r.period_key||0).getTime(); if(t>=rg.from&&t<=rg.to){ submitters[r.staff_name||r.staff_id]=true; } });
 const subNames = Object.keys(submitters);
 const subBlock = '<div class="admin-card" style="padding:16px;"><strong style="font-size:13px;"><i data-lucide="users" style="width:14px;height:14px;vertical-align:-2px;"></i> Hantaran Data Mingguan (period ni)</strong><div style="font-size:12px;color:#6B7280;margin-top:8px;">'+(subNames.length?('Dihantar oleh: <strong>'+E(subNames.join(', '))+'</strong>'):'Belum ada hantaran marketing_weekly untuk period ni.')+'</div></div>';
 body.innerHTML = '<div class="rp-wrap">'
  + '<div class="rp-header"><div><h2 class="rp-title"><i data-lucide="bar-chart-3" style="width:22px;height:22px;color:var(--primary);"></i> Marketing Reports</h2><p class="rp-subtitle">Roll-up prestasi marketing: sosial + kandungan + iklan.</p></div><button onclick="window.__mktPrintReport()" style="padding:9px 16px;background:#fff;border:1px solid var(--border-color);color:#374151;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;"><i data-lucide="printer" style="width:14px;height:14px;vertical-align:-2px;"></i> Cetak</button></div>'
  + window.__mktPills(window.__mktRangeReports, 'window.__mktSetReportsRange')
  + socBlock + contentBlock + adsBlock + subBlock + '</div>';
 if(window.lucide && lucide.createIcons) try{ lucide.createIcons(); }catch(e){}
};
window.__mktPrintReport = function(){
 const weekly = window.__mktWeeklyCache||[]; const content = window.__mktContentCache||[]; const ads = window.__mktAdsCache||[];
 const showMoney = !!(window.__confIsUnlocked && window.__confIsUnlocked());
 const rg = window.__mktRangeMs(window.__mktRangeReports);
 const cur = window.__mktAggWeekly(weekly, rg.from, rg.to);
 const E = window.__mktEsc;
 let aSpend=0,aRev=0,aOrders=0; ads.forEach(function(a){ aSpend+=Number(a.spend)||0; aRev+=Number(a.revenue)||0; aOrders+=Number(a.orders)||0; });
 const today = new Date().toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
 const win = window.open('','_blank','width=820,height=900'); if(!win){ if(typeof showToast==='function') showToast('Popup disekat — benarkan popup.', 'warn'); return; }
 const socRows = ['tiktok','instagram','facebook'].map(function(pl){ const m=window.__mktPlat[pl]; const c=cur[pl]; return '<tr><td>'+m.label+'</td><td style="text-align:right;">'+c.posts+'</td><td style="text-align:right;">'+c.views+'</td><td style="text-align:right;">'+c.likes+'</td><td style="text-align:right;">'+c.leads+'</td></tr>'; }).join('');
 const posted = content.filter(function(c){return c.status==='posted';}).length;
 win.document.write('<!DOCTYPE html><html><head><title>Marketing Report</title><style>body{font-family:Arial,sans-serif;max-width:760px;margin:auto;padding:28px;color:#111;}h1{font-size:20px;}h2{font-size:15px;color:var(--primary-500,#CD7C32);margin-top:22px;}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;}th,td{border:1px solid #999;padding:6px 8px;text-align:left;}th{background:#f3f4f6;}@media print{button{display:none;}}</style></head><body>'
  + '<h1>10 CAMP — Marketing Report</h1><div style="font-size:12px;color:#555;">'+E(today)+' · Period: '+window.__mktRangeReports+'</div>'
  + '<h2>Prestasi Sosial</h2><table><thead><tr><th>Platform</th><th style="text-align:right;">Posts</th><th style="text-align:right;">Views</th><th style="text-align:right;">Likes</th><th style="text-align:right;">Leads</th></tr></thead><tbody>'+socRows+'</tbody></table>'
  + '<h2>Output Kandungan</h2><p>Jumlah kandungan: '+content.length+' · Disiarkan: '+posted+'</p>'
  + '<h2>Prestasi Iklan</h2><p>Spend: '+(showMoney?('RM '+aSpend.toFixed(2)):'(disorok PIN)')+' · Revenue: '+(showMoney?('RM '+aRev.toFixed(2)):'(disorok PIN)')+' · ROAS: '+(showMoney?(aSpend>0?(aRev/aSpend).toFixed(2)+'x':'—'):'(disorok PIN)')+' · Conversions: '+aOrders+'</p>'
  + '<p style="margin-top:30px;font-size:10px;color:#999;text-align:center;">Auto-generated by POS10C · Marketing Report · '+E(today)+'</p>'
  + '<button onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:10px 20px;background:var(--primary-500,#CD7C32);color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">Print</button>'
  + '</body></html>');
 win.document.close();
};
