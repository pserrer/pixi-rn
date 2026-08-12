// Fail-soft haptic feedback. This module never imports `expo-haptics` itself:
// the host injects it once with `setHapticsModule`, so a consumer that doesn't
// want haptics doesn't have to install anything, and the native module is only
// touched where the host decides it is safe to.
export {
  setHapticsModule,
  impactAsync,
  selectionAsync,
  notificationAsync,
  isHapticsAvailable,
  type HapticsModule,
  type HapticImpactStyle,
} from './haptics';
