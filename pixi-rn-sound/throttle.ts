/**
 * Wrap a callback so calls within `minGapMs` of the last one that actually
 * ran are dropped.
 *
 * ```ts
 * const playCoin = throttle(() => coin.play(), 90);
 * // a dense burst of pickups still plays at most one chirp every 90ms
 * for (const c of collected) playCoin();
 * ```
 *
 * Meant for a one-shot `Sound.play()` bound to a bursty event — a pickup
 * chime, an impact cue — where firing on every underlying event reads as
 * noise rather than feedback.
 */
export function throttle(fn: () => void, minGapMs: number): () => void {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last < minGapMs) return;
    last = now;
    fn();
  };
}
