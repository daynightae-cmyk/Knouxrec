export interface RenderConfig {
  lighting: LightingConfig;
  depth: DepthConfig;
  layers: LayerConfig[];
  cinematography: CinematographyConfig;
  qualitySettings: QualitySettings;
}

export interface LightingConfig {
  primaryLight: {
    intensity: number;
    color: string;
    position: { x: number; y: number; z: number };
    softness: number;
  };
  fillLight?: {
    intensity: number;
    color: string;
    position: { x: number; y: number; z: number };
  };
  rimLight?: {
    intensity: number;
    color: string;
    position: { x: number; y: number; z: number };
  };
  ambientLight: {
    intensity: number;
    color: string;
  };
  shadows: {
    enabled: boolean;
    softness: number;
    opacity: number;
  };
}

export interface DepthConfig {
  fieldOfView: number;
  focusDistance: number;
  aperture: number;
  bokehIntensity: number;
  depthOfField: boolean;
}

export interface LayerConfig {
  id: string;
  type: "background" | "subject" | "foreground" | "effect" | "overlay";
  opacity: number;
  blendMode: string;
  transform: {
    scale: number;
    rotation: number;
    position: { x: number; y: number };
  };
  filters: FilterEffect[];
}

export interface FilterEffect {
  type: string;
  intensity: number;
  parameters: Record<string, any>;
}

export interface CinematographyConfig {
  camera: {
    angle: number;
    height: number;
    distance: number;
  };
  composition: {
    rule: "thirds" | "golden" | "center" | "dynamic";
    guides: boolean;
  };
  colorGrading: {
    highlights: { r: number; g: number; b: number };
    midtones: { r: number; g: number; b: number };
    shadows: { r: number; g: number; b: number };
    saturation: number;
    contrast: number;
  };
}

export interface QualitySettings {
  resolution: { width: number; height: number };
  antiAliasing: "none" | "fxaa" | "msaa" | "ssaa";
  renderScale: number;
  maxTextureDimension: number;
}

