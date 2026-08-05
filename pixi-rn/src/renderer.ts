// ── Pixi Renderer construction against an expo-gl context ────────────────────
// Kept OUT of PixiScene.tsx (React) so the offline mock-GL harness can run the
// EXACT production construction path in node — `renderer.init()` runs every
// system's constructor and `contextChange`, several of which touch adapter/DOM
// surface (the ScissorSystem SCISSOR_TEST crash that blacked out the first
// device build lived here). Run it with `npm run glsmoke`.
//
// ⚠️ Pixi runs its WEBGL2 backend here, and the thing that decides that is
// `adapter.ts`'s `getWebGLRenderingContext` — read the note there before
// touching either file. The WebGL1 backend is not a fallback: on expo-gl it
// takes the process down.

import './adapter';
import { Ticker, WebGLRenderer, type ICanvas } from 'pixi.js';
import { pixiRnFail, pixiRnTrace } from './log';

// Minimal surface the renderer needs from the host GL context/view.
export interface GLLike {
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  supportsWebGL2?: boolean;
  getSupportedExtensions?: () => string[] | null;
  getParameter?: (pname: number) => unknown;
  getContextAttributes?: () => WebGLContextAttributes | null;
}

function describeGlCapabilities(gl: GLLike): string {
  let extensions = 'unavailable';
  try {
    extensions = gl.getSupportedExtensions?.()?.join(',') || 'none';
  } catch {
    extensions = 'query-failed';
  }
  return [`webgl2=${String(gl.supportsWebGL2)}`, `ctor=${gl.constructor?.name ?? 'unknown'}`, `ext=${extensions}`].join(
    ' | ',
  );
}

export interface RendererOptions {
  /** Logical (dp) size of the pixi canvas — usually the window size. */
  width: number;
  height: number;
  /** Clear colour. A distinctive value doubles as a diagnostic: if the screen
   *  turns THIS colour, presentation works and the bug is in the draw path. */
  backgroundColor?: number;
}

export async function createRenderer(gl: GLLike, options: RendererOptions): Promise<WebGLRenderer> {
  const { width: W, height: H, backgroundColor = 0x50bbff } = options;
  pixiRnTrace('renderer-init', describeGlCapabilities(gl));

  // expo-gl's context implements WebGL, not the DOM around it. Pixi only
  // needs the view for sizing + context-lost events, so a stub suffices. The
  // context is passed in explicitly, so `getContext` is only ever a fallback —
  // hand back the one real context for whichever id is asked for.
  const view: ICanvas = {
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    getContext: (() => gl) as unknown as ICanvas['getContext'],
  };

  // expo-gl's getParameter supports a whitelist of pnames and THROWS on the
  // rest ("EXGL: getParameter() doesn't support gl.36006 yet!"). Every pname on
  // that reject list is a "which object is bound" query (EXWebGLMethods.cpp),
  // and pixi issues several of them while its systems receive `contextChange`.
  // Nothing is bound at that point, so `null` — what WebGL itself returns for
  // an unbound object — is the correct answer; wrap defensively rather than
  // chase individual pnames.
  const rawGetParameter = gl.getParameter?.bind(gl);
  if (rawGetParameter) {
    gl.getParameter = (pname: number) => {
      try {
        return rawGetParameter(pname);
      } catch {
        return null;
      }
    };
  }
  // Belt and braces: pixi reads the context attributes during init; polyfill
  // in case the native context doesn't expose them.
  if (typeof gl.getContextAttributes !== 'function') {
    gl.getContextAttributes = () => ({
      alpha: true,
      antialias: false,
      depth: true,
      stencil: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'default',
    });
  }

  // ⚠️⚠️ ONE rAF loop in this app, and PixiScene owns it. Pixi v8 has TWO shared
  // tickers, both `autoStart`, and three library singletons put a listener on
  // one during `renderer.init()`: `SchedulerSystem` (pixi's GPU GC),
  // `EventsTicker` (pointer polling) and `CanvasObserver` (DOM element tracking,
  // spawned by DOMPipe/AccessibilitySystem). Each one that gets a listener
  // starts its own requestAnimationFrame.
  //
  // That is not just wasted work — it is UNCATCHABLE. Those callbacks run
  // outside PixiScene's try/catch and outside ErrorBoundary, so one that throws
  // is a fatal that kills the process. Exactly that happened:
  // `CanvasObserver.updateTranslation` calls `canvas.getBoundingClientRect()`,
  // which no stub canvas here has, and the app died on the first frame with a
  // stack of `anonymous / update / emit / anonymous` naming nothing.
  //
  // `extensions.remove()` is NOT a defence — see adapter.ts: those systems are
  // still constructed in v8. Clearing autoStart BEFORE init is, because it is
  // what `Ticker.add` consults to decide whether to spin up a frame request.
  // `npm run glsmoke` asserts both tickers stay dead.
  Ticker.shared.autoStart = false;
  Ticker.system.autoStart = false;

  const renderer = new WebGLRenderer();
  pixiRnTrace('renderer-init:calling-pixi', { width: W, height: H, resolution: gl.drawingBufferWidth / W });
  try {
    await renderer.init({
      context: gl as WebGL2RenderingContext,
      canvas: view,
      // Logical (dp) coordinates — same space the Skia canvas drew in; the
      // resolution maps them onto the physical drawing buffer.
      width: W,
      height: H,
      resolution: gl.drawingBufferWidth / W,
      antialias: false,
      autoDensity: false,
      backgroundAlpha: 1,
      backgroundColor,
      powerPreference: 'high-performance',
      // Pixi's GPU garbage collector is the ONLY consumer of its SchedulerSystem
      // — see the Ticker note below for why it has to go. The game's texture set
      // is fixed and loaded once behind the loading screen, so there is nothing
      // for a GC pass to reclaim anyway; leaving it enabled would only let pixi
      // unload sheets mid-run and re-upload them.
      gcActive: false,
      // EventSystem stays installed. pixi-rn feeds its EventBoundary from the
      // native surface; browser listeners attached to the inert canvas do no
      // work in this environment.
    });
    // Belt and braces for the note above: if anything managed to start one
    // before `autoStart` was cleared, stop it now. Nothing is lost — with
    // `gcActive: false` the scheduler has no tasks, pixi's event system is
    // unused (input is RN's responder system) and there is no DOM to observe.
    // ⚠️ A pixi feature that relies on the shared ticker (an `AnimatedSprite`
    // with `autoUpdate`, a `VideoSource`) will therefore not advance on its own
    // — drive it from `scene.update` instead.
    Ticker.shared.stop();
    Ticker.system.stop();
    pixiRnTrace('renderer-init:ok', { version: renderer.context.webGLVersion });
    return renderer;
  } catch (error) {
    pixiRnFail('renderer-init:pixi', error);
    throw error;
  }
}
