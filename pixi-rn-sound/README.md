# `@pixi-rn/sound`

[`@pixi/sound`](https://pixijs.io/sound/) on React Native, backed by
[`react-native-audio-api`](https://github.com/software-mansion/react-native-audio-api)
— the real Web Audio graph: filters, per-instance volume and speed, sprites,
`decodeAudioData`.

This package is glue, not a reimplementation. It installs the Web Audio globals
`@pixi/sound` expects, in the right order, and re-exports the library unchanged.

## Install

```sh
npm install @pixi-rn/sound @pixi/sound react-native-audio-api
```

```ts
import { sound } from '@pixi-rn/sound';

await sound.add('coin', require('./assets/coin.wav'));
sound.play('coin');
```

Import from `@pixi-rn/sound`, **never from `@pixi/sound` directly** — see below.

> [!WARNING]
> `react-native-audio-api` is native code, so this needs a development or EAS
> build. It cannot run in Expo Go and cannot reach a device over OTA.

## Why the import has to come from here

`@pixi/sound` touches `document` at **module scope** — its format detection
builds an `<audio>` element to call `canPlayType` on. Import it directly on
Hermes and it throws `ReferenceError: document is not defined` before any of
your code runs.

`index.ts` imports the shim first and only then re-exports the library. Within a
module, ES evaluation order follows source order, so that ordering is guaranteed
— but only for imports that go through this package. A direct
`import '@pixi/sound'` anywhere in your graph can still evaluate first and
throw.

## ⚠️ Import it lazily, not at module scope

`@pixi/sound` builds its `sound` singleton as the **last statement of its
module**, and that constructor constructs a real `AudioContext` — plus an
`OfflineAudioContext`, a compressor and an analyser. On React Native those are
native calls, so a static `import` starts the audio engine during **bundle
evaluation**: before React renders, before any error boundary exists.

In this game that tore the app down with nothing on screen and nothing in the
JS logs. Require it from inside an effect instead:

```ts
useEffect(() => {
  const { sound, addSound } = require('@pixi-rn/sound') as typeof import('@pixi-rn/sound');
  // ...
}, []);
```

A type-only `import type { Sound } from '@pixi-rn/sound'` is free — it is
erased at compile time and never reaches the bundle.

## What is shimmed

| global                                | backed by                                      |
| ------------------------------------- | ---------------------------------------------- |
| `AudioContext`, `window.AudioContext` | `react-native-audio-api`, plus one patch below |
| `OfflineAudioContext`                 | `react-native-audio-api`                       |
| `AudioBuffer`                         | `react-native-audio-api`                       |
| `HTMLAudioElement`                    | empty class — only an `instanceof` target      |
| `document.createElement('audio')`     | stub whose `canPlayType` returns `''`          |

`canPlayType` reporting nothing is accurate — there is no HTML audio here — and
it is what keeps `@pixi/sound` on its WebAudio path instead of the legacy one.

## The one real gap: no dynamics compressor

`react-native-audio-api` implements no `DynamicsCompressorNode`, and
`@pixi/sound`'s `WebAudioContext` constructor calls `createDynamicsCompressor()`
unconditionally — so without a stand-in, constructing the context throws and
nothing plays at all.

This package substitutes a **unity-gain `GainNode`**: it connects and
disconnects like the real node and leaves the signal untouched. The practical
consequence is **no master limiting**. For game SFX mixed at sane levels that is
the right trade; if you drive many loud sources at once you may clip where a
browser would not. `sound.context.compressor` is that gain node, so reading
compressor-specific params (`threshold`, `knee`, `ratio`) gets you `undefined`
rather than a number.

## Relationship to `pixi-rn/audio`

[`pixi-rn`](https://www.npmjs.com/package/pixi-rn) ships a much smaller audio
module of its own, built on `expo-audio`: pooled one-shot players and a looping
player, tuned to keep native calls off the frame path. They solve different
problems.

|                                      | `pixi-rn/audio` | `@pixi-rn/sound`         |
| ------------------------------------ | --------------- | ------------------------ |
| backend                              | `expo-audio`    | `react-native-audio-api` |
| model                                | pooled players  | a real Web Audio graph   |
| filters, sprites, per-instance pitch | no              | yes                      |
| Expo Go                              | yes             | no                       |

Reach for this one when you want the audio graph. Reach for `pixi-rn/audio` when
you want a handful of clips to fire cheaply.

## Licence

MIT.
