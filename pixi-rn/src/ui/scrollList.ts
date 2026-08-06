import '../core/adapter';
import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { layoutSize, type LayoutStyles } from '../layout/layout';

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
 * core/adapter.ts), and pixi v8's `ScissorMask` is vestigial — it carries no
 * `MaskEffect` extension and no `scissorMask` pipe exists, so it is never
 * selected. A Sprite mask resolves to `AlphaMask`, which runs through the
 * filter system. It costs one offscreen pass while the list is on screen; rows
 * sliding under the edge instead of vanishing at it is worth that.
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
    // ⚠️ CAPTURE phase. Rows are typically buttons that stop propagation on
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
