/**
 * KNOUX REC — global shortcut bindings.
 *
 * A binding is stored as one canonical string ("Ctrl+Shift+R"): modifiers in a
 * fixed order, then the key. Everything here is pure so the settings screen and
 * the window listener can never disagree about what a combination means, and so
 * conflicts are caught before they are written rather than discovered when a
 * shortcut silently does nothing.
 */

export type HotkeyAction = "toggle" | "pause" | "screenshot" | "audio";

export type HotkeyMap = Record<HotkeyAction, string>;

export const HOTKEY_ACTIONS: Array<{ action: HotkeyAction; labelKey: string; hintKey: string }> = [
  { action: "toggle", labelKey: "settings.hotkey.toggle", hintKey: "settings.hotkey.toggleHint" },
  { action: "pause", labelKey: "settings.hotkey.pause", hintKey: "settings.hotkey.pauseHint" },
  {
    action: "screenshot",
    labelKey: "settings.hotkey.screenshot",
    hintKey: "settings.hotkey.screenshotHint",
  },
  { action: "audio", labelKey: "settings.hotkey.audio", hintKey: "settings.hotkey.audioHint" },
];

export const DEFAULT_HOTKEYS: HotkeyMap = {
  toggle: "Ctrl+Shift+R",
  pause: "Ctrl+Shift+P",
  screenshot: "Ctrl+Shift+S",
  audio: "Ctrl+Shift+A",
};

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

export type ParsedCombo = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Upper-case single key: "R", "F8", "1", "SPACE". */
  key: string;
};

const ALIASES: Record<string, string> = {
  control: "Ctrl",
  ctrl: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  meta: "Ctrl",
  cmd: "Ctrl",
  command: "Ctrl",
};

/** Single keys a shortcut may end in, so a stray "Ctrl+Shift" is never stored. */
const NAMED_KEYS: Record<string, string> = {
  " ": "SPACE",
  space: "SPACE",
  escape: "ESC",
  esc: "ESC",
  enter: "ENTER",
  arrowup: "UP",
  arrowdown: "DOWN",
  arrowleft: "LEFT",
  arrowright: "RIGHT",
  plus: "PLUS",
  "+": "PLUS",
  "=": "PLUS",
  "-": "MINUS",
};

const CANONICAL_KEY = /^(?:[A-Z0-9]|F[1-9]|F1[0-2]|SPACE|ESC|ENTER|UP|DOWN|LEFT|RIGHT|PLUS|MINUS)$/;

export function parseCombo(combo: string): ParsedCombo | null {
  const parts = combo
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const result: ParsedCombo = { ctrl: false, alt: false, shift: false, key: "" };
  for (const part of parts) {
    const modifier = ALIASES[part.toLowerCase()];
    if (modifier) {
      if (modifier === "Ctrl") result.ctrl = true;
      else if (modifier === "Alt") result.alt = true;
      else result.shift = true;
      continue;
    }
    const named = NAMED_KEYS[part.toLowerCase()];
    const key = (named ?? part).toUpperCase();
    if (!CANONICAL_KEY.test(key) || result.key) return null;
    result.key = key;
  }
  if (!result.key) return null;
  // A shortcut without a modifier would fire while the user types a file name,
  // so it is not a shortcut at all.
  if (!result.ctrl && !result.alt && !result.shift) return null;
  return result;
}

/** Canonical spelling of a combination, or null when it is not usable. */
export function normaliseCombo(combo: string): string | null {
  const parsed = parseCombo(combo);
  if (!parsed) return null;
  const modifiers = MODIFIER_ORDER.filter((modifier) => {
    if (modifier === "Ctrl") return parsed.ctrl;
    if (modifier === "Alt") return parsed.alt;
    return parsed.shift;
  });
  return [...modifiers, parsed.key].join("+");
}

/**
 * The same rules for a live keyboard event. A shortcut always carries at least
 * one of Ctrl/Alt/Shift: a bare letter would fire while the user is typing a
 * file name.
 */
export function comboFromEvent(event: KeyboardEvent): string | null {
  if (event.key === "Control" || event.key === "Alt" || event.key === "Shift" || event.key === "Meta") {
    return null;
  }
  if (event.key === "Escape") return null;
  if (!(event.ctrlKey || event.altKey || event.shiftKey)) return null;
  const named = NAMED_KEYS[event.key.toLowerCase()];
  const raw = named ?? event.key.toUpperCase();
  if (!CANONICAL_KEY.test(raw)) return null;
  const modifiers: Modifier[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  return [...modifiers, raw].join("+");
}

export function matchesCombo(event: KeyboardEvent, combo: string): boolean {
  const parsed = parseCombo(combo);
  if (!parsed) return false;
  if (parsed.ctrl !== (event.ctrlKey || event.metaKey)) return false;
  if (parsed.alt !== event.altKey) return false;
  if (parsed.shift !== event.shiftKey) return false;
  const named = NAMED_KEYS[event.key.toLowerCase()];
  const key = named ?? event.key.toUpperCase();
  return key === parsed.key;
}

/** Which action already owns a combination, ignoring the action being edited. */
export function findConflict(
  map: HotkeyMap,
  combo: string,
  except: HotkeyAction,
): HotkeyAction | null {
  const target = normaliseCombo(combo);
  if (!target) return null;
  for (const action of Object.keys(map) as HotkeyAction[]) {
    if (action === except) continue;
    if (normaliseCombo(map[action]) === target) return action;
  }
  return null;
}

/**
 * Accept a stored or hand-edited map and make it safe: unknown actions keep
 * their default, unusable combinations fall back to the default, and a
 * duplicate is dropped in favour of the action that appears first in
 * `HOTKEY_ACTIONS` so the result never has two winners.
 */
export function sanitiseHotkeys(input: unknown): HotkeyMap {
  const source = (input ?? {}) as Partial<Record<HotkeyAction, unknown>>;
  const out: HotkeyMap = { ...DEFAULT_HOTKEYS };
  const taken = new Set<string>();
  for (const { action } of HOTKEY_ACTIONS) {
    const requested =
      typeof source[action] === "string" ? normaliseCombo(source[action] as string) : null;
    const fallback = DEFAULT_HOTKEYS[action];
    // Prefer what the user asked for, then the default, then no binding at
    // all — two actions must never share one combination.
    const chosen =
      requested && !taken.has(requested)
        ? requested
        : !taken.has(fallback)
          ? fallback
          : "";
    if (chosen) taken.add(chosen);
    out[action] = chosen;
  }
  return out;
}

/** Render a combination for `<kbd>`, keeping the canonical order visible. */
export function comboParts(combo: string): string[] {
  return normaliseCombo(combo)?.split("+") ?? [];
}

export function describeHotkeys(map: HotkeyMap): string {
  return HOTKEY_ACTIONS.filter(({ action }) => map[action])
    .map(({ action }) => `${comboParts(map[action]).join("+")}`)
    .join(" · ");
}
