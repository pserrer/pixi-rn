// Draws the UI chrome commands published by the RN components (uiChrome.ts).
//
// Runs inside PixiScene's existing rAF loop, on top of the world, so chrome
// appears on the frame it is drawn — the whole point of moving off Skia, whose
// canvases painted ~8 frames behind the React commit that created them.
//
// Everything is POOLED and rebuilt from the command map each frame. That sounds
// wasteful but isn't: a screen publishes a few dozen commands against a scene
// that already submits thousands of world sprites, and rebuilding sidesteps
// every staleness bug a diffing scheme would invite when a screen is shown,
// hidden, remeasured or relaid out.
//
// ⚠️ No `Graphics` and no `Texture.WHITE` — both lazily rasterize a 2D canvas,
// which does not exist on expo-gl (see adapter.ts). Solid colour comes from
// tinting a 1×1 BufferResource texture, and 9-slice from NineSliceSprite, which
// is mesh-based and therefore safe.
// ⚠️ adapter FIRST — it installs the React Native DOM and unsafe-eval
// compatibility layers before Pixi classes are evaluated.
import './adapter';
import { BitmapText, Container, NineSliceSprite, Sprite, Texture, Rectangle } from 'pixi.js';
import {
  chromeCommands,
  chromeScroll,
  chromeSurfaceOrigin,
  tickChromeSweep,
  type ChromeCmd,
  type UiTexKey,
} from './chrome';
import { createBitmapText, measureText } from './bitmapFont';

/** Resolves a command's `tex` key to an uploaded texture, or null while the
 *  host app's sheets are still loading. */
export type ChromeTextures = (key: UiTexKey) => Texture | null | undefined;

// The hard pixel outline OutlineText used to draw with 8 absolutely-positioned
// native <Text> copies. Here they are 8 more glyph runs in the same batch, so
// the outline costs quads instead of views.
const OUTLINE_DIRS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** Grows on demand, hides the tail — the usual pool shape in this renderer. */
class Pool<T extends Container> {
  private items: T[] = [];
  private used = 0;
  constructor(
    private readonly root: Container,
    private readonly make: () => T,
  ) {}
  next(): T {
    let it = this.items[this.used];
    if (!it) {
      it = this.make();
      this.items.push(it);
      this.root.addChild(it);
    }
    it.visible = true;
    this.used++;
    return it;
  }
  reset() {
    this.used = 0;
  }
  hideRest() {
    for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false;
  }
}

// ⚠️ POOLS DO NOT DEFINE PAINT ORDER — `zIndex` does, and every drawn item must
// get one. A pool `addChild`s a slot the first time it is needed, so a
// container's child order is the order slots were first ALLOCATED across the
// app's whole lifetime, which drifts from command order as screens mount and
// unmount. There are separate pools per command kind, so that drift is not even
// uniform: it silently buries an arbitrary element under a panel whose
// NineSliceSprite happened to be allocated later. That is exactly how the home
// screen's PLAY button disappeared while the chest and SHOP card beside it
// survived. Assigning zIndex in draw order (with `sortableChildren`) makes the
// paint order the command order, permanently.

export interface UiChromeLayer {
  root: Container;
  update(): void;
}

