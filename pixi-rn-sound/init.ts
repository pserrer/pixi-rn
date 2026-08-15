import { sound } from '@pixi/sound';
import { installWebAudioGlobals, nativeAudio, nativeAudioError } from './shim';

let lastError: string | null = null;
let ready = false;

/**
 * Bring the audio engine up. **Call this from an effect, never at module
 * scope** — it is the first thing here that touches native code.
 *
 * Importing this package is deliberately inert: with the Web Audio globals
 * absent, `@pixi/sound`'s own module-scope `new SoundLibrary()` sees
 * `supported === false` and skips building a context. This installs the
 * globals and re-runs `init()`, which is when the real `AudioContext` is
 * constructed — along with an `OfflineAudioContext`, a compressor and an
 * analyser, all of them native.
 *
 * **Never throws, and returns whether audio is usable.** Sound is an
 * enhancement; a host must be able to run without it. Construction reaches
 * far enough into the platform that a device with an unusual audio
 * configuration can fail here, and that must degrade to silence rather than
 * take the app down.
 *
 * ⚠️ A guard in JS cannot catch a crash on the NATIVE side. If a device dies
 * inside context construction rather than throwing, this returns nothing
 * useful because nothing survives to return — see {@link soundDiagnostics}.
 *
 * Idempotent: after the first success it is a no-op.
 */
export function initAudio(): boolean {
  if (ready) return true;
  try {
    if (!installWebAudioGlobals()) {
      lastError = nativeAudioError() ?? 'no audio backend in this build';
      return false;
    }
    if (!sound.supported) {
      lastError = 'no WebAudio backend (globals absent after install)';
      return false;
    }
    sound.init();
    ready = true;
    return true;
  } catch (err) {
    lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return false;
  }
}

/** What this module knows about its own state — useful when "there is no
 *  sound" and you need to separate "never initialised" from "initialised and
 *  something threw". ⚠️ `lastError: null` with `ready: false` means init was
 *  never called; it never means the device is producing sound. */
export function soundDiagnostics(): { ready: boolean; lastError: string | null } {
  return { ready, lastError };
}

/**
 * The platform audio session (iOS category and options, Android focus).
 *
 * ⚠️ Loaded on first call, so like {@link initAudio} this belongs in an effect.
 */
export function audioManager(): NonNullable<ReturnType<typeof nativeAudio>>['AudioManager'] | null {
  return nativeAudio()?.AudioManager ?? null;
}
