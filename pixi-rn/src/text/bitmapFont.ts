// ── The one font, as a pixi BitmapText font ──────────────────────────────────
// Every piece of UI text in the game draws through this (`UiLabel` in ui.ts)
// instead of through native RN <Text> nodes.
//
// Two things make that viable, and both are load-bearing:
//
// 1. THE ATLAS IS A PLAIN 1-BIT MASK, NOT A DISTANCE FIELD. `distanceField`
//    reads `{ type: 'none' }`, so pixi uses its ordinary sprite path — one
//    quad per glyph, batched with the rest of the chrome, NEAREST-sampled and
//    pixel-exact. An MSDF font would route through pixi's SDF shader and
//    render antialiased edges, which is wrong for pixel art. See
//    scripts/gen-bitmap-font.mjs.
//
// 2. TEXT CAN BE MEASURED SYNCHRONOUSLY IN JS (`measureText` below). A bitmap
//    font's advance widths are just numbers in the metrics, so a label knows
//    its own size without asking native to lay it out. That is what lets
//    a label report its own size to the flex pass in `layout.ts` like any
//    other node. Without it a label could not size itself until a measured
//    rect came back, and every screen would have to be absolute pixel maths.
//
// ⚠️ adapter FIRST — Hermes/expo-gl compatibility before any pixi class is
// evaluated.
import '../core/adapter';
import { BitmapFont, BitmapText, Cache, Texture } from 'pixi.js';
import type { BitmapFontData } from 'pixi.js';

import { loadSheet } from '../core/textures';
import { pixiRnFail, pixiRnTrace } from '../core/log';

/** The BMFont JSON shape emitted by a bitmap-font baker (see the game's
 *  scripts/gen-bitmap-font.mjs for one that keeps pixel glyphs crisp). */
export type GeneratedBitmapGlyph = {
  id: number;
  char: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
};
export type GeneratedBitmapFont = {
  pages: string[];
  chars: GeneratedBitmapGlyph[];
  info: { size: number; face: string };
  common: { lineHeight: number; base: number };
  distanceField: { fieldType: 'sdf' | 'msdf' | 'none'; distanceRange: number };
};

// The app installs its font once (see installBitmapFont); everything else here
// reads these. Kept as module state rather than passed around because
// `measureText` is called from React render paths where threading a font handle
// through every component would be noise.
let RAW: GeneratedBitmapFont | null = null;
let ADVANCE = new Map<string, number>();
let FALLBACK_ADVANCE = 16;
let fontName = '';

function raw(): GeneratedBitmapFont {
  if (!RAW) throw new Error('pixi-rn: no bitmap font installed — call installBitmapFont() first');
  return RAW;
}

/** The size the atlas was baked at — text at this size is 1:1 with its pixels. */
export function fontBaseSize(): number {
  return raw().info.size;
}

/** The installed font's family name, for BitmapText styles. */
export function fontFamily(): string {
  return fontName;
}

/** The size `measureText()` reports for a string at a given size/spacing. */
export interface TextMetrics {
  width: number;
  height: number;
}

/**
 * Measure a string in the bitmap font, synchronously, with no native call.
 *
 * ⚠️ This MUST agree with what pixi lays out, because `UiLabel` reports its
 * layout box from this while pixi positions the glyphs — a mismatch shows up
 * as text drifting out of its own box. Pixi accumulates
 * `xAdvance + letterSpacing * (baseSize / fontSize)` per character in atlas
 * units and then scales by `fontSize / baseSize`, which reduces to the
 * expression below: letter spacing contributes exactly `letterSpacing` screen
 * pixels per character, INCLUDING after the last one. There is no kerning to
 * account for — the generated font has none.
 *
 * Newlines are honoured, but the UI convention is one label per line (the
 * outline is 8 drawn copies per label); this mainly exists so a stray `\n`
 * cannot silently produce a box that clips.
 */
export function measureText(text: string, fontSize: number, letterSpacing = 0): TextMetrics {
  if (!RAW) return { width: 0, height: 0 };
  const scale = fontSize / RAW.info.size;
  const lines = text.split('\n');
  let widest = 0;
  for (const line of lines) {
    let advance = 0;
    let count = 0;
    for (const char of line) {
      advance += ADVANCE.get(char) ?? FALLBACK_ADVANCE;
      count++;
    }
    const width = advance * scale + letterSpacing * count;
    if (width > widest) widest = width;
  }
  return {
    width: Math.ceil(widest),
    height: Math.ceil(lines.length * RAW.common.lineHeight * scale),
  };
}

