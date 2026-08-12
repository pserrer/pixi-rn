// Small, standard (Penner-style) easing curves: each maps a normalized
// progress `t` (0..1) to an eased progress, for driving a `Tween` or any
// other manually-interpolated value.
export type EasingFn = (t: number) => number;

export function linear(t: number): number {
  return t;
}

export function easeInQuad(t: number): number {
  return t * t;
}

export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function easeInCubic(t: number): number {
  return t * t * t;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// The classic Hermite smoothstep: zero slope at both ends, and — unlike the
// piecewise `easeInOut*` curves above — one single polynomial across the whole
// range. That makes it the natural pick for ramping a CONTINUOUS quantity
// (a speed recovering after a stumble, a volume fading in) rather than moving
// something from A to B, where a piecewise ease is fine.
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// A slight overshoot past 1 before settling — reads as a "pop" rather than a
// plain ease-out, for a UI element that should feel like it lands with a bit
// of bounce (a popup, a picked-up item) instead of just decelerating into place.
const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;
export function easeOutBack(t: number): number {
  const p = t - 1;
  return 1 + BACK_C3 * p * p * p + BACK_C1 * p * p;
}
