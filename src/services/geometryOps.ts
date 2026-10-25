/**
 * KNOUX REC — MorphCore geometry operations.
 *
 * Pure functions over raw RGBA bytes, so a deformation can be unit tested in
 * Node without a canvas and the pixels the user sees on screen are exactly the
 * pixels that get baked, saved and exported. Only the Mesh warp lives here;
 * the rest of the geometry studio keeps its existing canvas path.
 *
 * Sign convention, stated once because it decides how the tool feels: a mesh
 * vertex records where the user *dragged the image to*, in destination space.
 * Sampling therefore subtracts the interpolated displacement, which makes the
 * content follow the grid instead of sliding against it.
 */

import { sampleBilinear, type Pixels } from "./imageOps";

export type MeshOffset = { dx: number; dy: number };

export type MeshGrid = {
  /** Vertices across the lattice, always at least two. */
  columns: number;
  /** Vertices down the lattice, always at least two. */
  rows: number;
  /** Row-major displacement per vertex, in normalised units (-0.5 … 0.5). */
  offsets: MeshOffset[];
};

/** How far a vertex may travel from its lattice position. */
export const MESH_LIMIT = 0.5;

const clampDisplacement = (value: number) =>
  Math.max(-MESH_LIMIT, Math.min(MESH_LIMIT, Number.isFinite(value) ? value : 0));

export function createMesh(columns: number, rows: number): MeshGrid {
  const cols = Math.max(2, Math.round(columns));
  const count = Math.max(2, Math.round(rows));
  return {
    columns: cols,
    rows: count,
    offsets: Array.from({ length: cols * count }, () => ({ dx: 0, dy: 0 })),
  };
}

/** Every vertex back on its lattice intersection. */
export function resetMesh(grid: MeshGrid): MeshGrid {
  return {
    columns: grid.columns,
    rows: grid.rows,
    offsets: grid.offsets.map(() => ({ dx: 0, dy: 0 })),
  };
}

/** The lattice position a vertex would occupy with no displacement. */
export function meshReference(grid: MeshGrid, index: number): { u: number; v: number } {
  const column = index % grid.columns;
  const row = Math.floor(index / grid.columns);
  return {
    u: column / (grid.columns - 1),
    v: row / (grid.rows - 1),
  };
}

/** Where a vertex currently sits on the canvas, in normalised coordinates. */
export function meshVertexPosition(grid: MeshGrid, index: number): { u: number; v: number } {
  const reference = meshReference(grid, index);
  const offset = grid.offsets[index] ?? { dx: 0, dy: 0 };
  return { u: reference.u + offset.dx, v: reference.v + offset.dy };
}

export function setMeshOffset(grid: MeshGrid, index: number, dx: number, dy: number): MeshGrid {
  if (index < 0 || index >= grid.offsets.length) return grid;
  const offsets = grid.offsets.map((entry, position) =>
    position === index ? { dx: clampDisplacement(dx), dy: clampDisplacement(dy) } : entry,
  );
  return { columns: grid.columns, rows: grid.rows, offsets };
}

/**
 * Grow or shrink the lattice without disturbing the vertices that survive.
 * Corner work is what a mesh is for, so the extreme vertices keep their
 * displacement when the density changes; interior points are re-laid out.
 */
export function resizeMesh(grid: MeshGrid, columns: number, rows: number): MeshGrid {
  const cols = Math.max(2, Math.round(columns));
  const count = Math.max(2, Math.round(rows));
  if (cols === grid.columns && count === grid.rows) return grid;
  const next = createMesh(cols, count);
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      const edgeRow = row === 0 || row === count - 1;
      const edgeColumn = column === 0 || column === cols - 1;
      if (!edgeRow || !edgeColumn) continue;
      const sourceIndex = Math.round((row / (count - 1)) * (grid.rows - 1)) * grid.columns +
        Math.round((column / (cols - 1)) * (grid.columns - 1));
      const source = grid.offsets[Math.min(grid.offsets.length - 1, Math.max(0, sourceIndex))];
      if (source) next.offsets[row * cols + column] = { ...source };
    }
  }
  return next;
}

