import { describe, expect, it } from "vitest";
import { settledWithin } from "./mediaFlush";

describe("settledWithin", () => {
  it("reports a session that flushed in time", async () => {
    const chunks: number[] = [];
    const work = new Promise<void>((resolve) => {
      window.setTimeout(() => {
        chunks.push(1);
        resolve();
      }, 10);
    });
    expect(await settledWithin(work, 1000)).toBe(true);
    expect(chunks).toEqual([1]);
  });

  it("gives up on a session that never fires, without hanging", async () => {
    const never = new Promise<void>(() => undefined);
    const started = performance.now();
    expect(await settledWithin(never, 40)).toBe(false);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("counts an errored encoder as settled", async () => {
    // A recorder that failed is finished; the caller judges the bytes it has.
    // Swallowing here is also what keeps the rejected promise from surfacing as
    // an unhandled rejection later in the run.
    const failed = Promise.reject(new Error("The WebM encoder failed."));
    expect(await settledWithin(failed, 1000)).toBe(true);
  });

  it("does not resolve early just because the work resolved synchronously", async () => {
    expect(await settledWithin(Promise.resolve(), 1000)).toBe(true);
  });
});
