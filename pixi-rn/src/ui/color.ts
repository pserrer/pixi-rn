/** ITU-R BT.601 perceived luminance of a `0xRRGGBB` colour, 0..255. */
export function perceivedLuminance(color: number): number {
  return 0.299 * ((color >> 16) & 0xff) + 0.587 * ((color >> 8) & 0xff) + 0.114 * (color & 0xff);
}

export interface AutoOutlineOptions {
  /** Colour used when the foreground counts as LIGHT. Default black. */
  dark?: number;
  /** Colour used when the foreground counts as DARK. Default white. */
  light?: number;
  /** Perceived luminance (0..255) at/above which the foreground counts as
   *  light. Default 140. */
  threshold?: number;
}

/**
 * Picks a legible pixel-outline colour for a foreground colour: dark behind
 * light text, light behind dark text. A single fixed outline colour only
 * works while every label using it is the same tone — once the same kit draws
 * both light labels on a dark panel and dark labels on a cream one, a
 * constant black outline goes invisible on the dark-on-light case (the edge
 * that is supposed to separate a glyph from whatever is behind it vanishes,
 * and the letters read as smudges).
 */
export function autoOutlineColor(foreground: number, options: AutoOutlineOptions = {}): number {
  const { dark = 0x000000, light = 0xffffff, threshold = 140 } = options;
  return perceivedLuminance(foreground) >= threshold ? dark : light;
}
