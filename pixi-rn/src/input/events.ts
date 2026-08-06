// React Native has no DOM canvas for Pixi's EventSystem to listen to. This
// bridge deliberately keeps Pixi v8's federated EventBoundary semantics and
// only adapts the native surface's pointer coordinates into upstream events.
// Buttons, sliders and game objects then use normal `eventMode`/`pointertap`
// handlers with Pixi's own hit-testing and capture/bubble behaviour.
import { Container, EventBoundary, FederatedPointerEvent } from 'pixi.js';

export type NativePointerType = 'down' | 'move' | 'up' | 'cancel';

export interface NativePointerInput {
  type: NativePointerType;
  /** Coordinates in the logical coordinates of the Pixi surface. */
  x: number;
  y: number;
  pointerId?: number;
  pointerType?: string;
  isPrimary?: boolean;
  timeStamp?: number;
}

/** A retained Pixi v8 event boundary fed by React Native touch events. */
export interface NativeEventBridge {
  root: Container;
  dispatch(input: NativePointerInput): void;
  destroy(): void;
}

// Pixi intentionally exposes allocation to its boundary subclasses so custom
// event sources can share the exact same pooling lifecycle as EventSystem.
class NativeEventBoundary extends EventBoundary {
  allocatePointer(): FederatedPointerEvent {
    return this.allocateEvent(FederatedPointerEvent);
  }
}

const EVENT_TYPE: Record<NativePointerType, string> = {
  down: 'pointerdown',
  move: 'pointermove',
  up: 'pointerup',
  // Pixi has no dedicated pointercancel mapper. An outside-up has the right
  // capture cleanup semantics for a cancelled native responder.
  cancel: 'pointerupoutside',
};

/**
 * Feeds a Pixi v8 `EventBoundary` from React Native's touch responder system
 * — the only input source available, since there is no DOM for pixi's own
 * `EventSystem` to attach to. Forward every `onResponderGrant`/`Move`/
 * `Release`/`Terminate` (down/move/up/cancel) into `dispatch()`; hit-testing,
 * `eventMode`, and capture/bubble all then behave exactly as they would in a
 * browser.
 *
 * @param root The scene root pixi should hit-test against (usually your
 *   stage).
 */
export function createNativeEventBridge(root: Container): NativeEventBridge {
  const boundary = new NativeEventBoundary(root);
  const pointers = new Map<number, { x: number; y: number }>();

  function dispatch(input: NativePointerInput): void {
    const pointerId = input.pointerId ?? 1;
    const previous = pointers.get(pointerId);
    const event = boundary.allocatePointer();
    const type = EVENT_TYPE[input.type];
    const buttons = input.type === 'up' || input.type === 'cancel' ? 0 : 1;

    event.type = type;
    event.pointerId = pointerId;
    event.pointerType = input.pointerType ?? 'touch';
    event.isPrimary = input.isPrimary ?? pointerId === 1;
    event.button = 0;
    event.buttons = buttons;
    event.pressure = buttons ? 0.5 : 0;
    event.width = 1;
    event.height = 1;
    event.timeStamp = input.timeStamp ?? Date.now();
    event.client.set(input.x, input.y);
    event.screen.set(input.x, input.y);
    event.global.set(input.x, input.y);
    event.page.set(input.x, input.y);
    event.layer.set(input.x, input.y);
    event.movement.set(input.x - (previous?.x ?? input.x), input.y - (previous?.y ?? input.y));

    // Mapping methods take ownership of their upstream event and return it to
    // the boundary pool themselves. Do not free it here: doing so would put a
    // single object in the pool twice and eventually dispatch corrupted input.
    boundary.mapEvent(event);

    if (input.type === 'up' || input.type === 'cancel') pointers.delete(pointerId);
    else pointers.set(pointerId, { x: input.x, y: input.y });
  }

  return {
    root,
    dispatch,
    destroy() {
      pointers.clear();
    },
  };
}
