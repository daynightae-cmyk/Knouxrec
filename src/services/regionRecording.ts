/**
 * KNOUX REC — region recording compositor.
 *
 * Selected-area recording has to produce a file that contains the selected
 * pixels and nothing else. Recording the whole display and drawing a
 * selection rectangle over the preview would produce a full-desktop file with
 * a decoration on top, which is not region recording at all.
 *
 * This module does the honest thing: it takes the authorized display stream,
 * copies only the chosen rectangle out of every frame into a canvas whose
 * size is exactly the rectangle, and hands that canvas stream to the encoder.
 * The resulting file has the region's own dimensions and contains only the
 * region's pixels.
 *
 * Coordinates:
 * - The region is expressed in DEVICE pixels of the captured surface. The
 *   captured surface is what the OS handed over, so a scaled or high-DPI
 *   monitor is already normalised here — the selection maths maps the
 *   on-screen preview rectangle onto that surface exactly once, at selection
 *   time (see `stageRegionToSourcePixels`).
 * - A rectangle that is empty, inverted or larger than the surface is
 *   rejected rather than silently clamped to something the user did not pick.
 */

import type { ScreenRegion } from "./regionCapture";

export interface RegionCompositorOptions {
  /** The authorized display stream. */
  stream: MediaStream;
  /** The chosen rectangle, in device pixels of the captured surface. */
  region: ScreenRegion;
  /** Frames per second handed to the encoder. */
  fps: number;
}

/** The smallest rectangle that can still be encoded. */
export const MIN_REGION_EDGE = 4;

export function isUsableRegion(region: ScreenRegion): boolean {
  return (
    Number.isFinite(region.x) &&
    Number.isFinite(region.y) &&
    Number.isFinite(region.width) &&
    Number.isFinite(region.height) &&
    region.width >= MIN_REGION_EDGE &&
    region.height >= MIN_REGION_EDGE
  );
}

export class RegionCompositor {
  readonly width: number;
  readonly height: number;
  readonly stream: MediaStream;
  readonly region: ScreenRegion;

  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private timer: number | null = null;
  private frames = 0;
  private disposed = false;

  private constructor(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    stream: MediaStream,
    region: ScreenRegion,
  ) {
    this.video = video;
    this.canvas = canvas;
    this.context = context;
    this.stream = stream;
    this.region = region;
    this.width = region.width;
    this.height = region.height;
  }

  private readonly context: CanvasRenderingContext2D;

  /** Frames actually painted. A zero here means the decoder never delivered. */
  get paintedFrames(): number {
    return this.frames;
  }

  static async create(
    options: RegionCompositorOptions,
  ): Promise<RegionCompositor> {
    const { region, fps } = options;
    if (!isUsableRegion(region)) {
      throw new Error(
        "The selected region is too small. Drag a rectangle of at least 4×4 pixels.",
      );
    }
    if (options.stream.getVideoTracks().length === 0) {
      throw new Error("The display picker returned no video track.");
    }

    const video = document.createElement("video");
    video.srcObject = options.stream;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    // The element has to be in the document for Chromium to decode and
    // present it reliably; a detached element can hand back zero frames.
    video.style.cssText =
      "position:fixed;left:-8px;top:-8px;width:2px;height:2px;opacity:0;pointer-events:none;";
    document.body.appendChild(video);

    try {
      await video.play().catch(() => undefined);
      await waitForVideoFrame(video);
    } catch (cause) {
      video.remove();
      throw cause instanceof Error ? cause : new Error(String(cause));
    }

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      video.remove();
      throw new Error("The capture stream did not provide any video frames.");
    }

    // The rectangle must sit inside the surface that was actually captured.
    if (
      region.x < 0 ||
      region.y < 0 ||
      region.x + region.width > sourceWidth ||
      region.y + region.height > sourceHeight
    ) {
      video.remove();
      throw new Error(
        `The selected region (${region.x},${region.y} ${region.width}×${region.height}) ` +
          `does not fit inside the captured surface (${sourceWidth}×${sourceHeight}).`,
      );
    }

    const canvas = document.createElement("canvas");
    canvas.width = region.width;
    canvas.height = region.height;
    // A visible, in-document canvas is composited by Chromium, so
    // canvas.captureStream() delivers real frames to the encoder. A hidden or
    // detached canvas is skipped and produces a zero-byte file.
    canvas.style.cssText =
      `position:fixed;left:0;top:0;width:${region.width}px;height:${region.height}px;` +
      "pointer-events:none;opacity:0.01;";
    document.body.appendChild(canvas);

    const context = canvas.getContext("2d", { willReadFrequently: false });
    if (!context) {
      canvas.remove();
      video.remove();
      throw new Error("The 2D canvas context is unavailable.");
    }

    const instance = new RegionCompositor(
      video,
      canvas,
      context,
      canvas.captureStream(Math.max(1, Math.round(fps))),
      region,
    );

    const interval = Math.max(16, Math.round(1000 / Math.max(1, fps)));
    instance.timer = window.setInterval(() => instance.draw(), interval);
    instance.draw();
    return instance;
  }

  private draw(): void {
    if (this.disposed) return;
    const video = this.video;
    if (video.readyState < 2 || !video.videoWidth) {
      // Paint a black frame rather than nothing: an encoder fed no frames
      // produces an empty file.
      this.context.fillStyle = "#000000";
      this.context.fillRect(0, 0, this.width, this.height);
      this.frames += 1;
      return;
    }
    try {
      this.context.drawImage(
        video,
        this.region.x,
        this.region.y,
        this.region.width,
        this.region.height,
        0,
        0,
        this.width,
        this.height,
      );
    } catch {
      this.context.fillStyle = "#000000";
      this.context.fillRect(0, 0, this.width, this.height);
    }
    this.frames += 1;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* noop */
      }
    });
    this.video.pause();
    this.video.srcObject = null;
    this.video.remove();
    this.canvas.remove();
  }
}

function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(
        new Error("The capture stream did not deliver a frame within 10 seconds."),
      );
    }, 10_000);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("resize", onResize);
      video.removeEventListener("error", onError);
    };
    const onMetadata = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolve();
      }
    };
    const onResize = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolve();
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error("The capture stream could not be decoded."));
    };
    video.addEventListener("loadedmetadata", onMetadata);
    video.addEventListener("resize", onResize);
    video.addEventListener("error", onError);
  });
}
