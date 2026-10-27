import { describe, expect, it } from "vitest";
import { translate } from "../i18n/translate";
import { externalScheme } from "../services/externalLinks";
import {
  allIdentityLinks,
  CONTACT_CHANNELS,
  EXPERTISE_GROUPS,
  FOUNDER_ROLE_KEYS,
  HERO_DISCIPLINE_KEYS,
  KNOUX_IDENTITY,
  SOCIAL_PROFILES,
} from "./knouxIdentity";

/**
 * These expectations are the official destinations supplied by the company.
 * They are written out in full on purpose: a silent edit to an address, a
 * number or a profile must fail here rather than ship.
 */
const OFFICIAL = [
  ["https://knoux.store/", "website"],
  ["mailto:admin@knoux.store", "email"],
  ["tel:+971503281920", "phone"],
  ["https://wa.me/971503281920", "whatsapp"],
  ["https://www.facebook.com/knouxStore/", "facebook company"],
  ["https://www.facebook.com/CopSadek", "facebook founder"],
  ["https://github.com/daynightae-cmyk", "engineering github"],
  ["https://github.com/knoux-io", "company github"],
  ["https://www.tiktok.com/@knoux_7", "tiktok"],
] as const;

describe("KNOUX official identity", () => {
  it("carries the supplied company and founder details", () => {
    expect(KNOUX_IDENTITY.company).toBe("KNOUX");
    expect(KNOUX_IDENTITY.founderName).toBe("Eng. Sadek Elgazar");
    expect(KNOUX_IDENTITY.founderNameAr).toBe("م. صادق الجزار");
    expect(KNOUX_IDENTITY.email).toBe("admin@knoux.store");
    expect(KNOUX_IDENTITY.phoneInternational).toBe("+971 50 328 1920");
    expect(KNOUX_IDENTITY.phoneLocal).toBe("050 328 1920");
  });

  it("publishes exactly the nine official destinations and nothing invented", () => {
    const hrefs = allIdentityLinks().map((link) => link.href);
    expect(hrefs.sort()).toEqual(OFFICIAL.map(([href]) => href).sort());
  });

  it("resolves every destination to an allowed scheme", () => {
    for (const link of allIdentityLinks()) {
      expect(externalScheme(link.href), link.id).not.toBeNull();
    }
  });

  it("keeps the four contact channels distinct and in priority order", () => {
    expect(CONTACT_CHANNELS.map((link) => link.id)).toEqual([
      "whatsapp",
      "email",
      "phone",
      "website",
    ]);
  });

  it("labels company pages apart from founder pages", () => {
    const audienceOf = (href: string) =>
      allIdentityLinks().find((link) => link.href === href)?.audience;
    expect(audienceOf("https://www.facebook.com/knouxStore/")).toBe("company");
    expect(audienceOf("https://www.facebook.com/CopSadek")).toBe("founder");
    expect(audienceOf("https://github.com/daynightae-cmyk")).toBe("founder");
    expect(audienceOf("https://github.com/knoux-io")).toBe("company");
    expect(SOCIAL_PROFILES.filter((profile) => profile.audience === "founder")).toHaveLength(2);
  });

  it("ships the logo as a bundled local asset, never a remote reference", () => {
    // The renderer's CSP is img-src 'self' data: blob:, so a remote URL would
    // simply fail to load inside the desktop shell.
    expect(KNOUX_IDENTITY.logoAsset.startsWith("./")).toBe(true);
    expect(KNOUX_IDENTITY.logoAsset).toBe("./brand/knoux-official.png");
    expect(KNOUX_IDENTITY.logoSourceUrl).toContain("postimg.cc");
  });

  it("gives every channel a copyable value where the display is data, not prose", () => {
    for (const link of CONTACT_CHANNELS) {
      if (link.kind === "website") continue;
      expect(link.copyText, link.id).toBeTruthy();
    }
  });

  it("translates every label the screen renders, in both languages", () => {
    const keys = [
      ...allIdentityLinks().flatMap((link) => [link.labelKey, link.hintKey, link.actionKey]),
      ...EXPERTISE_GROUPS.flatMap((group) => [group.labelKey, ...group.itemKeys]),
      ...FOUNDER_ROLE_KEYS,
      ...HERO_DISCIPLINE_KEYS,
    ];
    expect(keys.length).toBeGreaterThanOrEqual(55);
    for (const key of keys) {
      const english = translate("en", key);
      const arabic = translate("ar", key);
      expect(english, key).not.toBe(key);
      expect(arabic, key).not.toBe(key);
      expect(arabic, key).not.toBe(english);
    }
  });

  it("describes expertise as four groups without inventing a fifth", () => {
    expect(EXPERTISE_GROUPS.map((group) => group.id)).toEqual([
      "software",
      "cloud",
      "automation",
      "product",
    ]);
    expect(EXPERTISE_GROUPS.flatMap((group) => group.itemKeys)).toHaveLength(21);
  });
});
