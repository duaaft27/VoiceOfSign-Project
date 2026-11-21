import os
import json
import time
import asyncio
import csv
from collections import deque, Counter
from datetime import datetime

import serial
import websockets
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split

# --- CONFIGURATION ---
PORT = os.environ.get("GLOVE_PORT", "COM3")   # only used for data COLLECTION (USB cable)
BAUD = 115200
DATA_FILE = "dataset.csv"
MODEL_FILE = "model.pkl"
WINDOW_SIZE = 10          # 10 frames x 6 features = 60 features (~0.5 s at 20 Hz)
NUM_FEATURES = 6
FEATURE_COLS = ["thumb", "index", "middle", "ring", "pinky", "accel_z"]
SMOOTHING = 3          # a sign must win the last N predictions before it is sent
WS_HOST, WS_PORT = "localhost", 8765

model = None


class GestureBuffer:
    def __init__(self, window_size=WINDOW_SIZE, num_features=NUM_FEATURES):
        self.window_size = window_size
        self.num_features = num_features
        self.buffer = deque(maxlen=window_size)

    def add_frame(self, feature_vector):
        self.buffer.append(feature_vector)

    def is_ready(self):
        return len(self.buffer) == self.window_size

    def get_flattened_window(self):
        return np.array(self.buffer).flatten().reshape(1, -1)

    def reset(self):
        self.buffer.clear()


def parse_frame(line):
    """Parse 'a,b,c,d,e,z' into 6 floats. Returns None for log lines / garbage."""
    parts = line.strip().split(",")
    if len(parts) != NUM_FEATURES:
        return None
    try:
        return [float(p) for p in parts]
    except ValueError:
        return None


# ---------------------------------------------------------------
# 1) DATA COLLECTION (glove connected by USB, firmware prints CSV)
# ---------------------------------------------------------------
def collect_data(label_name):
    print(f"\n[+] Collecting gesture: '{label_name}'")
    print(f"[+] Connecting to ESP32 on {PORT}...")

    file_exists = os.path.exists(DATA_FILE)
    ser = None
    count = 0
    try:
        ser = serial.Serial(PORT, BAUD, timeout=1)
        time.sleep(2)               # ESP32 resets when the port opens
        ser.reset_input_buffer()
        print("[+] Connected! Perform the sign continuously. Ctrl+C to stop.")

        with open(DATA_FILE, mode="a", newline="") as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(FEATURE_COLS + ["label"])

            while True:
                line = ser.readline().decode("utf-8", errors="ignore")
                features = parse_frame(line)
                if features is None:
                    continue
                writer.writerow(features + [label_name])
                count += 1
                if count % 20 == 0:
                    print(f"  {count} frames recorded (last: {features})")
                    f.flush()

    except KeyboardInterrupt:
        print(f"\n[+] Stopped. {count} frames saved for '{label_name}'.")
    except Exception as e:
        print(f"[!] Error: {e}")
    finally:
        if ser is not None and ser.is_open:
            ser.close()
            print("[*] Serial port closed.")


# ---------------------------------------------------------------
# 2) TRAINING
# ---------------------------------------------------------------
def train_model():
    global model
    print("\n[+] Training time-series Random Forest...")
    if not os.path.exists(DATA_FILE):
        print("[!] No dataset found! Collect data first (Option 1).")
        return

    df = pd.read_csv(DATA_FILE).dropna()
    for col in FEATURE_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=FEATURE_COLS)

    if df["label"].nunique() < 2:
        print("[!] Need at least 2 different signs (include a 'rest' label too).")
        return

    X_windows, y_labels = [], []
    # Windows are built per label so a window never mixes two signs
    for label, group in df.groupby("label"):
        values = group[FEATURE_COLS].values
        if len(values) < WINDOW_SIZE:
            print(f"[!] Skipping '{label}': only {len(values)} frames (need {WINDOW_SIZE}+).")
            continue
        for i in range(len(values) - WINDOW_SIZE + 1):
            X_windows.append(values[i:i + WINDOW_SIZE].flatten())
            y_labels.append(label)

    if not X_windows:
        print("[!] Could not create windows. Collect more data.")
        return

    X = np.array(X_windows)
    y = np.array(y_labels)

    # Quick sanity check. Overlapping windows leak between random splits, so this
    # number is optimistic - always test the real glove live too.
    if len(X) >= 50:
        X_tr, X_te, y_tr, y_te = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        check = RandomForestClassifier(n_estimators=100, random_state=42).fit(X_tr, y_tr)
        print(classification_report(y_te, check.predict(X_te), zero_division=0))

    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X, y)
    joblib.dump(model, MODEL_FILE)
    print(f"[+] Trained on {len(X)} windows ({WINDOW_SIZE * NUM_FEATURES} features). "
          f"Signs: {sorted(set(y))}. Saved to {MODEL_FILE}")


