// ── UI chrome, drawn by pixi instead of Skia ─────────────────────────────────
// Every menu panel, border, card and icon used to be its own Skia <Canvas>, and
// each of those is a native view whose picture reaches the screen SEVERAL
// FRAMES after the React commit that created it (SkiaSGRoot.render is async and
// Canvas fires it from useLayoutEffect without awaiting). Measured on a 60fps
// recording: text on frame 54, all the chrome together on frame 62.
//
// pixi has no such gap — it draws into the GL surface already being rendered by
// PixiScene's rAF loop, so chrome lands on the frame it is drawn, same as the
// world. This module is the seam: RN components stay responsible for LAYOUT,
// TEXT and INPUT (all of which were never late), and publish a draw command
// describing the chrome they want plus where it goes. The pixi UI layer reads
// these every frame and draws them.
//
// Z-order falls out for free: the GLView sits BEHIND every RN overlay, so
// pixi-drawn chrome is behind the RN text that labels it — exactly the stacking
// the Skia version had.
//
// ⚠️ Coordinates are SCREEN coordinates in RN points. The pixi renderer is
// created at `width: W, height: H, resolution: drawingBufferWidth / W`
// (renderer.ts), so a `measureInWindow` rect maps 1:1 with no conversion.
// ⚠️ Texture keys are plain strings HERE; the host app narrows them to its own
// sheet map so a typo is a compile error at the call site rather than a blank
// sprite at runtime (see the game's render/pixi/uiChrome.ts facade).
export type UiTexKey = string;

/** A source sub-rect of a sheet, in source pixels (coin frames, owl skins). */
export interface SrcCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export type ChromeCmd =
  // 9-sliced border art (panel frames, button faces, bars). `inset` is the
  // source corner, `corner` the destination corner — same meaning as the Skia
  // NineSlice this replaces.
  | {
      kind: 'nine';
      tex: UiTexKey;
      x: number;
      y: number;
      w: number;
      h: number;
      inset: number;
      corner: number;
      alpha?: number;
    }
  // A whole image (or a sub-rect of one) stretched into the box.
  | {
      kind: 'img';
      tex: UiTexKey;
      x: number;
      y: number;
      w: number;
      h: number;
      crop?: SrcCrop;
      tint?: number;
      alpha?: number;
    }
  // A plain solid rectangle. The building block for anything the kit draws
  // without art — including pixel-staircase diagonals, which is how the
  // character-picker chevrons keep their hard aliased edges (they were a Skia
  // path with antiAlias off; a staircase of rects IS that path's output).
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: number; alpha?: number }
  // Pixel-stair card: stepped-corner fill with an optional stepped border.
  // Colours are 0xRRGGBB + alpha, because pixi tints a 1x1 white texture —
  // Graphics is unavailable here (it lazily rasterizes a 2D canvas).
  | {
      kind: 'stair';
      x: number;
      y: number;
      w: number;
      h: number;
      cut: number;
      fill: number;
      fillAlpha: number;
      border?: number;
      borderAlpha?: number;
      borderWidth?: number;
    }
  // A run of text in the bitmap font (render/pixi/bitmapFont.ts). `x`/`y` is
  // the box the RN component occupies; `align` places the glyphs inside `w`,
  // which is what lets a centred label sit in a flex row unchanged.
  // `outlineWidth` reproduces OutlineText's hard pixel outline — 8 offset
  // copies behind the foreground, which as pixi quads batch with everything
  // else rather than costing 8 more native views.
  // `truncate` is the numberOfLines={1} contract: a label squeezed narrower
  // than its natural width by a flex parent is clipped with an ellipsis instead
  // of overflowing its row. The measured box IS the available width, so this is
  // the only place that can know it.
  | {
      kind: 'text';
      text: string;
      x: number;
      y: number;
      w: number;
      h: number;
      size: number;
      color: number;
      outline?: number;
      outlineWidth?: number;
      align?: 'left' | 'center' | 'right';
      letterSpacing?: number;
      alpha?: number;
      truncate?: boolean;
    };

// Commands live in a plain Map keyed by a per-instance id. Mutating it does NOT
// notify anything: the pixi layer re-reads the whole map each frame, which is
// far cheaper than the subscription churn would be (a few dozen entries against
// a scene that already draws thousands of sprites).
//
// ⚠️ EACH ENTRY CARRIES ITS NESTING DEPTH, and that is what defines PAINT
// ORDER — insertion order does not. RN paints a parent before its children, but
// React runs effects CHILD-FIRST, so a container (`PixelPlate`, `PixelNote`, …)
// publishes AFTER the content sitting inside it. Drawing in insertion order
// therefore paints panels over their own contents. Sorting by depth restores
// the tree's own order; `seq` only breaks ties between siblings, which is where
// insertion order IS the right answer.
export interface ChromeEntry {
  cmd: ChromeCmd;
  depth: number;
  seq: number;
  /** Scroll region this command lives inside, if any (see setChromeScroll). */
  scrollId: number;
  /** The region's scroll offset AT THE MOMENT the box was measured, so the
   *  layer can express the live offset as a delta rather than re-measuring. */
  baseScrollY: number;
}
const cmds = new Map<number, ChromeEntry>();
let nextId = 1;
let nextSeq = 1;
// The sorted view holds the ENTRIES, so re-publishing a changed command (a
// slider moving, a counter ticking) is an in-place field write that the layer
// sees immediately. Only a STRUCTURAL change — an entry added, removed, or
// re-parented — has to re-sort, so a steady screen sorts nothing per frame.
let sorted: ChromeEntry[] = [];
let sortDirty = true;
// `measureInWindow()` returns screen coordinates, while the GL surface uses
// coordinates relative to its own top-left corner. On devices with a status
// bar or a non-zero root window origin those are not the same coordinate
// system. Pixi chrome must use the GL origin as its zero, otherwise the whole
// home screen (especially the title board and play button) drifts vertically.
let surfaceOrigin = { x: 0, y: 0 };

