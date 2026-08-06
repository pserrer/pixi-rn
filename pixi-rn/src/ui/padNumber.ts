import '../core/adapter';
import { Container } from 'pixi.js';
import type { LayoutSize } from '../layout/layout';
import { measureText } from '../text/bitmapFont';
import { autoOutlineColor } from './color';
import { UiLabel } from './label';

export interface UiPadNumberOptions {
  /** Fixed digit count — the value is padded to it, never grows past it in
   *  the rendered width (a value that overflows just draws more digits; only
   *  the padding-driven width guarantee is lost). */
  digits: number;
  /** Appended after the digits (a unit, e.g. `'m'`), included in the fixed
   *  width. */
  suffix?: string;
  fontSize: number;
  letterSpacing?: number;
  /** Colour of the significant digits (and the suffix). */
  color: number;
  /** Colour of the leading zeros that pad the value out — typically dimmer,
   *  so the meaningful digits stand out. Defaults to `color`. */
  leadColor?: number;
  /** Pixel-outline width; 0 or omitted disables it. Colour is auto-picked per
   *  digit RUN from `autoOutlineColor` against that run's own foreground (the
   *  leading zeros and the significant digits can legitimately want different
   *  outline colours if `leadColor` and `color` sit on opposite sides of the
   *  light/dark threshold). */
  outlineWidth?: number;
}

/**
 * A fixed-width, zero-padded counter in two tones — the arcade-odometer HUD
 * idiom (a score or distance counter whose leading zeros are dimmed so the
 * changing digits stand out).
 *
 * The font is fixed-advance, so the padded string's rendered width never
 * changes with the value: `set()` only touches the two digit runs' text
 * (which pixi's own `text` setter — and `UiLabel.setText`'s identity guard —
 * both early-out on when unchanged), never triggers a flex layout pass, and
 * never makes a neighbouring control twitch as digits roll over. That is the
 * whole reason to reach for this over a plain `UiLabel` for anything updated
 * every frame.
 */
export class UiPadNumber extends Container {
  private readonly lead: UiLabel;
  private readonly rest: UiLabel;
  private readonly text: string;
  private readonly digits: number;
  private readonly suffix: string;
  private readonly fontSize: number;
  private readonly letterSpacing: number;
  private value = -1;

  constructor(options: UiPadNumberOptions) {
    super();
    this.digits = options.digits;
    this.suffix = options.suffix ?? '';
    this.fontSize = options.fontSize;
    this.letterSpacing = options.letterSpacing ?? 0;
    this.text = '0'.repeat(this.digits) + this.suffix;
    const leadColor = options.leadColor ?? options.color;
    const outline = (fg: number) =>
      options.outlineWidth ? { color: autoOutlineColor(fg), width: options.outlineWidth } : undefined;
    this.lead = new UiLabel('', {
      fontSize: this.fontSize,
      letterSpacing: this.letterSpacing,
      tint: leadColor,
      outline: outline(leadColor),
    });
    this.rest = new UiLabel('', {
      fontSize: this.fontSize,
      letterSpacing: this.letterSpacing,
      tint: options.color,
      outline: outline(options.color),
    });
    // The two runs are positioned by hand (`rest.x` follows the leading
    // zeros), so they live under a container with NO layout style — the flex
    // pass skips it entirely rather than stacking them.
    const glyphs = new Container();
    glyphs.addChild(this.lead, this.rest);
    this.addChild(glyphs);
    this.layout = {};
    this.set(0);
  }

  measureLayout(): LayoutSize {
    return measureText(this.text, this.fontSize, this.letterSpacing);
  }

  set(value: number): void {
    if (value === this.value) return;
    this.value = value;
    const padded = String(value).padStart(this.digits, '0');
    const firstSignificant = padded.search(/[1-9]/);
    const cut = firstSignificant === -1 ? padded.length - 1 : firstSignificant;
    const lead = padded.slice(0, cut);
    this.lead.setText(lead);
    this.rest.setText(padded.slice(cut) + this.suffix);
    this.rest.x = measureText(lead, this.fontSize, this.letterSpacing).width;
  }

  getValue(): number {
    return this.value;
  }
}
