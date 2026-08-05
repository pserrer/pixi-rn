// Retained, canvas-free Pixi UI primitives for React Native / expo-gl.
//
// ⚠️ `Graphics`, `Text` and `Texture.WHITE` all create or depend on a DOM
// canvas, so none are usable here (see adapter.ts). Callers provide uploaded
// textures, including a 1×1 white one from `makeWhiteTexture()` for solid fills.
//
// Every primitive participates in `layout.ts`'s flex pass through the same two
// hooks: `measureLayout()` reports intrinsic content size, `applyLayout()`
// receives the final box. Nothing paints at a size before `applyLayout` — that
// is what lets a row stretch a panel or ellipsize a label after the fact.
import './adapter';
import { BitmapText, Container, NineSliceSprite, Rectangle, Sprite, Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { LayoutSize, LayoutStyles } from './layout';

import { createBitmapText, measureText, type BitmapTextOptions } from './bitmapFont';

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
    this.setSize(width, height);
  }
}

/** Convenience wrapper kept for call sites that only want the sprite. */
export function createUiRect(white: Texture, options: UiRectOptions): UiRect {
  return new UiRect(white, options);
}

/** A named flex container. Sizing/placement comes from `applyFlexLayout`. */
export function createUiLayout(style: LayoutStyles, label = 'ui-layout'): Container {
  const container = new Container({ label });
  container.layout = style;
  return container;
}

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
 *  Texture per rebuild (see the kit's crop cache). */
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
    this.setSize(width, height);
  }
}

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
  constructor(texture: Texture, options: UiPanelOptions) {
    const border = Math.min(options.corner ?? options.inset, options.inset);
    super({ texture, leftWidth: border, topHeight: border, rightWidth: border, bottomHeight: border });
    this.position.set(options.x ?? 0, options.y ?? 0);
    if (options.width !== undefined) this.width = options.width;
    if (options.height !== undefined) this.height = options.height;
    this.alpha = options.alpha ?? 1;
    this.eventMode = 'none';
    if (options.layout) this.layout = options.layout;
  }

  measureLayout(): LayoutSize {
    return { width: this.width, height: this.height };
  }

  applyLayout(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }
}

export interface UiLabelOptions extends BitmapTextOptions {
  x?: number;
  y?: number;
  alpha?: number;
  /** The hard pixel outline: 8 offset copies behind the foreground. RN has no
   *  text stroke and `textShadow*` does not render on this build, so this is
   *  how the art style's outline has always been drawn. */
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

/** Bitmap-font label with the pixel outline, sized from JS text metrics.
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

export interface UiButtonOptions {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** The visual: a panel, image, label or a composed Container. */
  content?: Container;
  /** Pixels the visual moves down while held. Defaults to 1. */
  pressedOffset?: number;
  disabled?: boolean;
  onPress?: () => void;
  layout?: LayoutStyles;
}

/** Interactive control with a hit rectangle that follows its resolved box. */
export class UiButton extends Container {
  readonly visual = new Container();
  private readonly pressedOffset: number;
  private readonly hit: Rectangle;
  private onPress: (() => void) | undefined;
  private activePointer: number | null = null;
  private enabled = true;

  constructor(options: UiButtonOptions) {
    super();
    this.position.set(options.x ?? 0, options.y ?? 0);
    this.pressedOffset = options.pressedOffset ?? 1;
    this.onPress = options.onPress;
    this.eventMode = 'static';
    this.layout = options.layout ?? { width: options.width, height: options.height };
    this.hit = new Rectangle(0, 0, options.width, options.height);
    this.hitArea = this.hit;
    // The visual fills the button, so a content node with its own layout gets
    // laid out by the normal pass rather than needing the button to drive it.
    this.visual.layout = { width: '100%', height: '100%' };
    this.addChild(this.visual);
    if (options.content) this.visual.addChild(options.content);
    this.setEnabled(!options.disabled);

    this.on('pointerdown', this.handleDown, this);
    this.on('pointerup', this.handleUp, this);
    this.on('pointerupoutside', this.handleCancel, this);
    this.on('pointertap', this.handleTap, this);
  }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    this.alpha = enabled ? 1 : 0.5;
    if (!enabled) this.release();
    return this;
  }

  setOnPress(onPress: (() => void) | undefined): this {
    this.onPress = onPress;
    return this;
  }

  /** The hit rectangle is the button's own box, so it has to follow layout —
   *  a stretched row whose target stayed at its measured width is a control
   *  that visibly moves but only reacts on part of itself. */
  applyLayout(width: number, height: number): void {
    this.hit.width = width;
    this.hit.height = height;
  }

  private handleDown(event: FederatedPointerEvent): void {
    if (!this.enabled) return;
    event.stopPropagation();
    this.activePointer = event.pointerId;
    this.visual.y = this.pressedOffset;
  }

  private handleUp(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.activePointer) return;
    event.stopPropagation();
    this.release();
  }

  private handleCancel(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.activePointer) return;
    event.stopPropagation();
    this.release();
  }

  private handleTap(event: FederatedPointerEvent): void {
    if (!this.enabled) return;
    event.stopPropagation();
    // `pointertap` can still be mapped after a release outside was delivered to
    // a nested display object. Only activate the pointer that began here.
    if (this.activePointer !== null && event.pointerId !== this.activePointer) return;
    this.release();
    this.onPress?.();
  }

  private release(): void {
    this.activePointer = null;
    this.visual.y = 0;
  }
}

