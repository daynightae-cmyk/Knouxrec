/**
 * KNOUX REC — selection and mask geometry.
 *
 * The Visual Patch lab paints regions and hands them to a tool. Whether a
 * region is a freehand stroke or a rectangle dragged on the canvas, the mask
 * has to be answerable as data: where its bounds are, whether a point falls
 * inside it, and what growing or shrinking it means. All of that lives here as
 * pure functions, so the overlay and the tool runner agree by construction.
 */

export type MaskPoint = { x: number; y: number };

export type MaskBounds = { x: number; y: number; width: number; height: number };

/** A selection dragged in any direction, normalised to a positive rectangle. */
export function rectFromPoints(a: MaskPoint, b: MaskPoint): MaskBounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Clockwise corner walk of a rectangle, so the mask closes into a polygon. */
export function rectRegionPoints(rect: MaskBounds): MaskPoint[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

export function regionBounds(points: MaskPoint[]): MaskBounds {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function maskCentroid(points: MaskPoint[]): MaskPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce(
    (total, point) => ({ x: total.x + point.x, y: total.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** Even-odd hit test, which is what a painted mask looks like from above. */
export function pointInPolygon(points: MaskPoint[], x: number, y: number): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    const straddles = a.y > y !== b.y > y;
    if (straddles && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-12) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Signed area; the sign says which way the mask was wound. */
export function polygonArea(points: MaskPoint[]): number {
  if (points.length < 3) return 0;
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    total += current.x * next.y - next.x * current.y;
  }
  return total / 2;
}

/** Grows (factor > 1) or shrinks a mask about its centroid. */
export function scaleRegion(points: MaskPoint[], factor: number): MaskPoint[] {
  if (!Number.isFinite(factor) || factor <= 0) return points.map((point) => ({ ...point }));
  const centre = maskCentroid(points);
  return points.map((point) => ({
    x: centre.x + (point.x - centre.x) * factor,
    y: centre.y + (point.y - centre.y) * factor,
  }));
}

export function translateRegion(points: MaskPoint[], dx: number, dy: number): MaskPoint[] {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

/** Total length of a painted stroke, in image pixels. */
export function pathLength(points: MaskPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return total;
}

/** Perpendicular distance from a point to a line segment. */
export function distanceToSegment(
  point: MaskPoint,
  start: MaskPoint,
  end: MaskPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/**
 * Which painted region a click belongs to. Rectangles are tested as filled
 * polygons; strokes are tested against the polyline with their brush width,
 * because a click on a thin stroke should still select the brush that drew it.
 */
export function findRegionAt(
  regions: Array<{ id: string; points: MaskPoint[]; kind?: "stroke" | "rect"; brushSize?: number }>,
  x: number,
  y: number,
): string | null {
  const probe = { x, y };
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    const region = regions[index];
    if (region.kind === "rect") {
      if (pointInPolygon(region.points, x, y)) return region.id;
      continue;
    }
    const reach = Math.max(6, (region.brushSize ?? 12) / 2);
    const points = region.points;
    if (points.length === 1) {
      if (Math.hypot(points[0].x - x, points[0].y - y) <= reach) return region.id;
      continue;
    }
    for (let segment = 1; segment < points.length; segment += 1) {
      if (distanceToSegment(probe, points[segment - 1], points[segment]) <= reach) {
        return region.id;
      }
    }
  }
  return null;
}
