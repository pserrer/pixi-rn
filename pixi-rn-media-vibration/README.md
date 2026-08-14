# `@pixi-rn/media-vibration`

Android vibration on the **media** usage channel, for [`pixi-rn`](https://github.com/pserrer/pixi-rn).

## Why this exists

Every JS-reachable way to vibrate an Android phone is silenced by the system's
_haptic feedback_ level — a setting about UI touches:

| approach                            | why it's gated                                      |
| ----------------------------------- | --------------------------------------------------- |
| `expo-haptics`' cross-platform cues | vibrates with no usage attributes → `USAGE_UNKNOWN` |
| `Vibration.vibrate` (React Native)  | same — RN passes no `VibrationAttributes`           |
| `performAndroidHapticsAsync`        | gated outright, and discards the boolean saying so  |

Verified on a device with that level at 0: all three are silent, and none
reports anything wrong. A game's collision cue is not UI touch feedback, and
Android agrees — its settings screen carries an independent media-vibration
level. This module attaches `AudioAttributes.USAGE_MEDIA` and lands there
instead.

## Install

```sh
npm install pixi-rn @pixi-rn/media-vibration
```

That's the whole integration. `pixi-rn/haptics` looks this module up by name at
runtime, so its cues upgrade to the media channel automatically — no import, no
registration, no call-site change:

```ts
import { impactAsync } from 'pixi-rn/haptics';

impactAsync(settings.vibration, 'heavy');
```

Without this package, those cues still work; they just use the portable JS path
and follow the system setting.

> [!WARNING]
> This is **native code**, so it requires a development build or EAS build —
> it cannot run in Expo Go, and it cannot reach a device over OTA. That is
> precisely why it is a separate package: autolinking is install-level, so
> keeping it out of `pixi-rn` is the only way `pixi-rn` stays Expo Go friendly.

> [!WARNING]
> Installing this lets your app vibrate while the user has touch feedback
> switched off. Only do it if you give the player their own vibration toggle —
> `pixi-rn/haptics` takes that flag as the first argument of every call, and you
> must pass it honestly.

Android only. On iOS it is inert, and `pixi-rn/haptics` uses `expo-haptics`'
impact generators, which have no equivalent problem.
