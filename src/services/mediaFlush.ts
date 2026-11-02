/**
 * Bounded wait for a MediaRecorder session to flush.
 *
 * `recorder.stop()` is not instantaneous. The encoder still has to deliver its
 * remaining timeslices through `dataavailable`, and only then does `onstop`
 * fire. Code that releases the underlying `MediaStream` tracks first cuts that
 * flush short — and the loss is invisible on an idle machine. It shows up only
 * under load, as "34 frames painted, 0 chunks", or as a two-second clip written
 * out at 0.069 s.
 *
 * Every encoder in this app waits through here before stopping its tracks.
 * The bound exists because a recorder that never fires `onstop` would otherwise
 * hold the job open forever; `false` means "still nothing after the grace", and
 * the caller decides whether the bytes it has are usable.
 *
 * A rejection counts as settled: an encoder that errored is finished, and its
 * caller diagnoses the emptiness from the produced bytes, which is more precise
 * than the generic error the recorder would have reported.
 */
export async function settledWithin(
  work: Promise<unknown>,
  graceMs: number,
): Promise<boolean> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      work.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => {
        timer = window.setTimeout(() => resolve(false), graceMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}