/** Register a generated font under its own face name for BitmapText.
 *  Pixi's own Assets loader is unusable here (it wants DOM fetch/XML), so the
 *  atlas goes through the same expo-gl upload path as every other sheet and the
 *  metrics are a bundled JSON object. */
export function installBitmapFont(atlas: Texture, raw: GeneratedBitmapFont): BitmapFont {
  const data: BitmapFontData = {
    pages: raw.pages.map((file: string, id: number) => ({ id, file })),
    chars: Object.fromEntries(
      raw.chars.map((c) => [
        c.char,
        {
          id: c.id,
          page: c.page,
          x: c.x,
          y: c.y,
          width: c.width,
          height: c.height,
          xOffset: c.xoffset,
          yOffset: c.yoffset,
          xAdvance: c.xadvance,
          letter: c.char,
          kerning: {},
        },
      ]),
    ),
    fontSize: raw.info.size,
    lineHeight: raw.common.lineHeight,
    // ⚠️ NOT `common.base`. BMFont's `base` is the baseline measured DOWN from
    // the line top; pixi wants the leftover BELOW the baseline, which is what
    // its own parsers compute (`lineHeight - base`, see
    // bitmapFontTextParser.ts) and what its render pipe assumes — it starts the
    // first line at `currentY = baseLineOffset`. Passing `base` here drew every
    // label exactly one em BELOW its own layout box: titles overlapped whatever
    // followed them, checkboxes sat above their labels, and text hung low in
    // every panel. Invisible to `getBounds()`, which reports a BitmapText's
    // layout box rather than where the glyph quads land — see the glsmoke
    // check that now pins this.
    baseLineOffset: raw.common.lineHeight - raw.common.base,
    fontFamily: raw.info.face,
    distanceField: { type: raw.distanceField.fieldType, range: raw.distanceField.distanceRange },
  };
  const font = new BitmapFont({ data, textures: [atlas] });
  // The key BitmapFontManager resolves a fontFamily by.
  Cache.set(`${raw.info.face}-bitmap`, font);

  RAW = raw;
  fontName = raw.info.face;
  ADVANCE = new Map(raw.chars.map((c) => [c.char, c.xadvance]));
  // Anything not in the atlas (a locale gained a character and the font was not
  // regenerated) falls back to the space advance rather than measuring as zero,
  // so the layout degrades to a gap instead of to overlapping text.
  FALLBACK_ADVANCE = ADVANCE.get(' ') ?? raw.info.size;
  return font;
}

let loading: Promise<BitmapFont> | null = null;

/** Uploads the atlas and installs the font. Memoized; safe to call repeatedly. */
export function loadBitmapFont(atlasModule: number, metrics: GeneratedBitmapFont): Promise<BitmapFont> {
  if (loading) return loading;
  loading = (async () => {
    const atlas = await loadSheet(`font:${metrics.info.face}`, atlasModule);
    const font = installBitmapFont(atlas, metrics);
    pixiRnTrace('bitmap-font-ready', { glyphs: metrics.chars.length, size: metrics.info.size });
    return font;
  })().catch((error) => {
    pixiRnFail('bitmap-font', error);
    loading = null;
    throw error;
  });
  return loading;
}

/** Style options shared by `createBitmapText` and `UiLabel`. */
export interface BitmapTextOptions {
  fontSize?: number;
  letterSpacing?: number;
  tint?: number;
  align?: 'left' | 'center' | 'right';
}

/** A plain `BitmapText` in the installed font — no pixel outline. `UiLabel`
 *  is almost always the better choice (it adds the outline and takes part in
 *  `applyFlexLayout`); reach for this only when you want a bare glyph run. */
export function createBitmapText(text: string, opts: BitmapTextOptions = {}): BitmapText {
  const label = new BitmapText({
    text,
    style: {
      fontFamily: fontName,
      fontSize: opts.fontSize ?? RAW?.info.size ?? 16,
      align: opts.align ?? 'left',
      letterSpacing: opts.letterSpacing ?? 0,
    },
  });
  if (opts.tint !== undefined) label.tint = opts.tint;
  return label;
}
