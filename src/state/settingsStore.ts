import type { AppSettings } from "./types";
import { DEFAULT_HOTKEYS, sanitiseHotkeys } from "../services/hotkeys";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  language: "en",
  reduceMotion: false,
  recorder: {
    quality: 1080,
    fps: 30,
    systemAudio: true,
    microphone: false,
    webcamOverlay: false,
    webcamPosition: "bottomRight",
    webcamSize: "medium",
    namingPattern: "KNOUX-REC-[DATE]_[TIME]",
    audioDeviceId: null,
  },
  screenshotFormat: "png",
  screenshotQuality: 0.95,
  hotkeys: { ...DEFAULT_HOTKEYS },
};

const STORAGE_KEY = "knoux-rec.settings.v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function loadSettings(): AppSettings {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_SETTINGS;
    const recorder = isRecord(parsed.recorder) ? parsed.recorder : {};
    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      recorder: { ...DEFAULT_SETTINGS.recorder, ...recorder },
    };
    if (!["en", "ar"].includes(merged.language)) merged.language = "en";
    if (!["dark", "light"].includes(merged.theme)) merged.theme = "dark";
    if (![720, 1080, 1440, 2160].includes(merged.recorder.quality)) {
      merged.recorder.quality = 1080;
    }
    if (![30, 60].includes(merged.recorder.fps)) merged.recorder.fps = 30;
    // A hand-edited or older settings file cannot leave a shortcut unusable or
    // shared between two actions.
    merged.hotkeys = sanitiseHotkeys((parsed as { hotkeys?: unknown }).hotkeys);
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable in private mode */
  }
}
