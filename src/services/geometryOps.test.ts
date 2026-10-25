import { describe, expect, it } from "vitest";
import {
  createMesh,
  MESH_LIMIT,
  meshDisplacementAt,
  meshEnergy,
  meshReference,
  meshSourcePoint,
  meshVertexPosition,
  meshWarpPixels,
  resetMesh,
  resizeMesh,
  setMeshOffset,
  type MeshGrid,
} from "./geometryOps";
import { meanDifference, type Pixels } from "./imageOps";

/** Left half dark, right half bright: one hard vertical edge at u = 0.5. */
function edgedImage(width = 40, height = 20): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = x < width / 2 ? 20 : 220;
      const at = (y * width + x) * 4;
      data[at] = value;
      data[at + 1] = value;
      data[at + 2] = value;
      data[at + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Every row carries its own brightness, so vertical movement is measurable. */
function rowRamp(width = 20, height = 20): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      data[at] = Math.round((y / (height - 1)) * 255);
      data[at + 1] = data[at];
      data[at + 2] = data[at];
      data[at + 3] = 255;
    }
  }
  return { width, height, data };
}

function levelAt(image: Pixels, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4];
}

/** Column where the edge lands on a given row. */
function edgeColumn(image: Pixels, row: number): number {
  for (let x = 1; x < image.width; x += 1) {
    if (levelAt(image, x, row) > 120 && levelAt(image, x - 1, row) < 120) return x;
  }
  return -1;
}

/** Index of the vertex at the middle of a 3×3 lattice. */
function centreVertex(grid: MeshGrid): number {
  return Math.floor(grid.rows / 2) * grid.columns + Math.floor(grid.columns / 2);
}

describe("mesh lattice", () => {
  it("builds a lattice with one displacement per vertex", () => {
    const grid = createMesh(4, 3);
    expect(grid.columns).toBe(4);
    expect(grid.rows).toBe(3);
    expect(grid.offsets).toHaveLength(12);
    expect(meshEnergy(grid)).toBe(0);
    expect(meshReference(grid, 5)).toEqual({ u: 1 / 3, v: 0.5 });
  });

  it("clamps a vertex to the travel limit and refuses nonsense", () => {
    let grid = createMesh(3, 3);
    grid = setMeshOffset(grid, 4, 9, -9);
    expect(grid.offsets[4]).toEqual({ dx: MESH_LIMIT, dy: -MESH_LIMIT });
    grid = setMeshOffset(grid, 4, Number.NaN, 0.1);
    expect(grid.offsets[4]).toEqual({ dx: 0, dy: 0.1 });
    // An out-of-range index leaves the lattice untouched.
    const untouched = setMeshOffset(grid, 99, 0.4, 0.4);
    expect(untouched.offsets[0]).toEqual({ dx: 0, dy: 0 });
  });

  it("places a vertex at its lattice position plus its drag", () => {
    const grid = setMeshOffset(createMesh(3, 3), 8, 0.2, -0.1);
    expect(meshVertexPosition(grid, 8)).toEqual({ u: 1.2, v: 0.9 });
  });

  it("reads the displacement field with bilinear weights", () => {
    const grid = setMeshOffset(createMesh(2, 2), 0, 0.4, 0);
    // Exactly on the pulled vertex.
    expect(meshDisplacementAt(grid, 0, 0).dx).toBeCloseTo(0.4, 5);
    // Half-way along the top edge the pull has halved.
    expect(meshDisplacementAt(grid, 0.5, 0).dx).toBeCloseTo(0.2, 5);
    // And the field always subtracts, so content follows the grid.
    expect(meshSourcePoint(grid, 0, 0)).toEqual({ u: -0.4, v: 0 });
  });

  it("keeps the corner pulls when the density changes", () => {
    let grid = createMesh(3, 3);
    grid = setMeshOffset(grid, 0, 0.1, 0.2);
    grid = setMeshOffset(grid, 8, -0.3, -0.1);
    const denser = resizeMesh(grid, 5, 5);
    expect(denser.offsets).toHaveLength(25);
    expect(denser.offsets[0]).toEqual({ dx: 0.1, dy: 0.2 });
    expect(denser.offsets[24]).toEqual({ dx: -0.3, dy: -0.1 });
    // Reset puts every vertex back on its intersection.
    expect(meshEnergy(resetMesh(denser))).toBe(0);
  });
});

