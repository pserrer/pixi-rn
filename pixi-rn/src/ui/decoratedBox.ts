import '../core/adapter';
import { Container } from 'pixi.js';
import type { LayoutStyles } from '../layout/layout';

/**
 * A display node whose background/border needs to resize to the box's FINAL
 * resolved size rather than take part in the flex pass itself — `UiPanel`,
 * `UiRect` and `UiImage` all satisfy this already (their `resize()` is the
 * same code their `applyLayout()` calls). Write your own for anything more
 * elaborate (a multi-part fill, a custom shape) — it only needs this one
 * method.
 */
export interface UiDecoration extends Container {
  resize(width: number, height: number): void;
}

export interface UiDecoratedBoxOptions {
  layout?: LayoutStyles;
  /** Backing layers, drawn back-to-front, BEHIND whatever flow children get
   *  added afterward. None of them take part in flex layout — resized to the
   *  box's own resolved size once layout is final, not before. */
  decor?: UiDecoration[];
  label?: string;
}

/**
 * A flex box whose ordinary FLOW children lay out normally (add them the
 * usual way — `box.addChild(...)`, each with its own `.layout` style) plus
 * one or more background decorations that resize to the box's own resolved
 * size, not before.
 *
 * A decoration can't size itself from its own content the way a flow child
 * does: it has to cover whatever box the flow children end up defining, which
 * is only known after layout. So each one lives in a child container with NO
 * `layout` style — `layout/layout.ts`'s flex pass skips a node with none,
 * whole subtree — and this box resizes them itself from `applyLayout`, the
 * one hook that runs after its own box is final. That is the same trick
 * `UiPanel` uses for its own nine-slice border, generalized to compose
 * several decorations (a fill AND a frame, say) behind arbitrary content.
 */
export class UiDecoratedBox extends Container {
  private readonly decor: UiDecoration[];

  constructor(options: UiDecoratedBoxOptions = {}) {
    super({ label: options.label ?? 'ui-decorated-box' });
    this.layout = options.layout ?? {};
    this.decor = options.decor ?? [];
    const backdrop = new Container({ label: 'ui-decorated-box-backdrop' });
    backdrop.eventMode = 'none';
    for (const d of this.decor) backdrop.addChild(d);
    this.addChild(backdrop);
  }

  applyLayout(width: number, height: number): void {
    for (const d of this.decor) d.resize(width, height);
  }
}
