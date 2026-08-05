// `@pixi/layout` is Yoga/WASM based. Hermes in the Expo runtime used by this
// package does not expose WebAssembly, so importing it makes renderer.init()
// fail before the first frame. Keep the public layout vocabulary, but provide
// a small JS flex pass for the subset a canvas game UI needs. It is deliberately
// generic: no game assets, coordinates or component assumptions live here.
import { Container } from 'pixi.js';

/** Expo-safe subset of the @pixi/layout style vocabulary. */
export interface LayoutStyles {
  width?: number | `${number}%` | 'auto' | 'intrinsic';
  height?: number | `${number}%` | 'auto' | 'intrinsic';
  position?: 'absolute' | 'relative';
  left?: number | `${number}%`;
  top?: number | `${number}%`;
  flex?: number;
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch';
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch';
  gap?: number;
  rowGap?: number;
  columnGap?: number;
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
  display?: 'none' | 'flex' | 'contents';
  isLeaf?: boolean;
  applySizeDirectly?: boolean;
}

declare module 'pixi.js' {
  interface Container {
    layout?: LayoutStyles;
  }
}

interface LayoutBox {
  width: number;
  height: number;
}

type LayoutNode = Container & { layout?: LayoutStyles; __pixiRnLayoutBox?: LayoutBox };

function number(value: unknown, available: number, fallback: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.endsWith('%')) return (available * Number.parseFloat(value)) / 100;
  return fallback;
}

function visualSizeOf(node: Container, axis: 'x' | 'y'): number {
  const bounds = node.getLocalBounds();
  return axis === 'x' ? bounds.width : bounds.height;
}

function boxOf(node: LayoutNode): LayoutBox {
  if (node.__pixiRnLayoutBox) return node.__pixiRnLayoutBox;
  return { width: visualSizeOf(node, 'x'), height: visualSizeOf(node, 'y') };
}

function setBox(node: LayoutNode, width: number, height: number): void {
  node.__pixiRnLayoutBox = { width: Math.max(0, width), height: Math.max(0, height) };
  // Pixi Containers implement width/height by scaling their children. Only
  // true render leaves may receive a visual size from layout; wrapper and
  // screen containers keep their native scale at 1.
  if (node.layout?.isLeaf || node.layout?.applySizeDirectly) {
    if (width > 0) node.width = width;
    if (height > 0) node.height = height;
  }
}

function mainMargin(style: LayoutStyles | undefined, horizontal: boolean): { before: number; after: number } {
  return horizontal
    ? { before: style?.marginLeft ?? style?.margin ?? 0, after: style?.marginRight ?? style?.margin ?? 0 }
    : { before: style?.marginTop ?? style?.margin ?? 0, after: style?.marginBottom ?? style?.margin ?? 0 };
}

/** Bottom-up measure pass. Parents must never calculate intrinsic size from
 * children whose own flex layout has not been resolved yet. */
function measureNode(node: LayoutNode, availableWidth = 0, availableHeight = 0): void {
  const style = node.layout;
  if (!style) {
    setBox(node, visualSizeOf(node, 'x'), visualSizeOf(node, 'y'));
    return;
  }
  // Resolve explicit/percentage dimensions before recursing so descendants
  // receive the containing box. Intrinsic dimensions are resolved afterward
  // from those measured descendants.
  const existing = boxOf(node);
  const explicitWidth = style.width !== undefined && style.width !== 'auto' && style.width !== 'intrinsic';
  const explicitHeight = style.height !== undefined && style.height !== 'auto' && style.height !== 'intrinsic';
  const provisionalWidth = explicitWidth ? number(style.width, availableWidth, existing.width) : existing.width;
  const provisionalHeight = explicitHeight ? number(style.height, availableHeight, existing.height) : existing.height;
  if (explicitWidth || explicitHeight) setBox(node, provisionalWidth, provisionalHeight);
  const childAvailable = boxOf(node);
  for (const child of node.children as LayoutNode[]) measureNode(child, childAvailable.width, childAvailable.height);
  const horizontal = style.flexDirection === 'row' || style.flexDirection === 'row-reverse';
  const gap = style.gap ?? (horizontal ? style.columnGap : style.rowGap) ?? 0;
  const paddingX = (style.paddingLeft ?? style.padding ?? 0) + (style.paddingRight ?? style.padding ?? 0);
  const paddingY = (style.paddingTop ?? style.padding ?? 0) + (style.paddingBottom ?? style.padding ?? 0);
  const children = node.children.filter((child) => {
    const childStyle = (child as LayoutNode).layout;
    return !!childStyle && childStyle.position !== 'absolute' && childStyle.display !== 'none';
  }) as LayoutNode[];
  if (style.width === undefined || style.width === 'auto' || style.width === 'intrinsic') {
    const content = horizontal
      ? children.reduce((sum, child) => {
          const margin = mainMargin(child.layout, true);
          return sum + boxOf(child).width + margin.before + margin.after;
        }, 0) +
        Math.max(0, children.length - 1) * gap
      : children.reduce((max, child) => Math.max(max, boxOf(child).width), 0);
    availableWidth = content + paddingX;
  }
  if (style.height === undefined || style.height === 'auto' || style.height === 'intrinsic') {
    const content = horizontal
      ? children.reduce((max, child) => Math.max(max, boxOf(child).height), 0)
      : children.reduce((sum, child) => {
          const margin = mainMargin(child.layout, false);
          return sum + boxOf(child).height + margin.before + margin.after;
        }, 0) +
        Math.max(0, children.length - 1) * gap;
    availableHeight = content + paddingY;
  }
  const own = boxOf(node);
  const width = explicitWidth ? number(style.width, availableWidth, own.width) : availableWidth || own.width;
  const height = explicitHeight ? number(style.height, availableHeight, own.height) : availableHeight || own.height;
  setBox(node, width, height);
}

