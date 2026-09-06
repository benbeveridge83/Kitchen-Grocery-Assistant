let cameraStream = null;
let facingMode = 'environment';
let scanLoop = null;
let motionTimer = null;
let motionEnabled = false;
let lastMotionFrame = null;
let lastCode = '';
let lastCodeAt = 0;

const byId = (id) => document.getElementById(id);
const setStatus = (text) => { const el = byId('status'); if (el) el.textContent = text; };

function enableScanActions(enabled) {
  const a = byId('addScannedShopping');
  const b = byId('addScannedInventory');
  if (a) a.disabled = !enabled;
  if (b) b.disabled = !enabled;
}

function setProduct(name, barcode = '', metaText = '') {
  const input = byId('scanProductName');
  if (input) input.value = name || '';
  const meta = byId('scanMeta');
  if (meta) meta.textContent = metaText || (barcode ? `Barcode: ${barcode}` : '');
  enableScanActions(Boolean(name));
}

async function lookupOpenFoodFacts(code) {
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
  const data = await response.json();
  const p = data?.product;
  if (data?.status === 1 && p) {
    return {
      retailer: 'fallback',
      productId: '',
      upc: code,
      name: p.product_name || p.generic_name || p.brands || `Barcode ${code}`,
      brand: p.brands || '',
      size: p.quantity || '',
      price: null
    };
  }
  return null;
}

async function lookupBarcode(code) {
  if (!code) return;
  const meta = byId('scanMeta');
  if (meta) meta.textContent = `Looking up ${code} at Kroger...`;
  enableScanActions(false);
  window.KrogerLastProduct = null;

  try {
    let product = null;
    let krogerConfigured = false;

    if (window.KitchenRetailer) {
      try {
        const cfg = await window.KitchenRetailer.config();
        krogerConfigured = Boolean(cfg?.configured);
        if (krogerConfigured) product = await window.KitchenRetailer.lookupBarcode(code);
      } catch (e) {
        console.warn('Kroger lookup unavailable', e);
      }
    }

    if (!product) {
      product = await lookupOpenFoodFacts(code).catch(() => null);
    }

    if (product) {
      window.KrogerLastProduct = product.retailer === 'kroger' ? product : null;
      const details = [
        product.retailer === 'kroger' ? 'Kroger' : (krogerConfigured ? 'Fallback database' : 'Product database'),
        product.brand,
        product.size,
        product.price != null ? `$${Number(product.price).toFixed(2)}` : '',
        `Barcode: ${code}`
      ].filter(Boolean).join(' • ');
      setProduct(product.name, code, details);
      const title = byId('scanResult')?.querySelector('h3');
      if (title) title.textContent = product.retailer === 'kroger' ? 'Kroger product found' : 'Product found';
      setStatus(`Found ${product.name}${product.retailer === 'kroger' ? ' at Kroger' : ''}.`);
      window.dispatchEvent(new CustomEvent('kroger-product-found', { detail: product }));
    } else {
      setProduct('', code, `Barcode ${code} was not found. Type the product name.`);
      const title = byId('scanResult')?.querySelector('h3');
      if (title) title.textContent = 'Barcode found - name it';
      byId('scanProductName')?.focus();
    }
  } catch (e) {
    setProduct('', code, 'Barcode detected, but product lookup failed. Type the product name.');
  }
}

function stopCamera() {
  if (scanLoop) cancelAnimationFrame(scanLoop);
  scanLoop = null;
  if (motionTimer) clearInterval(motionTimer);
  motionTimer = null;
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  const video = byId('cameraVideo');
  if (video) video.srcObject = null;
  const placeholder = byId('cameraPlaceholder');
  if (placeholder) placeholder.hidden = false;
  lastMotionFrame = null;
}

