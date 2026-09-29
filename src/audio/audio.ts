// Web Audio player for Melee sound ids: sounds.json maps an id to sample steps; samples stay
// DSP-ADPCM in storage and are decoded on first use, then cached as AudioBuffers.
import type { FileMap } from '../shared/character';
import { bytes, text } from '../shared/character';
import { readSnd, decodeChannel } from '../shared/snd';

export interface SoundStepDef { delayMs: number; sample: string; volume: number; pitchCents: number; pan: number }
export interface SoundDef { name: string; steps: SoundStepDef[] }

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume: number;
  private defs = new Map<number, SoundDef>();
  private byName = new Map<string, number>();
  private buffers = new Map<string, AudioBuffer>();
  private files: FileMap = new Map();
  private unlock = () => { void this.context()?.resume(); };

  constructor(volume = 0.7) {
    this.volume = volume;
    for (const t of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(t, this.unlock, { capture: true, passive: true });
  }

  /**
   * The audio context, made once the page has had a key press, click or touch: Chrome's autoplay
   * policy warns about (and suspends) one made before that. The toolbar button and Alt+M don't count
   * as the page's, so sounds before the first key press are skipped.
   */
  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  /** Loads every sounds/sounds.json in the folder (character and common). */
  load(files: FileMap): void {
    this.files = files;
    this.defs.clear();
    this.byName.clear();
    this.buffers.clear();
    for (const [path, data] of files) {
      if (!path.endsWith('sounds/sounds.json')) continue;
      const table = JSON.parse(text(data)!) as Record<string, SoundDef>;
      for (const [id, def] of Object.entries(table)) {
        this.defs.set(Number(id), def);
        this.byName.set(def.name, Number(id));
      }
    }
  }

  list(): Array<[number, SoundDef]> { return [...this.defs].sort((a, b) => a[0] - b[0]); }
  idOf(name: string): number | undefined { return this.byName.get(name); }

  private buffer(ctx: AudioContext, path: string): AudioBuffer | null {
    const cached = this.buffers.get(path);
    if (cached) return cached;
    const data = this.files.get(path);
    if (!data) return null;
    const snd = readSnd(bytes(data)!);
    const chans = snd.channels.map(decodeChannel);
    const len = Math.max(1, ...chans.map((c) => c.length));
    const buf = ctx.createBuffer(chans.length, len, snd.sampleRate);
    chans.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    this.buffers.set(path, buf);
    return buf;
  }

  /** Plays a Melee sound id with the game's volume (0-127) and pan (0-127, 64 = centre). */
  play(id: number, volume = 127, pan = 64): void {
    const def = this.defs.get(id);
    const ctx = def ? this.context() : null;
    if (!def || !ctx || !this.master || ctx.state === 'closed') return;
    const now = ctx.currentTime;
    const callGain = Math.min(255, volume * 2) / 255;
    for (const s of def.steps) {
      const buf = this.buffer(ctx, s.sample);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = Math.pow(2, s.pitchCents / 1200);
      const g = ctx.createGain();
      g.gain.value = (s.volume / 255) * callGain;
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, (pan - 64) / 64 * 0.6));
      src.connect(g).connect(p).connect(this.master);
      src.start(now + s.delayMs / 1000);
    }
  }

  destroy(): void {
    for (const t of ['keydown', 'pointerdown', 'touchstart']) window.removeEventListener(t, this.unlock, { capture: true });
    void this.ctx?.close();
  }
}
