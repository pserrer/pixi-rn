/** Anything with a `warmOne()` step — `SoundPool` and `LoopSound` both
 *  qualify structurally, no explicit implements needed. */
export interface WarmablePool {
  warmOne(): boolean;
}

/**
 * Pre-warms a set of pools one native player at a time, round-robin, spread
 * across `intervalMs` timer steps instead of constructing every player in
 * one synchronous burst. `createAudioPlayer()` blocks the JS thread for
 * tens of ms per call on Android, so this is meant to run somewhere that
 * cost is invisible (a title/menu screen), well before any pool's first
 * real `play()`.
 *
 * @returns A cleanup function that cancels the in-flight timer — call it on
 *   unmount, before the pools themselves are destroyed.
 */
export function warmPools(pools: readonly WarmablePool[], intervalMs = 50): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const step = () => {
    const more = pools.some((pool) => pool.warmOne());
    timer = more ? setTimeout(step, intervalMs) : null;
  };
  timer = setTimeout(step, intervalMs);
  return () => {
    if (timer !== null) clearTimeout(timer);
  };
}
