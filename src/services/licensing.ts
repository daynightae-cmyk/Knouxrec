/**
 * KNOUX REC — licensing gateway.
 *
 * This is deliberately an isolated module with no payment code inside it. It
 * validates the *shape* of a licence key the user already holds (format and
 * checksum, so a typo is caught immediately) and stores that state locally.
 *
 * It cannot decide whether a key was paid for: that requires an activation
 * server, which this build does not have. The UI says so in plain words rather
 * than showing a fake "activated" badge. Purchases leave the app for the
 * official store; no card data ever touches this process.
 */

export type LicenseState = "unlicensed" | "format-valid" | "invalid";

export interface LicenseRecord {
  key: string;
  state: LicenseState;
  reason: string | null;
  updatedAt: number;
}

export interface LicenseCheck {
  ok: boolean;
  reason: "empty" | "shape" | "checksum" | null;
  key: string;
}

const STORAGE_KEY = "knoux.license.v1";
const GROUPS = 4;
const GROUP_SIZE = 5;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, no I/L/O/U

/** Normalises user input: upper case, dashes regrouped, confusable letters fixed. */
export function normaliseLicenseKey(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/I/g, "1")
    .replace(/L/g, "1")
    .replace(/O/g, "0");
  // Every character is kept: silently dropping the tail of a pasted key would
  // turn a wrong key into a passing one.
  const groups: string[] = [];
  for (let index = 0; index < cleaned.length; index += GROUP_SIZE) {
    groups.push(cleaned.slice(index, index + GROUP_SIZE));
  }
  return groups.join("-");
}

function checksum(payload: string): string {
  // FNV-1a over the payload, spread across one full base32 group. This catches
  // transcription errors; it is not a signature and is not treated as one.
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let out = "";
  for (let index = 0; index < GROUP_SIZE; index += 1) {
    out += ALPHABET[(hash >>> (index * 5)) & 31];
  }
  return out;
}

/** The last group carries the checksum of the first three, five characters wide. */
export function checksumGroup(payloadGroups: string[]): string {
  return checksum(payloadGroups.join(""));
}

/**
 * Validate a key. Returns the normalised form so the caller can store exactly
 * what it checked, and a reason when it refuses.
 */
export function checkLicenseKey(raw: string): LicenseCheck {
  const key = normaliseLicenseKey(raw ?? "");
  if (!key) return { ok: false, reason: "empty", key };
  const groups = key.split("-");
  if (groups.length !== GROUPS || groups.some((group) => group.length !== GROUP_SIZE)) {
    return { ok: false, reason: "shape", key };
  }
  if (groups.some((group) => [...group].some((character) => !ALPHABET.includes(character)))) {
    return { ok: false, reason: "shape", key };
  }
  const expected = checksumGroup(groups.slice(0, GROUPS - 1));
  if (groups[GROUPS - 1] !== expected) return { ok: false, reason: "checksum", key };
  return { ok: true, reason: null, key };
}

/** A key for the test suite and for demos; it carries no entitlement. */
export function sampleLicenseKey(): string {
  const payload = ["KN0X1", "DEM00", "00000"];
  const groups = payload.map((group) => group.slice(0, GROUP_SIZE).padEnd(GROUP_SIZE, "0"));
  return [...groups, checksumGroup(groups)].join("-");
}

export function readLicense(): LicenseRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LicenseRecord;
    if (!parsed || typeof parsed.key !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function activateLicense(raw: string): LicenseRecord {
  const result = checkLicenseKey(raw);
  const record: LicenseRecord = {
    key: result.key,
    state: result.ok ? "format-valid" : "invalid",
    reason: result.reason,
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* storage can be blocked; the caller still gets the verdict */
  }
  return record;
}

export function clearLicense(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Where a purchase actually happens. Outside the application, on purpose. */
export const PURCHASE_URL = "https://knoux.store/";
