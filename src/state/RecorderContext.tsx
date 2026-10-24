import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  RecordingSession,
  captureScreenshot,
  detectCaptureSupport,
  type CaptureMode,
  type CaptureSupport,
} from "../services/recordingEngine";
import type { RecorderSnapshot, RecorderStatus } from "./types";
import { useLibrary } from "./LibraryContext";
import { useJobs, type StudioJobHandle } from "./JobsContext";
import { useSettings } from "./SettingsContext";
import { useToast } from "./ToastContext";
import {
  buildFileName,
  extensionForMime,
  formatBytes,
  formatDuration,
} from "../lib/format";

export interface RecorderContextValue extends RecorderSnapshot {
  support: CaptureSupport;
  previewStream: MediaStream | null;
  start: (mode?: CaptureMode) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  toggle: (mode?: CaptureMode) => Promise<void>;
  takeScreenshot: () => Promise<void>;
  clearError: () => void;
}

const RecorderContext = createContext<RecorderContextValue | null>(null);

export function RecorderProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const { add: addToLibrary } = useLibrary();
  const { beginJob } = useJobs();
  const { push } = useToast();

  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [lastCapture, setLastCapture] = useState<RecorderSnapshot["lastCapture"]>(null);
  const [support] = useState<CaptureSupport>(() => detectCaptureSupport());

  const sessionRef = useRef<RecordingSession | null>(null);
  const jobRef = useRef<StudioJobHandle | null>(null);
  const timerRef = useRef<number | null>(null);
  const statusRef = useRef<RecorderStatus>("idle");
  const settingsRef = useRef(settings);

  settingsRef.current = settings;
  statusRef.current = status;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(
    (session: RecordingSession) => {
      clearTimer();
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        setElapsed(session.elapsedSeconds());
      }, 250);
    },
    [clearTimer],
  );

  const start = useCallback(
    async (mode: CaptureMode = "screen") => {
      if (
        statusRef.current === "recording" ||
        statusRef.current === "paused" ||
        statusRef.current === "requesting" ||
        statusRef.current === "stopping"
      ) {
        return;
      }
      setError(null);
      setStatus("requesting");
      const session = new RecordingSession();
      sessionRef.current = session;
      const quality = settingsRef.current.recorder.quality;
      try {
        await session.start({
          mode,
          width: quality === 720 ? 1280 : quality === 1080 ? 1920 : quality === 1440 ? 2560 : 3840,
          height: quality === 720 ? 720 : quality === 1080 ? 1080 : quality === 1440 ? 1440 : 2160,
          fps: settingsRef.current.recorder.fps,
          systemAudio: settingsRef.current.recorder.systemAudio,
          microphone: settingsRef.current.recorder.microphone,
          webcamOverlay: settingsRef.current.recorder.webcamOverlay,
          webcamPosition: settingsRef.current.recorder.webcamPosition,
          webcamSize: settingsRef.current.recorder.webcamSize,
        });
        const preview = session.previewStream();
        setPreviewStream(preview);
        setStatus("recording");
        startTimer(session);

        // The workspace record starts only after an authorized stream exists.
        const job = beginJob({
          kind: "recording",
          title: mode === "webcam" ? "Camera recording" : "Screen recording",
          route: "studio",
          progress: null,
        });
        job.report("processing", "Capturing the authorized stream");
        jobRef.current = job;

        const videoTrack = preview?.getVideoTracks()[0];
        videoTrack?.addEventListener("ended", () => {
          if (statusRef.current === "recording" || statusRef.current === "paused") {
            void stopRef.current?.();
          }
        });

        push(
          "success",
          mode === "webcam" ? "Camera recording started" : "Screen recording started",
          "Pause or stop from the studio controls, or use the hotkeys.",
        );
      } catch (cause) {
        session.cancel();
        sessionRef.current = null;
        setPreviewStream(null);
        setStatus("error");
        const message =
          cause instanceof Error ? cause.message : "Recording could not be started.";
        setError(message);
        push("error", "Recording could not start", message);
      }
    },
    [beginJob, push, startTimer],
  );

  const pause = useCallback(() => {
    const session = sessionRef.current;
    if (!session || statusRef.current !== "recording") return;
    session.pause();
    setStatus("paused");
    jobRef.current?.report("processing", "Paused");
  }, []);

  const resume = useCallback(() => {
    const session = sessionRef.current;
    if (!session || statusRef.current !== "paused") return;
    session.resume();
    setStatus("recording");
    jobRef.current?.report("processing", "Recording");
  }, []);

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    if (statusRef.current !== "recording" && statusRef.current !== "paused") return;

    setStatus("stopping");
    clearTimer();
    try {
      const result = await session.stop();
      sessionRef.current = null;
      setPreviewStream(null);
      jobRef.current?.report(
        "verifying",
        "Encoding and saving to the local library",
        0.9,
      );

      const extension = extensionForMime(result.mimeType);
      const name = buildFileName(
        settingsRef.current.recorder.namingPattern,
        extension,
      );
      const item = await addToLibrary({
        name,
        kind: "video",
        mimeType: result.mimeType,
        blob: result.blob,
        duration: result.durationMs / 1000,
        width: result.width,
        height: result.height,
        source: "recording",
        thumbnail: result.thumbnail,
      });

      setElapsed(0);
      setStatus("idle");
      setLastCapture({
        id: item.id,
        name: item.name,
        size: item.size,
        duration: item.duration,
      });
      const job = jobRef.current;
      if (job) {
        job.complete({
          blob: result.blob,
          mimeType: result.mimeType,
          fileName: name,
          width: result.width,
          height: result.height,
          duration: result.durationMs / 1000,
          bytes: result.blob.size,
          metrics: {
            source: "MediaRecorder",
            mimeType: result.mimeType,
            savedBytes: item.size,
          },
          logs: [
            `MediaRecorder produced ${formatBytes(result.blob.size)} over ${formatDuration(result.durationMs / 1000)}.`,
            `Saved to the local library as ${item.name}.`,
          ],
        });
        jobRef.current = null;
      }
      push(
        "success",
        "Recording saved to library",
        `${name} · ${formatDuration(item.duration)} · ${formatBytes(item.size)}`,
      );
    } catch (cause) {
      sessionRef.current = null;
      setPreviewStream(null);
      setStatus("error");
      const message =
        cause instanceof Error ? cause.message : "The recording could not be saved.";
      setError(message);
      jobRef.current?.fail(message);
      jobRef.current = null;
      push("error", "Recording failed to save", message);
    }
  }, [addToLibrary, clearTimer, push]);

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const toggle = useCallback(
    async (mode: CaptureMode = "screen") => {
      if (statusRef.current === "recording") {
        await stop();
      } else if (statusRef.current === "paused") {
        resume();
      } else {
        await start(mode);
      }
    },
    [resume, start, stop],
  );

  const takeScreenshot = useCallback(async () => {
    try {
      const result = await captureScreenshot({
        format: settingsRef.current.screenshotFormat,
        quality: settingsRef.current.screenshotQuality,
        sourceStream: sessionRef.current?.previewStream() ?? null,
      });
      const extension =
        result.mimeType === "image/jpeg"
          ? "jpg"
          : result.mimeType.replace("image/", "");
      const name = buildFileName(
        settingsRef.current.recorder.namingPattern || "KNOUX-REC-[DATE]_[TIME]",
        extension,
      );
      const item = await addToLibrary({
        name,
        kind: "image",
        mimeType: result.mimeType,
        blob: result.blob,
        duration: 0,
        width: result.width,
        height: result.height,
        source: "screenshot",
        thumbnail: result.dataUrl,
      });
      setLastCapture({
        id: item.id,
        name: item.name,
        size: item.size,
        duration: 0,
      });
      push(
        "success",
        "Screenshot saved",
        `${name} · ${result.width}×${result.height}`,
      );
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "The screenshot could not be captured.";
      setError(message);
      push("error", "Screenshot failed", message);
    }
  }, [addToLibrary, push]);

  const clearError = useCallback(() => {
    setError(null);
    if (statusRef.current === "error") setStatus("idle");
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
      sessionRef.current?.cancel();
    };
  }, [clearTimer]);

  const value = useMemo(
    () => ({
      status,
      elapsed,
      error,
      lastCapture,
      support,
      previewStream,
      start,
      pause,
      resume,
      stop,
      toggle,
      takeScreenshot,
      clearError,
    }),
    [
      status,
      elapsed,
      error,
      lastCapture,
      support,
      previewStream,
      start,
      pause,
      resume,
      stop,
      toggle,
      takeScreenshot,
      clearError,
    ],
  );

  return (
    <RecorderContext.Provider value={value}>{children}</RecorderContext.Provider>
  );
}

export function useRecorder(): RecorderContextValue {
  const value = useContext(RecorderContext);
  if (!value) throw new Error("useRecorder must be used inside RecorderProvider");
  return value;
}