export interface UiSliderOptions {
  x?: number;
  y?: number;
  width: number;
  height: number;
  value?: number;
  track: Texture;
  thumb: Texture;
  /** Destination width of the thumb; defaults to its texture width. */
  thumbWidth?: number;
  /** Destination height of the thumb; defaults to its texture height. */
  thumbHeight?: number;
  onValueChange?: (value: number) => void;
  layout?: LayoutStyles;
}

/**
 * A horizontal slider. It listens to Pixi's global move event while dragging,
 * so the thumb stays responsive after the pointer leaves its hit area — the
 * native bridge must keep forwarding move/up events to the EventBoundary for
 * that to hold.
 */
export class UiSlider extends Container {
  readonly track: Sprite;
  readonly thumb: Sprite;
  private readonly hit: Rectangle;
  private width_: number;
  private value = 0;
  private activePointer: number | null = null;
  private onValueChange: ((value: number) => void) | undefined;

  constructor(options: UiSliderOptions) {
    super();
    this.position.set(options.x ?? 0, options.y ?? 0);
    this.eventMode = 'static';
    this.width_ = options.width;
    this.hit = new Rectangle(0, 0, options.width, options.height);
    this.hitArea = this.hit;

    this.track = new Sprite(options.track);
    this.track.setSize(options.width, options.height);
    this.track.eventMode = 'none';

    this.thumb = new Sprite(options.thumb);
    this.thumb.setSize(options.thumbWidth ?? options.thumb.width, options.thumbHeight ?? options.thumb.height);
    this.thumb.y = Math.round((options.height - this.thumb.height) / 2);
    this.thumb.eventMode = 'none';
    this.onValueChange = options.onValueChange;
    this.layout = options.layout ?? { width: options.width, height: options.height };

    this.addChild(this.track, this.thumb);
    this.setValue(options.value ?? 0);

    this.on('pointerdown', this.handleDown, this);
    this.on('globalpointermove', this.handleGlobalMove, this);
    this.on('pointerup', this.handleUp, this);
    this.on('pointerupoutside', this.handleUp, this);
  }

  applyLayout(width: number, height: number): void {
    this.width_ = width;
    this.hit.width = width;
    this.hit.height = height;
    this.track.setSize(width, height);
    this.thumb.y = Math.round((height - this.thumb.height) / 2);
    this.setValue(this.value);
  }

  setValue(value: number, emit = false): this {
    const next = Math.min(1, Math.max(0, value));
    const changed = next !== this.value;
    this.value = next;
    this.thumb.x = Math.round(this.travel() * next);
    if (emit && changed) this.onValueChange?.(next);
    return this;
  }

  getValue(): number {
    return this.value;
  }

  setOnValueChange(onValueChange: ((value: number) => void) | undefined): this {
    this.onValueChange = onValueChange;
    return this;
  }

  private travel(): number {
    return Math.max(0, this.width_ - this.thumb.width);
  }

  private handleDown(event: FederatedPointerEvent): void {
    event.stopPropagation();
    this.activePointer = event.pointerId;
    this.setFromEvent(event);
  }

  private handleGlobalMove(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.activePointer) return;
    event.stopPropagation();
    this.setFromEvent(event);
  }

  private handleUp(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.activePointer) return;
    event.stopPropagation();
    this.setFromEvent(event);
    this.activePointer = null;
  }

  private setFromEvent(event: FederatedPointerEvent): void {
    const local = this.toLocal(event.global);
    const travel = this.travel();
    this.setValue(travel === 0 ? 0 : (local.x - this.thumb.width / 2) / travel, true);
  }
}
