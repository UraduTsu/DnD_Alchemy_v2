// NexusAlchemy Player PWA (offline-first)
// DM -> Player codes are signed with HMAC to block casual edits.
// This is not strong protection against a motivated reverse engineer.

const NXA_SECRET = "NXA-i2v7rzHkk5aGMgFTTUYigGZHskyssAgGk2QLy9ToMJY";
const CODE_PREFIX = "NXA1|";
const REQ_PREFIX  = "NXREQ|";

const STORAGE_KEY = "nxa_player_state_v1";

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
    inventory: [], // [{name, essence, rarity, qty}]
    recipes: [],   // [{recipe_id, title, gm_visual, visual, notes, created_at, updated_at}]
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
    merged.recipes = (merged.recipes || []).map(r => {
      if(!r) return r;
      if(typeof r.gm_visual !== 'string') r.gm_visual = (r.visual || '');
      if(typeof r.visual !== 'string') r.visual = (r.gm_visual || '');
      if(typeof r.notes !== 'string') r.notes = '';
      return r;
    });

    merged.imported_pack_ids = Array.isArray(merged.imported_pack_ids) ? merged.imported_pack_ids : [];
    merged.inventory = Array.isArray(merged.inventory) ? merged.inventory : [];
    merged.history = Array.isArray(merged.history) ? merged.history : [];

    return merged;
  }catch(_){ return defaultState(); }
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function invKey(it){ return `${it.name}|${it.essence||''}|${it.rarity||''}`.toLowerCase(); }

function addInventoryDelta(deltaItems){
  for(const d of (deltaItems||[])) {
    const key = invKey(d);
    let item = state.inventory.find(x => invKey(x) === key);
    if(!item){
      item = {name: d.name, essence: d.essence||'', rarity: d.rarity||'', qty: 0};
      state.inventory.push(item);
    }
    item.qty = Math.max(0, (item.qty||0) + (Number(d.qty_delta)||0));
  }
  state.inventory = state.inventory.filter(x => (x.qty||0) > 0);
  saveState();
}

function upsertRecipe({recipe_id, title, visual}){
  let r = state.recipes.find(x => x.recipe_id === recipe_id);
  const incomingVisual = (visual || '').trim();
  if(!r){
    r = {
      recipe_id,
      title: title || "Невідомий рецепт",
      gm_visual: incomingVisual,
      visual: incomingVisual, // editable by player
      notes: "",
      created_at: nowIso(),
      updated_at: nowIso()
    };
    state.recipes.unshift(r);
  }else{
    // Update title if provided
    if(title && title.trim()) r.title = title.trim();

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
  const items = [...state.inventory].sort((a,b)=> (a.essence||'').localeCompare(b.essence||'') || (a.rarity||'').localeCompare(b.rarity||'') || (a.name||'').localeCompare(b.name||''));
  const filtered = items.filter(it => {
    const hay = `${it.name} ${it.essence} ${it.rarity}`.toLowerCase();
    return !filter || hay.includes(filter);
  });
  if(filtered.length === 0){
    const c = document.createElement('div');
    c.className = 'card muted';
    c.textContent = 'Поки що інвентар порожній. Попроси майстра видати матеріали кодом (loot).';
    list.appendChild(c);
    return;
  }
  for(const it of filtered){
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="top">
        <div style="flex:1;">
          <div class="name">${escapeHtml(it.name || '—')}</div>
          <div class="meta">${escapeHtml(it.essence || '—')} • ${escapeHtml(it.rarity || '—')}</div>
        </div>
        <div class="qty">${Number(it.qty||0)}</div>
      </div>
    `;
    list.appendChild(el);
  }
}

let reqItems = [];
function renderReqList(){
  const list = document.getElementById('req-list');
  list.innerHTML = '';
  document.getElementById('req-count').textContent = `${reqItems.length} позицій`;
  if(reqItems.length === 0){
    const d = document.createElement('div');
    d.className = 'item muted';
    d.textContent = 'Додай хоча б 1 інгредієнт.';
    list.appendChild(d);
    return;
  }
  reqItems.forEach((it, idx)=>{
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="top">
        <div style="flex:1;">
          <div class="name">${escapeHtml(it.name || '—')} <span class="tag">x${it.qty}</span></div>
          <div class="meta">${escapeHtml(it.essence || '—')} • ${escapeHtml(it.rarity || '—')}</div>
        </div>
        <button class="btn small danger" data-del="${idx}">✕</button>
      </div>
    `;
    el.querySelector('button').addEventListener('click', ()=>{
      reqItems.splice(idx,1);
      renderReqList();
    });
    list.appendChild(el);
  });
}

