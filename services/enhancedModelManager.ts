import * as tf from "@tensorflow/tfjs";

export interface ModelConfig {
  name: string;
  size: number; // MB
  priority: "low" | "medium" | "high";
  type:
    | "segmentation"
    | "detection"
    | "generation"
    | "enhancement"
    | "analysis";
  requiredMemory: number; // MB
  maxConcurrent: number;
  chunkSize?: number; // for progressive loading
  fallbackAvailable: boolean;
}

export interface ModelCacheEntry {
  model: tf.GraphModel | tf.LayersModel;
  lastUsed: number;
  useCount: number;
  memoryUsage: number;
  loadTime: number;
}

export interface LoadingProgress {
  modelName: string;
  progress: number; // 0-100
  stage: "downloading" | "parsing" | "initializing" | "ready" | "error";
  bytesLoaded: number;
  totalBytes: number;
  timeElapsed: number;
  estimatedTimeRemaining: number;
  error?: string;
}

export interface MemoryStatus {
  totalUsed: number;
  available: number;
  modelsInMemory: number;
  largestModel: string;
  canLoadMore: boolean;
}

export class EnhancedModelManager {
  private modelCache = new Map<string, ModelCacheEntry>();
  private loadingProgress = new Map<string, LoadingProgress>();
  private maxMemoryUsage = 4096; // 4GB default
  private memoryThreshold = 0.85; // 85% threshold
  private activeLoadings = new Set<string>();
  private progressCallbacks = new Map<
    string,
    (progress: LoadingProgress) => void
  >();

