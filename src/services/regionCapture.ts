/**
 * OS-level region capture.
 *
 * Captures the authorized screen stream, lets the caller select a sub-region
 * of it, and returns a real cropped image. The region is expressed in CSS /
 * device-independent pixels of the captured screen; the crop is performed in
 * device pixels using window.devicePixelRatio so multi-monitor and scaled
 * displays land on the correct coordinates.
 *
 * Nothing is fabricated: if the platform does not offer a display surface,
 * the user cancels the picker, or no frame ever arrives, the call fails with
 * a clear error and releases every track it opened.
 */

export interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionCaptureResult {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  region: ScreenRegion;
  devicePixelRatio: number;
  sourceSize: { width: number; height: number };
}

function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* noop */
    }
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampRegion(
  region: ScreenRegion,
  maxWidth: number,
  maxHeight: number,
): ScreenRegion {
  const x = clamp(Math.floor(region.x), 0, maxWidth);
  const y = clamp(Math.floor(region.y), 0, maxHeight);
  const width = Math.max(1, Math.min(Math.ceil(region.width), maxWidth - x));
  const height = Math.max(1, Math.min(Math.ceil(region.height), maxHeight - y));
  return { x, y, width, height };
}

function waitForFrame(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      video.pause();
      video.srcObject = null;
      reject(new Error("The capture stream did not provide any video frames."));
    }, 10000);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("error", onError);
    };
    const onMetadata = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolve();
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error("The capture stream could not be decoded."));
    };
    video.addEventListener("loadedmetadata", onMetadata, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

export async function captureRegion(options: {
  region: ScreenRegion;
  mimeType?: "png" | "jpeg" | "webp";
  quality?: number;
  sourceStream?: MediaStream | null;
  /** Region already measured in video source pixels rather than CSS screen pixels. */
  sourcePixels?: boolean;
}): Promise<RegionCaptureResult> {
  const { region } = options;
  const mimeType = options.mimeType ?? "png";
  const quality = options.quality === undefined ? 0.92 : options.quality;
  const format = mimeType === "jpeg" ? "image/jpeg" : mimeType === "webp" ? "image/webp" : "image/png";

  let stream = options.sourceStream ?? null;
  let owned = false;

  try {
    if (!stream) {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("OS display capture is not available in this runtime.");
      }
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });
      owned = true;
      if (stream.getVideoTracks().length === 0) {
        stopStream(stream);
        throw new Error("The display picker returned no video track.");
      }
    }

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    try {
      await video.play().catch(() => undefined);
      await waitForFrame(video);
      if (!video.videoWidth || !video.videoHeight) {
        throw new Error("The capture stream did not provide any video frames.");
      }

      const dpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;

      // The region is expressed in CSS pixels of the captured screen. Convert
      // to device pixels before cropping so scaled displays stay accurate.
      const physical = clampRegion(
        options.sourcePixels ? region : {
          x: region.x * dpr,
          y: region.y * dpr,
          width: region.width * dpr,
          height: region.height * dpr,
        },
        sourceWidth,
        sourceHeight,
      );

      const canvas = document.createElement("canvas");
      canvas.width = physical.width;
      canvas.height = physical.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The capture canvas is unavailable.");

      context.drawImage(
        video,
        physical.x,
        physical.y,
        physical.width,
        physical.height,
        0,
        0,
        physical.width,
        physical.height,
      );

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, format, quality),
      );
      if (!blob) {
        throw new Error("The browser could not encode the region capture.");
      }

      return {
        blob,
        mimeType: format,
        width: physical.width,
        height: physical.height,
        region: physical,
        devicePixelRatio: dpr,
        sourceSize: { width: sourceWidth, height: sourceHeight },
      };
    } finally {
      video.pause();
      video.srcObject = null;
      if (owned) stopStream(stream);
    }
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error(String(cause));
  }
}

/** Map a drawn rectangle in an object-fit: contain preview to actual frame pixels. */
export function stageRegionToSourcePixels(
  region: ScreenRegion,
  stage: { width: number; height: number },
  source: { width: number; height: number },
): ScreenRegion {
  if (
    stage.width <= 0 || stage.height <= 0 ||
    source.width <= 0 || source.height <= 0 ||
    region.width <= 0 || region.height <= 0
  ) throw new Error("Select a nonempty region in the video preview.");
  const scale = Math.min(stage.width / source.width, stage.height / source.height);
  const offsetX = (stage.width - source.width * scale) / 2;
  const offsetY = (stage.height - source.height * scale) / 2;
  const x1 = clamp(Math.floor((region.x - offsetX) / scale), 0, source.width);
  const y1 = clamp(Math.floor((region.y - offsetY) / scale), 0, source.height);
  const x2 = clamp(Math.ceil((region.x + region.width - offsetX) / scale), 0, source.width);
  const y2 = clamp(Math.ceil((region.y + region.height - offsetY) / scale), 0, source.height);
  if (x2 <= x1 || y2 <= y1) throw new Error("Selection is outside the captured video frame.");
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function regionPixels(
  region: ScreenRegion,
  devicePixelRatio: number,
): ScreenRegion {
  return {
    x: Math.floor(region.x * devicePixelRatio),
    y: Math.floor(region.y * devicePixelRatio),
    width: Math.ceil(region.width * devicePixelRatio),
    height: Math.ceil(region.height * devicePixelRatio),
  };
}
