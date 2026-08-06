// ⚠️ `Graphics`/`Texture.WHITE` both need a DOM canvas, unavailable here (see
// core/adapter.ts). A solid fill is a tinted 1×1 texture instead — pass a
// `makeWhiteTexture()` result in.
import '../core/adapter';
import { Sprite, Texture } from 'pixi.js';
import type { LayoutSize, LayoutStyles } from '../layout/layout';

/** Constructor options for `UiRect`. */
export interface UiRectOptions {
  x?: number;
  y?: number;
  width: number;
  height: number;
  color?: number;
  alpha?: number;
  layout?: LayoutStyles;
}

/** A solid rectangle: a tinted 1×1 texture, the only fill available here. */
export class UiRect extends Sprite {
  constructor(white: Texture, options: UiRectOptions) {
    super(white);
    this.position.set(options.x ?? 0, options.y ?? 0);
    this.width = options.width;
    this.height = options.height;
    this.tint = options.color ?? 0xffffff;
    this.alpha = options.alpha ?? 1;
    this.eventMode = 'none';
    this.layout = options.layout ?? { width: options.width, height: options.height };
  }

  measureLayout(): LayoutSize {
    return { width: this.width, height: this.height };
  }

  applyLayout(width: number, height: number): void {
    this.resize(width, height);
  }

  /** Same as `applyLayout` — also usable as a `UiDecoration` (a plain-colour
   *  backdrop behind a `UiDecoratedBox`'s flow children), which resizes
   *  outside the flex pass and so calls this directly instead. */
  resize(width: number, height: number): void {
    this.setSize(width, height);
  }
}

/** Convenience wrapper kept for call sites that only want the sprite. */
export function createUiRect(white: Texture, options: UiRectOptions): UiRect {
  return new UiRect(white, options);
}
