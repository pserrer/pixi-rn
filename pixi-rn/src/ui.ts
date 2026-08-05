// Retained, canvas-free Pixi UI primitives for React Native / expo-gl.
//
// `Graphics`, `Text`, and `Texture.WHITE` all create or depend on a DOM canvas,
// so none are safe here. Callers provide uploaded textures, including a 1x1
// white texture from makeWhiteTexture() for solid-colour elements.
import './adapter';
import { BitmapText, Container, NineSliceSprite, Rectangle, Sprite, Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';

import { createBitmapText, type BitmapTextOptions } from './bitmapFont';

export interface UiRectOptions {
  x?: number;
  y?: number;
  width: number;
  height: number;
  color?: number;
  alpha?: number;
}

/** Creates a solid retained rectangle by tinting an Expo-safe 1x1 texture. */
export function createUiRect(white: Texture, options: UiRectOptions): Sprite {
  const rect = new Sprite(white);
  rect.position.set(options.x ?? 0, options.y ?? 0);
  rect.width = options.width;
  rect.height = options.height;
  rect.tint = options.color ?? 0xffffff;
  rect.alpha = options.alpha ?? 1;
  return rect;
}

export interface UiImageOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  tint?: number;
  alpha?: number;
}

/** A retained image with optional destination dimensions. */
export class UiImage extends Sprite {
  constructor(texture: Texture, options: UiImageOptions = {}) {
    super(texture);
    this.position.set(options.x ?? 0, options.y ?? 0);
    if (options.width !== undefined) this.width = options.width;
    if (options.height !== undefined) this.height = options.height;
    this.tint = options.tint ?? 0xffffff;
    this.alpha = options.alpha ?? 1;
  }
}

export interface UiPanelOptions {
  x?: number;
  y?: number;
  width: number;
  height: number;
  leftWidth: number;
  topHeight: number;
  rightWidth: number;
  bottomHeight: number;
  alpha?: number;
}

/** A retained mesh-based nine-slice panel. */
export class UiPanel extends NineSliceSprite {
  constructor(texture: Texture, options: UiPanelOptions) {
    super({
      texture,
      leftWidth: options.leftWidth,
      topHeight: options.topHeight,
      rightWidth: options.rightWidth,
      bottomHeight: options.bottomHeight,
    });
    this.position.set(options.x ?? 0, options.y ?? 0);
    this.width = options.width;
    this.height = options.height;
    this.alpha = options.alpha ?? 1;
  }

  setSize(width: number, height: number): this {
    this.width = width;
    this.height = height;
    return this;
  }
}

export interface UiLabelOptions extends BitmapTextOptions {
  x?: number;
  y?: number;
  alpha?: number;
  outline?: { color: number; width?: number };
}

const OUTLINE_DIRECTIONS: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** Bitmap-font label with an optional pixel outline made from retained glyph runs. */
export class UiLabel extends Container {
  readonly foreground: BitmapText;
  private readonly outlines: BitmapText[];
  private readonly outlineWidth: number;

  constructor(text: string, options: UiLabelOptions = {}) {
    super();
    this.position.set(options.x ?? 0, options.y ?? 0);
    this.alpha = options.alpha ?? 1;
    this.outlineWidth = options.outline?.width ?? 1;
    this.outlines = options.outline
      ? OUTLINE_DIRECTIONS.map(([x, y]) => {
        const label = createBitmapText(text, { ...options, tint: options.outline?.color });
        label.position.set(x * this.outlineWidth, y * this.outlineWidth);
        this.addChild(label);
        return label;
      })
      : [];
    this.foreground = createBitmapText(text, options);
    this.addChild(this.foreground);
  }

  setText(text: string): this {
    for (const outline of this.outlines) outline.text = text;
    this.foreground.text = text;
    return this;
  }

  setTint(tint: number): this {
    this.foreground.tint = tint;
    return this;
  }
}

export interface UiButtonOptions {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** Visual child; callers may supply a panel, image, label, or a composed Container. */
  content?: Container;
  /** Pixels the visual moves down while held. Defaults to 1. */
  pressedOffset?: number;
  disabled?: boolean;
  onPress?: () => void;
}

/** Interactive retained button with a stable hit rectangle and pressed offset. */
export class UiButton extends Container {
  readonly visual = new Container();
  private readonly pressedOffset: number;
  private onPress: (() => void) | undefined;
  private activePointer: number | null = null;
  private enabled = true;

  constructor(options: UiButtonOptions) {
    super();
    this.position.set(options.x ?? 0, options.y ?? 0);
    this.pressedOffset = options.pressedOffset ?? 1;
    this.onPress = options.onPress;
    this.eventMode = 'static';
    this.hitArea = new Rectangle(0, 0, options.width, options.height);
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
    // `pointertap` can still be mapped after a release outside was delivered
    // to a nested display object. Only activate the pointer that began here.
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
}

/**
 * A retained horizontal slider. It listens to Pixi's public global move event
 * while dragging, so the thumb remains responsive after a pointer leaves its
 * hit area. The native bridge must continue forwarding move/up events to its
 * EventBoundary for this behaviour to apply.
 */
export class UiSlider extends Container {
  readonly track: Sprite;
  readonly thumb: Sprite;
  private readonly travel: number;
  private value = 0;
  private activePointer: number | null = null;
  private onValueChange: ((value: number) => void) | undefined;

  constructor(options: UiSliderOptions) {
    super();
    this.position.set(options.x ?? 0, options.y ?? 0);
    this.eventMode = 'static';
    this.hitArea = new Rectangle(0, 0, options.width, options.height);

    this.track = new Sprite(options.track);
    this.track.width = options.width;
    this.track.height = options.height;
    this.track.eventMode = 'none';

    this.thumb = new Sprite(options.thumb);
    this.thumb.width = options.thumbWidth ?? options.thumb.width;
    this.thumb.height = options.thumbHeight ?? options.thumb.height;
    this.thumb.y = Math.round((options.height - this.thumb.height) / 2);
    this.thumb.eventMode = 'none';
    this.travel = Math.max(0, options.width - this.thumb.width);
    this.onValueChange = options.onValueChange;

    this.addChild(this.track, this.thumb);
    this.setValue(options.value ?? 0);

    this.on('pointerdown', this.handleDown, this);
    this.on('globalpointermove', this.handleGlobalMove, this);
    this.on('pointerup', this.handleUp, this);
    this.on('pointerupoutside', this.handleUp, this);
  }

  setValue(value: number, emit = false): this {
    const next = Math.min(1, Math.max(0, value));
    const changed = next !== this.value;
    this.value = next;
    this.thumb.x = Math.round(this.travel * next);
    if (emit && changed) this.onValueChange?.(next);
    return this;
  }

  getValue(): number { return this.value; }

  setOnValueChange(onValueChange: ((value: number) => void) | undefined): this {
    this.onValueChange = onValueChange;
    return this;
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
    const value = this.travel === 0 ? 0 : (local.x - this.thumb.width / 2) / this.travel;
    this.setValue(value, true);
  }
}
