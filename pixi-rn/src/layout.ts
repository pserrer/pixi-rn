// A small flexbox pass for retained Pixi trees.
//
// ⚠️ `@pixi/layout` is Yoga/WASM based and Hermes exposes no WebAssembly, so
// importing it makes `renderer.init()` fail before the first frame. This is the
// replacement: the subset of the flex vocabulary a canvas game UI actually
// needs, in plain JS. Deliberately generic — no game assets, coordinates or
// component assumptions live here.
//
// Two passes, the same shape Yoga uses:
//   1. `measure` — bottom-up intrinsic sizing. A leaf reports its own content
//      size through `measureLayout()`; a container sums/maxes its children.
//   2. `arrange` — top-down final placement. This is where `flex` grow,
//      `flexShrink` and `alignItems: 'stretch'` hand a child a size DIFFERENT
//      from the one it measured, and where each node learns its final box via
//      `applyLayout()`.
//
// The split matters: a parent must never derive its intrinsic size from a child
// whose own layout has not resolved yet, and a leaf must never paint at a size
// before the pass that could still stretch or shrink it has run.
import { Container } from 'pixi.js';

/** Expo-safe subset of the @pixi/layout style vocabulary. */
export interface LayoutStyles {
  width?: number | `${number}%` | 'auto';
  height?: number | `${number}%` | 'auto';
  position?: 'absolute' | 'relative';
  left?: number | `${number}%`;
  top?: number | `${number}%`;
  right?: number | `${number}%`;
  bottom?: number | `${number}%`;
  /** Share of the parent's leftover main-axis space (grow factor). */
  flex?: number;
  /** Share of a main-axis overflow this child absorbs. Text uses it to
   *  ellipsize instead of pushing its row's other content off the edge. */
  flexShrink?: number;
  flexDirection?: 'row' | 'column';
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch';
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch';
  gap?: number;
  padding?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  margin?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  display?: 'none' | 'flex';
}

export interface LayoutSize {
  width: number;
  height: number;
}

declare module 'pixi.js' {
  interface Container {
    layout?: LayoutStyles;
    /** Intrinsic content size, asked for whenever a dimension is `auto`. Only
     *  leaves implement this; a container derives its size from its children. */
    measureLayout?(): LayoutSize;
    /** The final resolved box. A leaf that draws at a size applies it here —
     *  never earlier, since `arrange` can still stretch or shrink it. */
    applyLayout?(width: number, height: number): void;
    /** Called once the WHOLE tree is positioned. `applyLayout` runs before a
     *  node's children are placed, so anything that needs its descendants'
     *  final coordinates — a scroller culling rows against its viewport —
     *  belongs here instead. */
    layoutComplete?(): void;
  }
}

type Node = Container;

// Measured intrinsic sizes, keyed off the node itself so nothing is written
// onto the display object (a stray enumerable property on a Container ends up
// in every JSON dump and every shallow clone).
const measured = new WeakMap<Node, LayoutSize>();

const EMPTY: LayoutStyles = {};
const styleOf = (node: Node): LayoutStyles => node.layout ?? EMPTY;

function resolve(value: LayoutStyles['width'], available: number): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.endsWith('%')) return (available * Number.parseFloat(value)) / 100;
  return null;
}

function pad(style: LayoutStyles, side: 'Top' | 'Right' | 'Bottom' | 'Left'): number {
  return style[`padding${side}` as 'paddingTop'] ?? style.padding ?? 0;
}
function margin(style: LayoutStyles, side: 'Top' | 'Right' | 'Bottom' | 'Left'): number {
  return style[`margin${side}` as 'marginTop'] ?? style.margin ?? 0;
}

const isRow = (style: LayoutStyles) => style.flexDirection === 'row';
const paddingX = (s: LayoutStyles) => pad(s, 'Left') + pad(s, 'Right');
const paddingY = (s: LayoutStyles) => pad(s, 'Top') + pad(s, 'Bottom');
const marginX = (s: LayoutStyles) => margin(s, 'Left') + margin(s, 'Right');
const marginY = (s: LayoutStyles) => margin(s, 'Top') + margin(s, 'Bottom');

