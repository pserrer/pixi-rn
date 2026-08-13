# Changelog

All notable changes to `pixi-rn` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/).

## [0.10.1] - 2026-08-13

### Fixed

- **Documentation correction.** 0.10.0 claimed `Vibration.vibrate` is "governed
  by neither the touch-feedback level nor the keyboard one". That is wrong, and
  a device disproved it: React Native passes no `VibrationAttributes`, so the
  platform treats the effect as USAGE_UNKNOWN and scales it by the same
  haptic-feedback intensity. With that level at 0, **all three** Android
  approaches are silent and none reports anything wrong.

  The behaviour is unchanged — `Vibration.vibrate` is still the strongest of the
  three when haptics are enabled, which is why it stays — but it is no longer
  described as a bypass. Escaping the setting requires native code attaching
  `AudioAttributes.USAGE_MEDIA`, which is deliberately out of scope: shipping
  native code would cost every consumer their Expo Go workflow, and overriding a
  user's stated OS preference is a call only a host app can make.

## [0.10.0] - 2026-08-13

### Changed

- On Android, `haptics` now drives the vibrator directly through React Native's
  `Vibration` API instead of `performAndroidHapticsAsync`. iOS is unchanged.

  The haptic engine feels better, but it is **silently suppressed when the
  system's haptic-feedback level is 0** — and nothing observable from inside the
  app says so. `View.performHapticFeedback` returns a boolean reporting whether
  it did anything and `expo-haptics` discards it, so the call resolves
  successfully having done nothing. That cost five rounds of debugging against a
  real device: the app was asking, the native side was accepting, and the phone
  was silent because of a slider in the OS sound settings.

  `Vibration.vibrate` is governed by neither the touch-feedback level nor the
  keyboard one, and runs the motor at FULL amplitude — where `expo-haptics`'
  Android waveforms cap at ~27%. So it is both more dependable and stronger.

  ⚠️ This deliberately bypasses the system's touch-feedback level. That setting
  governs UI touch feedback, and a game's collision cue is not that — Android
  itself separates the two, with an independent "media vibration" level. The
  user's control over game haptics is the host app's own toggle, which every
  function takes as its first argument. Do not use this module without one.

- `hapticsDiagnostics()` reports `path` (`'vibrator'` | `'expo-haptics'`) in
  place of the `engine` boolean, and its `lastError` doc now says plainly that
  `null` does not prove the device buzzed — only that nothing threw.

## [0.9.0] - 2026-08-13

### Added

- `hapticsDiagnostics()` — reports the module's own state: the platform, whether
  the Android engine path is active, how many cues have been requested, and the
  last native failure if there was one. Nothing can tell you whether a user
  _felt_ anything — no platform exposes that — but this separates "the app never
  asked" from "the app asked and the device declined" from "the app asked, the
  device accepted, and it was still imperceptible", which are otherwise
  indistinguishable from outside the device.

## [0.8.0] - 2026-08-13

### Changed

