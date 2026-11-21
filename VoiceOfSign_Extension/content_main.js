// content_main.js — runs in the PAGE's own JavaScript world ("world": "MAIN").
// A normal content script lives in an isolated world, so overriding getUserMedia
// there never affects Google Meet / Zoom. This script must run in the page world.
// It can't read chrome.storage, so content.js (the bridge) sends it the subtitle.
(function () {
  if (window.__vosInstalled) return;
  window.__vosInstalled = true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

  const WAITING = "صَوْت الإِشَارَة: في انتظار الإشارة...";
  let subtitleText = WAITING;
  let fontSize = 34; // px at 720p, scaled for other resolutions

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__vos !== "subtitle") return;
    subtitleText = e.data.text || WAITING;
    fontSize = e.data.size || 34;
  });
  window.postMessage({ __vos: "ready" }, "*");

  const originalGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  navigator.mediaDevices.getUserMedia = async function (constraints) {
    const stream = await originalGUM(constraints);
    if (!constraints || !constraints.video) return stream;

    try {
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) return stream;

      const video = document.createElement("video");
      video.srcObject = new MediaStream([videoTrack]);
      video.muted = true;
      video.playsInline = true;
      await video.play();

      const s = videoTrack.getSettings();
      const W = s.width || 1280;
      const H = s.height || 720;
      const k = H / 720;

      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");

      function drawFrame() {
        if (video.readyState < video.HAVE_CURRENT_DATA) return;
        ctx.drawImage(video, 0, 0, W, H);

        const bx = W * 0.1, bw = W * 0.8, bh = 90 * k, by = H - bh - 50 * k;
        ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = "#00d2d3";
        ctx.lineWidth = 3 * k;
        ctx.strokeRect(bx, by, bw, bh);

        // shrink long text so it always fits inside the box
        let px = fontSize * k;
        ctx.font = `bold ${px}px 'Cairo', Tahoma, Arial`;
        while (ctx.measureText(subtitleText).width > bw - 40 * k && px > 18 * k) {
          px -= 2 * k;
          ctx.font = `bold ${px}px 'Cairo', Tahoma, Arial`;
        }
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.direction = "rtl";
        ctx.fillText(subtitleText, W / 2, by + bh / 2);
      }

      // setInterval (not requestAnimationFrame) so the video keeps flowing
      // even when the meeting tab is not the focused one.
      const timer = setInterval(drawFrame, 1000 / 30);

      const processedStream = canvas.captureStream(30);
      const outTrack = processedStream.getVideoTracks()[0];

      // When the meeting stops our track, also stop the real camera and the loop
      // (otherwise the camera light stays on after leaving the call).
      const origStop = outTrack.stop.bind(outTrack);
      outTrack.stop = () => {
        clearInterval(timer);
        videoTrack.stop();
        origStop();
      };
      videoTrack.addEventListener("ended", () => clearInterval(timer));

      stream.getAudioTracks().forEach((t) => processedStream.addTrack(t));
      return processedStream;
    } catch (e) {
      console.error("[VoS] Stream modification failed, returning original stream", e);
      return stream;
    }
  };
})();