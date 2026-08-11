// A dtMs-driven progress timer (`Tween`) plus the pure math it's built on
// (`easing`, `lerp`) — nothing here owns a timer or ticker of its own; a
// host's own frame loop drives every `update()` call.
export {
  linear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeOutBack,
  type EasingFn,
} from './easing';
export { lerp } from './lerp';
export { Tween, type TweenOptions } from './tween';