# ---------------------------------------------------------------
# 3) LIVE SERVER - the browser extension sends BLE frames here
# ---------------------------------------------------------------
async def handler(websocket):
    global model
    if model is None and os.path.exists(MODEL_FILE):
        model = joblib.load(MODEL_FILE)
        print("[+] Loaded trained model from disk.")
    elif model is None:
        print("[!] No trained model found! Train first (Option 2).")
        await websocket.send(json.dumps({"error": "no trained model on server"}))
        return

    print("\n[+] Browser extension connected. Waiting for glove frames...")

    gesture_buffer = GestureBuffer()
    recent = deque(maxlen=SMOOTHING)
    last_sent = None
    first = True

    try:
        async for message in websocket:
            if isinstance(message, bytes):
                message = message.decode("utf-8", errors="ignore")

            frame = parse_frame(message)
            if frame is None:
                continue

            if first:
                print("[STATUS] First frame received. Predicting...")
                first = False

            gesture_buffer.add_frame(frame)
            if not gesture_buffer.is_ready():
                continue

            window = gesture_buffer.get_flattened_window()
            proba = model.predict_proba(window)[0]
            idx = int(np.argmax(proba))
            prediction = str(model.classes_[idx])
            confidence = float(proba[idx])

            recent.append(prediction)
            if len(recent) < SMOOTHING:
                continue

            stable, votes = Counter(recent).most_common(1)[0]
            # send only when a new sign becomes stable (avoids spamming the same word)
            if votes >= SMOOTHING - 1 and stable != last_sent:
                last_sent = stable
                ts = datetime.now().strftime("%H:%M:%S")
                print(f"[{ts}] Sign: {stable} ({confidence:.0%})")
                await websocket.send(json.dumps({
                    "sign": stable,
                    "confidence": round(confidence, 3),
                    "time": ts,
                }))

    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        print(f"[!] Runtime error: {e}")
    finally:
        print("[-] Browser extension disconnected.")


async def main_websocket_server():
    print(f"[+] WebSocket server on ws://{WS_HOST}:{WS_PORT}  (Ctrl+C to stop)")
    async with websockets.serve(handler, WS_HOST, WS_PORT):
        await asyncio.Future()


if __name__ == "__main__":
    while True:
        print("\n=== VOICE OF SIGN - PIPELINE CONTROL ===")
        print("1. Collect Training Data (USB serial)")
        print("2. Train Machine Learning Model")
        print("3. Start Live Translation Server (WebSocket)")
        print("4. Exit")

        choice = input("Select an option (1-4): ").strip()

        if choice == "1":
            label = input("Name of the sign/word you are recording: ").strip()
            if label:
                collect_data(label)
        elif choice == "2":
            train_model()
        elif choice == "3":
            try:
                asyncio.run(main_websocket_server())
            except KeyboardInterrupt:
                print("\n[+] WebSocket server stopped.")
        elif choice == "4":
            print("Exiting. Goodbye!")
            break
        else:
            print("[!] Invalid option. Choose between 1 and 4.")