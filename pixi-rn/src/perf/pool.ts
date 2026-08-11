// A flat pool of reusable retained-scene-graph nodes inside one Container.
// The generic form of "resize an N-node layer every frame without
// reallocating" — the same shape of pooling a per-frame terrain/particle/HUD
// layer always needs, independent of what game or app it's for.
import '../core/adapter';
import { Container } from 'pixi.js';

/**
 * A flat pool of reusable `TNode`s inside one retained `Container`.
 *
 * `fill()` retargets as many pooled nodes as `items` holds — growing the pool
 * with `create()` on demand — and hides the rest. Once a layer's steady-state
 * item count is reached, a refresh allocates nothing: no new node, no scene
 * graph insert, no destroyed node to garbage-collect.
 *
 * This is the fix for the common mistake of rebuilding a layer from scratch
 * every frame (e.g. `container.removeChildren()` + a fresh `Sprite` per
 * item): that costs an allocation, a scene-graph insert/remove, and a full
 * new GPU vertex upload for every item, every frame, even when nothing about
 * that item changed.
 *
 * @example
 * ```ts
 * const pool = new Pool(() => new Sprite());
 * // every frame:
 * pool.fill(visibleTiles, (sprite, tile) => {
 *   sprite.texture = tile.texture;
 *   sprite.position.set(tile.x, tile.y);
 * });
 * ```
 */
export class Pool<TNode extends Container> {
  /** The retained parent all pooled nodes live under. Add this once. */
  readonly container = new Container();
  private nodes: TNode[] = [];

  /** @param create Builds one fresh node. Called only when `fill()` needs to
   *    grow the pool — never per-frame once a layer's size has stabilized. */
  constructor(private readonly create: () => TNode) {}

  /** Current pool size (visible + hidden). Grows on demand; never shrinks —
   *  that is what "allocates nothing at steady state" means. */
  get size(): number {
    return this.nodes.length;
  }

  /**
   * Ensure exactly `items.length` visible nodes, each configured in order by
   * `configure`. Pooled nodes left over from a previous, larger `fill()` are
   * hidden (`visible = false`), not destroyed — ready to be reused the next
   * time `items` grows back, instead of being reallocated.
   */
  fill<TItem>(items: readonly TItem[], configure: (node: TNode, item: TItem, index: number) => void): void {
    let k = 0;
    for (const item of items) {
      if (k === this.nodes.length) {
        const node = this.create();
        this.container.addChild(node);
        this.nodes.push(node);
      }
      const node = this.nodes[k++];
      node.visible = true;
      configure(node, item, k - 1);
    }
    for (let i = k; i < this.nodes.length; i++) this.nodes[i].visible = false;
  }

  /** Destroys the container and every pooled node. The pool is unusable after
   *  this — construct a new one rather than reviving it. */
  destroy(): void {
    this.container.destroy({ children: true });
    this.nodes = [];
  }
}
