# Changelog

All notable changes to `@pixi-rn/haptics` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-08-14

### Added

- Initial release. Fail-soft haptics for React Native — `impactAsync`,
  `selectionAsync`, `notificationAsync`, each taking the user's own vibration
  setting as its first argument, each swallowing its own failures.

- An Android native side that vibrates with `AudioAttributes.USAGE_MEDIA`, so
  feedback is not silenced by the system's haptic-feedback level — which gates
  every JS-reachable vibration API, silently. It is resolved with
  `requireOptionalNativeModule`, so the cues fall back to `Vibration.vibrate` in
  Expo Go and to `expo-haptics` on iOS rather than failing. The raw handle is
  exported as `PixiRnMediaVibration` for callers who want direct control over
  duration and amplitude; it is `null` wherever the native side isn't compiled
  in.

- `hapticsDiagnostics()`, reporting the platform, the active backend, the cue
  count and the last error. Its `lastError: null` means nothing threw, **not**
  that the device buzzed — no platform reports that back, and confusing the two
  is what makes this class of problem expensive to debug.

- Works on API 24–25, which `minSdkVersion 24` advertises. `VibrationEffect` is
  API 26; both entry points fall back to `Vibrator`'s legacy overloads, which
  take the same `AudioAttributes` from API 21, so the media channel still
  applies there and only per-pulse amplitude control is lost.

### Notes

The cue API previously shipped as `pixi-rn`'s `pixi-rn/haptics` entry point,
with the native side as a separate optional companion package. Both halves live
here now: one package, one name, one thing to install. `pixi-rn@0.12.0` drops
its entry point accordingly.
