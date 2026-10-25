import { describe, expect, it } from "vitest";
import {
  comboFromEvent,
  comboParts,
  DEFAULT_HOTKEYS,
  describeHotkeys,
  findConflict,
  matchesCombo,
  normaliseCombo,
  parseCombo,
  sanitiseHotkeys,
  type HotkeyMap,
} from "./hotkeys";

/** A keyboard event shaped like the ones the window listener receives. */
function keyEvent(
  key: string,
  modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {},
): KeyboardEvent {
  return {
    key,
    ctrlKey: Boolean(modifiers.ctrl),
    altKey: Boolean(modifiers.alt),
    shiftKey: Boolean(modifiers.shift),
    metaKey: Boolean(modifiers.meta),
  } as KeyboardEvent;
}

describe("hotkey combinations", () => {
  it("normalises aliases and puts modifiers in one order", () => {
    expect(normaliseCombo("shift+control+r")).toBe("Ctrl+Shift+R");
    expect(normaliseCombo("meta+alt+k")).toBe("Ctrl+Alt+K");
    expect(normaliseCombo("  Ctrl + Shift + F8 ")).toBe("Ctrl+Shift+F8");
  });

  it("refuses a combination without a modifier", () => {
    expect(parseCombo("R")).toBeNull();
    expect(normaliseCombo("R")).toBeNull();
    expect(normaliseCombo("Shift")).toBeNull();
    expect(normaliseCombo("")).toBeNull();
  });

  it("refuses keys that are not a single usable key", () => {
    expect(normaliseCombo("Ctrl+Shift+ABC")).toBeNull();
    expect(normaliseCombo("Ctrl+Shift+Ctrl")).toBeNull();
    expect(normaliseCombo("Ctrl+Shift+F13")).toBeNull();
  });

  it("reads named keys and punctuation", () => {
    expect(normaliseCombo("Ctrl+Space")).toBe("Ctrl+SPACE");
    expect(normaliseCombo("Ctrl+Shift+=")).toBe("Ctrl+Shift+PLUS");
    expect(normaliseCombo("Alt+ArrowUp")).toBe("Alt+UP");
  });

  it("builds the same string from a live event", () => {
    expect(comboFromEvent(keyEvent("r", { ctrl: true, shift: true }))).toBe("Ctrl+Shift+R");
    expect(comboFromEvent(keyEvent("k", { alt: true }))).toBe("Alt+K");
    // Cmd on macOS is Ctrl in the stored form, so one binding works on both.
    expect(comboFromEvent(keyEvent("r", { meta: true, shift: true }))).toBe("Ctrl+Shift+R");
  });

  it("ignores modifier-only keys, Escape and bare letters while recording", () => {
    expect(comboFromEvent(keyEvent("Control", { ctrl: true }))).toBeNull();
    expect(comboFromEvent(keyEvent("Shift", { shift: true }))).toBeNull();
    expect(comboFromEvent(keyEvent("Escape"))).toBeNull();
    expect(comboFromEvent(keyEvent("r"))).toBeNull();
  });

  it("matches an event only when every modifier agrees", () => {
    const combo = "Ctrl+Shift+R";
    expect(matchesCombo(keyEvent("r", { ctrl: true, shift: true }), combo)).toBe(true);
    expect(matchesCombo(keyEvent("R", { ctrl: true, shift: true }), combo)).toBe(true);
    expect(matchesCombo(keyEvent("r", { meta: true, shift: true }), combo)).toBe(true);
    expect(matchesCombo(keyEvent("r", { ctrl: true }), combo)).toBe(false);
    expect(matchesCombo(keyEvent("r", { ctrl: true, shift: true, alt: true }), combo)).toBe(false);
    expect(matchesCombo(keyEvent("p", { ctrl: true, shift: true }), combo)).toBe(false);
    expect(matchesCombo(keyEvent("r", { ctrl: true, shift: true }), "not-a-combo")).toBe(false);
  });

  it("finds who already owns a combination", () => {
    const map: HotkeyMap = { ...DEFAULT_HOTKEYS };
    expect(findConflict(map, "ctrl+shift+r", "pause")).toBe("toggle");
    expect(findConflict(map, "Ctrl+Shift+R", "toggle")).toBeNull();
    expect(findConflict(map, "Ctrl+Alt+Z", "toggle")).toBeNull();
    expect(findConflict(map, "nonsense", "toggle")).toBeNull();
  });

  it("sanitises a hand-edited map instead of trusting it", () => {
    expect(sanitiseHotkeys(undefined)).toEqual(DEFAULT_HOTKEYS);
    expect(sanitiseHotkeys({ toggle: "garbage" }).toggle).toBe(DEFAULT_HOTKEYS.toggle);

    const partial = sanitiseHotkeys({ pause: "alt+p" });
    expect(partial.pause).toBe("Alt+P");
    expect(partial.toggle).toBe(DEFAULT_HOTKEYS.toggle);
  });

  it("never lets two actions share one combination", () => {
    // The first action in the registry order wins the requested combination;
    // the second falls back to its own default, which is still free.
    const duplicated = sanitiseHotkeys({ toggle: "Alt+K", pause: "Alt+K" });
    expect(duplicated.toggle).toBe("Alt+K");
    expect(duplicated.pause).toBe(DEFAULT_HOTKEYS.pause);
    expect(duplicated.pause).not.toBe(duplicated.toggle);
  });

  it("leaves a binding empty when even its default is taken", () => {
    // Pause requested the toggle's default, so the toggle takes it first and
    // pause has nowhere to fall back to.
    const map = sanitiseHotkeys({
      toggle: DEFAULT_HOTKEYS.pause,
      pause: DEFAULT_HOTKEYS.pause,
    });
    expect(map.toggle).toBe(DEFAULT_HOTKEYS.pause);
    expect(map.pause).toBe("");
  });

  it("renders parts and a summary without inventing empty keys", () => {
    expect(comboParts("shift+ctrl+alt+r")).toEqual(["Ctrl", "Alt", "Shift", "R"]);
    expect(comboParts("")).toEqual([]);
    const map: HotkeyMap = { ...DEFAULT_HOTKEYS, audio: "" };
    expect(describeHotkeys(map)).toContain("Ctrl+Shift+R");
    expect(describeHotkeys(map)).not.toContain("Ctrl+Shift+A");
  });
});
