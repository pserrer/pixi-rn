// pixi-rn — pixi.js v8 inside React Native, on expo-gl.
//
// ⚠️ THE ADAPTER MUST EVALUATE FIRST, before any pixi class is touched, and
// importing it here is what guarantees that for every consumer regardless of
// their own import order. Everything else in the package imports
// 'core/adapter' too, but bundlers do not promise module-eval order across
// entry points.
import './core/adapter';
import './layout/layout';

export { fakeCanvas, pixiEnvReady } from './core/adapter';
export { setPixiRnLogger, type PixiRnLogger } from './core/log';

// The single frame loop: rAF, dt clamping, present, and error containment.
export { startFrameLoop, type FrameLoopOptions, type FrameStage } from './core/frameLoop';

// Renderer construction against an expo-gl context.
export { createRenderer, type GLLike, type RendererOptions } from './core/renderer';

// Texture upload through expo-gl (no DOM image decoding available).
export { ExpoAssetSource, loadSheet, makeWhiteTexture, makeSlicer } from './core/textures';

// A small flex layout pass for retained Pixi trees (no Yoga/WASM — Hermes has
// no WebAssembly global).
export { applyFlexLayout, layoutSize, type LayoutSize, type LayoutStyles } from './layout/layout';

// Bitmap font: the only text pixi can draw here, and the only text that can be
// measured synchronously in JS — which is what lets RN keep the layout.
export {
  installBitmapFont,
  loadBitmapFont,
  createBitmapText,
  measureText,
  fontBaseSize,
  fontFamily,
  type GeneratedBitmapFont,
  type GeneratedBitmapGlyph,
  type TextMetrics,
  type BitmapTextOptions,
} from './text/bitmapFont';
export { fitFontSize } from './text/fit';

// Native surface input → Pixi v8 federated events.
export {
  createNativeEventBridge,
  type NativeEventBridge,
  type NativePointerInput,
  type NativePointerType,
} from './input/events';

// Generic retained UI primitives, plus a snapshot-driven layer stack built on
// top of them. These are Expo-safe: no Graphics, Text, or canvas-backed
// Texture.WHITE.
export {
  createUiLayout,
  createUiRect,
  autoOutlineColor,
  perceivedLuminance,
  UiButton,
  UiDecoratedBox,
  UiImage,
  UiLabel,
  UiLayerStack,
  UiPadNumber,
  UiPanel,
  UiRect,
  UiScrollList,
  UiSlider,
  type AutoOutlineOptions,
  type UiRectOptions,
  type UiImageOptions,
  type UiLabelOptions,
  type UiDecoration,
  type UiDecoratedBoxOptions,
  type UiLayerConfig,
  type UiLayerStackOptions,
  type UiPadNumberOptions,
  type UiPanelOptions,
  type UiButtonOptions,
  type UiScrollListOptions,
  type UiSliderOptions,
} from './ui';
