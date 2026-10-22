export interface AestheticProfile {
  id: string;
  name: string;
  mood: MoodConfig;
  colorPalette: ColorPalette;
  atmosphere: AtmosphereConfig;
  textureProfile: TextureProfile;
  lightingMood: LightingMood;
}

export interface MoodConfig {
  intensity: number; // 0-1
  warmth: number; // -1 to 1 (cold to warm)
  energy: number; // 0-1 (calm to energetic)
  mystery: number; // 0-1 (clear to mysterious)
  sensuality: number; // 0-1 (subtle to intense)
  elegance: number; // 0-1 (raw to refined)
}

export interface ColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  shadows: string;
  highlights: string;
  atmosphere: string[];
  temperature: "cool" | "neutral" | "warm";
  saturationProfile: "muted" | "balanced" | "vibrant";
}

export interface AtmosphereConfig {
  fog: {
    density: number;
    color: string;
    distribution: "uniform" | "layered" | "localized";
  };
  particles: {
    type: "dust" | "smoke" | "sparkle" | "rain" | "snow" | "embers";
    density: number;
    motion: "static" | "slow" | "medium" | "fast";
    size: "fine" | "medium" | "large";
  };
  ambience: {
    soundscape?: "urban" | "nature" | "intimate" | "ethereal";
    visualRhythm: "steady" | "pulsing" | "flowing" | "chaotic";
  };
}

export interface TextureProfile {
  skinTone: {
    baseColor: string;
    undertones: string;
    smoothness: number; // 0-1
    luminosity: number; // 0-1
  };
  surfaceQuality: {
    roughness: number; // 0-1
    metallic: number; // 0-1
    subsurfaceScattering: number; // 0-1
  };
  materialEmulation: {
    type:
      | "marble"
      | "bronze"
      | "porcelain"
      | "silk"
      | "water"
      | "glass"
      | "wood"
      | "stone";
    intensity: number; // 0-1
    patina?: number; // 0-1 for aged effects
  };
}

export interface LightingMood {
  scheme: "dramatic" | "soft" | "natural" | "cinematic" | "ethereal" | "noir";
  keyLightIntensity: number;
  fillRatio: number; // Key to fill light ratio
  colorTemperature: number; // Kelvin
  contrast: number; // 0-1
  shadowDepth: number; // 0-1
}

export class AestheticEngine {
  private profiles: Map<string, AestheticProfile> = new Map();

  constructor() {
    this.initializePresetProfiles();
  }

