import { measureText } from './bitmapFont';

/**
 * The largest of `sizes` at which EVERY string in `texts` fits `maxWidth`, or
 * the smallest when none does. Use it wherever a fixed size would ellipsize a
 * longer translation — the alternative is a comment asking the next author to
 * re-measure every locale by hand before touching a string.
 *
 * @param letterSpacingFor Optional, since some kits scale letter spacing with
 *   size (`size >= 20 ? 3 : ...`) and some just use a constant. Called once
 *   per candidate size, not per string.
 */
export function fitFontSize(
  texts: string[],
  maxWidth: number,
  sizes: number[],
  letterSpacingFor?: (size: number) => number,
): number {
  for (const size of sizes) {
    const spacing = letterSpacingFor ? letterSpacingFor(size) : 0;
    if (texts.every((text) => measureText(text, size, spacing).width <= maxWidth)) return size;
  }
  return sizes[sizes.length - 1];
}
