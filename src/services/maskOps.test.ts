import { describe, expect, it } from "vitest";
import {
  distanceToSegment,
  findRegionAt,
  maskCentroid,
  pathLength,
  pointInPolygon,
  polygonArea,
  rectFromPoints,
  rectRegionPoints,
  regionBounds,
  scaleRegion,
  translateRegion,
} from "./maskOps";

describe("selection geometry", () => {
  it("normalises a rectangle dragged in any direction", () => {
    expect(rectFromPoints({ x: 120, y: 90 }, { x: 20, y: 10 })).toEqual({
      x: 20,
      y: 10,
      width: 100,
      height: 80,
    });
    expect(rectFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });

  it("walks a rectangle into a closed polygon", () => {
    const points = rectRegionPoints({ x: 10, y: 20, width: 30, height: 40 });
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual({ x: 10, y: 20 });
    expect(points[2]).toEqual({ x: 40, y: 60 });
    expect(polygonArea(points)).toBe(1200);
  });

  it("reports bounds and centroid of any mask", () => {
    const points = [
      { x: 10, y: 40 },
      { x: 50, y: 20 },
      { x: 40, y: 70 },
    ];
    expect(regionBounds(points)).toEqual({ x: 10, y: 20, width: 40, height: 50 });
    expect(maskCentroid(points)).toEqual({ x: 100 / 3, y: 130 / 3 });
    expect(regionBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("tests a point inside a triangle without being fooled by its edges", () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(pointInPolygon(triangle, 10, 10)).toBe(true);
    expect(pointInPolygon(triangle, 60, 60)).toBe(false);
    expect(pointInPolygon(triangle, -1, 10)).toBe(false);
    // Fewer than three points cannot enclose anything.
    expect(pointInPolygon([{ x: 0, y: 0 }, { x: 10, y: 10 }], 5, 5)).toBe(false);
  });

  it("grows and shrinks a mask about its own centre", () => {
    const square = rectRegionPoints({ x: 10, y: 10, width: 20, height: 20 });
    const grown = scaleRegion(square, 1.5);
    expect(regionBounds(grown)).toEqual({ x: 5, y: 5, width: 30, height: 30 });
    expect(maskCentroid(grown)).toEqual(maskCentroid(square));
    const shrunk = scaleRegion(square, 0.5);
    expect(regionBounds(shrunk)).toEqual({ x: 15, y: 15, width: 10, height: 10 });
    // A nonsense factor must not destroy the mask.
    expect(scaleRegion(square, 0)).toEqual(square);
  });

  it("moves a mask without changing its shape", () => {
    const square = rectRegionPoints({ x: 0, y: 0, width: 10, height: 10 });
    const moved = translateRegion(square, 5, -5);
    expect(regionBounds(moved)).toEqual({ x: 5, y: -5, width: 10, height: 10 });
    expect(polygonArea(moved)).toBe(polygonArea(square));
  });

  it("measures a painted stroke in pixels", () => {
    expect(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 14 }])).toBe(15);
    expect(pathLength([{ x: 2, y: 2 }])).toBe(0);
  });

  it("picks the region under a click, newest first", () => {
    const regions = [
      { id: "rect", kind: "rect" as const, points: rectRegionPoints({ x: 0, y: 0, width: 50, height: 50 }) },
      { id: "stroke", kind: "stroke" as const, brushSize: 20, points: [{ x: 100, y: 100 }, { x: 140, y: 100 }] },
    ];
    expect(findRegionAt(regions, 10, 10)).toBe("rect");
    expect(findRegionAt(regions, 120, 105)).toBe("stroke");
    expect(findRegionAt(regions, 300, 300)).toBeNull();

    const stacked = [
      ...regions,
      { id: "top", kind: "rect" as const, points: rectRegionPoints({ x: 0, y: 0, width: 20, height: 20 }) },
    ];
    expect(findRegionAt(stacked, 5, 5)).toBe("top");
  });

  it("gives a stroke a usable click target even when it is thin", () => {
    const thin = [
      { id: "thin", kind: "stroke" as const, brushSize: 2, points: [{ x: 50, y: 50 }, { x: 90, y: 50 }] },
    ];
    expect(findRegionAt(thin, 70, 52)).toBe("thin");
    expect(findRegionAt(thin, 70, 80)).toBeNull();
  });

  it("measures the distance to the segment, not just to its ends", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 10, y: 0 };
    expect(distanceToSegment({ x: 5, y: 4 }, start, end)).toBeCloseTo(4, 6);
    expect(distanceToSegment({ x: 5, y: 0 }, start, end)).toBe(0);
    // Past the end the nearest point is the endpoint itself.
    expect(distanceToSegment({ x: 14, y: 3 }, start, end)).toBeCloseTo(5, 6);
    // A degenerate segment is a point.
    expect(distanceToSegment({ x: 3, y: 4 }, start, start)).toBe(5);
  });
});
