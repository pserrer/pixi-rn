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
import { layoutSize, type LayoutSize, type LayoutStyles } from './layout';

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

export interface UiScrollListOptions {
  /** The viewport: what stays visible. Content taller than this scrolls. */
  layout: LayoutStyles;
  /** Flex style for the content column the rows are added to. */
  content: LayoutStyles;
  /** A 1×1 white texture. Stretched to the viewport it becomes the clip mask —
   *  without it rows spill past whatever frames the list. */
  clip: Texture;
  /** The only affordance that anything exists below the fold — without it a
   *  list that ends flush at its viewport reads as complete. */
  scrollbar?: { texture: Texture; width: number; color?: number; alpha?: number };
}

/** Pixels a pointer must travel before the gesture counts as a scroll. */
const DRAG_THRESHOLD = 6;
/** Reference frame for every per-frame rate below, so they hold at any fps. */
const FRAME_MS = 1000 / 60;
/** Share of the tracked velocity the newest move sample replaces. */
const FLICK_SMOOTHING = 0.35;
/** A finger that has been still this long is resting, not flicking. */
const FLICK_IDLE_MS = 80;
/** Momentum retained per frame after release. */
const FRICTION = 0.94;
/** px/ms below which the glide has stopped being motion. */
const STOP_SPEED = 0.02;
/** Share of an out-of-range drag that actually moves the list. */
const RUBBER = 0.4;
/** How far past an end a drag can pull, as a share of the viewport. */
const RUBBER_MAX = 0.25;
/** Share of the remaining overscroll left after each frame of springback. */
const SPRING_DECAY = 0.75;

/** Monotonic ms. RN provides `performance.now()`; `Date.now()` is the floor. */
interface PerformanceLike {
  now?: () => number;
}
const nowMs = (): number => (globalThis.performance as PerformanceLike | undefined)?.now?.() ?? Date.now();

/**
 * A vertically scrolling list, clipped to its viewport.
 *
 * ⚠️ The mask is a plain SPRITE, and it has to be. `Graphics` is unusable here
 * (it lazily rasterizes a 2D canvas that expo-gl does not have, see
 * adapter.ts), and pixi v8's `ScissorMask` is vestigial — it carries no
 * `MaskEffect` extension and no `scissorMask` pipe exists, so it is never
 * selected. A Sprite mask resolves to `AlphaMask`, which runs through the
 * filter system — the same system `BlurFilter` already uses on this stack. It
 * costs one offscreen pass while the list is on screen; rows sliding under the
 * edge instead of vanishing at it is worth that.
 *
 * Culling still runs, but only for draw-call economy: a row is hidden when it
 * is FULLY outside the viewport, never while any part of it shows.
 *
 * Scrolling is kinetic: a flick keeps gliding under friction after release, and
 * a drag past either end pulls against a rubber band that springs back. Both
 * are advanced by `update(dtMs)`, which the host calls from ITS frame loop —
 * ⚠️ never from a timer of the list's own. A `setInterval` here would be JS
 * work scheduled wherever the timer queue puts it, shouldering into frames the
 * renderer was due to use.
 */
export class UiScrollList extends Container {
  /** Rows go here — it is an ordinary flex column. */
  readonly content: Container;
  private readonly hit = new Rectangle(0, 0, 0, 0);
  private readonly clip: Sprite;
  private viewportHeight = 0;
  private offset = 0;
  private pointerId: number | null = null;
  private startY = 0;
  private startOffset = 0;
  private moved = false;
  /** Offset px per ms, tracked across the drag and spent after release. */
  private velocity = 0;
  private lastMoveMs = 0;
  private readonly track: Sprite | null;
  private readonly thumb: Sprite | null;

  constructor(options: UiScrollListOptions) {
    super({ label: 'scroll-list' });
    this.layout = options.layout;
    this.eventMode = 'static';
    this.hitArea = this.hit;
    this.content = new Container({ label: 'scroll-content' });
    this.content.layout = options.content;
    this.addChild(this.content);
    // The mask sits on the CONTENT, not on the list: masking the list would
    // fold the scrollbar into the same offscreen pass for no reason. It is a
    // child of the list so it stays put while the content scrolls under it, and
    // it carries no `layout` style so the flex pass skips it.
    this.clip = new Sprite({ texture: options.clip, label: 'scroll-mask' });
    this.clip.eventMode = 'none';
    this.addChild(this.clip);
    this.content.mask = this.clip;
    if (options.scrollbar) {
      const bar = options.scrollbar;
      this.track = new Sprite(bar.texture);
      this.track.tint = bar.color ?? 0x000000;
      this.track.alpha = (bar.alpha ?? 1) * 0.35;
      this.thumb = new Sprite(bar.texture);
      this.thumb.tint = bar.color ?? 0xffffff;
      this.thumb.alpha = bar.alpha ?? 1;
      for (const part of [this.track, this.thumb]) {
        part.eventMode = 'none';
        part.width = bar.width;
        this.addChild(part);
      }
    } else {
      this.track = null;
      this.thumb = null;
    }
    // ⚠️ CAPTURE phase. The rows are buttons and stop propagation on
    // `pointerdown`, so a bubble-phase listener here would only ever see
    // presses that missed a row — which on a full list is almost never.
    this.on('pointerdowncapture', this.onDown, this);
    this.on('globalpointermove', this.onMove, this);
    this.on('pointerupcapture', this.onUp, this);
    this.on('pointerupoutside', this.onUp, this);
  }

  applyLayout(width: number, height: number): void {
    this.hit.width = width;
    this.hit.height = height;
    this.viewportHeight = height;
    this.clip.setSize(width, height);
  }

