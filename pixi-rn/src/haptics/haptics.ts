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
 * This module reaches `expo-haptics` with an ordinary import, which is why it
 * lives behind its own `pixi-rn/haptics` entry point: the dependency follows
 * the feature, so a consumer who never imports this never has to install it.
 * That is the same rule `pixi-rn/audio` follows.
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
  fire(() => Haptics.impactAsync(IMPACT_STYLES[style]));
}

/** The lighter tick for a discrete selection change (a picker stepping, a
 *  slider passing a detent). */
export function selectionAsync(enabled: boolean): void {
  if (!enabled) return;
  fire(() => Haptics.selectionAsync());
}

/** An outcome cue — a purchase clearing, an action being rejected. */
export function notificationAsync(enabled: boolean, type: 'success' | 'warning' | 'error' = 'success'): void {
  if (!enabled) return;
  fire(() => Haptics.notificationAsync(NOTIFICATION_TYPES[type]));
}
