import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { translate } from "../i18n/translate";
import { Icon, type IconName } from "../app/icons";
import { BrandIcon, type BrandIconName } from "../app/brandIcons";
import { APP_VERSION } from "../app/buildInfo";
import {
  CONTACT_CHANNELS,
  EXPERTISE_GROUPS,
  FOUNDER_ROLE_KEYS,
  HERO_DISCIPLINE_KEYS,
  KNOUX_IDENTITY,
  SOCIAL_PROFILES,
  type IdentityLink,
  type LinkKind,
} from "../data/knouxIdentity";
import { copyText, externalScheme, openExternal } from "../services/externalLinks";

const BRAND_ICON: Partial<Record<LinkKind, BrandIconName>> = {
  facebook: "facebook",
  github: "github",
  tiktok: "tiktok",
  whatsapp: "whatsapp",
};

const STROKE_ICON: Partial<Record<LinkKind, IconName>> = {
  email: "mail",
  phone: "phone",
  website: "globe",
};

const EXPERTISE_ICON: Record<(typeof EXPERTISE_GROUPS)[number]["icon"], IconName> = {
  code: "code",
  cloud: "cloud",
  cpu: "cpu",
  layers: "layers",
};

/** Destinations that leave the machine through the operating system. */
const COMMUNICATION_KINDS: LinkKind[] = ["email", "phone"];

function LinkGlyph({ kind, size = 22 }: { kind: LinkKind; size?: number }) {
  const brand = BRAND_ICON[kind];
  if (brand) return <BrandIcon name={brand} size={size} />;
  return <Icon name={STROKE_ICON[kind] ?? "external"} size={size} />;
}

