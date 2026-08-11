import { createAudioPlayer, type AudioPlayer, type AudioSource } from 'expo-audio';

export interface SoundPoolOptions {
  /** Concurrent player instances. Default 3 — more than a couple of
   *  overlapping copies of the SAME clip reads as mush, and pre-warming
   *  every instance up front (see `warmOne`) is what keeps native player
   *  construction off the `play()` path, so a bigger pool is a bigger
   *  up-front cost too. */
  max?: number;
  /** Minimum gap in ms between two `play()`s of this pool. 0 (default)
   *  means no throttling — set this for a clip that can legitimately fire
   *  many times a second (a coin run, a magnet pull) faster than is audibly
   *  useful; only `playDeferred()` honours it. */
  minGapMs?: number;
}

/**
 * A small per-clip pool of `expo-audio` `AudioPlayer`s, so overlapping
 * triggers of the SAME clip (a fast run of coin pickups) each get their own
 * player instead of retriggering one shared player — which cuts the
 * previous instance off mid-sound and sounds wrong for anything bursty.
 *
 * ⚠️ Every player MUST be constructed via `warmOne()` ahead of time, never
 * lazily inside `play()`: `createAudioPlayer()` is a synchronous native
 * constructor that loads an audio asset and BLOCKS the JS thread for tens
 * of ms on Android. Call `warmOne()` repeatedly (see `warmPools` for
 * spreading that across several pools and timer steps) until it returns
 * `false`, well before this pool's first real `play()` — e.g. while a
 * title/menu screen is up, not mid-gameplay.
 */
export class SoundPool {
  private players: AudioPlayer[] = [];
  private next = 0;
  private mul = 1;
  private deferredTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPlayAt = 0;
  private readonly max: number;
  private readonly minGapMs: number;

  constructor(
    private readonly source: AudioSource,
    private readonly volume: number,
    options: SoundPoolOptions = {},
  ) {
    this.max = options.max ?? 3;
    this.minGapMs = options.minGapMs ?? 0;
  }

  /** A settings-style volume multiplier (0..1) applied on top of the pool's
   *  base `volume`. Writes `player.volume` on every existing player — an
   *  Expo `SharedObject` WRITE crosses the native bridge same as a method
   *  call, so call this on an actual change, never per `play()`. */
  setVolume(mul: number): void {
    this.mul = mul;
    for (const p of this.players) p.volume = this.volume * mul;
  }

  /** Constructs one more player if the pool isn't full yet. Returns `false`
   *  once it is, so a caller can round-robin across several pools (see
   *  `warmPools`) and stop once every one reports full. */
  warmOne(): boolean {
    if (this.players.length >= this.max) return false;
    const p = createAudioPlayer(this.source);
    p.volume = this.volume * this.mul;
    this.players.push(p);
    return true;
  }

  /**
   * Plays the next player in round-robin order — deliberately WITHOUT
   * reading `player.playing` to pick an idle one: every property READ on an
   * Expo `SharedObject` crosses the native boundary too, so scanning for an
   * idle player would cost up to `max` extra native round-trips per call on
   * top of the `seekTo`+`play` this already needs. Cycling blindly picks a
   * different player each time, which is what a scan was really achieving
   * anyway.
   */
  play(): void {
    if (this.players.length === 0 && !this.warmOne()) return;
    const p = this.players[this.next % this.players.length];
    this.next = (this.next + 1) % this.players.length;
    p.seekTo(0);
    p.play();
  }

  /**
   * Same as `play()`, deferred to a macrotask (`setTimeout(…, 0)`) and
   * throttled by `minGapMs` — for triggers that fire from inside a
   * frame-loop step rather than a direct user gesture, so the native audio
   * bridge call can't land between that frame's simulation and its render.
   * Coalesced to at most one in-flight timer: if the thread is stalled,
   * this drops the extra call rather than piling up catch-up plays.
   */
  playDeferred(): void {
    if (this.deferredTimer !== null) return;
    if (this.minGapMs > 0) {
      const now = Date.now();
      if (now - this.lastPlayAt < this.minGapMs) return;
      this.lastPlayAt = now;
    }
    this.deferredTimer = setTimeout(() => {
      this.deferredTimer = null;
      this.play();
    }, 0);
  }

  /** Cancels any in-flight deferred play and releases every player. The
   *  pool is unusable after this — construct a new one rather than
   *  reviving it. */
  destroy(): void {
    if (this.deferredTimer !== null) {
      clearTimeout(this.deferredTimer);
      this.deferredTimer = null;
    }
    for (const p of this.players) p.remove();
    this.players = [];
  }
}
