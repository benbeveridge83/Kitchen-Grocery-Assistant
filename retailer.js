const KROGER_EDGE = 'https://ucpfgcobgnizuzdqftbx.supabase.co/functions/v1/kroger-api';
const RETAILER_KEY = 'kitchen-grocery-retailer-v1';

const getState = () => {
  try {
    return JSON.parse(localStorage.getItem(RETAILER_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const saveState = (patch) => {
  const next = { ...getState(), ...patch };
  localStorage.setItem(RETAILER_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('retailer-state-changed', { detail: next }));
  return next;
};

async function edge(action, { method = 'GET', params = {}, body } = {}) {
  const url = new URL(KROGER_EDGE);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const err = new Error(data?.message || data?.error || `Kroger request failed (${response.status})`);
    err.code = data?.error;
    err.status = response.status;
    throw err;
  }
  return data;
}

function redirectUri() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function config() {
  return edge('config');
}

async function connect() {
  const state = randomState();
  sessionStorage.setItem('kroger-oauth-state', state);
  const data = await edge('authorize-url', {
    params: { redirect_uri: redirectUri(), state }
  });
  window.location.assign(data.url);
}

async function handleOAuthCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (!code) return false;

  const expectedState = sessionStorage.getItem('kroger-oauth-state');
  if (!expectedState || !returnedState || expectedState !== returnedState) {
    throw new Error('Kroger sign-in could not be verified. Please connect again.');
  }

  const data = await edge('exchange', {
    method: 'POST',
    body: { code, redirectUri: redirectUri() }
  });
  const token = data.token || {};
  saveState({
    provider: 'kroger',
    accessToken: token.access_token || '',
    refreshToken: token.refresh_token || '',
    expiresAt: Date.now() + Math.max(60, Number(token.expires_in || 1800)) * 1000,
    connectedAt: Date.now()
  });
  sessionStorage.removeItem('kroger-oauth-state');
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('scope');
  history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + url.hash);
  return true;
}

async function ensureAccessToken() {
  let state = getState();
  if (state.accessToken && Number(state.expiresAt || 0) > Date.now() + 60_000) return state.accessToken;
  if (!state.refreshToken) return '';

  const data = await edge('refresh', {
    method: 'POST',
    body: { refreshToken: state.refreshToken }
  });
  const token = data.token || {};
  state = saveState({
    accessToken: token.access_token || '',
    refreshToken: token.refresh_token || state.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(token.expires_in || 1800)) * 1000
  });
  return state.accessToken || '';
}

function normalizeProduct(product) {
  if (!product) return null;
  const item = Array.isArray(product.items) ? product.items[0] : null;
  const price = item?.price?.promo ?? item?.price?.regular ?? null;
  const size = item?.size || '';
  return {
    retailer: 'kroger',
    productId: product.productId || '',
    upc: product.upc || '',
    name: product.description || product.brand || 'Kroger product',
    brand: product.brand || '',
    size,
    price,
    image: product.images?.[0]?.sizes?.find(s => s.size === 'medium')?.url || product.images?.[0]?.sizes?.[0]?.url || '',
    raw: product
  };
}

async function lookupBarcode(barcode) {
  const state = getState();
  const data = await edge('search', {
    params: { q: barcode, locationId: state.locationId || '' }
  });
  const products = Array.isArray(data?.data?.data) ? data.data.data : [];
  const exact = products.find(p => String(p.upc || '').replace(/^0+/, '') === String(barcode).replace(/^0+/, '')) || products[0];
  return normalizeProduct(exact);
}

async function searchProducts(query) {
  const state = getState();
  const data = await edge('search', {
    params: { q: query, locationId: state.locationId || '' }
  });
  const products = Array.isArray(data?.data?.data) ? data.data.data : [];
  return products.map(normalizeProduct).filter(Boolean);
}

async function findLocations(zip) {
  const data = await edge('locations', { params: { zip } });
  return Array.isArray(data?.data?.data) ? data.data.data : [];
}

function setLocation(location) {
  if (!location) return;
  saveState({
    provider: 'kroger',
    locationId: location.locationId || '',
    locationName: location.name || location.chain || 'Kroger',
    locationAddress: location.address?.addressLine1 || '',
    locationZip: location.address?.zipCode || ''
  });
}

async function addToCart(product, quantity = 1) {
  if (!product?.upc) throw new Error('This Kroger product does not have a UPC to add to the cart.');
  const accessToken = await ensureAccessToken();
  if (!accessToken) {
    const err = new Error('Connect your Kroger account before adding items to the Kroger cart.');
    err.code = 'KROGER_NOT_CONNECTED';
    throw err;
  }
  try {
    return await edge('cart-add', {
      method: 'POST',
      body: {
        accessToken,
        items: [{ upc: product.upc, quantity, modality: 'PICKUP' }]
      }
    });
  } catch (error) {
    if (error.code === 'KROGER_TOKEN_EXPIRED' && getState().refreshToken) {
      saveState({ accessToken: '', expiresAt: 0 });
      const refreshed = await ensureAccessToken();
      if (refreshed) {
        return edge('cart-add', {
          method: 'POST',
          body: {
            accessToken: refreshed,
            items: [{ upc: product.upc, quantity, modality: 'PICKUP' }]
          }
        });
      }
    }
    throw error;
  }
}

function disconnect() {
  const state = getState();
  saveState({
    provider: 'kroger',
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
    connectedAt: 0,
    locationId: state.locationId || '',
    locationName: state.locationName || '',
    locationAddress: state.locationAddress || '',
    locationZip: state.locationZip || ''
  });
}

window.KitchenRetailer = {
  provider: 'kroger',
  config,
  connect,
  disconnect,
  handleOAuthCallback,
  getState,
  lookupBarcode,
  searchProducts,
  findLocations,
  setLocation,
  addToCart
};