  private initializePresetProfiles(): void {
    // Noir Atmosphere profiles
    this.addProfile({
      id: "shadow-play",
      name: "Shadow Play Portrait",
      mood: {
        intensity: 0.9,
        warmth: -0.3,
        energy: 0.3,
        mystery: 0.95,
        sensuality: 0.7,
        elegance: 0.8,
      },
      colorPalette: {
        primary: "#1a1a1a",
        secondary: "#333333",
        accent: "#ffffff",
        shadows: "#000000",
        highlights: "#f5f5f5",
        atmosphere: ["#1a1a1a", "#2d2d2d", "#404040"],
        temperature: "cool",
        saturationProfile: "muted",
      },
      atmosphere: {
        fog: {
          density: 0.6,
          color: "#1a1a1a",
          distribution: "layered",
        },
        particles: {
          type: "dust",
          density: 0.3,
          motion: "slow",
          size: "fine",
        },
        ambience: {
          soundscape: "intimate",
          visualRhythm: "steady",
        },
      },
      textureProfile: {
        skinTone: {
          baseColor: "#d4a574",
          undertones: "#c49668",
          smoothness: 0.8,
          luminosity: 0.4,
        },
        surfaceQuality: {
          roughness: 0.2,
          metallic: 0.0,
          subsurfaceScattering: 0.7,
        },
        materialEmulation: {
          type: "marble",
          intensity: 0.3,
        },
      },
      lightingMood: {
        scheme: "noir",
        keyLightIntensity: 0.8,
        fillRatio: 0.1,
        colorTemperature: 3200,
        contrast: 0.9,
        shadowDepth: 0.95,
      },
    });

    // Primal Elements profile
    this.addProfile({
      id: "earthen-texture",
      name: "Earthen Texture",
      mood: {
        intensity: 0.8,
        warmth: 0.6,
        energy: 0.4,
        mystery: 0.5,
        sensuality: 0.6,
        elegance: 0.5,
      },
      colorPalette: {
        primary: "#8B4513",
        secondary: "#A0522D",
        accent: "#DEB887",
        shadows: "#654321",
        highlights: "#F4E4BC",
        atmosphere: ["#8B4513", "#CD853F", "#DEB887"],
        temperature: "warm",
        saturationProfile: "muted",
      },
      atmosphere: {
        fog: {
          density: 0.3,
          color: "#8B4513",
          distribution: "uniform",
        },
        particles: {
          type: "dust",
          density: 0.5,
          motion: "slow",
          size: "medium",
        },
        ambience: {
          soundscape: "nature",
          visualRhythm: "flowing",
        },
      },
      textureProfile: {
        skinTone: {
          baseColor: "#d4a574",
          undertones: "#8B4513",
          smoothness: 0.3,
          luminosity: 0.6,
        },
        surfaceQuality: {
          roughness: 0.7,
          metallic: 0.0,
          subsurfaceScattering: 0.4,
        },
        materialEmulation: {
          type: "stone",
          intensity: 0.6,
          patina: 0.3,
        },
      },
      lightingMood: {
        scheme: "natural",
        keyLightIntensity: 0.7,
        fillRatio: 0.4,
        colorTemperature: 3000,
        contrast: 0.6,
        shadowDepth: 0.6,
      },
    });

    // Mystical Realms profile
    this.addProfile({
      id: "celestial-body",
      name: "Celestial Body",
      mood: {
        intensity: 0.9,
        warmth: 0.0,
        energy: 0.8,
        mystery: 0.9,
        sensuality: 0.5,
        elegance: 0.95,
      },
      colorPalette: {
        primary: "#4B0082",
        secondary: "#8A2BE2",
        accent: "#FFD700",
        shadows: "#191970",
        highlights: "#E6E6FA",
        atmosphere: ["#4B0082", "#6A5ACD", "#9370DB", "#FFD700"],
        temperature: "cool",
        saturationProfile: "vibrant",
      },
      atmosphere: {
        fog: {
          density: 0.4,
          color: "#6A5ACD",
          distribution: "localized",
        },
        particles: {
          type: "sparkle",
          density: 0.7,
          motion: "medium",
          size: "fine",
        },
        ambience: {
          soundscape: "ethereal",
          visualRhythm: "pulsing",
        },
      },
      textureProfile: {
        skinTone: {
          baseColor: "#e8d5c4",
          undertones: "#dbb5a0",
          smoothness: 0.9,
          luminosity: 0.8,
        },
        surfaceQuality: {
          roughness: 0.1,
          metallic: 0.2,
          subsurfaceScattering: 0.9,
        },
        materialEmulation: {
          type: "porcelain",
          intensity: 0.7,
        },
      },
      lightingMood: {
        scheme: "ethereal",
        keyLightIntensity: 0.6,
        fillRatio: 0.6,
        colorTemperature: 6500,
        contrast: 0.7,
        shadowDepth: 0.3,
      },
    });
  }

  public addProfile(profile: AestheticProfile): void {
    this.profiles.set(profile.id, profile);
  }

  public getProfile(id: string): AestheticProfile | undefined {
    return this.profiles.get(id);
  }

  public getAllProfiles(): AestheticProfile[] {
    return Array.from(this.profiles.values());
  }

