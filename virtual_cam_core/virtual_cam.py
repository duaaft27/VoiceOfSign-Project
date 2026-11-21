import cv2
import numpy as np
import pyvirtualcam

# فتح الكاميرا الحقيقية (الرقم 0 عادة هو كاميرا الويب الأساسية)
cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

# النص المراد عرضه (الذي سيأتي لاحقاً من الـ ESP32 عبر البلوتوث)
subtitle_text = "Voice of Sign: Initializing Translation..."

# تشغيل الكاميرا الافتراضية بنفس أبعاد ودقة الكاميرا الحقيقية
with pyvirtualcam.Camera(width=width, height=height, fps=30) as cam:
    print(f"Virtual camera started: {cam.device}")
    
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        # قلب الصورة أفقياً لتبدو مألوفة للمستخدم (Mirror effect)
        frame = cv2.flip(frame, 1)

        # رسم خلفية شريط الترجمة (مستطيل أسفلي شفّاف نسبياً)
        overlay = frame.copy()
        cv2.rectangle(overlay, (int(width * 0.1), height - 130), (int(width * 0.9), height - 50), (0, 0, 0), -1)
        alpha = 0.75  # درجة الشفافية
        
        # [تم التصحيح هنا: إضافة علامة الضرب * قبل alpha]
        frame = cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0)

        # إطار شريط الترجمة بلون مميز
        cv2.rectangle(frame, (int(width * 0.1), height - 130), (int(width * 0.9), height - 50), (0, 210, 211), 2)

        # كتابة النص داخل الشريط
        cv2.putText(frame, subtitle_text, (int(width * 0.15), height - 80), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)

        # تحويل الألوان من BGR إلى RGB لأن الكاميرا الافتراضية تتطلب RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # إرسال الفريم المعالج إلى الكاميرا الافتراضية
        cam.send(frame_rgb)
        cam.sleep_until_next_frame()

cap.release()