import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { sound } from '@pixi/sound';
import { installWebAudioGlobals, nativeAudio, nativeAudioError } from './shim';

let lastError: string | null = null;
let ready = false;
let appStateSub: NativeEventSubscription | null = null;
let backgroundedAt: number | null = null;

// A background gap past this is treated as a suspension long enough for the
// OS to have reclaimed the native audio session (locked-screen "deep sleep"),
// not an ordinary app-switch or notification-shade glance — see reviveOnResume.
const LONG_BACKGROUND_MS = 60_000;

/**
 * Stop audio while the app is backgrounded, and pick it up again on return.
 *
 * ⚠️ `@pixi/sound` has this — `autoPause`, on by default — but it implements it
 * with `globalThis.addEventListener('focus'|'blur')`, which NEVER FIRES in
 * React Native. So its background handling is dead code here, and music plays
 * on over the home screen unless something else stops it. `AppState` is the
 * platform's version of the same signal.
 *
 * `sound.stopAll()` runs FIRST, before suspending the context — not merely
 * "belt and suspenders" with `context.paused`. `@pixi/sound`'s pause model is
 * REPLAY-based: `WebAudioInstance.refreshPaused()` computes `pausedReal =
 * this._paused || sound.paused || global.paused`, and a transition from
 * paused back to un-paused calls `this.play({ start: this._elapsed % ...
 * })` — i.e. resuming ANY still-live instance means playing it again. Context-
 * level pause (`global.paused`) touches every instance of every Sound, and a
 * one-shot SFX has no OTHER paused flag keeping it paused once that clears —
 * unlike this game's music tracks, which stay silent across a resume because
 * `useMusic` independently calls `Sound.pause()` itself (setting the
 * PER-SOUND `sound.paused`, which survives the context flag clearing). A one-
 * shot SFX still in `_instances` at background time — anything played in the
 * last moment before switching apps, since an `AudioBufferSourceNode` isn't
 * pooled until it fires `onended` — would otherwise REPLAY itself the instant
 * the app came back, with no trigger from the game at all. `stopAll()` routes
 * through every instance's real `stop()` (not the internal one `refreshPaused`
 * uses), which pools it properly and leaves nothing to resume.
 *
 * iOS reports `inactive` for transient interruptions (the app switcher, a
 * notification shade). A game should go quiet for those too, so anything that
 * is not `active` counts as backgrounded.
 *
 * ⚠️ A background gap long enough for the OS to reclaim the native audio
 * session (a locked screen left for minutes/hours) leaves `paused = false`
 * un-pausing a session that is no longer actually there — the platform never
 * tells JS this happened, so nothing here can detect it directly. On a LONG
 * resume, {@link reviveOnResume} re-asserts the session and re-primes the
 * graph rather than trusting the context is still the one that was built.
 */
function bindAppState(): void {
  if (appStateSub) return;
  const ctx = sound.context as unknown as { paused: boolean; refreshPaused?: () => void };
  const apply = (state: AppStateStatus) => {
    try {
      if (state !== 'active') {
        backgroundedAt = Date.now();
        sound.stopAll();
        ctx.paused = true;
        ctx.refreshPaused?.();
        return;
      }
      const gap = backgroundedAt !== null ? Date.now() - backgroundedAt : 0;
      backgroundedAt = null;
      ctx.paused = false;
      ctx.refreshPaused?.();
      if (gap >= LONG_BACKGROUND_MS) reviveOnResume();
    } catch {
      // Backgrounding must never be able to throw into the host.
    }
  };
  appStateSub = AppState.addEventListener('change', apply);
}

/**
 * Re-assert the audio session and re-prime the graph — the same two calls
 * {@link initAudio} makes on first bring-up. Cheap and safe to repeat on a
 * context that never actually died; the point is the case where it did.
 */
function reviveOnResume(): void {
  void nativeAudio()
    ?.AudioManager.setAudioSessionActivity(true)
    .catch(() => {});
  const ctx = sound.context as unknown as { playEmptySound?: () => void };
  ctx.playEmptySound?.();
}

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

    // Hold the platform audio session. `react-native-audio-api` exposes this
    // and never calls it itself, and neither did we — so the output stream was
    // being acquired lazily (on Android, audio focus), which shows up as a long
    // delay before the first cue is audible. Fire-and-forget: it returns a
    // promise, and failing to get the session must not fail init.
    void nativeAudio()
      ?.AudioManager.setAudioSessionActivity(true)
      .catch(() => {});

    // Prime the graph with a one-sample silent buffer, and resume the context
    // if it started suspended.
    //
    // `@pixi/sound` has this exact primitive and normally runs it from its
    // autoplay-unlock path — but that path is gated on `_locked`, which it
    // computes as `state === 'suspended' && ('ontouchstart' in globalThis ||
    // 'onclick' in globalThis)`. React Native has neither, so `_locked` is
    // always false and the warm-up never fires. Calling it directly is what
    // makes the FIRST play cost the same as every later one.
    const ctx = sound.context as unknown as { playEmptySound?: () => void };
    ctx.playEmptySound?.();

    bindAppState();

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
