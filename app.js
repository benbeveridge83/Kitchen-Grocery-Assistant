import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://ucpfgcobgnizuzdqftbx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_gbMManqnyeTw2JGd7AHECA_7GcGwvo8';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const DEFAULT_CATEGORIES = [
  { name: 'Groceries', icon: '🛒', sort_order: 10 },
  { name: 'Toiletries', icon: '🧴', sort_order: 20 },
  { name: 'Cleaning Supplies', icon: '🧽', sort_order: 30 },
  { name: 'Paper Goods', icon: '🧻', sort_order: 40 },
  { name: 'Household', icon: '🏠', sort_order: 50 },
  { name: 'Other', icon: '📦', sort_order: 90 }
];

const state = {
  session: null,
  householdId: null,
  shopping: [],
  categories: [],
  activeCategory: 'all',
  inventory: [],
  recipes: [],
  family: []
};

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function setStatus(text){ statusEl.textContent = text; }
function escapeHtml(s=''){ return String(s).replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c])); }
function catById(id){ return state.categories.find(c=>c.id===id); }

function switchTab(name){
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id===`tab-${name}`));
}
document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

async function ensureHousehold(){
  const { data: memberships, error } = await supabase
    .from('household_members')
    .select('household_id,display_name,role')
    .limit(1);
  if(error) throw error;
  if(memberships?.length){ state.householdId = memberships[0].household_id; return; }
  const name = state.session?.user?.email?.split('@')[0] || 'Ben';
  const { data, error: rpcError } = await supabase.rpc('create_household_for_current_user', {
    household_name: 'Home', member_name: name
  });
  if(rpcError) throw rpcError;
  state.householdId = data;
}

async function ensureDefaultCategories(){
  const { data, error } = await supabase
    .from('shopping_categories')
    .select('*')
    .eq('household_id', state.householdId)
    .order('sort_order');
  if(error) throw error;
  if(data?.length){ state.categories = data; return; }
  const rows = DEFAULT_CATEGORIES.map(c=>({ ...c, household_id: state.householdId }));
  const { data: inserted, error: insertError } = await supabase
    .from('shopping_categories')
    .insert(rows)
    .select('*');
  if(insertError) throw insertError;
  state.categories = inserted || [];
}

async function loadAll(){
  if(!state.session){ renderDemo(); return; }
  await ensureHousehold();
  await ensureDefaultCategories();
  const h = state.householdId;
  const [shopping, inventory, recipes, family, categories] = await Promise.all([
    supabase.from('shopping_list').select('*').eq('household_id',h).in('status',['needed','in_cart']).order('created_at'),
    supabase.from('inventory').select('*,items(name,brand)').eq('household_id',h).gt('quantity',0).order('location'),
    supabase.from('recipes').select('*').eq('household_id',h).order('title'),
    supabase.from('household_members').select('*').eq('household_id',h).order('created_at'),
    supabase.from('shopping_categories').select('*').eq('household_id',h).order('sort_order').order('name')
  ]);
  for(const r of [shopping,inventory,recipes,family,categories]) if(r.error) throw r.error;
  state.shopping = shopping.data || [];
  state.inventory = inventory.data || [];
  state.recipes = recipes.data || [];
  state.family = family.data || [];
  state.categories = categories.data || [];
  render();
}

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
    $(`${loc}List`).innerHTML = list.length ? list.map(i=>`<li><span>${escapeHtml(i.items?.name || 'Item')}</span><span>${i.quantity}${i.unit?` ${escapeHtml(i.unit)}`:''}</span></li>`).join('') : '<li><span>Empty</span></li>';
  });
  $('recipeCards').innerHTML = state.recipes.length ? state.recipes.map(r=>`<article class="card"><h3>${escapeHtml(r.title)}</h3><p>${r.video_url?'🎥 Video linked':'No video yet'}</p><button data-cook="${r.id}">Cook this</button></article>`).join('') : '<article class="card"><h3>No recipes yet</h3><p>Add one from a YouTube link or enter it manually.</p></article>';
  $('familyCards').innerHTML = state.family.length ? state.family.map(m=>`<article class="card"><h3>${escapeHtml(m.display_name)}</h3><p>${escapeHtml(m.role)}</p><p>Preferences will appear here.</p></article>`).join('') : '<article class="card"><h3>No family members yet</h3></article>';
  renderCalendar();
  bindDynamicButtons();
}