/** Top-down placement pass after every intrinsic parent has been measured. */
function placeNode(node: LayoutNode): void {
  const style = node.layout;
  if (style) {
    const own = boxOf(node);
    const width = own.width;
    const height = own.height;

    const horizontal = style.flexDirection === 'row' || style.flexDirection === 'row-reverse';
    const mainSize = horizontal ? width : height;
    const crossSize = horizontal ? height : width;
    const paddingStart = horizontal
      ? (style.paddingLeft ?? style.padding ?? 0)
      : (style.paddingTop ?? style.padding ?? 0);
    const paddingEnd = horizontal
      ? (style.paddingRight ?? style.padding ?? 0)
      : (style.paddingBottom ?? style.padding ?? 0);
    const paddingCrossStart = horizontal
      ? (style.paddingTop ?? style.padding ?? 0)
      : (style.paddingLeft ?? style.padding ?? 0);
    const paddingCrossEnd = horizontal
      ? (style.paddingBottom ?? style.padding ?? 0)
      : (style.paddingRight ?? style.padding ?? 0);
    const gap = style.gap ?? (horizontal ? style.columnGap : style.rowGap) ?? 0;
    const children = node.children.filter((child) => {
      const childStyle = (child as LayoutNode).layout;
      return !!childStyle && childStyle.position !== 'absolute' && childStyle.display !== 'none';
    }) as LayoutNode[];
    const itemMain = children.map((child) => {
      const margin = mainMargin(child.layout, horizontal);
      return (horizontal ? boxOf(child).width : boxOf(child).height) + margin.before + margin.after;
    });
    const occupied = itemMain.reduce((sum, value) => sum + value, 0) + Math.max(0, children.length - 1) * gap;
    let cursor = paddingStart;
    let actualGap = gap;
    if (style.justifyContent === 'center') cursor += Math.max(0, (mainSize - paddingStart - paddingEnd - occupied) / 2);
    if (style.justifyContent === 'flex-end') cursor += Math.max(0, mainSize - paddingStart - paddingEnd - occupied);
    if (style.justifyContent === 'space-between' && children.length > 1)
      actualGap = Math.max(
        gap,
        (mainSize - paddingStart - paddingEnd - itemMain.reduce((sum, value) => sum + value, 0)) /
          (children.length - 1),
      );

    children.forEach((child, index) => {
      const childStyle = child.layout!;
      const childMain = itemMain[index];
      const childBox = boxOf(child);
      const childCross = horizontal ? childBox.height : childBox.width;
      const margin = mainMargin(childStyle, horizontal);
      const align =
        childStyle.alignSelf === 'auto' || childStyle.alignSelf === undefined ? style.alignItems : childStyle.alignSelf;
      let cross = paddingCrossStart;
      if (align === 'center') cross += Math.max(0, (crossSize - paddingCrossStart - paddingCrossEnd - childCross) / 2);
      if (align === 'flex-end') cross += Math.max(0, crossSize - paddingCrossStart - paddingCrossEnd - childCross);
      if (horizontal) {
        child.x = cursor + margin.before;
        child.y = cross;
      } else {
        child.x = cross;
        child.y = cursor + margin.before;
      }
      cursor += childMain + actualGap;
    });
    for (const child of node.children as LayoutNode[]) {
      const childStyle = child.layout;
      if (childStyle?.position === 'absolute') {
        child.x = number(childStyle.left, width, child.x);
        child.y = number(childStyle.top, height, child.y);
      }
    }
  }
  for (const child of node.children as LayoutNode[]) placeNode(child);
}

/** Applies generic retained flex layout synchronously before the Pixi render. */
export function applyFlexLayout(root: Container): void {
  measureNode(root as LayoutNode);
  placeNode(root as LayoutNode);
}

/** Indicates that pixi-rn's Expo-safe layout implementation is available. */
export const pixiLayoutReady = true;