function renderRecipes(){
  const filter = normalizeText(document.getElementById('rec-filter').value);
  const list = document.getElementById('rec-list');
  list.innerHTML = '';
  const items = [...state.recipes].filter(r => {
    const hay = `${r.title} ${r.visual} ${r.notes}`.toLowerCase();
    return !filter || hay.includes(filter);
  });
  if(items.length === 0){
    const c = document.createElement('div');
    c.className = 'card muted';
    c.textContent = 'Рецептів ще нема. Вони відкриваються через результат крафту або код від майстра.';
    list.appendChild(c);
    return;
  }
  for(const r of items){
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="top">
        <div style="flex:1;">
          <div class="name">${escapeHtml(r.title || 'Невідомий рецепт')}</div>
          <div class="meta mono">${escapeHtml(r.recipe_id)}</div>
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
  const visual = r.visual || '';
  const notes  = r.notes || '';
  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.innerHTML = `
    <div class="row">
      <div style="font-weight:850; font-size:16px;">${escapeHtml(r.title || 'Невідомий рецепт')}</div>
      <div class="spacer"></div>
      <button class="btn small danger" id="close-rec">Закрити</button>
    </div>
    <div class="hr"></div>
    <div class="muted" style="font-size:12px; margin-bottom:6px;">Опис рецепту (редагується гравцем)</div>
    <textarea id="rec-visual" class="input" style="min-height:120px; font-family:var(--mono);">${escapeHtml(visual || '')}</textarea>
    <div class="row" style="margin-top:8px;">
      <button class="btn" id="use-gm">Повернути «від майстра»</button>
      <div class="spacer"></div>
      <button class="btn" id="copy-visual">Скопіювати опис</button>
    </div>
    <div class="hr"></div>
    <div class="muted" style="font-size:12px; margin-bottom:6px;">Мої нотатки / ефекти (додатково)</div>
    <textarea id="rec-notes" class="input" style="min-height:120px; font-family:var(--mono);">${escapeHtml(notes)}</textarea>
    <div class="row" style="margin-top:10px;">
      <button class="btn ok" id="save-recipe">Зберегти</button>
      <div class="spacer"></div>
      <button class="btn small" id="show-gm">Показати оригінал</button>
    </div>
    <div class="item mono hidden" id="gm-box" style="white-space:pre-wrap; margin-top:10px;"></div>
  `;
  const host = document.getElementById('view-recipes');
  host.prepend(wrap);
  wrap.scrollIntoView({behavior:'smooth', block:'start'});
  wrap.querySelector('#close-rec').addEventListener('click', ()=>wrap.remove());
  wrap.querySelector('#save-recipe').addEventListener('click', ()=>{
    r.visual = wrap.querySelector('#rec-visual').value || '';
    r.notes = wrap.querySelector('#rec-notes').value || '';
    r.updated_at = nowIso();
    saveState();
    toast('Збережено');
  });
  wrap.querySelector('#copy-visual').addEventListener('click', async()=>{
    try{ await navigator.clipboard.writeText(wrap.querySelector('#rec-visual').value || ''); toast('Скопійовано'); }catch(_){ toast('Не вдалось скопіювати'); }
  });

  wrap.querySelector('#use-gm').addEventListener('click', ()=>{
    const gm = r.gm_visual || '';
    wrap.querySelector('#rec-visual').value = gm;
    toast('Вставлено оригінал');
  });

  wrap.querySelector('#show-gm').addEventListener('click', ()=>{
    const box = wrap.querySelector('#gm-box');
    box.textContent = (r.gm_visual || '(порожньо)');
    box.classList.toggle('hidden');
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
      upsertRecipe({recipe_id: data.recipe_id, title: data.recipe_title || title, visual});
      pushHistory('recipe', 'Відкрито рецепт (візуальний опис)', {recipe_id:data.recipe_id});
    }
  } else if(t === 'recipe_unlock') {
    const data = payload.data || {};
    if(!data.recipe_id) throw new Error('Нема recipe_id');
    upsertRecipe({recipe_id: data.recipe_id, title: data.recipe_title || 'Невідомий рецепт', visual: data.visual_description || ''});
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
  document.querySelectorAll('nav button').forEach(btn=>{
    btn.addEventListener('click', ()=>setTab(btn.dataset.tab));
  });

  document.getElementById('inv-filter').addEventListener('input', renderInventory);
  document.getElementById('rec-filter').addEventListener('input', renderRecipes);

  document.getElementById('btn-reset').addEventListener('click', ()=>{
    if(confirm('Скинути інвентар, рецепти та історію на цьому телефоні?')){
      localStorage.removeItem(STORAGE_KEY);
      state = loadState();
      reqItems = [];
      renderInventory(); renderReqList(); renderRecipes(); renderHistory();
      toast('Скинуто');
    }
  });

  document.getElementById('btn-add-req').addEventListener('click', ()=>{
    const name = document.getElementById('cr-name').value.trim();
    const qty  = Math.max(1, Number(document.getElementById('cr-qty').value||1));
    const essence = document.getElementById('cr-ess').value;
    const rarity  = document.getElementById('cr-rar').value;
    if(!name){ toast('Вкажи назву'); return; }
    reqItems.push({name, qty, essence, rarity});
    document.getElementById('cr-name').value='';
    document.getElementById('cr-qty').value='1';
    document.getElementById('cr-ess').value='';
    document.getElementById('cr-rar').value='';
    renderReqList();
  });

  document.getElementById('btn-clear-req').addEventListener('click', ()=>{
    reqItems = [];
    renderReqList();
  });

  document.getElementById('btn-make-req').addEventListener('click', ()=>{
    if(reqItems.length===0){ toast('Додай інгредієнти'); return; }
    const payload = { v: 1, type: 'craft_request', pack_id: crypto.randomUUID(), issued_at: nowIso(), items: reqItems };
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
    try{
      const t = await navigator.clipboard.readText();
      if(t) { document.getElementById('imp-code').value = t.trim(); toast('Вставлено'); }
      else toast('Буфер порожній');
    }catch(_){ toast('Не вдалось прочитати буфер'); }
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
