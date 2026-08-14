# pixi-rn

pixi.js **v8** inside React Native, on `expo-gl` — renderer bring-up, texture
upload, bitmap text, native touch → Pixi events, a small flex layout pass, and
a retained UI widget kit built on top of it.

Each of the failures below cost a device build to even _observe_ before this
existed to prevent them. They are all silent: a black `GLView`, a dead
process, or a control drawn where nothing can tap it.

## Why this exists

Pixi assumes a browser. React Native has no DOM, no `new Function` (Hermes), and
`expo-gl` is an ES3 context wearing a WebGL costume that fits badly in three
specific places. Getting a v8 renderer up is not "call `app.init()`".

### The one that matters most

Pixi v8 picks its backend with:

```js
webGLVersion = gl instanceof ADAPTER.getWebGLRenderingContext() ? 1 : 2;
```

That's correct in a browser, where `WebGL2RenderingContext` is an unrelated
interface. **expo-gl deliberately makes `WebGL2RenderingContext` extend
`WebGLRenderingContext`**, so the plain global answers "yes, WebGL1" for a
WebGL2 context and pixi silently runs its WebGL1 backend on ES3.

That backend cannot work here. It rewires `gl.createVertexArray` and
`drawElementsInstanced` out of `getExtension('OES_vertex_array_object')` /
`('ANGLE_instanced_arrays')`, but EXGL **removes the VAO extension from
`getSupportedExtensions()` outright** and returns a bare `{}` — no entry points
— for everything else. It throws during init, or calls a missing method on the
first draw. Shim the extension back onto the native VAO methods and it's worse:
pixi has already overwritten `gl.createVertexArray` with a call _into your
shim_, and the two recurse until the stack overflows and Hermes takes the
process down.

This package answers the question pixi is actually asking.

### The others

- **`Ticker.shared` / `Ticker.system` are booby traps.** Three v8 singletons
  park a listener on one during `renderer.init()` — `SchedulerSystem`,
  `EventsTicker`, `CanvasObserver` — and each starts its own background rAF,
  running outside your try/catch _and_ outside any error boundary. A throw there
  is an unattributable fatal. (`CanvasObserver` calls
  `canvas.getBoundingClientRect()` every frame, which no stub canvas has.) Both
  tickers are parked before init.
- **`extensions.remove()` is a request, not a guarantee** — in v8 `EventSystem`
  and `DOMPipe` are still constructed afterwards, so the DOM stub has to stay
  complete enough for them to run harmlessly.
- **No `Graphics`, no `Texture.WHITE`, no pixi `Text`** — all lazily rasterize a
  2D canvas. Solid colour is a tinted 1×1 buffer texture; 9-slice is
  `NineSliceSprite` (mesh-based, safe); text is `BitmapText`.
- **`gl.getParameter` throws** for the object-binding pnames EXGL never
  implemented, and pixi queries several during `contextChange`.

## Install

```sh
npm install pixi-rn pixi.js expo-gl expo-asset
```

## Package layout

One folder per concern, each with a barrel `index.ts`. Everything below is
re-exported from the package root, so `import { ... } from 'pixi-rn'` covers
all of it — except the modules that touch a NATIVE capability. Those live
behind their own entry points (`pixi-rn/audio`, `pixi-rn/haptics`), so a
consumer only takes on a native dependency for a feature they actually use:

```
src/
  core/     adapter bring-up, renderer construction, the frame loop,
            expo-gl texture upload, the diagnostics hook
  input/    native touch → Pixi v8 federated events
  text/     bitmap font install + synchronous JS measurement, fitFontSize
  layout/   the flex layout pass (no Yoga/WASM — see below)
  ui/       retained widgets built on layout + text: rect, image, panel,
            label, padNumber, button, slider, scroll list, decoratedBox,
            plus layerStack's UiLayerStack (a generic snapshot-driven,
            multi-layer screen root) and color's outline-colour helpers
  perf/     Pool, a retained-scene-graph node pool
  animation/  Tween and Shake (both dtMs-driven), easing curves, lerp
  haptics/  fail-soft vibration feedback — NOT in the root barrel; import
            from 'pixi-rn/haptics' (needs `npx expo install expo-haptics`;
            installing @pixi-rn/haptics upgrades Android to the media
            vibration channel, no import and no call-site change)
  audio/    pooled expo-audio playback — NOT in the root barrel; import
            from 'pixi-rn/audio' (needs `npx expo install expo-audio`)
testing/    an EXGL-faithful mock GL context for offline smoke tests
docs-site/  the guide site (getting started, concepts, examples) — its own
            Next.js + Fumadocs app; see its own README
```