  /** Rows are only positioned once the whole tree is arranged. */
  layoutComplete(): void {
    this.scrollTo(this.offset);
  }

  /**
   * Advances the glide and the springback. Call it once per frame from the
   * host's own loop; it early-outs on every frame the list is at rest, which is
   * almost all of them.
   */
  update(dtMs: number): void {
    if (dtMs <= 0 || this.pointerId !== null) return;
    const frames = dtMs / FRAME_MS;
    const max = this.maxOffset();
    // Overscrolled: the band wins outright, whatever momentum was left.
    if (this.offset < 0 || this.offset > max) {
      const edge = this.offset < 0 ? 0 : max;
      this.velocity = 0;
      const settled = edge + (this.offset - edge) * Math.pow(SPRING_DECAY, frames);
      this.place(Math.abs(settled - edge) < 0.5 ? edge : settled);
      return;
    }
    if (this.velocity === 0) return;
    const next = this.offset + this.velocity * dtMs;
    this.velocity *= Math.pow(FRICTION, frames);
    // Glides stop AT the ends rather than bouncing off them: a bounce the
    // finger did not ask for reads as the list rejecting the gesture.
    if (next <= 0 || next >= max) {
      this.velocity = 0;
      this.place(Math.max(0, Math.min(max, next)));
      return;
    }
    if (Math.abs(this.velocity) < STOP_SPEED) this.velocity = 0;
    this.place(next);
  }

  /**
   * Whether the gesture that just ended actually scrolled. A row must consult
   * this before acting on its press — otherwise flicking the list buys
   * whatever happened to be under the finger.
   */
  get scrolled(): boolean {
    return this.moved;
  }

  private maxOffset(): number {
    return Math.max(0, layoutSize(this.content).height - this.viewportHeight);
  }

  private scrollTo(offset: number): void {
    this.place(Math.max(0, Math.min(this.maxOffset(), offset)));
  }

  /** Moves the content to an offset that may sit OUTSIDE the range — the
   *  rubber band and its springback both live there. Callers that must stay in
   *  range clamp first (`scrollTo`). */
  private place(offset: number): void {
    this.offset = offset;
    // Rounded on the way to the screen: this is pixel art, and a content column
    // resting on a half pixel samples every row's art off-grid.
    this.content.y = -Math.round(offset);
    // Cull only what the mask would discard anyway — a row is hidden once it is
    // entirely past an edge, so a partially visible one still draws and gets
    // trimmed by the clip.
    for (const row of this.content.children) {
      const top = row.y - offset;
      row.visible = top + layoutSize(row).height > -0.5 && top < this.viewportHeight + 0.5;
    }
    this.syncScrollbar(this.maxOffset());
  }

  /** How far a drag past either end actually moves the list. */
  private resist(offset: number): number {
    const max = this.maxOffset();
    if (offset >= 0 && offset <= max) return offset;
    const edge = offset < 0 ? 0 : max;
    const limit = this.viewportHeight * RUBBER_MAX;
    const over = (offset - edge) * RUBBER;
    return edge + Math.max(-limit, Math.min(limit, over));
  }

  private syncScrollbar(max: number): void {
    if (!this.track || !this.thumb) return;
    // Nothing to scroll, nothing to advertise.
    this.track.visible = this.thumb.visible = max > 0.5;
    if (!this.track.visible) return;
    const content = layoutSize(this.content).height;
    const x = this.hit.width - this.track.width;
    this.track.position.set(x, 0);
    this.track.height = this.viewportHeight;
    this.thumb.height = Math.max(12, (this.viewportHeight / content) * this.viewportHeight);
    // Clamped: the offset leaves the range while the rubber band is stretched,
    // and the thumb must not follow it out of its track.
    const travel = Math.max(0, Math.min(1, this.offset / max));
    this.thumb.position.set(x, travel * (this.viewportHeight - this.thumb.height));
  }

  private onDown(event: FederatedPointerEvent): void {
    this.pointerId = event.pointerId;
    this.startY = event.global.y;
    this.startOffset = this.offset;
    this.lastMoveMs = nowMs();
    // Catching a list that is still moving is a scroll gesture, not a press:
    // the finger came down to STOP it. Reporting it as a tap would buy whatever
    // happened to glide under the thumb.
    this.moved = this.velocity !== 0 || this.offset < 0 || this.offset > this.maxOffset();
    this.velocity = 0;
  }

  private onMove(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    const delta = this.startY - event.global.y;
    if (!this.moved && Math.abs(delta) < DRAG_THRESHOLD) return;
    this.moved = true;
    const previous = this.offset;
    this.place(this.resist(this.startOffset + delta));
    // ⚠️ Sampled off a LOCAL monotonic clock, not the event's `timeStamp`: that
    // one comes from the native surface, whose epoch and units are the host's
    // business and not this package's to assume.
    const now = nowMs();
    const elapsed = now - this.lastMoveMs;
    if (elapsed <= 0) return;
    this.lastMoveMs = now;
    this.velocity += ((this.offset - previous) / elapsed - this.velocity) * FLICK_SMOOTHING;
  }

  private onUp(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    // No snap-to-row on release: the clip means a half-visible row is a correct
    // resting state, and a jump on lift-off would only fight the finger.
    // A finger that came to rest before lifting is placing the list, not
    // throwing it — anything else releases a list that keeps running after the
    // gesture visibly stopped.
    if (!this.moved || nowMs() - this.lastMoveMs > FLICK_IDLE_MS) this.velocity = 0;
    // `moved` deliberately SURVIVES the release: pixi dispatches `pointertap`
    // after `pointerup`, and the row's press handler reads it there. It is
    // cleared on the next press instead.
    this.pointerId = null;
  }
}