  public applyAesthetic(
    profile: AestheticProfile,
    canvas: HTMLCanvasElement,
    intensity: number = 1.0,
  ): void {
    const ctx = canvas.getContext("2d")!;

    // Apply color grading based on mood
    this.applyColorMood(ctx, canvas, profile, intensity);

    // Apply atmospheric effects
    this.applyAtmosphere(ctx, canvas, profile.atmosphere, intensity);

    // Apply lighting mood
    this.applyLightingMood(ctx, canvas, profile.lightingMood, intensity);

    // Apply texture effects
    this.applyTextureEffects(ctx, canvas, profile.textureProfile, intensity);
  }

  private applyColorMood(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    profile: AestheticProfile,
    intensity: number,
  ): void {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const mood = profile.mood;

    for (let i = 0; i < data.length; i += 4) {
      // Apply warmth
      if (mood.warmth > 0) {
        data[i] = Math.min(255, data[i] * (1 + mood.warmth * 0.2 * intensity)); // Red
        data[i + 2] = Math.max(
          0,
          data[i + 2] * (1 - mood.warmth * 0.1 * intensity),
        ); // Blue
      } else {
        data[i] = Math.max(0, data[i] * (1 + mood.warmth * 0.1 * intensity)); // Red
        data[i + 2] = Math.min(
          255,
          data[i + 2] * (1 - mood.warmth * 0.2 * intensity),
        ); // Blue
      }

      // Apply mystery (reduce overall brightness and increase contrast)
      if (mood.mystery > 0) {
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const contrast = 1 + mood.mystery * 0.5 * intensity;
        const darkening = 1 - mood.mystery * 0.3 * intensity;

        data[i] =
          Math.max(
            0,
            Math.min(255, (data[i] - brightness) * contrast + brightness),
          ) * darkening;
        data[i + 1] =
          Math.max(
            0,
            Math.min(255, (data[i + 1] - brightness) * contrast + brightness),
          ) * darkening;
        data[i + 2] =
          Math.max(
            0,
            Math.min(255, (data[i + 2] - brightness) * contrast + brightness),
          ) * darkening;
      }

      // Apply elegance (subtle smoothing and refinement)
      if (mood.elegance > 0) {
        const smoothing = mood.elegance * 0.1 * intensity;
        data[i] = data[i] * (1 - smoothing) + 128 * smoothing;
        data[i + 1] = data[i + 1] * (1 - smoothing) + 128 * smoothing;
        data[i + 2] = data[i + 2] * (1 - smoothing) + 128 * smoothing;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  private applyAtmosphere(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    atmosphere: AtmosphereConfig,
    intensity: number,
  ): void {
    // Apply fog
    if (atmosphere.fog.density > 0) {
      this.renderFog(ctx, canvas, atmosphere.fog, intensity);
    }

    // Apply particles
    if (atmosphere.particles.density > 0) {
      this.renderParticles(ctx, canvas, atmosphere.particles, intensity);
    }
  }

  private renderFog(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    fog: AtmosphereConfig["fog"],
    intensity: number,
  ): void {
    const gradient = ctx.createRadialGradient(
      canvas.width / 2,
      canvas.height / 2,
      0,
      canvas.width / 2,
      canvas.height / 2,
      Math.max(canvas.width, canvas.height),
    );

    const fogOpacity = fog.density * intensity * 0.3;
    gradient.addColorStop(
      0,
      `rgba(${this.hexToRgb(fog.color)}, ${fogOpacity})`,
    );
    gradient.addColorStop(
      1,
      `rgba(${this.hexToRgb(fog.color)}, ${fogOpacity * 0.1})`,
    );

    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  private renderParticles(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    particles: AtmosphereConfig["particles"],
    intensity: number,
  ): void {
    const particleCount = Math.floor(particles.density * intensity * 100);

    for (let i = 0; i < particleCount; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;

      let size, opacity, color;

      switch (particles.type) {
        case "sparkle":
          size = Math.random() * 3 + 1;
          opacity = Math.random() * 0.8 + 0.2;
          color = "#FFD700";
          break;
        case "dust":
          size = Math.random() * 2 + 0.5;
          opacity = Math.random() * 0.3 + 0.1;
          color = "#999999";
          break;
        case "smoke":
          size = Math.random() * 5 + 2;
          opacity = Math.random() * 0.2 + 0.05;
          color = "#555555";
          break;
        default:
          size = Math.random() * 2 + 1;
          opacity = Math.random() * 0.5 + 0.1;
          color = "#FFFFFF";
      }

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = color;

      if (particles.type === "sparkle") {
        this.drawStar(ctx, x, y, size);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  private drawStar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
  ): void {
    const spikes = 4;
    const outerRadius = size;
    const innerRadius = size * 0.4;

    ctx.beginPath();

    for (let i = 0; i < spikes * 2; i++) {
      const angle = (i * Math.PI) / spikes;
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;

      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }

    ctx.closePath();
    ctx.fill();
  }

  private applyLightingMood(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    lighting: LightingMood,
    intensity: number,
  ): void {
    // Apply lighting scheme overlay
    const overlay = this.createLightingOverlay(canvas, lighting, intensity);
    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = intensity * 0.5;
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  private createLightingOverlay(
    canvas: HTMLCanvasElement,
    lighting: LightingMood,
    _intensity: number,
  ): CanvasGradient {
    const ctx = canvas.getContext("2d")!;

    switch (lighting.scheme) {
      case "dramatic":
        return this.createDramaticLighting(ctx, canvas, lighting);
      case "soft":
        return this.createSoftLighting(ctx, canvas, lighting);
      case "noir":
        return this.createNoirLighting(ctx, canvas, lighting);
      case "ethereal":
        return this.createEtherealLighting(ctx, canvas, lighting);
      default:
        return this.createNaturalLighting(ctx, canvas, lighting);
    }
  }

  private createDramaticLighting(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    lighting: LightingMood,
  ): CanvasGradient {
    const gradient = ctx.createRadialGradient(
      canvas.width * 0.3,
      canvas.height * 0.2,
      0,
      canvas.width * 0.3,
      canvas.height * 0.2,
      canvas.width * 0.8,
    );

    gradient.addColorStop(
      0,
      `rgba(255, 255, 255, ${lighting.keyLightIntensity * 0.3})`,
    );
    gradient.addColorStop(
      0.5,
      `rgba(255, 255, 255, ${lighting.keyLightIntensity * 0.1})`,
    );
    gradient.addColorStop(1, `rgba(0, 0, 0, ${lighting.shadowDepth * 0.5})`);

    return gradient;
  }

  private createNoirLighting(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    lighting: LightingMood,
  ): CanvasGradient {
    const gradient = ctx.createLinearGradient(
      0,
      0,
      canvas.width,
      canvas.height,
    );

    gradient.addColorStop(0, `rgba(0, 0, 0, ${lighting.shadowDepth * 0.8})`);
    gradient.addColorStop(
      0.3,
      `rgba(255, 255, 255, ${lighting.keyLightIntensity * 0.2})`,
    );
    gradient.addColorStop(1, `rgba(0, 0, 0, ${lighting.shadowDepth * 0.9})`);

    return gradient;
  }

  private createEtherealLighting(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    lighting: LightingMood,
  ): CanvasGradient {
    const gradient = ctx.createRadialGradient(
      canvas.width / 2,
      canvas.height / 3,
      0,
      canvas.width / 2,
      canvas.height / 3,
      canvas.height,
    );

    gradient.addColorStop(
      0,
      `rgba(255, 255, 255, ${lighting.keyLightIntensity * 0.4})`,
    );
    gradient.addColorStop(
      0.5,
      `rgba(200, 220, 255, ${lighting.fillRatio * 0.2})`,
    );
    gradient.addColorStop(
      1,
      `rgba(100, 150, 255, ${lighting.shadowDepth * 0.1})`,
    );

    return gradient;
  }

  private createSoftLighting(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    lighting: LightingMood,
  ): CanvasGradient {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);

    gradient.addColorStop(
      0,
      `rgba(255, 255, 255, ${lighting.keyLightIntensity * 0.2})`,
    );
    gradient.addColorStop(
      1,
      `rgba(255, 255, 255, ${lighting.fillRatio * 0.1})`,
    );

    return gradient;
  }

  private createNaturalLighting(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    lighting: LightingMood,
  ): CanvasGradient {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);

    gradient.addColorStop(
      0,
      `rgba(255, 240, 200, ${lighting.keyLightIntensity * 0.15})`,
    );
    gradient.addColorStop(
      1,
      `rgba(200, 200, 255, ${lighting.fillRatio * 0.1})`,
    );

    return gradient;
  }

  private applyTextureEffects(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    texture: TextureProfile,
    intensity: number,
  ): void {
    // Apply material emulation effects
    this.applyMaterialEmulation(
      ctx,
      canvas,
      texture.materialEmulation,
      intensity,
    );
  }

  private applyMaterialEmulation(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    material: TextureProfile["materialEmulation"],
    intensity: number,
  ): void {
    // Create texture overlay based on material type
    const overlay = this.createMaterialOverlay(ctx, canvas, material);

    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = material.intensity * intensity * 0.3;
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  private createMaterialOverlay(
    ctx: CanvasRenderingContext2D,
    _canvas: HTMLCanvasElement,
    material: TextureProfile["materialEmulation"],
  ): CanvasPattern {
    // Create a small canvas for the pattern
    const patternCanvas = document.createElement("canvas");
    patternCanvas.width = 100;
    patternCanvas.height = 100;
    const patternCtx = patternCanvas.getContext("2d")!;

    switch (material.type) {
      case "marble":
        this.drawMarblePattern(patternCtx, patternCanvas);
        break;
      case "bronze":
        this.drawBronzePattern(patternCtx, patternCanvas);
        break;
      case "porcelain":
        this.drawPorcelainPattern(patternCtx, patternCanvas);
        break;
      default:
        this.drawDefaultPattern(patternCtx, patternCanvas);
    }

    return ctx.createPattern(patternCanvas, "repeat")!;
  }

  private drawMarblePattern(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    // Create marble-like veining pattern
    const gradient = ctx.createLinearGradient(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.1)");
    gradient.addColorStop(0.5, "rgba(200, 200, 200, 0.05)");
    gradient.addColorStop(1, "rgba(150, 150, 150, 0.02)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add veining
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(100, 100, 100, ${Math.random() * 0.1 + 0.05})`;
      ctx.lineWidth = Math.random() * 2 + 0.5;
      ctx.moveTo(Math.random() * canvas.width, Math.random() * canvas.height);

      for (let j = 0; j < 3; j++) {
        ctx.quadraticCurveTo(
          Math.random() * canvas.width,
          Math.random() * canvas.height,
          Math.random() * canvas.width,
          Math.random() * canvas.height,
        );
      }

      ctx.stroke();
    }
  }

  private drawBronzePattern(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    const gradient = ctx.createRadialGradient(
      canvas.width / 2,
      canvas.height / 2,
      0,
      canvas.width / 2,
      canvas.height / 2,
      canvas.width / 2,
    );
    gradient.addColorStop(0, "rgba(205, 127, 50, 0.1)");
    gradient.addColorStop(1, "rgba(160, 82, 45, 0.05)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  private drawPorcelainPattern(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    const gradient = ctx.createLinearGradient(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.08)");
    gradient.addColorStop(1, "rgba(240, 240, 255, 0.04)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  private drawDefaultPattern(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  private hexToRgb(hex: string): string {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
      : "0, 0, 0";
  }

  public createCustomProfile(
    baseProfile: string,
    modifications: Partial<AestheticProfile>,
  ): AestheticProfile {
    const base = this.getProfile(baseProfile);
    if (!base) {
      throw new Error(`Base profile '${baseProfile}' not found`);
    }

    return {
      ...base,
      ...modifications,
      id: modifications.id || `custom_${Date.now()}`,
      name: modifications.name || `Custom ${base.name}`,
    };
  }
}