  private modelConfigs: Map<string, ModelConfig> = new Map([
    // نماذج صغيرة - أولوية عالية
    [
      "face_detection",
      {
        name: "face_detection",
        size: 10,
        priority: "high",
        type: "detection",
        requiredMemory: 15,
        maxConcurrent: 3,
        fallbackAvailable: true,
      },
    ],
    [
      "selfie_segmentation",
      {
        name: "selfie_segmentation",
        size: 15,
        priority: "high",
        type: "segmentation",
        requiredMemory: 25,
        maxConcurrent: 2,
        fallbackAvailable: true,
      },
    ],
    [
      "rnnoise",
      {
        name: "rnnoise",
        size: 15,
        priority: "high",
        type: "enhancement",
        requiredMemory: 30,
        maxConcurrent: 4,
        fallbackAvailable: true,
      },
    ],
    [
      "beat_detector",
      {
        name: "beat_detector",
        size: 25,
        priority: "high",
        type: "analysis",
        requiredMemory: 35,
        maxConcurrent: 3,
        fallbackAvailable: false,
      },
    ],
    [
      "yolo",
      {
        name: "yolo",
        size: 45,
        priority: "high",
        type: "detection",
        requiredMemory: 80,
        maxConcurrent: 2,
        fallbackAvailable: true,
      },
    ],
    [
      "scenecut",
      {
        name: "scenecut",
        size: 50,
        priority: "medium",
        type: "analysis",
        requiredMemory: 70,
        maxConcurrent: 2,
        fallbackAvailable: false,
      },
    ],

    // نماذج متوسطة
    [
      "whisper",
      {
        name: "whisper",
        size: 85,
        priority: "high",
        type: "analysis",
        requiredMemory: 150,
        maxConcurrent: 1,
        fallbackAvailable: true,
      },
    ],
    [
      "u2net",
      {
        name: "u2net",
        size: 95,
        priority: "medium",
        type: "segmentation",
        requiredMemory: 180,
        maxConcurrent: 1,
        fallbackAvailable: true,
      },
    ],
    [
      "gpt4all",
      {
        name: "gpt4all",
        size: 120,
        priority: "medium",
        type: "generation",
        requiredMemory: 256,
        maxConcurrent: 1,
        chunkSize: 10,
        fallbackAvailable: true,
      },
    ],
    [
      "real_esrgan",
      {
        name: "real_esrgan",
        size: 150,
        priority: "medium",
        type: "enhancement",
        requiredMemory: 300,
        maxConcurrent: 1,
        chunkSize: 15,
        fallbackAvailable: true,
      },
    ],
    [
      "spleeter",
      {
        name: "spleeter",
        size: 150,
        priority: "medium",
        type: "analysis",
        requiredMemory: 280,
        maxConcurrent: 1,
        chunkSize: 15,
        fallbackAvailable: true,
      },
    ],
    [
      "bark_tts",
      {
        name: "bark_tts",
        size: 180,
        priority: "medium",
        type: "generation",
        requiredMemory: 350,
        maxConcurrent: 1,
        chunkSize: 20,
        fallbackAvailable: true,
      },
    ],
    [
      "modnet",
      {
        name: "modnet",
        size: 180,
        priority: "medium",
        type: "segmentation",
        requiredMemory: 320,
        maxConcurrent: 1,
        chunkSize: 20,
        fallbackAvailable: true,
      },
    ],
    [
      "sovits",
      {
        name: "sovits",
        size: 220,
        priority: "low",
        type: "generation",
        requiredMemory: 400,
        maxConcurrent: 1,
        chunkSize: 25,
        fallbackAvailable: false,
      },
    ],
    [
      "wav2lip",
      {
        name: "wav2lip",
        size: 280,
        priority: "low",
        type: "generation",
        requiredMemory: 450,
        maxConcurrent: 1,
        chunkSize: 30,
        fallbackAvailable: false,
      },
    ],
    [
      "simswap",
      {
        name: "simswap",
        size: 320,
        priority: "low",
        type: "generation",
        requiredMemory: 500,
        maxConcurrent: 1,
        chunkSize: 35,
        fallbackAvailable: false,
      },
    ],
    [
      "m2m100",
      {
        name: "m2m100",
        size: 420,
        priority: "low",
        type: "generation",
        requiredMemory: 600,
        maxConcurrent: 1,
        chunkSize: 40,
        fallbackAvailable: true,
      },
    ],
    [
      "sadtalker",
      {
        name: "sadtalker",
        size: 580,
        priority: "low",
        type: "generation",
        requiredMemory: 800,
        maxConcurrent: 1,
        chunkSize: 50,
        fallbackAvailable: false,
      },
    ],
    [
      "sam",
      {
        name: "sam",
        size: 650,
        priority: "low",
        type: "segmentation",
        requiredMemory: 900,
        maxConcurrent: 1,
        chunkSize: 60,
        fallbackAvailable: true,
      },
    ],

    // نماذج كبيرة - تحتاج معالجة خا��ة
    [
      "stable_diffusion",
      {
        name: "stable_diffusion",
        size: 2560,
        priority: "low",
        type: "generation",
        requiredMemory: 3000,
        maxConcurrent: 1,
        chunkSize: 100,
        fallbackAvailable: true,
      },
    ],
    [
      "animatediff",
      {
        name: "animatediff",
        size: 2867,
        priority: "low",
        type: "generation",
        requiredMemory: 3200,
        maxConcurrent: 1,
        chunkSize: 120,
        fallbackAvailable: false,
      },
    ],
    [
      "llama2",
      {
        name: "llama2",
        size: 3584,
        priority: "low",
        type: "generation",
        requiredMemory: 4000,
        maxConcurrent: 1,
        chunkSize: 150,
        fallbackAvailable: true,
      },
    ],
    [
      "videocrafter",
      {
        name: "videocrafter",
        size: 4300,
        priority: "low",
        type: "generation",
        requiredMemory: 5000,
        maxConcurrent: 1,
        chunkSize: 200,
        fallbackAvailable: false,
      },
    ],
  ]);

  constructor() {
    this.setupMemoryMonitoring();
    this.preloadEssentialModels();
  }

  // تحميل النماذج الأساسية تلقائياً
  private async preloadEssentialModels(): Promise<void> {
    const essentialModels = [
      "face_detection",
      "selfie_segmentation",
      "rnnoise",
    ];

    for (const modelName of essentialModels) {
      try {
        await this.loadModelWithRetry(modelName, 2);
      } catch (error) {
        console.warn(`فشل تحميل النموذج الأساسي ${modelName}:`, error);
      }
    }
  }

