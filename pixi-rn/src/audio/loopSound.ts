import { createAudioPlayer, type AudioPlayer, type AudioSource } from 'expo-audio';

/**
 * A single looping `expo-audio` player, toggled on/off by `setActive`
 * rather than retriggered — the fix for a per-tick cue (footsteps while
 * grounded, say) whose triggers would otherwise cost a native bridge call
 * every tick it fires: loop the clip once and just pause/resume it.
 */
export class LoopSound {
  private player: AudioPlayer | null = null;
  private active = false;
  private mul = 1;

  constructor(
    private readonly source: AudioSource,
    private readonly volume: number,
  ) {}

  /** Constructs the single underlying player, if not already built. Same
   *  never-during-play rule as `SoundPool.warmOne` — call it ahead of time,
   *  not on first `setActive(true)`. */
  warmOne(): boolean {
    if (this.player) return false;
    const p = createAudioPlayer(this.source);
    p.loop = true;
    p.volume = this.volume * this.mul;
    this.player = p;
    return true;
  }

  /** A settings-style volume multiplier (0..1). Pauses a muted loop rather
   *  than leaving it running natively for nothing. */
  setVolume(mul: number): void {
    this.mul = mul;
    const p = this.player;
    if (!p) return;
    p.volume = this.volume * mul;
    if (mul <= 0) p.pause();
    else if (this.active) p.play();
  }

  /** Safe to call every frame — early-outs unless the active state actually
   *  changed, so the caller doesn't need to track the edge itself. Resuming
   *  never seeks, so continuing mid-loop is both correct and one less
   *  native call. */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    const p = this.player;
    if (!p || this.mul <= 0) return;
    if (on) p.play();
    else p.pause();
  }

  destroy(): void {
    this.player?.remove();
    this.player = null;
  }
}
