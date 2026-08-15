# `@pixi-rn/sound`

[`@pixi/sound`](https://pixijs.io/sound/) on React Native, backed by
[`react-native-audio-api`](https://github.com/software-mansion/react-native-audio-api)
— a real Web Audio graph: filters, per-instance volume and speed, sprites,
`decodeAudioData`. Plus a small set of playback helpers on top (throttling,
music-track switching, toggleable filter chains).

## Install

```sh
npm install @pixi-rn/sound @pixi/sound react-native-audio-api
```

```ts
import { sound, addSound, initAudio } from '@pixi-rn/sound';

useEffect(() => {
  initAudio();
  void addSound('coin', require('./assets/coin.wav'));
}, []);

sound.play('coin');
```

Always import from `@pixi-rn/sound` — never `import ... from '@pixi/sound'`
directly, and don't import `react-native-audio-api` yourself either. This
package re-exports everything `@pixi/sound` exports.

> [!WARNING]
> `react-native-audio-api` is native code, so this needs a development or EAS
> build. It cannot run in Expo Go and cannot reach a device over OTA.

## Bring the engine up

Call `initAudio()` from an effect — never at module scope or in a render body.
It's safe to call more than once (a no-op after the first success) and it
never throws:

```ts
useEffect(() => {
  if (!initAudio()) {
    const { lastError } = soundDiagnostics();
    // fall back to a silent game — audio is an enhancement
  }
}, []);
```

Importing the package by itself does nothing native — that only happens
inside `initAudio()`.

`initAudio()` also:

- claims the platform audio session, so the first cue plays without a delay
- primes the Web Audio graph with a silent buffer
- binds `AppState` so audio pauses while the app is backgrounded and resumes
  on return (covers iOS's transient `inactive`, e.g. the app switcher, too)

`soundDiagnostics()` returns `{ ready, lastError }`. `lastError: null` means
nothing threw — it does **not** mean audio is actually producing sound; no
platform reports that back.

## Loading clips

`require('./clip.wav')`, a URL string, or an `ArrayBuffer` of already-decoded
bytes are all valid sources.

```ts
const coin = await addSound('coin', require('./assets/coin.wav'), { volume: 0.8 });
coin.play();
```

`loadSounds` decodes a batch, one at a time, and returns whichever succeeded
— a clip that fails to decode is skipped rather than failing the whole batch:

```ts
const clips = await loadSounds(
  { jump: require('./jump.wav'), coin: require('./coin.wav') },
  {
    options: (name) => ({ volume: name === 'coin' ? 0.6 : 0.85, preload: true }),
    onError: (name, err) => console.warn(`sound "${name}" failed`, err),
    cancelled: () => unmounted, // stop and destroy the in-flight clip
  },
);
clips.jump?.play();
```

Every buffer is uncompressed float32 PCM in memory —
`seconds × sampleRate × channels × 4` bytes. Fine for short effects; a
minutes-long track costs tens of MB, so measure before loading one.

## Playback helpers

### `throttle` — rate-limit a bursty cue

```ts
const playCoin = throttle(() => coin.play(), 90);
for (const c of collectedThisFrame) playCoin(); // at most one play every 90ms
```

### `TrackSwitcher` — swap between looping tracks

For background music or ambience beds: switching pauses the track that's no
longer current instead of destroying it, so resuming picks up where it left
off.

```ts
const music = new TrackSwitcher<'menu' | 'level'>();
music.add('menu', menuTrack);
music.add('level', levelTrack);

music.play(inMenu ? 'menu' : 'level');
music.play(muted ? null : inMenu ? 'menu' : 'level'); // null = silence
music.setVolume(settings.musicVolume);
```

Every method is safe to call redundantly — `play`/`setVolume` only touch the
audio graph on an actual change. `add()` can register a track that finishes
loading after `play()` already asked for it; it starts immediately once
added. `TrackSwitcher` doesn't own its `Sound` objects — destroy them
yourself when you're done with them.

### `FilterGroup` — toggle a filter chain across a set of clips

```ts
const caveEcho = new FilterGroup(() => [new filters.ReverbFilter(1.6, 2.5)]);
caveEcho.add(jumpClip);
caveEcho.add(footstepLoop);

caveEcho.set(inCave); // on/off; a no-op if the state didn't change
```

`buildFilters` runs once, the first time the chain turns on, and the result
is reused — build a filter like `ReverbFilter` more than once per toggle and
you pay its setup cost (its impulse response is generated in a JS loop) every
time. A clip added while the chain is on picks it up immediately.

## Filters

`filters` is `@pixi/sound`'s own export, re-exported unchanged —
`ReverbFilter`, `EqualizerFilter`, `DistortionFilter`, `StereoFilter`,
`TelephoneFilter`, `MonoFilter`. Apply per clip (`clip.filters = [...]`)
rather than through `sound.filtersAll`, which is context-wide and reaches
every other sound too, including music.

## Known gaps

- **No `DynamicsCompressorNode`.** `sound.context.compressor` is a unity-gain
  passthrough, not a real compressor — reading `threshold`/`knee`/`ratio` off
  it gets you `undefined`. There is no master limiting: many loud
  simultaneous sources can clip where a browser wouldn't.
- **`OfflineAudioContext` only implements `decodeAudioData`.** If you need
  real offline rendering (`startRendering`), construct
  `react-native-audio-api`'s own `OfflineAudioContext` directly.
- **`document.createElement('audio').canPlayType()` always returns `''`.**
  There's no HTML `<audio>` here; this is what keeps `@pixi/sound` on its
  WebAudio code path.

## Relationship to `pixi-rn/audio`

[`pixi-rn`](https://www.npmjs.com/package/pixi-rn) ships a smaller audio
module of its own, built on `expo-audio`.

|                                      | `pixi-rn/audio` | `@pixi-rn/sound`         |
| ------------------------------------ | --------------- | ------------------------ |
| backend                              | `expo-audio`    | `react-native-audio-api` |
| model                                | pooled players  | a real Web Audio graph   |
| filters, sprites, per-instance pitch | no              | yes                      |
| Expo Go                              | yes             | no                       |

Reach for `@pixi-rn/sound` when you want the audio graph. Reach for
`pixi-rn/audio` when you want a handful of clips to fire cheaply and Expo Go
support matters.

## Licence

MIT.
