#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_MPU6050.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// --- UUIDs المعتمدة للبلوتوث ---
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a5"

// --- منافذ الحساسات والزر (مطابقة لتوثيق Sprint 1) ---
const int THUMB_PIN  = 39; // IO39 (ADC1)
const int INDEX_PIN  = 36; // IO36 (ADC1)
const int MIDDLE_PIN = 34; // IO34 (ADC1)
const int RING_PIN   = 4;  // IO4  (ADC2 - يتعارض مع الواي فاي فقط، يعمل مع BLE)
const int PINKY_PIN  = 35; // IO35 (ADC1)
const int BUTTON_PIN = 23; // IO23 (زر المحادثة والتحكم المحلي)

const unsigned long SAMPLE_INTERVAL_MS = 50;  // 20Hz
const unsigned long DEBOUNCE_MS        = 300;

Adafruit_MPU6050 mpu;
bool mpuReady = false;

BLECharacteristic *pCharacteristic = nullptr;
volatile bool deviceConnected = false;
volatile bool needRestartAdvertising = false;

int lastButtonState = HIGH;
unsigned long lastButtonTime = 0;
unsigned long lastSampleTime = 0;

// NOTE: the correct callback names are onConnect / onDisconnect.
// `override` makes the compiler catch any naming mistake.
class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *pServer) override {
    deviceConnected = true;
    Serial.println("[BLE] Client connected");
  }

  void onDisconnect(BLEServer *pServer) override {
    deviceConnected = false;
    needRestartAdvertising = true;   // handled in loop(), no delay() inside a callback
    Serial.println("[BLE] Client disconnected");
  }
};

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // مستشعر الحركة I2C (SDA=21, SCL=22)
  Wire.begin(21, 22);
  if (mpu.begin()) {
    mpuReady = true;
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  } else {
    Serial.println("MPU6050 not found! Check wiring. (accZ will be sent as 0)");
  }

  // --- تهيئة خادم البلوتوث BLE ---
  BLEDevice::init("VoiceOfSign_Glove");
  BLEDevice::setMTU(247);   // allow notifications longer than 20 bytes (must come after init)

  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristic->addDescriptor(new BLE2902());
  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.println("=== Voice of Sign: BLE Firmware Ready ===");
}

void loop() {
  unsigned long now = millis();

  // إعادة الإعلان بعد قطع الاتصال
  if (needRestartAdvertising) {
    needRestartAdvertising = false;
    delay(300);                       // give the BLE stack time to clean up
    BLEDevice::startAdvertising();
    Serial.println("[BLE] Advertising restarted");
  }

  // 1. الزر المحلي (non-blocking debounce)
  int currentButtonState = digitalRead(BUTTON_PIN);
  if (currentButtonState == LOW && lastButtonState == HIGH &&
      now - lastButtonTime > DEBOUNCE_MS) {
    lastButtonTime = now;
    Serial.println("BTN_PRESSED");  // read by quick_launch.py over USB serial
    if (deviceConnected) {
      pCharacteristic->setValue("BTN_PRESSED");
      pCharacteristic->notify();
    }
  }
  lastButtonState = currentButtonState;

  // 2. بث بيانات الحساسات بمعدل 20Hz
  if (deviceConnected && now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    lastSampleTime = now;

    int thumb  = analogRead(THUMB_PIN);
    int index  = analogRead(INDEX_PIN);
    int middle = analogRead(MIDDLE_PIN);
    int ring   = analogRead(RING_PIN);
    int pinky  = analogRead(PINKY_PIN);

    float accZ = 0.0f;
    if (mpuReady) {
      sensors_event_t a, g, temp;
      mpu.getEvent(&a, &g, &temp);
      accZ = a.acceleration.z;
    }

    // "thumb,index,middle,ring,pinky,accZ"  (max ~30 chars)
    String payload = String(thumb) + "," + String(index) + "," + String(middle) + "," +
                     String(ring) + "," + String(pinky) + "," + String(accZ, 2);

    pCharacteristic->setValue(payload.c_str());
    pCharacteristic->notify();
  }

  delay(5);  // yield without blocking the sample timing
}