// NexusAlchemy Player PWA (offline-first)
// DM -> Player codes are signed with HMAC to block casual edits.
// This is not strong protection against a motivated reverse engineer.

const NXA_SECRET = "NXA-i2v7rzHkk5aGMgFTTUYigGZHskyssAgGk2QLy9ToMJY";
// Code formats:
// - Legacy (v1):
//    DM -> Player : NXA1|<b64url(json)>|<b64url(hmac_sha256(json))>
//    Player -> DM : NXREQ|<b64url(json)>
// - Compressed (v2, shorter):
//    DM -> Player : NXA2|<b64url(gzip(json))>|<b64url(hmac_sha256(gzip_bytes))>
//    Player -> DM : NXQ2|<b64url(gzip(json))>
//
// The app generates v2 by default, but can still *read* v1.

const CODE_PREFIX_V1 = "NXA1|";
const CODE_PREFIX_V2 = "NXA2|";

const REQ_PREFIX_V1  = "NXREQ|";
const REQ_PREFIX_V2  = "NXQ2|";

// Short signatures reduce code length a lot, while still blocking casual edits.
// We accept both full (32 bytes) and truncated signatures.
const SIG_TRUNC_BYTES = 12; // 96-bit tag

const STORAGE_KEY = "nxa_player_state_v1";

const RARITIES = ["Common","Uncommon","Rare","Very Rare","Legendary"];

const ESS_META = {
  Vitalis: {ua:"Життя", emoji:"💚"},
  Mortis: {ua:"Смерть", emoji:"💀"},
  Ignis: {ua:"Енергія", emoji:"🔥"},
  Solidus: {ua:"Матерія", emoji:"🛡️"},
  Aether: {ua:"Магія", emoji:"✨"},
  Rift: {ua:"Розрив", emoji:"🕳️"},
};

// DM-like colors
const ESS_COLOR = {
  Vitalis: {r:80, g:220, b:150},
  Mortis:  {r:210,g:80,  b:90},
  Ignis:   {r:255,g:140, b:60},
  Solidus: {r:110,g:170, b:255},
  Aether:  {r:190,g:120, b:255},
  Rift:    {r:70, g:70,  b:90},
};

const RARITY_COLOR = {
  "Common":    {r:150,g:150,b:150},
  "Uncommon":  {r:80, g:200,b:120},
  "Rare":      {r:80, g:140,b:255},
  "Very Rare": {r:170,g:90, b:255},
  "Legendary": {r:255,g:140,b:0},
};

function essenceLabel(e){
  const m = ESS_META[e];
  // Show only the essence code to avoid labels like "Магія(Aether)".
  if(m && m.emoji) return `${m.emoji} ${e}`;
  return e || "—";
}


function nowIso(){ return new Date().toISOString(); }
function shortPackId(){
  // 64-bit random id encoded as base64url (11 chars). Much shorter than UUID.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}
function epochSec(){ return Math.floor(Date.now()/1000); }
function epochToIso(sec){
  const s = Number(sec);
  if(!Number.isFinite(s)) return nowIso();
  return new Date(s*1000).toISOString();
}
function toast(msg){
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 2200);
}

function bindTap(el, handler){
  if(!el || !handler) return;
  let last = 0;
  const wrapped = (ev) => {
    const now = Date.now();
    if(now - last < 250) return;
    last = now;
    try{ ev.preventDefault(); ev.stopPropagation(); }catch(_){ }
    try{
      const res = handler(ev);
      if(res && typeof res.then === 'function') res.catch((err)=>console.error(err));
    }catch(err){ console.error(err); }
  };
  // IMPORTANT: do NOT subscribe to multiple "tap" event types at the same time.
  // On many Android WebViews a single tap fires: touchend/pointerup *and then* a synthetic click.
  // If we listen to both, a modal can open on pointerup and instantly close on the synthetic click.
  const hasPointer = typeof window !== 'undefined' && typeof window.PointerEvent !== 'undefined';
  const hasTouch = typeof window !== 'undefined' && ('ontouchend' in window);
  if(hasPointer){
    el.addEventListener('pointerup', wrapped, {passive:false});
  }else if(hasTouch){
    el.addEventListener('touchend', wrapped, {passive:false});
  }else{
    el.addEventListener('click', wrapped);
  }
}

function confirmOverlay(message, yesLabel='Так', noLabel='Ні'){
  // window.confirm is often blocked/suppressed inside some Android WebViews.
  return new Promise((resolve)=>{
    const ov = document.createElement('div');
    ov.style.position = 'fixed';
    ov.style.inset = '0';
    ov.style.background = 'rgba(0,0,0,0.55)';
    ov.style.display = 'flex';
    ov.style.alignItems = 'center';
    ov.style.justifyContent = 'center';
    ov.style.zIndex = '99999';
    ov.style.padding = '16px';

    const card = document.createElement('div');
    card.style.maxWidth = '520px';
    card.style.width = '100%';
    card.style.background = '#17131f';
    card.style.border = '1px solid rgba(255,255,255,0.10)';
    card.style.borderRadius = '16px';
    card.style.boxShadow = '0 18px 50px rgba(0,0,0,0.45)';
    card.style.padding = '16px';
    card.style.color = '#fff';

    const txt = document.createElement('div');
    txt.style.fontSize = '15px';
    txt.style.lineHeight = '1.4';
    txt.style.marginBottom = '14px';
    txt.textContent = message;

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '10px';
    row.style.justifyContent = 'flex-end';

    const no = document.createElement('button');
    no.className = 'btn small';
    no.textContent = noLabel;

    const yes = document.createElement('button');
    yes.className = 'btn small danger';
    yes.textContent = yesLabel;

    row.appendChild(no);
    row.appendChild(yes);

    card.appendChild(txt);
    card.appendChild(row);
    ov.appendChild(card);
    document.body.appendChild(ov);

    const cleanup = () => { try{ ov.remove(); }catch(_){ } };
    bindTap(no, ()=>{ cleanup(); resolve(false); });
    bindTap(yes, ()=>{ cleanup(); resolve(true); });
    // NOTE: We intentionally do NOT close on tapping the backdrop.
    // Some Android WebViews dispatch delayed synthetic clicks (300ms),
    // which can instantly close the modal and make buttons "do nothing".
  });
}

