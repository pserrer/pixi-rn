// ── UI text, drawn by pixi instead of by native <Text> ───────────────────────
// The text half of the chrome seam (see render/pixi/uiChrome.ts). A PixelText
// renders a TRANSPARENT, correctly-SIZED View that holds its normal place in
// the flex layout, and publishes a draw command telling the pixi UI layer what
// to draw and where.
//
// Why this can keep every screen's layout: the bitmap font's advance widths are
// plain numbers, so `measureText` returns a label's exact size SYNCHRONOUSLY,
// with no native round trip (render/pixi/bitmapFont.ts). The View is sized from
// that, so flex behaves exactly as it did with <Text> — no screen had to be
// rewritten into absolute pixel math. Only the label's screen POSITION comes
// from `measureInWindow`, which is the same round trip every other piece of
// chrome already pays.
//
// Drop-in for the old ui/OutlineText.tsx: same props, same defaults, including
// the hard pixel outline (RN has no text-stroke and this build does not render
// `textShadow*`). The outline used to be 8 absolutely-positioned copies of a
// native <Text>; it is now 8 more glyph runs in the chrome batch.
//
// ⚠️ Multi-line text still wants one PixelText per line, as before.
import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, TextStyle, View, ViewStyle } from 'react-native';

import { fontBaseSize, measureText } from './bitmapFont';
import type { ChromeCmd } from './chrome';
import { parseColor } from './color';
import { useChrome } from './useChrome';

// Perceived luminance (0..255) of a #RGB/#RRGGBB colour; -1 if unparseable.
function luminance(color: string): number {
  let hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return -1;
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff);
}

// Text-only style keys: they configure the glyph run and must NOT be forwarded
// to the wrapper View (which would be an invalid View style). Everything else
// in `style` is layout — margins, alignSelf, flex — and is passed straight
// through, which is what makes this a drop-in for a <Text> in the same slot.
const TEXT_ONLY_KEYS = [
  'fontSize', 'letterSpacing', 'fontFamily', 'fontWeight', 'fontStyle', 'fontVariant',
  'color', 'textAlign', 'textAlignVertical', 'lineHeight', 'textTransform',
  'textDecorationLine', 'textDecorationColor', 'textDecorationStyle',
  'textShadowColor', 'textShadowOffset', 'textShadowRadius', 'includeFontPadding',
  'writingDirection', 'userSelect', 'verticalAlign',
] as const;

interface Props {
  text: string;
  color: string;
  style?: StyleProp<TextStyle>;
  /** Defaults to black around light text, white around dark — as before. */
  outline?: string;
  /** px; 1 suits body text, 2-3 the large headlines. */
  outlineWidth?: number;
  containerStyle?: StyleProp<ViewStyle>;
  /** Accepted for API parity with the old OutlineText. A bitmap label is
   *  measured exactly, so it never wraps on its own; what this changes is that
   *  a label squeezed by a flex parent is TRUNCATED to the box it ended up
   *  with (see the `truncate` flag on the chrome command) rather than
   *  overflowing it. */
  numberOfLines?: number;
}

export function PixelText({
  text, color, style, outline, outlineWidth = 1, containerStyle, numberOfLines,
}: Props) {
  const flat = StyleSheet.flatten<TextStyle>(style) ?? {};
  const size = typeof flat.fontSize === 'number' ? flat.fontSize : fontBaseSize();
  const letterSpacing = typeof flat.letterSpacing === 'number' ? flat.letterSpacing : 0;
  const align = flat.textAlign === 'center' || flat.textAlign === 'right' ? flat.textAlign : 'left';
  const outlineColor = outline ?? (luminance(color) >= 140 ? '#000000' : '#FFFFFF');

  const metrics = useMemo(() => measureText(text, size, letterSpacing), [text, size, letterSpacing]);

  // Layout-only remainder of `style`, so margins/flex keep working.
  const layoutStyle = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(flat)) {
      if (!(TEXT_ONLY_KEYS as readonly string[]).includes(key)) out[key] = value;
    }
    return out as ViewStyle;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(flat)]);

  const fg = parseColor(color);
  const oc = parseColor(outlineColor);

  const chrome = useChrome(
    (x, y, w, h): ChromeCmd => ({
      kind: 'text',
      text,
      x, y, w, h,
      size,
      color: fg.rgb,
      outline: outlineWidth > 0 ? oc.rgb : undefined,
      outlineWidth,
      align,
      letterSpacing,
      alpha: fg.alpha,
      truncate: numberOfLines === 1,
    }),
    [text, size, letterSpacing, align, fg.rgb, fg.alpha, oc.rgb, outlineWidth, numberOfLines],
  );

  return (
    <View
      ref={chrome.ref}
      onLayout={chrome.onLayout}
      // Android drops a view that draws nothing, and the ref has to survive to
      // be measured (same reason every other chrome component does this).
      collapsable={false}
      pointerEvents="none"
      style={[
        { width: metrics.width, height: metrics.height },
        layoutStyle,
        containerStyle,
      ]}
    />
  );
}
