# pixi-rn

pixi.js **v8** inside React Native, on `expo-gl` — renderer bring-up, texture
upload, bitmap text, and a seam that lets pixi draw your UI while React Native
keeps layout and input.

Extracted from a shipping game after each of the failures below cost a device
build to even *observe*. They are all silent: a black `GLView`, a dead process,
or a control drawn where nothing can tap it.

## Why this exists

Pixi assumes a browser. React Native has no DOM, no `new Function` (Hermes), and
`expo-gl` is an ES3 context wearing a WebGL costume that fits badly in three
specific places. Getting a v8 renderer up is not "call `app.init()`".

### The one that matters most

Pixi v8 picks its backend with:

```js
webGLVersion = gl instanceof ADAPTER.getWebGLRenderingContext() ? 1 : 2
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
pixi has already overwritten `gl.createVertexArray` with a call *into your
shim*, and the two recurse until the stack overflows and Hermes takes the
process down.

This package answers the question pixi is actually asking.

### The others

- **`Ticker.shared` / `Ticker.system` are booby traps.** Three v8 singletons
  park a listener on one during `renderer.init()` — `SchedulerSystem`,
  `EventsTicker`, `CanvasObserver` — and each starts its own background rAF,
  running outside your try/catch *and* outside any error boundary. A throw there
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
/>
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
    stage('simulate'); world.step(dtMs);
    stage('render');   renderer.render({ container: stage });
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

## The UI seam

The interesting part. Pixi has **no layout engine**; React Native's flexbox is
excellent and its touch handling is what users expect. So don't choose: RN keeps
layout, text content and input, and publishes *what to draw and where*. Pixi
draws it inside the frame it already renders.

```tsx
function Panel({ children }) {
  const { ref, onLayout } = useChrome(
    (x, y, w, h) => ({ kind: 'nine', tex: 'panel', x, y, w, h, inset: 8, corner: 16 }),
    [],
  );
  return (
    <View ref={ref} onLayout={onLayout} collapsable={false}>
      <ChromeDepthProvider>{children}</ChromeDepthProvider>
    </View>
  );
}
```

The component renders a **transparent** `View` that holds its normal place in
the flex layout. Nothing about your layout changes.

### Four rules, each learned the hard way

1. **Wrap children in `ChromeDepthProvider`.** Paint order comes from nesting
   depth, not publication order — React runs effects *child-first*, so a
   container publishes *after* the content inside it. Without this, panels paint
   over their own contents.
2. **Call `bumpChromeLayout()` when something moves a screen without resizing
   it.** `onLayout` fires when a view's own box changes, *not* when it merely
   moves because an ancestor did. A late safe-area inset, a screen parking
   off-screen — the art stays behind while the touch targets slide away.
3. **Wrap scrollers in `useChromeScrollRegion()`.** A scroll is the one mover a
   bump can't fix; the region reports one offset per scroll event and the layer
   applies it as a delta, then clips to the viewport.
4. **You will miss a mover.** That list is unbounded — so `tickChromeSweep()`
   re-measures one element per frame, round-robin, and any drift self-corrects
   within about a second whatever caused it. Call it from your frame loop.

## Text

`BitmapText` is the only text pixi can draw here — but that's an advantage: a
bitmap font's advance widths are plain numbers, so `measureText()` returns a
label's exact size **synchronously, with no native call**. That's what lets a
text component size its own `View` and keep flex layout working.

```tsx
installBitmapFont(atlas, metrics);   // metrics = BMFont JSON
<PixelText text="SCORE" color="#FFD700" style={{ fontSize: 12, letterSpacing: 1 }} />
```

⚠️ Bake the atlas as a **plain alpha mask, not MSDF**, if your font is pixel art
— a distance field renders antialiased edges by design.

⚠️ `measureText` must agree with pixi's own layout (`xAdvance` + `letterSpacing`
per character, counted after the last one too), since one sizes the View and the
other positions the glyphs.

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

## Licence

MIT.
