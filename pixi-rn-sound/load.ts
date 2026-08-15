import { sound, Sound, type Options } from '@pixi/sound';
import { decodeAudioData } from 'react-native-audio-api';

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
  const buffer = await decodeAudioData(source);
  if (!buffer) throw new Error(`@pixi-rn/sound: could not decode "${alias}"`);
  return sound.add(alias, { ...options, source: buffer });
}
