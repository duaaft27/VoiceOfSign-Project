import threading
import tkinter as tk
import warnings
import numpy as np
from faster_whisper import WhisperModel
import soundcard as sc

from soundcard.mediafoundation import SoundcardRuntimeWarning

warnings.filterwarnings("ignore", category=SoundcardRuntimeWarning)


class DeafSubtitleOverlay:

  def __init__(self):
    self.root = tk.Tk()
    self.root.overrideredirect(True)
    self.root.attributes("-topmost", True)
    self.root.attributes("-alpha", 0.90)

    screen_width = self.root.winfo_screenwidth()
    screen_height = self.root.winfo_screenheight()
    window_width = 880
    window_height = 100
    x = (screen_width - window_width) // 2
    y = screen_height - 170
    self.root.geometry(f"{window_width}x{window_height}+{x}+{y}")

    # Main container frame with dark theme
    self.main_frame = tk.Frame(self.root, bg="#1e1e1e")
    self.main_frame.pack(fill=tk.BOTH, expand=True)

    # Top control bar frame for buttons (Pause & Close)
    self.control_bar = tk.Frame(self.main_frame, bg="#1e1e1e")
    self.control_bar.pack(fill=tk.X, padx=10, pady=2)

    # State variable for pausing
    self.is_paused = False

    # Pause / Resume Button
    self.pause_btn = tk.Button(
        self.control_bar,
        text="⏸ إيقاف مؤقت",
        font=("Arial", 9, "bold"),
        fg="#ffffff",
        bg="#333333",
        activebackground="#444444",
        activeforeground="#ffffff",
        bd=0,
        padx=6,
        pady=1,
        command=self.toggle_pause,
    )
    self.pause_btn.pack(side=tk.LEFT)

    # Close Button
    self.close_btn = tk.Button(
        self.control_bar,
        text="✕",
        font=("Arial", 10, "bold"),
        fg="#ff5b5b",
        bg="#1e1e1e",
        activebackground="#ff5b5b",
        activeforeground="#ffffff",
        bd=0,
        padx=6,
        pady=1,
        command=self.close_app,
    )
    self.close_btn.pack(side=tk.RIGHT)

    # Subtitle Display Label
    self.label = tk.Label(
        self.main_frame,
        text=(
            "[Voice of Sign - Meeting STT]: جاري تحميل نموذج Whisper المحلي..."
        ),
        font=("Arial", 14, "bold"),
        fg="#00d2d3",
        bg="#1e1e1e",
        wraplength=840,
        justify="center",
    )
    self.label.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 5))

    print("[*] Loading local Whisper model...")
    self.model = WhisperModel("base", device="cpu", compute_type="int8")
    print("[+] Whisper model loaded successfully!")
    self.label.config(
        text=(
            "[Voice of Sign - Meeting STT]: جاهز للاستماع لصوت المكالمة محلياً..."
        )
    )

    self.fs = 16000
    self.duration = 2.5

    threading.Thread(target=self.listen_loop, daemon=True).start()

  def toggle_pause(self):
    self.is_paused = not self.is_paused
    if self.is_paused:
      self.pause_btn.config(text="▶ استئناف", fg="#55efc4")
      self.label.config(text="[Voice of Sign]: تم إيقاف الترجمة مؤقتاً.")
    else:
      self.pause_btn.config(text="⏸ إيقاف مؤقت", fg="#ffffff")
      self.label.config(text="[Voice of Sign]: تم استئناف الاستماع...")

  def close_app(self):
    self.root.destroy()

  def listen_loop(self):
    while True:
      try:
        # If paused, skip processing and sleep briefly
        if self.is_paused:
          import time

          time.sleep(0.5)
          continue

        speaker_name = sc.default_speaker().name
        mic = sc.get_microphone(id=str(speaker_name), include_loopback=True)

        with mic.recorder(samplerate=self.fs) as recorder:
          data = recorder.record(numframes=int(self.fs * self.duration))

        if self.is_paused:
          continue

        max_vol = np.max(np.abs(data))
        if max_vol < 0.002:
          continue

        if data.ndim > 1:
          audio_np = data.mean(axis=1)
        else:
          audio_np = data
        audio_np = audio_np.astype(np.float32)

        segments, _ = self.model.transcribe(
            audio_np, language="ar", beam_size=1
        )
        text = " ".join([segment.text for segment in segments]).strip()

        if text and not self.is_paused:
          self.root.after(0, self.update_subtitle_text, text)

      except Exception:
        pass

  def update_subtitle_text(self, text):
    if not self.is_paused:
      self.label.config(text=f"المتحدث الآخر: {text}")

  def run(self):
    self.root.mainloop()

if __name__ == "__main__":
  app = DeafSubtitleOverlay()
  app.run()