## Renderer

```tsx
import { GLView } from 'expo-gl';
import { createRenderer, loadSheet, makeWhiteTexture } from 'pixi-rn';

<GLView
  style={StyleSheet.absoluteFill}
  onContextCreate={async (gl) => {
    const renderer = await createRenderer(gl, { width, height });
    const sprites = await loadSheet('atlas', require('./atlas.png'));
    // …build your scene, then drive it from ONE rAF loop:
    const tick = () => {
      renderer.render({ container: stage });
      gl.flush();
      gl.endFrameEXP();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }}
/>;
```

Textures upload through `expo-gl`'s `texImage2D(…, asset)` — the pixel data
never round-trips through JS, which is the only workable path since RN has no
DOM image decoding.

## The frame loop

One `requestAnimationFrame`, owned in one place — small, but it is the part of
an expo-gl app that is easy to get expensively wrong:

```tsx
const stop = startFrameLoop({
  gl,
  onFrame: (now, dtMs, stage) => {
    stage('simulate');
    world.step(dtMs);
    stage('render');
    renderer.render({ container: stage });
  },
  onError: (error, stage) => showSomewhereVisible(`${stage}: ${error.message}`),
});
```

- **A rAF callback has no error boundary.** React can't catch it and neither can
  the host, so a throw is an unattributable crash — on React Native it takes the
  process down with a stack that names nothing. And without stopping, a throwing
  frame throws again every 16ms and buries the first one. `stage()` records what
  was running; the loop catches, reports, and stops.
- **expo-gl only presents when you say so.** Forgetting `endFrameEXP()` is a
  permanently black surface with no error anywhere. The loop does it.
- **`dtMs` is clamped** so a GC pause or a backgrounding doesn't teleport your
  simulation through a wall; the true gap comes alongside for measurement.
- **One loop.** `createRenderer` parks pixi's shared tickers for the same reason,
  so everything that needs a frame runs off this one.

## Input

React Native's touch responder system is the only input source here — there is
no DOM for Pixi's own `EventSystem` to listen to. `createNativeEventBridge`
keeps pixi v8's federated `EventBoundary` semantics (normal `eventMode`,
hit-testing, capture/bubble) and only adapts native pointer coordinates into it:

```tsx
const events = createNativeEventBridge(stage);
// from your surface's responder handlers:
events.dispatch({ type: 'down', x: touch.locationX, y: touch.locationY });
```

Every widget in `ui/` (`UiButton`, `UiSlider`, `UiScrollList`, …) is built on
plain `eventMode`/`pointertap`/`pointerdown` handlers, so this bridge is the
only input plumbing a host ever has to write.

## Layout

Pixi has no layout engine, and `@pixi/layout` isn't an option here: it
peer-depends on `yoga-layout@^3`, which ships only a WASM binary, and Hermes
has no `WebAssembly` global — importing it kills `renderer.init()` before the
first frame.

`applyFlexLayout` is a hand-written subset of the flex vocabulary instead —
`width`/`height` (number, `%`, `auto`), row/column, `justifyContent`,
`alignItems`/`alignSelf` including `stretch`, `flex` (grow), `flexShrink`,
`gap`, padding, margin, and `position: 'absolute'`. Not supported: wrapping,
`flexBasis`, reverse directions, `space-around`.

```tsx
container.layout = { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center' };
applyFlexLayout(root); // full measure + arrange — call on rebuild, not per frame
```

A node only takes part in layout if it _has_ a `layout` style — a plain
`Container` with none is skipped whole-subtree, which is how you hand-position
decoration inside an otherwise-laid-out tree.

## The UI widget kit

Retained, canvas-free primitives — `Graphics`, `Text` and `Texture.WHITE` all
need a DOM canvas this stack doesn't have, so callers provide uploaded
textures (including a 1×1 white one from `makeWhiteTexture()` for solid fills).
Every widget reports its size to `applyFlexLayout` via `measureLayout()` and
receives its final box via `applyLayout()` — nothing paints at a size before
that, which is what lets a row stretch a panel or ellipsize a label after the
fact.

