// //content.js
// // Function to continuously check and inject subtitle onto active video streams
// (function () {
//   console.log("[VoS] Injecting Camera Stream Interceptor...");

//   // متغير لتخزين النص الحي، يبدأ بنص افتراضي
//   let currentSubtitleText = "صَوْت الإِشَارَة: في انتظار الإشارة...";

//   // الاستماع لتحديثات التخزين المحلي القادمة من البلوتوث (Popup.js)
//   if (typeof chrome !== 'undefined' && chrome.storage) {
//     // تحميل القيمة الحالية أولاً
//     chrome.storage.local.get(['currentSubtitle'], (data) => {
//       if (data.currentSubtitle) {
//         currentSubtitleText = data.currentSubtitle;
//       }
//     });

//     // مراقبة أي تغيير يحدث عند استقبال ترجمة جديدة من القفاز
//     chrome.storage.onChanged.addListener((changes, namespace) => {
//       if (namespace === 'local' && changes.currentSubtitle) {
//         currentSubtitleText = changes.currentSubtitle.newValue || "في انتظار الإشارة...";
//       }
//     });
//   }

//   // Override getUserMedia directly before Meet attaches stream
//   const originalGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

//   navigator.mediaDevices.getUserMedia = async function (constraints) {
//     const stream = await originalGUM(constraints);

//     if (!constraints || !constraints.video) return stream;

//     try {
//       const videoTrack = stream.getVideoTracks()[0];
//       const video = document.createElement("video");
//       video.srcObject = new MediaStream([videoTrack]);
//       video.muted = true;
//       await video.play();

//       const canvas = document.createElement("canvas");
//       canvas.width = 1280;
//       canvas.height = 720;
//       const ctx = canvas.getContext("2d");

//       function drawFrame() {
//         if (video.readyState >= video.HAVE_CURRENT_DATA) {
//           // Draw video frame
//           ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

//           // Draw dark subtitle box
//           ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
//           ctx.fillRect(128, 580, 1024, 90);

//           // Subtitle border (Rounded aesthetic look)
//           ctx.strokeStyle = "#00d2d3";
//           ctx.lineWidth = 3;
//           ctx.strokeRect(128, 580, 1024, 90);

//           // Subtitle text (Dynamic from currentSubtitleText)
//           ctx.fillStyle = "#ffffff";
//           ctx.font = "bold 34px 'Cairo', Tahoma, Arial";
//           ctx.textAlign = "center";
//           ctx.direction = "rtl";
//           ctx.fillText(currentSubtitleText, 640, 638);
//         }
//         requestAnimationFrame(drawFrame);
//       }
//       drawFrame();

//       const processedStream = canvas.captureStream(30);
//       // Keep audio tracks if present
//       stream.getAudioTracks().forEach(track => processedStream.addTrack(track));

//       return processedStream;
//     } catch (e) {
//       console.error("[VoS] Stream modification failed, returning original stream", e);
//       return stream;
//     }
//   };
// })();

// content.js — "bridge" (isolated world).
// Only this world can read chrome.storage. It forwards the live subtitle and
// font size to content_main.js (page world) using window.postMessage.
// (The subtitle is drawn onto the shared video anyway, so nothing private leaks.)
(function () {
  let text = "";
  let size = 34;
  const SIZE_MAP = { "13px": 28, "16px": 34, "20px": 42 };

  function push() {
    window.postMessage({ __vos: "subtitle", text, size }, "*");
  }

  chrome.storage.local.get(["currentSubtitle", "settings"], (data) => {
    text = data.currentSubtitle || "";
    size = SIZE_MAP[data.settings?.textSize] || 34;
    push();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.currentSubtitle) text = changes.currentSubtitle.newValue || "";
    if (changes.settings) size = SIZE_MAP[changes.settings.newValue?.textSize] || 34;
    push();
  });

  // The page-world script asks for the current value when it starts
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.__vos === "ready") push();
  });
})();