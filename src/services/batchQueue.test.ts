import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  BatchCancelledError,
  centredCrop,
  runPool,
  type BatchItem,
  type PoolOptions,
} from "./batchQueue";

interface FakeItem {
  id: string;
}

function tracker() {
  let inFlight = 0;
  let maxInFlight = 0;
  const started: string[] = [];
  return {
    started,
    get maxInFlight() {
      return maxInFlight;
    },
    async run(id: string, ms: number) {
      started.push(id);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, ms));
      inFlight -= 1;
    },
  };
}

function options(overrides: Partial<PoolOptions> = {}): PoolOptions {
  return {
    concurrency: 2,
    isCancelled: () => false,
    onItem: () => undefined,
    ...overrides,
  };
}

const items = (count: number): FakeItem[] =>
  Array.from({ length: count }, (_, index) => ({ id: `item-${index}` }));

describe("bounded worker pool", () => {
  it("never runs more than the configured concurrency", async () => {
    const state = tracker();
    const report = await runPool(items(9), async (item) => state.run(item.id, 8), options({ concurrency: 3 }));
    expect(report.done).toBe(9);
    expect(report.failed).toBe(0);
    expect(state.maxInFlight).toBeLessThanOrEqual(3);
    expect(state.started.length).toBe(9);
  });

  it("still processes everything when one item fails", async () => {
    const state = tracker();
    const failures: string[] = [];
    const report = await runPool(
      items(5),
      async (item) => {
        await state.run(item.id, 2);
        if (item.id === "item-2") throw new Error("poisoned file");
      },
      options({
        concurrency: 2,
        onItem: (id, patch) => {
          if (patch.status === "failed") failures.push(id);
        },
      }),
    );
    expect(report.done).toBe(4);
    expect(report.failed).toBe(1);
    expect(failures).toEqual(["item-2"]);
    expect(state.started.length).toBe(5);
  });

  it("stops starting work once cancelled and reports the rest", async () => {
    const state = tracker();
    let cancelled = false;
    const report = await runPool(
      items(12),
      async (item) => {
        if (cancelled) throw new BatchCancelledError();
        await state.run(item.id, 4);
        if (state.started.length >= 3) cancelled = true;
      },
      options({ concurrency: 1, isCancelled: () => cancelled }),
    );
    expect(state.started.length).toBeLessThanOrEqual(4);
    expect(report.cancelled).toBeGreaterThan(0);
    expect(report.done + report.failed + report.cancelled).toBe(report.total);
  });

  it("handles an empty queue without spawning workers", async () => {
    const report = await runPool([], async () => undefined, options({ concurrency: 4 }));
    expect(report).toEqual({ done: 0, failed: 0, cancelled: 0, total: 0 });
  });

  it("clamps the pool width to the number of items", async () => {
    const state = tracker();
    await runPool(items(2), async (item) => state.run(item.id, 2), options({ concurrency: 8 }));
    expect(state.maxInFlight).toBeLessThanOrEqual(2);
  });

  it("reports a cancellation as cancelled rather than failed", async () => {
    const statuses: Array<string | undefined> = [];
    await runPool(
      items(1),
      async () => {
        throw new BatchCancelledError();
      },
      options({ concurrency: 1, onItem: (_id, patch) => statuses.push(patch.status) }),
    );
    expect(statuses).toEqual(["cancelled"]);
  });
});

describe("crop presets", () => {
  it("takes a centred square out of a landscape image", () => {
    const box = centredCrop(1200, 800, 1);
    expect(box).toEqual({ x: 200, y: 0, width: 800, height: 800 });
  });

  it("takes a centred 16:9 band out of a portrait image", () => {
    const box = centredCrop(800, 1200, 16 / 9);
    expect(box.x).toBe(0);
    expect(box.width).toBe(800);
    expect(box.height).toBe(450);
    expect(box.y).toBe((1200 - 450) / 2);
  });

  it("never returns a box larger than the source", () => {
    const box = centredCrop(100, 100, 0.25);
    expect(box.width).toBeLessThanOrEqual(100);
    expect(box.height).toBeLessThanOrEqual(100);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(100);
    expect(box.y + box.height).toBeLessThanOrEqual(100);
  });

  it("keeps an image that already matches the aspect", () => {
    expect(centredCrop(1920, 1080, 16 / 9)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});

describe("batch defaults", () => {
  it("starts on a real processor with sane bounds", () => {
    expect(DEFAULT_SETTINGS.operation).toBe("resize");
    expect(DEFAULT_SETTINGS.width).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.quality).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.quality).toBeLessThanOrEqual(100);
  });

  it("describes a queue item shape the view can render", () => {
    const item: BatchItem = {
      id: "x",
      name: "x.png",
      inputBytes: 10,
      mimeType: "image/png",
      status: "queued",
      progress: 0,
      error: null,
      ms: 0,
      output: null,
      blob: new Blob(["0123456789"], { type: "image/png" }),
    };
    expect(item.status).toBe("queued");
    expect(item.blob.size).toBe(10);
  });
});
