// NexusAlchemy Player PWA (offline-first)
// DM -> Player codes are signed with HMAC to block casual edits.
// This is not strong protection against a motivated reverse engineer.

const NXA_SECRET = "NXA-i2v7rzHkk5aGMgFTTUYigGZHskyssAgGk2QLy9ToMJY";
const CODE_PREFIX = "NXA1|";
const REQ_PREFIX  = "NXREQ|";

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

function essenceLabel(e){
  const m = ESS_META[e];
  // Show only the essence code to avoid labels like "Магія(Aether)".
  if(m && m.emoji) return `${m.emoji} ${e}`;
  return e || "—";
}


function nowIso(){ return new Date().toISOString(); }
function toast(msg){
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 2200);
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

async function hmacSign(payloadBytes){
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(NXA_SECRET), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, payloadBytes);
  return new Uint8Array(sig);
}

async function decodeDmCode(code){
  code = (code||'').trim();
  if(!code.startsWith(CODE_PREFIX)) throw new Error("Це не код NXA1");
  const parts = code.split("|");
  if(parts.length !== 3) throw new Error("Невірний формат коду");
  const payloadBytes = base64urlDecode(parts[1]);
  const sigBytes = base64urlDecode(parts[2]);
  const goodSig = await hmacSign(payloadBytes);
  if(sigBytes.length !== goodSig.length) throw new Error("Підпис не збігається");
  for(let i=0;i<sigBytes.length;i++) if(sigBytes[i] !== goodSig[i]) throw new Error("Підпис не збігається");
  const payloadStr = new TextDecoder().decode(payloadBytes);
  return JSON.parse(payloadStr);
}

function makeReqCode(reqObj){
  const enc = new TextEncoder();
  const payloadStr = JSON.stringify(reqObj);
  const payloadBytes = enc.encode(payloadStr);
  return REQ_PREFIX + base64urlEncode(payloadBytes);
}

