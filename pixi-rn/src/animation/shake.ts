/**
 * A decaying screen/camera shake, expressed as a pair of pixel offsets a host
 * applies to whatever it wants shaken.
 *
 * Like `Tween`, it owns no timer and no ticker: a frame loop hands it `dtMs`
 * and reads `x`/`y` back. It touches nothing in the scene graph itself, which
 * is the point — the host decides which containers move, and that decision is
 * usually the difference between a shake that looks right and one that tears
 * open the edges of the screen (see the note on coverage below).
 *
 * A decaying SINE, not random jitter. Noise reads as a rendering fault,
 * especially at a pixel-art scale where a stray offset looks like a torn
 * sprite; a couple of clean oscillations read as an impact. The vertical
 * component is deliberately smaller and slower than the horizontal one, so a
 * kick reads as a jolt with a little bounce rather than a circular wobble.
 *
 * Offsets are rounded to whole pixels, so a nearest-neighbour pixel-art scene
 * never lands off-grid mid-shake.
 *
 * ⚠️ **Whatever you offset stops covering the screen edges.** Shaking a root
 * container by N pixels uncovers up to N pixels of whatever sits behind it —
 * usually the framebuffer clear. Either shake only the layers that have
 * something opaque behind them, or make sure the reveal falls somewhere it
 * cannot be seen.
 *
 * @example
 * ```ts
 * const shake = new Shake({ amplitude: 5, duration: 260, frequency: 22 });
 * // on impact:
 * shake.kick();
 * // every frame:
 * shake.update(dtMs);
 * world.x = -camX + shake.x;
 * world.y = shake.y;
 * ```
 */
export interface ShakeOptions {
  /** Peak offset in pixels, at the moment of the kick. Decays to 0. */
  amplitude: number;
  /** How long a kick takes to decay away, in ms — the same unit as the `dtMs`
   *  a frame loop already hands every other per-frame update on this stack. */
  duration: number;
  /** Oscillations per second of the horizontal component. Higher reads as a
   *  sharper, harder impact; lower as a heavier sway. Defaults to 22. */
  frequency?: number;
  /** The vertical component's share of `amplitude`, 0 disabling it entirely.
   *  Defaults to 0.5. */
  verticalRatio?: number;
}

const DEFAULT_FREQUENCY = 22;
const DEFAULT_VERTICAL_RATIO = 0.5;

export class Shake {
  /** This frame's horizontal offset, in whole pixels. 0 while at rest. */
  x = 0;
  /** This frame's vertical offset, in whole pixels. 0 while at rest. */
  y = 0;

  private readonly amplitude: number;
  private readonly duration: number;
  private readonly frequency: number;
  private readonly verticalRatio: number;
  private remaining = 0;

  constructor({ amplitude, duration, frequency, verticalRatio }: ShakeOptions) {
    this.amplitude = amplitude;
    this.duration = duration;
    this.frequency = frequency ?? DEFAULT_FREQUENCY;
    this.verticalRatio = verticalRatio ?? DEFAULT_VERTICAL_RATIO;
  }

  /** True while a kick is still decaying. */
  get active(): boolean {
    return this.remaining > 0;
  }

  /** Start a shake at full amplitude, restarting one already in flight — a
   *  second impact should hit as hard as the first, not stack with it. */
  kick(): void {
    this.remaining = this.duration;
  }

  /** Drop any shake in flight and zero the offsets. Call this whenever the
   *  host's world is replaced wholesale (a new level, a restart), so a kick
   *  from the old one cannot bleed into the new. */
  clear(): void {
    this.remaining = 0;
    this.x = 0;
    this.y = 0;
  }

  /** Advance by a frame. Pass 0 to hold the current offset (paused). */
  update(dtMs: number): void {
    if (this.remaining <= 0) return;
    this.remaining -= dtMs;
    if (this.remaining <= 0) {
      this.clear();
      return;
    }
    // Amplitude decays linearly with the remaining life; the phase advances
    // with the elapsed part, so a kick always starts at offset 0 and swings
    // out from there rather than snapping to a peak.
    const decay = this.remaining / this.duration;
    const amp = this.amplitude * decay;
    const phase = ((this.duration - this.remaining) / 1000) * this.frequency;
    this.x = Math.round(amp * Math.sin(phase));
    this.y = Math.round(amp * this.verticalRatio * Math.sin(phase * 0.5));
  }
}
