import '../core/adapter';
import { Container } from 'pixi.js';
import type { LayoutStyles } from '../layout/layout';

/** A named flex container. Sizing/placement comes from `applyFlexLayout`. */
export function createUiLayout(style: LayoutStyles, label = 'ui-layout'): Container {
  const container = new Container({ label });
  container.layout = style;
  return container;
}
