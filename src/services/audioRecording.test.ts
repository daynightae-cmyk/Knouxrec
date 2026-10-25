import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RecordingSession,
  detectCaptureSupport,
  pickAudioMimeType,
  pickMimeType,
  type CaptureRequest,
} from "../services/recordingEngine";

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

const ORIGINAL_RECORDER = window.MediaRecorder;
const ORIGINAL_AUDIO_CONTEXT = (window as Window & { AudioContext?: unknown }).AudioContext;
// The shared test setup installs these as plain writable properties, not
// configurable ones, so a suite must assign the methods rather than try to
// redefine the host objects.
type DeviceStub = {
  getUserMedia: ReturnType<typeof vi.fn>;
  getDisplayMedia: ReturnType<typeof vi.fn>;
};
const mediaDevicesStub = navigator.mediaDevices as unknown as DeviceStub;
const ORIGINAL_GET_USER_MEDIA = mediaDevicesStub.getUserMedia;
const ORIGINAL_GET_DISPLAY_MEDIA = mediaDevicesStub.getDisplayMedia;

type FakeTrack = { kind: string; label: string; stop: ReturnType<typeof vi.fn> };

function audioTrack(label = "Fake microphone"): FakeTrack {
  return { kind: "audio", label, stop: vi.fn() };
}

function streamOf(tracks: FakeTrack[]): MediaStream {
  return {
    getAudioTracks: () => tracks,
    getVideoTracks: () => [],
    getTracks: () => tracks,
    active: true,
  } as unknown as MediaStream;
}

function stubMediaDevices(getUserMedia: ReturnType<typeof vi.fn>, getDisplayMedia?: ReturnType<typeof vi.fn>) {
  mediaDevicesStub.getUserMedia = getUserMedia;
  mediaDevicesStub.getDisplayMedia =
    getDisplayMedia ?? vi.fn(() => Promise.reject(new Error("display must not be requested")));
}

/** The constraints the session passed to getUserMedia, typed where they live. */
function firstConstraint(mock: ReturnType<typeof vi.fn>): MediaStreamConstraints {
  const calls = mock.mock.calls as unknown as Array<[MediaStreamConstraints]>;
  return calls[0][0];
}

/** A recorder that is honest about what it was asked to encode. */
function installRecorder(chunks: Blob[] = [new Blob(["audio-bytes".repeat(200)])]) {
  const created: Array<{ stream: MediaStream; options: MediaRecorderOptions }> = [];
  class FakeRecorder {
    static isTypeSupported = (type: string) => type.startsWith("audio/webm");
    state = "inactive";
    mimeType = "audio/webm;codecs=opus";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    start = vi.fn(() => {
      this.state = "recording";
    });
    stop = vi.fn(() => {
      this.state = "inactive";
      chunks.forEach((chunk) => this.ondataavailable?.({ data: chunk }));
      this.onstop?.();
    });
    pause = vi.fn(() => {
      this.state = "paused";
    });
    resume = vi.fn(() => {
      this.state = "recording";
    });

    constructor(stream: MediaStream, options: MediaRecorderOptions) {
      created.push({ stream, options });
    }
  }
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  return created;
}

/** Tells the runtime that nothing audio-shaped can be encoded. */
function installNoAudioEncoder() {
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = {
    isTypeSupported: () => false,
  };
}

/** An analyser that reports a fixed peak, so the meter can be tested. */
function installAudioContext(peak: number) {
  const closed: Array<ReturnType<typeof vi.fn>> = [];
  const gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn> }> = [];
  class FakeAudioContext {
    createAnalyser = () => ({
      fftSize: 1024,
      smoothingTimeConstant: 0,
      connect: vi.fn(),
      getFloatTimeDomainData: (buffer: Float32Array) => {
        for (let index = 0; index < buffer.length; index += 1) {
          buffer[index] = index % 2 === 0 ? peak : -peak;
        }
      },
    });

    createMediaStreamSource = () => ({ connect: vi.fn() });

    createGain = () => {
      const node = { gain: { value: 1 }, connect: vi.fn() };
      gains.push(node);
      return node;
    };

    destination = { kind: "destination" };

    resume = () => Promise.resolve();

    close = () => {
      const spy = vi.fn();
      closed.push(spy);
      spy();
      return Promise.resolve();
    };
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  return { closed, gains };
}

function audioRequest(overrides: Partial<CaptureRequest> = {}): CaptureRequest {
  return {
    mode: "audio",
    width: 1920,
    height: 1080,
    fps: 30,
    systemAudio: true,
    microphone: false,
    webcamOverlay: true,
    webcamPosition: "bottomRight",
    webcamSize: "medium",
    ...overrides,
  };
}