function base64urlEncode(bytes){
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function base64urlDecode(str){
  str = str.replace(/-/g,'+').replace(/_/g,'/');
  while(str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function supportsGzipStreams(){
  return (typeof CompressionStream !== 'undefined') && (typeof DecompressionStream !== 'undefined');
}

async function gzipCompressUtf8(str){
  const enc = new TextEncoder();
  const input = enc.encode(str);
  if(!supportsGzipStreams()) return input;
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(input);
  writer.close();
  const ab = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(ab);
}

async function gzipDecompressToUtf8(bytes){
  if(!supportsGzipStreams()){
    // Best-effort fallback: treat bytes as UTF-8.
    return new TextDecoder().decode(bytes);
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const ab = await new Response(ds.readable).arrayBuffer();
  return new TextDecoder().decode(new Uint8Array(ab));
}

async function shortCodeHash(codeStr){
  const enc = new TextEncoder();
  const data = enc.encode((codeStr||'').trim());
  try{
    if(crypto?.subtle?.digest){
      const dig = await crypto.subtle.digest('SHA-256', data);
      const bytes = new Uint8Array(dig).slice(0, 8); // 64-bit is enough for a local "used" set
      return base64urlEncode(bytes);
    }
  }catch(_){ /* ignore */ }
  // Fallback: FNV-1a 32-bit
  let h = 0x811c9dc5;
  for(const b of data){
    h ^= b;
    h = (h + ((h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24))) >>> 0;
  }
  const out = new Uint8Array(4);
  out[0] = (h>>>24)&255; out[1] = (h>>>16)&255; out[2] = (h>>>8)&255; out[3]=h&255;
  return base64urlEncode(out);
}

async function hmacSign(payloadBytes){
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(NXA_SECRET), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, payloadBytes);
  return new Uint8Array(sig);
}

function expandNxa2(obj){
  // Accept both: (a) compressed legacy JSON, (b) compact schema.
  if(!obj || typeof obj !== 'object') return obj;
  if(obj.type) return obj; // legacy schema
  if(obj.v !== 2) return obj;

  const tmap = { L: 'loot', C: 'craft_result', R: 'recipe_unlock' };
  const type = tmap[obj.t] || obj.t;
  const out = {
    v: 1,
    type: type,
    pack_id: obj.id,
    issued_at: (typeof obj.at === 'number') ? epochToIso(obj.at) : obj.at,
    data: {}
  };
  const d = obj.d || {};

  const expandInv = (rows) => (rows||[]).filter(Boolean).map(row => {
    const e = row?.[0];
    const r = row?.[1] || 'Common';
    const q = row?.[2] ?? 0;
    const n = row?.[3] || e || '';
    return { name: n, essence: e, rarity: r, qty_delta: q };
  });

  if(type === 'loot'){
    out.data.inventory_delta = expandInv(d.i);
  } else if(type === 'craft_result'){
    out.data.title = d.n || 'Результат крафту';
    out.data.visual_description = d.v || '';
    out.data.essences = (d.es && typeof d.es === 'object') ? d.es : {};
    out.data.inventory_delta = expandInv(d.i);
    out.data.discover_recipe = Boolean(d.dr);
    out.data.recipe_id = d.rid || '';
    out.data.recipe_title = d.rt || out.data.title;
  } else if(type === 'recipe_unlock'){
    out.data.recipe_id = d.rid || '';
    out.data.recipe_title = d.rt || 'Невідомий предмет';
    out.data.visual_description = d.v || '';
    out.data.essences = (d.es && typeof d.es === 'object') ? d.es : {};
  }

  return out;
}

async function decodeDmCode(code){
  code = (code||'').trim();
  const isV1 = code.startsWith(CODE_PREFIX_V1);
  const isV2 = code.startsWith(CODE_PREFIX_V2);
  if(!isV1 && !isV2) throw new Error("Це не код NXA");
  if(isV2 && !supportsGzipStreams()){
    throw new Error('Ваш браузер/ WebView не підтримує короткі коди NXA2 (gzip). Онови Chrome/WebView або попроси DM згенерувати NXA1.');
  }
  const parts = code.split("|");
  if(parts.length !== 3) throw new Error("Невірний формат коду");

  const payloadBytes = base64urlDecode(parts[1]);
  const sigBytes = base64urlDecode(parts[2]);

  // Signature is calculated over the *exact* payload bytes (raw JSON for v1, gzip bytes for v2).
  const goodSig = await hmacSign(payloadBytes);
  // Support both full and truncated signatures.
  if(sigBytes.length !== goodSig.length && sigBytes.length !== SIG_TRUNC_BYTES) throw new Error("Підпис не збігається");
  const n = sigBytes.length;
  for(let i=0;i<n;i++) if(sigBytes[i] !== goodSig[i]) throw new Error("Підпис не збігається");

  const payloadStr = isV2
    ? await gzipDecompressToUtf8(payloadBytes)
    : new TextDecoder().decode(payloadBytes);

  const obj = JSON.parse(payloadStr);
  return isV2 ? expandNxa2(obj) : obj;
}

function compactReqV2(reqObj){
  // Compact schema for shorter codes (v2):
  // {v:2,t:'Q',id,at,it:[[essence,rarity,qty],...]}
  if(!reqObj || typeof reqObj !== 'object') return reqObj;
  const items = Array.isArray(reqObj.items) ? reqObj.items : [];
  return {
    v: 2,
    t: 'Q',
    id: reqObj.pack_id || '',
    at: (typeof reqObj.issued_at === 'number') ? reqObj.issued_at : epochSec(),
    it: items.filter(Boolean).map(i => [i.essence, (i.rarity||'Common'), Number(i.qty||0)])
  };
}

async function makeReqCode(reqObj){
  // Generate the shortest format we can.
  if(supportsGzipStreams()){
    const payloadStr = JSON.stringify(compactReqV2(reqObj));
    const gz = await gzipCompressUtf8(payloadStr);
    return REQ_PREFIX_V2 + base64urlEncode(gz);
  }
  const payloadStr = JSON.stringify(reqObj);
  const payloadBytes = new TextEncoder().encode(payloadStr);
  return REQ_PREFIX_V1 + base64urlEncode(payloadBytes);
}

function defaultState(){
  return {
    v: 1,
    created_at: nowIso(),
    imported_pack_ids: [],
    used_code_hashes: [],
    inventory: [], // [{essence, qty}] (simplified)
    recipes: [],   // [{recipe_id, title, gm_visual, visual, essences, created_at, updated_at}]
    history: []    // [{ts, kind, summary, data}]
  };
}
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const st = JSON.parse(raw);
    if(!st || typeof st !== 'object') return defaultState();
    const merged = Object.assign(defaultState(), st);

    // Backward compatibility: ensure recipe fields exist.
    merged.recipes = (merged.recipes || []).filter(Boolean).map(r => {
  if(typeof r.gm_visual !== 'string') r.gm_visual = (r.visual || '');
  if(typeof r.visual !== 'string') r.visual = (r.gm_visual || '');
  if(!r.essences || typeof r.essences !== 'object') r.essences = {};
  return r;
});

    merged.imported_pack_ids = Array.isArray(merged.imported_pack_ids) ? merged.imported_pack_ids : [];
    merged.used_code_hashes = Array.isArray(merged.used_code_hashes) ? merged.used_code_hashes : [];
    merged.inventory = normalizeInventory(Array.isArray(merged.inventory) ? merged.inventory : []);
    merged.history = Array.isArray(merged.history) ? merged.history : [];

    return merged;
  }catch(_){ return defaultState(); }
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function normalizeInventory(inv){
  // Normalize to {essence, rarity, qty} rows (rarity matters for checks).
  const map = {};
  for(const it of (inv||[])){
    if(!it) continue;
    const essence = (it.essence||'').toString().trim() || (it.name||'').toString().trim();
    const rarity = (it.rarity||'Common').toString().trim() || 'Common';
    const qty = Number(it.qty||0);
    if(!essence || !Number.isFinite(qty) || qty===0) continue;
    const k = `${essence}||${rarity}`.toLowerCase();
    map[k] = { essence, rarity, qty: (map[k]?.qty||0) + qty };
  }
  return Object.values(map)
    .filter(it => Number.isFinite(it.qty) && it.qty>0);
}


function invKey(it){
  return `${(it.essence||'').toLowerCase()}||${(it.rarity||'Common').toLowerCase()}`;
}

function addInventoryDelta(deltaItems){
  // Inventory is tracked by (essence + rarity).
  const map = new Map(state.inventory.map(it => [invKey(it), {...it}]));
  for(const d of (deltaItems||[])) {
    if(!d) continue;
    const essence = ((d.essence||'') || (d.name||'')).toString().trim();
    const rarity  = (d.rarity||'Common').toString().trim() || 'Common';
    const qtyd = Number(d.qty_delta ?? d.qty ?? 0);
    if(!essence || !Number.isFinite(qtyd) || qtyd===0) continue;
    const key = `${essence.toLowerCase()}||${rarity.toLowerCase()}`;
    const cur = map.get(key) || {essence, rarity, qty:0};
    cur.qty = Number(cur.qty||0) + qtyd;
    map.set(key, cur);
  }
  // Keep only positive qty
  state.inventory = Array.from(map.values()).filter(it => Number(it.qty||0) > 0);
}

function upsertRecipe({recipe_id, title, visual, essences}){
  let r = state.recipes.find(x => x.recipe_id === recipe_id);
  const incomingVisual = (visual || '').trim();
  const incomingEss = (essences && typeof essences === 'object') ? essences : {};

  if(!r){
    r = {
      recipe_id,
      title: title || "Невідомий предмет",
      gm_visual: incomingVisual,
      visual: incomingVisual, // editable by player
      essences: incomingEss,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    state.recipes.unshift(r);
  }else{
    if(title && title.trim()) r.title = title.trim();

    // Update essence composition if provided
    if(incomingEss && Object.keys(incomingEss).length){
      r.essences = incomingEss;
    } else if(!r.essences || typeof r.essences !== 'object'){
      r.essences = {};
    }

    // Track the latest GM visual snapshot
    const prevGm = (r.gm_visual || '').trim();
    if(incomingVisual) r.gm_visual = incomingVisual;

    // Only overwrite player's editable description if they haven't changed it
    const playerDesc = (r.visual || '').trim();
    const playerDidNotChange = (!playerDesc) || (playerDesc === prevGm);
    if(incomingVisual && playerDidNotChange){
      r.visual = incomingVisual;
    }
    r.updated_at = nowIso();
  }

  saveState();
  return r;
}

function pushHistory(kind, summary, data){
  state.history.unshift({ts: nowIso(), kind, summary, data});
  state.history = state.history.slice(0, 200);
  saveState();
}

function escapeHtml(str){
  return (str ?? '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function normalizeText(s){ return (s||'').toLowerCase(); }

// -----------------------------
// DM-like cauldron animation (canvas)
// -----------------------------
class CauldronAnimator{
  constructor(canvas){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.angle = 0;
    this.essences = [];
    this.base = {r:40,g:30,b:60};
    this._dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    this._raf = null;
    this._size = 320;

    window.addEventListener('resize', ()=>this.resize(), {passive:true});
    this.resize();
    this._loop();
  }

  setEssences(ess){
    this.essences = Array.isArray(ess) ? ess.filter(Boolean) : [];
    const cols = this.essences.map(e => ESS_COLOR[e]).filter(Boolean);
    if(cols.length){
      const r = Math.round(cols.reduce((s,c)=>s+c.r,0) / cols.length);
      const g = Math.round(cols.reduce((s,c)=>s+c.g,0) / cols.length);
      const b = Math.round(cols.reduce((s,c)=>s+c.b,0) / cols.length);
      this.base = {r,g,b};
    } else {
      this.base = {r:40,g:30,b:60};
    }
  }

  resize(){
    try{
      const rect = this.canvas.getBoundingClientRect();
      const side = Math.max(240, Math.floor(Math.min(rect.width || 0, rect.height || 0) || (rect.width || 320) || 320));
      this._size = side;
      this._dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      this.canvas.width = side * this._dpr;
      this.canvas.height = side * this._dpr;
    }catch(_){
      // ignore
    }
  }

  _loop(){
    this.angle = (this.angle + 1.3) % 360;
    this.draw();
    this._raf = requestAnimationFrame(()=>this._loop());
  }

  draw(){
    const ctx = this.ctx;
    if(!ctx) return;
    const w = this.canvas.width, h = this.canvas.height;
    const cx = w/2, cy = h/2;
    const r = Math.min(w,h) * 0.42;

    ctx.save();
    ctx.scale(1,1);
    ctx.clearRect(0,0,w,h);
    ctx.translate(0,0);

    // background ring
    ctx.beginPath();
    ctx.fillStyle = 'rgba(20,16,28,1)';
    ctx.arc(cx, cy, r+10*this._dpr, 0, Math.PI*2);
    ctx.fill();
    ctx.lineWidth = 6*this._dpr;
    ctx.strokeStyle = 'rgba(90,80,120,0.35)';
    ctx.stroke();

    // liquid
    ctx.beginPath();
    ctx.fillStyle = `rgba(${this.base.r},${this.base.g},${this.base.b},0.70)`;
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.fill();

    // swirl arcs
    const start = (this.angle*Math.PI/180);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(240,240,255,0.28)';
    ctx.lineWidth = 10*this._dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, r*0.70, start, start + (220*Math.PI/180));
    ctx.stroke();

    ctx.strokeStyle = 'rgba(240,240,255,0.18)';
    ctx.lineWidth = 6*this._dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, r*0.52, start + (120*Math.PI/180), start + (120*Math.PI/180) + (240*Math.PI/180));
    ctx.stroke();

    // sparkles
    for(let i=0;i<6;i++){
      const a = (this.angle + i*60) * Math.PI/180;
      const wob = Math.sin((this.angle+i*20)*Math.PI/180) * 6 * this._dpr;
      const sx = cx + Math.cos(a) * r*0.86 + wob;
      const sy = cy + Math.sin(a) * r*0.62 - wob*0.4;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.arc(sx, sy, 4*this._dpr, 0, Math.PI*2);
      ctx.fill();
    }

    // rim glow
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${this.base.r},${this.base.g},${this.base.b},0.27)`;
    ctx.lineWidth = 10*this._dpr;
    ctx.arc(cx, cy, r + 6*this._dpr, 0, Math.PI*2);
    ctx.stroke();

    ctx.restore();
  }
}

function renderInventory(){
  const filter = normalizeText(document.getElementById('inv-filter').value);
  const list = document.getElementById('inv-list');
  list.innerHTML = '';

  // Group by essence -> rarity -> qty
  const byEss = new Map();
  for(const it of state.inventory){
    const e = it.essence;
    const r = it.rarity || 'Common';
    const q = Number(it.qty||0);
    if(!e || !Number.isFinite(q) || q<=0) continue;
    if(!byEss.has(e)) byEss.set(e, {});
    const obj = byEss.get(e);
    obj[r] = (obj[r]||0) + q;
  }

  const essences = Array.from(byEss.keys()).sort((a,b)=>a.localeCompare(b));
  const filteredEss = essences.filter(e=>{
    if(!filter) return true;
    const rar = byEss.get(e) || {};
    const hay = `${e} ${Object.keys(rar).join(' ')}`.toLowerCase();
    return hay.includes(filter);
  });

  if(filteredEss.length === 0){
    const c = document.createElement('div');
    c.className = 'card muted';
    c.textContent = 'Поки що інвентар порожній. Попроси майстра видати матеріали кодом (loot).';
    list.appendChild(c);
    return;
  }

  for(const e of filteredEss){
    const rarMap = byEss.get(e) || {};
    const total = Object.values(rarMap).reduce((s,v)=>s+Number(v||0),0);

    const parts = [];
    for(const r of RARITIES){
      if(rarMap[r]) parts.push(`<span class="mono">${escapeHtml(r)}: ${Number(rarMap[r])}</span>`);
    }
    // also include unknown rarities if any
    for(const r of Object.keys(rarMap)){
      if(!RARITIES.includes(r)) parts.push(`<span class="mono">${escapeHtml(r)}: ${Number(rarMap[r])}</span>`);
    }

    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="top">
        <div style="flex:1;">
          <div class="name">${escapeHtml(essenceLabel(e))}</div>
          <div class="meta">${parts.join(' • ') || '<span class="muted">—</span>'}</div>
        </div>
        <div class="qty">${total}</div>
      </div>
    `;
    list.appendChild(el);
  }
}

function invQty(essence, rarity){
  const e = (essence||'').toLowerCase();
  const r = (rarity||'Common').toLowerCase();
  const it = state.inventory.find(x => (x.essence||'').toLowerCase() === e && (x.rarity||'Common').toLowerCase() === r);
  return Number(it?.qty||0);
}

function reqQty(essence, rarity){
  const e = (essence||'').toLowerCase();
  const r = (rarity||'Common').toLowerCase();
  return reqItems
    .filter(x => (x.essence||'').toLowerCase() === e && (x.rarity||'Common').toLowerCase() === r)
    .reduce((s,x)=>s+Number(x.qty||0),0);
}

// -----------------------------
// Craft UI: cauldron slots are the single source of truth.
// reqItems is derived (grouped) from slots.
// -----------------------------
let cauldronSlots = Array(5).fill(null); // [{essence, rarity}] | null
let reqItems = [];
let _lastCraftSig = '';

function craftSigFromSlots(){
  return cauldronSlots.map(s => s ? `${s.essence}||${s.rarity}` : '-').join('|');
}

function cauldronIsFull(){ return cauldronSlots.every(Boolean); }

function syncReqFromSlots(){
  const map = new Map();
  for(const s of cauldronSlots){
    if(!s) continue;
    const k = `${(s.essence||'').toLowerCase()}||${(s.rarity||'Common').toLowerCase()}`;
    const cur = map.get(k) || {essence:s.essence, rarity:(s.rarity||'Common'), qty:0};
    cur.qty += 1;
    map.set(k, cur);
  }
  reqItems = Array.from(map.values()).filter(x => Number(x.qty||0) > 0);
}

function addToCauldron(essence, rarity){
  essence = (essence||'').toString().trim();
  rarity = (rarity||'Common').toString().trim() || 'Common';
  if(!essence){ toast('Нема сутності'); return; }

  syncReqFromSlots();
  const avail = invQty(essence, rarity);
  const used = reqQty(essence, rarity);
  const left = Math.max(0, avail - used);
  if(left <= 0){ toast('Недостатньо матеріалів'); return; }
  const idx = cauldronSlots.findIndex(x => !x);
  if(idx < 0){ toast('Котел заповнений (макс. 5)'); return; }
  cauldronSlots[idx] = {essence, rarity};
  renderCraftUI();
}

function clearSlot(idx){
  if(idx < 0 || idx >= cauldronSlots.length) return;
  cauldronSlots[idx] = null;
  renderCraftUI();
}

function clearCauldron(){
  cauldronSlots = Array(5).fill(null);
  renderCraftUI();
}

function removeFromCauldronByKey(essence, rarity){
  const e = (essence||'').toLowerCase();
  const r = (rarity||'Common').toLowerCase();
  cauldronSlots = cauldronSlots.map(s => {
    if(!s) return null;
    if((s.essence||'').toLowerCase() === e && (s.rarity||'Common').toLowerCase() === r) return null;
    return s;
  });
  renderCraftUI();
}

function renderCauldronSlots(){
  const host = document.getElementById('cauldron-slots');
  if(!host) return;
  host.innerHTML = '';

  for(let i=0;i<cauldronSlots.length;i++){
    const s = cauldronSlots[i];
    const el = document.createElement('div');
    el.className = 'slot' + (s ? ' filled' : '');
    if(s){
      const c = RARITY_COLOR[s.rarity] || RARITY_COLOR['Common'];
      el.style.borderColor = `rgba(${c.r},${c.g},${c.b},0.95)`;
      el.style.boxShadow = `0 0 0 1px rgba(${c.r},${c.g},${c.b},0.15), 0 8px 20px rgba(0,0,0,0.22)`;
    }

    const label = document.createElement('div');
    label.className = 'slot-label';
    if(!s){
      label.innerHTML = `
        <div class="slot-title muted">Слот ${i+1}</div>
        <div class="slot-sub">Торкнись інгредієнта нижче, щоб додати</div>
      `;
    } else {
      label.innerHTML = `
        <div class="slot-title">${escapeHtml(essenceLabel(s.essence))} <span class="badge">${escapeHtml(s.rarity||'Common')}</span></div>
        <div class="slot-sub">Доступно в інвентарі: <span class="mono">${invQty(s.essence, s.rarity||'Common')}</span></div>
      `;
    }
    el.appendChild(label);

    const btn = document.createElement('button');
    btn.className = 'slot-x';
    btn.textContent = '✕';
    btn.disabled = !s;
    btn.style.opacity = s ? '1' : '0.35';
    btn.addEventListener('click', ()=>clearSlot(i));
    el.appendChild(btn);

    host.appendChild(el);
  }
}

function renderCraftInvPicker(){
  const host = document.getElementById('craft-inv-list');
  const meta = document.getElementById('craft-inv-meta');
  if(!host) return;
  host.innerHTML = '';

  syncReqFromSlots();
  const inv = [...(state.inventory||[])].sort((a,b)=>{
    const ea = (a.essence||''); const eb=(b.essence||'');
    if(ea!==eb) return ea.localeCompare(eb);
    return (a.rarity||'Common').localeCompare(b.rarity||'Common');
  });

  const totalHave = inv.reduce((s,x)=>s+Number(x.qty||0),0);
  const totalUsed = reqItems.reduce((s,x)=>s+Number(x.qty||0),0);
  if(meta) meta.textContent = `${totalUsed}/5 у котлі • ${totalHave} всього`;

  if(inv.length === 0){
    const d = document.createElement('div');
    d.className = 'item muted';
    d.textContent = 'Інвентар порожній. Попроси майстра видати матеріали кодом (loot).';
    host.appendChild(d);
    return;
  }

  for(const it of inv){
    const e = it.essence;
    const r = it.rarity || 'Common';
    const have = Number(it.qty||0);
    const used = reqQty(e, r);
    const left = Math.max(0, have - used);

    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
      <div class="top">
        <div style="flex:1; min-width:0;">
          <div class="name">${escapeHtml(essenceLabel(e))} <span class="badge">${escapeHtml(r)}</span></div>
          <div class="meta">Залишилось для запиту: <span class="mono">${left}</span> • В інвентарі: <span class="mono">${have}</span></div>
        </div>
        <button class="btn small ok" ${left<=0 || cauldronIsFull() ? 'disabled' : ''}>Додати</button>
      </div>
    `;
    const btn = row.querySelector('button');
    btn.addEventListener('click', ()=>addToCauldron(e, r));
    host.appendChild(row);
  }
}

let cauldronAnim = null;
function updateCauldronAnim(){
  if(!cauldronAnim) return;
  const ess = cauldronSlots.filter(Boolean).map(s => s.essence);
  cauldronAnim.setEssences(ess);
}

function renderCraftUI(){
  syncReqFromSlots();
  const sig = craftSigFromSlots();
  if(sig !== _lastCraftSig){
    _lastCraftSig = sig;
    const code = document.getElementById('req-code');
    if(code) code.value = '';
  }
  renderCauldronSlots();
  renderCraftInvPicker();
  renderReqList();
  updateCauldronAnim();
}

function renderReqList(){
  const list = document.getElementById('req-list');
  list.innerHTML = '';
  document.getElementById('req-count').textContent = `${reqItems.length} позицій`;

  if(reqItems.length === 0){
    const d = document.createElement('div');
    d.className = 'item muted';
    d.textContent = 'Додай інгредієнти у котел (слоти) — запит сформується автоматично.';
    list.appendChild(d);
    return;
  }

  const sorted = [...reqItems].sort((a,b)=>{
    const ea = (a.essence||''); const eb=(b.essence||'');
    if(ea!==eb) return ea.localeCompare(eb);
    return (a.rarity||'Common').localeCompare(b.rarity||'Common');
  });

  for(const it of sorted){
    const e = it.essence;
    const r = it.rarity || 'Common';
    const q = Number(it.qty||0);

    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
      <div class="top">
        <div style="flex:1;">
          <div class="name">${escapeHtml(essenceLabel(e))} <span class="badge">${escapeHtml(r)}</span></div>
        </div>
        <div class="qty">${q}</div>
      </div>
      <div class="hr"></div>
      <div class="row">
        <button class="btn small danger">Видалити</button>
        <div class="spacer"></div>
        <div class="muted" style="font-size:12px;">Доступно: <span class="mono">${invQty(e,r)}</span></div>
      </div>
    `;
    row.querySelector('button').addEventListener('click', ()=>{
      removeFromCauldronByKey(e, r);
    });
    list.appendChild(row);
  }
}

function essencesToText(essences){
  if(!essences || typeof essences !== 'object') return '';
  const entries = Object.entries(essences)
    .filter(([k,v])=>k && Number(v||0) > 0)
    .sort((a,b)=>a[0].localeCompare(b[0]));
  return entries.map(([k,v])=>{
    const n = Number(v||0);
    return n > 1 ? `${k}×${n}` : k;
  }).join(', ');
}

function renderRecipes(){
  const filter = normalizeText(document.getElementById('rec-filter').value);
  const list = document.getElementById('rec-list');
  list.innerHTML = '';

  const items = [...state.recipes].filter(r => {
    const ess = essencesToText(r.essences);
    const hay = `${r.title} ${r.visual} ${ess}`.toLowerCase();
    return !filter || hay.includes(filter);
  });

  if(items.length === 0){
    const c = document.createElement('div');
    c.className = 'card muted';
    c.textContent = 'Рецептів ще нема. Вони відкриваються після крафту або через код від майстра.';
    list.appendChild(c);
    return;
  }

  for(const r of items){
    const el = document.createElement('div');
    el.className = 'item';
    const ess = essencesToText(r.essences);
    el.innerHTML = `
      <div class="top">
        <div style="flex:1;">
          <div class="name">${escapeHtml(r.title || 'Невідомий предмет')}</div>
          <div class="meta">${ess ? ('Склад: ' + escapeHtml(ess)) : 'Склад: —'}</div>
        </div>
        <button class="btn small" data-open="${r.recipe_id}">Відкрити</button>
      </div>
    `;
    el.querySelector('button').addEventListener('click', ()=>openRecipe(r.recipe_id));
    list.appendChild(el);
  }
}

function openRecipe(recipe_id){
  const r = state.recipes.find(x => x.recipe_id === recipe_id);
  if(!r) return;

  const desc = r.visual || '';
  const ess = essencesToText(r.essences);

  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.innerHTML = `
    <div class="row">
      <div style="font-weight:850; font-size:16px;">${escapeHtml(r.title || 'Невідомий предмет')}</div>
      <div class="spacer"></div>
      <button class="btn small danger" id="close-rec">Закрити</button>
    </div>

    <div class="hr"></div>
    <div class="muted" style="font-size:12px; margin-bottom:6px;">Склад (сутності)</div>
    <div class="item" style="margin-bottom:10px;">
      <div class="meta">${ess ? escapeHtml(ess) : '—'}</div>
    </div>

    <div class="muted" style="font-size:12px; margin-bottom:6px;">Опис (редагується гравцем)</div>
    <textarea id="rec-desc" class="input" style="min-height:140px; font-family:var(--mono);">${escapeHtml(desc)}</textarea>

    <div class="row" style="margin-top:10px;">
      <button class="btn ok" id="save-recipe">Зберегти</button>
      <button class="btn" id="copy-desc">Скопіювати</button>
      <div class="spacer"></div>
      <button class="btn small" id="restore-gm">Повернути «від майстра»</button>
    </div>
  `;

  const host = document.getElementById('view-recipes');
  host.prepend(wrap);
  wrap.scrollIntoView({behavior:'smooth', block:'start'});

  wrap.querySelector('#close-rec').addEventListener('click', ()=>wrap.remove());
  wrap.querySelector('#save-recipe').addEventListener('click', ()=>{
    r.visual = wrap.querySelector('#rec-desc').value || '';
    r.updated_at = nowIso();
    saveState();
    toast('Збережено');
    renderRecipes();
  });

  wrap.querySelector('#copy-desc').addEventListener('click', async()=>{
    try{ await navigator.clipboard.writeText(wrap.querySelector('#rec-desc').value || ''); toast('Скопійовано'); }
    catch(_){ toast('Не вдалось скопіювати'); }
  });

  wrap.querySelector('#restore-gm').addEventListener('click', ()=>{
    const gm = r.gm_visual || '';
    wrap.querySelector('#rec-desc').value = gm;
    toast('Вставлено оригінал');
  });
}

function renderHistory(){
  const host = document.getElementById('hist-list');
  host.innerHTML = '';
  const items = (state.history||[]).slice(0,20);
  if(items.length===0){
    const d = document.createElement('div');
    d.className='item muted';
    d.textContent='Історія порожня.';
    host.appendChild(d);
    return;
  }
  for(const h of items){
    const el = document.createElement('div');
    el.className='item';
    el.innerHTML = `
      <div class="top">
        <div style="flex:1;">
          <div class="name">${escapeHtml(h.summary||h.kind)}</div>
          <div class="meta">${escapeHtml(h.ts||'')}</div>
        </div>
        <span class="tag">${escapeHtml(h.kind||'')}</span>
      </div>
    `;
    host.appendChild(el);
  }
}

function applyPayload(payload){
  const t = payload.type;
  if(t === 'loot') {
    addInventoryDelta((payload.data && payload.data.inventory_delta) || []);
    pushHistory('loot', 'Отримано матеріали', payload.data);
  } else if(t === 'craft_result') {
    const data = payload.data || {};
    if(data.inventory_delta) addInventoryDelta(data.inventory_delta);
    const title = data.title || 'Результат крафту';
    const visual = data.visual_description || '';
    pushHistory('craft', title, data);
    if(data.discover_recipe && data.recipe_id){
      upsertRecipe({recipe_id: data.recipe_id, title: data.recipe_title || title, visual, essences: data.essences || {}});
      pushHistory('recipe', 'Відкрито рецепт (візуальний опис)', {recipe_id:data.recipe_id});
    }
  } else if(t === 'recipe_unlock') {
    const data = payload.data || {};
    if(!data.recipe_id) throw new Error('Нема recipe_id');
    upsertRecipe({recipe_id: data.recipe_id, title: data.recipe_title || 'Невідомий предмет', visual: data.visual_description || '', essences: data.essences || {}});
    pushHistory('recipe', 'Відкрито рецепт (візуальний опис)', data);
  } else {
    throw new Error('Невідомий тип пакунка: ' + t);
  }
}

function setTab(tab){
  const map = { inv: 'view-inv', craft: 'view-craft', recipes: 'view-recipes', import: 'view-import' };
  for(const k of Object.values(map)) document.getElementById(k).classList.add('hidden');
  document.getElementById(map[tab]).classList.remove('hidden');
  localStorage.setItem('nxa_ui_tab', tab);
  if(tab==='inv') renderInventory();
  if(tab==='craft') renderCraftUI();
  if(tab==='recipes') renderRecipes();
  if(tab==='import') renderHistory();
}

let state = loadState();

function wire(){
  // Навігація на телефонах іноді "губить" click (особливо у WebView). Тому слухаємо pointerup + click.
  let _lastNav = 0;
  const _navHandler = (btn) => (ev) => {
    const now = Date.now();
    if(now - _lastNav < 250) return; // захист від подвійного спрацювання
    _lastNav = now;
    try{ ev.preventDefault(); ev.stopPropagation(); }catch(_){ }
    setTab(btn.dataset.tab);
  };
  document.querySelectorAll('nav button').forEach(btn=>{
    const h = _navHandler(btn);
    btn.addEventListener('pointerup', h, {passive:false});
    btn.addEventListener('click', h);
    btn.addEventListener('touchend', h, {passive:false});
  });

  document.getElementById('inv-filter').addEventListener('input', renderInventory);
  document.getElementById('rec-filter').addEventListener('input', renderRecipes);

  // Cauldron (DM-like)
  try{
    const c = document.getElementById('cauldron-canvas');
    if(c) cauldronAnim = new CauldronAnimator(c);
  }catch(_){ /* ignore */ }
  const btnClearC = document.getElementById('btn-clear-cauldron');
  bindTap(btnClearC, clearCauldron);

  bindTap(document.getElementById('btn-reset'), async()=>{
    const ok = await confirmOverlay('Скинути інвентар, рецепти, історію та використані коди на цьому телефоні?');
    if(!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    state = loadState();
    cauldronSlots = Array(5).fill(null);
    reqItems = [];
    _lastCraftSig = '';
    renderInventory(); renderCraftUI(); renderRecipes(); renderHistory();
    toast('Скинуто');
  });

  bindTap(document.getElementById('btn-reset-recipes'), async()=>{
    const ok = await confirmOverlay('Скинути всі рецепти на цьому телефоні?');
    if(!ok) return;
    state.recipes = [];
    saveState();
    renderRecipes();
    toast('Рецепти скинуто');
  });

  bindTap(document.getElementById('btn-make-req'), async()=>{
    syncReqFromSlots();
    if(reqItems.length===0){ toast('Додай сутності'); return; }

    // Validate against inventory (aggregate)
    for(const it of reqItems){
      const e = it.essence;
      const need = Number(it.qty||0);
      const have = invQty(e, it.rarity||'Common');
      if(need > have){
        toast(`Недостатньо ${e}: потрібно ${need}, є ${have}`);
        return;
      }
    }

    const payload = { v: 1, type: 'craft_request', pack_id: shortPackId(), issued_at: epochSec(), items: reqItems.map(x=>({essence:x.essence, rarity:(x.rarity||'Common'), qty:x.qty})) };
    document.getElementById('req-code').value = await makeReqCode(payload);
    toast('Код згенеровано');
  });

  bindTap(document.getElementById('btn-copy-req'), async()=>{
    const code = document.getElementById('req-code').value.trim();
    if(!code){ toast('Нема коду'); return; }
    try{ await navigator.clipboard.writeText(code); toast('Скопійовано'); }catch(_){ toast('Не вдалось скопіювати'); }
  });

  bindTap(document.getElementById('btn-share-req'), async()=>{
    const code = document.getElementById('req-code').value.trim();
    if(!code){ toast('Нема коду'); return; }
    if(navigator.share){
      try{ await navigator.share({text: code}); }catch(_){}
    } else {
      try{ await navigator.clipboard.writeText(code); toast('Скопійовано (share недоступний)'); }catch(_){ toast('Share недоступний'); }
    }
  });

  bindTap(document.getElementById('btn-import'), async()=>{
    const code = document.getElementById('imp-code').value.trim();
    if(!code){ toast('Встав код'); return; }
    try{
      const ch = await shortCodeHash(code);
      if(state.used_code_hashes.includes(ch)) { toast('Цей код вже використано'); return; }
      const payload = await decodeDmCode(code);
      const pid = payload.pack_id || ch;
      if(state.imported_pack_ids.includes(pid)) { toast('Цей пакунок вже імпортований'); return; }

      // Mark the code as used *before* applying, so a partial apply can't be abused.
      state.used_code_hashes.push(ch);
      state.imported_pack_ids.push(pid);
      saveState();

      try{
        applyPayload(payload);
      }catch(err){
        // Roll back marks if apply failed (should be rare).
        state.used_code_hashes = state.used_code_hashes.filter(x=>x!==ch);
        state.imported_pack_ids = state.imported_pack_ids.filter(x=>x!==pid);
        saveState();
        throw err;
      }

      saveState();
      renderInventory(); renderCraftUI(); renderRecipes(); renderHistory();
      toast('Імпорт успішний');
      document.getElementById('imp-code').value='';
    }catch(err){
      console.error(err);
      toast('Помилка: ' + (err?.message || 'невідомо'));
    }
  });

  bindTap(document.getElementById('btn-paste'), async()=>{
    // Clipboard API часто блокується в офлайн/не-secure контексті (особливо в APK/WebView).
    // Тому робимо fallback через prompt, де гравець може вставити вручну.
    try{
      const t = await navigator.clipboard.readText();
      if(t) { document.getElementById('imp-code').value = t.trim(); toast('Вставлено'); }
      else toast('Буфер порожній');
    }catch(_){
      const t = prompt('Встав код сюди:', '');
      if(t && t.trim()){
        document.getElementById('imp-code').value = t.trim();
        toast('Вставлено');
      }else{
        toast('Не вдалось прочитати буфер — встав вручну в поле');
        document.getElementById('imp-code').focus();
      }
    }
  });

  bindTap(document.getElementById('btn-export'), ()=>{
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nxa_player_backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  bindTap(document.getElementById('btn-import-json'), async()=>{
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json';
    inp.onchange = async() => {
      const f = inp.files?.[0];
      if(!f) return;
      try{
        const txt = await f.text();
        const obj = JSON.parse(txt);
        if(!obj || typeof obj !== 'object') throw new Error('Не JSON');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
        state = loadState();
        renderInventory(); renderCraftUI(); renderRecipes(); renderHistory();
        toast('Імпортовано');
      }catch(err){ toast('Помилка імпорту: ' + (err?.message||'')); }
    };
    inp.click();
  });

  setTab(localStorage.getItem('nxa_ui_tab') || 'inv');
}

window.addEventListener('load', ()=>{
  wire();
  renderInventory(); renderCraftUI(); renderRecipes(); renderHistory();
});