import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Fail-soft haptic feedback, wrapping `expo-haptics`.
 *
 * Haptics are an enhancement, never a dependency: a device with no vibrator, a
 * simulator, or a user who has turned system haptics off must all behave as if
 * the calls simply did nothing. So every function here swallows its own
 * failures — no call site needs a `try`/`catch`, and none of them returns a
 * promise you have to handle.
 *
 * ⚠️ **On Android these route through the device's HAPTIC ENGINE, not the raw
 * `Vibrator`.** `expo-haptics`' cross-platform cues (`impactAsync`,
 * `notificationAsync`, `selectionAsync`) are implemented on Android as
 * hand-rolled `Vibrator` waveforms, and they are *quiet*: the strongest of them,
 * `impactAsync('heavy')`, is a single 60ms pulse at amplitude 70 out of 255 —
 * about 27%. Mid-game, against a sound effect and a screen shake, that is easy
 * to miss entirely. `expo-haptics`' own documentation says so outright: "Android's
 * `Vibrator` API is not recommended for implementing haptics feedback. Instead,
 * you should use `performAndroidHapticsAsync`", which calls
 * `View.performHapticFeedback` and gets the platform's real, tuned effects — the
 * ones system UI itself uses. This module does that automatically, so callers
 * keep using one cross-platform API and still get the good haptics on Android.
 *
 * The trade is worth knowing: the engine path RESPECTS the system "touch
 * feedback" setting, where the raw `Vibrator` path ignores it. A user who has
 * turned haptics off system-wide will now correctly feel nothing.
 *
 * @example
 * ```ts
 * import { impactAsync } from 'pixi-rn/haptics';
 *
 * // `enabled` is the user's own setting — pass it through on every call
 * // rather than caching it, so a settings toggle takes effect immediately.
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

// `performAndroidHapticsAsync` is newer than the three cross-platform cues, so
// it is feature-detected rather than assumed — an older `expo-haptics` simply
// keeps the Vibrator path.
const useEngine = Platform.OS === 'android' && typeof Haptics.performAndroidHapticsAsync === 'function';

// The engine's effects are SEMANTIC ("confirm", "reject"), not intensities, so
// the mapping is by meaning rather than by strength. `Reject` — "the rejection
// or failure of a user interaction" — is what a collision actually is, and is
// also the most emphatic effect available.
const ANDROID_IMPACT: Record<HapticImpactStyle, Haptics.AndroidHaptics> = {
  light: Haptics.AndroidHaptics?.Segment_Tick,
  soft: Haptics.AndroidHaptics?.Clock_Tick,
  medium: Haptics.AndroidHaptics?.Context_Click,
  rigid: Haptics.AndroidHaptics?.Virtual_Key,
  heavy: Haptics.AndroidHaptics?.Reject,
};

const ANDROID_NOTIFICATION = {
  success: Haptics.AndroidHaptics?.Confirm,
  warning: Haptics.AndroidHaptics?.Reject,
  error: Haptics.AndroidHaptics?.Reject,
};

// Fire-and-forget. These are typically called from a frame loop's event
// handling, where awaiting a native round-trip would sit between the simulation
// step and the render; and a rejection (no vibrator, permission withheld) must
// never surface as an unhandled promise rejection.
function fire(run: () => Promise<void>): void {
  try {
    void run().catch(() => {});
  } catch {
    /* best-effort */
  }
}

/**
 * A single impact tap — a collision, a landing, a snap into place.
 *
 * @param enabled the caller's own on/off setting; `false` skips everything.
 */
export function impactAsync(enabled: boolean, style: HapticImpactStyle = 'medium'): void {
  if (!enabled) return;
  if (useEngine) fire(() => Haptics.performAndroidHapticsAsync(ANDROID_IMPACT[style]));
  else fire(() => Haptics.impactAsync(IMPACT_STYLES[style]));
}

/** The lighter tick for a discrete selection change (a picker stepping, a
 *  slider passing a detent). */
export function selectionAsync(enabled: boolean): void {
  if (!enabled) return;
  if (useEngine) fire(() => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick));
  else fire(() => Haptics.selectionAsync());
}

/** An outcome cue — a purchase clearing, an action being rejected. */
export function notificationAsync(enabled: boolean, type: 'success' | 'warning' | 'error' = 'success'): void {
  if (!enabled) return;
  if (useEngine) fire(() => Haptics.performAndroidHapticsAsync(ANDROID_NOTIFICATION[type]));
  else fire(() => Haptics.notificationAsync(NOTIFICATION_TYPES[type]));
}