afterEach(() => {
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = ORIGINAL_RECORDER;
  (window as unknown as { AudioContext: unknown }).AudioContext = ORIGINAL_AUDIO_CONTEXT;
  mediaDevicesStub.getUserMedia = ORIGINAL_GET_USER_MEDIA;
  mediaDevicesStub.getDisplayMedia = ORIGINAL_GET_DISPLAY_MEDIA;
});

describe("audio-only recording", () => {
  it("picks an audio container the runtime admits to encoding", () => {
    installRecorder();
    expect(pickAudioMimeType()).toBe("audio/webm;codecs=opus");
  });

  it("admits it cannot encode audio rather than guessing a codec", () => {
    installNoAudioEncoder();
    expect(pickAudioMimeType()).toBe("");
  });

  it("asks for the microphone only — never the display", async () => {
    const tracks = [audioTrack()];
    const getUserMedia = vi.fn(() => Promise.resolve(streamOf(tracks)));
    const getDisplayMedia = vi.fn();
    stubMediaDevices(getUserMedia, getDisplayMedia);
    installAudioContext(0.2);
    const created = installRecorder();

    const session = new RecordingSession();
    await expect(session.start(audioRequest())).resolves.toEqual({ width: 0, height: 0 });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const constraints = firstConstraint(getUserMedia);
    expect(constraints.video).toBe(false);
    expect(constraints.audio).toMatchObject({ echoCancellation: true });
    expect(getDisplayMedia).not.toHaveBeenCalled();
    // The encoder is told the audio container, not the video default.
    expect(created[0].options.mimeType).toBe("audio/webm;codecs=opus");
    expect(created[0].options.audioBitsPerSecond).toBe(128_000);
    session.cancel();
  });

  it("selects a requested device when the user chose one", async () => {
    const tracks = [audioTrack("Headset")];
    const getUserMedia = vi.fn(() => Promise.resolve(streamOf(tracks)));
    stubMediaDevices(getUserMedia, vi.fn());
    installRecorder();
    installAudioContext(0.1);

    const session = new RecordingSession();
    await session.start(audioRequest({ audioDeviceId: "device-42" }));
    const constraints = firstConstraint(getUserMedia);
    expect(constraints.audio).toMatchObject({ deviceId: { exact: "device-42" } });
    session.cancel();
  });

  it("has no preview frame, reports the live level and saves without a thumbnail", async () => {
    const tracks = [audioTrack()];
    stubMediaDevices(vi.fn(() => Promise.resolve(streamOf(tracks))), vi.fn());
    installRecorder();
    const { closed, gains } = installAudioContext(0.4);

    const session = new RecordingSession();
    await session.start(audioRequest());
    expect(session.previewStream()).toBeNull();
    expect(session.level()).toBeCloseTo(0.4, 5);
    // The meter graph must be pulled by something downstream, and that
    // something must be silent: the page can never hear the microphone back.
    expect(gains).toHaveLength(1);
    expect(gains[0].gain.value).toBe(0);

    const result = await session.stop();
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.thumbnail).toBeNull();
    expect(result.blob.size).toBeGreaterThan(1000);
    expect(result.mimeType).toContain("audio");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    // The take is finished, so the microphone and the graph must be released.
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(closed).toHaveLength(1);
  });

  it("refuses a microphone that hands back no audio track", async () => {
    const orphan = streamOf([]);
    stubMediaDevices(vi.fn(() => Promise.resolve(orphan)), vi.fn());
    installRecorder();
    installAudioContext(0);

    const session = new RecordingSession();
    await expect(session.start(audioRequest())).rejects.toThrow(/no audio track/i);
    expect(session.isActive).toBe(false);
  });

  it("refuses to start when no audio container is supported", async () => {
    const getUserMedia = vi.fn();
    stubMediaDevices(getUserMedia, vi.fn());
    installNoAudioEncoder();

    const session = new RecordingSession();
    await expect(session.start(audioRequest())).rejects.toThrow(/cannot encode an audio-only/i);
    // Nothing was opened, so nothing needs closing.
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("survives an unusable analyser instead of losing the take", async () => {
    const tracks = [audioTrack()];
    stubMediaDevices(vi.fn(() => Promise.resolve(streamOf(tracks))), vi.fn());
    const created = installRecorder();
    (window as unknown as { AudioContext: unknown }).AudioContext = class {
      createAnalyser = () => {
        throw new Error("no audio graph in this runtime");
      };
    };

    const session = new RecordingSession();
    await expect(session.start(audioRequest())).resolves.toEqual({ width: 0, height: 0 });
    expect(created).toHaveLength(1);
    expect(session.level()).toBe(0);
    session.cancel();
  });

  it("reports zero level when nothing is recording", () => {
    const session = new RecordingSession();
    expect(session.level()).toBe(0);
    expect(session.previewStream()).toBeNull();
  });
});
