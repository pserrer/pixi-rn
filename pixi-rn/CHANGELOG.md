# Changelog

All notable changes to `pixi-rn` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/).

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