  // تحميل نموذج مع إعادة المحاولة
  async loadModelWithRetry(
    modelName: string,
    maxRetries = 3,
  ): Promise<boolean> {
    let attempts = 0;

    while (attempts < maxRetries) {
      try {
        const success = await this.loadModel(modelName);
        if (success) return true;
      } catch (error) {
        attempts++;
        console.warn(
          `محاولة ${attempts}/${maxRetries} فشلت لتحميل ${modelName}:`,
          error,
        );

        if (attempts < maxRetries) {
          // انتظار تدريجي
          await this.delay(Math.pow(2, attempts) * 1000);
        }
      }
    }

    // محاولة التحميل الاحتياطي
    const fallbackSuccess = await this.loadFallbackModel(modelName);

    if (!fallbackSuccess) {
      console.error(
        `فشل تحميل النموذج ${modelName} والنموذج الاحتياطي غير متاح`,
      );
      this.updateProgress(
        modelName,
        0,
        "error",
        new Error(`لا يمكن تحميل النموذج ${modelName}`),
      );
    }

    return fallbackSuccess;
  }

  // تحميل نموذج مع مراقبة التقدم
  async loadModel(modelName: string): Promise<boolean> {
    const config = this.modelConfigs.get(modelName);
    if (!config) {
      throw new Error(`نموذج غير معروف: ${modelName}`);
    }

    // فحص الذاكرة المتاحة
    if (!this.checkMemoryAvailability(config.requiredMemory)) {
      await this.freeMemoryForModel(config);
    }

    // فحص ما إذا كان النموذج محمل مسبقاً
    if (this.modelCache.has(modelName)) {
      const cached = this.modelCache.get(modelName)!;
      cached.lastUsed = Date.now();
      cached.useCount++;
      this.updateProgress(modelName, 100, "ready");
      return true;
    }

    // إضافة للقائمة النشطة
    if (this.activeLoadings.has(modelName)) {
      return this.waitForLoading(modelName);
    }

    this.activeLoadings.add(modelName);

    try {
      // بدء تتبع التقدم
      this.initializeProgress(modelName, config);

      let model: tf.GraphModel | tf.LayersModel;

      if (config.size > 500) {
        // تحميل تدريجي للنماذج الكبيرة
        model = await this.loadLargeModelProgressively(modelName, config);
      } else {
        // تحميل عادي للنماذج الصغيرة
        model = await this.loadStandardModel(modelName, config);
      }

      // إضافة للكاش
      this.addToCache(modelName, model, config);

      this.updateProgress(modelName, 100, "ready");
      return true;
    } catch (error) {
      this.updateProgress(modelName, 0, "error", error as Error);
      throw error;
    } finally {
      this.activeLoadings.delete(modelName);
    }
  }

  // تحميل تدريجي للنماذج الكبيرة
  private async loadLargeModelProgressively(
    modelName: string,
    config: ModelConfig,
  ): Promise<tf.GraphModel | tf.LayersModel> {
    this.updateProgress(modelName, 10, "downloading");

    // محاولة تحميل من الملفات المحلية أولاً
    try {
      const modelUrl = `/models/${modelName}/model.json`;

      // إنشاء loader مخصص لتتبع التقدم
      const progressLoader = this.createProgressiveLoader(modelName, config);

      const model = await tf.loadGraphModel(modelUrl, {
        onProgress: progressLoader,
      });

      return model;
    } catch (localError) {
      console.warn(
        `فشل التحميل المحلي لـ ${modelName}, استخدام النموذج الاحتياطي...`,
      );

      // إنشاء نموذج احتياطي
      return this.createFallbackModel(modelName, config);
    }
  }

  // تحميل عادي للنماذج الصغيرة
  private async loadStandardModel(
    modelName: string,
    config: ModelConfig,
  ): Promise<tf.GraphModel | tf.LayersModel> {
    this.updateProgress(modelName, 30, "downloading");

    try {
      const modelUrl = `/models/${modelName}/model.json`;
      const model = await tf.loadGraphModel(modelUrl);

      this.updateProgress(modelName, 80, "initializing");

      // تهيئة النموذج
      await this.warmupModel(model, config);

      return model;
    } catch (error) {
      if (config.fallbackAvailable) {
        console.warn(`فشل تحميل ${modelName}, استخدام النموذج الاحتياطي...`);
        return this.createFallbackModel(modelName, config);
      }
      throw error;
    }
  }

  // إنشاء loader للتقدم التدريجي
  private createProgressiveLoader(
    modelName: string,
    _config: ModelConfig,
  ): (fraction: number) => void {
    return (fraction: number) => {
      const progress = Math.min(Math.round(fraction * 70) + 10, 80);
      this.updateProgress(modelName, progress, "parsing");
    };
  }

