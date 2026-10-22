import { beforeEach, describe, it, expect, vi } from "vitest";
import { detectCaptureSupport, pickMimeType } from "../services/recordingEngine";

describe("recordingEngine utils", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("detectCaptureSupport runs and returns a support object", async () => {
    const support = await detectCaptureSupport();
    expect(typeof support.display).toBe("boolean");
    expect(typeof support.webcam).toBe("boolean");
    expect(typeof support.microphone).toBe("boolean");
    expect(typeof support.mediaRecorder).toBe("boolean");
  });

  it("pickMimeType prefers vp9/opus when available", () => {
    expect(pickMimeType()).toBe("video/webm;codecs=vp9,opus");
  });
});