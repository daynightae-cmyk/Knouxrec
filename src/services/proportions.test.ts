import { describe, expect, it } from "vitest";
import {
  CANON_HEADS,
  clampPosition,
  DEFAULT_GUIDES,
  findGuide,
  guideRows,
  measureProportions,
  measurementText,
  moveGuide,
  orderedHorizontals,
  canonGuides,
} from "./proportions";

describe("proportion mirror", () => {
  it("measures the guides the user placed, in pixels", () => {
    const report = measureProportions(DEFAULT_GUIDES, 1000, 2000);
    expect(report.heightPx).toBeCloseTo(960, 5);
    expect(report.headPx).toBeCloseTo(240, 5);
    expect(report.widthPx).toBeCloseTo(360, 5);
    expect(report.headsTall).toBeCloseTo(4, 5);
    expect(report.widthPerHead).toBeCloseTo(1.5, 5);
    expect(report.canonHeads).toBeCloseTo(4, 5);
  });

  it("says nothing rather than infinity when the frame is degenerate", () => {
    const squashed = moveGuide(moveGuide(DEFAULT_GUIDES, "chin", 0.08), "hip", 0.08);
    const report = measureProportions(squashed, 500, 500);
    expect(report.headPx).toBe(0);
    expect(report.headsTall).toBeNull();
    expect(report.widthPerHead).toBeNull();
  });

  it("places the canon lines from the crown and hip the user chose", () => {
    const anchored = moveGuide(moveGuide(DEFAULT_GUIDES, "crown", 0.1), "hip", 0.9);
    const snapped = canonGuides(anchored);
    const head = 0.8 / 4;
    expect(findGuide(snapped, "chin")?.position).toBeCloseTo(0.1 + head * CANON_HEADS.chin, 6);
    expect(findGuide(snapped, "shoulder")?.position).toBeCloseTo(
      0.1 + head * CANON_HEADS.shoulder,
      6,
    );
    expect(findGuide(snapped, "waist")?.position).toBeCloseTo(0.1 + head * CANON_HEADS.waist, 6);
    // Crown and hip are anchors and must not move.
    expect(findGuide(snapped, "hip")?.position).toBeCloseTo(0.9, 6);
    expect(findGuide(snapped, "crown")?.position).toBeCloseTo(0.1, 6);
    // Snapping twice changes nothing.
    expect(canonGuides(snapped)).toEqual(snapped);
  });

  it("refuses to snap a span that is too small to read", () => {
    const collapsed = moveGuide(DEFAULT_GUIDES, "hip", 0.08);
    expect(canonGuides(collapsed)).toBe(collapsed);
  });

  it("clamps guide positions and leaves the other guides alone", () => {
    expect(clampPosition(-2)).toBe(0);
    expect(clampPosition(7)).toBe(1);
    expect(clampPosition(Number.NaN)).toBe(0);
    const moved = moveGuide(DEFAULT_GUIDES, "waist", 1.4);
    expect(findGuide(moved, "waist")?.position).toBe(1);
    expect(findGuide(moved, "chin")?.position).toBe(findGuide(DEFAULT_GUIDES, "chin")?.position);
  });

  it("orders the horizontal guides top to bottom and measures the gaps", () => {
    const shuffled = [
      ...DEFAULT_GUIDES.filter((guide) => guide.axis === "vertical"),
      findGuide(DEFAULT_GUIDES, "hip")!,
      findGuide(DEFAULT_GUIDES, "crown")!,
      findGuide(DEFAULT_GUIDES, "chin")!,
      findGuide(DEFAULT_GUIDES, "waist")!,
      findGuide(DEFAULT_GUIDES, "shoulder")!,
    ];
    const ordered = orderedHorizontals(shuffled);
    expect(ordered.map((guide) => guide.id)).toEqual([
      "crown",
      "chin",
      "shoulder",
      "waist",
      "hip",
    ]);
    const rows = guideRows(shuffled);
    expect(rows[0].fromPreviousPct).toBeNull();
    expect(rows[1].fromPreviousPct).toBeCloseTo(12, 5);
    expect(rows[2].fromPreviousPct).toBeCloseTo(10, 5);
  });

  it("writes a plain-text report that names every measurement", () => {
    const report = measureProportions(DEFAULT_GUIDES, 1000, 2000);
    const text = measurementText(DEFAULT_GUIDES, report, (key) => key);
    expect(text).toContain("body.measure.height: 960 px");
    expect(text).toContain("body.measure.heads: 4.00");
    expect(text).toContain("body.guide.crown");
    expect(text.split("\n")).toHaveLength(11);
  });
});
