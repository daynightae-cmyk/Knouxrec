/**
 * KNOUX REC — manual proportion mirror.
 *
 * A photograph is measured against guides the user places themselves. Nothing
 * here recognises a body: it reads the lines on the screen and does arithmetic
 * on them. That is the whole honest claim of the Body Editor screen, and it is
 * why the numbers are named after the guides rather than after anatomy.
 *
 * The one reference that does come from anatomy is the artist's canon — the
 * seven-and-a-half-head figure — and it is offered as a placement shortcut
 * with its source stated, never as a verdict on the person in the picture.
 */

export type GuideAxis = "horizontal" | "vertical";

export type Guide = {
  id: string;
  axis: GuideAxis;
  /** Normalised 0…1 position on the image: y for horizontal, x for vertical. */
  position: number;
  /** Left/right pairs share a band id so a width can be measured between them. */
  band?: "width";
};

export const HORIZONTAL_ORDER = ["crown", "chin", "shoulder", "waist", "hip"] as const;
export type HorizontalGuideId = (typeof HORIZONTAL_ORDER)[number];

export const DEFAULT_GUIDES: Guide[] = [
  { id: "crown", axis: "horizontal", position: 0.08 },
  { id: "chin", axis: "horizontal", position: 0.2 },
  { id: "shoulder", axis: "horizontal", position: 0.3 },
  { id: "waist", axis: "horizontal", position: 0.46 },
  { id: "hip", axis: "horizontal", position: 0.56 },
  { id: "left", axis: "vertical", position: 0.32, band: "width" },
  { id: "right", axis: "vertical", position: 0.68, band: "width" },
];

/**
 * The classic artist's canon, in heads measured from the crown:
 * chin 1, shoulder 1.5, navel (waist) 3, crotch (hip) 4. A figure to the
 * crown–hip span is therefore four heads, not the 7.5 of a full standing
 * figure — the screen states the span it actually measured.
 */
export const CANON_HEADS = {
  chin: 1,
  shoulder: 1.5,
  waist: 3,
  hip: 4,
} as const;

export const CANON_SPAN_HEADS = CANON_HEADS.hip;

export function clampPosition(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function findGuide(guides: Guide[], id: string): Guide | undefined {
  return guides.find((guide) => guide.id === id);
}

export function moveGuide(guides: Guide[], id: string, position: number): Guide[] {
  return guides.map((guide) =>
    guide.id === id ? { ...guide, position: clampPosition(position) } : guide,
  );
}

/** Horizontal guides in vertical order, so "above" and "below" always mean it. */
export function orderedHorizontals(guides: Guide[]): Guide[] {
  return guides
    .filter((guide) => guide.axis === "horizontal")
    .sort((a, b) => a.position - b.position);
}

export type ProportionReport = {
  /** Crown → hip, in image pixels. */
  heightPx: number;
  /** Crown → chin, in image pixels. */
  headPx: number;
  /** The left/right guides' separation, in image pixels. */
  widthPx: number;
  /** Crown → hip expressed in head lengths of the measured head. */
  headsTall: number | null;
  /** Measured width per measured head. */
  widthPerHead: number | null;
  crownToChin: number;
  chinToHip: number;
  shoulderLinePx: number;
  /** Canon reference for the same span, with its source named. */
  canonHeads: number;
};

/**
 * Read the guides on a canvas of the given pixel size. A degenerate guide
 * arrangement produces nulls rather than infinities: a report that cannot be
 * trusted must say so.
 */
export function measureProportions(
  guides: Guide[],
  width: number,
  height: number,
): ProportionReport {
  const crown = findGuide(guides, "crown")?.position ?? 0;
  const chin = findGuide(guides, "chin")?.position ?? 0;
  const hip = findGuide(guides, "hip")?.position ?? 0;
  const shoulder = findGuide(guides, "shoulder")?.position ?? 0;
  const left = findGuide(guides, "left")?.position ?? 0;
  const right = findGuide(guides, "right")?.position ?? 0;

  const heightPx = Math.abs(hip - crown) * height;
  const headPx = Math.abs(chin - crown) * height;
  const widthPx = Math.abs(right - left) * width;
  const chinToHip = Math.abs(hip - chin) * height;
  const crownToChin = headPx;
  const shoulderLinePx = Math.abs(shoulder - crown) * height;

  return {
    heightPx,
    headPx,
    widthPx,
    headsTall: headPx > 1 ? heightPx / headPx : null,
    widthPerHead: headPx > 1 ? widthPx / headPx : null,
    crownToChin,
    chinToHip,
    shoulderLinePx,
    canonHeads: CANON_SPAN_HEADS,
  };
}

/**
 * Place chin, shoulder and waist so the crown–hip span reads as the canon.
 * Crown and hip are the anchors the user chose; the derived lines are a
 * starting point they can move again immediately.
 */
export function canonGuides(guides: Guide[]): Guide[] {
  const crown = findGuide(guides, "crown")?.position ?? 0;
  const hip = findGuide(guides, "hip")?.position ?? 0;
  const top = Math.min(crown, hip);
  const span = Math.abs(hip - crown);
  if (span <= 0.01) return guides;
  const head = span / CANON_SPAN_HEADS;
  const place = (heads: number) =>
    clampPosition(top + head * heads);
  return guides.map((guide) => {
    if (guide.id === "chin") return { ...guide, position: place(CANON_HEADS.chin) };
    if (guide.id === "shoulder") return { ...guide, position: place(CANON_HEADS.shoulder) };
    if (guide.id === "waist") return { ...guide, position: place(CANON_HEADS.waist) };
    return guide;
  });
}

/**
 * Horizontal guides sorted top to bottom with the gap to the line above, in
 * percentage points of the frame, for a readout that never jumps around.
 */
export function guideRows(
  guides: Guide[],
): Array<{ guide: Guide; fromPreviousPct: number | null }> {
  const ordered = orderedHorizontals(guides);
  return ordered.map((guide, index) => ({
    guide,
    fromPreviousPct:
      index === 0
        ? null
        : Math.round((guide.position - ordered[index - 1].position) * 1000) / 10,
  }));
}

/** One line of plain text per measurement, for the copy button. */
export function measurementText(
  guides: Guide[],
  report: ProportionReport,
  label: (key: string) => string,
): string {
  const rows = [
    `${label("body.measure.height")}: ${Math.round(report.heightPx)} px`,
    `${label("body.measure.head")}: ${Math.round(report.headPx)} px`,
    `${label("body.measure.width")}: ${Math.round(report.widthPx)} px`,
    `${label("body.measure.heads")}: ${report.headsTall === null ? "—" : report.headsTall.toFixed(2)}`,
    `${label("body.measure.perHead")}: ${report.widthPerHead === null ? "—" : report.widthPerHead.toFixed(2)}`,
    `${label("body.measure.canon")}: ${report.canonHeads.toFixed(2)}`,
  ];
  for (const { guide, fromPreviousPct } of guideRows(guides)) {
    const position = `${(guide.position * 100).toFixed(1)}%`;
    rows.push(
      `${label(`body.guide.${guide.id}`)}: ${position}` +
        (fromPreviousPct === null ? "" : ` (+${fromPreviousPct})`),
    );
  }
  return rows.join("\n");
}
