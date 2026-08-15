import type { Sound } from '@pixi/sound';

/**
 * Switch between named looping tracks — background music, ambience beds —
 * pausing whichever one isn't current instead of destroying it, so resuming
 * it later picks up where it left off.
 *
 * ```ts
 * const music = new TrackSwitcher<'menu' | 'level'>();
 * music.add('menu', menuTrack);
 * music.add('level', levelTrack);
 *
 * music.play(inMenu ? 'menu' : 'level');
 * music.play(muted ? null : inMenu ? 'menu' : 'level'); // null = silence
 * music.setVolume(settings.musicVolume);
 * ```
 *
 * Every method is safe to call redundantly — `play`/`setVolume` only reach
 * the audio graph on an actual change, so a caller can call them every
 * render without tracking the edge itself.
 */
export class TrackSwitcher<Name extends string> {
  private readonly tracks = new Map<Name, Sound>();
  private want: Name | null = null;
  private playing: Name | null = null;
  private volume = 1;

  /** Register a track, or replace an already-registered one. If it's the
   *  track currently wanted, this starts it — for a track that finishes
   *  loading after `play()` already asked for it. */
  add(name: Name, track: Sound): void {
    this.tracks.set(name, track);
    this.apply();
  }

  /** Drop a track — pausing it first if it's the one playing. */
  remove(name: Name): void {
    if (this.playing === name) {
      this.tracks.get(name)?.pause();
      this.playing = null;
    }
    this.tracks.delete(name);
  }

  /** Which track should be audible, or `null` for silence. */
  play(name: Name | null): void {
    if (this.want === name) return;
    this.want = name;
    this.apply();
  }

  /** Gain applied to whichever track is currently playing. */
  setVolume(volume: number): void {
    if (this.volume === volume) return;
    this.volume = volume;
    this.apply();
  }

  private apply(): void {
    if (this.playing !== null && this.playing !== this.want) {
      this.tracks.get(this.playing)?.pause();
      this.playing = null;
    }
    for (const [name, track] of this.tracks) track.volume = name === this.want ? this.volume : 0;
    if (this.want !== null && this.playing !== this.want) {
      const track = this.tracks.get(this.want);
      if (track) {
        track.play();
        this.playing = this.want;
      }
    }
  }
}
