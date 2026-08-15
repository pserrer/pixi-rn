// `@pixi/sound` on React Native, backed by `react-native-audio-api`.
//
// The import order below is the entire point of this package: the shim installs
// the Web Audio globals, and only then is `@pixi/sound` allowed to evaluate.
// Within one module ES evaluation order follows source order, so this is
// guaranteed — do not reorder these two lines, and do not let a bundler-visible
// import of `@pixi/sound` appear above the shim anywhere in the graph.
import './shim';

export * from '@pixi/sound';
export { addSound, type SoundSource } from './load';

// Re-exported so a host has one import for the whole audio surface, and never
// has to reach past this package into the backend.
export { decodeAudioData, AudioManager } from 'react-native-audio-api';
export { sound as default } from '@pixi/sound';