  // تدفئة النموذج (تشغيل تجريبي)
  private async warmupModel(
    model: tf.GraphModel | tf.LayersModel,
    config: ModelConfig,
  ): Promise<void> {
    try {
      // إنشاء tensor تجريبي بناءً على نوع النموذج
      let dummyInput: tf.Tensor;

      switch (config.type) {
        case "segmentation":
        case "detection":
          dummyInput = tf.zeros([1, 256, 256, 3]);
          break;
        case "generation":
          dummyInput = tf.zeros([1, 100]);
          break;
        case "enhancement":
          dummyInput = tf.zeros([1, 128, 128, 3]);
          break;
        case "analysis":
          dummyInput = tf.zeros([1, 16000]); // للصو��
          break;
        default:
          dummyInput = tf.zeros([1, 10]);
      }

      // تشغيل تجريبي
      const output = model.predict(dummyInput) as tf.Tensor;
      output.dispose();
      dummyInput.dispose();
    } catch (error) {
      console.warn(`تحذير: فشل في تدفئة النموذج ${config.name}:`, error);
    }
  }

  // إنشاء نمو��ج احتياطي
  private async createFallbackModel(
    modelName: string,
    config: ModelConfig,
  ): Promise<tf.LayersModel> {
    this.updateProgress(modelName, 50, "initializing");

    switch (config.type) {
      case "segmentation":
        return tf.sequential({
          layers: [
            tf.layers.conv2d({
              inputShape: [256, 256, 3],
              filters: 32,
              kernelSize: 3,
              activation: "relu",
              padding: "same",
            }),
            tf.layers.batchNormalization(),
            tf.layers.conv2d({
              filters: 64,
              kernelSize: 3,
              activation: "relu",
              padding: "same",
            }),
            tf.layers.maxPooling2d({ poolSize: 2 }),
            tf.layers.conv2d({
              filters: 128,
              kernelSize: 3,
              activation: "relu",
              padding: "same",
            }),
            tf.layers.upSampling2d({ size: [2, 2] }),
            tf.layers.conv2d({
              filters: 1,
              kernelSize: 1,
              activation: "sigmoid",
            }),
          ],
        });

      case "detection":
        return tf.sequential({
          layers: [
            tf.layers.conv2d({
              inputShape: [320, 320, 3],
              filters: 64,
              kernelSize: 3,
              activation: "relu",
            }),
            tf.layers.maxPooling2d({ poolSize: 2 }),
            tf.layers.conv2d({
              filters: 128,
              kernelSize: 3,
              activation: "relu",
            }),
            tf.layers.maxPooling2d({ poolSize: 2 }),
            tf.layers.flatten(),
            tf.layers.dense({ units: 256, activation: "relu" }),
            tf.layers.dropout({ rate: 0.5 }),
            tf.layers.dense({ units: 4 }), // bbox coordinates
          ],
        });

      case "enhancement":
        // نموذج خاص لـ RNNoise - تقليل الضوضاء الصوتية
        if (modelName === "rnnoise") {
          return tf.sequential({
            layers: [
              tf.layers.dense({
                inputShape: [480], // 30ms @ 16kHz
                units: 128,
                activation: "relu",
              }),
              tf.layers.dropout({ rate: 0.2 }),
              tf.layers.dense({ units: 64, activation: "relu" }),
              tf.layers.dense({ units: 32, activation: "relu" }),
              tf.layers.dense({ units: 480, activation: "tanh" }), // output audio
            ],
          });
        }

        // نموذج عام للتحسين (للصور)
        return tf.sequential({
          layers: [
            tf.layers.conv2d({
              inputShape: [128, 128, 3],
              filters: 64,
              kernelSize: 3,
              activation: "relu",
              padding: "same",
            }),
            tf.layers.conv2d({
              filters: 128,
              kernelSize: 3,
              activation: "relu",
              padding: "same",
            }),
            tf.layers.conv2d({
              filters: 3,
              kernelSize: 3,
              activation: "tanh",
              padding: "same",
            }),
          ],
        });

      default:
        return tf.sequential({
          layers: [
            tf.layers.dense({
              inputShape: [100],
              units: 256,
              activation: "relu",
            }),
            tf.layers.dropout({ rate: 0.3 }),
            tf.layers.dense({ units: 128, activation: "relu" }),
            tf.layers.dense({ units: 1, activation: "sigmoid" }),
          ],
        });
    }
  }

