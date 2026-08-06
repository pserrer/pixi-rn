import '../core/adapter';
import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { LayoutStyles } from '../layout/layout';

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
 *
 * ⚠️ `onValueChange` fires ONCE, when the gesture ENDS. The thumb tracks the
 * finger live off the slider's own state; nothing is reported until release.
 *
 * That is not a stylistic choice. A host that turns the reported value into
 * state will re-render, and a retained UI rebuilt from that render DESTROYS
 * this slider mid-gesture — taking its pointer capture with it. Emitting on
 * press made every drag die on its first frame: the press value landed and the
 * control that owned the pointer no longer existed, which reads exactly like a
 * tap-only slider. Reporting continuously would also put a full host render
 * between every pair of move events.
 */
export class UiSlider extends Container {
  readonly track: Sprite;
  readonly thumb: Sprite;
  private readonly hit: Rectangle;
  private width_: number;
  private value = 0;
  /** Value at the moment of the press, so a gesture that lands where it started
   *  reports nothing. */
  private pressedValue = 0;
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

  /** Moves the thumb. Silent by design — see the class note on why the host
   *  only hears about a change once the gesture is over. */
  setValue(value: number): this {
    const next = Math.min(1, Math.max(0, value));
    this.value = next;
    this.thumb.x = Math.round(this.travel() * next);
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
    this.pressedValue = this.value;
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
    // The whole gesture reports as one change — a tap and a drag alike.
    if (this.value !== this.pressedValue) this.onValueChange?.(this.value);
  }

  private setFromEvent(event: FederatedPointerEvent): void {
    const local = this.toLocal(event.global);
    const travel = this.travel();
    this.setValue(travel === 0 ? 0 : (local.x - this.thumb.width / 2) / travel);
  }
}
