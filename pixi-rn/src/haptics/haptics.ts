import { Platform, Vibration } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import * as Haptics from 'expo-haptics';

/**
 * Fail-soft haptic feedback.
 *
 * Haptics are an enhancement, never a dependency: a device with no vibrator, a
 * simulator, or a user who has turned them off must all behave as if the calls
 * simply did nothing. Every function here swallows its own failures — no call
 * site needs a `try`/`catch`, and none returns a promise you must handle.
 *
 * ## Android drives the vibrator directly
 *
 * There are three ways to make an Android phone buzz. This module picks the
 * strongest; none of them escapes the system's haptic-feedback level (below):
 *
 * 1. `expo-haptics`' cross-platform cues → hand-rolled `Vibrator` waveforms,
 *    capped at amplitude 70 of 255 (~27%) for the strongest of them. Quiet
 *    enough to miss entirely mid-game.
 * 2. `performAndroidHapticsAsync` → `View.performHapticFeedback`, the
 *    platform's own tuned effects. Feels best — and is **silently suppressed**
 *    when the system's *haptic feedback* level is 0. `performHapticFeedback`
 *    returns a boolean saying whether it did anything, `expo-haptics` discards
 *    it, so the call resolves successfully having done nothing at all. This
 *    cost five rounds of debugging against a real device before the setting was
 *    found; nothing observable from inside the app distinguishes it from a
 *    device with no vibrator.
 * 3. `Vibration.vibrate` (React Native core) → the vibrator at full amplitude
 *    for a given duration.
 *
 * This module uses (3) on Android — the strongest of the three — and
 * `expo-haptics` on iOS, where the impact generators are the right thing.
 *
 * ⚠️ **None of the three escapes the system's haptic-feedback level.** RN passes
 * no `VibrationAttributes`, so the platform treats the effect as USAGE_UNKNOWN
 * and scales it by the touch-feedback intensity — at 0, to silence. Verified on
 * a device: with that level at 0, all three are inaudible and none reports
 * anything wrong.
 *
 * ## `@pixi-rn/haptics`, when the setting must not win
 *
 * Installing that companion package upgrades every cue here to Android's MEDIA
 * vibration channel, which the haptic-feedback level does not touch. It is
 * discovered by NATIVE MODULE NAME at runtime and never imported, which is what
 * keeps it optional: this package has no dependency on it, and a consumer who
 * doesn't install it keeps their Expo Go workflow. Autolinking is install-level,
 * so a separate package is the only boundary that actually holds — an import
 * boundary would not.
 *
 * Every function takes the user's own on/off setting as its first argument, and
 * every caller must honour it — a host without such a toggle should add one.
 *
 * @example
 * ```ts
 * import { impactAsync } from 'pixi-rn/haptics';
 *
 * // `enabled` is the user's own setting — pass it through on every call rather
 * // than caching it, so a settings toggle takes effect immediately.
 * impactAsync(settings.vibration, 'heavy');
 * ```
 */

/** Impact strengths, mapped onto `expo-haptics`' `ImpactFeedbackStyle`. */
export type HapticImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';

const IMPACT_STYLES: Record<HapticImpactStyle, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
  rigid: Haptics.ImpactFeedbackStyle.Rigid,
  soft: Haptics.ImpactFeedbackStyle.Soft,
};

const NOTIFICATION_TYPES = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};

const ANDROID = Platform.OS === 'android';

// The optional companion. Looked up by NAME — importing `@pixi-rn/haptics`
// would make it a hard dependency, which is exactly what must not happen.
interface MediaVibrator {
  vibrate(durationMs: number, amplitude: number): void;
  vibratePattern(pattern: number[]): void;
}
const media = ANDROID ? requireOptionalNativeModule<MediaVibrator>('PixiRnHaptics') : null;

// Durations in ms. `Vibration.vibrate(ms)` runs the motor at full amplitude for
// that long, so these are shorter than the equivalent expo-haptics waveforms —
// those pad their length to compensate for running at a quarter power.
const ANDROID_IMPACT_MS: Record<HapticImpactStyle, number> = {
  light: 12,
  soft: 12,
  medium: 22,
  rigid: 22,
  heavy: 45,
};

// [wait, buzz, wait, buzz, …] — a rhythm reads as a distinct event where a
// single pulse of the same total length reads as a stray buzz.
const ANDROID_NOTIFICATION_MS = {
  success: [0, 25, 90, 25],
  warning: [0, 35, 90, 55],
  error: [0, 45, 80, 35, 80, 55],
};

/** What the module knows about its own state — see {@link hapticsDiagnostics}. */
export interface HapticsDiagnostics {
  /** `Platform.OS`. */
  platform: string;
  /** Which implementation is in use. `media` means `@pixi-rn/haptics` is
   *  installed and cues are on Android's media channel, immune to the system
   *  haptic-feedback level; `vibrator` is the portable Android path, which is
   *  not. */
  path: 'media' | 'vibrator' | 'expo-haptics';
  /** Cues requested since launch. */
  calls: number;
  /** The last failure from a cue, if any. ⚠️ `null` does NOT prove the device
   *  buzzed — no platform reports that back. It only means nothing threw. */
  lastError: string | null;
}

let calls = 0;
let lastError: string | null = null;

/**
 * Report what this module knows about itself. Nothing here can tell you whether
 * the user FELT anything — no platform exposes that — but it does separate "the
 * app never asked" from "the app asked and something threw".
 */
export function hapticsDiagnostics(): HapticsDiagnostics {
  const path = media ? 'media' : ANDROID ? 'vibrator' : 'expo-haptics';
  return { platform: String(Platform.OS), path, calls, lastError };
}

// Fire-and-forget. These are typically called from a frame loop's event
// handling, where awaiting a native round-trip would sit between the simulation
// step and the render; and a failure (no vibrator, permission withheld) must
// never surface as an unhandled rejection — it is recorded for
// `hapticsDiagnostics` instead of thrown.
function fire(run: () => Promise<void> | void): void {
  calls++;
  try {
    const result = run();
    if (result) void result.catch((err: unknown) => void (lastError = String(err)));
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }
}

/**
 * A single impact tap — a collision, a landing, a snap into place.
 *
 * @param enabled the caller's own on/off setting; `false` skips everything.
 */
export function impactAsync(enabled: boolean, style: HapticImpactStyle = 'medium'): void {
  if (!enabled) return;
  if (media) fire(() => media.vibrate(ANDROID_IMPACT_MS[style], 255));
  else if (ANDROID) fire(() => Vibration.vibrate(ANDROID_IMPACT_MS[style]));
  else fire(() => Haptics.impactAsync(IMPACT_STYLES[style]));
}

/** The lighter tick for a discrete selection change (a picker stepping, a
 *  slider passing a detent). */
export function selectionAsync(enabled: boolean): void {
  if (!enabled) return;
  if (media) fire(() => media.vibrate(10, 255));
  else if (ANDROID) fire(() => Vibration.vibrate(10));
  else fire(() => Haptics.selectionAsync());
}

/** An outcome cue — a purchase clearing, an action being rejected. */
export function notificationAsync(enabled: boolean, type: 'success' | 'warning' | 'error' = 'success'): void {
  if (!enabled) return;
  if (media) fire(() => media.vibratePattern(ANDROID_NOTIFICATION_MS[type]));
  else if (ANDROID) fire(() => Vibration.vibrate(ANDROID_NOTIFICATION_MS[type]));
  else fire(() => Haptics.notificationAsync(NOTIFICATION_TYPES[type]));
}
