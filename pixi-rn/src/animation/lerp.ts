/** Linear interpolation between `a` and `b` at `t`. Not clamped — a `t`
 *  outside 0..1 extrapolates, which is sometimes exactly what's wanted
 *  (e.g. `easeOutBack`'s own overshoot past 1). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
