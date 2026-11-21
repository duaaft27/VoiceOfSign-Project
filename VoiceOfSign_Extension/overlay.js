// overlay.js — shows the live subtitle.
// Works when this page is opened from the extension (chrome-extension://...),
// where the subtitle lives in chrome.storage (not localStorage).
const box = document.getElementById('subtitleBox');
const WAITING = "في انتظار الترجمة الحية...";
const show = (t) => { box.innerText = t || WAITING; };

if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.local.get(['currentSubtitle'], (d) => show(d.currentSubtitle));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.currentSubtitle) show(changes.currentSubtitle.newValue);
  });
} else {
  // fallback when opened outside the extension
  window.addEventListener('storage', (e) => {
    if (e.key === 'currentSubtitle') show(e.newValue);
  });
}