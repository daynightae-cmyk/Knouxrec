import { describe, it, expect } from "vitest";
import {
  convertArabicNumerals,
  stripDiacritics,
  normalizeArabic,
  containsArabicScript,
  arabicWidthFactor,
  arabicWords,
  arabicWordCount,
} from "./arabicOps";

describe("convertArabicNumerals", () => {
  it("converts Arabic-Indic digits to Western", () => {
    expect(convertArabicNumerals("١٢٣", "to-western")).toBe("123");
    expect(convertArabicNumerals("الساعة ٥:٣٠", "to-western")).toBe("الساعة 5:30");
  });
  it("converts Western digits to Arabic-Indic", () => {
    expect(convertArabicNumerals("123", "to-arabic")).toBe("١٢٣");
    expect(convertArabicNumerals("الساعة 5:30", "to-arabic")).toBe("الساعة ٥:٣٠");
  });
  it("leaves non-digits untouched", () => {
    expect(convertArabicNumerals("KNOUX REC 2026", "to-western")).toBe("KNOUX REC 2026");
  });
});

describe("stripDiacritics", () => {
  it("removes harakat and tatweel", () => {
    expect(stripDiacritics("عَرَبِيّ")).toBe("عربي");
    expect(stripDiacritics("شكرًا")).toBe("شكرا");
    expect(stripDiacritics("طــول")).toBe("طول");
  });
});

describe("normalizeArabic", () => {
  it("collapses alef variants to alef", () => {
    expect(normalizeArabic("أحمد")).toBe("احمد");
    expect(normalizeArabic("إبراهيم")).toBe("إبراهيم".replace(/^إ/, "ا"));
    expect(normalizeArabic("أرض")).toBe("ارض");
  });
  it("normalizes ta marbuta to ha", () => {
    expect(normalizeArabic("مدرسة")).toBe("مدرسه");
  });
  it("is idempotent", () => {
    const input = "أقصى جامعة مدينة";
    expect(normalizeArabic(normalizeArabic(input))).toBe(normalizeArabic(input));
  });
});

describe("containsArabicScript", () => {
  it("detects Arabic text", () => {
    expect(containsArabicScript("اللغة العربية")).toBe(true);
    expect(containsArabicScript("KNOUX REC")).toBe(false);
    expect(containsArabicScript("مختبر 123")).toBe(true);
  });
});

describe("arabicWidthFactor", () => {
  it("returns a wider factor for Arabic", () => {
    expect(arabicWidthFactor("العربية")).toBeGreaterThan(arabicWidthFactor("english"));
  });
});

describe("arabicWords / arabicWordCount", () => {
  it("splits and counts Arabic words", () => {
    expect(arabicWords("السلام عليكم ورحمة الله")).toHaveLength(4);
    expect(arabicWordCount("السلام عليكم ورحمة الله")).toBe(4);
    expect(arabicWordCount("   ")).toBe(0);
  });
});
