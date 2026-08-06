// ── The frame loop ───────────────────────────────────────────────────────────
// One requestAnimationFrame, owned in one place. Small, but it is the part of
// an expo-gl app that is easy to get subtly and expensively wrong:
//
// 1. ⚠️ A rAF CALLBACK HAS NO ERROR BOUNDARY. React cannot catch it and neither
//    can the host, so an exception inside the loop is an unattributable crash —
//    on React Native it takes the whole process down with a stack that names
//    nothing. Worse, without stopping the loop a throwing frame throws again
//    every 16ms and buries the first error. This catches, records WHICH STAGE
//    was running, and stops.
// 2. ⚠️ EXPO-GL ONLY PRESENTS WHEN YOU SAY SO. Forgetting `endFrameEXP()` is a
//    permanently black surface with no error anywhere — a genuinely horrible
//    first-run experience. The loop does it for you.
// 3. A long stall (a GC pause, a screen transition, backgrounding) hands you a
//    huge delta, which teleports a simulation through walls. `dtMs` is clamped;
//    the true gap is passed alongside so a perf HUD can still see the stutter.
// 4. ONE loop. Pixi's shared tickers are parked by `createRenderer` for the same
//    reason (they start their own background rAF, outside any try/catch) — so
//    everything that needs a frame should run off this one.

/** Marks what the frame is currently doing, so a throw can be attributed. */
export type FrameStage = (label: string) => void;

export interface FrameLoopOptions {
  /** The expo-gl context — used to flush and present each frame. */
  gl: { flush: () => void; endFrameEXP: () => void };
  /**
   * The frame's work: step the simulation, mutate the scene, render.
   * @param now     the rAF timestamp
   * @param dtMs    milliseconds since the last frame, CLAMPED to `maxDeltaMs`
   * @param stage   call to label what you are about to do (see FrameStage)
   * @param rawMs   the true, unclamped gap — for measurement, not simulation
   */
  onFrame: (now: number, dtMs: number, stage: FrameStage, rawMs: number) => void;
  /** After the first successful present — i.e. proof the GL path works. */
  onFirstFrame?: () => void;
  /** After every present, for a perf HUD closing its own timing. */
  onPresented?: () => void;
  /** A frame threw. The loop has already STOPPED; surface this to the user. */
  onError?: (error: Error, stage: string) => void;
  /** Default 100ms. */
  maxDeltaMs?: number;
}

/** Starts the loop. Returns a stop function — call it on unmount. */
export function startFrameLoop(options: FrameLoopOptions): () => void {
  const { gl, onFrame, onFirstFrame, onPresented, onError, maxDeltaMs = 100 } = options;

  let raf: number | null = null;
  let last = 0;
  let presentedOnce = false;
  let stopped = false;

  const tick = (now: number) => {
    let currentStage = 'begin';
    const stage: FrameStage = (label) => {
      currentStage = label;
    };
    try {
      const rawMs = last ? now - last : 1000 / 60;
      // First frame has no previous timestamp, so assume a nominal one rather
      // than 0 — a 0 delta makes anything time-based sit still for one frame.
      const dtMs = last ? Math.min(rawMs, maxDeltaMs) : 1000 / 60;
      last = now;

      stage('frame');
      onFrame(now, dtMs, stage, rawMs);

      stage('gl flush');
      gl.flush();
      stage('present');
      gl.endFrameEXP();
      onPresented?.();

      if (!presentedOnce) {
        presentedOnce = true;
        onFirstFrame?.();
      }
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      onError?.(error, currentStage);
      return; // stop: see the header note
    }
    if (!stopped) raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  };
}