export default function AboutView() {
  const { settings } = useSettings();
  const { push } = useToast();
  const t = useCallback(
    (key: string) => translate(settings.language, key),
    [settings.language],
  );
  const [logoBroken, setLogoBroken] = useState(false);
  const [logoReady, setLogoReady] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const heroRef = useRef<HTMLDivElement | null>(null);

  // A single pointer-tracked highlight, throttled to one write per frame and
  // skipped entirely when the operating system asks for reduced motion.
  useEffect(() => {
    const surface = heroRef.current;
    if (!surface) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let pending: { x: number; y: number } | null = null;
    const apply = () => {
      frame = 0;
      if (!pending) return;
      const box = surface.getBoundingClientRect();
      surface.style.setProperty(
        "--kx-about-mx",
        `${(((pending.x - box.left) / box.width) * 100).toFixed(2)}%`,
      );
      surface.style.setProperty(
        "--kx-about-my",
        `${(((pending.y - box.top) / box.height) * 100).toFixed(2)}%`,
      );
    };
    const onMove = (event: PointerEvent) => {
      pending = { x: event.clientX, y: event.clientY };
      if (!frame) frame = window.requestAnimationFrame(apply);
    };
    surface.addEventListener("pointermove", onMove);
    return () => {
      surface.removeEventListener("pointermove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const say = useCallback((id: string, message: string) => {
    setFeedback((previous) => ({ ...previous, [id]: message }));
  }, []);

  // A status line was written in the language the user was reading when the
  // action happened; keeping it after a switch would leave a foreign string on
  // a translated screen, so the feedback resets with the language.
  useEffect(() => {
    setFeedback({});
  }, [settings.language]);

  /**
   * Hand a mailto:/tel: destination to the operating system. A refusal is
   * reported as a refusal: the number or address is copied instead and the card
   * says so, which is the honest fallback when no dialer or mail client exists.
   */
  const communicate = useCallback(
    async (link: IdentityLink) => {
      const outcome = await openExternal(link.href, window.knouxDesktop);
      if (outcome.ok) {
        say(link.id, t("about.contact.handedOff"));
        return;
      }
      if (outcome.reason === "unsafe-url") {
        say(link.id, t("about.contact.refused"));
        push("error", t(link.labelKey), t("about.contact.refused"));
        return;
      }
      const value = link.copyText ?? link.display;
      const copied = await copyText(value);
      say(link.id, copied ? t("about.contact.noHandlerCopied") : t("about.contact.noHandler"));
      push("warning", t(link.labelKey), t("about.contact.noHandler"));
    },
    [push, say, t],
  );

  const copy = useCallback(
    async (link: IdentityLink) => {
      const value = link.copyText ?? link.display;
      const copied = await copyText(value);
      say(link.id, copied ? t("about.contact.copied") : t("about.contact.copyFailed"));
      if (copied) push("success", t("about.contact.copiedTitle"), value);
      else push("error", t("about.contact.copyFailedTitle"), t("about.contact.copyFailed"));
    },
    [push, say, t],
  );

  const unusable = CONTACT_CHANNELS.filter((link) => externalScheme(link.href) === null);

  return (
    <div className="kx-content kx-about" data-about-view>
      {/* ---------- A — corporate hero ---------- */}
      <section
        className="kx-about-hero"
        id="about-hero"
        ref={heroRef}
        data-about-section="hero"
        aria-labelledby="about-hero-title"
      >
        <div className="kx-about-hero-aura" aria-hidden="true">
          <span className="kx-about-ring kx-about-ring-1" />
          <span className="kx-about-ring kx-about-ring-2" />
          <span className="kx-about-ring kx-about-ring-3" />
          <span className="kx-about-sweep" />
          <span className="kx-about-mote kx-about-mote-1" />
          <span className="kx-about-mote kx-about-mote-2" />
          <span className="kx-about-mote kx-about-mote-3" />
          <span className="kx-about-mote kx-about-mote-4" />
          <span className="kx-about-mote kx-about-mote-5" />
        </div>

        <div className="kx-about-hero-copy">
          <p className="kx-eyebrow">
            <span className="kx-status-dot" />
            {t("about.hero.eyebrow")}
          </p>
          <h1 className="kx-about-wordmark" id="about-hero-title">
            KNOUX
          </h1>
          <p className="kx-about-tagline">{t("about.hero.tagline")}</p>
          <p className="kx-about-hero-desc">{t("about.hero.intro")}</p>

          <p className="kx-about-founded">
            {t("about.hero.foundedBy")}{" "}
            <strong>{KNOUX_IDENTITY.founderName}</strong>
            <span className="kx-about-founded-sep" aria-hidden="true">
              {" · "}
            </span>
            <span className="kx-about-founded-ar" dir="rtl">
              {KNOUX_IDENTITY.founderNameAr}
            </span>
          </p>

          <ul className="kx-about-disciplines" data-about-disciplines>
            {HERO_DISCIPLINE_KEYS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>

          <div className="kx-hero-actions">
            <a
              className="kx-btn kx-btn-primary"
              data-about-cta="whatsapp"
              href={KNOUX_IDENTITY.whatsapp}
              target="_blank"
              rel="noopener noreferrer"
            >
              <BrandIcon name="whatsapp" size={17} />
              {t("about.contact.whatsappAction")}
            </a>
            <a
              className="kx-btn"
              data-about-cta="email"
              href={`mailto:${KNOUX_IDENTITY.email}`}
              onClick={(event) => {
                event.preventDefault();
                const emailLink = CONTACT_CHANNELS.find((link) => link.kind === "email");
                if (emailLink) void communicate(emailLink);
              }}
            >
              <Icon name="mail" size={17} />
              {t("about.contact.emailAction")}
            </a>
            <a
              className="kx-btn kx-btn-quiet"
              data-about-cta="website"
              href={KNOUX_IDENTITY.website}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="globe" size={17} />
              {t("about.contact.websiteAction")}
              <Icon name="external" size={14} />
            </a>
          </div>

          <p className="kx-about-logo-note" data-about-logo-note>
            {logoBroken ? t("about.hero.logoMissing") : t("about.hero.logoNote")}
          </p>
        </div>

        <div className="kx-about-hero-side">
          <div
            className="kx-about-medallion"
            data-about-medallion
            data-ready={logoReady ? "true" : "false"}
          >
            {!logoBroken && (
              <img
                className="kx-about-logo"
                data-about-logo
                src={KNOUX_IDENTITY.logoAsset}
                width={208}
                height={208}
                alt="KNOUX"
                onLoad={() => setLogoReady(true)}
                onError={() => setLogoBroken(true)}
              />
            )}
            {logoBroken && (
              <span className="kx-about-logo-fallback" data-about-logo-fallback>
                KNOUX
              </span>
            )}
            <span className="kx-about-medallion-halo" aria-hidden="true" />
          </div>
        </div>
      </section>

      {/* ---------- B — the founder ---------- */}
      <section
        className="kx-about-section"
        data-about-section="founder"
        aria-labelledby="about-founder-title"
      >
        <header className="kx-about-section-head">
          <p className="kx-eyebrow">
            <span className="kx-status-dot" />
            {t("about.founder.eyebrow")}
          </p>
          <h2 className="kx-view-title" id="about-founder-title">
            {t("about.founder.title")}
          </h2>
          <p className="kx-view-desc">{t("about.founder.description")}</p>
        </header>

        <div className="kx-about-founder">
          <article className="kx-about-founder-card" data-about-founder-card>
            <div className="kx-about-founder-mono" aria-hidden="true">
              <span>SE</span>
            </div>
            <div className="kx-about-founder-copy">
              <h3 className="kx-about-founder-name">{KNOUX_IDENTITY.founderName}</h3>
              <p className="kx-about-founder-name-ar">{KNOUX_IDENTITY.founderNameAr}</p>
              <ul className="kx-about-roles" data-about-roles>
                {FOUNDER_ROLE_KEYS.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ul>
              <p className="kx-about-bio" data-about-bio>
                {t("about.founder.bio")}
              </p>
            </div>
          </article>

          <div className="kx-grid kx-grid-2 kx-about-expertise" data-about-expertise-grid>
            {EXPERTISE_GROUPS.map((group) => (
              <article className="kx-about-expertise-card" data-about-expertise={group.id} key={group.id}>
                <h4 className="kx-card-title">
                  <span className="kx-about-expertise-icon">
                    <Icon name={EXPERTISE_ICON[group.icon]} size={16} />
                  </span>
                  {t(group.labelKey)}
                </h4>
                <ul className="kx-about-skills" data-about-skills>
                  {group.itemKeys.map((key) => (
                    <li key={key}>{t(key)}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>

        <p className="kx-about-note" data-about-expertise-note>
          <Icon name="info" size={14} />
          {t("about.founder.expertiseNote")}
        </p>
      </section>

      {/* ---------- C — contact centre ---------- */}
      <section
        className="kx-about-section"
        data-about-section="contact"
        aria-labelledby="about-contact-title"
      >
        <header className="kx-about-section-head">
          <p className="kx-eyebrow">
            <span className="kx-status-dot" />
            {t("about.contact.eyebrow")}
          </p>
          <h2 className="kx-view-title" id="about-contact-title">
            {t("about.contact.title")}
          </h2>
          <p className="kx-view-desc">{t("about.contact.description")}</p>
        </header>

        {unusable.length > 0 && (
          <p className="kx-about-note kx-about-note-warn" data-about-misconfigured>
            <Icon name="alert" size={14} />
            {t("about.contact.misconfigured")}
          </p>
        )}

        <div className="kx-grid kx-grid-2" data-about-contacts>
          {CONTACT_CHANNELS.map((link) => (
            <article
              className="kx-about-contact"
              data-contact={link.id}
              data-kind={link.kind}
              key={link.id}
            >
              <span className="kx-about-contact-icon" aria-hidden="true">
                <LinkGlyph kind={link.kind} />
              </span>
              <div className="kx-about-contact-body">
                <h3 className="kx-about-contact-title">{t(link.labelKey)}</h3>
                <p className="kx-about-contact-value" data-contact-value={link.id} dir="ltr">
                  {link.display}
                </p>
                {link.kind === "phone" && (
                  <p className="kx-about-contact-local" data-contact-local={link.id} dir="ltr">
                    {t("about.contact.localDial")} {KNOUX_IDENTITY.phoneLocal}
                  </p>
                )}
                <p className="kx-card-sub">{t(link.hintKey)}</p>
              </div>

              <div className="kx-about-contact-actions">
                {COMMUNICATION_KINDS.includes(link.kind) ? (
                  <a
                    className="kx-btn kx-btn-primary kx-btn-sm"
                    data-contact-action={link.id}
                    href={link.href}
                    onClick={(event) => {
                      event.preventDefault();
                      void communicate(link);
                    }}
                  >
                    {t(link.actionKey)}
                  </a>
                ) : (
                  <a
                    className="kx-btn kx-btn-primary kx-btn-sm"
                    data-contact-action={link.id}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t(link.actionKey)}
                    <Icon name="external" size={14} />
                  </a>
                )}
                {link.copyText && (
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm"
                    data-contact-copy={link.id}
                    onClick={() => void copy(link)}
                  >
                    <Icon name="copy" size={14} />
                    {t("about.contact.copy")}
                  </button>
                )}
              </div>

              <p
                className="kx-about-contact-status"
                data-contact-status={link.id}
                aria-live="polite"
                data-tone={feedback[link.id] ? "on" : "idle"}
              >
                {feedback[link.id] ?? ""}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- D — social presence ---------- */}
      <section
        className="kx-about-section"
        data-about-section="social"
        aria-labelledby="about-social-title"
      >
        <header className="kx-about-section-head">
          <p className="kx-eyebrow">
            <span className="kx-status-dot" />
            {t("about.social.eyebrow")}
          </p>
          <h2 className="kx-view-title" id="about-social-title">
            {t("about.social.title")}
          </h2>
          <p className="kx-view-desc">{t("about.social.description")}</p>
        </header>

        <div className="kx-about-social-grid" data-about-social>
          {SOCIAL_PROFILES.map((profile) => (
            <a
              className="kx-about-social"
              data-social={profile.id}
              data-audience={profile.audience}
              data-platform={profile.kind}
              href={profile.href}
              target="_blank"
              rel="noopener noreferrer"
              key={profile.id}
            >
              <span className="kx-about-social-icon" aria-hidden="true">
                <LinkGlyph kind={profile.kind} size={24} />
              </span>
              <span className="kx-about-social-copy">
                <span className="kx-about-social-name">{t(profile.labelKey)}</span>
                <span className="kx-about-social-handle" dir="ltr">
                  {profile.display}
                </span>
                <span className="kx-about-social-hint">{t(profile.hintKey)}</span>
              </span>
              <span className="kx-about-social-meta">
                <span className="kx-about-audience" data-audience={profile.audience}>
                  {t(
                    profile.audience === "company"
                      ? "about.audience.company"
                      : "about.audience.founder",
                  )}
                </span>
                <Icon name="external" size={15} />
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* ---------- E — founder signature ---------- */}
      <section
        className="kx-about-signature"
        data-about-section="signature"
        aria-labelledby="about-signature-title"
      >
        <div className="kx-about-signature-mark" aria-hidden="true">
          {!logoBroken ? (
            <img src={KNOUX_IDENTITY.logoAsset} width={54} height={54} alt="" />
          ) : (
            <span>K</span>
          )}
        </div>
        <div className="kx-about-signature-copy">
          <p className="kx-eyebrow">{t("about.signature.eyebrow")}</p>
          <h2 className="kx-about-signature-title" id="about-signature-title">
            {KNOUX_IDENTITY.founderName}
          </h2>
          <p className="kx-about-signature-sub">
            KNOUX · <span dir="rtl">{KNOUX_IDENTITY.founderNameAr}</span>
          </p>
          <p className="kx-card-sub" data-about-signature-note>
            {t("about.signature.note")}
          </p>
        </div>
        <div className="kx-about-signature-identity" data-about-identity>
          <p className="kx-about-identity-line" data-identity="website" dir="ltr">
            <Icon name="globe" size={14} />
            <a href={KNOUX_IDENTITY.website} target="_blank" rel="noopener noreferrer">
              knoux.store
            </a>
          </p>
          <p className="kx-about-identity-line" data-identity="email" dir="ltr">
            <Icon name="mail" size={14} />
            <a
              href={`mailto:${KNOUX_IDENTITY.email}`}
              onClick={(event) => {
                event.preventDefault();
                const emailLink = CONTACT_CHANNELS.find((link) => link.kind === "email");
                if (emailLink) void communicate(emailLink);
              }}
            >
              {KNOUX_IDENTITY.email}
            </a>
          </p>
          <p className="kx-about-identity-line" data-identity="phone" dir="ltr">
            <Icon name="phone" size={14} />
            <a
              href="tel:+971503281920"
              onClick={(event) => {
                event.preventDefault();
                const phoneLink = CONTACT_CHANNELS.find((link) => link.kind === "phone");
                if (phoneLink) void communicate(phoneLink);
              }}
            >
              {KNOUX_IDENTITY.phoneInternational}
            </a>
          </p>
          <p className="kx-about-identity-line" data-identity="whatsapp" dir="ltr">
            <BrandIcon name="whatsapp" size={14} />
            <a href={KNOUX_IDENTITY.whatsapp} target="_blank" rel="noopener noreferrer">
              {t("about.contact.whatsapp")}
            </a>
          </p>
        </div>
        <p className="kx-about-build" data-about-build>
          {t("about.signature.build")} {APP_VERSION}
        </p>
      </section>
    </div>
  );
}
