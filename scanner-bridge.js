const STORAGE_KEY = 'kitchen-grocery-local-v1';
const byId = (id) => document.getElementById(id);

function syncScannerCategories() {
  const source = byId('categorySelect');
  const target = byId('scanCategorySelect');
  if (!source || !target) return;
  const prior = target.value;
  target.innerHTML = source.innerHTML;
  if (prior && [...target.options].some(o => o.value === prior)) target.value = prior;
  else if ([...target.options].some(o => o.value === 'cat-groceries')) target.value = 'cat-groceries';
}

function addShoppingFromScanner() {
  const name = byId('scanProductName')?.value.trim();
  if (!name) return;
  syncScannerCategories();
  byId('quickAddInput').value = name;
  if (byId('scanCategorySelect')?.value) byId('categorySelect').value = byId('scanCategorySelect').value;
  byId('quickAddForm').requestSubmit();
  const status = byId('status');
  if (status) status.textContent = `${name} added to shopping list.`;
}

function addInventoryFromScanner() {
  const name = byId('scanProductName')?.value.trim();
  if (!name) return;
  const location = (prompt('Where should I store it? Type fridge, freezer, or pantry.', 'pantry') || '').toLowerCase();
  if (!['fridge','freezer','pantry'].includes(location)) {
    const status = byId('status');
    if (status) status.textContent = 'Use fridge, freezer, or pantry.';
    return;
  }
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch {}
  if (!Array.isArray(saved.inventory)) saved.inventory = [];
  saved.inventory.push({
    id: `scan-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    quantity: 1,
    unit: '',
    location,
    barcode: byId('manualBarcode')?.value.trim() || ''
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  const status = byId('status');
  if (status) status.textContent = `${name} added to ${location}. Reopen the app to refresh inventory.`;
}

byId('addScannedShopping')?.addEventListener('click', addShoppingFromScanner);
byId('addScannedInventory')?.addEventListener('click', addInventoryFromScanner);

const observer = new MutationObserver(syncScannerCategories);
const source = byId('categorySelect');
if (source) observer.observe(source, { childList: true });
syncScannerCategories();
