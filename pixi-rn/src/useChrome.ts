// The RN half of the chrome seam (see render/pixi/uiChrome.ts).
//
// A chrome component renders a TRANSPARENT `View` — it keeps its place in the
// flex layout and keeps its children (text, hit targets) exactly as before —
// and publishes a draw command describing the art plus the box it occupies, in
// screen coordinates. pixi draws it inside the world's own frame, so the chrome
// appears when the frame does instead of ~8 frames later, which is what every
// Skia <Canvas> in this app used to cost.
//
// ⚠️ Position comes from `measureInWindow`, not `onLayout`: onLayout is relative
// to the parent, and the pixi renderer's coordinate space is the screen. The
// measure is also re-run when the component's own layout changes, which is what
// catches a screen being shown, a list scrolling, or text reflowing under a
// different language.
import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import type { LayoutChangeEvent, View } from 'react-native';
import {
  clearChrome, newChromeId, newChromeScrollId, registerChromeMeasure, setChrome,
  setChromeScroll, setChromeScrollViewport, clearChromeScroll, chromeScroll,
  type ChromeCmd,
} from './chrome';

/** Builds the command once the box is known; return null to draw nothing. */
export type ChromeSpec = (x: number, y: number, w: number, h: number) => ChromeCmd | ChromeCmd[] | null;

export interface ChromeBinding {
  ref: React.RefObject<View | null>;
  onLayout: (e: LayoutChangeEvent) => void;
}

// ⚠️ Nesting depth, and therefore PAINT ORDER. RN paints a parent before its
// children, but React runs effects CHILD-FIRST, so a container publishes AFTER
// the content inside it — drawing in publication order paints panels over their
// own contents, and (because the pixi layer pools per command kind) can bury an
// arbitrary sibling under a panel too. Every component that wraps children in
// chrome MUST provide `depth + 1` to them; see ui/pixelui's panels.
const ChromeDepth = createContext(0);

export function ChromeDepthProvider({ children }: { children?: React.ReactNode }) {
  const depth = useContext(ChromeDepth);
  return React.createElement(ChromeDepth.Provider, { value: depth + 1 }, children);
}

// ⚠️ RE-MEASURE ON AN ANCESTOR MOVING. `onLayout` fires when a view's own box
// changes — NOT when it merely MOVES because something above it did. So any
// shift applied to a whole screen leaves every piece of chrome inside it drawn
// at its old window position while the RN views (and their touch targets) sit
// at the new one: the art and the tappable area come apart.
//
// The real case: `sharedStyles.screenWrap` takes `paddingTop: insets.top + 44`
// INLINE, so the moment the live safe-area inset arrives the whole title
// content slides down and none of its chrome re-measures. That is what put the
// character picker's chevrons a cutout's height above their own buttons.
//
// Anything that moves a screen without resizing its contents must call
// `bumpChromeLayout()`. `useInsets` does it for the inset case, which covers
// every consumer at once; parking a screen off-screen and back is the other
// known one.
// ⚠️ Chrome inside a ScrollView. Scrolling moves content without changing any
// child's box, so no `onLayout` fires — and re-measuring every element on every
// scrolled frame would be dozens of native calls per frame. Instead the region
// reports its offset once per scroll event and the layer applies it as a delta
// (see uiChrome.ts's scroll regions). Wrap a scroller's content in
// `ChromeScrollProvider` and feed it `onScroll` + `onLayout`.
const ChromeScroll = createContext(0);

export function useChromeScrollRegion(): {
  scrollId: number;
  onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => void;
  onLayout: (e: LayoutChangeEvent) => void;
  /** Put this on a plain View WRAPPING the scroller — RN does not type
   *  `measureInWindow` on ScrollView, and the wrapper's box is the viewport
   *  anyway. */
  ref: React.RefObject<View | null>;
  Provider: ({ children }: { children?: React.ReactNode }) => React.ReactElement;
} {
  const idRef = useRef<number | null>(null);
  if (idRef.current === null) idRef.current = newChromeScrollId();
  const scrollId = idRef.current;
  const ref = useRef<View | null>(null);

  useEffect(() => () => clearChromeScroll(scrollId), [scrollId]);

  const onScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    setChromeScroll(scrollId, e.nativeEvent.contentOffset.y);
  }, [scrollId]);

  // The viewport is what chrome gets clipped to, so it has to be the SCROLLER's
  // own box in screen coords, not the content's.
  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((x, y, w, h) => {
      if (w <= 0 || h <= 0) return;
      setChromeScrollViewport(scrollId, { x, y, w, h });
    });
  }, [scrollId]);

  const Provider = useCallback(({ children }: { children?: React.ReactNode }) =>
    React.createElement(ChromeScroll.Provider, { value: scrollId }, children), [scrollId]);

  return { scrollId, onScroll, onLayout, ref, Provider };
}

