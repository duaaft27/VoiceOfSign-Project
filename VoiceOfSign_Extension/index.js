// index.js — dialogue window (speech-to-text + theme toggle).
// Kept in a separate file because Manifest V3 extension pages block inline scripts.

const themeBtn = document.getElementById('themeBtn');
const themeIcon = document.getElementById('themeIcon');

themeBtn.addEventListener('click', () => {
  const body = document.body;
  const dark = body.classList.contains('dark-mode');
  body.classList.toggle('dark-mode', !dark);
  body.classList.toggle('light-mode', dark);
  themeIcon.className = dark ? "fa-solid fa-sun" : "fa-solid fa-moon";
});

window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!window.SpeechRecognition) {
  alert("عذراً، متصفحك لا يدعم خاصية تحويل الصوت إلى نص. يرجى استخدام متصفح Google Chrome.");
} else {
  const recognition = new SpeechRecognition();
  recognition.lang = 'ar-SA';
  recognition.continuous = true;
  recognition.interimResults = true;

  const textBox = document.getElementById('textBox');
  const micButton = document.getElementById('micButton');
  const micIcon = document.getElementById('micIcon');
  const statusText = document.getElementById('statusText');
  const indicator = document.getElementById('indicator');

  let isListening = false;

  micButton.addEventListener('click', () => {
    if (!isListening) recognition.start();
    else recognition.stop();
  });

  recognition.onstart = () => {
    isListening = true;
    micButton.classList.add('active');
    textBox.classList.add('listening');
    micIcon.className = "fa-solid fa-microphone";
    statusText.innerText = "جاري الاستماع... تحدث الآن";
    indicator.classList.add('active');
  };

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) final += event.results[i][0].transcript;
      else interim += event.results[i][0].transcript;
    }
    if (final !== '') textBox.innerText = final;
    else if (interim !== '') textBox.innerText = interim;
  };

  recognition.onerror = (event) => {
    console.error("خطأ: " + event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      statusText.innerText = "لم يُسمح بالوصول إلى الميكروفون";
    }
  };

  recognition.onend = () => {
    isListening = false;
    micButton.classList.remove('active');
    textBox.classList.remove('listening');
    micIcon.className = "fa-solid fa-microphone-slash";
    if (statusText.innerText.startsWith("جاري")) statusText.innerText = "الميكروفون متوقف";
    indicator.classList.remove('active');
  };
}