import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://ucpfgcobgnizuzdqftbx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_gbMManqnyeTw2JGd7AHECA_7GcGwvo8';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const state = {
  session: null,
  householdId: null,
  shopping: [],
  inventory: [],
  recipes: [],
  family: []
};

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function setStatus(text){ statusEl.textContent = text; }
function escapeHtml(s=''){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

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

async function loadAll(){
  if(!state.session){ renderDemo(); return; }
  await ensureHousehold();
  const h = state.householdId;
  const [shopping, inventory, recipes, family] = await Promise.all([
    supabase.from('shopping_list').select('*').eq('household_id',h).in('status',['needed','in_cart']).order('created_at'),
    supabase.from('inventory').select('*,items(name,brand)').eq('household_id',h).gt('quantity',0).order('location'),
    supabase.from('recipes').select('*').eq('household_id',h).order('title'),
    supabase.from('household_members').select('*').eq('household_id',h).order('created_at')
  ]);
  for(const r of [shopping,inventory,recipes,family]) if(r.error) throw r.error;
  state.shopping = shopping.data || [];
  state.inventory = inventory.data || [];
  state.recipes = recipes.data || [];
  state.family = family.data || [];
  render();
}

function render(){
  $('shoppingList').innerHTML = state.shopping.length ? state.shopping.map(i=>`<li><span>${escapeHtml(i.item_name)}${i.quantity!==1?` × ${i.quantity}`:''}</span><button data-buy="${i.id}">Bought</button></li>`).join('') : '<li><span>Nothing on the list.</span></li>';
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
  state.shopping = [{id:'demo1',item_name:'Milk',quantity:1},{id:'demo2',item_name:'Vanilla ice cream',quantity:1}];
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
}

$('quickAddForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const input = $('quickAddInput'); const name = input.value.trim(); if(!name) return;
  if(!state.session){ state.shopping.push({id:crypto.randomUUID(),item_name:name,quantity:1}); input.value=''; render(); setStatus('Added in demo mode. Sign in to save.'); return; }
  const { error } = await supabase.from('shopping_list').insert({household_id:state.householdId,item_name:name,quantity:1});
  if(error){ setStatus(error.message); return; }
  input.value=''; setStatus(`${name} added.`); await loadAll();
});

$('addListItem').onclick=()=>{$('quickAddInput').focus();};
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