function defaultState(){
  return {
    v: 1,
    created_at: nowIso(),
    imported_pack_ids: [],
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


function invKey(it){ return `${(it.essence||'').toLowerCase()}||${(it.rarity||'Common').toLowerCase()}`; }`; }

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

function updateCraftAvail(){
  const e = document.getElementById('cr-ess')?.value || '';
  const r = document.getElementById('cr-rarity')?.value || 'Common';
  const avail = invQty(e, r);
  const used = reqQty(e, r);
  const left = Math.max(0, avail - used);
  const el = document.getElementById('cr-avail');
  if(el) el.textContent = String(left);
}

let reqItems = [];
function renderReqList(){
  const list = document.getElementById('req-list');
  list.innerHTML = '';
  document.getElementById('req-count').textContent = `${reqItems.length} позицій`;

  if(reqItems.length === 0){
    const d = document.createElement('div');
    d.className = 'item muted';
    d.textContent = 'Додай сутності в запит. Програма перевіряє, чи є вони в інвентарі.';
    list.appendChild(d);
    updateCraftAvail();
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
      reqItems = reqItems.filter(x => !((x.essence||'')===e && (x.rarity||'Common')===r));
      renderReqList();
    });
    list.appendChild(row);
  }
  updateCraftAvail();
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
  if(tab==='craft') renderReqList();
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

  document.getElementById('cr-ess').addEventListener('change', updateCraftAvail);
  document.getElementById('cr-rarity').addEventListener('change', updateCraftAvail);
  document.getElementById('cr-qty').addEventListener('input', updateCraftAvail);

  document.getElementById('btn-reset').addEventListener('click', ()=>{
    if(confirm('Скинути інвентар, рецепти та історію на цьому телефоні?')){
      localStorage.removeItem(STORAGE_KEY);
      state = loadState();
      reqItems = [];
      renderInventory(); renderReqList(); renderRecipes(); renderHistory();
      toast('Скинуто');
    }
  });

  document.getElementById('btn-reset-recipes').addEventListener('click', ()=>{
    if(confirm('Скинути всі рецепти на цьому телефоні?')){
      state.recipes = [];
      saveState();
      renderRecipes();
      toast('Рецепти скинуто');
    }
  });

  document.getElementById('btn-add-req').addEventListener('click', ()=>{
    const essence = document.getElementById('cr-ess').value;
    const rarity = document.getElementById('cr-rarity').value || 'Common';
    const qty  = Math.max(1, Number(document.getElementById('cr-qty').value||1));
    if(!essence){ toast('Обери сутність'); return; }

    const avail = invQty(essence, rarity);
    const already = reqQty(essence, rarity);

    const left = Math.max(0, avail - already);

    if(qty > left){
      toast(`Недостатньо матеріалів: доступно ${left}`);
      return;
    }

    // Merge same (essence + rarity) into one row
    const keyE = essence.toLowerCase();
    const keyR = (rarity||'Common').toLowerCase();
    const existing = reqItems.find(x => (x.essence||'').toLowerCase() === keyE && (x.rarity||'Common').toLowerCase() === keyR);
    if(existing) existing.qty = Number(existing.qty||0) + qty;
    else reqItems.push({essence, rarity, qty});

    document.getElementById('cr-qty').value='1';
    renderReqList();
  });

  document.getElementById('btn-clear-req').addEventListener('click', ()=>{
    reqItems = [];
    renderReqList();
  });

  document.getElementById('btn-make-req').addEventListener('click', ()=>{
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

    const payload = { v: 1, type: 'craft_request', pack_id: crypto.randomUUID(), issued_at: nowIso(), items: reqItems.map(x=>({essence:x.essence, rarity:(x.rarity||'Common'), qty:x.qty})) };
    document.getElementById('req-code').value = makeReqCode(payload);
    toast('Код згенеровано');
  });

  document.getElementById('btn-copy-req').addEventListener('click', async()=>{
    const code = document.getElementById('req-code').value.trim();
    if(!code){ toast('Нема коду'); return; }
    try{ await navigator.clipboard.writeText(code); toast('Скопійовано'); }catch(_){ toast('Не вдалось скопіювати'); }
  });

  document.getElementById('btn-share-req').addEventListener('click', async()=>{
    const code = document.getElementById('req-code').value.trim();
    if(!code){ toast('Нема коду'); return; }
    if(navigator.share){
      try{ await navigator.share({text: code}); }catch(_){}
    } else {
      try{ await navigator.clipboard.writeText(code); toast('Скопійовано (share недоступний)'); }catch(_){ toast('Share недоступний'); }
    }
  });

  document.getElementById('btn-import').addEventListener('click', async()=>{
    const code = document.getElementById('imp-code').value.trim();
    if(!code){ toast('Встав код'); return; }
    try{
      const payload = await decodeDmCode(code);
      const pid = payload.pack_id;
      if(!pid) throw new Error('Нема pack_id');
      if(state.imported_pack_ids.includes(pid)) { toast('Цей пакунок вже імпортований'); return; }
      applyPayload(payload);
      state.imported_pack_ids.push(pid);
      saveState();
      renderInventory(); renderRecipes(); renderHistory();
      toast('Імпорт успішний');
      document.getElementById('imp-code').value='';
    }catch(err){
      console.error(err);
      toast('Помилка: ' + (err?.message || 'невідомо'));
    }
  });

  document.getElementById('btn-paste').addEventListener('click', async()=>{
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

  document.getElementById('btn-export').addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nxa_player_backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('btn-import-json').addEventListener('click', async()=>{
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
        renderInventory(); renderRecipes(); renderHistory();
        toast('Імпортовано');
      }catch(err){ toast('Помилка імпорту: ' + (err?.message||'')); }
    };
    inp.click();
  });

  setTab(localStorage.getItem('nxa_ui_tab') || 'inv');
}

window.addEventListener('load', ()=>{
  wire();
  renderInventory(); renderReqList(); renderRecipes(); renderHistory();
});