| Widget           | What it is                                                            |
| ---------------- | --------------------------------------------------------------------- |
| `UiRect`         | a tinted 1×1 texture — the only solid fill available                  |
| `UiImage`        | a sprite at an exact destination size                                 |
| `UiPanel`        | a nine-slice panel (`NineSliceSprite`, mesh-based — safe here)        |
| `UiLabel`        | a `BitmapText` label with the classic 8-copy pixel outline            |
| `UiPadNumber`    | a fixed-width, zero-padded counter (dimmed leading zeros) — see below |
| `UiButton`       | a hit rectangle that follows its resolved box, press/release/tap      |
| `UiSlider`       | horizontal drag, reports its value once per gesture (see below)       |
| `UiScrollList`   | a clipped, kinetically-scrolling vertical list                        |
| `UiDecoratedBox` | a flex box with resizable background layers — see below               |

`UiSlider.onValueChange` fires **once, when the gesture ends** — not on every
move. A host that turns a live value into React state will re-render, and a
retained UI rebuilt mid-gesture destroys the slider along with its pointer
capture; reporting continuously would also put a full host render between every
pair of move events.

`UiScrollList` needs a frame tick to advance its kinetic glide —
`list.update(dtMs)`, called from your own loop, never from a `setInterval` of
its own (a timer callback lands wherever the queue puts it, squarely inside
frames the renderer was due to draw).

### `UiPadNumber` — a live counter that never triggers layout

The arcade-odometer HUD idiom: a fixed-width, zero-padded counter whose
leading zeros draw dimmer than the significant digits.

```tsx
const score = new UiPadNumber({ digits: 5, suffix: 'm', fontSize: 18, color: 0xffd700, leadColor: 0x8b90a0 });
score.set(1204); // draws "01204m", the "0" dim and "1204m" bright
```

The font is fixed-advance, so the padded string's rendered width never changes
with the value — `set()` only touches the two digit runs' text (`UiLabel`'s
own identity guard early-outs when a run didn't change) and never triggers a
flex layout pass. That is the whole reason to reach for this over a plain
`UiLabel` for a value that updates every frame: a counter driven through
ordinary React-style rebuilds would re-measure and re-arrange its row on every
tick, and a neighbouring control would visibly twitch as digits rolled over.

### `UiDecoratedBox` — panels with a resizable background

A background can't be an ordinary flow child: it has to cover whatever box the
flow children end up defining, which is only known after layout runs, not
before. `UiDecoratedBox` is the general form of the trick `UiPanel` already
uses for its own nine-slice border — one or more `UiDecoration`s (anything
with a `resize(width, height)` method; `UiRect`, `UiImage` and `UiPanel` all
already qualify) that sit in a plain, layout-less child and get resized once
the box's own layout is final:

```tsx
const card = new UiDecoratedBox({
  layout: { padding: 12, gap: 6 },
  decor: [new UiRect(white, { width: 1, height: 1, color: 0x1a1410 }), new UiPanel(frameTexture, { inset: 8 })],
});
card.addChild(someLabel, someRow); // ordinary flow children, laid out as usual
```

### `UiLayerStack` — the screen-swap pattern

The other piece almost every retained-Pixi UI needs: an ORDERED set of
persistent layers (a HUD, a modal screen on top of it, a transient toast on
top of that), each rebuilt only when the data driving it changes, with a
shared press-absorbing blocker so a tap that misses every control on a modal
layer doesn't fall through to whatever the host mounts underneath.

```tsx
const ui = new UiLayerStack({
  width: W,
  height: H,
  // paint order: hud is bottom, screen sits over it, overlay is topmost.
  // only `screen` is modal — a HUD counter never blocks a press by itself.
  layers: [{ name: 'hud' }, { name: 'screen', blocking: true }, { name: 'overlay' }],
});
stage.addChild(ui.root);

// once per frame, however your data arrives — each layer keyed by whatever
// identity should trigger ITS rebuild (often the same snapshot for all three):
const hud = ui.update('hud', snapshot, (s) => (inRun ? new Hud(s) : null), dtMs);
ui.update('screen', snapshot, (s) => buildScreenFor(s), dtMs);
ui.update('overlay', snapshot, (s) => buildToastFor(s), dtMs);
```

