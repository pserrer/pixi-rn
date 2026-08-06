import '../core/adapter';
import { Sprite, Texture } from 'pixi.js';
import type { LayoutSize, LayoutStyles } from '../layout/layout';

/** Constructor options for `UiImage`. */
export interface UiImageOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  tint?: number;
  alpha?: number;
  layout?: LayoutStyles;
}

/** A retained image drawn at an exact destination size. Pass an already-sliced
 *  texture for a sheet cell — building one per construction would leak a
 *  Texture per rebuild (see a texture slicer's cache, e.g. `makeSlicer()`). */
export class UiImage extends Sprite {
  constructor(texture: Texture, options: UiImageOptions = {}) {
    super(texture);
    this.position.set(options.x ?? 0, options.y ?? 0);
    this.setSize(options.width ?? this.texture.width, options.height ?? this.texture.height);
    this.tint = options.tint ?? 0xffffff;
    this.alpha = options.alpha ?? 1;
    this.eventMode = 'none';
    this.layout = options.layout ?? { width: this.width, height: this.height };
  }

  measureLayout(): LayoutSize {
    return { width: this.width, height: this.height };
  }

  applyLayout(width: number, height: number): void {
    this.resize(width, height);
  }

  /** Same as `applyLayout` — also usable as a `UiDecoration` (a `UiImage`
   *  backdrop behind a `UiDecoratedBox`'s flow children), which resizes
   *  outside the flex pass and so calls this directly instead. */
  resize(width: number, height: number): void {
    this.setSize(width, height);
  }
}
