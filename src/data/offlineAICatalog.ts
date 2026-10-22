export interface OfflineAICatalogEntry {
  id: string;
  name: string;
  nameEn: string;
  category: string;
  modelPath: string;
  modelSize: number;
}

/**
 * Catalog metadata extracted from services/offlineAIToolsService.ts.
 * Kept static so browsing the catalog never instantiates an inference service.
 */
export const OFFLINE_AI_CATALOG: OfflineAICatalogEntry[] = [
  {
    "id": "remove_background",
    "name": "إزالة الخلفية",
    "nameEn": "Remove Background",
    "category": "image",
    "modelPath": "/models/u2net/model.json",
    "modelSize": 95
  },
  {
    "id": "upscale_image",
    "name": "تكبير الصور",
    "nameEn": "Image Upscaler",
    "category": "image",
    "modelPath": "/models/real_esrgan/model.json",
    "modelSize": 150
  },
  {
    "id": "enhance_image",
    "name": "تحسين جودة الصور",
    "nameEn": "Photo Enhancer",
    "category": "image",
    "modelPath": "/models/real_esrgan/model.json",
    "modelSize": 150
  },
  {
    "id": "detect_objects",
    "name": "كشف الأجسام",
    "nameEn": "Object Detection",
    "category": "image",
    "modelPath": "/models/yolo/model.json",
    "modelSize": 45
  },
  {
    "id": "detect_faces",
    "name": "كشف الوجوه",
    "nameEn": "Face Detection",
    "category": "image",
    "modelPath": "/models/face_detection/model.json",
    "modelSize": 10
  },
  {
    "id": "face_swap",
    "name": "تبديل الوجوه",
    "nameEn": "Face Swap",
    "category": "image",
    "modelPath": "/models/simswap/model.json",
    "modelSize": 320
  },
  {
    "id": "colorize_image",
    "name": "تلوين الصور القديمة",
    "nameEn": "Colorize Old Photos",
    "category": "image",
    "modelPath": "/models/stable_diffusion/model.json",
    "modelSize": 2560
  },
  {
    "id": "toonify_image",
    "name": "تحويل إلى رسمة",
    "nameEn": "Toonify Image",
    "category": "image",
    "modelPath": "/models/stable_diffusion/model.json",
    "modelSize": 2560
  },
  {
    "id": "enhance_face",
    "name": "تحسين الوجه والجلد",
    "nameEn": "Face Enhancement",
    "category": "image",
    "modelPath": "/models/real_esrgan/model.json",
    "modelSize": 150
  },
  {
    "id": "edge_detection",
    "name": "كشف الحواف والتفاصيل",
    "nameEn": "Edge Detection",
    "category": "image",
    "modelPath": "/models/yolo/model.json",
    "modelSize": 45
  },
  {
    "id": "track_objects",
    "name": "تتبع الأجسام",
    "nameEn": "Object Tracking",
    "category": "video",
    "modelPath": "/models/yolo/model.json",
    "modelSize": 45
  },
  {
    "id": "extract_scenes",
    "name": "استخراج المشاهد",
    "nameEn": "Scene Extraction",
    "category": "video",
    "modelPath": "/models/scenecut/model.json",
    "modelSize": 50
  },
  {
    "id": "stabilize_video",
    "name": "تثبيت الفيديو",
    "nameEn": "Video Stabilization",
    "category": "video",
    "modelPath": "/models/yolo/model.json",
    "modelSize": 45
  },
  {
    "id": "enhance_video",
    "name": "تحسين جودة الفيديو",
    "nameEn": "Video Enhancement",
    "category": "video",
    "modelPath": "/models/real_esrgan/model.json",
    "modelSize": 150
  },
  {
    "id": "detect_motion",
    "name": "كشف الحركة",
    "nameEn": "Motion Detection",
    "category": "video",
    "modelPath": "/models/yolo/model.json",
    "modelSize": 45
  },
  {
    "id": "analyze_fps",
    "name": "تحليل معدل الإطارات",
    "nameEn": "FPS Analyzer",
    "category": "video",
    "modelPath": "/models/scenecut/model.json",
    "modelSize": 50
  },
  {
    "id": "extract_audio",
    "name": "استخراج الصوت",
    "nameEn": "Audio Extraction",
    "category": "video",
    "modelPath": "/models/whisper/model.json",
    "modelSize": 85
  },
  {
    "id": "video_filters",
    "name": "فلاتر الفيديو",
    "nameEn": "Video Filters",
    "category": "video",
    "modelPath": "/models/stable_diffusion/model.json",
    "modelSize": 2560
  },
  {
    "id": "extract_faces_video",
    "name": "استخراج الوجوه من الفيديو",
    "nameEn": "Video Face Extraction",
    "category": "video",
    "modelPath": "/models/face_detection/model.json",
    "modelSize": 10
  },
  {
    "id": "extract_frames",
    "name": "تحويل فيديو إلى صور",
    "nameEn": "Frame Extraction",
    "category": "video",
    "modelPath": "/models/scenecut/model.json",
    "modelSize": 50
  },
  {
    "id": "separate_audio",
    "name": "فصل الصوت والموسيقى",
    "nameEn": "Audio Separation",
    "category": "audio",
    "modelPath": "/models/spleeter/model.json",
    "modelSize": 150
  },
  {
    "id": "enhance_voice",
    "name": "تحسين الصوت البشري",
    "nameEn": "Voice Enhancement",
    "category": "audio",
    "modelPath": "/models/rnnoise/model.json",
    "modelSize": 15
  },
  {
    "id": "detect_silence",
    "name": "كشف فترات الصمت",
    "nameEn": "Silence Detection",
    "category": "audio",
    "modelPath": "/models/beat_detector/model.json",
    "modelSize": 25
  },
  {
    "id": "speech_to_text",
    "name": "تحويل الكلام إلى نص",
    "nameEn": "Speech to Text",
    "category": "audio",
    "modelPath": "/models/whisper/model.json",
    "modelSize": 85
  },
  {
    "id": "change_pitch",
    "name": "تغيير نغمة الصوت",
    "nameEn": "Voice Pitch Changer",
    "category": "audio",
    "modelPath": "/models/sovits/model.json",
    "modelSize": 220
  },
  {
    "id": "generate_spectrogram",
    "name": "توليد طيف ترددي",
    "nameEn": "Spectrogram Generator",
    "category": "audio",
    "modelPath": "/models/beat_detector/model.json",
    "modelSize": 25
  },
  {
    "id": "noise_profiler",
    "name": "محلل الضوضاء",
    "nameEn": "Noise Profiler",
    "category": "audio",
    "modelPath": "/models/rnnoise/model.json",
    "modelSize": 15
  },
  {
    "id": "reverse_audio",
    "name": "عكس الصوت",
    "nameEn": "Audio Reversal",
    "category": "audio",
    "modelPath": "/models/beat_detector/model.json",
    "modelSize": 25
  },
  {
    "id": "frequency_filter",
    "name": "مرشح الترددات",
    "nameEn": "Frequency Filter",
    "category": "audio",
    "modelPath": "/models/rnnoise/model.json",
    "modelSize": 15
  },
  {
    "id": "audio_converter",
    "name": "محول الصوت",
    "nameEn": "Audio Converter",
    "category": "audio",
    "modelPath": "/models/beat_detector/model.json",
    "modelSize": 25
  },
  {
    "id": "ocr_extract",
    "name": "استخراج النص من الصور",
    "nameEn": "OCR Text Extraction",
    "category": "text",
    "modelPath": "/models/whisper/model.json",
    "modelSize": 85
  },
  {
    "id": "text_summarizer",
    "name": "ملخص النصوص",
    "nameEn": "Text Summarizer",
    "category": "text",
    "modelPath": "/models/gpt4all/model.json",
    "modelSize": 120
  },
  {
    "id": "sentiment_analysis",
    "name": "تحليل المشاعر",
    "nameEn": "Sentiment Analysis",
    "category": "text",
    "modelPath": "/models/gpt4all/model.json",
    "modelSize": 120
  },
  {
    "id": "local_speech_to_text",
    "name": "تحويل الكلام المحلي",
    "nameEn": "Local Speech to Text",
    "category": "text",
    "modelPath": "/models/whisper/model.json",
    "modelSize": 85
  },
  {
    "id": "text_generator",
    "name": "مولد النصوص",
    "nameEn": "Text Generator",
    "category": "text",
    "modelPath": "/models/gpt4all/model.json",
    "modelSize": 120
  },
  {
    "id": "language_detector",
    "name": "كاشف اللغة",
    "nameEn": "Language Detector",
    "category": "text",
    "modelPath": "/models/m2m100/model.json",
    "modelSize": 420
  },
  {
    "id": "document_classifier",
    "name": "مصنف الوثائق",
    "nameEn": "Document Classifier",
    "category": "text",
    "modelPath": "/models/gpt4all/model.json",
    "modelSize": 120
  },
  {
    "id": "file_analyzer",
    "name": "محلل الملفات الشامل",
    "nameEn": "Comprehensive File Analyzer",
    "category": "analysis",
    "modelPath": "/models/yolo/model.json",
    "modelSize": 45
  }
];