async function startBarcodeLoop() {
  const meta = byId('scanMeta');
  if (!('BarcodeDetector' in window)) {
    if (meta) meta.textContent = 'Automatic barcode detection is not supported by this Chrome build. Enter the barcode manually below.';
    return;
  }
  let detector;
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    const formats = supported.filter((f) => ['ean_13','ean_8','upc_a','upc_e','code_128'].includes(f));
    detector = new BarcodeDetector(formats.length ? { formats } : undefined);
  } catch {
    detector = new BarcodeDetector();
  }
  const video = byId('cameraVideo');
  const tick = async () => {
    if (!cameraStream) return;
    try {
      if (video?.readyState >= 2) {
        const results = await detector.detect(video);
        if (results?.length) {
          const code = results[0].rawValue;
          const now = Date.now();
          if (code && (code !== lastCode || now - lastCodeAt > 5000)) {
            lastCode = code;
            lastCodeAt = now;
            const field = byId('manualBarcode');
            if (field) field.value = code;
            await lookupBarcode(code);
          }
        }
      }
    } catch {}
    scanLoop = requestAnimationFrame(tick);
  };
  tick();
}

function motionScore(ctx, width, height) {
  const data = ctx.getImageData(0, 0, width, height).data;
  const current = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) current[j] = (data[i] + data[i + 1] + data[i + 2]) / 3;
  if (!lastMotionFrame) {
    lastMotionFrame = current;
    return 0;
  }
  let diff = 0;
  for (let i = 0; i < current.length; i += 1) diff += Math.abs(current[i] - lastMotionFrame[i]);
  lastMotionFrame = current;
  return diff / current.length;
}

function startMotionWatch() {
  if (motionTimer) clearInterval(motionTimer);
  const video = byId('cameraVideo');
  const canvas = byId('motionCanvas');
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  if (!video || !canvas || !ctx) return;
  motionTimer = setInterval(() => {
    if (!motionEnabled || !cameraStream || video.readyState < 2) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const score = motionScore(ctx, canvas.width, canvas.height);
    const motionStatus = byId('motionStatus');
    if (motionStatus) motionStatus.textContent = `Motion level: ${score.toFixed(1)}`;
    if (score > 18) {
      if (motionStatus) motionStatus.textContent = 'Motion detected - ready to scan.';
      setStatus('Motion detected. Show me the product barcode.');
      document.body.classList.add('motion-active');
      setTimeout(() => document.body.classList.remove('motion-active'), 800);
    }
  }, 650);
}

async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Camera access is not supported in this browser.');
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    const video = byId('cameraVideo');
    video.srcObject = cameraStream;
    await video.play();
    byId('cameraPlaceholder').hidden = true;
    setStatus('Camera ready. Hold a barcode inside the box.');
    startBarcodeLoop();
    if (motionEnabled) startMotionWatch();
  } catch (e) {
    setStatus(`Camera could not start: ${e.message || e.name}.`);
  }
}

byId('startCamera')?.addEventListener('click', startCamera);
byId('stopCamera')?.addEventListener('click', stopCamera);
byId('switchCamera')?.addEventListener('click', async () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  await startCamera();
});
byId('motionToggle')?.addEventListener('click', () => {
  motionEnabled = !motionEnabled;
  byId('motionToggle').textContent = `Motion Watch: ${motionEnabled ? 'On' : 'Off'}`;
  byId('motionStatus').textContent = motionEnabled ? 'Motion Watch armed. Start the camera if it is off.' : 'Motion Watch is off.';
  if (motionEnabled && cameraStream) startMotionWatch();
  else if (motionTimer) { clearInterval(motionTimer); motionTimer = null; }
});
byId('lookupBarcode')?.addEventListener('click', () => lookupBarcode(byId('manualBarcode').value.trim()));
byId('scanProductName')?.addEventListener('input', () => enableScanActions(Boolean(byId('scanProductName').value.trim())));

window.KitchenScanner = { startCamera, stopCamera, lookupBarcode };
window.addEventListener('beforeunload', stopCamera);
