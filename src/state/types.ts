export type Language = "en" | "ar";
export type ThemeMode = "dark" | "light";

export interface RecorderSettings {
  quality: 720 | 1080 | 1440 | 2160;
  fps: 30 | 60;
  systemAudio: boolean;
  microphone: boolean;
  webcamOverlay: boolean;
  webcamPosition: "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
  webcamSize: "small" | "medium" | "large";
  namingPattern: string;
}

export interface AppSettings {
  theme: ThemeMode;
  language: Language;
  reduceMotion: boolean;
  recorder: RecorderSettings;
  screenshotFormat: "png" | "jpeg" | "webp";
  screenshotQuality: number;
}

export type LibraryKind = "video" | "image" | "audio";
export type LibrarySource = "recording" | "screenshot" | "trim" | "import" | "toolbox";

export interface LibraryItem {
  id: string;
  name: string;
  kind: LibraryKind;
  mimeType: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  createdAt: number;
  source: LibrarySource;
  blob: Blob;
  thumbnail: string | null;
  favorite?: boolean;
}

export type RecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "paused"
  | "stopping"
  | "error";

export interface RecorderSnapshot {
  status: RecorderStatus;
  elapsed: number;
  error: string | null;
  lastCapture: {
    id: string;
    name: string;
    size: number;
    duration: number;
  } | null;
}

export type CapabilityState =
  | "VERIFIED"
  | "AVAILABLE_UNVERIFIED"
  | "MISSING_ENGINE"
  | "MISSING_MODEL"
  | "NOT_IMPLEMENTED"
  | "BLOCKED"
  | "PARTIAL";
