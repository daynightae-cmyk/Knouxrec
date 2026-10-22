// Knoux MorphCore™ | Visual Patch Lab Service
// Canvas-based Image Manipulation Engine for 50 Interactive Editing Tools

import {
  VisualPatchTool,
  EditSession,
  EditOperation,
  EditRegion,
  Point2D,
  ToolSettings,
  EditHistory,
  ExportOptions,
  ALL_VISUAL_PATCH_TOOLS,
} from "../types/visualPatchLab";

class VisualPatchLabService {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private originalCanvas: HTMLCanvasElement;
  private originalCtx: CanvasRenderingContext2D;
  private previewCanvas: HTMLCanvasElement;

  private currentSession: EditSession | null = null;
  private history: EditHistory = {
    operations: [],
    currentIndex: -1,
    maxHistory: 50,
    hasUnsavedChanges: false,
  };

  constructor() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d")!;
    this.originalCanvas = document.createElement("canvas");
    this.originalCtx = this.originalCanvas.getContext("2d")!;
    this.previewCanvas = document.createElement("canvas");
  }

  // Session Management
  async createSession(imageFile: File): Promise<string> {
    const sessionId = `session-${Date.now()}`;
    const imageUrl = await this.fileToBase64(imageFile);
    const img = await this.loadImage(imageUrl);

    // Setup canvases
    this.setupCanvases(img.width, img.height);

    // Draw original image
    this.originalCtx.drawImage(img, 0, 0);
    this.ctx.drawImage(img, 0, 0);

    // Create session
    this.currentSession = {
      id: sessionId,
      originalImage: imageUrl,
      currentImage: imageUrl,
      width: img.width,
      height: img.height,
      operations: [],
      createdAt: new Date(),
      lastModified: new Date(),
      title: `Edit Session - ${new Date().toLocaleString()}`,
    };

    this.resetHistory();
    return sessionId;
  }

  private setupCanvases(width: number, height: number): void {
    [this.canvas, this.originalCanvas, this.previewCanvas].forEach((canvas) => {
      canvas.width = width;
      canvas.height = height;
    });
  }

  private async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  private async loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Tool Application Methods
  async applyTool(
    toolId: string,
    regions: EditRegion[],
    settings: ToolSettings,
  ): Promise<void> {
    if (!this.currentSession) return;

    const tool = ALL_VISUAL_PATCH_TOOLS.find((t) => t.id === toolId);
    if (!tool) return;

    // Save current state for undo
    const beforeSnapshot = this.ctx.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );

    try {
      // Apply tool based on edit mode
      switch (tool.editMode) {
        case "pinch":
          await this.applyPinchTool(tool, regions, settings);
          break;
        case "warp":
          await this.applyWarpTool(tool, regions, settings);
          break;
        case "sculpt":
          await this.applySculptTool(tool, regions, settings);
          break;
        case "brush":
          await this.applyBrushTool(tool, regions, settings);
          break;
        case "smooth":
          await this.applySmoothTool(tool, regions, settings);
          break;
        case "curve":
          await this.applyCurveTool(tool, regions, settings);
          break;
        case "mirror":
          await this.applyMirrorTool(tool, regions, settings);
          break;
        case "drag":
          await this.applyDragTool(tool, regions, settings);
          break;
      }

      const afterSnapshot = this.ctx.getImageData(
        0,
        0,
        this.canvas.width,
        this.canvas.height,
      );

      // Create operation record
      const operation: EditOperation = {
        id: `op-${Date.now()}`,
        toolId,
        timestamp: Date.now(),
        regions,
        beforeSnapshot,
        afterSnapshot,
        parameters: { ...settings, toolName: tool.name },
      };

      this.addToHistory(operation);
      this.currentSession.lastModified = new Date();
      this.currentSession.currentImage = this.canvas.toDataURL();
    } catch (error) {
      console.error("Tool application failed:", error);
      throw error;
    }
  }

  // Pinch Tool - For scaling/resizing areas
  private async applyPinchTool(
    tool: VisualPatchTool,
    regions: EditRegion[],
    settings: ToolSettings,
  ): Promise<void> {
    for (const region of regions) {
      const imageData = this.ctx.getImageData(
        0,
        0,
        this.canvas.width,
        this.canvas.height,
      );
      const newImageData = this.ctx.createImageData(
        imageData.width,
        imageData.height,
      );

      // Copy original data
      newImageData.data.set(imageData.data);

      for (const point of region.points) {
        this.applyPinchEffect(
          imageData,
          newImageData,
          point,
          region.brushSize,
          region.intensity * (settings.intensity / 100),
          region.feather,
          tool.id.includes("enlarge") ||
            tool.id.includes("enhance") ||
            tool.id.includes("bulk"),
        );
      }

      this.ctx.putImageData(newImageData, 0, 0);
      this.applySmoothing(region.feather);
    }
  }

  private applyPinchEffect(
    source: ImageData,
    target: ImageData,
    center: Point2D,
    radius: number,
    intensity: number,
    feather: number,
    enlarge: boolean,
  ): void {
    const centerX = center.x;
    const centerY = center.y;
    const effectRadius = radius;
    const strength = enlarge ? intensity : -intensity;

    for (
      let y = Math.max(0, centerY - effectRadius);
      y < Math.min(source.height, centerY + effectRadius);
      y++
    ) {
      for (
        let x = Math.max(0, centerX - effectRadius);
        x < Math.min(source.width, centerX + effectRadius);
        x++
      ) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < effectRadius) {
          // Calculate effect falloff
          let effectStrength = 1 - distance / effectRadius;
          effectStrength = this.smoothStep(effectStrength);
          effectStrength *= strength;

          // Apply feathering
          if (feather > 0) {
            const featherZone = effectRadius * (feather / 100);
            if (distance > effectRadius - featherZone) {
              const featherFactor = (effectRadius - distance) / featherZone;
              effectStrength *= this.smoothStep(featherFactor);
            }
          }

          // Calculate displacement
          const displacementFactor = effectStrength * 0.3;
          const sourceX = x - dx * displacementFactor;
          const sourceY = y - dy * displacementFactor;

          // Bilinear interpolation for smooth results
          this.bilinearInterpolation(source, target, sourceX, sourceY, x, y);
        } else {
          // Copy original pixel
          const targetIndex = (y * source.width + x) * 4;
          const sourceIndex = targetIndex;
          target.data[targetIndex] = source.data[sourceIndex];
          target.data[targetIndex + 1] = source.data[sourceIndex + 1];
          target.data[targetIndex + 2] = source.data[sourceIndex + 2];
          target.data[targetIndex + 3] = source.data[sourceIndex + 3];
        }
      }
    }
  }

  // Warp Tool - For stretching and morphing
  private async applyWarpTool(
    tool: VisualPatchTool,
    regions: EditRegion[],
    settings: ToolSettings,
  ): Promise<void> {
    for (const region of regions) {
      const imageData = this.ctx.getImageData(
        0,
        0,
        this.canvas.width,
        this.canvas.height,
      );
      const newImageData = this.ctx.createImageData(
        imageData.width,
        imageData.height,
      );

      newImageData.data.set(imageData.data);

      for (let i = 0; i < region.points.length - 1; i++) {
        const startPoint = region.points[i];
        const endPoint = region.points[i + 1];

        this.applyWarpDisplacement(
          imageData,
          newImageData,
          startPoint,
          endPoint,
          region.brushSize,
          region.intensity * (settings.intensity / 100),
          region.feather,
          tool.id,
        );
      }

      this.ctx.putImageData(newImageData, 0, 0);
      this.applySmoothing(region.feather);
    }
  }

  private applyWarpDisplacement(
    source: ImageData,
    target: ImageData,
    start: Point2D,
    end: Point2D,
    radius: number,
    intensity: number,
    feather: number,
    toolId: string,
  ): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const displacement = Math.sqrt(dx * dx + dy * dy);

    if (displacement === 0) return;

    const normalizedDx = dx / displacement;
    const normalizedDy = dy / displacement;

    // Tool-specific displacement calculations
    let displacementX = normalizedDx * intensity * 0.5;
    let displacementY = normalizedDy * intensity * 0.5;

    // Adjust displacement based on tool type
    if (
      toolId.includes("height") ||
      toolId.includes("lengthen") ||
      toolId.includes("extend")
    ) {
      displacementY *= 2; // Emphasize vertical movement
      displacementX *= 0.5;
    } else if (toolId.includes("width") || toolId.includes("widen")) {
      displacementX *= 2; // Emphasize horizontal movement
      displacementY *= 0.5;
    }

    for (
      let y = Math.max(0, start.y - radius);
      y < Math.min(source.height, start.y + radius);
      y++
    ) {
      for (
        let x = Math.max(0, start.x - radius);
        x < Math.min(source.width, start.x + radius);
        x++
      ) {
        const distToStart = Math.sqrt((x - start.x) ** 2 + (y - start.y) ** 2);

        if (distToStart < radius) {
          let effectStrength = 1 - distToStart / radius;
          effectStrength = this.smoothStep(effectStrength);

          // Apply feathering
          if (feather > 0) {
            const featherZone = radius * (feather / 100);
            if (distToStart > radius - featherZone) {
              const featherFactor = (radius - distToStart) / featherZone;
              effectStrength *= this.smoothStep(featherFactor);
            }
          }

          const sourceX = x - displacementX * effectStrength;
          const sourceY = y - displacementY * effectStrength;

          this.bilinearInterpolation(source, target, sourceX, sourceY, x, y);
        }
      }
    }
  }

  // Sculpt Tool - For body contouring
  private async applySculptTool(
    tool: VisualPatchTool,
    regions: EditRegion[],
    settings: ToolSettings,
  ): Promise<void> {
    for (const region of regions) {
      const imageData = this.ctx.getImageData(
        0,
        0,
        this.canvas.width,
        this.canvas.height,
      );
      const newImageData = this.ctx.createImageData(
        imageData.width,
        imageData.height,
      );

      newImageData.data.set(imageData.data);

      for (const point of region.points) {
        this.applySculptEffect(
          imageData,
          newImageData,
          point,
          region.brushSize,
          region.intensity * (settings.intensity / 100),
          region.feather,
          tool.id,
        );
      }

      this.ctx.putImageData(newImageData, 0, 0);
      this.applySmoothing(region.feather);
    }
  }

  private applySculptEffect(
    source: ImageData,
    target: ImageData,
    center: Point2D,
    radius: number,
    intensity: number,
    feather: number,
    toolId: string,
  ): void {
    const centerX = center.x;
    const centerY = center.y;

    for (
      let y = Math.max(0, centerY - radius);
      y < Math.min(source.height, centerY + radius);
      y++
    ) {
      for (
        let x = Math.max(0, centerX - radius);
        x < Math.min(source.width, centerX + radius);
        x++
      ) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < radius) {
          let effectStrength = 1 - distance / radius;
          effectStrength = this.smoothStep(effectStrength);

          // Apply feathering
          if (feather > 0) {
            const featherZone = radius * (feather / 100);
            if (distance > radius - featherZone) {
              const featherFactor = (radius - distance) / featherZone;
              effectStrength *= this.smoothStep(featherFactor);
            }
          }

          // Tool-specific sculpting
          let displacementFactor = 0;
          if (
            toolId.includes("flatten") ||
            toolId.includes("slim") ||
            toolId.includes("tighten")
          ) {
            displacementFactor = -intensity * effectStrength * 0.2; // Inward displacement
          } else if (toolId.includes("enhance") || toolId.includes("lift")) {
            displacementFactor = intensity * effectStrength * 0.15; // Outward displacement
          }

          const sourceX = x + dx * displacementFactor;
          const sourceY = y + dy * displacementFactor;

          this.bilinearInterpolation(source, target, sourceX, sourceY, x, y);
        }
      }
    }
  }

  // Brush Tool - For manual editing
  private async applyBrushTool(
    tool: VisualPatchTool,
    regions: EditRegion[],
    settings: ToolSettings,
  ): Promise<void> {
    for (const region of regions) {
      if (tool.id === "freeform-reset") {
        // Reset to original
        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.drawImage(this.originalCanvas, 0, 0);
        continue;
      }

      this.ctx.globalCompositeOperation = "source-over";
      this.ctx.globalAlpha = settings.intensity / 100;

      for (let i = 0; i < region.points.length - 1; i++) {
        const start = region.points[i];
        const end = region.points[i + 1];

        this.ctx.beginPath();
        this.ctx.moveTo(start.x, start.y);
        this.ctx.lineTo(end.x, end.y);
        this.ctx.lineWidth = region.brushSize;
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";

        if (tool.id === "freeform-highlighter") {
          this.ctx.strokeStyle = tool.previewColor;
          this.ctx.globalCompositeOperation = "overlay";
        } else {
          this.ctx.strokeStyle = "rgba(0,0,0,0.1)";
          this.ctx.globalCompositeOperation = "multiply";
        }

        this.ctx.stroke();
      }

      this.ctx.globalAlpha = 1;
      this.ctx.globalCompositeOperation = "source-over";
    }
  }

  // Smooth Tool - For softening
  private async applySmoothTool(
    _tool: VisualPatchTool,
    regions: EditRegion[],
    settings: ToolSettings,
  ): Promise<void> {
    for (const region of regions) {
      for (const point of region.points) {
        this.applyGaussianBlur(
          point,
          region.brushSize,
          settings.intensity / 100,
        );
      }
    }
  }

  // Curve Tool - For flowing adjustments
  private async applyCurveTool(
    tool: VisualPatchTool,
    regions: EditRegion[],
    settings: ToolSettings,
  ): Promise<void> {
    for (const region of regions) {
      if (region.points.length < 3) continue;

      const splinePoints = this.generateSpline(region.points, 10);

      for (let i = 0; i < splinePoints.length - 1; i++) {
        const start = splinePoints[i];
        const end = splinePoints[i + 1];

        this.applyCurveDisplacement(
          start,
          end,
          region.brushSize,
          settings.intensity / 100,
          tool.id,
        );
      }
    }
  }

  // Mirror Tool - For symmetry
  private async applyMirrorTool(
    _tool: VisualPatchTool,
    regions: EditRegion[],
    _settings: ToolSettings,
  ): Promise<void> {
    for (const region of regions) {
      const bounds = this.getRegionBounds(region.points);
      const centerX = (bounds.left + bounds.right) / 2;

      // Mirror to right side
      this.ctx.save();
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(
        this.canvas,
        bounds.left,
        bounds.top,
        centerX - bounds.left,
        bounds.bottom - bounds.top,
        -bounds.right,
        bounds.top,
        centerX - bounds.left,
        bounds.bottom - bounds.top,
      );
      this.ctx.restore();
    }
  }

  // Drag Tool - For position adjustments
  private async applyDragTool(
    _tool: VisualPatchTool,
    regions: EditRegion[],
    settings: ToolSettings,
  ): Promise<void> {
    // Implementation for drag-based tools
    for (const region of regions) {
      if (region.points.length < 2) continue;

      const start = region.points[0];
      const end = region.points[region.points.length - 1];
      const dx = end.x - start.x;
      const dy = end.y - start.y;

      this.applyDragDisplacement(
        start,
        dx,
        dy,
        region.brushSize,
        settings.intensity / 100,
      );
    }
  }

  // Helper Methods
  private smoothStep(t: number): number {
    return t * t * (3 - 2 * t);
  }

  private bilinearInterpolation(
    source: ImageData,
    target: ImageData,
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
  ): void {
    const x1 = Math.floor(sourceX);
    const y1 = Math.floor(sourceY);
    const x2 = Math.min(x1 + 1, source.width - 1);
    const y2 = Math.min(y1 + 1, source.height - 1);

    if (x1 < 0 || y1 < 0 || x2 >= source.width || y2 >= source.height) {
      return;
    }

    const fx = sourceX - x1;
    const fy = sourceY - y1;

    const getPixel = (x: number, y: number) => {
      const index = (y * source.width + x) * 4;
      return [
        source.data[index],
        source.data[index + 1],
        source.data[index + 2],
        source.data[index + 3],
      ];
    };

    const p1 = getPixel(x1, y1);
    const p2 = getPixel(x2, y1);
    const p3 = getPixel(x1, y2);
    const p4 = getPixel(x2, y2);

    const targetIndex = (targetY * target.width + targetX) * 4;

    for (let i = 0; i < 4; i++) {
      const top = p1[i] * (1 - fx) + p2[i] * fx;
      const bottom = p3[i] * (1 - fx) + p4[i] * fx;
      target.data[targetIndex + i] = top * (1 - fy) + bottom * fy;
    }
  }

  private applySmoothing(feather: number): void {
    if (feather > 0) {
      const radius = Math.max(1, feather / 10);
      this.applyGaussianBlur({ x: 0, y: 0 }, radius * 2, 0.3);
    }
  }

  private applyGaussianBlur(
    _center: Point2D,
    radius: number,
    intensity: number,
  ): void {
    const imageData = this.ctx.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    const blurred = this.gaussianBlur(imageData, radius * intensity);
    this.ctx.putImageData(blurred, 0, 0);
  }

  private gaussianBlur(imageData: ImageData, radius: number): ImageData {
    const kernel = this.generateGaussianKernel(radius);
    const blurred = this.ctx.createImageData(imageData.width, imageData.height);

    // Apply horizontal pass
    this.convolve(imageData, blurred, kernel, true);

    // Apply vertical pass
    const temp = this.ctx.createImageData(imageData.width, imageData.height);
    this.convolve(blurred, temp, kernel, false);

    return temp;
  }

  private generateGaussianKernel(radius: number): number[] {
    const size = Math.ceil(radius) * 2 + 1;
    const kernel: number[] = [];
    const sigma = radius / 3;
    let sum = 0;

    for (let i = 0; i < size; i++) {
      const x = i - Math.floor(size / 2);
      const value = Math.exp(-(x * x) / (2 * sigma * sigma));
      kernel[i] = value;
      sum += value;
    }

    // Normalize kernel
    return kernel.map((value) => value / sum);
  }

  private convolve(
    source: ImageData,
    target: ImageData,
    kernel: number[],
    horizontal: boolean,
  ): void {
    const width = source.width;
    const height = source.height;
    const kernelSize = kernel.length;
    const kernelRadius = Math.floor(kernelSize / 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0,
          g = 0,
          b = 0,
          a = 0;

        for (let k = 0; k < kernelSize; k++) {
          const offset = k - kernelRadius;
          let sampleX = x;
          let sampleY = y;

          if (horizontal) {
            sampleX = Math.max(0, Math.min(width - 1, x + offset));
          } else {
            sampleY = Math.max(0, Math.min(height - 1, y + offset));
          }

          const sourceIndex = (sampleY * width + sampleX) * 4;
          const weight = kernel[k];

          r += source.data[sourceIndex] * weight;
          g += source.data[sourceIndex + 1] * weight;
          b += source.data[sourceIndex + 2] * weight;
          a += source.data[sourceIndex + 3] * weight;
        }

        const targetIndex = (y * width + x) * 4;
        target.data[targetIndex] = Math.round(r);
        target.data[targetIndex + 1] = Math.round(g);
        target.data[targetIndex + 2] = Math.round(b);
        target.data[targetIndex + 3] = Math.round(a);
      }
    }
  }

  private generateSpline(points: Point2D[], resolution: number): Point2D[] {
    if (points.length < 3) return points;

    const splinePoints: Point2D[] = [];

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      for (let t = 0; t < 1; t += 1 / resolution) {
        const x = this.catmullRom(p0.x, p1.x, p2.x, p3.x, t);
        const y = this.catmullRom(p0.y, p1.y, p2.y, p3.y, t);
        splinePoints.push({ x, y });
      }
    }

    return splinePoints;
  }

  private catmullRom(
    p0: number,
    p1: number,
    p2: number,
    p3: number,
    t: number,
  ): number {
    const t2 = t * t;
    const t3 = t2 * t;

    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    );
  }

  private applyCurveDisplacement(
    start: Point2D,
    end: Point2D,
    radius: number,
    intensity: number,
    _toolId: string,
  ): void {
    const imageData = this.ctx.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    const newImageData = this.ctx.createImageData(
      imageData.width,
      imageData.height,
    );

    newImageData.data.set(imageData.data);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance === 0) return;

    const normalizedDx = dx / distance;
    const normalizedDy = dy / distance;

    for (
      let y = Math.max(0, start.y - radius);
      y < Math.min(imageData.height, start.y + radius);
      y++
    ) {
      for (
        let x = Math.max(0, start.x - radius);
        x < Math.min(imageData.width, start.x + radius);
        x++
      ) {
        const distToLine = this.pointToLineDistance(x, y, start, end);

        if (distToLine < radius) {
          let effectStrength = 1 - distToLine / radius;
          effectStrength = this.smoothStep(effectStrength);

          const displacementX = normalizedDx * intensity * effectStrength * 10;
          const displacementY = normalizedDy * intensity * effectStrength * 10;

          const sourceX = x - displacementX;
          const sourceY = y - displacementY;

          this.bilinearInterpolation(
            imageData,
            newImageData,
            sourceX,
            sourceY,
            x,
            y,
          );
        }
      }
    }

    this.ctx.putImageData(newImageData, 0, 0);
  }

  private applyDragDisplacement(
    center: Point2D,
    dx: number,
    dy: number,
    radius: number,
    intensity: number,
  ): void {
    const imageData = this.ctx.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    const newImageData = this.ctx.createImageData(
      imageData.width,
      imageData.height,
    );

    newImageData.data.set(imageData.data);

    for (
      let y = Math.max(0, center.y - radius);
      y < Math.min(imageData.height, center.y + radius);
      y++
    ) {
      for (
        let x = Math.max(0, center.x - radius);
        x < Math.min(imageData.width, center.x + radius);
        x++
      ) {
        const distance = Math.sqrt((x - center.x) ** 2 + (y - center.y) ** 2);

        if (distance < radius) {
          let effectStrength = 1 - distance / radius;
          effectStrength = this.smoothStep(effectStrength);

          const displacementX = dx * intensity * effectStrength;
          const displacementY = dy * intensity * effectStrength;

          const sourceX = x - displacementX;
          const sourceY = y - displacementY;

          this.bilinearInterpolation(
            imageData,
            newImageData,
            sourceX,
            sourceY,
            x,
            y,
          );
        }
      }
    }

    this.ctx.putImageData(newImageData, 0, 0);
  }

  private pointToLineDistance(
    px: number,
    py: number,
    start: Point2D,
    end: Point2D,
  ): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) {
      return Math.sqrt((px - start.x) ** 2 + (py - start.y) ** 2);
    }

    const t = Math.max(
      0,
      Math.min(
        1,
        ((px - start.x) * dx + (py - start.y) * dy) / (length * length),
      ),
    );
    const projectionX = start.x + t * dx;
    const projectionY = start.y + t * dy;

    return Math.sqrt((px - projectionX) ** 2 + (py - projectionY) ** 2);
  }

  private getRegionBounds(points: Point2D[]): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;

    for (const point of points) {
      left = Math.min(left, point.x);
      top = Math.min(top, point.y);
      right = Math.max(right, point.x);
      bottom = Math.max(bottom, point.y);
    }

    return { left, top, right, bottom };
  }

  // History Management
  private addToHistory(operation: EditOperation): void {
    // Remove any operations after current index
    this.history.operations = this.history.operations.slice(
      0,
      this.history.currentIndex + 1,
    );

    // Add new operation
    this.history.operations.push(operation);
    this.history.currentIndex++;

    // Limit history size
    if (this.history.operations.length > this.history.maxHistory) {
      this.history.operations.shift();
      this.history.currentIndex--;
    }

    this.history.hasUnsavedChanges = true;
  }

  private resetHistory(): void {
    this.history = {
      operations: [],
      currentIndex: -1,
      maxHistory: 50,
      hasUnsavedChanges: false,
    };
  }

  // Undo/Redo
  // Snapshots are stored as ImageData and restored synchronously with
  // putImageData. This avoids loading a data URL through an  element,
  // which is asynchronous and unreliable in headless Chrome.
  undo(): boolean {
    if (this.history.currentIndex >= 0) {
      const operation = this.history.operations[this.history.currentIndex];
      this.ctx.putImageData(operation.beforeSnapshot, 0, 0);
      this.history.currentIndex--;
      this.history.hasUnsavedChanges = true;
      return true;
    }
    return false;
  }

  redo(): boolean {
    if (this.history.currentIndex < this.history.operations.length - 1) {
      this.history.currentIndex++;
      const operation = this.history.operations[this.history.currentIndex];
      this.ctx.putImageData(operation.afterSnapshot, 0, 0);
      this.history.hasUnsavedChanges = true;
      return true;
    }
    return false;
  }

  // Export and Utility Methods
  async exportImage(options: ExportOptions): Promise<string> {
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d")!;

    // Set up export resolution
    let scale = 1;
    switch (options.resolution) {
      case "hd":
        scale = 1920 / this.canvas.width;
        break;
      case "4k":
        scale = 3840 / this.canvas.width;
        break;
      default:
        scale = 1;
    }

    tempCanvas.width = this.canvas.width * scale;
    tempCanvas.height = this.canvas.height * scale;

    tempCtx.scale(scale, scale);
    tempCtx.drawImage(this.canvas, 0, 0);

    // Add watermark if requested
    if (options.watermark) {
      this.addWatermark(
        tempCtx,
        options.watermark,
        tempCanvas.width,
        tempCanvas.height,
      );
    }

    return tempCanvas.toDataURL(
      `image/${options.format}`,
      options.quality / 100,
    );
  }

  private addWatermark(
    ctx: CanvasRenderingContext2D,
    watermark: { text: string; position: string; opacity: number },
    width: number,
    height: number,
  ): void {
    ctx.save();
    ctx.globalAlpha = watermark.opacity;
    ctx.fillStyle = "white";
    ctx.font = `${Math.max(16, width / 40)}px Arial`;
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2;

    const textMetrics = ctx.measureText(watermark.text);
    let x = 20,
      y = 30;

    switch (watermark.position) {
      case "top-right":
        x = width - textMetrics.width - 20;
        y = 30;
        break;
      case "bottom-left":
        x = 20;
        y = height - 20;
        break;
      case "bottom-right":
        x = width - textMetrics.width - 20;
        y = height - 20;
        break;
      case "center":
        x = (width - textMetrics.width) / 2;
        y = height / 2;
        break;
    }

    ctx.strokeText(watermark.text, x, y);
    ctx.fillText(watermark.text, x, y);
    ctx.restore();
  }

  resetToOriginal(): void {
    if (this.currentSession) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(this.originalCanvas, 0, 0);
      this.resetHistory();
      this.currentSession.currentImage = this.currentSession.originalImage;
    }
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getCurrentSession(): EditSession | null {
    return this.currentSession;
  }

  getHistory(): EditHistory {
    return this.history;
  }

  canUndo(): boolean {
    return this.history.currentIndex >= 0;
  }

  canRedo(): boolean {
    return this.history.currentIndex < this.history.operations.length - 1;
  }

  hasUnsavedChanges(): boolean {
    return this.history.hasUnsavedChanges;
  }
}

export const visualPatchLabService = new VisualPatchLabService();
