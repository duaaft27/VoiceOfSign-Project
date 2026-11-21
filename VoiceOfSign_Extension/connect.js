// connect.js — runs inside connect.html (a small extension window).
// 1) Holds the Web Bluetooth connection to the glove.
// 2) Forwards every sensor frame to the Python backend (backend/app.py, option 3)
//    over WebSocket, and shows the sign the model returns as the subtitle.
// Keep this window open while using the glove.

document.addEventListener('DOMContentLoaded', () => {
  let bluetoothDevice = null;
  let bluetoothCharacteristic = null;
  let busy = false;
  let dialogWindowId = null;

  const connectBtn = document.getElementById('connectBtn');
  const statusText = document.getElementById('statusText');
  const statusIndicator = document.getElementById('statusIndicator');
  const outputScreen = document.getElementById('translationOutput');
  const backendStatus = document.getElementById('backendStatus');

  const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
  const CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a5";

  // ---------- Settings you may want to change ----------
  const WS_URL = "ws://localhost:8765";          // same host/port as app.py
  const READY_TEXT = "جاهز لاستقبال الإشارات...";
  const SUBTITLE_HOLD_MS = 4000;                 // clear the word after 4 s (0 = keep it)
  const REST_LABELS = ["rest", "idle", "none", "راحة"]; // labels that mean "no sign"

  // Optional: map dataset labels to the Arabic word you want on screen.
  // If a label is not listed here, the label itself is shown.
  // Example: { hello: "مرحبا", thanks: "شكراً" }
  const LABEL_TO_ARABIC = {};

  // DEBUG: show raw finger readings instead of predictions (for hardware testing only)
  const DEBUG_SHOW_RAW = false;

  // Let the popup find (and focus) this window instead of opening a second one
  chrome.windows.getCurrent().then((w) => chrome.storage.local.set({ connectWindowId: w.id }));

  // ---------- UI / shared status ----------
  function setStatus(state, message = "") {
    const labels = { connected: "متصل بالقفاز", disconnected: "غير متصل" };
    if (statusText) statusText.innerText = message || labels[state] || "";
    if (statusIndicator) statusIndicator.classList.toggle('connected', state === 'connected');
    if (connectBtn) {
      connectBtn.innerText = state === 'connected' ? "قطع الاتصال" : "بحث عن القفاز (Bluetooth)";
    }
    chrome.storage.local.set({
      bleStatus: { state, message, deviceName: bluetoothDevice?.name || null, updatedAt: Date.now() }
    });
  }

  function setBackend(text) {
    if (backendStatus) backendStatus.innerText = "خادم التعرف: " + text;
  }

  // ---------- Subtitle ----------
  let clearTimer = null;

  function clearSubtitle() {
    clearTimeout(clearTimer);
    if (outputScreen) outputScreen.innerText = READY_TEXT;
    chrome.storage.local.remove('currentSubtitle');
  }

  function showSign(sign) {
    clearTimeout(clearTimer);
    if (REST_LABELS.includes(String(sign).toLowerCase())) {
      clearSubtitle();
      return;
    }
    const word = LABEL_TO_ARABIC[sign] || sign;
    if (outputScreen) outputScreen.innerText = word;
    chrome.storage.local.set({ currentSubtitle: word });
    if (SUBTITLE_HOLD_MS > 0) clearTimer = setTimeout(clearSubtitle, SUBTITLE_HOLD_MS);
  }

  // ---------- Backend (Python WebSocket server) ----------
  let ws = null;
  let wsRetry = null;
  let wantBackend = false;
  let backendError = "";

  function openBackend() {
    wantBackend = true;
    clearTimeout(wsRetry);
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    setBackend("جاري الاتصال...");
    backendError = "";
    ws = new WebSocket(WS_URL);

    ws.onopen = () => setBackend("متصل ✓");

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.error) { backendError = data.error; setBackend("خطأ: " + data.error); return; }
        if (data.sign !== undefined) showSign(data.sign);
      } catch (err) {
        console.error("Bad message from backend:", e.data, err);
      }
    };

    ws.onclose = () => {
      ws = null;
      setBackend(backendError ? "خطأ: " + backendError : "غير متصل (شغّل app.py ثم الخيار 3)");
      if (wantBackend) wsRetry = setTimeout(openBackend, 3000); // keep retrying while the glove is connected
    };
    // onerror is always followed by onclose, which handles the retry
  }

  function closeBackend() {
    wantBackend = false;
    clearTimeout(wsRetry);
    if (ws) { try { ws.close(); } catch (_) {} ws = null; }
    setBackend("متوقف");
  }

  // ---------- Connect / disconnect ----------
  function cleanup() {
    bluetoothDevice = null;
    bluetoothCharacteristic = null;
  }

  function onDisconnected() {
    cleanup();
    closeBackend();
    clearTimeout(clearTimer);
    if (outputScreen) outputScreen.innerText = "انقطع الاتصال بالقفاز لاسلكياً.";
    chrome.storage.local.remove('currentSubtitle');
    setStatus('disconnected');
  }

  async function connect() {
    if (busy) return;
    busy = true;
    try {
      setStatus('connecting', "جاري البحث عن الأجهزة...");

      // Must be called directly from a user click (see listener below)
      bluetoothDevice = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "VoiceOfSign" }],
        optionalServices: [SERVICE_UUID]
      });
      bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);

      setStatus('connecting', "جاري الاتصال بالـ GATT...");
      const server = await bluetoothDevice.gatt.connect();

      setStatus('connecting', "جاري تحميل الخدمات...");
      const service = await server.getPrimaryService(SERVICE_UUID);
      bluetoothCharacteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

      await bluetoothCharacteristic.startNotifications();
      bluetoothCharacteristic.addEventListener('characteristicvaluechanged', handleNotifications);

      setStatus('connected');
      if (outputScreen) outputScreen.innerText = READY_TEXT;
      openBackend();
    } catch (error) {
      console.error("Bluetooth Connection Error:", error);
      const message = error.name === "NotFoundError" ? "تم إلغاء البحث" : `فشل الاتصال: ${error.name}`;
      cleanup();
      setStatus('failed', message); // set LAST so nothing overwrites it
    } finally {
      busy = false;
    }
  }

  function disconnect() {
    try {
      if (bluetoothDevice?.gatt?.connected) bluetoothDevice.gatt.disconnect();
    } catch (e) {
      console.error(e);
    }
    onDisconnected();
  }

  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      if (bluetoothDevice?.gatt?.connected) disconnect();
      else connect();
    });
  }

  // When this window closes the BLE link dies, so reflect that in the popup
  window.addEventListener('pagehide', () => {
    wantBackend = false;
    try { ws?.close(); } catch (_) {}
    try { bluetoothDevice?.gatt?.disconnect(); } catch (_) {}
    chrome.storage.local.remove(['connectWindowId', 'currentSubtitle']);
    chrome.storage.local.set({ bleStatus: { state: 'disconnected', message: "", deviceName: null } });
  });

  // ---------- Physical button: open the dialogue window ----------
  async function openDialogWindow() {
    if (dialogWindowId) {
      try {
        await chrome.windows.update(dialogWindowId, { focused: true });
        return;
      } catch (_) { dialogWindowId = null; }
    }
    // A separate window (not a tab) so the meeting tab stays visible
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL("index.html"),
      type: "normal",
      width: 720,
      height: 700
    });
    dialogWindowId = win.id;
  }

  // ---------- Incoming glove data ----------
  function handleNotifications(event) {
    const decoded = new TextDecoder().decode(event.target.value).trim();

    if (decoded === "BTN_PRESSED") {
      openDialogWindow();
      return;
    }

    // Sensor frame "thumb,index,middle,ring,pinky,accZ" -> send as-is to the model
    if (/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){5}$/.test(decoded)) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(decoded);

      if (DEBUG_SHOW_RAW) {
        const [thumb, index, middle, ring, pinky, accZ] = decoded.split(',');
        const raw = `👍${thumb} ☝️${index} 🖕${middle} 💍${ring} 🤙${pinky} | Z ${accZ}`;
        if (outputScreen) outputScreen.innerText = raw;
        chrome.storage.local.set({ currentSubtitle: raw });
      }
      return;
    }

    // Any other text is shown directly
    showSign(decoded);
  }
});