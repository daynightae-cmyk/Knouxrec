import "fake-indexeddb/auto";
import { vi } from "vitest";

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray() })),
  putImageData: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  scale: vi.fn(),
  translate: vi.fn(),
})) as unknown as HTMLCanvasElement["getContext"];

HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());
HTMLVideoElement.prototype.pause = vi.fn();
Object.defineProperty(HTMLVideoElement.prototype, "captureStream", {
  value: vi.fn(() => new MediaStream()),
  writable: true,
});
HTMLVideoElement.prototype.getVideoPlaybackQuality = vi.fn(() => ({
  totalVideoFrames: 0,
  droppedVideoFrames: 0,
  corruptedVideoFrames: 0,
  creationTime: 0,
})) as unknown as () => VideoPlaybackQuality;

Object.defineProperty(window, "MediaRecorder", {
  value: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    state: "inactive",
    mimeType: "video/webm;codecs=vp9,opus",
  })),
  writable: true,
});

Object.defineProperty(window.MediaRecorder, "isTypeSupported", {
  value: vi.fn((type) => {
    if (type.includes("vp9") || type.includes("vp8") || type.includes("h264")) return true;
    return false;
  }),
  writable: true,
});

Object.defineProperty(navigator, "mediaDevices", {
  value: {
    getDisplayMedia: vi.fn(() => Promise.resolve(new MediaStream())),
    getUserMedia: vi.fn(() => Promise.resolve(new MediaStream())),
    enumerateDevices: vi.fn(() => Promise.resolve([])),
  },
  writable: true,
});

Object.defineProperty(window, "crypto", {
  value: {
    getRandomValues: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      return arr;
    },
    randomUUID: () => "test-uuid-" + Math.random().toString(36).slice(2),
    subtle: {
      digest: vi.fn(() => Promise.resolve(new ArrayBuffer(32))),
    },
  },
  writable: true,
});

// jsdom's URL.createObjectURL throws "not implemented", so the two blob
// helpers are stubbed. The constructor itself has to survive the stub: code
// that validates a destination (src/services/externalLinks.ts) relies on the
// platform URL parser, and replacing the global with a plain object made every
// `new URL(...)` in the suite throw.
{
  const RealURL = window.URL;
  const stubs: Array<[string, (...args: unknown[]) => unknown]> = [
    ["createObjectURL", () => "blob:test"],
    ["revokeObjectURL", () => undefined],
  ];
  for (const [name, impl] of stubs) {
    try {
      Object.defineProperty(RealURL, name, {
        value: vi.fn(impl),
        writable: true,
        configurable: true,
      });
    } catch {
      /* the host refuses to redefine it; the real implementation stays */
    }
  }
  Object.defineProperty(window, "URL", {
    value: RealURL,
    writable: true,
    configurable: true,
  });
}

Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
  value: vi.fn((cb) => cb(new Blob(["test"], { type: "image/png" }))),
  writable: true,
});

Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
  value: vi.fn(() => "data:image/png;base64,test"),
  writable: true,
});