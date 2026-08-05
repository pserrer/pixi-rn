// Diagnostics hook.
//
// This package's failures are the silent kind — a black GLView, a dead process,
// chrome drawn where nothing can tap it — so it traces its own boundaries. But
// WHERE those traces go is the host app's business (this game persists them to
// AsyncStorage and shows an interrupted trace on the next launch), so the
// package only defines the shape and defaults to the console.

export interface PixiRnLogger {
  /** A boundary was entered — cheap, low-volume, safe to persist. */
  trace: (stage: string, detail?: unknown) => void;
  /** A caught failure. */
  fail: (stage: string, error: unknown) => void;
}

let logger: PixiRnLogger = {
  trace: (stage, detail) => console.log('[pixi-rn]', stage, detail ?? ''),
  fail: (stage, error) => console.error('[pixi-rn]', stage, error),
};

export function setPixiRnLogger(next: Partial<PixiRnLogger>): void {
  logger = { ...logger, ...next };
}

export function pixiRnTrace(stage: string, detail?: unknown): void { logger.trace(stage, detail); }
export function pixiRnFail(stage: string, error: unknown): void { logger.fail(stage, error); }
