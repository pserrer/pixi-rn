// `@pixi/sound` on React Native, backed by `react-native-audio-api`.
//
// Importing this package is INERT — it installs a few pure-JS DOM stubs and
// nothing else. Native code is first touched by `initAudio()`, which a host
// calls from an effect. That is what makes a plain `import` safe here; see
// shim.ts for the two module-scope hazards it is dodging.
//
// The import order below is load-bearing: the stubs must exist before
// `@pixi/sound` evaluates, since it reads `document` at module scope. Within a
// module, ES evaluation order follows source order — do not reorder these.
import './shim';

export * from '@pixi/sound';
export { addSound, loadSounds, type SoundSource, type LoadSoundsOptions } from './load';
export { initAudio, audioManager, soundDiagnostics } from './init';
export { installWebAudioGlobals, nativeAudio } from './shim';
export { throttle } from './throttle';
export { TrackSwitcher } from './tracks';
export { FilterGroup } from './filterGroup';
export { sound as default } from '@pixi/sound';
