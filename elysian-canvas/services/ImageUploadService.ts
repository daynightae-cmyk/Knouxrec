export interface UploadedImage {
  id: string;
  file: File;
  url: string;
  thumbnail: string;
  metadata: {
    width: number;
    height: number;
    size: number;
    format: string;
    name: string;
  };
  processed?: {
    enhanced: string;
    filtered: string;
    optimized: string;
  };
}

export class ImageUploadService {
  private uploadedImages: Map<string, UploadedImage> = new Map();

  // Guard rails: an unbounded upload is decoded into a data URL and then into
  // three full-resolution canvases, which is enough to exhaust the renderer
  // memory on a large photo.
  private readonly maxFileBytes = 25 * 1024 * 1024;
  private readonly maxDimension = 8192;

  async uploadImage(file: File): Promise<UploadedImage> {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        reject(new Error("Please select a valid image file"));
        return;
      }

      if (file.size > this.maxFileBytes) {
        reject(
          new Error(
            `The image is too large (${Math.round(
              file.size / (1024 * 1024),
            )} MB). The limit is ${Math.round(this.maxFileBytes / (1024 * 1024))} MB.`,
          ),
        );
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const url = e.target?.result as string;
          const img = new Image();

          img.onload = async () => {
            if (img.width > this.maxDimension || img.height > this.maxDimension) {
              reject(
                new Error(
                  `The image is too large (${img.width}x${img.height}). The limit is ${this.maxDimension} pixels per side.`,
                ),
              );
              return;
            }

            const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Create thumbnail
            const thumbnail = await this.createThumbnail(img, 200, 200);

            const uploadedImage: UploadedImage = {
              id,
              file,
              url,
              thumbnail,
              metadata: {
                width: img.width,
                height: img.height,
                size: file.size,
                format: file.type,
                name: file.name,
              },
            };

            this.uploadedImages.set(id, uploadedImage);

            // Start background processing
            this.processImageAsync(uploadedImage);

            resolve(uploadedImage);
          };

          img.onerror = () => reject(new Error("Failed to load image"));
          img.src = url;
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }

  private async createThumbnail(
    img: HTMLImageElement,
    maxWidth: number,
    maxHeight: number,
  ): Promise<string> {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    // Calculate aspect ratio
    const aspectRatio = img.width / img.height;
    let width = maxWidth;
    let height = maxHeight;

    if (aspectRatio > 1) {
      height = width / aspectRatio;
    } else {
      width = height * aspectRatio;
    }

    canvas.width = width;
    canvas.height = height;

    // Draw and compress
    ctx.drawImage(img, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg", 0.8);
  }

  private async processImageAsync(uploadedImage: UploadedImage): Promise<void> {
    try {
      const img = new Image();
      img.onload = async () => {
        const processed = {
          enhanced: await this.enhanceImage(img),
          filtered: await this.applyArtisticFilters(img),
          optimized: await this.optimizeForCanvas(img),
        };

        uploadedImage.processed = processed;
        this.uploadedImages.set(uploadedImage.id, uploadedImage);
      };
      img.src = uploadedImage.url;
    } catch (error) {
      console.warn("Image processing failed:", error);
    }
  }

  private async enhanceImage(img: HTMLImageElement): Promise<string> {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    canvas.width = img.width;
    canvas.height = img.height;

    // Draw original image
    ctx.drawImage(img, 0, 0);

    // Apply enhancement filters
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Enhance contrast and brightness
    for (let i = 0; i < data.length; i += 4) {
      // Increase contrast
      data[i] = Math.min(255, (data[i] - 128) * 1.2 + 128); // Red
      data[i + 1] = Math.min(255, (data[i + 1] - 128) * 1.2 + 128); // Green
      data[i + 2] = Math.min(255, (data[i + 2] - 128) * 1.2 + 128); // Blue

      // Slight brightness boost
      data[i] = Math.min(255, data[i] * 1.1);
      data[i + 1] = Math.min(255, data[i + 1] * 1.1);
      data[i + 2] = Math.min(255, data[i + 2] * 1.1);
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  private async applyArtisticFilters(img: HTMLImageElement): Promise<string> {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    canvas.width = img.width;
    canvas.height = img.height;

    // Apply artistic filter
    ctx.filter = "contrast(1.1) saturate(1.2) brightness(1.05)";
    ctx.drawImage(img, 0, 0);

    return canvas.toDataURL("image/jpeg", 0.9);
  }

  private async optimizeForCanvas(img: HTMLImageElement): Promise<string> {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    // Optimize size for canvas rendering
    const maxDimension = 2048;
    let width = img.width;
    let height = img.height;

    if (width > maxDimension || height > maxDimension) {
      const scale = maxDimension / Math.max(width, height);
      width *= scale;
      height *= scale;
    }

    canvas.width = width;
    canvas.height = height;

    // Enable image smoothing for better quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(img, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg", 0.95);
  }

  getUploadedImage(id: string): UploadedImage | undefined {
    return this.uploadedImages.get(id);
  }

  getAllImages(): UploadedImage[] {
    return Array.from(this.uploadedImages.values());
  }

  deleteImage(id: string): boolean {
    return this.uploadedImages.delete(id);
  }

  async convertImageToCanvas(
    imageId: string,
    canvas: HTMLCanvasElement,
  ): Promise<boolean> {
    const uploadedImage = this.getUploadedImage(imageId);
    if (!uploadedImage) return false;

    const ctx = canvas.getContext("2d")!;
    const img = new Image();

    return new Promise((resolve) => {
      img.onload = () => {
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Calculate scaling to fit canvas while maintaining aspect ratio
        const canvasAspect = canvas.width / canvas.height;
        const imageAspect = img.width / img.height;

        let drawWidth, drawHeight, drawX, drawY;

        if (canvasAspect > imageAspect) {
          drawHeight = canvas.height;
          drawWidth = drawHeight * imageAspect;
          drawX = (canvas.width - drawWidth) / 2;
          drawY = 0;
        } else {
          drawWidth = canvas.width;
          drawHeight = drawWidth / imageAspect;
          drawX = 0;
          drawY = (canvas.height - drawHeight) / 2;
        }

        // Draw image centered on canvas
        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
        resolve(true);
      };

      img.onerror = () => resolve(false);

      // Use processed version if available, otherwise original
      const imageUrl = uploadedImage.processed?.optimized || uploadedImage.url;
      img.src = imageUrl;
    });
  }
}

export const imageUploadService = new ImageUploadService();
