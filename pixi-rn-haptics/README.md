# `@pixi-rn/haptics`

Fail-soft haptics for React Native, with an Android native side that vibrates on
the **media** usage channel — the one channel the system's _haptic feedback_
level does not silence.

Standalone: it does not depend on [`pixi-rn`](https://github.com/pserrer/pixi-rn),
and `pixi-rn` does not depend on it.

## Install

```sh
npm install @pixi-rn/haptics
npx expo install expo-haptics
```

```ts
import { impactAsync } from '@pixi-rn/haptics';

// The first argument is the user's own vibration setting — pass it through on
// every call rather than caching it, so a settings toggle takes effect at once.
impactAsync(settings.vibration, 'heavy');
```

> [!WARNING]
> This is **native code**, so it requires a development build or EAS build — it
> cannot run in Expo Go, and it cannot reach a device over OTA. That is also why
> it is a separate package rather than part of `pixi-rn`: autolinking is
> install-level, so native code inside a library is compiled into every
> consumer's build whether or not they import it. No import boundary can prevent
> that; a package boundary can.

## Why this attaches `USAGE_MEDIA`

Every other JS-reachable way to vibrate an Android phone is silenced by the
system's _haptic feedback_ level — a setting about UI touches — and none of
them report a failure when suppressed:

| approach                            | why it's gated                                      |
| ----------------------------------- | --------------------------------------------------- |
| `expo-haptics`' cross-platform cues | vibrates with no usage attributes → `USAGE_UNKNOWN` |
| `Vibration.vibrate` (React Native)  | same — RN passes no `VibrationAttributes`           |
| `performAndroidHapticsAsync`        | gated outright, and discards the boolean saying so  |

This package's native side attaches `AudioAttributes.USAGE_MEDIA` instead,
which the haptic-feedback level does not gate.

> [!WARNING]
> This lets your app vibrate while the user has touch feedback switched off.
> Only ship it if you give the player their own vibration toggle — every
> function takes that flag as its first argument, and you must pass it honestly.

## The three cues

```ts
impactAsync(enabled, 'medium'); // a collision, a landing, a snap into place
selectionAsync(enabled); // a picker stepping, a slider passing a detent
notificationAsync(enabled, 'success'); // a purchase clearing, an action rejected
```

`impactAsync` takes `'light' | 'medium' | 'heavy' | 'rigid' | 'soft'` (default
`'medium'`); `notificationAsync` takes `'success' | 'warning' | 'error'`. All
three are fire-and-forget and swallow their own failures — no call site needs a
`try`/`catch`, and none returns a promise you have to handle.

They pick a backend at runtime, so one call site covers every platform:

| where                             | what runs                           | follows the system setting   |
| --------------------------------- | ----------------------------------- | ---------------------------- |
| Android, native side compiled in  | the media channel                   | no                           |
| Android, Expo Go / offline export | `Vibration.vibrate`, full amplitude | yes                          |
| iOS                               | `expo-haptics` impact generators    | n/a — no equivalent trapdoor |

## The raw vibrator

For direct control over duration and amplitude:

```ts
import { PixiRnMediaVibration } from '@pixi-rn/haptics';

PixiRnMediaVibration?.vibrate(45, 255); // 45ms at full amplitude (1..255)
PixiRnMediaVibration?.vibratePattern([0, 25, 90, 25]); // [wait, buzz, …] ms
PixiRnMediaVibration?.cancel();
PixiRnMediaVibration?.isAvailable(); // does this device have a vibrator
```

⚠️ It is **`null`** on iOS, in Expo Go, and in any build without the native side
compiled in — hence the `?.`. Easy to miss, because it is never null on the
platform you develop the feature on.

## Diagnostics

`hapticsDiagnostics()` reports the platform, which backend is in use, the number
of cues requested, and the last error.

⚠️ `lastError: null` means **nothing threw**. It does not mean the device
buzzed — no platform reports that back.

## Requirements

- `expo` and `react-native` (peers), plus `expo-haptics` for the iOS path.
- **`minSdkVersion` 24.** Per-pulse amplitude control needs API 26
  (`VibrationEffect`); on 24–25 the legacy `Vibrator` overloads carry the same
  `AudioAttributes`, so the media channel still applies and the motor runs at
  full.
- The `VIBRATE` permission ships in this package's own manifest and merges into
  your app.

## Licence

MIT.
