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

/**
 * One link in a derived file's history. A handoff between hubs appends to this
 * chain instead of copying the source, so the original stays on disk untouched
 * and every result can say where it came from.
 */
export interface ProvenanceRecord {
  itemId: string | null;
  name: string;
  hub: RouteLabel;
  at: number;
}

export type RouteLabel =
  | "library"
  | "toolbox"
  | "elysian"
  | "audio-studio"
  | "batch"
  | "morphcore"
  | "screenshots"
  | "visual-patch"
  | "templates"
  | "recording";

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
  /** Chain of hubs this file was derived through, oldest first. */
  provenance?: ProvenanceRecord[];
  /** Optional user collection; empty means unfiled. */
  collection?: string;
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
