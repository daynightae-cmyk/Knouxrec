/**
 * The KNOUX REC wordmark.
 *
 * The reference artwork uses a wide, geometric, squared-off capital with a
 * hard yellow accent on "REC". It is reproduced with the bundled display
 * face (Orbitron) rather than as a bitmap so the lockup stays crisp at every
 * DPI, scales with the sidebar, and survives a theme switch without a second
 * asset.
 */
export function BrandWordmark({
  size = "md",
  tagline,
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  tagline?: string;
  className?: string;
}) {
  return (
    <span className={`kx-wordmark kx-wordmark-${size} ${className}`.trim()}>
      <span className="kx-wordmark-name">
        KNOUX<em>REC</em>
      </span>
      {tagline !== undefined && (
        <span className="kx-wordmark-tagline">
          <span className="kx-wordmark-rule" aria-hidden="true" />
          <span>{tagline}</span>
          <span className="kx-wordmark-rule" aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

/**
 * The decorative frame of the approved brand artwork: corner brackets and a
 * radial reticle. It is decorative only, so it is hidden from assistive
 * technology and disabled when the user asked for reduced motion.
 */
export function BrandFrame({ className = "" }: { className?: string }) {
  return (
    <span className={`kx-brand-frame ${className}`.trim()} aria-hidden="true">
      <span className="kx-brand-corner kx-brand-corner-tl" />
      <span className="kx-brand-corner kx-brand-corner-tr" />
      <span className="kx-brand-corner kx-brand-corner-bl" />
      <span className="kx-brand-corner kx-brand-corner-br" />
      <span className="kx-brand-reticle" />
    </span>
  );
}

export default BrandWordmark;
