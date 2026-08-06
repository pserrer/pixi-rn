// ── Pixi v8 on React Native (Hermes + expo-gl) ───────────────────────────────
// Pixi assumes a browser: a DOM adapter (`DOMAdapter`), `document` /
// `globalThis.addEventListener` for its event system, and `new Function` for
// uniform-sync codegen. This module makes the runtime safe BEFORE any renderer
// is created — import it first (src/game/pixi/index re-exports through here).
//
// - `pixi.js/unsafe-eval` self-installs on import: replaces the
//   `new Function`-generated uniform sync with an interpreter, which Hermes
//   requires (no runtime codegen).
// - `DOMAdapter`: the BrowserAdapter default touches `document` on first
//   use (e.g. Texture.WHITE lazily builds a 2D canvas). Our adapter returns
//   inert stubs — nothing in the game path uses 2D canvases, DOM fetch or XML.
//   (Avoid Graphics for exactly that reason: solid fills use a 1×1
//   BufferResource texture instead, see textures.ts.)
// - EventSystem.addEvents runs unconditionally on Renderer construction and
//   calls `globalThis.document.addEventListener` + `globalThis.addEventListener`
//   (neither exists on Hermes) — shim both with no-ops. The event system is
//   useless here anyway (input is RN's responder system), so all event
//   features are also disabled per-renderer in renderer.ts.

// Hermes prohibits `new Function`. Pixi v8 checks that capability while
// constructing a renderer, so this side-effect import must run before any
// `WebGLRenderer` is created. It installs Pixi's interpreter-based uniform /
// shader sync implementations instead of runtime code generation.
import 'pixi.js/unsafe-eval';
import { DOMAdapter, DOMPipe, extensions, type Adapter } from 'pixi.js';
import type { ICanvas } from 'pixi.js';

// DOMPipe is not useful on React Native and creates DOM elements during every
// render. Keep Pixi's v8 EventSystem: `events.ts` feeds its federated boundary
// with native surface input, preserving normal eventMode/hit-test semantics.
// The DOM shim below still makes its passive browser hooks harmless.
extensions.remove(DOMPipe);

// Minimal fake <canvas>: enough surface for anything that only sizes/observes
// it. getContext returns null — 2D rasterization is simply unavailable.
type DocumentShim = {
  addEventListener: (...args: unknown[]) => void;
  removeEventListener: (...args: unknown[]) => void;
  createElement: (...args: unknown[]) => HTMLElement;
};
type GlobalDomShim = Omit<typeof globalThis, 'document'> & { document?: DocumentShim };

class ExpoCanvas implements ICanvas {
  width: number;
  height: number;
  // Not `Record<string, never>`: pixi writes layout properties onto `.style` of
  // whatever `createElement` returns, so this has to accept assignment.
  style: Record<string, string> = {};

  constructor(width = 0, height = 0) {
    this.width = width;
    this.height = height;
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true;
  }
  getContext(): null {
    return null;
  }
  // Element-shaped no-ops. Nothing here is in a document, but pixi calls these
  // on elements it created, and a missing method is a TypeError inside a rAF
  // callback — i.e. a dead process with no attributable stack. Not theoretical:
  // `CanvasObserver.updateTranslation` (a Ticker.shared listener) calls
  // `getBoundingClientRect()` every frame and killed the app on frame one.
  // Report the real surface box so it computes an identity transform and
  // settles, rather than throwing.
  remove(): void {}
  appendChild<T>(child: T): T {
    return child;
  }
  removeChild<T>(child: T): T {
    return child;
  }
  contains(): boolean {
    return false;
  }
  getBoundingClientRect(): DOMRect {
    const { width, height } = this;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON() {
        return this;
      },
    } as DOMRect;
  }
}

/** A minimal `ICanvas` with no real 2D context — the DOM adapter's answer for
 *  anywhere pixi asks to create or resolve a `<canvas>` on a platform with no
 *  canvas. `getContext()` always returns `null`. */
function fakeCanvas(width = 0, height = 0): ICanvas {
  return new ExpoCanvas(width, height);
}

const g = globalThis as GlobalDomShim;
if (typeof g.document === 'undefined') {
  g.document = {
    addEventListener() {},
    removeEventListener() {},
    createElement: () => fakeCanvas() as unknown as HTMLElement,
  };
}
if (typeof g.addEventListener !== 'function') {
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
}