export function createUiChromeLayer(white: Texture, textures: ChromeTextures): UiChromeLayer {
  const root = new Container();
  // Chrome never receives touches — RN keeps every hit target (see uiChrome.ts).
  root.eventMode = 'none';
  root.interactiveChildren = false;
  // See the note above the Pool class: paint order comes from zIndex, not from
  // the order slots were allocated in.
  root.sortableChildren = true;
  // Bumped for every item drawn this frame; assigning the same value again is a
  // no-op in pixi, so a steady screen never re-sorts.
  let paintOrder = 0;

  const rects = new Pool<Sprite>(root, () => new Sprite(white));
  const images = new Pool<Sprite>(root, () => new Sprite(Texture.EMPTY));
  const nines = new Pool<NineSliceSprite>(
    root,
    () => new NineSliceSprite({ texture: Texture.EMPTY, leftWidth: 1, topHeight: 1, rightWidth: 1, bottomHeight: 1 }),
  );
  // Up to 9 runs per label (8 outline + 1 foreground). Pool slots are handed
  // out in command order, which is stable (uiChrome's Map preserves insertion
  // order), so a given slot keeps getting the same string frame after frame and
  // pixi's `text` setter early-outs instead of re-laying-out the glyphs.
  const texts = new Pool<BitmapText>(root, () => createBitmapText(''));

  // Sub-rect textures are cached by their sheet + crop, because building a
  // Texture per frame would leak one per frame (textures.ts makes the same
  // point about `slice`).
  const cropCache = new Map<string, Texture>();
  const fullCache = new Map<Texture, Texture>();
  function whole(base: Texture): Texture {
    let t = fullCache.get(base);
    if (!t) {
      t = base;
      fullCache.set(base, t);
    }
    return t;
  }
  function cropped(base: Texture, sx: number, sy: number, sw: number, sh: number): Texture {
    const key = `${base.uid}|${sx},${sy},${sw},${sh}`;
    let t = cropCache.get(key);
    if (!t) {
      t = new Texture({ source: base.source, frame: new Rectangle(sx, sy, sw, sh) });
      cropCache.set(key, t);
    }
    return t;
  }

  function rect(x: number, y: number, w: number, h: number, color: number, alpha: number) {
    if (w <= 0 || h <= 0) return;
    const s = rects.next();
    s.zIndex = paintOrder++;
    s.position.set(x, y);
    s.width = w;
    s.height = h;
    s.tint = color;
    s.alpha = alpha;
  }

  // The pixel-stair silhouette as axis-aligned rects: a tall middle band, a
  // wide middle band, and the four small corner squares that turn a plain
  // rectangle's corners into the kit's two-step cut. Matches
  // primitives.tsx's stairCornerPath closely enough to be indistinguishable at
  // these sizes, without needing a path renderer.
  function stairFill(x: number, y: number, w: number, h: number, cut: number, color: number, alpha: number) {
    const s = cut / 2;
    rect(x + cut, y, w - 2 * cut, h, color, alpha);
    rect(x, y + cut, w, h - 2 * cut, color, alpha);
    rect(x + s, y + s, cut, cut, color, alpha);
    rect(x + w - s - cut, y + s, cut, cut, color, alpha);
    rect(x + s, y + h - s - cut, cut, cut, color, alpha);
    rect(x + w - s - cut, y + h - s - cut, cut, cut, color, alpha);
  }

  /** One glyph run at an exact pixel origin. */
  function glyphRun(text: string, size: number, spacing: number, x: number, y: number, tint: number, alpha: number) {
    const t = texts.next();
    t.zIndex = paintOrder++;
    // Assigning the same string is a no-op in pixi; a different
    // fontSize/letterSpacing forces a re-layout, so only write on change.
    if (t.text !== text) t.text = text;
    if (t.style.fontSize !== size) t.style.fontSize = size;
    if (t.style.letterSpacing !== spacing) t.style.letterSpacing = spacing;
    t.position.set(x, y);
    t.tint = tint;
    t.alpha = alpha;
  }

  // numberOfLines={1}: shrink to fit the box the flex parent actually gave us.
  // Binary-search-free because labels are short and this only runs when a label
  // genuinely overflows.
  const ELLIPSIS = '...';
  function fitToWidth(text: string, size: number, spacing: number, maxWidth: number): string {
    if (measureText(text, size, spacing).width <= maxWidth) return text;
    for (let len = text.length - 1; len > 0; len--) {
      const candidate = text.slice(0, len) + ELLIPSIS;
      if (measureText(candidate, size, spacing).width <= maxWidth) return candidate;
    }
    return '';
  }

  /** The same command, moved vertically. Cheap: chrome commands are flat. */
  function shift(c: ChromeCmd, dy: number): ChromeCmd {
    return dy === 0 ? c : { ...c, y: c.y + dy };
  }

  function overlapsViewport(c: ChromeCmd, v: { x: number; y: number; w: number; h: number }): boolean {
    return c.y + c.h > v.y && c.y < v.y + v.h && c.x + c.w > v.x && c.x < v.x + v.w;
  }

  /**
   * Draw inside a scroll viewport. A partially-scrolled row would otherwise
   * spill past the panel that frames it, and pixi cannot mask here (Graphics
   * lazily rasterizes a 2D canvas — see adapter.ts). Every chrome shape is an
   * axis-aligned box, so clipping is geometry: solid fills are trimmed
   * directly, and an image's source crop is trimmed by the same fraction so it
   * scrolls under the edge instead of squashing. `nine` and `text` cannot be
   * cut without distorting, so they are drawn only while fully inside — the
   * row's card and label appear together as it clears the edge.
   */
  function drawClipped(c: ChromeCmd, tex: ChromeTextures, v: { x: number; y: number; w: number; h: number } | null) {
    if (!v) {
      draw(c, tex);
      return;
    }
    const top = Math.max(c.y, v.y);
    const bottom = Math.min(c.y + c.h, v.y + v.h);
    if (bottom <= top) return;
    const fullyInside = top === c.y && bottom === c.y + c.h;
    if (fullyInside) {
      draw(c, tex);
      return;
    }

    if (c.kind === 'rect' || c.kind === 'stair') {
      draw({ ...c, y: top, h: bottom - top }, tex);
      return;
    }
    if (c.kind === 'img') {
      const cutTop = (top - c.y) / c.h;
      const cutBottom = (c.y + c.h - bottom) / c.h;
      const crop = c.crop;
      draw(
        {
          ...c,
          y: top,
          h: bottom - top,
          crop: crop && {
            sx: crop.sx,
            sy: crop.sy + crop.sh * cutTop,
            sw: crop.sw,
            sh: crop.sh * (1 - cutTop - cutBottom),
          },
        },
        tex,
      );
      return;
    }
    // nine / text: all-or-nothing at the edge.
  }

  function draw(c: ChromeCmd, tex: ChromeTextures) {
    if (c.kind === 'text') {
      if (!c.text) return;
      const alpha = c.alpha ?? 1;
      const spacing = c.letterSpacing ?? 0;
      const text = c.truncate ? fitToWidth(c.text, c.size, spacing, c.w) : c.text;
      if (!text) return;
      // Align inside the box the RN component occupies. The width comes from
      // the SAME measurement PixelText sized its View with, so a centred label
      // lands exactly where RN would have put it.
      const { width } = measureText(text, c.size, spacing);
      const x =
        c.align === 'center' ? c.x + Math.round((c.w - width) / 2) : c.align === 'right' ? c.x + (c.w - width) : c.x;
      // Top-aligned, like a native <Text> in a box sized to its content.
      const ow = c.outlineWidth ?? 0;
      if (ow > 0 && c.outline !== undefined) {
        for (const [dx, dy] of OUTLINE_DIRS) {
          glyphRun(text, c.size, spacing, x + dx * ow, c.y + dy * ow, c.outline, alpha);
        }
      }
      glyphRun(text, c.size, spacing, x, c.y, c.color, alpha);
      return;
    }
    if (c.kind === 'rect') {
      rect(c.x, c.y, c.w, c.h, c.color, c.alpha ?? 1);
      return;
    }
    if (c.kind === 'stair') {
      // Border first, one border-width larger all round, then the fill on top —
      // cheaper and more robust than stroking a stepped outline by hand.
      if (c.border !== undefined) {
        const bw = c.borderWidth ?? 2;
        stairFill(c.x - bw, c.y - bw, c.w + 2 * bw, c.h + 2 * bw, c.cut, c.border, c.borderAlpha ?? 1);
      }
      stairFill(c.x, c.y, c.w, c.h, c.cut, c.fill, c.fillAlpha);
      return;
    }
    const base = tex(c.tex);
    if (!base || base.destroyed) return;
    if (c.kind === 'nine') {
      const n = nines.next();
      n.zIndex = paintOrder++;
      n.texture = whole(base);
      // Skia's NineSlice separates the source inset from the destination corner
      // size; Pixi's NineSliceSprite only preserves the source border widths.
      // Use the smaller of the source inset and the destination corner so we
      // never preserve a larger border than the source art provides.
      const border = Math.min(c.corner, c.inset);
      n.leftWidth = n.rightWidth = n.topHeight = n.bottomHeight = border;
      // NineSliceSprite's width/height directly set the destination size. A
      // separate scale would distort the nine-slice mesh and its preserved edges.
      n.scale.set(1);
      n.width = c.w;
      n.height = c.h;
      n.position.set(c.x, c.y);
      n.alpha = c.alpha ?? 1;
      return;
    }
    const s = images.next();
    s.zIndex = paintOrder++;
    s.texture = c.crop ? cropped(base, c.crop.sx, c.crop.sy, c.crop.sw, c.crop.sh) : whole(base);
    s.position.set(c.x, c.y);
    s.width = c.w;
    s.height = c.h;
    s.tint = c.tint ?? 0xffffff;
    s.alpha = c.alpha ?? 1;
  }

  return {
    root,
    update() {
      rects.reset();
      images.reset();
      nines.reset();
      texts.reset();
      paintOrder = 0;
      const tex = textures;
      // chromeCommands() is already in paint order: shallowest first, then by
      // publication (see uiChrome.ts).
      {
        // ⚠️ Commands arrive in WINDOW coordinates (measureInWindow), but pixi
        // draws in SURFACE coordinates. Those are the same origin only when the
        // GL surface starts exactly at the window's top-left — which is not
        // guaranteed (edge-to-edge surfaces, system bars). A mismatch shifts
        // EVERY element uniformly, which reads as "the art and the touch
        // targets are offset from each other" and no amount of re-measuring
        // fixes it. PixiScene reports the real origin; see setChromeSurfaceOrigin.
        const origin = chromeSurfaceOrigin();
        for (const entry of chromeCommands()) {
          const { scrollId, baseScrollY } = entry;
          const cmd =
            origin.x === 0 && origin.y === 0
              ? entry.cmd
              : { ...entry.cmd, x: entry.cmd.x - origin.x, y: entry.cmd.y - origin.y };
          if (!scrollId) {
            draw(cmd, tex);
            continue;
          }
          // Inside a scroller: shift by how far it has scrolled SINCE this box
          // was measured, and clip to the scroller's own viewport so rows never
          // draw outside the panel that frames them.
          const region = chromeScroll(scrollId);
          if (!region) {
            draw(cmd, tex);
            continue;
          }
          const dy = region.y - baseScrollY;
          const view = region.view;
          const shifted = shift(cmd, -dy);
          if (view && !overlapsViewport(shifted, view)) continue;
          drawClipped(shifted, tex, view);
        }
      }
      // One element re-measures per frame, round-robin — the backstop for
      // every screen-mover nobody enumerated (see uiChrome.ts).
      tickChromeSweep();
      rects.hideRest();
      images.hideRest();
      nines.hideRest();
      texts.hideRest();
    },
  };
}
