import { describe, expect, it, vi } from "vitest";
import {
  copyText,
  externalScheme,
  isSafeExternalUrl,
  openExternal,
} from "./externalLinks";

describe("external scheme policy", () => {
  it("accepts the three schemes the identity page uses", () => {
    expect(externalScheme("https://knoux.store/")).toBe("https");
    expect(externalScheme("https://wa.me/971503281920")).toBe("https");
    expect(externalScheme("mailto:admin@knoux.store")).toBe("mailto");
    expect(externalScheme("tel:+971503281920")).toBe("tel");
  });

  it("refuses every scheme that could run code or touch the disk", () => {
    for (const raw of [
      "javascript:alert(1)",
      " data:text/html,<script>alert(1)</script>",
      "file:///C:/Windows/system32/cmd.exe",
      "vscode://fade",
      "blob:https://knoux.store/abc",
      "http://knoux.store/",
      "//knoux.store",
      "knoux.store",
      "",
      "   ",
    ]) {
      expect(externalScheme(raw)).toBeNull();
      expect(isSafeExternalUrl(raw)).toBe(false);
    }
  });

  it("refuses a control character smuggled into the scheme", () => {
    expect(externalScheme("java\nscript:alert(1)")).toBeNull();
    expect(externalScheme("https://knoux.store /\n")).toBeNull();
  });

  it("refuses a malformed authority and a credential-bearing URL", () => {
    expect(externalScheme("https://")).toBeNull();
    expect(externalScheme("https://localhost/")).toBeNull();
    expect(externalScheme("https://admin:x@knoux.store/")).toBeNull();
  });

  it("requires a real address before calling something mailto, and digits before tel", () => {
    expect(externalScheme("mailto:not-an-address")).toBeNull();
    expect(externalScheme("mailto:")).toBeNull();
    expect(externalScheme("tel:+1")).toBeNull();
    expect(externalScheme("tel:+971503281920")).toBe("tel");
  });
});

describe("openExternal", () => {
  it("refuses an unsafe destination without touching the bridge", async () => {
    const open = vi.fn();
    const outcome = await openExternal("javascript:alert(1)", { openExternal: open });
    expect(outcome).toEqual({ ok: false, reason: "unsafe-url", scheme: null });
    expect(open).not.toHaveBeenCalled();
  });

  it("asks the desktop bridge and reports what it answered", async () => {
    const open = vi.fn(async () => true);
    const outcome = await openExternal("tel:+971503281920", { openExternal: open });
    expect(open).toHaveBeenCalledWith("tel:+971503281920");
    expect(outcome).toEqual({ ok: true, via: "electron", scheme: "tel" });
  });

  it("never claims success when the main process has no handler", async () => {
    const outcome = await openExternal("mailto:admin@knoux.store", {
      openExternal: async () => false,
    });
    expect(outcome).toEqual({ ok: false, reason: "no-handler", scheme: "mailto" });
  });

  it("turns a rejecting bridge into a failure, not a thrown error", async () => {
    const outcome = await openExternal("https://knoux.store/", {
      openExternal: () => Promise.reject(new Error("denied")),
    });
    expect(outcome).toEqual({ ok: false, reason: "failed", scheme: "https" });
  });

  it("opens https in a new browser window when there is no bridge", async () => {
    const spy = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const outcome = await openExternal("https://github.com/knoux-io", null);
    expect(spy).toHaveBeenCalledWith(
      "https://github.com/knoux-io",
      "_blank",
      "noopener,noreferrer",
    );
    expect(outcome).toEqual({ ok: true, via: "browser", scheme: "https" });
    spy.mockRestore();
  });

  it("reports a blocked popup as no handler", async () => {
    const spy = vi.spyOn(window, "open").mockReturnValue(null);
    const outcome = await openExternal("https://knoux.store/", null);
    expect(outcome).toEqual({ ok: false, reason: "no-handler", scheme: "https" });
    spy.mockRestore();
  });

  it("hands mailto to an anchor click in a browser and leaves the DOM clean", async () => {
    const before = document.querySelectorAll("a").length;
    const outcome = await openExternal("mailto:admin@knoux.store", null);
    expect(outcome).toEqual({ ok: true, via: "browser", scheme: "mailto" });
    expect(document.querySelectorAll("a").length).toBe(before);
  });
});

describe("copyText", () => {
  it("uses the async clipboard when it is available", async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: write },
      configurable: true,
    });
    await expect(copyText("admin@knoux.store")).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith("admin@knoux.store");
  });

  it("reports false when the clipboard rejects and the legacy path cannot copy", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => { throw new Error("denied"); }) },
      configurable: true,
    });
    const previous = document.execCommand;
    document.execCommand = vi.fn(() => false) as unknown as typeof document.execCommand;
    await expect(copyText("+971 50 328 1920")).resolves.toBe(false);
    document.execCommand = previous;
  });

  it("refuses to claim an empty value was copied", async () => {
    await expect(copyText("")).resolves.toBe(false);
  });
});
