# Changelog

All notable changes to `pixi-rn` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/).

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
