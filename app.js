const DEFAULT_CATEGORIES = [
  { id: 'cat-groceries', name: 'Groceries', icon: '🛒', sort_order: 10 },
  { id: 'cat-toiletries', name: 'Toiletries', icon: '🧴', sort_order: 20 },
  { id: 'cat-cleaning', name: 'Cleaning Supplies', icon: '🧽', sort_order: 30 },
  { id: 'cat-paper', name: 'Paper Goods', icon: '🧻', sort_order: 40 },
  { id: 'cat-household', name: 'Household', icon: '🏠', sort_order: 50 },
  { id: 'cat-other', name: 'Other', icon: '📦', sort_order: 90 }
];

const STORAGE_KEY = 'kitchen-grocery-local-v1';

const seedState = () => ({
  shopping: [],
  categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
  activeCategory: 'all',
  inventory: [],
  recipes: [],
  family: []
});

let state = seedState();

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function setStatus(text){ statusEl.textContent = text; }
function escapeHtml(s=''){ return String(s).replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c])); }
function catById(id){ return state.categories.find(c=>c.id===id); }
function makeId(){ return (crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`); }

function saveLocal(){
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      shopping: state.shopping,
      categories: state.categories,
      inventory: state.inventory,
      recipes: state.recipes,
      family: state.family
    }));
  } catch (e) {
    setStatus('Could not save on this phone. Storage may be full.');
  }
}

function loadLocal(){
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if(saved){
      state = { ...seedState(), ...saved, activeCategory: 'all' };
      if(!Array.isArray(state.categories) || !state.categories.length) state.categories = DEFAULT_CATEGORIES.map(c=>({...c}));
    }
  } catch (e) {
    state = seedState();
  }
}

function switchTab(name){
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id===`tab-${name}`));
}
document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

function renderShopping(){
  const categorySelect = $('categorySelect');
  const prior = categorySelect.value;
  categorySelect.innerHTML = state.categories.map(c=>`<option value="${c.id}">${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</option>`).join('');
  if(prior && state.categories.some(c=>c.id===prior)) categorySelect.value = prior;
  else if(state.categories.length) categorySelect.value = state.categories[0].id;

  const counts = Object.fromEntries(state.categories.map(c=>[c.id,0]));
  state.shopping.forEach(i=>{ if(i.category_id && counts[i.category_id]!==undefined) counts[i.category_id]++; });
  const uncategorizedCount = state.shopping.filter(i=>!i.category_id).length;

  $('categoryFilters').innerHTML = [
    `<button class="category-chip ${state.activeCategory==='all'?'active':''}" data-filter-cat="all">All <span>${state.shopping.length}</span></button>`,
    ...state.categories.map(c=>`<button class="category-chip ${state.activeCategory===c.id?'active':''}" data-filter-cat="${c.id}">${escapeHtml(c.icon || '')} ${escapeHtml(c.name)} <span>${counts[c.id] || 0}</span></button>`),
    uncategorizedCount ? `<button class="category-chip ${state.activeCategory==='uncategorized'?'active':''}" data-filter-cat="uncategorized">Uncategorized <span>${uncategorizedCount}</span></button>` : ''
  ].join('');

  let catsToShow = state.categories;
  if(state.activeCategory !== 'all' && state.activeCategory !== 'uncategorized') catsToShow = state.categories.filter(c=>c.id===state.activeCategory);
  if(state.activeCategory === 'uncategorized') catsToShow = [];

  const groupHtml = catsToShow.map(c=>{
    const items = state.shopping.filter(i=>i.category_id===c.id);
    if(!items.length && state.activeCategory==='all') return '';
    return `<section class="shopping-group">
      <div class="shopping-group-title"><h3>${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</h3><span>${items.length}</span></div>
      <ul class="item-list">${items.length ? items.map(shoppingItemHtml).join('') : '<li><span>Nothing needed here.</span></li>'}</ul>
    </section>`;
  }).join('');

  const uncategorizedItems = state.shopping.filter(i=>!i.category_id);
  const uncategorizedHtml = (state.activeCategory==='all' || state.activeCategory==='uncategorized') && uncategorizedItems.length
    ? `<section class="shopping-group"><div class="shopping-group-title"><h3>Uncategorized</h3><span>${uncategorizedItems.length}</span></div><ul class="item-list">${uncategorizedItems.map(shoppingItemHtml).join('')}</ul></section>`
    : '';

  $('shoppingGroups').innerHTML = groupHtml + uncategorizedHtml || '<div class="empty-state">Your shopping list is empty.</div>';

  document.querySelectorAll('[data-filter-cat]').forEach(btn=>btn.onclick=()=>{
    state.activeCategory = btn.dataset.filterCat;
    renderShopping();
    bindDynamicButtons();
  });
}

function shoppingItemHtml(i){
  const c = catById(i.category_id);
  return `<li>
    <span><strong>${escapeHtml(i.item_name)}</strong>${i.quantity!==1?` × ${i.quantity}`:''}${c?`<small>${escapeHtml(c.icon||'')} ${escapeHtml(c.name)}</small>`:''}</span>
    <div class="item-actions"><button data-move="${i.id}">Move</button><button data-buy="${i.id}">Bought</button></div>
  </li>`;
}

function render(){
  renderShopping();
  ['fridge','freezer','pantry'].forEach(loc=>{
    const list = state.inventory.filter(i=>i.location===loc);
    $(`${loc}List`).innerHTML = list.length ? list.map(i=>`<li><span>${escapeHtml(i.name || 'Item')}</span><span>${i.quantity || 1}${i.unit?` ${escapeHtml(i.unit)}`:''}</span></li>`).join('') : '<li><span>Empty</span></li>';
  });
  $('recipeCards').innerHTML = state.recipes.length ? state.recipes.map(r=>`<article class="card"><h3>${escapeHtml(r.title)}</h3><p>${r.video_url?'🎥 Video linked':'No video yet'}</p></article>`).join('') : '<article class="card"><h3>No recipes yet</h3><p>Recipe import is coming next.</p></article>';
  $('familyCards').innerHTML = state.family.length ? state.family.map(m=>`<article class="card"><h3>${escapeHtml(m.display_name)}</h3><p>${escapeHtml(m.role || '')}</p></article>`).join('') : '<article class="card"><h3>No family members yet</h3></article>';
  renderCalendar();
  bindDynamicButtons();
}

function renderCalendar(){
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const today = new Date();
  $('mealCalendar').innerHTML = days.map((d,idx)=>{
    const date = new Date(today); date.setDate(today.getDate() - today.getDay() + idx);
    return `<div class="calendar-day"><strong>${d} ${date.getMonth()+1}/${date.getDate()}</strong><span>Tap “Plan meal” to add dinner.</span></div>`;
  }).join('');
}

function bindDynamicButtons(){
  document.querySelectorAll('[data-buy]').forEach(btn=>btn.onclick=()=>{
    const item = state.shopping.find(i=>i.id===btn.dataset.buy); if(!item) return;
    state.shopping = state.shopping.filter(i=>i.id!==item.id);
    saveLocal(); render(); setStatus(`${item.item_name} marked bought.`);
  });

  document.querySelectorAll('[data-move]').forEach(btn=>btn.onclick=()=>{
    const item = state.shopping.find(i=>i.id===btn.dataset.move); if(!item) return;
    const options = state.categories.map((c,idx)=>`${idx+1}. ${c.name}`).join('\n');
    const answer = prompt(`Move “${item.item_name}” to which category?\n\n${options}\n\nEnter the number:`);
    if(!answer) return;
    const category = state.categories[Number(answer)-1];
    if(!category){ setStatus('That category was not found.'); return; }
    item.category_id=category.id; saveLocal(); render(); setStatus(`Moved to ${category.name}.`);
  });
}

$('quickAddForm').addEventListener('submit', e=>{
  e.preventDefault();
  const input = $('quickAddInput');
  const name = input.value.trim();
  const categoryId = $('categorySelect').value || null;
  if(!name) return;
  state.shopping.push({id:makeId(),item_name:name,quantity:1,category_id:categoryId});
  input.value=''; saveLocal(); render(); setStatus(`${name} added.`);
});

const categoryDialog = $('categoryDialog');
$('addCategoryBtn').onclick=()=>categoryDialog.showModal();
$('cancelCategory').onclick=()=>categoryDialog.close();
$('categoryForm').addEventListener('submit', e=>{
  e.preventDefault();
  const name = $('categoryNameInput').value.trim();
  const icon = $('categoryIconInput').value.trim();
  if(!name) return;
  state.categories.push({id:makeId(),name,icon,sort_order:state.categories.length*10+100});
  $('categoryNameInput').value=''; $('categoryIconInput').value=''; categoryDialog.close(); saveLocal(); render(); setStatus(`${name} category added.`);
});

$('addInventoryItem').onclick=()=>{
  const name = prompt('Item name?'); if(!name) return;
  const location = (prompt('Where is it? Type fridge, freezer, or pantry.', 'fridge') || '').toLowerCase();
  if(!['fridge','freezer','pantry'].includes(location)){ setStatus('Use fridge, freezer, or pantry.'); return; }
  state.inventory.push({id:makeId(),name:name.trim(),quantity:1,unit:'',location});
  saveLocal(); render(); setStatus(`${name.trim()} added to ${location}.`);
};
$('addRecipe').onclick=()=>setStatus('Recipe import is next: paste a YouTube or recipe URL.');
$('planMeal').onclick=()=>setStatus('Meal planner editor is next in the build.');
$('addFamilyMember').onclick=()=>{
  const name = prompt('Person name?'); if(!name) return;
  state.family.push({id:makeId(),display_name:name.trim(),role:'household member'});
  saveLocal(); render(); setStatus(`${name.trim()} added.`);
};

$('voiceBtn').onclick=()=>{
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SpeechRecognition){ setStatus('Voice recognition is not supported in this browser yet.'); return; }
  const rec = new SpeechRecognition(); rec.lang='en-US'; rec.interimResults=false;
  setStatus('Listening…');
  rec.onresult=e=>{
    const phrase=e.results[0][0].transcript.trim(); setStatus(`Heard: “${phrase}”`);
    const categorized = phrase.match(/add\s+(.+?)\s+to\s+(?:my\s+)?(.+?)(?:\s+(?:list|category))?$/i);
    if(categorized){
      const itemName = categorized[1].trim();
      const requestedCat = categorized[2].trim().toLowerCase();
      const cat = state.categories.find(c=>c.name.toLowerCase()===requestedCat || c.name.toLowerCase().includes(requestedCat));
      $('quickAddInput').value=itemName;
      if(cat) $('categorySelect').value=cat.id;
      $('quickAddForm').requestSubmit();
      return;
    }
    const addMatch=phrase.match(/^(?:hey\s+\w+[,.]?\s*)?add\s+(.+?)(?:\s+to\s+(?:the\s+)?(?:grocery|shopping)\s+list)?$/i);
    if(addMatch){ $('quickAddInput').value=addMatch[1]; $('quickAddForm').requestSubmit(); return; }
    if(/show.*(?:grocery|shopping).*list/i.test(phrase)){ switchTab('list'); return; }
    if(/show.*inventory/i.test(phrase)){ switchTab('inventory'); return; }
    if(/show.*recipes/i.test(phrase)){ switchTab('recipes'); return; }
    setStatus(`I heard “${phrase}”. That command isn't wired yet.`);
  };
  rec.onerror=()=>setStatus('Voice command ended.');
  rec.start();
};

(function init(){
  loadLocal();
  render();
  setStatus('Ready — no sign-in required. Saved on this phone for now.');
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
