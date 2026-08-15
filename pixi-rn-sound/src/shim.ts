// The Web Audio globals `@pixi/sound` expects, backed by `react-native-audio-api`.
//
// Split deliberately into two halves:
//
//   * the DOM stubs below run AT IMPORT. They are pure JavaScript and touch
//     nothing native, and they have to be in place before `@pixi/sound`
//     evaluates — it reads `document` at module scope, building an <audio>
//     element to call `canPlayType` on.
//
//   * the AUDIO globals are installed by `installWebAudioGlobals()`, which the
//     host calls from an effect. Nothing native happens until it does.
//
// That split is what lets a host write a plain `import` instead of a lazy
// `require`. Two separate things would otherwise fire native code during
// BUNDLE EVALUATION — before React renders, before any error boundary exists,
// where a failure is an unattributable silent tear-down:
//
//   1. `@pixi/sound` builds its `sound` singleton as the last statement of its
//      module, and that constructor builds a real `AudioContext` — but only
//      `if (this.supported)`, which is `window.AudioContext !== null`. With the
//      globals absent it skips that branch entirely and constructs only the
//      harmless HTML-audio context.
//   2. Importing `react-native-audio-api` runs `NativeAudioAPIModule.install()`
//      in a module-scope constructor, which THROWS when the native module is
//      missing. Hence the `require` inside the installer rather than an import
//      up here: it is the one place that ugliness is allowed to live, so no
//      consumer has to repeat it.

const g = globalThis as unknown as Record<string, unknown>;

// React Native usually defines `window` as an alias of the global object, but
// never rely on it: `@pixi/sound` resolves its context as
// `window.AudioContext || window.webkitAudioContext`.
if (!g.window) g.window = g;

// `Sound.from` narrows its argument with `x instanceof HTMLAudioElement`. That
// is a bare global reference, so an undefined one is a ReferenceError rather
// than a falsy check — it needs to exist even though nothing here is ever one.
if (!g.HTMLAudioElement) g.HTMLAudioElement = class HTMLAudioElement {};

// A `document` for `@pixi/sound`'s module-scope format probe, which builds an
// <audio> element to call `canPlayType` on.
//
// ⚠️ COMPOSE with whatever is already there, never replace it, and never skip
// on "a document exists". Other libraries install their own stub guarded the
// same way, so whichever module evaluates first would otherwise win outright:
//
//   * pixi-rn's adapter returns an element carrying a `style` object, because
//     pixi's DOMPipe does `element.style.position = ...` in its constructor —
//     and `extensions.remove(DOMPipe)` is a request, not a guarantee. Winning
//     that race with a bare `{}` here crashed pixi's pipe setup with
//     `Cannot set property 'position' of undefined`.
//   * this package needs `canPlayType`, which pixi's element does not have.
//
// So wrap the existing `createElement` and fill in only what is missing. Both
// libraries then get what they need regardless of import order.
type StubElement = Record<string, unknown> & { style?: Record<string, string> };
type DocumentLike = {
  createElement?: (tag: string) => StubElement;
  addEventListener?: (...args: unknown[]) => void;
  removeEventListener?: (...args: unknown[]) => void;
};

const existingDoc = (g.document ?? {}) as DocumentLike;
const createUnderlying = existingDoc.createElement?.bind(existingDoc);

g.document = {
  ...existingDoc,
  addEventListener: existingDoc.addEventListener ?? (() => {}),
  removeEventListener: existingDoc.removeEventListener ?? (() => {}),
  createElement(tag: string): StubElement {
    const el: StubElement = createUnderlying ? createUnderlying(tag) : {};
    // `''` is the honest answer: there is no HTML audio here, which is also
    // what keeps `@pixi/sound` on its WebAudio path rather than the legacy one.
    if (typeof el.canPlayType !== 'function') el.canPlayType = () => '';
    if (!el.style) el.style = {};
    if (typeof el.addEventListener !== 'function') el.addEventListener = () => {};
    if (typeof el.removeEventListener !== 'function') el.removeEventListener = () => {};
    return el;
  },
};

type NativeAudio = typeof import('react-native-audio-api');
let native: NativeAudio | null = null;
let loadFailed = false;
let loadError: string | null = null;