// ── The WebGL1-vs-WebGL2 detector (⚠️ load-bearing, see below) ────────────────
// Pixi reads STATIC GL constants off the class this returns —
// ScissorSystem/StencilSystem do `ADAPTER.getWebGLRenderingContext().SCISSOR_TEST`
// / `.STENCIL_TEST` in their CONSTRUCTORS, i.e. during `renderer.init()`.
//
// It is ALSO the thing pixi v8 uses to pick its BACKEND. GlContextSystem does
//   webGLVersion = gl instanceof ADAPTER.getWebGLRenderingContext() ? 1 : 2
// In a browser that reads correctly: WebGL2RenderingContext is an unrelated
// interface, so a WebGL2 context answers `false` and gets the WebGL2 backend.
// expo-gl is NOT a browser — it deliberately makes WebGL2RenderingContext
// EXTEND WebGLRenderingContext (EXWebGLRenderer.cpp: "gives `instanceof
// WebGLRenderingContext` the right answer for WebGL2 instances"), so handing
// pixi the plain global answers `true` and it silently runs its WebGL1 backend
// on an ES3 context.
//
// That backend cannot work here, and fails LATE and violently rather than at
// init: it rewires `gl.createVertexArray`/`drawElementsInstanced` out of
// `getExtension('OES_vertex_array_object')` / `('ANGLE_instanced_arrays')`, but
// EXGL removes the VAO extension from `getSupportedExtensions()` outright
// (EXGLNativeContext.cpp) and returns a BARE `{}` — no entry points — for
// everything else. So WebGL1 either throws "Vertex Array Objects are not
// supported on this device" inside init, or calls a method that isn't there on
// the first draw. Shimming the extension by delegating back to the native VAO
// methods is worse still: pixi has by then OVERWRITTEN `gl.createVertexArray`
// with a call into that shim, so the two call each other until the JS stack
// overflows and Hermes takes the process down with it.
//
// So: answer the question pixi is actually asking. A WebGL2 context is not a
// WebGL1 context, whatever expo-gl's prototype chain says. Everything pixi v8's
// WebGL2 path needs is implemented natively by EXGL (VAOs, instancing, samplers)
// — it is also the path pixi v7 ran on here for the whole life of the game,
// because v7 asked the inverse question (`instanceof WebGL2RenderingContext`).
const GL_CLASS_CONSTANTS = {
  SCISSOR_TEST: 0x0c11,
  STENCIL_TEST: 0x0b90,
};

type WebGL1Constructor = typeof WebGLRenderingContext;
type GlobalWithGlClasses = {
  WebGLRenderingContext?: WebGL1Constructor;
  WebGL2RenderingContext?: { new (): unknown };
};

class ExpoWebGL1RenderingContextClass {
  static readonly SCISSOR_TEST = GL_CLASS_CONSTANTS.SCISSOR_TEST;
  static readonly STENCIL_TEST = GL_CLASS_CONSTANTS.STENCIL_TEST;

  static [Symbol.hasInstance](value: unknown): boolean {
    // expo-gl states the answer outright on the context object it hands us,
    // which beats inferring it from a prototype chain built to lie about this.
    if (value !== null && typeof value === 'object' && 'supportsWebGL2' in value) {
      return !(value as { supportsWebGL2?: boolean }).supportsWebGL2;
    }
    const g = globalThis as GlobalWithGlClasses;
    if (typeof g.WebGL2RenderingContext === 'function' && value instanceof g.WebGL2RenderingContext) {
      return false;
    }
    return typeof g.WebGLRenderingContext === 'function' && value instanceof g.WebGLRenderingContext;
  }
}

// expo-gl installs the real class with the spec's full static constant set
// before any context callback runs; copy them over so anything pixi reads off
// this class is the genuine value. The two literals above are the fallback for
// non-expo-gl environments (the offline harness, node tests) and cover every
// constant pixi's systems actually read this way.
const realWebGL1Class = (globalThis as GlobalWithGlClasses).WebGLRenderingContext;
if (typeof realWebGL1Class === 'function') Object.assign(ExpoWebGL1RenderingContextClass, realWebGL1Class);

function getWebGLRenderingContextClass(): WebGL1Constructor {
  return ExpoWebGL1RenderingContextClass as unknown as WebGL1Constructor;
}

const expoAdapter: Adapter = {
  createCanvas: (width?: number, height?: number) => fakeCanvas(width, height),
  createImage: () => {
    throw new Error('Images are loaded through ExpoAssetSource');
  },
  getCanvasRenderingContext2D: () => null as unknown as { prototype: CanvasRenderingContext2D },
  getWebGLRenderingContext: getWebGLRenderingContextClass,
  getNavigator: () => ({ userAgent: 'ReactNative', gpu: null }),
  getBaseUrl: () => 'https://localhost/',
  getFontFaceSet: () => null,
  fetch: (url: RequestInfo, options?: RequestInit) => fetch(url, options),
  parseXML: () => null as unknown as Document,
};

DOMAdapter.set(expoAdapter);

export { fakeCanvas };
/** Importing this module installs the DOM adapter as a side effect; this is
 *  just something to import (or check) if you need to confirm that already
 *  happened before touching a pixi class yourself. Always `true`. */
export const pixiEnvReady = true;
