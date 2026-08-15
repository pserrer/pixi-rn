// The Web Audio globals `@pixi/sound` expects, backed by `react-native-audio-api`.
//
// ⚠️ THIS MODULE MUST BE EVALUATED BEFORE `@pixi/sound` IS IMPORTED. That library
// reads `document` at MODULE SCOPE (format detection builds an <audio> element to
// call canPlayType on it), so importing it first throws
// `ReferenceError: document is not defined` before any of your code runs.
// `index.ts` guarantees the order for anyone importing THIS package; a consumer
// who imports `@pixi/sound` directly somewhere else loses that guarantee — same
// hazard as pixi-rn's own adapter module.
import {
  AudioContext as RNAudioContext,
  OfflineAudioContext as RNOfflineAudioContext,
  AudioBuffer as RNAudioBuffer,
} from 'react-native-audio-api';

const g = globalThis as unknown as Record<string, unknown>;

/**
 * `react-native-audio-api` implements no `DynamicsCompressorNode`, and
 * `@pixi/sound`'s `WebAudioContext` constructor calls `createDynamicsCompressor()`
 * unconditionally — so without this, constructing the context is a TypeError and
 * nothing plays at all.
 *
 * A unity-gain `GainNode` stands in. It is a pass-through: it connects and
 * disconnects like the real node and leaves the signal untouched, which means no
 * master limiting. For game SFX mixed at sane levels that is the right trade;
 * if you drive many loud sources at once you may clip where a browser would not.
 */
class AudioContext extends RNAudioContext {
  createDynamicsCompressor() {
    const passthrough = this.createGain();
    passthrough.gain.value = 1;
    return passthrough;
  }
}

// React Native usually defines `window` as an alias of the global object, but
// never rely on it: `@pixi/sound` resolves its context as
// `window.AudioContext || window.webkitAudioContext`.
if (!g.window) g.window = g;

const win = g.window as Record<string, unknown>;
win.AudioContext = g.AudioContext = AudioContext;
win.OfflineAudioContext = g.OfflineAudioContext = RNOfflineAudioContext;
g.AudioBuffer = RNAudioBuffer;

// `Sound.from` narrows its argument with `x instanceof HTMLAudioElement`. That is
// a bare global reference, so an undefined one is a ReferenceError rather than a
// falsy check — it needs to exist even though nothing here can ever be one.
if (!g.HTMLAudioElement) g.HTMLAudioElement = class HTMLAudioElement {};

// Enough of a document for the module-scope format probe. `canPlayType` returning
// '' reports "this environment plays no HTML audio", which is true and is what
// keeps `@pixi/sound` on its WebAudio path (`useLegacy` stays false).
if (!g.document) {
  g.document = {
    createElement: (tag: string) => (tag === 'audio' ? { canPlayType: () => '' } : {}),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}
