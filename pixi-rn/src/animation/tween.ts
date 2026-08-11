import { linear, type EasingFn } from './easing';

export interface TweenOptions {
  /** How long a full run takes, in ms — the same unit as the `dtMs` a frame
   *  loop already hands every other per-frame update on this stack. */
  duration: number;
  /** Applied to the raw 0..1 progress before `onUpdate` sees it. Defaults
   *  to `linear` (no easing). */
  easing?: EasingFn;
  /** Called with the eased progress every `update()` while running,
   *  including the final call at exactly 1. Do the actual interpolation
   *  here — `Tween` only drives progress, it has no opinion on what that
   *  progress animates. */
  onUpdate: (progress: number) => void;
  /** Called once, the moment progress reaches 1. */
  onComplete?: () => void;
}

/**
 * Drives a single 0..1 progress value over `duration` ms, advanced by an
 * explicit `update(dtMs)` call — never a timer or ticker of its own. Every
 * animated thing on this stack is driven off a frame loop's own `dtMs`
 * instead (a `UiLayerStack` layer, `LoopSound`'s active state); `Tween` is
 * the same idea generalized to a plain numeric progress driver.
 *
 * @example
 * ```ts
 * const pop = new Tween({
 *   duration: 280,
 *   easing: easeOutBack,
 *   onUpdate: (t) => sprite.scale.set(lerp(1.6, 1, t)),
 * });
 * // every frame:
 * pop.update(dtMs);
 * ```
 */
export class Tween {
  private elapsed = 0;
  private finished = false;

  constructor(private readonly opts: TweenOptions) {}

  /** True once progress has reached 1 and `onComplete` (if any) has fired. */
  get isDone(): boolean {
    return this.finished;
  }

  /** Advances by `dtMs`. A no-op once finished — call `restart()` to run it
   *  again. */
  update(dtMs: number): void {
    if (this.finished) return;
    this.elapsed += dtMs;
    const raw = Math.min(1, this.elapsed / this.opts.duration);
    this.opts.onUpdate((this.opts.easing ?? linear)(raw));
    if (raw >= 1) {
      this.finished = true;
      this.opts.onComplete?.();
    }
  }

  /** Resets progress to 0 and clears the finished flag. Does NOT call
   *  `onUpdate` itself — the next `update()` does, so a caller that needs
   *  the reset value applied on the SAME frame should call `update(0)`
   *  right after. */
  restart(): void {
    this.elapsed = 0;
    this.finished = false;
  }
}
