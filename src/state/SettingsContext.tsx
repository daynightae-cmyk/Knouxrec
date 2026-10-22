import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings } from "./types";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settingsStore";

export interface SettingsContextValue {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  updateRecorder: (patch: Partial<AppSettings["recorder"]>) => void;
  reset: () => void;
}

import { createContext, useContext } from "react";

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", settings.theme === "dark");
    root.classList.toggle("light", settings.theme === "light");
    root.dataset.theme = settings.theme;
    root.dataset.reducedMotion = settings.reduceMotion ? "true" : "false";
    root.lang = settings.language;
    root.dir = settings.language === "ar" ? "rtl" : "ltr";
  }, [settings.theme, settings.language, settings.reduceMotion]);

  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveSettings(settings), 150);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [settings]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  const updateRecorder = useCallback(
    (patch: Partial<AppSettings["recorder"]>) => {
      setSettings((previous) => ({
        ...previous,
        recorder: { ...previous.recorder, ...patch },
      }));
    },
    [],
  );

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  const value = useMemo(
    () => ({ settings, update, updateRecorder, reset }),
    [settings, update, updateRecorder, reset],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside SettingsProvider");
  return value;
}
