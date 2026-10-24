/**
 * KNOUX REC — canonical service registry.
 *
 * One place that states, for every service the product claims to offer: which
 * hub it belongs to, where it runs (execution mode), whether it actually works
 * today (status), which route runs it, and what is missing when it does not.
 *
 * This file is deliberately data-only so the discovery view, the dashboard and
 * the documentation can all read the same truth. `src/data/serviceRegistry.test.ts`
 * fails the build if an entry advertises a runnable service without a route, or
 * claims VERIFIED while its hub reports a weaker capability state.
 */

import { CAPABILITIES, type RouteId } from "../app/capabilities";

export type ServiceMode = "LOCAL" | "MODEL-LOCAL" | "HYBRID" | "ONLINE" | "UNAVAILABLE";

export type ServiceStatus =
  | "VERIFIED"
  | "IMPLEMENTED-NOT-VERIFIED"
  | "PARTIAL"
  | "BLOCKED"
  | "NOT-IMPLEMENTED";

export interface ServiceEntry {
  id: string;
  hub: HubId;
  labelEn: string;
  label: string;
  mode: ServiceMode;
  status: ServiceStatus;
  /** Route that runs the service. Absent means there is nothing to open. */
  route?: RouteId;
  /** True when the service is best opened through the shared Live Studio. */
  studio?: boolean;
  /** What is missing when the service cannot run. */
  needs?: string;
  keywords?: string[];
}

export type HubId =
  | "command"
  | "recording"
  | "screenshots"
  | "library"
  | "templates"
  | "toolbox"
  | "visual-patch"
  | "morphcore"
  | "elysian"
  | "body"
  | "offline-ai"
  | "arabic-ai"
  | "models"
  | "settings"
  | "diagnostics";

export interface Hub {
  id: HubId;
  labelEn: string;
  label: string;
  route: RouteId;
}

export const HUBS: Hub[] = [
  { id: "command", labelEn: "Command centre", label: "مركز القيادة", route: "dashboard" },
  { id: "recording", labelEn: "Recording studio", label: "استوديو التسجيل", route: "studio" },
  { id: "screenshots", labelEn: "Screenshot studio", label: "استوديو لقطات الشاشة", route: "screenshots" },
  { id: "library", labelEn: "Media library", label: "مكتبة الوسائط", route: "library" },
  { id: "templates", labelEn: "Creative motion", label: "القوالب المتحركة", route: "templates" },
  { id: "toolbox", labelEn: "Multimedia toolbox", label: "صندوق الأدوات", route: "toolbox" },
  { id: "visual-patch", labelEn: "Visual Patch Lab", label: "مختبر التعديل البصري", route: "visual-patch" },
  { id: "morphcore", labelEn: "MorphCore geometry", label: "هندسة مورف كور", route: "morphcore" },
  { id: "elysian", labelEn: "Elysian image studio", label: "لوحة إليسيان للصور", route: "elysian" },
  { id: "body", labelEn: "Body editor", label: "محرر الجسم", route: "body-editor" },
  { id: "offline-ai", labelEn: "Offline AI", label: "الذكاء المحلي", route: "offline-ai" },
  { id: "arabic-ai", labelEn: "Arabic AI tools", label: "أدوات الذكاء بالعربية", route: "arabic-ai" },
  { id: "models", labelEn: "Model manager", label: "مدير النماذج", route: "models" },
  { id: "settings", labelEn: "Settings", label: "الإعدادات", route: "settings" },
  { id: "diagnostics", labelEn: "Diagnostics", label: "التشخيص", route: "diagnostics" },
];

const entry = (item: ServiceEntry): ServiceEntry => item;