const layoutListeners = new Set<() => void>();
// How long after a move to take the confirming second measurement (see
// remeasureAfterMove). Long enough for RN to have applied the new layout
// natively, short enough that nothing is visibly misplaced in between.
const LAYOUT_SETTLE_MS = 120;

export function bumpChromeLayout(): void {
  for (const listener of layoutListeners) listener();
}

export function useChrome(spec: ChromeSpec, deps: readonly unknown[]): ChromeBinding {
  const depth = useContext(ChromeDepth);
  const scrollId = useContext(ChromeScroll);
  const ref = useRef<View | null>(null);
  // One id per published command. A spec may emit several (a bar draws its
  // frame and its fill), so ids are allocated lazily and reused across
  // measurements to avoid churning the map.
  const ids = useRef<number[]>([]);
  const box = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const specRef = useRef(spec);
  specRef.current = spec;
  const measureRaf = useRef<number | null>(null);

  // The scroll offset the box was measured at — the layer needs it to turn the
  // live offset into a delta.
  const baseScrollY = useRef(0);

  const publish = useCallback(() => {
    const b = box.current;
    if (!b) return;
    const out = specRef.current(b.x, b.y, b.w, b.h);
    const list = out === null ? [] : Array.isArray(out) ? out : [out];
    while (ids.current.length < list.length) ids.current.push(newChromeId());
    list.forEach((cmd, i) => setChrome(ids.current[i], cmd, depth, scrollId, baseScrollY.current));
    // Retire ids the spec stopped emitting (e.g. a bar whose fill hit zero).
    for (let i = list.length; i < ids.current.length; i++) clearChrome(ids.current[i]);
  }, [depth, scrollId]);

  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, w, h) => {
      if (w <= 0 || h <= 0) return;
      // The GLView is absolute-filled inside the same root view as the RN
      // overlays. Its logical Pixi coordinates therefore use the window
      // coordinates directly. Subtracting a separately measured GL origin is
      // racy (the chrome often measures before GLView's onLayout callback) and
      // shifted the chrome upward while the RN text stayed in place.
      box.current = { x, y, w, h };
      // Whatever the region was scrolled to when this box was taken.
      baseScrollY.current = scrollId ? (chromeScroll(scrollId)?.y ?? 0) : 0;
      publish();
    });
  }, [publish, scrollId]);

  // A parent View's `onLayout` can fire before its flex children have finished
  // their native layout pass. Measuring synchronously at that point produces
  // a frame that is too short: the RN text/children then overflow the Pixi
  // border (most visible on the title task board). Defer the measurement to
  // the next frame, when the complete subtree has settled. This also handles
  // the first layout of a screen revealed from the pre-mounted/off-screen
  // state.
  const scheduleMeasure = useCallback(() => {
    if (measureRaf.current !== null) cancelAnimationFrame(measureRaf.current);
    measureRaf.current = requestAnimationFrame(() => {
      measureRaf.current = null;
      measure();
    });
  }, [measure]);

  const onLayout = useCallback((_e: LayoutChangeEvent) => { scheduleMeasure(); }, [scheduleMeasure]);

  // ⚠️ A bump says "something above you MOVED", but native layout is applied
  // asynchronously — the next frame's `measureInWindow` can still report the
  // OLD box, and then nothing would ever ask again (that is the whole reason
  // the bump exists: no onLayout is coming). So a bump measures on the next
  // frame AND once more shortly after; whichever sees the settled layout wins,
  // and a re-publish with an unchanged box is a no-op. Two measures per bump,
  // not a per-frame native call.
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remeasureAfterMove = useCallback(() => {
    scheduleMeasure();
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      scheduleMeasure();
    }, LAYOUT_SETTLE_MS);
  }, [scheduleMeasure]);

  // Re-publish whenever the caller's inputs change (colours, images, a slider
  // value) without needing a re-measure — the box is unchanged.
  useEffect(() => { publish(); }, deps);   // eslint-disable-line react-hooks/exhaustive-deps

  // A screen becoming visible moves it without changing its own size, so
  // onLayout does NOT fire. Re-measure on mount and whenever deps change so a
  // revealed screen publishes its real position rather than its parked one.
  useEffect(() => { scheduleMeasure(); }, [scheduleMeasure]);

  // …and whenever something above us moved the whole screen (see
  // bumpChromeLayout / remeasureAfterMove).
  useEffect(() => {
    layoutListeners.add(remeasureAfterMove);
    return () => { layoutListeners.delete(remeasureAfterMove); };
  }, [remeasureAfterMove]);

  // The backstop for every mover nobody enumerated — see uiChrome.ts's sweep.
  useEffect(() => registerChromeMeasure(measure), [measure]);

  useEffect(() => () => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    if (measureRaf.current !== null) cancelAnimationFrame(measureRaf.current);
    ids.current.forEach(clearChrome);
    ids.current = [];
  }, []);

  return { ref, onLayout };
}