/**
 * The displacement field of the lattice read with bilinear weights inside the
 * cell that contains a point. Inside a cell the field is continuous, so the
 * warp cannot tear; outside the lattice the nearest edge cell holds.
 */
export function meshDisplacementAt(grid: MeshGrid, u: number, v: number): MeshOffset {
  const cols = Math.max(2, grid.columns);
  const count = Math.max(2, grid.rows);
  const fx = Math.max(0, Math.min(1, u)) * (cols - 1);
  const fy = Math.max(0, Math.min(1, v)) * (count - 1);
  const cx = Math.min(cols - 2, Math.floor(fx));
  const cy = Math.min(count - 2, Math.floor(fy));
  const tx = fx - cx;
  const ty = fy - cy;
  const at = (row: number, column: number) =>
    grid.offsets[row * cols + column] ?? { dx: 0, dy: 0 };
  const top = at(cy, cx).dx * (1 - tx) + at(cy, cx + 1).dx * tx;
  const bottom = at(cy + 1, cx).dx * (1 - tx) + at(cy + 1, cx + 1).dx * tx;
  const topY = at(cy, cx).dy * (1 - tx) + at(cy, cx + 1).dy * tx;
  const bottomY = at(cy + 1, cx).dy * (1 - tx) + at(cy + 1, cx + 1).dy * tx;
  return { dx: top * (1 - ty) + bottom * ty, dy: topY * (1 - ty) + bottomY * ty };
}

/**
 * Which source point lands on a destination point. The displacement is
 * subtracted because the recorded number describes where content moved to.
 */
export function meshSourcePoint(grid: MeshGrid, u: number, v: number): { u: number; v: number } {
  const field = meshDisplacementAt(grid, u, v);
  return { u: u - field.dx, v: v - field.dy };
}

/** Total movement of the lattice — the panel reports it as a single number. */
export function meshEnergy(grid: MeshGrid): number {
  return grid.offsets.reduce(
    (sum, entry) => sum + Math.hypot(entry.dx, entry.dy),
    0,
  );
}

/**
 * Warp an image through the mesh. A stride above one fills blocks of
 * stride×stride pixels from a single sample, which is what the studio uses
 * while a vertex is being dragged; releasing runs it at stride one, and every
 * bake, save and export always uses stride one.
 */
export function meshWarpPixels(
  source: Pixels,
  grid: MeshGrid,
  options: { stride?: number } = {},
): Pixels {
  const stride = Math.max(1, Math.round(options.stride ?? 1));
  const { width, height, data } = source;
  const out = new Uint8ClampedArray(data.length);
  const identity = grid.offsets.every((entry) => entry.dx === 0 && entry.dy === 0);
  if (identity && stride === 1) {
    out.set(data);
    return { width, height, data: out };
  }
  for (let y = 0; y < height; y += stride) {
    const v = height > 1 ? y / (height - 1) : 0;
    for (let x = 0; x < width; x += stride) {
      const u = width > 1 ? x / (width - 1) : 0;
      const sample = meshSourcePoint(grid, u, v);
      // sampleBilinear clamps to the edge, so pulling a vertex outside the
      // frame stretches border pixels instead of leaving a hole.
      const value = sampleBilinear(source, sample.u * (width - 1), sample.v * (height - 1));
      for (let blockY = 0; blockY < stride; blockY += 1) {
        const py = y + blockY;
        if (py >= height) break;
        for (let blockX = 0; blockX < stride; blockX += 1) {
          const px = x + blockX;
          if (px >= width) break;
          const at = (py * width + px) * 4;
          out[at] = value[0];
          out[at + 1] = value[1];
          out[at + 2] = value[2];
          out[at + 3] = value[3];
        }
      }
    }
  }
  return { width, height, data: out };
}
