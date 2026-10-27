/**
 * Arabic deterministic text utilities.
 *
 * Pure, offline, dependency-free operations on Arabic text. None of these
 * require a model or weights; they are real Unicode handling, not inference.
 */

export type ArabicNumeralDirection = "to-western" | "to-arabic";

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const WESTERN_DIGITS = "0123456789";

const ARABIC_DIACRITICS = /[\u064b-\u065f\u0670\u0640]/g; // harakat + tatweel

const ALEF_VARIANTS = /[آأإ\u0622\u0623\u0625\u0627]/g;
const YAA_VARIANTS = /[\u0649\u06cc]/g;
const TA_MARBUTA = /\u0629/g;

/**
 * Convert Arabic-Indic digits to Western digits, or back.
 */
export function convertArabicNumerals(
  text: string,
  direction: ArabicNumeralDirection = "to-western",
): string {
  if (direction === "to-western") {
    return text.replace(/[٠-٩]/g, (ch) => {
      const index = ARABIC_DIGITS.indexOf(ch);
      return index >= 0 ? WESTERN_DIGITS[index] : ch;
    });
  }
  return text.replace(/[0-9]/g, (ch) => ARABIC_DIGITS[WESTERN_DIGITS.indexOf(ch)]);
}

/**
 * Remove Arabic diacritics (tashkeel/harakat) and the tatweel elongation mark.
 */
export function stripDiacritics(text: string): string {
  return text.replace(ARABIC_DIACRITICS, "");
}

/**
 * Normalize common Arabic letter variants so semantically identical text
 * compares equal: alef forms to alef, yeh/yeh-bare to yeh, ta marbuta to ha.
 */
export function normalizeArabic(text: string): string {
  return text
    .replace(ALEF_VARIANTS, "\u0627")
    .replace(YAA_VARIANTS, "\u064a")
    .replace(TA_MARBUTA, "\u0647");
}

/**
 * Test whether a string contains any right-to-left Arabic script characters.
 */
export function containsArabicScript(text: string): boolean {
  return /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/.test(text);
}

/**
 * Estimate the displayed width of Arabic text relative to Latin text (Arabic
 * glyphs are commonly rendered wider). Used to size inputs sensibly.
 */
export function arabicWidthFactor(text: string): number {
  return containsArabicScript(text) ? 1.25 : 1;
}

/**
 * Split Arabic text into words on whitespace, preserving the original order.
 */
export function arabicWords(text: string): string[] {
  return text.trim().split(/\s+/).filter((word) => word.length > 0);
}

/**
 * Count Arabic words in a text.
 */
export function arabicWordCount(text: string): number {
  return arabicWords(text).length;
}
