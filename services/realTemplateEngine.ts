// KNOUX REC - Real Template Engine
// محرك القوالب الحقيقية والقابلة للاستخدام

export interface RealTemplateElement {
  id: string;
  type: "text" | "image" | "video" | "audio" | "shape" | "animation" | "effect";
  name: string;
  position: { x: number; y: number; z?: number };
  size: { width: number; height: number };
  rotation?: number;
  opacity?: number;
  visible: boolean;
  locked: boolean;
  duration?: { start: number; end: number };
  properties: Record<string, any>;
  animations?: AnimationKeyframe[];
}

export interface AnimationKeyframe {
  time: number;
  properties: Record<string, any>;
  easing?: "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";
}

export interface RealTemplate {
  id: string;
  name: string;
  description: string;
  category:
    | "intro"
    | "outro"
    | "lower-third"
    | "transition"
    | "overlay"
    | "background";
  duration: number;
  resolution: { width: number; height: number };
  fps: number;
  elements: RealTemplateElement[];
  audioTrack?: {
    file?: string;
    volume: number;
    loop: boolean;
    fadeIn?: number;
    fadeOut?: number;
  };
  metadata: {
    createdAt: number;
    updatedAt: number;
    author: string;
    version: string;
    tags: string[];
    thumbnail?: string;
  };
  customizable: {
    texts: string[];
    images: string[];
    colors: string[];
    fonts: string[];
  };
}

export interface TemplateRenderSettings {
  resolution: { width: number; height: number };
  fps: number;
  quality: "draft" | "preview" | "high" | "export";
  format: "mp4" | "webm" | "gif" | "png-sequence";
  backgroundColor?: string;
}

export class RealTemplateEngine {
  private templates: Map<string, RealTemplate> = new Map();
  private renderCanvas!: HTMLCanvasElement;
  private renderContext!: CanvasRenderingContext2D;
  private loadedAssets: Map<string, any> = new Map();
  /** Playhead used by the time-aware renderer (seconds). */
  private renderTime = 0;

  constructor() {
    this.initializeCanvas();
    this.loadRealTemplates();
  }

  // تهيئة لوحة الرسم
  private initializeCanvas(): void {
    this.renderCanvas = document.createElement("canvas");
    this.renderCanvas.width = 1920;
    this.renderCanvas.height = 1080;

    const context = this.renderCanvas.getContext("2d");
    if (!context) {
      throw new Error("فشل في إنشاء سياق الرسم");
    }

    this.renderContext = context;
    this.renderContext.imageSmoothingEnabled = true;
    this.renderContext.imageSmoothingQuality = "high";
  }

  // تحميل القوالب الحقيقية
  private async loadRealTemplates(): Promise<void> {
    const realTemplates = [
      this.createIntroTemplate(),
      this.createOutroTemplate(),
      this.createLowerThirdTemplate(),
      this.createTransitionTemplate(),
      this.createOverlayTemplate(),
    ];

    realTemplates.forEach((template) => {
      this.templates.set(template.id, template);
    });

    console.log(`✅ تم تحميل ${realTemplates.length} قالب حقيقي`);
  }