`build` is only called when the layer's `key` is a **different object** than
last time — an O(1) identity check, not a deep comparison. That is deliberate:
hand in a fresh object per render and never mutate one afterwards, and `!==`
becomes exactly "the host re-rendered." Each layer also walks its own rebuilt
tree for `UiScrollList`s and drives them every frame, so a host never has to
track that set itself.

`update()` returns the layer's current content, so a host that needs a typed
handle for a value that updates every frame _without_ going through the
identity-gated rebuild — a HUD's live metre/coin counters, say — can keep it
and write into it directly, bypassing `build` entirely on the frames nothing
structural changed. `layer(name)` returns a layer's own PERSISTENT container
(stable for the stack's lifetime, independent of whatever content is rebuilt
into it) for a host that wants to animate the layer itself — position it,
scale it for a pop-in — rather than its rebuilt content.

## Text

`BitmapText` is the only text pixi can draw here — but that's an advantage: a
bitmap font's advance widths are plain numbers, so `measureText()` returns a
label's exact size **synchronously, with no native call**. That's what lets a
text component size its own layout box while React Native (or `applyFlexLayout`
above) keeps the rest of the layout working.

```tsx
installBitmapFont(atlas, metrics); // metrics = BMFont JSON
const label = new UiLabel('SCORE', { fontSize: 12, letterSpacing: 1, outline: { color: 0x000000 } });
```

⚠️ Bake the atlas as a **plain alpha mask, not MSDF**, if your font is pixel art
— a distance field renders antialiased edges by design.

⚠️ `measureText` must agree with pixi's own layout (`xAdvance` + `letterSpacing`
per character, counted after the last one too), since one sizes the label's box
and the other positions the glyphs.

### Two small helpers that come up in every pixel-art kit

`fitFontSize(texts, maxWidth, sizes)` returns the largest of `sizes` at which
**every** string in `texts` fits `maxWidth`, or the smallest when none does —
for a label whose translation might be a lot longer in one locale than the
English original it was tuned against:

```tsx
const size = fitFontSize([t('revive'), t('giveUp')], CARD_WIDTH, [15, 13, 11]);
```

`autoOutlineColor(foreground)` picks a legible pixel-outline colour for a
foreground colour — dark behind light text, light behind dark text — by
perceived luminance (`perceivedLuminance` is exported too, for anything that
wants the raw number). A single fixed outline colour only works while every
label in a kit is the same tone; the moment the same kit draws light labels on
a dark panel AND dark labels on a cream one, a constant outline goes invisible
on one of them.

## Testing without a device

`testing/mockExgl.mjs` is an EXGL-faithful mock context — faithful about the
three things that actually break: the `WebGL2 extends WebGL1` prototype chain,
`getExtension()` returning a bare `{}`, and the `getParameter`/unimplemented
reject lists. Programs are reflected by parsing the GLSL attached to them.

```js
import { createMockExglContext } from 'pixi-rn/testing/mockExgl.mjs';

const { gl } = createMockExglContext();
const renderer = await createRenderer(gl, { width: 390, height: 844 });
// assert renderer.context.webGLVersion === 2, render frames, inspect calls
```

It can't tell you anything about pixels — but every failure listed at the top of
this file is catchable with it, in seconds, instead of an EAS build.

## API docs

The full API reference is generated with [TypeDoc](https://typedoc.org) from
the doc comments on every exported symbol — one entry point per published
subpath (`typedoc.json`'s `entryPoints`), so `pixi-rn/audio` and
`pixi-rn/haptics` are covered alongside the root barrel. **A new subpath needs
its entry point added there**, or it silently disappears from the reference.

```sh
npm run docs                    # from packages/pixi-rn
npm run docs:pixi-rn            # from the repo root
```

Outputs a self-contained static site to `packages/pixi-rn/docs/` (gitignored —
regenerate it rather than committing it); open `docs/index.html`, or serve it
with anything that serves static files (`npx serve docs`).

For guides, concepts and worked examples beyond the type-level reference, see
[`docs-site/`](./docs-site) — a [Fumadocs](https://fumadocs.dev) site
(`npm run docs:site` from the repo root) that converts this generated
reference into native pages under `/docs/api` at build time. It lives inside
this package (not beside it) so that mirroring `packages/pixi-rn` alone still
carries the whole docs site with it.

## Licence

MIT.