/**
 * The backend, loaded on first use.
 *
 * ⚠️ Deliberately a `require` and not an import — see the note at the top of
 * this file. Importing `react-native-audio-api` installs its JSI bindings in a
 * module-scope constructor and throws if the native module is absent, so
 * pulling it in at import time would make merely importing this package fatal
 * on a binary that does not carry it.
 */
export function nativeAudio(): NativeAudio | null {
  if (native) return native;
  if (loadFailed) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    native = require('react-native-audio-api') as NativeAudio;
  } catch (err) {
    // ⚠️ NEVER let this throw. `AudioAPIModule`'s constructor raises
    // `AudioApiError: Failed to install react-native-audio-api: The native
    // module could not be found` whenever the JS package is present but its
    // native half was not compiled into the binary — a real and easy state to
    // reach, since installing the JS does not link the native side.
    //
    // A caller's try/catch is not enough: this one reached React's passive
    // effect flush and became a FATAL EXCEPTION that took the process down
    // before the first screen. Reporting absence as null, here, is the only
    // place that reliably contains it.
    loadFailed = true;
    loadError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
  return native;
}

/** Why the backend could not be loaded, if it could not. */
export function nativeAudioError(): string | null {
  return loadError;
}

let installed = false;

/**
 * Install the Web Audio globals. Safe to call more than once.
 *
 * Called for you by {@link initAudio}; a host should not normally need it.
 */
export function installWebAudioGlobals(): boolean {
  if (installed) return true;
  const rn = nativeAudio();
  if (!rn) return false;

  /**
   * `react-native-audio-api` implements no `DynamicsCompressorNode`, and
   * `@pixi/sound`'s `WebAudioContext` constructor calls
   * `createDynamicsCompressor()` unconditionally — so without this,
   * constructing the context is a TypeError and nothing plays at all.
   *
   * A unity-gain `GainNode` stands in. It connects and disconnects like the
   * real node and leaves the signal untouched, which means there is no master
   * limiting: many loud simultaneous sources can clip where a browser would
   * not.
   */
  class AudioContext extends rn.AudioContext {
    createDynamicsCompressor() {
      const passthrough = this.createGain();
      passthrough.gain.value = 1;
      return passthrough;
    }
  }

  /**
   * A stand-in for `OfflineAudioContext`, and the reason is specific to this
   * backend rather than a shortcut.
   *
   * `WebAudioContext`'s constructor builds one unconditionally — `new
   * OfflineAudioContext(1, 2, sampleRate)`, a TWO-SAMPLE context — and uses it
   * for exactly one thing: `decodeAudioData`. In a browser that is free. Here,
   * `OfflineAudioContext`'s constructor calls `AudioAPIModule
   * .createAudioRuntime()`, which does `createWorkletRuntime('AudioWorkletRuntime')`
   * — so the live `AudioContext` built one line earlier and this one BOTH spin
   * up a Reanimated worklet runtime, under the same name, milliseconds apart at
   * startup.
   *
   * Nothing here needs an offline rendering context, so this provides the one
   * method that is actually used, backed by the same native decoder
   * `addSound` uses. It is an adapter, not a mock: `@pixi/sound`'s own decode
   * path keeps working through it.
   *
   * ⚠️ Do not "fix" this by handing over the real class. Anything genuinely
   * needing offline RENDERING (`startRendering`) should construct its own,
   * deliberately, after startup.
   */
  class OfflineAudioContext {
    readonly sampleRate: number;
    readonly length: number;
    readonly numberOfChannels: number;

    constructor(numberOfChannels: number, length: number, sampleRate: number) {
      this.numberOfChannels = numberOfChannels;
      this.length = length;
      this.sampleRate = sampleRate;
    }

    decodeAudioData(data: ArrayBuffer) {
      const rn = nativeAudio();
      if (!rn) return Promise.resolve(null);
      return rn.decodeAudioData(data, this.sampleRate);
    }
  }

  const win = g.window as Record<string, unknown>;
  win.AudioContext = g.AudioContext = AudioContext;
  win.OfflineAudioContext = g.OfflineAudioContext = OfflineAudioContext;
  g.AudioBuffer = rn.AudioBuffer;
  installed = true;
  return true;
}
