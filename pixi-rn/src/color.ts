// The chrome kit's colours are authored as CSS strings ('#RRGGBB',
// 'rgba(r,g,b,a)') because that is what RN styles and the old Skia layers took.
// pixi wants a 0xRRGGBB tint plus a separate alpha, so this splits them.
// Parsed results are cached — the same handful of constants are re-published on
// every layout pass.
const cache = new Map<string, { rgb: number; alpha: number }>();

export function parseColor(css: string): { rgb: number; alpha: number } {
  const hit = cache.get(css);
  if (hit) return hit;
  let out = { rgb: 0x000000, alpha: 1 };
  if (css.startsWith('#')) {
    const h = css.slice(1);
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    out = { rgb: parseInt(full.slice(0, 6), 16), alpha: full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1 };
  } else {
    const m = css.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map((v) => parseFloat(v.trim()));
      out = { rgb: ((p[0] & 255) << 16) | ((p[1] & 255) << 8) | (p[2] & 255), alpha: p.length > 3 ? p[3] : 1 };
    }
  }
  cache.set(css, out);
  return out;
}