export const SERVICES: ServiceEntry[] = [
  /* ------------------------------------------------------------ command */
  entry({ id: "cmd-record", hub: "command", labelEn: "Start a screen recording", label: "بدء تسجيل الشاشة", mode: "LOCAL", status: "VERIFIED", route: "studio" }),
  entry({ id: "cmd-window", hub: "command", labelEn: "Record a window or tab", label: "تسجيل نافذة أو تبويب", mode: "LOCAL", status: "VERIFIED", route: "studio" }),
  entry({ id: "cmd-camera", hub: "command", labelEn: "Record with the webcam", label: "تسجيل بالكاميرا", mode: "LOCAL", status: "VERIFIED", route: "studio" }),
  entry({ id: "cmd-shot", hub: "command", labelEn: "Capture a screenshot", label: "التقاط صورة للشاشة", mode: "LOCAL", status: "VERIFIED", route: "screenshots" }),
  entry({ id: "cmd-audio", hub: "command", labelEn: "Standalone audio recording", label: "تسجيل صوتي مستقل", mode: "LOCAL", status: "NOT-IMPLEMENTED", needs: "An audio-only sink in the recording engine" }),
  entry({ id: "cmd-recent", hub: "command", labelEn: "Recent media and storage status", label: "الوسائط الأخيرة وحالة التخزين", mode: "LOCAL", status: "VERIFIED", route: "library" }),
  entry({ id: "cmd-jobs", hub: "command", labelEn: "Running media jobs", label: "مهام الوسائط الجارية", mode: "LOCAL", status: "VERIFIED", route: "live-studio" }),
  entry({ id: "cmd-discover", hub: "command", labelEn: "Find any service", label: "البحث عن أي خدمة", mode: "LOCAL", status: "VERIFIED", route: "discover", keywords: ["search", "palette", "بحث"] }),
  entry({ id: "cmd-workflows", hub: "command", labelEn: "One-click workflow chains", label: "سلاسل العمل بنقرة واحدة", mode: "LOCAL", status: "IMPLEMENTED-NOT-VERIFIED", route: "discover" }),

  /* ---------------------------------------------------------- recording */
  entry({ id: "rec-display", hub: "recording", labelEn: "Full display recording", label: "تسجيل الشاشة كاملة", mode: "LOCAL", status: "VERIFIED", route: "studio" }),
  entry({ id: "rec-pause", hub: "recording", labelEn: "Pause, resume and stop", label: "إيقاف مؤقت واستئناف وإنهاء", mode: "LOCAL", status: "VERIFIED", route: "studio" }),
  entry({ id: "rec-overlay", hub: "recording", labelEn: "Webcam overlay compositing", label: "دمج طبقة الكاميرا", mode: "LOCAL", status: "VERIFIED", route: "studio" }),
  entry({ id: "rec-system-audio", hub: "recording", labelEn: "System audio capture", label: "التقاط صوت النظام", mode: "LOCAL", status: "PARTIAL", route: "studio", needs: "Only when the platform offers a system-audio track" }),
  entry({ id: "rec-mic-only", hub: "recording", labelEn: "Microphone-only recording", label: "تسجيل الميكروفون فقط", mode: "LOCAL", status: "NOT-IMPLEMENTED", needs: "Audio sink in the recording engine" }),
  entry({ id: "rec-schedule", hub: "recording", labelEn: "Scheduled or delayed recording", label: "التسجيل المجدول أو المؤجل", mode: "LOCAL", status: "NOT-IMPLEMENTED", needs: "A timer over the existing session engine" }),
  entry({ id: "rec-presets", hub: "recording", labelEn: "Resolution and frame-rate presets", label: "ضوابط الدقة ومعدل الإطارات", mode: "LOCAL", status: "VERIFIED", route: "settings" }),
  entry({ id: "rec-trim", hub: "recording", labelEn: "Trim after capture", label: "قص التسجيل بعد الالتقاط", mode: "LOCAL", status: "VERIFIED", route: "library", studio: true }),

  /* -------------------------------------------------------- screenshots */
  entry({ id: "shot-capture", hub: "screenshots", labelEn: "Capture the display", label: "التقاط الشاشة", mode: "LOCAL", status: "VERIFIED", route: "screenshots" }),
  entry({ id: "shot-crop", hub: "screenshots", labelEn: "Crop by dragging a region", label: "قص بمنطقة السحب", mode: "LOCAL", status: "VERIFIED", route: "screenshots" }),
  entry({ id: "shot-annotate", hub: "screenshots", labelEn: "Arrows, shapes, highlight and text", label: "أسهم وأشكال وإبراز ونص", mode: "LOCAL", status: "VERIFIED", route: "screenshots" }),
  entry({ id: "shot-redact", hub: "screenshots", labelEn: "Pixelate or blur a sensitive region", label: "تمويه أو بكسلة منطقة حساسة", mode: "LOCAL", status: "VERIFIED", route: "screenshots" }),
  entry({ id: "shot-history", hub: "screenshots", labelEn: "Undo, redo and before/after", label: "تراجع وإعادة ومقارنة", mode: "LOCAL", status: "VERIFIED", route: "screenshots" }),
  entry({ id: "shot-export", hub: "screenshots", labelEn: "Save as new image and export PNG", label: "حفظ كصورة جديدة وتصدير", mode: "LOCAL", status: "VERIFIED", route: "screenshots" }),
  entry({ id: "shot-os-region", hub: "screenshots", labelEn: "OS-level window or region picker", label: "منتقي النافذة أو المنطقة من النظام", mode: "LOCAL", status: "NOT-IMPLEMENTED", needs: "Native window enumeration in the desktop bridge" }),
  entry({ id: "shot-delay", hub: "screenshots", labelEn: "Delayed capture", label: "التقاط مؤجل", mode: "LOCAL", status: "NOT-IMPLEMENTED", needs: "A countdown over the existing capture path" }),

  /* ------------------------------------------------------------ library */
  entry({ id: "lib-store", hub: "library", labelEn: "Local IndexedDB storage with real blobs", label: "تخزين محلي مع ملفات حقيقية", mode: "LOCAL", status: "VERIFIED", route: "library" }),
  entry({ id: "lib-preview", hub: "library", labelEn: "Preview and playback", label: "المعاينة والتشغيل", mode: "LOCAL", status: "VERIFIED", route: "library" }),
  entry({ id: "lib-search", hub: "library", labelEn: "Search, filter, sort and favourites", label: "بحث وتصفية وفرز ومفضلات", mode: "LOCAL", status: "VERIFIED", route: "library" }),
  entry({ id: "lib-rename", hub: "library", labelEn: "Rename and delete with confirmation", label: "إعادة تسمية وحذف بتأكيد", mode: "LOCAL", status: "VERIFIED", route: "library" }),
  entry({ id: "lib-export", hub: "library", labelEn: "Export the original file", label: "تصدير الملف الأصلي", mode: "LOCAL", status: "VERIFIED", route: "library" }),
  entry({ id: "lib-trim", hub: "library", labelEn: "Trim a recording in place", label: "قص التسجيل", mode: "LOCAL", status: "VERIFIED", route: "library", studio: true }),
  entry({ id: "lib-collections", hub: "library", labelEn: "Collections and batch export", label: "المجموعات والتصدير الجماعي", mode: "LOCAL", status: "NOT-IMPLEMENTED", needs: "A collection store over the same library" }),
  entry({ id: "lib-open-editor", hub: "library", labelEn: "Open an item in an editor", label: "فتح عنصر في محرر", mode: "LOCAL", status: "PARTIAL", route: "library", needs: "Cross-links exist for Visual Patch only" }),

  /* ---------------------------------------------------------- templates */
  entry({ id: "tpl-renderers", hub: "templates", labelEn: "Five real motion renderers", label: "خمسة محركات رسم حقيقية", mode: "LOCAL", status: "VERIFIED", route: "templates" }),
  entry({ id: "tpl-customise", hub: "templates", labelEn: "Customise text and colour into pixels", label: "تخصيص النص واللون", mode: "LOCAL", status: "VERIFIED", route: "templates", studio: true }),
  entry({ id: "tpl-video", hub: "templates", labelEn: "Export template video (WebM)", label: "تصدير فيديو القالب", mode: "LOCAL", status: "VERIFIED", route: "templates", studio: true }),
  entry({ id: "tpl-stills", hub: "templates", labelEn: "Export template stills (PNG)", label: "تصدير صور ثابتة", mode: "LOCAL", status: "VERIFIED", route: "templates" }),
  entry({ id: "tpl-gallery", hub: "templates", labelEn: "Gallery with real thumbnails", label: "معرض مصغّرات حقيقي", mode: "LOCAL", status: "VERIFIED", route: "templates" }),
  entry({ id: "tpl-dev-catalog", hub: "templates", labelEn: "51 development catalogue entries", label: "٥١ مدخلاً تطويريًا", mode: "UNAVAILABLE", status: "BLOCKED", route: "templates", needs: "Placeholders kept in a separate, clearly labelled section" }),

  /* ------------------------------------------------------------ toolbox */
  entry({ id: "tb-resize", hub: "toolbox", labelEn: "Image resize", label: "تغيير حجم الصورة", mode: "LOCAL", status: "VERIFIED", route: "toolbox", studio: true }),
  entry({ id: "tb-filters", hub: "toolbox", labelEn: "Image filters", label: "مرشحات الصورة", mode: "LOCAL", status: "VERIFIED", route: "toolbox", studio: true }),
  entry({ id: "tb-convert", hub: "toolbox", labelEn: "Format conversion (PNG / JPEG / WebP)", label: "تحويل الصيغ", mode: "LOCAL", status: "VERIFIED", route: "toolbox", studio: true }),
  entry({ id: "tb-rotate", hub: "toolbox", labelEn: "Rotate and flip", label: "تدوير وقلب", mode: "LOCAL", status: "VERIFIED", route: "toolbox" }),
  entry({ id: "tb-crop", hub: "toolbox", labelEn: "Crop", label: "قص", mode: "LOCAL", status: "VERIFIED", route: "toolbox" }),
  entry({ id: "tb-pixelate", hub: "toolbox", labelEn: "Pixelate", label: "تكعيب", mode: "LOCAL", status: "VERIFIED", route: "toolbox" }),
  entry({ id: "tb-thumbnail", hub: "toolbox", labelEn: "Video thumbnail", label: "صورة مصغرة للفيديو", mode: "LOCAL", status: "VERIFIED", route: "toolbox" }),
  entry({ id: "tb-waveform", hub: "toolbox", labelEn: "Audio waveform poster", label: "ملصق الموجة الصوتية", mode: "LOCAL", status: "VERIFIED", route: "toolbox", studio: true }),
  entry({ id: "tb-text-image", hub: "toolbox", labelEn: "Text to image", label: "النص إلى صورة", mode: "LOCAL", status: "VERIFIED", route: "toolbox" }),
  entry({ id: "tb-qr", hub: "toolbox", labelEn: "QR code generator", label: "مولّد رموز QR", mode: "LOCAL", status: "VERIFIED", route: "toolbox" }),
  entry({ id: "tb-palette", hub: "toolbox", labelEn: "Colour palette extraction", label: "استخراج لوحة الألوان", mode: "LOCAL", status: "VERIFIED", route: "toolbox" }),
  entry({ id: "tb-compress", hub: "toolbox", labelEn: "Image compressor", label: "ضغط الصور", mode: "LOCAL", status: "NOT-IMPLEMENTED", needs: "A verified encoder preset with measured output" }),
  entry({ id: "tb-batch", hub: "toolbox", labelEn: "Batch resize and convert", label: "المعالجة الجماعية", mode: "LOCAL", status: "NOT-IMPLEMENTED", needs: "A job queue over the existing processors" }),
  entry({ id: "tb-frames", hub: "toolbox", labelEn: "Video frames and contact sheet", label: "إطارات الفيديو والملصق", mode: "LOCAL", status: "NOT-IMPLEMENTED", needs: "A seekable decode pipeline" }),
  entry({ id: "tb-audio-tools", hub: "toolbox", labelEn: "Audio trim, reverse, normalise, filters", label: "أدوات الصوت", mode: "LOCAL", status: "NOT-IMPLEMENTED", needs: "Verified DSP processors with byte checks" }),

  /* ------------------------------------------------------- visual patch */
  entry({ id: "vp-paint", hub: "visual-patch", labelEn: "Paint a region and apply a tool", label: "تلوين منطقة وتطبيق أداة", mode: "LOCAL", status: "VERIFIED", route: "visual-patch" }),
  entry({ id: "vp-history", hub: "visual-patch", labelEn: "Undo, redo, reset, before/after", label: "تراجع وإعادة وضبط ومقارنة", mode: "LOCAL", status: "VERIFIED", route: "visual-patch" }),
  entry({ id: "vp-export", hub: "visual-patch", labelEn: "Verified PNG export to the library", label: "تصدير PNG موثّق للمكتبة", mode: "LOCAL", status: "VERIFIED", route: "visual-patch" }),
  entry({ id: "vp-families", hub: "visual-patch", labelEn: "All 50 catalogue tool families tested", label: "فحص كل عائلات الأدوات", mode: "LOCAL", status: "PARTIAL", route: "visual-patch", needs: "One tool family is driven end to end; the rest share the engine" }),
  entry({ id: "vp-mask", hub: "visual-patch", labelEn: "Rectangle, freehand and mask editing", label: "تحرير الأقنعة والتحديد", mode: "LOCAL", status: "PARTIAL", route: "visual-patch", needs: "Freehand selection and mask refinement" }),

  /* ---------------------------------------------------------- morphcore */
  entry({ id: "mc-stretch", hub: "morphcore", labelEn: "Independent stretch and scale", label: "تمدد وتحجيم مستقل", mode: "LOCAL", status: "VERIFIED", route: "morphcore" }),
  entry({ id: "mc-rotate", hub: "morphcore", labelEn: "Free rotation with mirrors", label: "تدوير حر مع قلب", mode: "LOCAL", status: "VERIFIED", route: "morphcore" }),
  entry({ id: "mc-pinch", hub: "morphcore", labelEn: "Pinch and bulge", label: "انقباض وانتفاخ", mode: "LOCAL", status: "VERIFIED", route: "morphcore" }),
  entry({ id: "mc-perspective", hub: "morphcore", labelEn: "Trapezoid perspective", label: "منظور شبه منحرف", mode: "LOCAL", status: "VERIFIED", route: "morphcore" }),
  entry({ id: "mc-warp", hub: "morphcore", labelEn: "Sine wave warp", label: "تمويج جيبي", mode: "LOCAL", status: "VERIFIED", route: "morphcore" }),
  entry({ id: "mc-mesh", hub: "morphcore", labelEn: "Mesh warp with draggable points", label: "شبكة انحناء بنقاط قابلة للسحب", mode: "LOCAL", status: "NOT-IMPLEMENTED", needs: "A mesh solver and control-point overlay" }),
  entry({ id: "mc-body", hub: "morphcore", labelEn: "Body-aware deformation (legacy catalogue)", label: "تشويه واعٍ بالجسم", mode: "MODEL-LOCAL", status: "BLOCKED", route: "morphcore", needs: "Segmentation weights and a native morphology engine" }),

  /* ------------------------------------------------------------ elysian */
  entry({ id: "el-layers", hub: "elysian", labelEn: "Non-destructive layer stack with history", label: "طبقات غير مدمرة مع السجل", mode: "LOCAL", status: "VERIFIED", route: "elysian" }),
  entry({ id: "el-geometry", hub: "elysian", labelEn: "Crop, resize, rotate and flip", label: "قص وتحجيم وتدوير وقلب", mode: "LOCAL", status: "VERIFIED", route: "elysian" }),
  entry({ id: "el-light", hub: "elysian", labelEn: "Exposure, brightness, contrast, gamma, vignette", label: "تعريض وسطوع وتباين وجاما وتظليل", mode: "LOCAL", status: "VERIFIED", route: "elysian" }),
  entry({ id: "el-colour", hub: "elysian", labelEn: "Saturation and temperature", label: "التشبع ودرجة الحرارة", mode: "LOCAL", status: "VERIFIED", route: "elysian" }),
  entry({ id: "el-detail", hub: "elysian", labelEn: "Blur, unsharp mask and pixelate", label: "تمويه وحدّة وتكعيب", mode: "LOCAL", status: "VERIFIED", route: "elysian" }),
  entry({ id: "el-marks", hub: "elysian", labelEn: "Borders, text and tiled watermarks", label: "إطارات ونص وعلامات مائية", mode: "LOCAL", status: "VERIFIED", route: "elysian" }),
  entry({ id: "el-presets", hub: "elysian", labelEn: "Eight presets as editable layers", label: "ثمانية إعدادات جاهزة قابلة للتحرير", mode: "LOCAL", status: "VERIFIED", route: "elysian" }),
  entry({ id: "el-output", hub: "elysian", labelEn: "PNG, JPEG and WebP output with measured size", label: "خرج PNG وJPEG وWebP بحجم مقاس", mode: "LOCAL", status: "VERIFIED", route: "elysian" }),
  entry({ id: "el-curves", hub: "elysian", labelEn: "Tone curves and histogram", label: "منحنيات اللون والمدرج", mode: "LOCAL", status: "NOT-IMPLEMENTED", needs: "A curve editor over the same pipeline" }),
  entry({ id: "el-retouch", hub: "elysian", labelEn: "Neural retouch and background removal", label: "التنعيم العصبي وإزالة الخلفية", mode: "MODEL-LOCAL", status: "BLOCKED", route: "elysian", needs: "Face-parsing and segmentation weights are not installed" }),
  entry({ id: "el-upscale", hub: "elysian", labelEn: "Super resolution", label: "رفع الدقة العصبي", mode: "MODEL-LOCAL", status: "BLOCKED", route: "models", needs: "An upscaler weight file" }),
  entry({ id: "el-generative", hub: "elysian", labelEn: "Generative fill", label: "التعبئة التوليدية", mode: "ONLINE", status: "BLOCKED", route: "elysian", needs: "An online service; this build never uploads images" }),

  /* --------------------------------------------------------------- body */
  entry({ id: "body-manual", hub: "body", labelEn: "Manual geometric editing", label: "التحرير الهندسي اليدوي", mode: "LOCAL", status: "VERIFIED", route: "morphcore" }),
  entry({ id: "body-segment", hub: "body", labelEn: "Segmentation and pose tools", label: "أدوات التقسيم والوضعية", mode: "MODEL-LOCAL", status: "BLOCKED", route: "body-editor", needs: "Segmentation and pose weights plus a native engine" }),

  /* --------------------------------------------------------- offline ai */
  entry({ id: "ai-runtime", hub: "offline-ai", labelEn: "Local inference runtime with real execution", label: "تشغيل الاستدلال المحلي", mode: "MODEL-LOCAL", status: "PARTIAL", route: "offline-ai", needs: "The runtime executes; most catalogue entries still have no weight file" }),
  entry({ id: "ai-transcribe", hub: "offline-ai", labelEn: "Speech to text", label: "تفريغ الصوت إلى نص", mode: "MODEL-LOCAL", status: "BLOCKED", route: "models", needs: "A Whisper-class model" }),
  entry({ id: "ai-ocr", hub: "offline-ai", labelEn: "Optical character recognition", label: "التعرف الضوئي على الحروف", mode: "MODEL-LOCAL", status: "BLOCKED", route: "models", needs: "An OCR model" }),

  /* ---------------------------------------------------------- arabic ai */
  entry({ id: "ar-tools", hub: "arabic-ai", labelEn: "Arabic text utilities", label: "أدوات النصوص العربية", mode: "LOCAL", status: "PARTIAL", route: "arabic-ai", needs: "Deterministic utilities run; model-backed tasks need weights" }),
  entry({ id: "ar-model", hub: "arabic-ai", labelEn: "Arabic language model tasks", label: "مهام نموذج اللغة العربي", mode: "MODEL-LOCAL", status: "BLOCKED", route: "models", needs: "A quantified Arabic model bundle" }),

  /* ------------------------------------------------------------- models */
  entry({ id: "models-inventory", hub: "models", labelEn: "Model manifest inventory", label: "جرد بيانات النماذج", mode: "LOCAL", status: "VERIFIED", route: "models" }),
  entry({ id: "models-validate", hub: "models", labelEn: "Validate a local weight file against its manifest", label: "تحقق من ملف أوزان محلي", mode: "LOCAL", status: "VERIFIED", route: "models" }),
  entry({ id: "models-download", hub: "models", labelEn: "Download weights inside the app", label: "تنزيل الأوزان من داخل التطبيق", mode: "ONLINE", status: "NOT-IMPLEMENTED", needs: "An explicit user-approved download path; nothing is fetched silently" }),

  /* ----------------------------------------------------------- settings */
  entry({ id: "set-theme", hub: "settings", labelEn: "Theme, language and motion preferences", label: "السمة واللغة والحركة", mode: "LOCAL", status: "VERIFIED", route: "settings" }),
  entry({ id: "set-hotkeys", hub: "settings", labelEn: "Hotkey configuration", label: "ضبط مفاتيح الاختصار", mode: "LOCAL", status: "PARTIAL", route: "settings", needs: "Fixed shortcuts work; remapping is not implemented" }),
  entry({ id: "set-storage", hub: "settings", labelEn: "Storage location and quota", label: "موقع التخزين والحصة", mode: "LOCAL", status: "VERIFIED", route: "settings" }),

  /* -------------------------------------------------------- diagnostics */
  entry({ id: "diag-runtime", hub: "diagnostics", labelEn: "Measured runtime facts", label: "حقائق التشغيل المقاسة", mode: "LOCAL", status: "VERIFIED", route: "diagnostics" }),
  entry({ id: "diag-bridge", hub: "diagnostics", labelEn: "Desktop bridge probe", label: "فحص جسر سطح المكتب", mode: "LOCAL", status: "VERIFIED", route: "diagnostics" }),
];

