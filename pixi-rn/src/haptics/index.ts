// Fail-soft haptic feedback. Reaches `expo-haptics` with an ordinary import,
// which is why it lives behind its own entry point rather than the root barrel:
// the dependency follows the feature, so a consumer who never imports this
// never has to install it.
export { impactAsync, selectionAsync, notificationAsync, type HapticImpactStyle } from './haptics';