/** Children that take part in the normal flow (absolute + hidden ones don't). */
function flowChildren(node: Node): Node[] {
  const out: Node[] = [];
  for (const child of node.children as Node[]) {
    const style = child.layout;
    if (!style || style.position === 'absolute' || style.display === 'none') continue;
    out.push(child);
  }
  return out;
}

function sizeOf(node: Node): LayoutSize {
  return measured.get(node) ?? { width: 0, height: 0 };
}

// ── pass 1: intrinsic measure ───────────────────────────────────────────────

function measure(node: Node, availableWidth: number, availableHeight: number): LayoutSize {
  const style = styleOf(node);
  if (style.display === 'none') {
    const zero = { width: 0, height: 0 };
    measured.set(node, zero);
    return zero;
  }
  const definiteWidth = resolve(style.width, availableWidth);
  const definiteHeight = resolve(style.height, availableHeight);

  // Children see the content box when this node's size is already known, and
  // the parent's remaining space when it isn't.
  const innerWidth = (definiteWidth ?? availableWidth) - paddingX(style);
  const innerHeight = (definiteHeight ?? availableHeight) - paddingY(style);
  const children = flowChildren(node);
  for (const child of children) measure(child, Math.max(0, innerWidth), Math.max(0, innerHeight));
  for (const child of node.children as Node[]) {
    if (child.layout?.position === 'absolute') measure(child, Math.max(0, innerWidth), Math.max(0, innerHeight));
  }

  let contentWidth = 0;
  let contentHeight = 0;
  if (children.length > 0) {
    const row = isRow(style);
    const gaps = Math.max(0, children.length - 1) * (style.gap ?? 0);
    for (const child of children) {
      const box = sizeOf(child);
      const childStyle = styleOf(child);
      const w = box.width + marginX(childStyle);
      const h = box.height + marginY(childStyle);
      if (row) {
        contentWidth += w;
        contentHeight = Math.max(contentHeight, h);
      } else {
        contentWidth = Math.max(contentWidth, w);
        contentHeight += h;
      }
    }
    if (row) contentWidth += gaps;
    else contentHeight += gaps;
  } else if (node.measureLayout) {
    const intrinsic = node.measureLayout();
    contentWidth = intrinsic.width;
    contentHeight = intrinsic.height;
  }

  const size = {
    width: definiteWidth ?? contentWidth + paddingX(style),
    height: definiteHeight ?? contentHeight + paddingY(style),
  };
  measured.set(node, size);
  return size;
}

// ── pass 2: final placement ─────────────────────────────────────────────────

function crossAlign(parent: LayoutStyles, child: LayoutStyles): NonNullable<LayoutStyles['alignItems']> {
  const self = child.alignSelf;
  if (self && self !== 'auto') return self;
  return parent.alignItems ?? 'flex-start';
}