export function servicesForHub(hub: HubId): ServiceEntry[] {
  return SERVICES.filter((service) => service.hub === hub);
}

export function isRunnable(service: ServiceEntry): boolean {
  return Boolean(service.route) && service.status !== "NOT-IMPLEMENTED" && service.status !== "BLOCKED";
}

export function searchServices(query: string): ServiceEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return SERVICES;
  const terms = needle.split(/\s+/).filter(Boolean);
  return SERVICES.filter((service) => {
    const haystack = [
      service.labelEn,
      service.label,
      service.hub,
      service.mode,
      service.status,
      service.needs ?? "",
      service.id,
      ...(service.keywords ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * Cross-check used by the tests: a service may only be advertised as runnable
 * when a route exists and that route's own capability state is not worse than
 * the service claims.
 */
export function auditRegistry(): string[] {
  const problems: string[] = [];
  for (const service of SERVICES) {
    if (service.status === "VERIFIED" && !service.route) {
      problems.push(`${service.id}: VERIFIED without a route`);
    }
    if ((service.status === "BLOCKED" || service.status === "NOT-IMPLEMENTED") && !service.needs) {
      problems.push(`${service.id}: ${service.status} without a stated dependency`);
    }
    if (service.mode === "UNAVAILABLE" && service.status === "VERIFIED") {
      problems.push(`${service.id}: UNAVAILABLE mode cannot be VERIFIED`);
    }
    if (service.route && service.route !== "discover" && !CAPABILITIES[service.route as RouteId]) {
      problems.push(`${service.id}: unknown route ${service.route}`);
    }
  }
  return problems;
}