export function setChromeSurfaceOrigin(x: number, y: number): void {
  surfaceOrigin = { x, y };
}

export function chromeSurfaceOrigin(): { x: number; y: number } {
  return surfaceOrigin;
}

// ── Scroll regions ───────────────────────────────────────────────────────────
// A ScrollView moves its content WITHOUT changing any child's own box, so no
// `onLayout` fires and `measureInWindow` would have to be re-run continuously
// to follow it — dozens of native calls per scrolled frame. Instead each region
// reports its live offset once per scroll event, and the layer draws chrome at
// `y - (liveOffset - offsetWhenMeasured)`. One number per region per frame,
// exact at any scroll position.
interface ScrollRegion {
  y: number;
  view: { x: number; y: number; w: number; h: number } | null;
}
const scrollRegions = new Map<number, ScrollRegion>();

export function newChromeScrollId(): number {
  return nextId++;
}

export function setChromeScroll(id: number, y: number): void {
  const region = scrollRegions.get(id);
  if (region) region.y = y;
  else scrollRegions.set(id, { y, view: null });
}

/** The region's visible box in screen coords — chrome outside it is clipped. */
export function setChromeScrollViewport(id: number, view: { x: number; y: number; w: number; h: number } | null): void {
  const region = scrollRegions.get(id);
  if (region) region.view = view;
  else scrollRegions.set(id, { y: 0, view });
}

export function clearChromeScroll(id: number): void {
  scrollRegions.delete(id);
}

export function chromeScroll(id: number): ScrollRegion | undefined {
  return scrollRegions.get(id);
}

// ── Self-healing sweep ───────────────────────────────────────────────────────
// ⚠️ The alternative to this is ENUMERATING every event that can move a screen
// without resizing its contents — and that list is unbounded. Four were found
// the hard way (a late safe-area inset, a screen parking off-screen, a scroll,
// a re-parent), each as a shipped bug where the art and its touch target came
// apart. So chrome also re-measures on a slow rolling sweep: one element per
// frame, round-robin, which self-heals ANY drift within about a second no
// matter what caused it.
//
// It is driven from `uiChromeLayer.update()` — i.e. PixiScene's existing rAF —
// because this app has exactly one frame loop and does not want a second one
// (see renderer.ts).
const sweepFns: (() => void)[] = [];
let sweepCursor = 0;

export function registerChromeMeasure(fn: () => void): () => void {
  sweepFns.push(fn);
  return () => {
    const i = sweepFns.indexOf(fn);
    if (i !== -1) sweepFns.splice(i, 1);
  };
}

/** Re-measure ONE registered element. Call once per frame. */
export function tickChromeSweep(): void {
  if (sweepFns.length === 0) return;
  if (sweepCursor >= sweepFns.length) sweepCursor = 0;
  sweepFns[sweepCursor++]?.();
}

export function newChromeId(): number {
  return nextId++;
}

/** `depth` is the publisher's nesting depth in the RN tree — see ChromeEntry. */
export function setChrome(id: number, cmd: ChromeCmd | null, depth = 0, scrollId = 0, baseScrollY = 0) {
  if (cmd === null) {
    clearChrome(id);
    return;
  }
  const existing = cmds.get(id);
  if (existing && existing.depth === depth && existing.scrollId === scrollId) {
    existing.cmd = cmd; // in place; `sorted` already holds this entry
    existing.baseScrollY = baseScrollY;
    return;
  }
  // Keep the original `seq` across a re-parent so a component that merely moved
  // in the tree does not jump ahead of siblings it was published after.
  cmds.set(id, { cmd, depth, seq: existing?.seq ?? nextSeq++, scrollId, baseScrollY });
  sortDirty = true;
}

export function clearChrome(id: number) {
  if (cmds.delete(id)) sortDirty = true;
}

/** Entries in PAINT order: shallowest first, then by publication order. */
export function chromeCommands(): readonly ChromeEntry[] {
  if (sortDirty) {
    sorted = [...cmds.values()].sort((a, b) => a.depth - b.depth || a.seq - b.seq);
    sortDirty = false;
  }
  return sorted;
}

export function chromeCount(): number {
  return cmds.size;
}
