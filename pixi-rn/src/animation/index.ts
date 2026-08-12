// dtMs-driven animation drivers (`Tween`, `Shake`) plus the pure math they're
// built on (`easing`, `lerp`) — nothing here owns a timer or ticker of its
// own; a host's own frame loop drives every `update()` call.
export {
  linear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeOutBack,
  smoothstep,
  type EasingFn,
} from './easing';
export { lerp } from './lerp';
export { Tween, type TweenOptions } from './tween';
export { Shake, type ShakeOptions } from './shake';