  // إنشاء قالب مقدمة احترافي
  private createIntroTemplate(): RealTemplate {
    return {
      id: "intro-professional-real",
      name: "مقدمة احترافية حقيقية",
      description: "قالب مقدمة احترافي قابل للتخصيص الكامل",
      category: "intro",
      duration: 5,
      resolution: { width: 1920, height: 1080 },
      fps: 60,
      elements: [
        {
          id: "background-gradient",
          type: "shape",
          name: "خلفية متدرجة",
          position: { x: 0, y: 0 },
          size: { width: 1920, height: 1080 },
          visible: true,
          locked: false,
          properties: {
            shapeType: "rectangle",
            fill: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            border: "none",
          },
        },
        {
          id: "main-title",
          type: "text",
          name: "العنوان الرئيسي",
          position: { x: 960, y: 400 },
          size: { width: 800, height: 100 },
          visible: true,
          locked: false,
          duration: { start: 0.5, end: 5 },
          properties: {
            text: "عنوان مشروعك",
            fontSize: 72,
            fontFamily: "Cairo",
            fontWeight: "bold",
            color: "#ffffff",
            textAlign: "center",
            textShadow: "0 4px 8px rgba(0,0,0,0.5)",
          },
          animations: [
            {
              time: 0.5,
              properties: { opacity: 0, transform: "translateY(50px)" },
              easing: "ease-out",
            },
            {
              time: 1.5,
              properties: { opacity: 1, transform: "translateY(0px)" },
              easing: "ease-out",
            },
          ],
        },
        {
          id: "subtitle",
          type: "text",
          name: "العنوان الفرعي",
          position: { x: 960, y: 550 },
          size: { width: 600, height: 60 },
          visible: true,
          locked: false,
          duration: { start: 1.5, end: 5 },
          properties: {
            text: "وصف مختصر للمحتوى",
            fontSize: 36,
            fontFamily: "Cairo",
            fontWeight: "normal",
            color: "#00ffff",
            textAlign: "center",
          },
          animations: [
            {
              time: 1.5,
              properties: { opacity: 0, transform: "scale(0.8)" },
              easing: "ease-out",
            },
            {
              time: 2.5,
              properties: { opacity: 1, transform: "scale(1)" },
              easing: "ease-out",
            },
          ],
        },
        {
          id: "logo-placeholder",
          type: "image",
          name: "مكان الشعار",
          position: { x: 100, y: 100 },
          size: { width: 150, height: 150 },
          visible: true,
          locked: false,
          duration: { start: 2, end: 5 },
          properties: {
            src: "", // سيتم تخصيصه من قبل المستخدم
            fit: "contain",
            opacity: 0.9,
          },
          animations: [
            {
              time: 2,
              properties: {
                opacity: 0,
                transform: "rotate(-10deg) scale(0.5)",
              },
              easing: "ease-out",
            },
            {
              time: 3,
              properties: { opacity: 0.9, transform: "rotate(0deg) scale(1)" },
              easing: "ease-out",
            },
          ],
        },
        {
          id: "particles-effect",
          type: "effect",
          name: "تأثير الجسيمات",
          position: { x: 0, y: 0 },
          size: { width: 1920, height: 1080 },
          visible: true,
          locked: false,
          duration: { start: 0, end: 5 },
          properties: {
            effectType: "particles",
            particleCount: 50,
            particleSize: { min: 2, max: 6 },
            particleColor: "#ffffff",
            particleOpacity: 0.6,
            movement: {
              speed: { min: 20, max: 60 },
              direction: "up",
              randomness: 30,
            },
          },
        },
      ],
      audioTrack: {
        volume: 0.3,
        loop: false,
        fadeIn: 0.5,
        fadeOut: 0.5,
      },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        author: "KNOUX Team",
        version: "1.0.0",
        tags: ["intro", "professional", "corporate", "modern"],
        thumbnail: "",
      },
      customizable: {
        texts: ["main-title", "subtitle"],
        images: ["logo-placeholder"],
        colors: ["main-title.color", "subtitle.color"],
        fonts: ["main-title.fontFamily", "subtitle.fontFamily"],
      },
    };
  }

  // إنشاء قالب خاتمة تفاعلي
  private createOutroTemplate(): RealTemplate {
    return {
      id: "outro-interactive-real",
      name: "خاتمة تفاعلية حقيقية",
      description: "قالب خاتمة مع دعوات للعمل وروابط تفاعلية",
      category: "outro",
      duration: 8,
      resolution: { width: 1920, height: 1080 },
      fps: 60,
      elements: [
        {
          id: "background-video",
          type: "video",
          name: "فيديو الخلفية",
          position: { x: 0, y: 0 },
          size: { width: 1920, height: 1080 },
          visible: true,
          locked: false,
          properties: {
            src: "", // فيديو خلفية متحرك
            loop: true,
            muted: true,
            opacity: 0.3,
          },
        },
        {
          id: "thanks-message",
          type: "text",
          name: "رسالة الشكر",
          position: { x: 960, y: 300 },
          size: { width: 800, height: 80 },
          visible: true,
          locked: false,
          duration: { start: 0.5, end: 8 },
          properties: {
            text: "شكراً لمشاهدتك!",
            fontSize: 64,
            fontFamily: "Cairo",
            fontWeight: "bold",
            color: "#ffffff",
            textAlign: "center",
          },
          animations: [
            {
              time: 0.5,
              properties: { opacity: 0, transform: "scale(0.5)" },
              easing: "ease-out",
            },
            {
              time: 1.5,
              properties: { opacity: 1, transform: "scale(1)" },
              easing: "ease-out",
            },
          ],
        },
        {
          id: "subscribe-button",
          type: "shape",
          name: "زر الاشتراك",
          position: { x: 960, y: 500 },
          size: { width: 300, height: 80 },
          visible: true,
          locked: false,
          duration: { start: 2, end: 8 },
          properties: {
            shapeType: "rectangle",
            fill: "#ff0000",
            borderRadius: 40,
            text: "اشترك في القناة",
            textColor: "#ffffff",
            fontSize: 24,
            fontWeight: "bold",
            cursor: "pointer",
            action: "subscribe",
          },
          animations: [
            {
              time: 2,
              properties: { opacity: 0, transform: "translateY(30px)" },
              easing: "ease-out",
            },
            {
              time: 3,
              properties: { opacity: 1, transform: "translateY(0px)" },
              easing: "ease-out",
            },
            {
              time: 3,
              properties: { transform: "scale(1)" },
              easing: "ease-in-out",
            },
            {
              time: 3.5,
              properties: { transform: "scale(1.05)" },
              easing: "ease-in-out",
            },
            {
              time: 4,
              properties: { transform: "scale(1)" },
              easing: "ease-in-out",
            },
          ],
        },
        {
          id: "social-buttons",
          type: "shape",
          name: "أزرار وسائل التواصل",
          position: { x: 960, y: 650 },
          size: { width: 400, height: 60 },
          visible: true,
          locked: false,
          duration: { start: 3, end: 8 },
          properties: {
            buttons: [
              { type: "like", color: "#4267B2", icon: "👍", text: "إعجاب" },
              { type: "share", color: "#1DA1F2", icon: "📤", text: "مشاركة" },
              { type: "comment", color: "#25D366", icon: "💬", text: "تعليق" },
            ],
          },
          animations: [
            {
              time: 3,
              properties: { opacity: 0, transform: "translateX(-50px)" },
              easing: "ease-out",
            },
            {
              time: 4,
              properties: { opacity: 1, transform: "translateX(0px)" },
              easing: "ease-out",
            },
          ],
        },
      ],
      audioTrack: {
        volume: 0.2,
        loop: false,
        fadeOut: 1,
      },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        author: "KNOUX Team",
        version: "1.0.0",
        tags: ["outro", "interactive", "social", "engagement"],
      },
      customizable: {
        texts: ["thanks-message", "subscribe-button"],
        images: [],
        colors: ["thanks-message.color", "subscribe-button.fill"],
        fonts: ["thanks-message.fontFamily"],
      },
    };
  }

  // إنشاء قالب عنوان سفلي
  private createLowerThirdTemplate(): RealTemplate {
    return {
      id: "lower-third-news-real",
      name: "عنوان سفلي إخباري حقيقي",
      description: "قالب عنوان سفلي احترافي للأخبار والمقابلات",
      category: "lower-third",
      duration: 0, // مستمر
      resolution: { width: 1920, height: 1080 },
      fps: 60,
      elements: [
        {
          id: "background-bar",
          type: "shape",
          name: "شريط الخلفية",
          position: { x: 0, y: 864 },
          size: { width: 1920, height: 216 },
          visible: true,
          locked: false,
          properties: {
            shapeType: "rectangle",
            fill: "linear-gradient(90deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.7) 100%)",
            border: "3px solid #00ffff",
            borderSides: ["top"],
          },
        },
        {
          id: "speaker-name",
          type: "text",
          name: "اسم المتحدث",
          position: { x: 100, y: 920 },
          size: { width: 600, height: 50 },
          visible: true,
          locked: false,
          properties: {
            text: "اسم المتحدث",
            fontSize: 36,
            fontFamily: "Cairo",
            fontWeight: "bold",
            color: "#ffffff",
          },
        },
        {
          id: "speaker-title",
          type: "text",
          name: "منصب المتحدث",
          position: { x: 100, y: 970 },
          size: { width: 600, height: 40 },
          visible: true,
          locked: false,
          properties: {
            text: "المنصب أو المهنة",
            fontSize: 24,
            fontFamily: "Cairo",
            fontWeight: "normal",
            color: "#00ffff",
          },
        },
        {
          id: "logo-area",
          type: "image",
          name: "منطقة الشعار",
          position: { x: 1720, y: 900 },
          size: { width: 150, height: 150 },
          visible: true,
          locked: false,
          properties: {
            src: "",
            fit: "contain",
            opacity: 0.8,
          },
        },
        {
          id: "animated-line",
          type: "shape",
          name: "خط متحرك",
          position: { x: 0, y: 860 },
          size: { width: 1920, height: 4 },
          visible: true,
          locked: false,
          properties: {
            shapeType: "rectangle",
            fill: "#00ffff",
            animation: "pulse",
          },
        },
      ],
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        author: "KNOUX Team",
        version: "1.0.0",
        tags: ["lower-third", "news", "interview", "professional"],
      },
      customizable: {
        texts: ["speaker-name", "speaker-title"],
        images: ["logo-area"],
        colors: [
          "speaker-name.color",
          "speaker-title.color",
          "animated-line.fill",
        ],
        fonts: ["speaker-name.fontFamily", "speaker-title.fontFamily"],
      },
    };
  }

  // إنشاء قالب انتقال
  private createTransitionTemplate(): RealTemplate {
    return {
      id: "transition-modern-real",
      name: "انتقال حديث حقيقي",
      description: "قالب انتقال بتأثيرات حديثة وأنيقة",
      category: "transition",
      duration: 2,
      resolution: { width: 1920, height: 1080 },
      fps: 60,
      elements: [
        {
          id: "wipe-effect",
          type: "effect",
          name: "تأثير المسح",
          position: { x: 0, y: 0 },
          size: { width: 1920, height: 1080 },
          visible: true,
          locked: false,
          properties: {
            effectType: "wipe",
            direction: "left-to-right",
            easing: "ease-in-out",
            color: "#000000",
          },
          animations: [
            {
              time: 0,
              properties: { progress: 0 },
              easing: "ease-in-out",
            },
            {
              time: 2,
              properties: { progress: 100 },
              easing: "ease-in-out",
            },
          ],
        },
        {
          id: "particles-burst",
          type: "effect",
          name: "انفجار الجسيمات",
          position: { x: 960, y: 540 },
          size: { width: 200, height: 200 },
          visible: true,
          locked: false,
          duration: { start: 0.8, end: 1.2 },
          properties: {
            effectType: "particle-burst",
            particleCount: 100,
            particleColor: "#00ffff",
            burstRadius: 150,
            burstSpeed: 300,
          },
        },
      ],
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        author: "KNOUX Team",
        version: "1.0.0",
        tags: ["transition", "modern", "elegant", "smooth"],
      },
      customizable: {
        texts: [],
        images: [],
        colors: ["wipe-effect.color", "particles-burst.particleColor"],
        fonts: [],
      },
    };
  }

  // إنشاء قالب تراكب
  private createOverlayTemplate(): RealTemplate {
    return {
      id: "overlay-gaming-real",
      name: "تراكب ألعاب حقيقي",
      description: "قالب تراكب مُصمم خصيصاً للألعاب وأجواء الألعاب",
      category: "overlay",
      duration: 0, // مستمر
      resolution: { width: 1920, height: 1080 },
      fps: 60,
      elements: [
        {
          id: "webcam-frame",
          type: "shape",
          name: "إطار كاميرا الويب",
          position: { x: 1520, y: 680 },
          size: { width: 350, height: 350 },
          visible: true,
          locked: false,
          properties: {
            shapeType: "circle",
            fill: "transparent",
            border: "4px solid #00ff00",
            borderRadius: "50%",
          },
        },
        {
          id: "stream-info",
          type: "shape",
          name: "معلومات البث",
          position: { x: 50, y: 50 },
          size: { width: 400, height: 150 },
          visible: true,
          locked: false,
          properties: {
            shapeType: "rectangle",
            fill: "rgba(0,0,0,0.7)",
            borderRadius: 15,
            border: "2px solid #00ff00",
          },
        },
        {
          id: "viewer-count",
          type: "text",
          name: "عدد المشاهدين",
          position: { x: 70, y: 80 },
          size: { width: 200, height: 30 },
          visible: true,
          locked: false,
          properties: {
            text: "👥 1,234 مشاهد",
            fontSize: 20,
            fontFamily: "Cairo",
            fontWeight: "bold",
            color: "#00ff00",
          },
        },
        {
          id: "game-title",
          type: "text",
          name: "اسم اللعبة",
          position: { x: 70, y: 120 },
          size: { width: 300, height: 30 },
          visible: true,
          locked: false,
          properties: {
            text: "🎮 اسم اللعبة",
            fontSize: 18,
            fontFamily: "Cairo",
            fontWeight: "normal",
            color: "#ffffff",
          },
        },
        {
          id: "recent-follower",
          type: "text",
          name: "آخر متابع",
          position: { x: 70, y: 150 },
          size: { width: 300, height: 25 },
          visible: true,
          locked: false,
          properties: {
            text: "🌟 شكراً للمتابعة الجديدة!",
            fontSize: 16,
            fontFamily: "Cairo",
            fontWeight: "normal",
            color: "#ffff00",
          },
        },
        {
          id: "chat-box",
          type: "shape",
          name: "صندوق الدردشة",
          position: { x: 50, y: 250 },
          size: { width: 400, height: 600 },
          visible: true,
          locked: false,
          properties: {
            shapeType: "rectangle",
            fill: "rgba(0,0,0,0.6)",
            borderRadius: 10,
            border: "1px solid #333333",
          },
        },
      ],
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        author: "KNOUX Team",
        version: "1.0.0",
        tags: ["overlay", "gaming", "streaming", "live"],
      },
      customizable: {
        texts: ["viewer-count", "game-title", "recent-follower"],
        images: [],
        colors: [
          "webcam-frame.border",
          "stream-info.border",
          "viewer-count.color",
        ],
        fonts: ["viewer-count.fontFamily", "game-title.fontFamily"],
      },
    };
  }

  // عرض قالب
  async renderTemplate(
    templateId: string,
    customizations: Record<string, any> = {},
    settings: TemplateRenderSettings,
    timeSeconds = 0,
  ): Promise<HTMLCanvasElement> {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`لم يتم العثور على القالب: ${templateId}`);
    }

    this.renderTime = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;

    // تطبيق الإعدادات
    this.renderCanvas.width = settings.resolution.width;
    this.renderCanvas.height = settings.resolution.height;

    // مسح اللوحة
    this.renderContext.clearRect(
      0,
      0,
      settings.resolution.width,
      settings.resolution.height,
    );

    // تطبيق خلفية
    if (settings.backgroundColor) {
      this.renderContext.fillStyle = settings.backgroundColor;
      this.renderContext.fillRect(
        0,
        0,
        settings.resolution.width,
        settings.resolution.height,
      );
    }

    // رسم العناصر
    for (const element of template.elements) {
      if (!element.visible) continue;

      await this.renderElement(element, customizations, settings);
    }

    return this.renderCanvas;
  }

  // رسم عنصر واحد
  private async renderElement(
    element: RealTemplateElement,
    customizations: Record<string, any>,
    _settings: TemplateRenderSettings,
  ): Promise<void> {
    if (element.duration) {
      const { start, end } = element.duration;
      if (this.renderTime < start) return;
      // `end <= start` means "always visible" for the loop templates.
      if (end > start && this.renderTime > end) return;
    }

    const animation = this.evaluateAnimation(element, this.renderTime);
    const animatedElement =
      Object.keys(animation.properties).length > 0
        ? {
            ...element,
            properties: { ...element.properties, ...animation.properties },
          }
        : element;

    this.renderContext.save();

    // تطبيق التحويلات
    const centerX = element.position.x + element.size.width / 2;
    const centerY = element.position.y + element.size.height / 2;

    const pulse =
      element.properties.animation === "pulse"
        ? 0.55 + 0.45 * Math.abs(Math.sin(this.renderTime * Math.PI * 2))
        : 1;

    this.renderContext.globalAlpha =
      (element.opacity ?? 1) * animation.opacity * pulse;

    this.renderContext.translate(centerX, centerY);

    if (element.rotation) {
      this.renderContext.rotate((element.rotation * Math.PI) / 180);
    }

    if (animation.translateX !== 0 || animation.translateY !== 0) {
      this.renderContext.translate(animation.translateX, animation.translateY);
    }
    if (animation.rotation !== 0) {
      this.renderContext.rotate((animation.rotation * Math.PI) / 180);
    }
    if (animation.scale !== 1) {
      this.renderContext.scale(animation.scale, animation.scale);
    }

    this.renderContext.translate(-centerX, -centerY);

    // رسم حسب نوع العنصر
    switch (animatedElement.type) {
      case "text":
        await this.renderTextElement(animatedElement, customizations);
        break;
      case "shape":
        await this.renderShapeElement(animatedElement, customizations);
        break;
      case "image":
        await this.renderImageElement(animatedElement, customizations);
        break;
      case "effect":
        await this.renderEffectElement(animatedElement, customizations);
        break;
    }

    this.renderContext.restore();
  }

  /** Evaluate keyframe opacity, transforms and numeric properties at `time`. */
  private evaluateAnimation(
    element: RealTemplateElement,
    time: number,
  ): {
    opacity: number;
    translateX: number;
    translateY: number;
    scale: number;
    rotation: number;
    properties: Record<string, any>;
  } {
    const blank = () => ({
      opacity: 1,
      translateX: 0,
      translateY: 0,
      scale: 1,
      rotation: 0,
      properties: {} as Record<string, any>,
    });

    const frames = element.animations;
    if (!frames || frames.length === 0) return blank();

    const sorted = [...frames].sort((a, b) => a.time - b.time);
    if (time < sorted[0].time) return blank();

    const stateAt = (target: number) => {
      const state = blank();
      for (const frame of sorted) {
        if (frame.time > target) break;
        const properties = frame.properties ?? {};
        for (const [key, value] of Object.entries(properties)) {
          if (key === "transform" && typeof value === "string") {
            const transform = this.parseTransform(value);
            state.translateX = transform.translateX;
            state.translateY = transform.translateY;
            state.scale = transform.scale;
            state.rotation = transform.rotation;
          } else if (key === "opacity" && typeof value === "number") {
            state.opacity = value;
          } else {
            state.properties[key] = value;
          }
        }
      }
      return state;
    };

    const lastFrame = sorted[sorted.length - 1];
    if (time >= lastFrame.time) return stateAt(lastFrame.time);

    const nextFrame = sorted.find((frame) => frame.time > time);
    if (!nextFrame) return stateAt(time);
    const previousFrame = [...sorted]
      .reverse()
      .find((frame) => frame.time <= time);
    const from = stateAt(previousFrame?.time ?? sorted[0].time);
    const to = stateAt(nextFrame.time);
    const startTime = previousFrame?.time ?? sorted[0].time;
    const span = nextFrame.time - startTime;
    const raw = span <= 0 ? 1 : (time - startTime) / span;
    const eased = this.easeAnimation(raw, previousFrame?.easing ?? "linear");

    const result = {
      opacity: from.opacity + (to.opacity - from.opacity) * eased,
      translateX: from.translateX + (to.translateX - from.translateX) * eased,
      translateY: from.translateY + (to.translateY - from.translateY) * eased,
      scale: from.scale + (to.scale - from.scale) * eased,
      rotation: from.rotation + (to.rotation - from.rotation) * eased,
      properties: {} as Record<string, any>,
    };

    const keys = new Set([
      ...Object.keys(from.properties),
      ...Object.keys(to.properties),
    ]);
    for (const key of keys) {
      const startValue = from.properties[key];
      const endValue = to.properties[key];
      if (typeof startValue === "number" && typeof endValue === "number") {
        result.properties[key] = startValue + (endValue - startValue) * eased;
      } else {
        result.properties[key] = endValue ?? startValue;
      }
    }

    return result;
  }

  private parseTransform(value: string): {
    translateX: number;
    translateY: number;
    scale: number;
    rotation: number;
  } {
    const translateX = value.match(/translateX\(\s*(-?[\d.]+)px\s*\)/);
    const translateY = value.match(/translateY\(\s*(-?[\d.]+)px\s*\)/);
    const scale = value.match(/scale\(\s*(-?[\d.]+)\s*\)/);
    const rotation = value.match(/rotate\(\s*(-?[\d.]+)deg\s*\)/);
    return {
      translateX: translateX ? Number(translateX[1]) : 0,
      translateY: translateY ? Number(translateY[1]) : 0,
      scale: scale ? Number(scale[1]) : 1,
      rotation: rotation ? Number(rotation[1]) : 0,
    };
  }

  private easeAnimation(t: number, easing: string): number {
    const clamped = Math.max(0, Math.min(1, t));
    switch (easing) {
      case "ease-in":
        return clamped * clamped;
      case "ease-out":
        return clamped * (2 - clamped);
      case "ease-in-out":
        return clamped < 0.5
          ? 2 * clamped * clamped
          : -1 + (4 - 2 * clamped) * clamped;
      case "ease":
        return clamped * clamped * (3 - 2 * clamped);
      default:
        return clamped;
    }
  }

  // رسم عنصر نص
  private async renderTextElement(
    element: RealTemplateElement,
    customizations: Record<string, any>,
  ): Promise<void> {
    const props = { ...element.properties, ...customizations[element.id] };

    this.renderContext.font = `${props.fontWeight || "normal"} ${props.fontSize || 24}px ${props.fontFamily || "Arial"}`;
    this.renderContext.fillStyle = props.color || "#ffffff";
    this.renderContext.textAlign = props.textAlign || "left";
    this.renderContext.textBaseline = "middle";

    // تطبيق ظل النص
    if (props.textShadow) {
      const shadowParts = props.textShadow.split(" ");
      this.renderContext.shadowOffsetX = parseInt(shadowParts[0]) || 0;
      this.renderContext.shadowOffsetY = parseInt(shadowParts[1]) || 0;
      this.renderContext.shadowBlur = parseInt(shadowParts[2]) || 0;
      this.renderContext.shadowColor = shadowParts[3] || "rgba(0,0,0,0.5)";
    }

    const text = props.text || "نص تجريبي";
    const x =
      element.position.x +
      (props.textAlign === "center" ? element.size.width / 2 : 0);
    const y = element.position.y + element.size.height / 2;

    this.renderContext.fillText(text, x, y);
  }

  // رسم عنصر شكل
  private async renderShapeElement(
    element: RealTemplateElement,
    customizations: Record<string, any>,
  ): Promise<void> {
    const props = { ...element.properties, ...customizations[element.id] };

    this.renderContext.beginPath();

    switch (props.shapeType) {
      case "rectangle":
        if (props.borderRadius) {
          this.roundRect(
            element.position.x,
            element.position.y,
            element.size.width,
            element.size.height,
            props.borderRadius,
          );
        } else {
          this.renderContext.rect(
            element.position.x,
            element.position.y,
            element.size.width,
            element.size.height,
          );
        }
        break;
      case "circle":
        const radius = Math.min(element.size.width, element.size.height) / 2;
        this.renderContext.arc(
          element.position.x + element.size.width / 2,
          element.position.y + element.size.height / 2,
          radius,
          0,
          2 * Math.PI,
        );
        break;
    }

    // تطبيق التعبئة
    if (props.fill && props.fill !== "transparent") {
      if (props.fill.startsWith("linear-gradient")) {
        const gradient = this.createGradient(props.fill, element);
        this.renderContext.fillStyle = gradient;
      } else {
        this.renderContext.fillStyle = props.fill;
      }
      this.renderContext.fill();
    }

    // تطبيق الحدود
    if (props.border && props.border !== "none") {
      const borderParts = props.border.split(" ");
      this.renderContext.lineWidth = parseInt(borderParts[0]) || 1;
      this.renderContext.strokeStyle = borderParts[2] || "#ffffff";
      this.renderContext.stroke();
    }

    // رسم النص داخل الشكل (للأزرار)
    if (props.text) {
      this.renderContext.font = `${props.fontWeight || "normal"} ${props.fontSize || 16}px ${props.fontFamily || "Arial"}`;
      this.renderContext.fillStyle = props.textColor || "#ffffff";
      this.renderContext.textAlign = "center";
      this.renderContext.textBaseline = "middle";

      this.renderContext.fillText(
        props.text,
        element.position.x + element.size.width / 2,
        element.position.y + element.size.height / 2,
      );
    }
  }

  // رسم عنصر صورة
  private async renderImageElement(
    element: RealTemplateElement,
    customizations: Record<string, any>,
  ): Promise<void> {
    const props = { ...element.properties, ...customizations[element.id] };

    if (!props.src) {
      // رسم placeholder للصورة
      this.renderContext.fillStyle = "#333333";
      this.renderContext.fillRect(
        element.position.x,
        element.position.y,
        element.size.width,
        element.size.height,
      );

      this.renderContext.strokeStyle = "#666666";
      this.renderContext.strokeRect(
        element.position.x,
        element.position.y,
        element.size.width,
        element.size.height,
      );

      // رسم أيقونة صورة
      this.renderContext.fillStyle = "#666666";
      this.renderContext.font = "48px Arial";
      this.renderContext.textAlign = "center";
      this.renderContext.textBaseline = "middle";
      this.renderContext.fillText(
        "🖼️",
        element.position.x + element.size.width / 2,
        element.position.y + element.size.height / 2,
      );

      return;
    }

    // تحميل ورسم الصورة الحقيقية
    const image = await this.loadImage(props.src);

    let drawX = element.position.x;
    let drawY = element.position.y;
    let drawWidth = element.size.width;
    let drawHeight = element.size.height;

    if (props.fit === "contain") {
      const scale = Math.min(
        element.size.width / image.width,
        element.size.height / image.height,
      );
      drawWidth = image.width * scale;
      drawHeight = image.height * scale;
      drawX = element.position.x + (element.size.width - drawWidth) / 2;
      drawY = element.position.y + (element.size.height - drawHeight) / 2;
    }

    this.renderContext.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  }

  // رسم عنصر تأثير
  private async renderEffectElement(
    element: RealTemplateElement,
    customizations: Record<string, any>,
  ): Promise<void> {
    const props = { ...element.properties, ...customizations[element.id] };

    switch (props.effectType) {
      case "particles":
        this.renderParticleEffect(element, props);
        break;
      case "particle-burst":
        this.renderParticleBurstEffect(element, props);
        break;
      case "wipe":
        this.renderWipeEffect(element, props);
        break;
    }
  }

  // رسم تأثير الجسيمات
  private renderParticleEffect(element: RealTemplateElement, props: any): void {
    const particleCount = props.particleCount || 50;

    for (let i = 0; i < particleCount; i++) {
      const x = element.position.x + Math.random() * element.size.width;
      const y = element.position.y + Math.random() * element.size.height;
      const size =
        (props.particleSize?.min || 2) +
        Math.random() *
          ((props.particleSize?.max || 6) - (props.particleSize?.min || 2));

      this.renderContext.fillStyle = props.particleColor || "#ffffff";
      this.renderContext.globalAlpha = props.particleOpacity || 0.6;

      this.renderContext.beginPath();
      this.renderContext.arc(x, y, size, 0, 2 * Math.PI);
      this.renderContext.fill();
    }
  }

  // رسم تأثير انفجار الجسيمات
  private renderParticleBurstEffect(
    element: RealTemplateElement,
    props: any,
  ): void {
    const particleCount = props.particleCount || 100;
    const centerX = element.position.x;
    const centerY = element.position.y;

    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * 2 * Math.PI;
      const radius = Math.random() * (props.burstRadius || 150);

      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      const size = 2 + Math.random() * 4;

      this.renderContext.fillStyle = props.particleColor || "#00ffff";
      this.renderContext.globalAlpha = 1 - radius / (props.burstRadius || 150);

      this.renderContext.beginPath();
      this.renderContext.arc(x, y, size, 0, 2 * Math.PI);
      this.renderContext.fill();
    }
  }

  // رسم تأثير المسح
  private renderWipeEffect(element: RealTemplateElement, props: any): void {
    const progress = props.progress || 0;
    const direction = props.direction || "left-to-right";

    this.renderContext.fillStyle = props.color || "#000000";

    switch (direction) {
      case "left-to-right":
        const width = (element.size.width * progress) / 100;
        this.renderContext.fillRect(
          element.position.x,
          element.position.y,
          width,
          element.size.height,
        );
        break;
      case "top-to-bottom":
        const height = (element.size.height * progress) / 100;
        this.renderContext.fillRect(
          element.position.x,
          element.position.y,
          element.size.width,
          height,
        );
        break;
    }
  }

  // إنشاء تدرج
  private createGradient(
    _gradientString: string,
    element: RealTemplateElement,
  ): CanvasGradient {
    // تحليل string التدرج المبسط
    const gradient = this.renderContext.createLinearGradient(
      element.position.x,
      element.position.y,
      element.position.x + element.size.width,
      element.position.y + element.size.height,
    );

    // إضافة ألوان افتراضية
    gradient.addColorStop(0, "#667eea");
    gradient.addColorStop(1, "#764ba2");

    return gradient;
  }

  // رسم مستطيل بزوايا مدورة
  private roundRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    this.renderContext.beginPath();
    this.renderContext.moveTo(x + radius, y);
    this.renderContext.lineTo(x + width - radius, y);
    this.renderContext.quadraticCurveTo(x + width, y, x + width, y + radius);
    this.renderContext.lineTo(x + width, y + height - radius);
    this.renderContext.quadraticCurveTo(
      x + width,
      y + height,
      x + width - radius,
      y + height,
    );
    this.renderContext.lineTo(x + radius, y + height);
    this.renderContext.quadraticCurveTo(x, y + height, x, y + height - radius);
    this.renderContext.lineTo(x, y + radius);
    this.renderContext.quadraticCurveTo(x, y, x + radius, y);
    this.renderContext.closePath();
  }

  // تحميل صورة
  private async loadImage(src: string): Promise<HTMLImageElement> {
    if (this.loadedAssets.has(src)) {
      return this.loadedAssets.get(src);
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.loadedAssets.set(src, img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  // تخصيص قالب
  customizeTemplate(
    templateId: string,
    customizations: Record<string, any>,
  ): RealTemplate | null {
    const template = this.templates.get(templateId);
    if (!template) return null;

    const customizedTemplate = JSON.parse(JSON.stringify(template));

    // تطبيق التخصيصات
    customizedTemplate.elements.forEach((element: RealTemplateElement) => {
      if (customizations[element.id]) {
        element.properties = {
          ...element.properties,
          ...customizations[element.id],
        };
      }
    });

    return customizedTemplate;
  }

  // تصدير قالب كفيديو
  async exportTemplate(
    templateId: string,
    customizations: Record<string, any> = {},
    settings: TemplateRenderSettings,
  ): Promise<Blob> {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`لم يتم العثور على القالب: ${templateId}`);
    }

    // إنشاء video encoder (محاكاة)
    const canvas = await this.renderTemplate(
      templateId,
      customizations,
      settings,
    );

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("فشل في تصدير القالب"));
          }
        },
        `video/${settings.format}` as any,
      );
    });
  }

  // الحصول على جميع القوالب
  getAllTemplates(): RealTemplate[] {
    return Array.from(this.templates.values());
  }

  // الحصول على قالب محدد
  getTemplate(templateId: string): RealTemplate | null {
    return this.templates.get(templateId) || null;
  }

  // البحث في القوالب
  searchTemplates(query: string, category?: string): RealTemplate[] {
    const templates = Array.from(this.templates.values());

    return templates.filter((template) => {
      const matchesQuery =
        !query ||
        template.name.toLowerCase().includes(query.toLowerCase()) ||
        template.description.toLowerCase().includes(query.toLowerCase()) ||
        template.metadata.tags.some((tag) =>
          tag.toLowerCase().includes(query.toLowerCase()),
        );

      const matchesCategory = !category || template.category === category;

      return matchesQuery && matchesCategory;
    });
  }
}

// إنشاء مثيل وحيد
export const realTemplateEngine = new RealTemplateEngine();
export default RealTemplateEngine;
