// Retained, canvas-free Pixi UI primitives for React Native / expo-gl.
//
// ⚠️ `Graphics`, `Text` and `Texture.WHITE` all create or depend on a DOM
// canvas, so none are usable here (see core/adapter.ts). Callers provide
// uploaded textures, including a 1×1 white one from `makeWhiteTexture()` for
// solid fills.
//
// Every primitive participates in `layout/layout.ts`'s flex pass through the
// same two hooks: `measureLayout()` reports intrinsic content size,
// `applyLayout()` receives the final box. Nothing paints at a size before
// `applyLayout` — that is what lets a row stretch a panel or ellipsize a
// label after the fact.
export { createUiLayout } from './container';
export { createUiRect, UiRect, type UiRectOptions } from './rect';
export { UiImage, type UiImageOptions } from './image';
export { UiPanel, type UiPanelOptions } from './panel';
export { UiLabel, type UiLabelOptions } from './label';
export { UiPadNumber, type UiPadNumberOptions } from './padNumber';
export { UiButton, type UiButtonOptions } from './button';
export { UiSlider, type UiSliderOptions } from './slider';
export { UiScrollList, type UiScrollListOptions } from './scrollList';
export { UiDecoratedBox, type UiDecoration, type UiDecoratedBoxOptions } from './decoratedBox';
export { UiLayerStack, type UiLayerConfig, type UiLayerStackOptions } from './layerStack';
export { perceivedLuminance, autoOutlineColor, type AutoOutlineOptions } from './color';
