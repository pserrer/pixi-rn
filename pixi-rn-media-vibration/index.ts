// The native half of `pixi-rn/haptics`.
//
// You do not normally import this. Installing the package is the whole API:
// `pixi-rn/haptics` looks the native module up by NAME at runtime — never by
// importing this package — so its cues automatically upgrade to the media
// channel wherever this is installed, and keep working (on the portable JS
// path) wherever it isn't.
//
// The direct handle is exported for diagnostics and for callers who want the
// vibrator without pixi-rn's cue vocabulary.
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
