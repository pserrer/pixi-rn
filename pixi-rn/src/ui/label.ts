// ⚠️ `pixi.js` `Text` needs a DOM canvas, unavailable here (see
// core/adapter.ts) — `BitmapText` is the only text pixi can draw on this
// stack, and the only one `text/bitmapFont.ts` can measure synchronously.
import '../core/adapter';
import { BitmapText, Container } from 'pixi.js';
import type { LayoutSize, LayoutStyles } from '../layout/layout';
import { createBitmapText, measureText, type BitmapTextOptions } from '../text/bitmapFont';

export interface UiLabelOptions extends BitmapTextOptions {
  x?: number;
  y?: number;
  alpha?: number;
  /** The hard pixel outline: 8 offset copies behind the foreground. RN has no
   *  text stroke and `textShadow*` does not render on this build, so this is
   *  how a pixel-art outline has to be drawn. */
  outline?: { color: number; width?: number };
  /** Horizontal placement inside the box layout hands back, when that box is
   *  wider than the text (a stretched or flexed label). */
  align?: 'left' | 'center' | 'right';
  layout?: LayoutStyles;
}

const OUTLINE_DIRECTIONS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

const ELLIPSIS = '...';

/** Bitmap-font label with an optional pixel outline, sized from JS text
 * metrics.
 *
 * A bitmap font's advance widths are plain numbers, so a label knows its exact
 * size synchronously — which is what lets it take part in an ordinary flex
 * layout instead of needing absolute pixel maths. */
export class UiLabel extends Container {
  readonly foreground: BitmapText;
  private readonly outlines: BitmapText[];
  private readonly outlineWidth: number;
  private readonly fontSize: number;
  private readonly letterSpacing: number;
  private readonly align: 'left' | 'center' | 'right';
  private content: string;
  private drawn: string;

  constructor(text: string, options: UiLabelOptions = {}) {
    super();
    this.position.set(options.x ?? 0, options.y ?? 0);
    this.alpha = options.alpha ?? 1;
    this.eventMode = 'none';
    this.fontSize = options.fontSize ?? 12;
    this.letterSpacing = options.letterSpacing ?? 0;
    this.align = options.align ?? 'left';
    this.content = text;
    this.drawn = text;
    this.outlineWidth = options.outline?.width ?? 1;
    this.outlines = options.outline
      ? OUTLINE_DIRECTIONS.map(([dx, dy]) => {
          const copy = createBitmapText(text, { ...options, tint: options.outline?.color });
          copy.position.set(dx * this.outlineWidth, dy * this.outlineWidth);
          this.addChild(copy);
          return copy;
        })
      : [];
    this.foreground = createBitmapText(text, options);
    this.addChild(this.foreground);
    this.layout = options.layout ?? {};
  }

  get text(): string {
    return this.content;
  }

  /** Replaces the string. Cheap when unchanged — pixi's `text` setter and the
   *  guard here both early-out, so a per-frame counter costs nothing on the
   *  frames its displayed value did not move. */
  setText(text: string): this {
    if (text === this.content) return this;
    this.content = text;
    this.paint(text);
    return this;
  }

  setTint(tint: number): this {
    this.foreground.tint = tint;
    return this;
  }

  measureLayout(): LayoutSize {
    return measureText(this.content, this.fontSize, this.letterSpacing);
  }

  applyLayout(width: number): void {
    // Layout may hand back less than the natural width (a shrunk row) — clip
    // with an ellipsis rather than letting the text run under its neighbour.
    const fitted = this.fit(this.content, width);
    if (fitted !== this.drawn) this.paint(fitted);
    const drawnWidth = measureText(fitted, this.fontSize, this.letterSpacing).width;
    const slack = Math.max(0, width - drawnWidth);
    const offset = this.align === 'center' ? Math.round(slack / 2) : this.align === 'right' ? Math.round(slack) : 0;
    this.foreground.x = offset;
    for (let i = 0; i < this.outlines.length; i++) {
      this.outlines[i].x = offset + OUTLINE_DIRECTIONS[i][0] * this.outlineWidth;
    }
  }

  private fit(text: string, maxWidth: number): string {
    if (maxWidth <= 0) return text;
    if (measureText(text, this.fontSize, this.letterSpacing).width <= maxWidth) return text;
    for (let len = text.length - 1; len > 0; len--) {
      const candidate = text.slice(0, len) + ELLIPSIS;
      if (measureText(candidate, this.fontSize, this.letterSpacing).width <= maxWidth) return candidate;
    }
    return '';
  }

  private paint(text: string): void {
    this.drawn = text;
    for (const outline of this.outlines) outline.text = text;
    this.foreground.text = text;
  }
}
