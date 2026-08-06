import '../core/adapter';
import { NineSliceSprite, Texture } from 'pixi.js';
import type { LayoutSize, LayoutStyles } from '../layout/layout';

export interface UiPanelOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Source border width. The destination border is `min(this, corner)` —
   *  pixi's NineSliceSprite shares one number for both, so a destination corner
   *  larger than the art provides would stretch the border into the fill. */
  inset: number;
  corner?: number;
  alpha?: number;
  layout?: LayoutStyles;
}

/** A mesh-based nine-slice panel (safe here — no canvas rasterization). */
export class UiPanel extends NineSliceSprite {
  private readonly border: number;

  constructor(texture: Texture, options: UiPanelOptions) {
    const border = Math.min(options.corner ?? options.inset, options.inset);
    super({ texture, leftWidth: border, topHeight: border, rightWidth: border, bottomHeight: border });
    this.border = border;
    this.position.set(options.x ?? 0, options.y ?? 0);
    this.alpha = options.alpha ?? 1;
    this.eventMode = 'none';
    if (options.layout) this.layout = options.layout;
    if (options.width !== undefined || options.height !== undefined) {
      this.resize(options.width ?? this.width, options.height ?? this.height);
    }
  }

  measureLayout(): LayoutSize {
    return { width: this.width, height: this.height };
  }

  applyLayout(width: number, height: number): void {
    this.resize(width, height);
  }

  /**
   * The ONLY way to size a panel.
   *
   * ⚠️ Never assign `.width`/`.height` directly. The border is clamped against
   * the DESTINATION as well as the source art — opposite borders that together
   * exceed the destination would otherwise overlap in the middle and render as
   * a smear of the panel's own corners. That clamp has to be RE-EVALUATED on
   * every resize: a panel built at a placeholder size (say 1×1, waiting for
   * layout) clamps its border to half a pixel, and a later `.width = 300` that
   * skips this method leaves it there. A sub-pixel border is a degenerate
   * nine-slice — the whole texture simply stretches, corners and all, which
   * looks like a frame whose brackets have swollen and no longer meet their
   * rails.
   */
  resize(width: number, height: number): void {
    const border = Math.max(0, Math.min(this.border, width / 2, height / 2));
    this.leftWidth = this.rightWidth = border;
    this.topHeight = this.bottomHeight = border;
    this.width = width;
    this.height = height;
  }
}
