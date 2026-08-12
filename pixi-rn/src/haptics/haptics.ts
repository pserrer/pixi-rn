/**
 * Fail-soft haptic feedback.
 *
 * This module never imports `expo-haptics` itself — the host injects it once
 * with {@link setHapticsModule}, and until it does (or if it never does) every
 * function here is a no-op. That is deliberate and it is the whole design:
 *
 * - **A bundler resolves imports statically**, so a package that reached for
 *   `expo-haptics` directly would force every consumer to install it just to
 *   bundle, no matter how carefully the call were wrapped in `try`/`catch`.
 *   Injection keeps it genuinely optional.
 * - **The native module must not be touched at module-eval time.** Requiring
 *   `expo-haptics` evaluates a `requireNativeModule` call, and a synchronous
 *   native touch during module evaluation can take an app down before any
 *   error boundary exists — a `try`/`catch` around the *import* does not
 *   protect against it. The host decides when that happens; the usual answer
 *   is inside an effect, never at the top of a module.
 * - Haptics are an enhancement. Expo Go, an offline export, a pure OTA onto a
 *   binary predating the dependency, a simulator, a device with no vibrator —
 *   an app has to behave identically in all of them, and no call site should
 *   need a `try`/`catch` of its own.
 *
 * @example
 * ```ts
 * // once, inside an effect — never at module scope:
 * setHapticsModule(require('expo-haptics'));
 *
 * // anywhere, per call. `enabled` is the user's own setting, passed through
 * // rather than cached here, so a settings toggle takes effect immediately.
 * impactAsync(settings.vibration);
 * ```
 */

/** Impact strengths, mapped onto `expo-haptics`' `ImpactFeedbackStyle`. */
export type HapticImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';

/**
 * The shape {@link setHapticsModule} accepts — `expo-haptics`' own module
 * satisfies it structurally, so `setHapticsModule(require('expo-haptics'))`
 * type-checks without this package depending on it. Every member is optional:
 * a partial or stubbed implementation (a test double, a platform shim) is
 * valid, and a missing one simply makes that cue a no-op.
 */
export interface HapticsModule {
  impactAsync?(style?: unknown): Promise<void>;
  notificationAsync?(type?: unknown): Promise<void>;
  selectionAsync?(): Promise<void>;
  ImpactFeedbackStyle?: Record<string, unknown>;
  NotificationFeedbackType?: Record<string, unknown>;
}

let mod: HapticsModule | null = null;

/**
 * Register (or clear, with `null`) the haptics implementation. Call it once
 * during startup, from somewhere it is safe to touch a native module — an
 * effect, not module scope. Calling it again replaces the previous one.
 */
export function setHapticsModule(module: HapticsModule | null): void {
  mod = module;
}

/** True once a module has been registered. Diagnostics only — the feedback
 *  functions already no-op without one. */
export function isHapticsAvailable(): boolean {
  return mod !== null;
}

const IMPACT_STYLES: Record<HapticImpactStyle, string> = {
  light: 'Light',
  medium: 'Medium',
  heavy: 'Heavy',
  rigid: 'Rigid',
  soft: 'Soft',
};

// Fire-and-forget. These are typically called from a frame loop's event
// handling, where awaiting a native round-trip would sit between the
// simulation step and the render; and a rejection (no vibrator, permission
// withheld, the native side missing from an older binary) must never surface
// as an unhandled promise rejection.
function fire(run: () => Promise<void> | undefined): void {
  try {
    void run()?.catch(() => {});
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
  if (!enabled || !mod?.impactAsync) return;
  const m = mod;
  fire(() => m.impactAsync?.(m.ImpactFeedbackStyle?.[IMPACT_STYLES[style]]));
}

/** The lighter tick for a discrete selection change (a picker stepping, a
 *  slider passing a detent). */
export function selectionAsync(enabled: boolean): void {
  if (!enabled || !mod?.selectionAsync) return;
  const m = mod;
  fire(() => m.selectionAsync?.());
}

/** An outcome cue — a purchase clearing, an action being rejected. */
export function notificationAsync(enabled: boolean, type: 'success' | 'warning' | 'error' = 'success'): void {
  if (!enabled || !mod?.notificationAsync) return;
  const m = mod;
  const key = type === 'success' ? 'Success' : type === 'warning' ? 'Warning' : 'Error';
  fire(() => m.notificationAsync?.(m.NotificationFeedbackType?.[key]));
}
