// GL bring-up: the Hermes/expo-gl compatibility adapter, renderer
// construction, the one frame loop, expo-gl texture upload, and the
// diagnostics hook they all report through.
export { fakeCanvas, pixiEnvReady } from './adapter';
export { setPixiRnLogger, type PixiRnLogger } from './log';
export { startFrameLoop, type FrameLoopOptions, type FrameStage } from './frameLoop';
export { createRenderer, type GLLike, type RendererOptions } from './renderer';
export { ExpoAssetSource, loadSheet, makeWhiteTexture, makeSlicer } from './textures';
