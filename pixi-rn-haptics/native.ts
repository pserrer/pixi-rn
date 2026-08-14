// The Android native side: a vibrator on the MEDIA usage channel.
//
// Most callers want the cue API this package exports instead — it prefers this
// when available and falls back to the portable path when it is not. The handle
// is exported for diagnostics, and for callers who want raw control over
// duration and amplitude without the cue vocabulary.
import { requireOptionalNativeModule } from 'expo';

export interface PixiRnMediaVibrationModule {
  /** Whether this device has a vibrator at all. */
  isAvailable(): boolean;
  /** One pulse, `durationMs` long, at `amplitude` (1..255). */
  vibrate(durationMs: number, amplitude: number): void;
  /** A `[wait, buzz, wait, buzz, …]` waveform in ms, at full amplitude. */
  vibratePattern(pattern: number[]): void;
  /** Stop anything currently playing. */
  cancel(): void;
}

/** Null on iOS, in Expo Go, in an offline export, or on any build that doesn't
 *  have this package's native side compiled in. */
export const PixiRnMediaVibration = requireOptionalNativeModule<PixiRnMediaVibrationModule>('PixiRnMediaVibration');
