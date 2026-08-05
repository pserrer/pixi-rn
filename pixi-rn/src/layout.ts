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
	display?: 'none' | 'flex' | 'contents';
	isLeaf?: boolean;
	applySizeDirectly?: boolean;
}

declare module 'pixi.js' {
	interface Container {
		layout?: LayoutStyles;
	}
}

type LayoutNode = Container & { layout?: LayoutStyles };

function number(value: unknown, available: number, fallback: number): number {
	if (typeof value === 'number') return value;
	if (typeof value === 'string' && value.endsWith('%')) return available * Number.parseFloat(value) / 100;
	return fallback;
}

function sizeOf(node: Container, axis: 'x' | 'y'): number {
	const bounds = node.getLocalBounds();
	return axis === 'x' ? bounds.width : bounds.height;
}

/** Bottom-up measure pass. Parents must never calculate intrinsic size from
 * children whose own flex layout has not been resolved yet. */
function measureNode(node: LayoutNode): void {
	for (const child of node.children as LayoutNode[]) measureNode(child);
	const style = node.layout;
	if (!style) return;
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
			? children.reduce((sum, child) => sum + sizeOf(child, 'x'), 0) + Math.max(0, children.length - 1) * gap
			: children.reduce((max, child) => Math.max(max, sizeOf(child, 'x')), 0);
		if (content > 0) node.width = content + paddingX;
	}
	if (style.height === undefined || style.height === 'auto' || style.height === 'intrinsic') {
		const content = horizontal
			? children.reduce((max, child) => Math.max(max, sizeOf(child, 'y')), 0)
			: children.reduce((sum, child) => sum + sizeOf(child, 'y'), 0) + Math.max(0, children.length - 1) * gap;
		if (content > 0) node.height = content + paddingY;
	}
}

/** Top-down placement pass after every intrinsic parent has been measured. */
function placeNode(node: LayoutNode): void {
	const style = node.layout;
	if (style) {
		const width = number(style.width, node.width || sizeOf(node, 'x'), node.width || sizeOf(node, 'x'));
		const height = number(style.height, node.height || sizeOf(node, 'y'), node.height || sizeOf(node, 'y'));
		if (width > 0) node.width = width;
		if (height > 0) node.height = height;

		const horizontal = style.flexDirection === 'row' || style.flexDirection === 'row-reverse';
		const mainSize = horizontal ? width : height;
		const crossSize = horizontal ? height : width;
		const paddingStart = horizontal ? (style.paddingLeft ?? style.padding ?? 0) : (style.paddingTop ?? style.padding ?? 0);
		const paddingEnd = horizontal ? (style.paddingRight ?? style.padding ?? 0) : (style.paddingBottom ?? style.padding ?? 0);
		const paddingCrossStart = horizontal ? (style.paddingTop ?? style.padding ?? 0) : (style.paddingLeft ?? style.padding ?? 0);
		const paddingCrossEnd = horizontal ? (style.paddingBottom ?? style.padding ?? 0) : (style.paddingRight ?? style.padding ?? 0);
		const gap = style.gap ?? (horizontal ? style.columnGap : style.rowGap) ?? 0;
		const children = node.children.filter((child) => {
			const childStyle = (child as LayoutNode).layout;
			return !!childStyle && childStyle.position !== 'absolute' && childStyle.display !== 'none';
		}) as LayoutNode[];
		const itemMain = children.map((child) => number(horizontal ? child.layout?.width : child.layout?.height, mainSize, sizeOf(child, horizontal ? 'x' : 'y')));
		const occupied = itemMain.reduce((sum, value) => sum + value, 0) + Math.max(0, children.length - 1) * gap;
		let cursor = paddingStart;
		let actualGap = gap;
		if (style.justifyContent === 'center') cursor += Math.max(0, (mainSize - paddingStart - paddingEnd - occupied) / 2);
		if (style.justifyContent === 'flex-end') cursor += Math.max(0, mainSize - paddingStart - paddingEnd - occupied);
		if (style.justifyContent === 'space-between' && children.length > 1) actualGap = Math.max(gap, (mainSize - paddingStart - paddingEnd - itemMain.reduce((sum, value) => sum + value, 0)) / (children.length - 1));

		children.forEach((child, index) => {
			const childStyle = child.layout!;
			const childMain = itemMain[index];
			const childCross = number(horizontal ? childStyle.height : childStyle.width, crossSize, sizeOf(child, horizontal ? 'y' : 'x'));
			const align = childStyle.alignSelf === 'auto' || childStyle.alignSelf === undefined ? style.alignItems : childStyle.alignSelf;
			let cross = paddingCrossStart;
			if (align === 'center') cross += Math.max(0, (crossSize - paddingCrossStart - paddingCrossEnd - childCross) / 2);
			if (align === 'flex-end') cross += Math.max(0, crossSize - paddingCrossStart - paddingCrossEnd - childCross);
			if (horizontal) { child.x = cursor; child.y = cross; child.width = childMain; if (childCross > 0) child.height = childCross; }
			else { child.x = cross; child.y = cursor; child.height = childMain; if (childCross > 0) child.width = childCross; }
			cursor += childMain + actualGap;
		});
		for (const child of node.children as LayoutNode[]) {
			const childStyle = child.layout;
			if (childStyle?.position === 'absolute') {
				child.x = number(childStyle.left, width, child.x);
				child.y = number(childStyle.top, height, child.y);
				if (childStyle.width !== undefined) child.width = number(childStyle.width, width, child.width);
				if (childStyle.height !== undefined) child.height = number(childStyle.height, height, child.height);
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