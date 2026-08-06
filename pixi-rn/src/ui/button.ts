import '../core/adapter';
import { Container, Rectangle } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { LayoutStyles } from '../layout/layout';

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