describe("mesh warp", () => {
  it("is byte-identical when no vertex has moved", () => {
    const source = edgedImage();
    const out = meshWarpPixels(source, createMesh(4, 4));
    expect(Array.from(out.data)).toEqual(Array.from(source.data));
    expect(meanDifference(source, out)).toBe(0);
  });

  it("drags content with the vertex and leaves the far edge alone", () => {
    const source = edgedImage(40, 20);
    const grid = setMeshOffset(createMesh(3, 3), centreVertex(createMesh(3, 3)), 0.2, 0);
    const out = meshWarpPixels(source, grid);

    const middleRow = 10;
    // The top row is one lattice step away from the pulled vertex and the
    // 3×3 field interpolates to nothing on the border rows.
    expect(edgeColumn(out, 0)).toBe(edgeColumn(source, 0));
    const moved = edgeColumn(out, middleRow);
    expect(moved).toBeGreaterThan(edgeColumn(source, middleRow));
    // A 0.2 pull over a 40 px frame is 8 px; bilinear falloff means the edge
    // lands somewhere strictly between the old position and that maximum.
    expect(moved - edgeColumn(source, middleRow)).toBeLessThanOrEqual(8);
    expect(moved - edgeColumn(source, middleRow)).toBeGreaterThan(0);
    expect(out.width).toBe(source.width);
    expect(out.height).toBe(source.height);
  });

  it("moves content vertically when a corner is pulled down", () => {
    const source = rowRamp(20, 20);
    const grid = setMeshOffset(createMesh(3, 3), 3, 0, 0.3);
    const out = meshWarpPixels(source, grid);
    // Row 10 sits on the pulled left-edge vertex: it now shows content from
    // higher up the frame, so the ramp value drops.
    expect(levelAt(out, 0, 10)).toBeLessThan(levelAt(source, 0, 10));
    // The opposite corner never felt the drag.
    expect(levelAt(out, 19, 19)).toBe(levelAt(source, 19, 19));
  });

  it("stretches the border instead of punching a hole", () => {
    const source = edgedImage(20, 20);
    // Pull the whole left column of the lattice outward.
    let grid = createMesh(2, 2);
    grid = setMeshOffset(grid, 0, 0.4, 0);
    grid = setMeshOffset(grid, 2, 0.4, 0);
    const out = meshWarpPixels(source, grid);
    // Sampling asks for x < 0, which clamps to the first column — no alpha hole.
    for (let y = 0; y < out.height; y += 1) {
      expect(out.data[(y * out.width + 0) * 4 + 3]).toBe(255);
    }
    expect(levelAt(out, 0, 10)).toBe(levelAt(source, 0, 10));
  });

  it("coarsens the sample grid while dragging without changing the picture much", () => {
    const source = rowRamp(24, 24);
    let grid = createMesh(3, 3);
    grid = setMeshOffset(grid, centreVertex(grid), 0.15, 0.1);
    const coarse = meshWarpPixels(source, grid, { stride: 4 });
    // Every 4×4 block of a coarse pass holds one sample.
    for (let y = 0; y + 3 < coarse.height; y += 4) {
      for (let x = 0; x + 3 < coarse.width; x += 4) {
        const reference = levelAt(coarse, x, y);
        for (let row = 0; row < 4; row += 1) {
          for (let column = 0; column < 4; column += 1) {
            expect(levelAt(coarse, x + column, y + row)).toBe(reference);
          }
        }
      }
    }
    const fine = meshWarpPixels(source, grid);
    expect(meanDifference(source, fine)).toBeGreaterThan(0);
  });

  it("keeps the alpha channel with its pixels", () => {
    const source = edgedImage(16, 16);
    for (let i = 3; i < source.data.length; i += 4) source.data[i] = 128;
    const grid = setMeshOffset(createMesh(3, 3), centreVertex(createMesh(3, 3)), 0.2, 0);
    const out = meshWarpPixels(source, grid);
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(128);
  });
});
