// A generic retained-Pixi UI root: an ORDERED stack of named layers, each
// rebuilt independently and only when its own key changes IDENTITY — the
// pattern a React-driven Pixi UI needs regardless of the app built on it (a
// HUD that persists under a modal screen, a title/pause/shop/settings switch
// on top of it, a transient toast above everything). Extracted from a
// shipping game's UI root, which used to hand-wire this exact shape: a shared
// blocker, three ordered layers, one snapshot-identity check per rebuild, and
// a manual walk for `UiScrollList`s to drive every frame.
import '../core/adapter';
import { Container, Rectangle } from 'pixi.js';
import { applyFlexLayout } from '../layout/layout';
import { UiScrollList } from './scrollList';

export interface UiLayerConfig {
  /** Unique name this layer is addressed by from `update()`/`layer()`. */
  name: string;
  /** Whether this layer activates the stack's shared blocker while it
   *  currently has content — i.e. whether it is "modal": every layer BELOW
   *  it, and anything the host mounts behind the whole stack, should stop
   *  receiving presses that miss every control. Only one blocker exists for
   *  the whole stack; it activates while ANY blocking layer is non-empty. */
  blocking?: boolean;
}

export interface UiLayerStackOptions {
  /** Logical (dp) size of the surface the stack lays out against. */
  width: number;
  height: number;
  /** Layers in PAINT ORDER: earlier entries render first (at the bottom),
   *  later entries render on top and are hit-tested before the ones beneath
   *  them — the same order `Container.addChild` would give them. */
  layers: UiLayerConfig[];
}

interface LayerState {
  container: Container;
  blocking: boolean;
  content: Container | null;
  key: unknown;
  scrollers: UiScrollList[];
}

/** Never equal to any real key, so the first `update()` call always builds. */
const UNSET = Symbol('ui-layer-stack-unset');

function unknownLayer(name: string): Error {
  return new Error(`pixi-rn: no UI layer named "${name}" — check UiLayerStackOptions.layers`);
}

/**
 * Owns an ordered stack of named layers, each rebuilt only when the `key`
 * handed to `update()` is a DIFFERENT OBJECT than last time — an O(1),
 * allocation-free check that is exactly "did the host re-render?" when the
 * host hands in a fresh object per render and never mutates one afterwards.
 *
 * One shared, full-surface blocker sits at the very BOTTOM of the stack (so
 * every declared layer is hit-tested before it, regardless of which one is
 * modal) and activates whenever a layer declared `blocking: true` currently
 * has content — so a press that misses every control on a modal screen never
 * reaches whatever the host mounts behind this stack, while a non-modal layer
 * (a HUD, a toast) never blocks anything by itself.
 */
export class UiLayerStack {
  readonly root = new Container({ label: 'ui-layer-stack' });
  private readonly blocker = new Container({ label: 'ui-layer-stack-blocker' });
  private readonly layers = new Map<string, LayerState>();

  constructor(options: UiLayerStackOptions) {
    this.root.layout = { width: options.width, height: options.height };
    this.blocker.eventMode = 'static';
    this.blocker.hitArea = new Rectangle(0, 0, options.width, options.height);
    this.blocker.visible = false;
    this.blocker.on('pointerdown', consume);
    this.blocker.on('pointerup', consume);
    this.root.addChild(this.blocker);
    for (const cfg of options.layers) {
      const container = new Container({ label: `ui-layer-${cfg.name}` });
      this.layers.set(cfg.name, {
        container,
        blocking: cfg.blocking ?? false,
        content: null,
        key: UNSET,
        scrollers: [],
      });
      this.root.addChild(container);
    }
  }

  /** The persistent container for a declared layer — for a host that wants to
   *  mutate it directly every frame (position it, animate its scale) rather
   *  than rebuild it through `update()`. Stable for the stack's lifetime;
   *  `update()`'s rebuilt content is added as its child. */
  layer(name: string): Container {
    return this.stateOf(name).container;
  }

  /**
   * Rebuilds a layer's content when `key` is a different object than last
   * time, then advances every `UiScrollList` inside the layer's current
   * content. Call once per layer per frame — the identity check makes it
   * cheap on every frame nothing changed, which is almost all of them.
   *
   * @param build Only called when `key` changed identity. Return `null` for
   *   "this layer has no content right now".
   * @returns The layer's current content (freshly built or unchanged), so a
   *   caller that needs a typed handle — to push a per-frame live value into
   *   a HUD, say, bypassing the identity-gated rebuild entirely — can keep it.
   */
  update<Key>(name: string, key: Key, build: (key: Key) => Container | null, dtMs: number): Container | null {
    const state = this.stateOf(name);
    if (key !== state.key) {
      state.key = key;
      this.rebuild(state, build(key));
    }
    for (const scroller of state.scrollers) scroller.update(dtMs);
    return state.content;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  private stateOf(name: string): LayerState {
    const state = this.layers.get(name);
    if (!state) throw unknownLayer(name);
    return state;
  }

  private rebuild(state: LayerState, next: Container | null): void {
    if (state.content) state.content.destroy({ children: true });
    state.content = next;
    if (next) {
      state.container.addChild(next);
      applyFlexLayout(next);
      state.scrollers = collectScrollers(next, []);
    } else {
      state.scrollers = [];
    }
    this.syncBlocker();
  }

  private syncBlocker(): void {
    let active = false;
    for (const state of this.layers.values()) {
      if (state.blocking && state.content !== null) {
        active = true;
        break;
      }
    }
    this.blocker.visible = active;
  }
}

function collectScrollers(node: Container, into: UiScrollList[]): UiScrollList[] {
  if (node instanceof UiScrollList) into.push(node);
  for (const child of node.children) collectScrollers(child as Container, into);
  return into;
}

function consume(event: { stopPropagation(): void }): void {
  event.stopPropagation();
}
