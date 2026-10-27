import { beforeEach, describe, expect, it } from "vitest";
import {
  activateLicense,
  checkLicenseKey,
  checksumGroup,
  clearLicense,
  normaliseLicenseKey,
  PURCHASE_URL,
  readLicense,
  sampleLicenseKey,
} from "./licensing";

beforeEach(() => {
  localStorage.clear();
});

describe("licence key shape", () => {
  it("regroups typed input and repairs confusable letters", () => {
    expect(normaliseLicenseKey("kn0x1 dem00 00000 b1x2y")).toBe("KN0X1-DEM00-00000-B1X2Y");
    expect(normaliseLicenseKey("KNOX1-DEMO0-00000-B1X2Y")).toBe("KN0X1-DEM00-00000-B1X2Y");
  });

  it("accepts the generated sample key", () => {
    const key = sampleLicenseKey();
    expect(checkLicenseKey(key)).toEqual({ ok: true, reason: null, key });
  });

  it("catches a single mistyped character through the checksum", () => {
    const groups = sampleLicenseKey().split("-");
    groups[1] = groups[1].replace(/^D/, "E");
    const typo = groups.join("-");
    expect(checkLicenseKey(typo).ok).toBe(false);
    expect(checkLicenseKey(typo).reason).toBe("checksum");
  });

  it("refuses a short or over-long key without pretending it was checked", () => {
    expect(checkLicenseKey("KN0X1-DEM00").reason).toBe("shape");
    expect(checkLicenseKey("KN0X1-DEM00-00000-B1X2Y-EXTRA").reason).toBe("shape");
  });

  it("refuses an empty value", () => {
    expect(checkLicenseKey("   ")).toEqual({ ok: false, reason: "empty", key: "" });
  });

  it("refuses letters that the alphabet excludes", () => {
    // U is not a Crockford character; normalisation cannot guess what was meant.
    expect(checkLicenseKey("KN0U1-DEM00-00000-B1X2Y").ok).toBe(false);
  });

  it("keeps the checksum deterministic for the same payload", () => {
    const groups = ["KN0X1", "DEM00", "00000"];
    expect(checksumGroup(groups)).toBe(checksumGroup(groups));
  });
});

describe("licence storage", () => {
  it("stores the checked key and reports it as format-valid, never as activated", () => {
    const record = activateLicense(sampleLicenseKey().toLowerCase());
    expect(record.state).toBe("format-valid");
    const stored = readLicense();
    expect(stored?.key).toBe(sampleLicenseKey());
    expect(stored?.state).toBe("format-valid");
  });

  it("stores a refusal as a refusal", () => {
    const record = activateLicense("KN0X1-DEM00-00000-ZZZZZ");
    expect(record.state).toBe("invalid");
    expect(readLicense()?.state).toBe("invalid");
  });

  it("removes the record completely", () => {
    activateLicense(sampleLicenseKey());
    clearLicense();
    expect(readLicense()).toBeNull();
  });

  it("sends purchases to the official store over https, never to a placeholder", () => {
    expect(PURCHASE_URL).toBe("https://knoux.store/");
  });
});