export class MasterRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private renderConfig: RenderConfig;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.renderConfig = this.getDefaultConfig();
  }

  private getDefaultConfig(): RenderConfig {
    return {
      lighting: {
        primaryLight: {
          intensity: 1.0,
          color: "#ffffff",
          position: { x: 0, y: 0, z: 1 },
          softness: 0.5,
        },
        ambientLight: {
          intensity: 0.3,
          color: "#ffffff",
        },
        shadows: {
          enabled: true,
          softness: 0.5,
          opacity: 0.6,
        },
      },
      depth: {
        fieldOfView: 75,
        focusDistance: 1.0,
        aperture: 2.8,
        bokehIntensity: 0.5,
        depthOfField: true,
      },
      layers: [],
      cinematography: {
        camera: {
          angle: 0,
          height: 0,
          distance: 1,
        },
        composition: {
          rule: "thirds",
          guides: false,
        },
        colorGrading: {
          highlights: { r: 1, g: 1, b: 1 },
          midtones: { r: 1, g: 1, b: 1 },
          shadows: { r: 1, g: 1, b: 1 },
          saturation: 1,
          contrast: 1,
        },
      },
      qualitySettings: {
        resolution: { width: 1920, height: 1080 },
        antiAliasing: "fxaa",
        renderScale: 1.0,
        maxTextureDimension: 4096,
      },
    };
  }

  public updateConfig(newConfig: Partial<RenderConfig>): void {
    this.renderConfig = { ...this.renderConfig, ...newConfig };
  }

  public async renderScene(layers: LayerConfig[]): Promise<ImageData> {
    this.prepareCanvas();

    // Sort layers by type and z-index
    const sortedLayers = this.sortLayers(layers);

    for (const layer of sortedLayers) {
      await this.renderLayer(layer);
    }

    this.applyPostProcessing();

    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }

  private prepareCanvas(): void {
    const { width, height } = this.renderConfig.qualitySettings.resolution;
    this.canvas.width = width;
    this.canvas.height = height;

    // Clear canvas with ambient lighting
    const ambientColor = this.renderConfig.lighting.ambientLight.color;
    const ambientIntensity = this.renderConfig.lighting.ambientLight.intensity;

    this.ctx.fillStyle = this.adjustColorIntensity(
      ambientColor,
      ambientIntensity,
    );
    this.ctx.fillRect(0, 0, width, height);
  }

  private sortLayers(layers: LayerConfig[]): LayerConfig[] {
    const layerOrder = [
      "background",
      "subject",
      "foreground",
      "effect",
      "overlay",
    ];
    return layers.sort((a, b) => {
      return layerOrder.indexOf(a.type) - layerOrder.indexOf(b.type);
    });
  }

  private async renderLayer(layer: LayerConfig): Promise<void> {
    this.ctx.save();

    // Apply layer transforms
    this.applyLayerTransform(layer);

    // Set blend mode and opacity
    this.ctx.globalCompositeOperation =
      layer.blendMode as GlobalCompositeOperation;
    this.ctx.globalAlpha = layer.opacity;

    // Apply filters
    this.applyLayerFilters(layer.filters);

    // Render layer content (this would be implemented based on layer type)
    await this.renderLayerContent(layer);

    this.ctx.restore();
  }

  private applyLayerTransform(layer: LayerConfig): void {
    const { scale, rotation, position } = layer.transform;

    this.ctx.translate(position.x, position.y);
    this.ctx.rotate((rotation * Math.PI) / 180);
    this.ctx.scale(scale, scale);
  }

  private applyLayerFilters(filters: FilterEffect[]): void {
    let filterString = "";

    filters.forEach((filter) => {
      switch (filter.type) {
        case "blur":
          filterString += `blur(${filter.intensity}px) `;
          break;
        case "brightness":
          filterString += `brightness(${filter.intensity}) `;
          break;
        case "contrast":
          filterString += `contrast(${filter.intensity}) `;
          break;
        case "saturate":
          filterString += `saturate(${filter.intensity}) `;
          break;
        case "hue-rotate":
          filterString += `hue-rotate(${filter.intensity}deg) `;
          break;
      }
    });

    if (filterString) {
      this.ctx.filter = filterString.trim();
    }
  }

  private async renderLayerContent(layer: LayerConfig): Promise<void> {
    // This would be implemented based on the specific layer type
    // For now, just a placeholder that renders a colored rectangle
    switch (layer.type) {
      case "background":
        this.renderBackground(layer);
        break;
      case "subject":
        await this.renderSubject(layer);
        break;
      case "effect":
        this.renderEffect(layer);
        break;
      default:
        break;
    }
  }

  private renderBackground(_layer: LayerConfig): void {
    const gradient = this.ctx.createLinearGradient(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    gradient.addColorStop(0, "rgba(20, 20, 40, 1)");
    gradient.addColorStop(1, "rgba(40, 20, 60, 1)");

    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private async renderSubject(_layer: LayerConfig): Promise<void> {
    // Apply cinematic lighting to the subject
    this.applyCinematicLighting();
  }

  private renderEffect(_layer: LayerConfig): void {
    // Render various visual effects
    this.applyParticleEffects();
  }

  private applyCinematicLighting(): void {
    const lighting = this.renderConfig.lighting;

    if (lighting.shadows.enabled) {
      this.renderShadows();
    }

    this.renderLightSources();
  }

  private renderShadows(): void {
    const shadows = this.renderConfig.lighting.shadows;

    this.ctx.save();
    this.ctx.globalAlpha = shadows.opacity;
    this.ctx.filter = `blur(${shadows.softness * 5}px)`;

    // Render shadow geometry
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    // Shadow rendering logic would go here

    this.ctx.restore();
  }

  private renderLightSources(): void {
    const lighting = this.renderConfig.lighting;

    // Primary light
    this.renderLightSource(lighting.primaryLight);

    // Fill light
    if (lighting.fillLight) {
      this.renderLightSource(lighting.fillLight);
    }

    // Rim light
    if (lighting.rimLight) {
      this.renderLightSource(lighting.rimLight);
    }
  }

  private renderLightSource(light: any): void {
    const gradient = this.ctx.createRadialGradient(
      light.position.x,
      light.position.y,
      0,
      light.position.x,
      light.position.y,
      200,
    );

    const lightColor = this.adjustColorIntensity(light.color, light.intensity);
    gradient.addColorStop(0, lightColor);
    gradient.addColorStop(1, "transparent");

    this.ctx.save();
    this.ctx.globalCompositeOperation = "overlay";
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  private applyParticleEffects(): void {
    // Render particle systems for atmospheric effects
    this.renderAtmosphericParticles();
  }

  private renderAtmosphericParticles(): void {
    const particleCount = 50;

    for (let i = 0; i < particleCount; i++) {
      const x = Math.random() * this.canvas.width;
      const y = Math.random() * this.canvas.height;
      const size = Math.random() * 3 + 1;
      const opacity = Math.random() * 0.5 + 0.1;

      this.ctx.save();
      this.ctx.globalAlpha = opacity;
      this.ctx.fillStyle = "white";
      this.ctx.beginPath();
      this.ctx.arc(x, y, size, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }
  }

  private applyPostProcessing(): void {
    const colorGrading = this.renderConfig.cinematography.colorGrading;

    // Apply color grading
    this.applyColorGrading(colorGrading);

    // Apply depth of field if enabled
    if (this.renderConfig.depth.depthOfField) {
      this.applyDepthOfField();
    }
  }

  private applyColorGrading(grading: any): void {
    const imageData = this.ctx.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      // Apply color grading to RGB channels
      data[i] *= grading.highlights.r * grading.contrast; // Red
      data[i + 1] *= grading.highlights.g * grading.contrast; // Green
      data[i + 2] *= grading.highlights.b * grading.contrast; // Blue

      // Apply saturation
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = gray + (data[i] - gray) * grading.saturation;
      data[i + 1] = gray + (data[i + 1] - gray) * grading.saturation;
      data[i + 2] = gray + (data[i + 2] - gray) * grading.saturation;
    }

    this.ctx.putImageData(imageData, 0, 0);
  }

  private applyDepthOfField(): void {
    const depth = this.renderConfig.depth;
    const blurRadius = (1 - depth.focusDistance) * depth.bokehIntensity * 10;

    if (blurRadius > 0) {
      this.ctx.filter = `blur(${blurRadius}px)`;
      const imageData = this.ctx.getImageData(
        0,
        0,
        this.canvas.width,
        this.canvas.height,
      );
      this.ctx.filter = "none";
      this.ctx.putImageData(imageData, 0, 0);
    }
  }

  private adjustColorIntensity(color: string, intensity: number): string {
    // Convert hex to RGB and adjust intensity
    const hex = color.replace("#", "");
    const r = Math.min(255, parseInt(hex.substr(0, 2), 16) * intensity);
    const g = Math.min(255, parseInt(hex.substr(2, 2), 16) * intensity);
    const b = Math.min(255, parseInt(hex.substr(4, 2), 16) * intensity);

    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }

  public exportImage(
    format: "png" | "jpeg" | "webp" = "png",
    quality = 1.0,
  ): string {
    return this.canvas.toDataURL(`image/${format}`, quality);
  }

  public getConfig(): RenderConfig {
    return { ...this.renderConfig };
  }
}
