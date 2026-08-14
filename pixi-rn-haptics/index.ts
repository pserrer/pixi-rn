// Fail-soft haptic feedback for React Native, with an Android native side that
// vibrates on the MEDIA usage channel — the one channel the system's
// haptic-feedback level does not silence.
//
// The cue API is what you normally want. The raw vibrator is exported for
// diagnostics and for callers who need direct control over duration and
// amplitude; it is `null` wherever the native side isn't compiled in (iOS,
// Expo Go, an offline export), so guard it.
export {
  impactAsync,
  selectionAsync,
  notificationAsync,
  hapticsDiagnostics,
  type HapticImpactStyle,
  type HapticsDiagnostics,
} from './haptics';

export { PixiRnMediaVibration, type PixiRnMediaVibrationModule } from './native';