function arrange(node: Node, width: number, height: number): void {
  const style = styleOf(node);
  if (style.display === 'none') {
    node.visible = false;
    return;
  }
  node.applyLayout?.(width, height);

  const row = isRow(style);
  const gap = style.gap ?? 0;
  const innerMain = Math.max(0, (row ? width : height) - (row ? paddingX(style) : paddingY(style)));
  const innerCross = Math.max(0, (row ? height : width) - (row ? paddingY(style) : paddingX(style)));
  const children = flowChildren(node);

  // Base main sizes, then distribute the leftover (flex) or the overflow
  // (flexShrink). A child with neither keeps exactly what it measured.
  const mains = children.map((child) => {
    const box = sizeOf(child);
    return row ? box.width : box.height;
  });
  const outer = children.map((child, i) => mains[i] + (row ? marginX(styleOf(child)) : marginY(styleOf(child))));
  const gaps = Math.max(0, children.length - 1) * gap;
  const free = innerMain - outer.reduce((sum, v) => sum + v, 0) - gaps;

  if (free > 0) {
    const grow = children.reduce((sum, child) => sum + (styleOf(child).flex ?? 0), 0);
    if (grow > 0) {
      children.forEach((child, i) => {
        const factor = styleOf(child).flex ?? 0;
        if (factor > 0) mains[i] += (free * factor) / grow;
      });
    }
  } else if (free < 0) {
    const shrink = children.reduce((sum, child) => sum + (styleOf(child).flexShrink ?? 0), 0);
    if (shrink > 0) {
      children.forEach((child, i) => {
        const factor = styleOf(child).flexShrink ?? 0;
        if (factor > 0) mains[i] = Math.max(0, mains[i] + (free * factor) / shrink);
      });
    }
  }

  const used = children.reduce(
    (sum, child, i) => sum + mains[i] + (row ? marginX(styleOf(child)) : marginY(styleOf(child))),
    0,
  );
  const slack = Math.max(0, innerMain - used - gaps);
  let cursor = row ? pad(style, 'Left') : pad(style, 'Top');
  let spacing = gap;
  if (style.justifyContent === 'center') cursor += slack / 2;
  else if (style.justifyContent === 'flex-end') cursor += slack;
  else if (style.justifyContent === 'space-between' && children.length > 1) spacing += slack / (children.length - 1);

  const crossStart = row ? pad(style, 'Top') : pad(style, 'Left');
  children.forEach((child, i) => {
    const childStyle = styleOf(child);
    const box = sizeOf(child);
    const align = crossAlign(style, childStyle);
    const crossMargin = row ? margin(childStyle, 'Top') : margin(childStyle, 'Left');
    const crossOuter = row ? marginY(childStyle) : marginX(childStyle);
    const measuredCross = row ? box.height : box.width;
    const cross =
      align === 'stretch' ? Math.max(0, innerCross - crossOuter) : Math.min(measuredCross, Math.max(0, innerCross));
    let crossOffset = crossStart + crossMargin;
    if (align === 'center') crossOffset += Math.max(0, innerCross - crossOuter - cross) / 2;
    else if (align === 'flex-end') crossOffset += Math.max(0, innerCross - crossOuter - cross);

    const mainOffset = cursor + (row ? margin(childStyle, 'Left') : margin(childStyle, 'Top'));
    child.x = Math.round(row ? mainOffset : crossOffset);
    child.y = Math.round(row ? crossOffset : mainOffset);
    arrange(child, row ? mains[i] : cross, row ? cross : mains[i]);
    cursor += mains[i] + (row ? marginX(childStyle) : marginY(childStyle)) + spacing;
  });

  // Out-of-flow children are positioned against this node's padding box, with
  // `right`/`bottom` measured from the opposite edge (a corner affordance that
  // must hug the screen edge regardless of its own width).
  for (const child of node.children as Node[]) {
    const childStyle = child.layout;
    if (childStyle?.position !== 'absolute') continue;
    const box = sizeOf(child);
    const left = resolve(childStyle.left, width);
    const right = resolve(childStyle.right, width);
    const top = resolve(childStyle.top, height);
    const bottom = resolve(childStyle.bottom, height);
    child.x = Math.round(left ?? (right !== null ? width - right - box.width : child.x));
    child.y = Math.round(top ?? (bottom !== null ? height - bottom - box.height : child.y));
    arrange(child, box.width, box.height);
  }
}

/** Resolves a retained flex tree in place. Call it when the tree or a node's
 *  content changed — NOT every frame; nothing here is incremental. */
export function applyFlexLayout(root: Container): void {
  const style = styleOf(root);
  const width = resolve(style.width, 0) ?? 0;
  const height = resolve(style.height, 0) ?? 0;
  measure(root, width, height);
  const size = sizeOf(root);
  arrange(root, width || size.width, height || size.height);
  notifyComplete(root);
}

function notifyComplete(node: Node): void {
  node.layoutComplete?.();
  for (const child of node.children as Node[]) notifyComplete(child);
}

/** The resolved box of a node from the last `applyFlexLayout` pass. */
export function layoutSize(node: Container): LayoutSize {
  return sizeOf(node);
}
