// Web Audio player for Melee sound ids: sounds.json maps an id to sample steps; samples stay
// DSP-ADPCM in storage and are decoded on first use, then cached as AudioBuffers.
import type { FileMap } from '../shared/character';
import { bytes, text } from '../shared/character';
import { readSnd, decodeChannel } from '../shared/snd';

export interface SoundStepDef { delayMs: number; sample: string; volume: number; pitchCents: number; pan: number }
export interface SoundDef { name: string; steps: SoundStepDef[] }

export class AudioPlayer {
  readonly ctx: AudioContext;
  private master: GainNode;
  private defs = new Map<number, SoundDef>();
  private byName = new Map<string, number>();
  private buffers = new Map<string, AudioBuffer>();
  private files: FileMap = new Map();
  private unlock = () => { void this.ctx.resume(); };

  constructor(volume = 0.7) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = volume;
    this.master.connect(this.ctx.destination);
    // Autoplay policy: a page that has not been interacted with starts suspended.
    for (const t of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(t, this.unlock, { capture: true, passive: true });
  }

  setVolume(v: number): void { this.master.gain.value = Math.max(0, Math.min(1, v)); }

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

  private buffer(path: string): AudioBuffer | null {
    const cached = this.buffers.get(path);
    if (cached) return cached;
    const data = this.files.get(path);
    if (!data) return null;
    const snd = readSnd(bytes(data)!);
    const chans = snd.channels.map(decodeChannel);
    const len = Math.max(1, ...chans.map((c) => c.length));
    const buf = this.ctx.createBuffer(chans.length, len, snd.sampleRate);
    chans.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    this.buffers.set(path, buf);
    return buf;
  }

  /** Plays a Melee sound id with the game's volume (0-127) and pan (0-127, 64 = centre). */
  play(id: number, volume = 127, pan = 64): void {
    const def = this.defs.get(id);
    if (!def || this.ctx.state === 'closed') return;
    const now = this.ctx.currentTime;
    const callGain = Math.min(255, volume * 2) / 255;
    for (const s of def.steps) {
      const buf = this.buffer(s.sample);
      if (!buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = Math.pow(2, s.pitchCents / 1200);
      const g = this.ctx.createGain();
      g.gain.value = (s.volume / 255) * callGain;
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, (pan - 64) / 64 * 0.6));
      src.connect(g).connect(p).connect(this.master);
      src.start(now + s.delayMs / 1000);
    }
  }

  destroy(): void {
    for (const t of ['keydown', 'pointerdown', 'touchstart']) window.removeEventListener(t, this.unlock, { capture: true });
    void this.ctx.close();
  }
}
