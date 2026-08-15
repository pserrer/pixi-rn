import { sound, Sound, type Options } from '@pixi/sound';
import { nativeAudio } from './shim';

/** What `require('./clip.wav')` evaluates to in React Native (an asset id), a
 *  file/remote URI, or already-decoded bytes. */
export type SoundSource = number | string | ArrayBuffer;

/**
 * Decode a sound and register it with `@pixi/sound`.
 *
 * `@pixi/sound`'s own loaders fetch a URL, which is not how React Native
 * addresses a bundled asset — `require()` yields an opaque asset id, not a
 * path. `react-native-audio-api`'s `decodeAudioData` resolves all three source
 * forms natively (it runs `Image.resolveAssetSource` on an id), so decoding
 * first and handing `@pixi/sound` the finished `AudioBuffer` sidesteps the
 * loader entirely.
 *
 * Decoding is done ONCE, here. That is the structural difference from a
 * player-per-clip API: playback afterwards allocates only a buffer source, so
 * there is nothing to pre-warm and no seek cost to avoid.
 *
 * ⚠️ The buffer is uncompressed float32 PCM in memory — roughly
 * `seconds × sampleRate × channels × 4` bytes. Fine for short effects; a
 * minutes-long music track costs tens of MB, so measure before loading one.
 */
export async function addSound(alias: string, source: SoundSource, options?: Options): Promise<Sound> {
  const rn = nativeAudio();
  if (!rn) throw new Error('@pixi-rn/sound: no audio backend — the native side is not in this build');
  const buffer = await rn.decodeAudioData(source);
  if (!buffer) throw new Error(`@pixi-rn/sound: could not decode "${alias}"`);
  return sound.add(alias, { ...options, source: buffer });
}

export interface LoadSoundsOptions<K extends string> {
  /** Passed to every clip's `addSound` call. A function receives the clip's
   *  key, for a per-clip volume or loop flag. */
  options?: Options | ((name: K) => Options | undefined);
  /** Called for a clip that fails to decode. Defaults to ignoring it — the
   *  clip is simply absent from the returned map. */
  onError?: (name: K, err: unknown) => void;
  /** Polled after each clip decodes. Once it returns `true`, the clip just
   *  finished is destroyed instead of kept, and loading stops — for an
   *  effect that unmounted while a `loadSounds` call was still in flight. */
  cancelled?: () => boolean;
}

/**
 * Decode a batch of clips one at a time and return whichever ones succeeded.
 *
 * Sequential rather than `Promise.all` — decoding is native work, and
 * spreading several across a frame budget beats contending for it all at
 * once. A clip that fails to decode is skipped rather than failing the
 * batch, so one bad asset doesn't take the rest down with it.
 */
export async function loadSounds<K extends string>(
  sources: Record<K, SoundSource>,
  opts: LoadSoundsOptions<K> = {},
): Promise<Partial<Record<K, Sound>>> {
  const result: Partial<Record<K, Sound>> = {};
  for (const [name, source] of Object.entries(sources) as [K, SoundSource][]) {
    try {
      const perClip = typeof opts.options === 'function' ? opts.options(name) : opts.options;
      const clip = await addSound(name, source, perClip);
      if (opts.cancelled?.()) {
        clip.destroy();
        break;
      }
      result[name] = clip;
    } catch (err) {
      opts.onError?.(name, err);
    }
  }
  return result;
}
