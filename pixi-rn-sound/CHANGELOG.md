# Changelog

All notable changes to `@pixi-rn/sound` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-08-15

### Fixed

- **A one-shot cue still playing (or not yet pooled — an
  `AudioBufferSourceNode` isn't cleaned up until it fires `onended`) at the
  moment the app backgrounds would replay itself the instant the app came
  back, with nothing in the game re-triggering it.** `@pixi/sound`'s pause
  model is replay-based: resuming any still-live instance calls `play()`
  again from its elapsed position. Toggling `context.paused` (the only
  option available, since `@pixi/sound`'s own `autoPause` never fires in
  React Native) touches every instance of every registered `Sound`, and a
  one-shot effect has no other paused flag keeping it paused once that
  clears — unlike a track a host explicitly calls `Sound.pause()` on, whose
  per-`Sound` paused flag survives the context flag clearing. Backgrounding
  now calls `sound.stopAll()` before suspending the context, which routes
  through every instance's real `stop()` and leaves nothing to resume.
- **Resuming after a long background suspension could leave audio
  permanently silent.** `initAudio()` is a one-time call, and the `AppState`
  handler only toggled `context.paused` on foreground/background — correct
  for a quick app-switch, but a background gap long enough for the OS to
  reclaim the native audio session (a locked screen left for minutes or
  hours) left nothing to re-assert it, since the platform never tells JS
  that happened. A resume after 60+ seconds backgrounded now re-claims the
  audio session and re-primes the graph, the same two calls `initAudio()`
  makes on first bring-up.

## [0.4.0] - 2026-08-15

### Changed

- Source moved under `src/` (`main` is now `src/index.ts`), matching
  `pixi-rn`'s own layout. A deep import of a specific file
  (`@pixi-rn/sound/shim` and similar) needs the `src/` prefix now; importing
  the package itself (`@pixi-rn/sound`) is unaffected.

## [0.3.0] - 2026-08-15

### Added

- `loadSounds(sources, options)` — decode a batch of clips sequentially and
  return whichever succeeded, instead of every consumer hand-rolling the same
  loop.
- `throttle(fn, minGapMs)` — drop calls to a callback that land within
  `minGapMs` of the last one that ran, for a one-shot cue bound to a bursty
  event.
- `TrackSwitcher` — switch between named looping tracks (menu/level music,
  ambience beds), pausing rather than destroying whichever one isn't current.
- `FilterGroup` — toggle a filter chain on or off across a set of clips,
  building it once on first use and applying it to clips registered after the
  toggle too.

## [0.2.2] - 2026-08-15

### Fixed

- **Audio kept playing after the app was backgrounded.** `@pixi/sound` has
  `autoPause` for this, on by default, but implements it with
  `globalThis.addEventListener('focus'|'blur')` — events that never fire in
  React Native, so its background handling was dead code here. `initAudio()`
  now binds React Native's `AppState` to `context.paused`, which suspends the
  whole `AudioContext` rather than only pausing instances. Anything that is
  not `active` counts as backgrounded, so iOS's transient `inactive` (the app
  switcher, a notification shade) goes quiet too.

## [0.2.1] - 2026-08-15

### Fixed

- **Cues were audible about a second late.** Two causes, both of them things
  this environment silently skips:

  - `react-native-audio-api` exposes `setAudioSessionActivity` and never calls
    it, so nothing held the platform audio session and the output stream was
    acquired lazily. `initAudio()` now claims it.
  - `@pixi/sound` warms the graph with a one-sample silent buffer from its
    autoplay-unlock path, gated on `_locked`, which it computes as
    `state === 'suspended' && ('ontouchstart' in globalThis || 'onclick' in
globalThis)`. React Native has neither, so `_locked` is always false and the
    warm-up was dead code here. `initAudio()` now calls `playEmptySound()`
    directly, which also resumes a context that started suspended.

## [0.2.0] - 2026-08-15

### Changed

- **Importing this package is now inert, so a plain `import` is safe.**
  Previously the shim installed the Web Audio globals at import, which made
  `@pixi/sound`'s module-scope `new SoundLibrary()` see `supported === true` and
  construct a real `AudioContext` during BUNDLE EVALUATION — before React
  renders and before any error boundary exists. In the game this package was
  built for, that killed the app on launch with a blank screen and nothing in
  the JS logs. Consumers had to `require()` the package from inside an effect to
  avoid it.

  Only the pure-JS DOM stubs run at import now. The native half moved behind
  **`initAudio()`**, which a host calls from an effect.

- `react-native-audio-api` is `require`d lazily rather than imported: its module
  constructor runs `NativeAudioAPIModule.install()` and throws when the native
  module is missing, so a static import made merely importing this package fatal
  on a binary without it. Confined to one place here so no consumer repeats it.

- **`OfflineAudioContext` is an adapter, not the real class.**
  `WebAudioContext`'s constructor builds one unconditionally — a two-sample
  context — and uses it for exactly one thing, `decodeAudioData`. In a browser
  that is free. Here its constructor calls `createAudioRuntime()`, which does
  `createWorkletRuntime('AudioWorkletRuntime')`, so the live `AudioContext`
  built one line earlier and this one both spin up a Reanimated worklet
  runtime, **under the same name, milliseconds apart, at startup**. The
  stand-in provides the one method actually used, backed by the same native
  decoder, and creates no second runtime.

- `initAudio()` **never throws** and returns whether audio came up; a host that
  gets `false` should carry on without sound. Audio is an enhancement, and
  context construction reaches far enough into the platform that it must be
  allowed to fail.

### Added

- `initAudio()`, `audioManager()`, `soundDiagnostics()`,
  `installWebAudioGlobals()`, `nativeAudio()`.

### Migrating from 0.1.0

Call `initAudio()` in an effect before loading anything, and replace any
defensive `require('@pixi-rn/sound')` with an ordinary import.

## [0.1.0] - 2026-08-14

### Added

- Initial release. `@pixi/sound` on React Native, backed by
  `react-native-audio-api`: the Web Audio globals it expects, installed in the
  order it needs them, and the library re-exported unchanged.

- The import-order guarantee. `@pixi/sound` reads `document` at module scope, so
  importing it directly on Hermes throws `ReferenceError: document is not
defined` before any user code runs. Importing from this package installs the
  shim first.

- A unity-gain `GainNode` standing in for `createDynamicsCompressor()`, which
  `@pixi/sound`'s `WebAudioContext` constructor calls unconditionally and
  `react-native-audio-api` does not implement. Without it the context cannot be
  constructed at all. The cost is no master limiting — see the README.
