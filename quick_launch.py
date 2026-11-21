import os
import time
import webbrowser

import serial

PORT = "COM3"
BAUD = 115200

# index.html lives inside the extension folder
current_dir = os.path.dirname(os.path.abspath(__file__))
html_path = os.path.join(current_dir, "VoiceOfSign_Extension", "index.html")
WEB_PAGE_URL = "file:///" + html_path.replace(os.sep, "/")

if not os.path.exists(html_path):
    raise SystemExit(f"[!] index.html not found at: {html_path}")

print(f"[*] Connecting to ESP32 on {PORT}...")
print(f"[*] Target file: {WEB_PAGE_URL}")
print("[*] Ready! Press the physical button on your glove.")

try:
    ser = serial.Serial(PORT, BAUD, timeout=1)
    while True:
        if ser.in_waiting > 0:
            line = ser.readline().decode("utf-8", errors="ignore").strip()
            if line == "BTN_PRESSED":
                print("[!] Button pressed! Opening index.html in browser...")
                webbrowser.open(WEB_PAGE_URL)
        time.sleep(0.05)  # prevent high CPU usage

except KeyboardInterrupt:
    print("\n[*] Stopped.")
except Exception as e:
    print(f"[!] Error: {e}")
    print("[*] Hint: close any other program using COM3 (e.g. the VS Code Serial Monitor).")