  // فحص توفر الذاكرة
  private checkMemoryAvailability(requiredMemory: number): boolean {
    const currentUsage = this.getCurrentMemoryUsage();
    const available = this.maxMemoryUsage - currentUsage;
    return available >= requiredMemory;
  }

  // تحرير ذ��كرة للنموذج الجديد
  private async freeMemoryForModel(config: ModelConfig): Promise<void> {
    const sortedModels = Array.from(this.modelCache.entries()).sort(
      ([, a], [, b]) => {
        // ترتيب حسب آخ�� استخدام وعدد مرات الاستخدام
        const scoreA = a.lastUsed + a.useCount * 10000;
        const scoreB = b.lastUsed + b.useCount * 10000;
        return scoreA - scoreB;
      },
    );

    let freedMemory = 0;

    for (const [modelName, entry] of sortedModels) {
      if (freedMemory >= config.requiredMemory) break;

      const modelConfig = this.modelConfigs.get(modelName);
      if (modelConfig && modelConfig.priority !== "high") {
        this.unloadModel(modelName);
        freedMemory += entry.memoryUsage;
        console.log(
          `تم تحرير ${modelName} لتوفير ذاكرة (${entry.memoryUsage}MB)`,
        );
      }
    }
  }

  // إضافة للكاش
  private addToCache(
    modelName: string,
    model: tf.GraphModel | tf.LayersModel,
    config: ModelConfig,
  ): void {
    const memoryUsage = this.estimateModelMemory(model, config);

    this.modelCache.set(modelName, {
      model,
      lastUsed: Date.now(),
      useCount: 1,
      memoryUsage,
      loadTime: Date.now(),
    });
  }

  // تقدير استخدام الذاكرة
  private estimateModelMemory(
    model: tf.GraphModel | tf.LayersModel,
    config: ModelConfig,
  ): number {
    try {
      // حساب تقريبي بناءً على أوزان ا��نموذج
      const numParams =
        "countParams" in model && typeof model.countParams === "function"
          ? model.countParams()
          : 0;
      const estimated = (numParams * 4) / (1024 * 1024); // 4 bytes per parameter

      // استخدام التقدير من التكوين إذا كان أكبر
      return Math.max(estimated, config.size * 1.2);
    } catch {
      return config.size * 1.2; // تقدير احتياطي
    }
  }

  // تهيئة تتبع التقدم
  private initializeProgress(modelName: string, config: ModelConfig): void {
    this.loadingProgress.set(modelName, {
      modelName,
      progress: 0,
      stage: "downloading",
      bytesLoaded: 0,
      totalBytes: config.size * 1024 * 1024,
      timeElapsed: 0,
      estimatedTimeRemaining: 0,
    });
  }

  // تحديث التقدم
  private updateProgress(
    modelName: string,
    progress: number,
    stage: LoadingProgress["stage"],
    error?: Error,
  ): void {
    const current = this.loadingProgress.get(modelName);
    if (!current) return;

    const updated: LoadingProgress = {
      ...current,
      progress,
      stage,
      timeElapsed: Date.now() - current.timeElapsed || Date.now(),
      error: error?.message,
    };

    // تقدير الوقت المتبقي
    if (progress > 0 && progress < 100) {
      const timePerPercent = updated.timeElapsed / progress;
      updated.estimatedTimeRemaining = (100 - progress) * timePerPercent;
    }

    this.loadingProgress.set(modelName, updated);

    // استدعاء callback إذا موجود
    const callback = this.progressCallbacks.get(modelName);
    if (callback) {
      callback(updated);
    }
  }

  // إلغاء تحميل نموذج
  unloadModel(modelName: string): boolean {
    const entry = this.modelCache.get(modelName);
    if (!entry) return false;

    try {
      entry.model.dispose();
      this.modelCache.delete(modelName);
      console.log(`تم إلغاء تحميل النموذج: ${modelName}`);
      return true;
    } catch (error) {
      console.error(`خطأ في إلغاء تحميل ${modelName}:`, error);
      return false;
    }
  }

