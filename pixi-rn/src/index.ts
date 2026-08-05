// pixi-rn — pixi.js v8 inside React Native, on expo-gl.
//
// ⚠️ THE ADAPTER MUST EVALUATE FIRST, before any pixi class is touched, and
// importing it here is what guarantees that for every consumer regardless of
// their own import order. Everything else in the package imports './adapter'
// too, but bundlers do not promise module-eval order across entry points.
import './adapter';

export { fakeCanvas, pixiEnvReady } from './adapter';
export { setPixiRnLogger, type PixiRnLogger } from './log';

// The single frame loop: rAF, dt clamping, present, and error containment.
export { startFrameLoop, type FrameLoopOptions, type FrameStage } from './frameLoop';

// Renderer construction against an expo-gl context.
export { createRenderer, type GLLike, type RendererOptions } from './renderer';

// Texture upload through expo-gl (no DOM image decoding available).
export { ExpoAssetSource, loadSheet, makeWhiteTexture, makeSlicer } from './textures';

// Bitmap font: the only text pixi can draw here, and the only text that can be
// measured synchronously in JS — which is what lets RN keep the layout.
export {
  installBitmapFont, loadBitmapFont, createBitmapText, measureText,
  fontBaseSize, fontFamily,
  type GeneratedBitmapFont, type GeneratedBitmapGlyph, type TextMetrics, type BitmapTextOptions,
} from './bitmapFont';

// The seam: RN publishes what to draw and where, pixi draws it in its own frame.
export {
  newChromeId, setChrome, clearChrome, chromeCommands, chromeCount,
  newChromeScrollId, setChromeScroll, setChromeScrollViewport, clearChromeScroll, chromeScroll,
  registerChromeMeasure, tickChromeSweep,
  setChromeSurfaceOrigin, chromeSurfaceOrigin,
  type ChromeCmd, type ChromeEntry, type SrcCrop, type UiTexKey,
} from './chrome';

export {
  useChrome, useChromeScrollRegion, ChromeDepthProvider, bumpChromeLayout,
  type ChromeSpec, type ChromeBinding,
} from './useChrome';

export { createUiChromeLayer, type UiChromeLayer, type ChromeTextures } from './chromeLayer';

export { PixelText } from './PixelText';
export { parseColor } from './color';
