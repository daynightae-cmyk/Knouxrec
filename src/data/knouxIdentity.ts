/**
 * KNOUX corporate identity — the single source of truth for the About screen.
 *
 * Every value here is an official destination supplied by the company. Nothing
 * is inferred: no extra email addresses, no unlisted social profiles, no
 * follower counts, no statistics and no copyright year. Labels are i18n keys so
 * the Arabic build stays complete; destinations are literal strings because a
 * URL is never translated.
 */

export type LinkAudience = "company" | "founder";
export type LinkKind =
  | "website"
  | "email"
  | "phone"
  | "whatsapp"
  | "facebook"
  | "github"
  | "tiktok";

export interface IdentityLink {
  id: string;
  kind: LinkKind;
  audience: LinkAudience;
  /** Where the click goes. Always https, mailto or tel — see externalLinks.ts. */
  href: string;
  /** What is printed on the card. */
  display: string;
  labelKey: string;
  hintKey: string;
  /** Text a copy action puts on the clipboard, when the display differs. */
  copyText?: string;
  /** Primary action verb, e.g. "Send email" or "Start chat". */
  actionKey: string;
}

export const KNOUX_IDENTITY = {
  company: "KNOUX",
  /** The product wordmark already lives in the sidebar; this is the company. */
  founderName: "Eng. Sadek Elgazar",
  founderNameAr: "م. صادق الجزار",
  /** Bundled copy of the official artwork, verified byte-for-byte on download. */
  logoAsset: "./brand/knoux-official.png",
  logoSourceUrl: "https://i.postimg.cc/Kv9g6Kpt/cropped-circle-image-%281%29.png",
  website: "https://knoux.store/",
  email: "admin@knoux.store",
  phoneE164: "+971503281920",
  phoneInternational: "+971 50 328 1920",
  phoneLocal: "050 328 1920",
  whatsapp: "https://wa.me/971503281920",
} as const;

/** The four communication channels, ordered by how quickly they reach a human. */
export const CONTACT_CHANNELS: IdentityLink[] = [
  {
    id: "whatsapp",
    kind: "whatsapp",
    audience: "company",
    href: KNOUX_IDENTITY.whatsapp,
    display: KNOUX_IDENTITY.phoneInternational,
    labelKey: "about.contact.whatsapp",
    hintKey: "about.contact.whatsappHint",
    actionKey: "about.contact.whatsappAction",
    copyText: KNOUX_IDENTITY.phoneInternational,
  },
  {
    id: "email",
    kind: "email",
    audience: "company",
    href: `mailto:${KNOUX_IDENTITY.email}`,
    display: KNOUX_IDENTITY.email,
    labelKey: "about.contact.email",
    hintKey: "about.contact.emailHint",
    actionKey: "about.contact.emailAction",
    copyText: KNOUX_IDENTITY.email,
  },
  {
    id: "phone",
    kind: "phone",
    audience: "company",
    href: "tel:+971503281920",
    display: KNOUX_IDENTITY.phoneInternational,
    labelKey: "about.contact.phone",
    hintKey: "about.contact.phoneHint",
    actionKey: "about.contact.phoneAction",
    copyText: KNOUX_IDENTITY.phoneInternational,
  },
  {
    id: "website",
    kind: "website",
    audience: "company",
    href: KNOUX_IDENTITY.website,
    display: "knoux.store",
    labelKey: "about.contact.website",
    hintKey: "about.contact.websiteHint",
    actionKey: "about.contact.websiteAction",
  },
];

/** Five social destinations. Company pages and the founder are kept distinct. */
export const SOCIAL_PROFILES: IdentityLink[] = [
  {
    id: "facebook-company",
    kind: "facebook",
    audience: "company",
    href: "https://www.facebook.com/knouxStore/",
    display: "facebook.com/knouxStore",
    labelKey: "about.social.facebookCompany",
    hintKey: "about.social.facebookCompanyHint",
    actionKey: "about.social.open",
  },
  {
    id: "facebook-founder",
    kind: "facebook",
    audience: "founder",
    href: "https://www.facebook.com/CopSadek",
    display: "facebook.com/CopSadek",
    labelKey: "about.social.facebookFounder",
    hintKey: "about.social.facebookFounderHint",
    actionKey: "about.social.open",
  },
  {
    id: "github-engineering",
    kind: "github",
    audience: "founder",
    href: "https://github.com/daynightae-cmyk",
    display: "github.com/daynightae-cmyk",
    labelKey: "about.social.githubEngineering",
    hintKey: "about.social.githubEngineeringHint",
    actionKey: "about.social.open",
  },
  {
    id: "github-company",
    kind: "github",
    audience: "company",
    href: "https://github.com/knoux-io",
    display: "github.com/knoux-io",
    labelKey: "about.social.githubCompany",
    hintKey: "about.social.githubCompanyHint",
    actionKey: "about.social.open",
  },
  {
    id: "tiktok",
    kind: "tiktok",
    audience: "company",
    href: "https://www.tiktok.com/@knoux_7",
    display: "@knoux_7",
    labelKey: "about.social.tiktok",
    hintKey: "about.social.tiktokHint",
    actionKey: "about.social.open",
  },
];

/**
 * Areas of the founder's engineering practice. These describe the person, not
 * this application — the About screen says so explicitly, and the capability
 * registry stays the only source of truth for what KNOUX REC actually runs.
 */
export interface ExpertiseGroup {
  id: string;
  labelKey: string;
  icon: "code" | "cloud" | "cpu" | "layers";
  itemKeys: string[];
}

export const EXPERTISE_GROUPS: ExpertiseGroup[] = [
  {
    id: "software",
    labelKey: "about.expertise.software",
    icon: "code",
    itemKeys: [
      "about.skill.react",
      "about.skill.typescript",
      "about.skill.javascript",
      "about.skill.electron",
      "about.skill.windows",
      "about.skill.android",
    ],
  },
  {
    id: "cloud",
    labelKey: "about.expertise.cloud",
    icon: "cloud",
    itemKeys: [
      "about.skill.supabase",
      "about.skill.github",
      "about.skill.vercel",
      "about.skill.apis",
      "about.skill.git",
      "about.skill.cicd",
    ],
  },
  {
    id: "automation",
    labelKey: "about.expertise.automation",
    icon: "cpu",
    itemKeys: [
      "about.skill.ai",
      "about.skill.aiIntegrations",
      "about.skill.aiAutomation",
      "about.skill.powershell",
      "about.skill.workflows",
    ],
  },
  {
    id: "product",
    labelKey: "about.expertise.product",
    icon: "layers",
    itemKeys: [
      "about.skill.uiux",
      "about.skill.architecture",
      "about.skill.integration",
      "about.skill.digitalProducts",
    ],
  },
];

/** The founder roles shown under the name. */
export const FOUNDER_ROLE_KEYS = [
  "about.founder.role1",
  "about.founder.role2",
  "about.founder.role3",
  "about.founder.role4",
] as const;

/** Hero discipline chips. */
export const HERO_DISCIPLINE_KEYS = [
  "about.hero.disciplineEngineering",
  "about.hero.disciplineProducts",
  "about.hero.disciplineAutomation",
] as const;

/** Every destination the screen can open, for validation in one place. */
export function allIdentityLinks(): IdentityLink[] {
  return [...CONTACT_CHANNELS, ...SOCIAL_PROFILES];
}
