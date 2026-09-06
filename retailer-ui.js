const byId = (id) => document.getElementById(id);
const setStatus = (text) => { const el = byId('status'); if (el) el.textContent = text; };

function money(value) {
  return value == null || Number.isNaN(Number(value)) ? '' : `$${Number(value).toFixed(2)}`;
}

function buildKrogerPanel() {
  const shell = document.querySelector('#tab-scan .scanner-shell');
  if (!shell || byId('krogerPanel')) return;
  const panel = document.createElement('section');
  panel.id = 'krogerPanel';
  panel.className = 'retailer-panel';
  panel.innerHTML = `
    <div class="retailer-heading">
      <div>
        <h3>Kroger</h3>
        <p id="krogerConnectionText">Checking connection…</p>
      </div>
      <button id="krogerConnectBtn">Connect Kroger</button>
    </div>
    <div class="retailer-store-row">
      <input id="krogerZip" inputmode="numeric" placeholder="ZIP code for your Kroger" />
      <button id="krogerFindStores">Find stores</button>
    </div>
    <div id="krogerStoreResults"></div>
    <div id="krogerSelectedStore" class="retailer-selected-store"></div>
    <button id="krogerAddCart" disabled>Add scanned item to Kroger cart</button>
  `;
  shell.insertBefore(panel, shell.firstChild);

  byId('krogerConnectBtn')?.addEventListener('click', async () => {
    if (!window.KitchenRetailer) return;
    const state = window.KitchenRetailer.getState();
    if (state.accessToken || state.refreshToken) {
      window.KitchenRetailer.disconnect();
      refreshKrogerPanel();
      setStatus('Kroger disconnected from this phone.');
      return;
    }
    try {
      await window.KitchenRetailer.connect();
    } catch (error) {
      setStatus(error.message || 'Could not start Kroger sign-in.');
    }
  });

  byId('krogerFindStores')?.addEventListener('click', findStores);
  byId('krogerAddCart')?.addEventListener('click', addLastProductToCart);
}

async function refreshKrogerPanel() {
  if (!window.KitchenRetailer) return;
  const text = byId('krogerConnectionText');
  const button = byId('krogerConnectBtn');
  const selected = byId('krogerSelectedStore');
  const cartButton = byId('krogerAddCart');
  try {
    const cfg = await window.KitchenRetailer.config();
    const state = window.KitchenRetailer.getState();
    if (!cfg.configured) {
      if (text) text.textContent = 'Kroger API is prepared, but developer credentials still need to be added.';
      if (button) { button.textContent = 'Kroger setup needed'; button.disabled = true; }
    } else {
      const connected = Boolean(state.accessToken || state.refreshToken);
      if (text) text.textContent = connected ? 'Kroger account connected.' : 'Kroger product lookup is ready. Connect your account to send items to your Kroger cart.';
      if (button) { button.textContent = connected ? 'Disconnect Kroger' : 'Connect Kroger'; button.disabled = false; }
    }
    if (selected) {
      selected.textContent = state.locationId
        ? `Store: ${state.locationName || 'Kroger'}${state.locationAddress ? ` — ${state.locationAddress}` : ''}`
        : 'No Kroger store selected yet.';
    }
    if (cartButton) cartButton.disabled = !(window.KrogerLastProduct && (state.accessToken || state.refreshToken));
  } catch (error) {
    if (text) text.textContent = 'Could not reach the Kroger integration service.';
    if (button) button.disabled = true;
  }
}

async function findStores() {
  const zip = byId('krogerZip')?.value.trim();
  const results = byId('krogerStoreResults');
  if (!zip) {
    setStatus('Enter your ZIP code first.');
    return;
  }
  if (results) results.textContent = 'Finding Kroger stores…';
  try {
    const stores = await window.KitchenRetailer.findLocations(zip);
    if (!stores.length) {
      if (results) results.textContent = 'No Kroger stores were returned for that ZIP code.';
      return;
    }
    results.innerHTML = stores.map((store, index) => {
      const address = store.address?.addressLine1 || '';
      const city = store.address?.city || '';
      return `<button class="retailer-store-choice" data-store-index="${index}"><strong>${store.name || store.chain || 'Kroger'}</strong><span>${address}${city ? `, ${city}` : ''}</span></button>`;
    }).join('');
    results.querySelectorAll('[data-store-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const store = stores[Number(button.dataset.storeIndex)];
        window.KitchenRetailer.setLocation(store);
        refreshKrogerPanel();
        if (results) results.innerHTML = '';
        setStatus(`${store.name || store.chain || 'Kroger'} selected.`);
      });
    });
  } catch (error) {
    if (results) results.textContent = error.message || 'Could not find Kroger stores.';
  }
}

async function addLastProductToCart() {
  const product = window.KrogerLastProduct;
  if (!product) {
    setStatus('Scan a Kroger product first.');
    return;
  }
  const button = byId('krogerAddCart');
  if (button) button.disabled = true;
  try {
    await window.KitchenRetailer.addToCart(product, 1);
    setStatus(`${product.name} was sent to your Kroger cart.`);
    if (button) button.textContent = 'Added to Kroger cart ✓';
    setTimeout(() => {
      if (button) button.textContent = 'Add scanned item to Kroger cart';
      refreshKrogerPanel();
    }, 1800);
  } catch (error) {
    setStatus(error.message || 'Could not add this item to Kroger cart.');
    if (button) button.disabled = false;
  }
}

window.addEventListener('kroger-product-found', refreshKrogerPanel);
window.addEventListener('retailer-state-changed', refreshKrogerPanel);

(async function initRetailerUi(){
  buildKrogerPanel();
  try {
    if (window.KitchenRetailer) {
      const completed = await window.KitchenRetailer.handleOAuthCallback();
      if (completed) setStatus('Kroger account connected.');
    }
  } catch (error) {
    setStatus(error.message || 'Kroger sign-in failed.');
  }
  refreshKrogerPanel();
})();
