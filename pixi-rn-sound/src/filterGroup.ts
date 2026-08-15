import type { Filter, Sound } from '@pixi/sound';

/**
 * Keep a filter chain applied consistently across a set of clips whose
 * membership changes over time — a clip that finishes loading after the
 * chain was switched on still needs to pick it up.
 *
 * ```ts
 * const caveEcho = new FilterGroup(() => [new filters.ReverbFilter(1.6, 2.5)]);
 * caveEcho.add(jumpClip);
 * caveEcho.add(footstepLoop);
 *
 * caveEcho.set(biome === 'cave'); // toggled as the player crosses biomes
 * ```
 *
 * `buildFilters` runs at most once, the first time the chain turns on — a
 * filter like `ReverbFilter` builds its impulse response in a JS loop, which
 * is too costly to redo on every toggle. If it throws, `set(true)` is a
 * no-op and every clip stays dry rather than the toggle silently breaking
 * playback.
 */
export class FilterGroup {
  private readonly sounds = new Set<Sound>();
  private chain: Filter[] | null = null;
  private on = false;

  constructor(private readonly buildFilters: () => Filter[]) {}

  /** Register a clip. Picks up the current chain immediately if it's on. */
  add(sound: Sound): void {
    this.sounds.add(sound);
    sound.filters = this.on && this.chain ? this.chain : [];
  }

  remove(sound: Sound): void {
    this.sounds.delete(sound);
  }

  /** Turn the chain on or off across every registered clip. A no-op if the
   *  state didn't change. */
  set(active: boolean): void {
    if (active === this.on) return;
    if (active && !this.chain) {
      try {
        this.chain = this.buildFilters();
      } catch {
        return;
      }
    }
    this.on = active;
    const applied = active && this.chain ? this.chain : [];
    for (const sound of this.sounds) sound.filters = applied;
  }
}
