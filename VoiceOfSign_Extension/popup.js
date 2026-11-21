// popup.js — launcher + status + settings.
// Web Bluetooth can't show its device chooser inside an extension popup,
// so the actual BLE work lives in connect.js (opened in its own small window).

document.addEventListener('DOMContentLoaded', () => {
  const connectBtn = document.getElementById('connectBtn');
  const statusText = document.getElementById('statusText');
  const statusIndicator = document.getElementById('statusIndicator');
  const outputScreen = document.getElementById('translationOutput');

  const settingsToggle = document.getElementById('settingsToggle');
  const settingsPanel = document.getElementById('settingsPanel');
  const userName = document.getElementById('userName');
  const textSize = document.getElementById('textSize');
  const saveSettings = document.getElementById('saveSettings');

  const DEFAULT_OUTPUT = "في انتظار تفعيل الإشارة...";

  // ---------- Status ----------
  function render(ble) {
    const state = ble?.state || 'disconnected';
    const connected = state === 'connected';

    if (statusText) {
      statusText.innerText =
        state === 'connected'  ? "متصل بالقفاز" :
        state === 'connecting' ? (ble.message || "جاري الاتصال...") :
        state === 'failed'     ? (ble.message || "فشل الاتصال") :
                                 "غير متصل";
    }
    if (statusIndicator) statusIndicator.classList.toggle('connected', connected);
    if (connectBtn) {
      connectBtn.innerText = connected ? "إدارة الاتصال" : "اتصال بالقفاز (Bluetooth)";
    }
    if (!connected && outputScreen) outputScreen.innerText = DEFAULT_OUTPUT;
  }

  chrome.storage.local.get(['bleStatus', 'currentSubtitle', 'settings'], (data) => {
    render(data.bleStatus);
    if (data.bleStatus?.state === 'connected' && data.currentSubtitle && outputScreen) {
      outputScreen.innerText = data.currentSubtitle;
    }
    const s = data.settings || {};
    if (userName) userName.value = s.userName || "";
    if (textSize) textSize.value = s.textSize || "16px";
    if (outputScreen) outputScreen.style.fontSize = s.textSize || "16px";
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.bleStatus) render(changes.bleStatus.newValue);
    if (changes.currentSubtitle && outputScreen) {
      outputScreen.innerText = changes.currentSubtitle.newValue || DEFAULT_OUTPUT;
    }
  });

  // ---------- Settings panel ----------
  if (settingsToggle && settingsPanel) {
    settingsToggle.addEventListener('click', () => settingsPanel.classList.toggle('active'));
  }

  if (saveSettings) {
    saveSettings.addEventListener('click', () => {
      const settings = {
        userName: userName ? userName.value.trim() : "",
        textSize: textSize ? textSize.value : "16px"
      };
      chrome.storage.local.set({ settings }, () => {
        if (outputScreen) outputScreen.style.fontSize = settings.textSize;
        const old = saveSettings.innerText;
        saveSettings.innerText = "تم الحفظ ✓";
        setTimeout(() => { saveSettings.innerText = old; }, 1500);
      });
    });
  }

  // ---------- Open (or focus) the connection window ----------
  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      const { connectWindowId } = await chrome.storage.local.get('connectWindowId');
      if (connectWindowId) {
        try {
          await chrome.windows.update(connectWindowId, { focused: true });
          window.close();
          return;
        } catch (_) { /* window no longer exists -> open a new one */ }
      }
     chrome.windows.create({
        url: chrome.runtime.getURL("connect.html"),
        type: "normal",
        width: 460,
        height: 640
      });
      window.close();
    });
  }
});