- `haptics` now routes through Android's **haptic engine**
  (`performAndroidHapticsAsync` → `View.performHapticFeedback`) instead of the
  raw `Vibrator` waveforms `expo-haptics`' cross-platform cues use there. The
  API is unchanged — `impactAsync`/`selectionAsync`/`notificationAsync` keep
  working exactly as before — but on Android they now produce the platform's
  own tuned effects rather than a hand-rolled pulse.

  This is `expo-haptics`' own recommendation ("Android's `Vibrator` API is not
  recommended for implementing haptics feedback"), and the numbers explain why:
  the strongest cross-platform cue, `impactAsync('heavy')`, is a single 60ms
  pulse at amplitude 70 out of 255 — about 27%. Against a sound effect and a
  screen shake, that is easy to miss entirely.

  Engine effects are semantic rather than intensities, so the mapping is by
  meaning: an impact becomes `Reject` ("the rejection or failure of a user
  interaction" — which is what a collision is), a success notification becomes
  `Confirm`, a selection becomes `Segment_Tick`. Feature-detected, so an older
  `expo-haptics` keeps the previous behaviour, and iOS is untouched.

  ⚠️ One trade worth knowing: the engine path RESPECTS the system "touch
  feedback" setting, where the raw `Vibrator` path ignores it. A user who has
  turned haptics off system-wide will now correctly feel nothing.

## [0.7.0] - 2026-08-13

### Changed

- **BREAKING**: `haptics` now imports `expo-haptics` directly, and
  `setHapticsModule` is gone — with it `isHapticsAvailable` and the
  `HapticsModule` type. Hosts should delete their registration call; the three
  cues (`impactAsync`, `selectionAsync`, `notificationAsync`) are unchanged.
  `expo-haptics` becomes a peer dependency, required only for consumers who
  import `pixi-rn/haptics`.

  Injection existed to keep `expo-haptics` from being forced on every consumer,
  because a bundler resolves imports statically. Moving the module behind its
  own entry point in 0.6.0 solved that directly, leaving injection to buy only
  stubbability — while charging a real price: a host that forgets the
  registration call gets silence, with nothing failing to say so. The module is
  now structurally identical to `pixi-rn/audio`: the dependency follows the
  feature, and there is no setup step to forget.

### Fixed

- The API reference covers `pixi-rn/audio` and `pixi-rn/haptics` again. TypeDoc
  had a single entry point (`src/index.ts`), so both silently vanished from the
  generated docs when they moved out of the root barrel in 0.5.0 and 0.6.0.
  Each entry point is now its own documented module, titled by the import path
  it corresponds to.

## [0.6.0] - 2026-08-12

### Changed

- **BREAKING**: `haptics` moved out of the package root and behind its own
  `pixi-rn/haptics` entry point — `import { setHapticsModule, impactAsync }
from 'pixi-rn/haptics'`. Nothing about the module itself changed.

  This completes a single rule: **a module that touches a native capability
  lives behind its own subpath**, so a consumer only takes on a native
  dependency for a feature they actually use. For `audio` (0.5.0) that was
  load-bearing — it imports `expo-audio` at module scope, and a bundler
  resolves imports statically. `haptics` reaches its native module only
  through an injected implementation, so it could have stayed in the root
  barrel; it doesn't, because one rule a consumer can remember is worth more
  than the one import it saves.

## [0.5.0] - 2026-08-12

### Changed

- **BREAKING**: `audio` moved out of the package root and behind its own
  `pixi-rn/audio` entry point — `import { SoundPool, LoopSound, warmPools }
from 'pixi-rn/audio'`. Nothing about the module itself changed.

  It is the one module needing a native package (`expo-audio`) at runtime, and
  a bundler resolves imports statically: while the root barrel re-exported it,
  every consumer had to install `expo-audio` merely to bundle anything from
  this package at all, even an app that never plays a sound. Marking the peer
  dependency optional would not have fixed that — it only silences npm's
  missing-peer warning, leaving a green install and a broken bundle. Removing
  the import is what makes it genuinely optional, and it turns a missing
  dependency into a resolution error at build time rather than a surprise.

  Consumers who use audio: change the import path and keep `expo-audio`
  installed. Consumers who don't: `expo-audio` is no longer needed at all.

## [0.4.0] - 2026-08-12

### Added

- `Shake` (`animation`) — a decaying screen/camera shake exposed as a pair of
  whole-pixel `x`/`y` offsets the host applies to whatever it wants shaken.
  Like `Tween` it owns no timer or ticker: a frame loop hands it `dtMs` and
  reads the offsets back. A decaying sine rather than random jitter (noise
  reads as a rendering fault at a pixel-art scale), with a smaller, slower
  vertical component so a kick reads as a jolt with a little bounce rather
  than a circular wobble. It moves nothing itself by design — which container
  shakes is usually the difference between an impact that looks right and one
  that uncovers the edges of the screen.
- `haptics` — fail-soft vibration feedback: `impactAsync`, `selectionAsync`,
  `notificationAsync`, `isHapticsAvailable`, and `setHapticsModule`. Every call
  no-ops (never throws) without a registered module — Expo Go, an offline
  export, a pure OTA onto an older binary, a device with no vibrator. Each
  takes the caller's own on/off setting as its first argument, so a settings
  toggle takes effect without re-wiring anything. The host injects
  `expo-haptics` itself rather than this package importing it: a bundler
  resolves imports statically, so naming it here would force every consumer to
  install it merely to bundle, and only the host knows when touching a native
  module is safe.
- `smoothstep` (`animation`) — the classic Hermite curve. Unlike the piecewise
  `easeInOut*` curves it is one polynomial across the whole range, which is
  what you want for ramping a continuous quantity (a speed recovering after a
  stumble) rather than moving something from A to B.

## [0.3.0] - 2026-08-11

### Added

- `audio` — pooled `expo-audio` playback: `SoundPool` (a round-robin pool of
  pre-warmed one-shot players, so a bursty retrigger never cuts off the
  previous instance or constructs a player mid-play), `LoopSound` (a single
  looping player toggled on/off instead of retriggered), and `warmPools`
  (spreads pre-warming several pools' native player construction across
  timer steps). Deliberately not built on `@pixi/sound` — that's a Web Audio
  API library, and Hermes/React Native has no Web Audio API at all.
- `animation` — `Tween`, a dtMs-driven 0..1 progress timer (never a ticker
  or timer of its own), plus the `linear`/`easeInQuad`/`easeOutQuad`/
  `easeInOutQuad`/`easeInCubic`/`easeOutCubic`/`easeInOutCubic`/`easeOutBack`
  easing curves and a plain `lerp` it's built on.

## [0.2.0] - 2026-08-08

### Added

- `Pool` (`perf`) — a generic retained-scene-graph node pool: `fill()`
  retargets as many pooled nodes as a frame's items need (growing on demand)
  and hides the rest, so a per-frame layer never reallocates once it reaches
  a steady-state size. The generalized form of a pattern every terrain/
  particle/HUD layer on this stack ends up needing.

## [0.1.0] - 2026-08-07

Initial public release: the generic pixi.js-v8-on-`expo-gl` seam extracted
from a shipping game's own render layer.

### Added

- `core` — the Hermes/`expo-gl` compatibility adapter, renderer bring-up, the
  frame loop, and `expo-gl` texture upload (`createRenderer`,
  `startFrameLoop`, `loadSheet`, `makeWhiteTexture`, `makeSlicer`).
- `input` — a native-touch → Pixi v8 `EventBoundary` bridge
  (`createNativeEventBridge`).
- `layout` — a hand-written flex layout subset for retained Pixi trees, since
  `@pixi/layout` needs a WASM global Hermes doesn't have (`applyFlexLayout`).
- `text` — a bitmap font loader with synchronous, native-call-free JS
  measurement (`loadBitmapFont`, `measureText`, `fitFontSize`).
- `ui` — retained UI primitives built on the above: `UiRect`, `UiImage`,
  `UiPanel`, `UiLabel`, `UiPadNumber`, `UiButton`, `UiSlider`,
  `UiScrollList`, `UiDecoratedBox`, and `UiLayerStack`, a generic
  snapshot-driven multi-layer screen root.
- `testing` — an EXGL-faithful mock GL context for offline verification
  without a device.