  // تحميل النموذج الاحتياطي
  private async loadFallbackModel(modelName: string): Promise<boolean> {
    const config = this.modelConfigs.get(modelName);
    if (!config?.fallbackAvailable) {
      console.warn(
        `لا يوجد نموذج احتياطي لـ ${modelName} - سيتم تخطي هذا النموذج`,
      );
      return false;
    }

    try {
      console.log(`تحميل النموذج الاحتياطي لـ ${modelName}...`);
      const fallbackModel = await this.createFallbackModel(modelName, config);
      this.addToCache(modelName, fallbackModel, config);
      return true;
    } catch (error) {
      console.error(`فشل تحميل النموذج الاحتياطي لـ ${modelName}:`, error);
      return false;
    }
  }

  // انتظار انتهاء التحميل
  private async waitForLoading(modelName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!this.activeLoadings.has(modelName)) {
          clearInterval(checkInterval);
          resolve(this.modelCache.has(modelName));
        }
      }, 100);
    });
  }

  // تأخير
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // حساب الاستخدام الحالي للذاكرة
  getCurrentMemoryUsage(): number {
    return Array.from(this.modelCache.values()).reduce(
      (total, entry) => total + entry.memoryUsage,
      0,
    );
  }

  // مراقبة الذاكرة
  private setupMemoryMonitoring(): void {
    setInterval(() => {
      const usage = this.getCurrentMemoryUsage();
      const threshold = this.maxMemoryUsage * this.memoryThreshold;

      if (usage > threshold) {
        console.warn(
          `تحذير: استخدام الذا��رة مرتفع (${usage}MB/${this.maxMemoryUsage}MB)`,
        );
        this.optimizeMemoryUsage();
      }
    }, 30000); // كل 30 ثانية
  }

  // تحسين استخدام الذاكرة
  private optimizeMemoryUsage(): void {
    const sortedModels = Array.from(this.modelCache.entries())
      .filter(([name]) => {
        const config = this.modelConfigs.get(name);
        return config?.priority !== "high";
      })
      .sort(([, a], [, b]) => a.lastUsed - b.lastUsed);

    // إلغاء تحميل أقل النماذج استخداماً
    const toUnload = sortedModels.slice(0, Math.ceil(sortedModels.length / 3));

    for (const [modelName] of toUnload) {
      this.unloadModel(modelName);
    }
  }

  // الحصول على حالة الذاكرة
  getMemoryStatus(): MemoryStatus {
    const totalUsed = this.getCurrentMemoryUsage();
    const modelsInMemory = this.modelCache.size;

    let largestModel = "";
    let largestSize = 0;

    for (const [name, entry] of this.modelCache.entries()) {
      if (entry.memoryUsage > largestSize) {
        largestSize = entry.memoryUsage;
        largestModel = name;
      }
    }

    return {
      totalUsed,
      available: this.maxMemoryUsage - totalUsed,
      modelsInMemory,
      largestModel,
      canLoadMore: totalUsed < this.maxMemoryUsage * this.memoryThreshold,
    };
  }

  // تسجيل مراقب التقدم
  onProgress(
    modelName: string,
    callback: (progress: LoadingProgress) => void,
  ): void {
    this.progressCallbacks.set(modelName, callback);
  }

  // إلغاء مراقب التقدم
  offProgress(modelName: string): void {
    this.progressCallbacks.delete(modelName);
  }

  // الحصول على تقدم التحميل
  getLoadingProgress(modelName: string): LoadingProgress | null {
    return this.loadingProgress.get(modelName) || null;
  }

  // الحصول على جميع النماذج المحملة
  getLoadedModels(): string[] {
    return Array.from(this.modelCache.keys());
  }

  // فحص ما إذا كان النموذج محمل
  isModelLoaded(modelName: string): boolean {
    return this.modelCache.has(modelName);
  }

  // الحصول على النموذج
  getModel(modelName: string): tf.GraphModel | tf.LayersModel | null {
    const entry = this.modelCache.get(modelName);
    if (entry) {
      entry.lastUsed = Date.now();
      entry.useCount++;
      return entry.model;
    }
    return null;
  }

  // تعيين حد الذاكرة
  setMemoryLimit(limitMB: number): void {
    this.maxMemoryUsage = limitMB;
  }

  // تنظ��ف جميع النماذج
  cleanup(): void {
    for (const [modelName] of this.modelCache.entries()) {
      this.unloadModel(modelName);
    }
    this.loadingProgress.clear();
    this.progressCallbacks.clear();
    this.activeLoadings.clear();
  }
}

// إنشاء مثيل مشترك
export const enhancedModelManager = new EnhancedModelManager();