function renderDemo(){
  state.categories = DEFAULT_CATEGORIES.map((c,idx)=>({ ...c, id:`demo-cat-${idx}` }));
  state.shopping = [
    {id:'demo1',item_name:'Milk',quantity:1,category_id:'demo-cat-0'},
    {id:'demo2',item_name:'Vanilla ice cream',quantity:1,category_id:'demo-cat-0'},
    {id:'demo3',item_name:'Toothpaste',quantity:1,category_id:'demo-cat-1'},
    {id:'demo4',item_name:'Dishwasher tablets',quantity:1,category_id:'demo-cat-2'}
  ];
  state.inventory = [
    {location:'fridge',quantity:1,unit:'carton',items:{name:'Eggs'}},
    {location:'freezer',quantity:2,unit:'bags',items:{name:'Frozen vegetables'}},
    {location:'pantry',quantity:1,unit:'jar',items:{name:'Peanut butter'}}
  ];
  state.recipes = [{id:'demo',title:'Weeknight Pasta',video_url:'https://youtube.com'}];
  state.family = [{display_name:'Ben',role:'owner'},{display_name:'Carter',role:'child'},{display_name:'Parker',role:'child'}];
  render();
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
  document.querySelectorAll('[data-buy]').forEach(btn=>btn.onclick=async()=>{
    if(!state.session){ setStatus('Demo mode — sign in to save changes.'); return; }
    const item = state.shopping.find(i=>i.id===btn.dataset.buy); if(!item) return;
    const { error } = await supabase.from('shopping_list').update({status:'purchased'}).eq('id',item.id);
    if(error){ setStatus(error.message); return; }
    setStatus(`${item.item_name} marked purchased.`); await loadAll();
  });

  document.querySelectorAll('[data-move]').forEach(btn=>btn.onclick=async()=>{
    const item = state.shopping.find(i=>i.id===btn.dataset.move); if(!item) return;
    const options = state.categories.map((c,idx)=>`${idx+1}. ${c.name}`).join('\n');
    const answer = prompt(`Move “${item.item_name}” to which category?\n\n${options}\n\nEnter the number:`);
    if(!answer) return;
    const category = state.categories[Number(answer)-1];
    if(!category){ setStatus('That category was not found.'); return; }
    if(!state.session){ item.category_id=category.id; render(); setStatus(`Moved to ${category.name} in demo mode.`); return; }
    const { error } = await supabase.from('shopping_list').update({category_id:category.id}).eq('id',item.id);
    if(error){ setStatus(error.message); return; }
    setStatus(`${item.item_name} moved to ${category.name}.`); await loadAll();
  });
}

$('quickAddForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const input = $('quickAddInput');
  const name = input.value.trim();
  const categoryId = $('categorySelect').value || null;
  if(!name) return;
  if(!state.session){
    state.shopping.push({id:crypto.randomUUID(),item_name:name,quantity:1,category_id:categoryId});
    input.value=''; render(); setStatus('Added in demo mode. Sign in to save.'); return;
  }
  const { error } = await supabase.from('shopping_list').insert({household_id:state.householdId,item_name:name,quantity:1,category_id:categoryId});
  if(error){ setStatus(error.message); return; }
  input.value=''; setStatus(`${name} added.`); await loadAll();
});

const categoryDialog = $('categoryDialog');
$('addCategoryBtn').onclick=()=>categoryDialog.showModal();
$('cancelCategory').onclick=()=>categoryDialog.close();
$('categoryForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const name = $('categoryNameInput').value.trim();
  const icon = $('categoryIconInput').value.trim();
  if(!name) return;
  if(!state.session){
    state.categories.push({id:crypto.randomUUID(),name,icon,sort_order:state.categories.length*10+100});
    $('categoryNameInput').value=''; $('categoryIconInput').value=''; categoryDialog.close(); render(); setStatus(`${name} added in demo mode.`); return;
  }
  const { error } = await supabase.from('shopping_categories').insert({household_id:state.householdId,name,icon,sort_order:state.categories.length*10+100});
  if(error){ setStatus(error.message); return; }
  $('categoryNameInput').value=''; $('categoryIconInput').value=''; categoryDialog.close(); setStatus(`${name} category added.`); await loadAll();
});

$('addInventoryItem').onclick=()=>setStatus('Inventory add form is next in the build.');
$('addRecipe').onclick=()=>setStatus('Recipe import is next: paste a YouTube or recipe URL.');
$('planMeal').onclick=()=>setStatus('Meal planner editor is next in the build.');
$('addFamilyMember').onclick=()=>setStatus('Family profile editor is next in the build.');

$('voiceBtn').onclick=()=>{
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SpeechRecognition){ setStatus('Voice recognition is not supported in this browser yet.'); return; }
  const rec = new SpeechRecognition(); rec.lang='en-US'; rec.interimResults=false;
  setStatus('Listening…');
  rec.onresult=async e=>{
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

const authDialog = $('authDialog');
$('authForm').addEventListener('submit', async e=>{
  if(e.submitter?.value==='cancel') return;
  e.preventDefault();
  const email=$('emailInput').value.trim(); if(!email) return;
  const { error }=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin}});
  if(error){ setStatus(error.message); return; }
  authDialog.close(); setStatus(`Sign-in link sent to ${email}.`);
});

supabase.auth.onAuthStateChange(async(_event,session)=>{
  state.session=session;
  if(session){ setStatus(`Signed in as ${session.user.email}`); try{ await loadAll(); }catch(e){ setStatus(e.message); } }
});

(async function init(){
  const { data:{ session } } = await supabase.auth.getSession();
  state.session=session;
  if(session){ setStatus(`Signed in as ${session.user.email}`); try{ await loadAll(); }catch(e){ setStatus(e.message); } }
  else { renderDemo(); setTimeout(()=>authDialog.showModal(),450); }
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
