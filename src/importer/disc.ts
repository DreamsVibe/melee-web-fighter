// Reads a GameCube disc image (plain .iso/.gcm or compressed .ciso) from a File in slices.
// The whole image is never loaded: only the header, the file table and the files asked for.

export interface DiscFile { path: string; offset: number; size: number }

export class DiscError extends Error {}

const CISO_HEADER = 0x8000;

export class Disc {
  private blockSize = 0;
  /** For CISO: disc block index → file offset of its stored copy, or -1 when it is all zeros. */
  private blockMap: Int32Array | null = null;
  files = new Map<string, DiscFile>();
  gameId = '';
  revision = -1;
  kind: 'iso' | 'ciso' = 'iso';

  private constructor(private readonly file: Blob) {}

  static async open(file: Blob): Promise<Disc> {
    const d = new Disc(file);
    await d.init();
    return d;
  }

  private async raw(offset: number, size: number): Promise<Uint8Array> {
    return new Uint8Array(await this.file.slice(offset, offset + size).arrayBuffer());
  }

  private async init(): Promise<void> {
    const head = await this.raw(0, 8);
    if (head[0] === 0x43 && head[1] === 0x49 && head[2] === 0x53 && head[3] === 0x4f) {
      this.kind = 'ciso';
      const h = await this.raw(0, CISO_HEADER);
      const bs = new DataView(h.buffer).getUint32(4, true);
      if (bs === 0 || bs > 0x10000000) throw new DiscError(`This .ciso has an invalid block size (${bs}).`);
      this.blockSize = bs;
      const map = new Int32Array(CISO_HEADER - 8);
      let stored = 0;
      for (let i = 0; i < map.length; i++) map[i] = h[8 + i] ? CISO_HEADER + (stored++) * bs : -1;
      this.blockMap = map;
    }
    const header = await this.read(0, 0x440);
    this.gameId = String.fromCharCode(...header.subarray(0, 6));
    this.revision = header[7];
    if (!/^[A-Z0-9]{6}$/.test(this.gameId)) {
      throw new DiscError('This file is not a GameCube disc image (no game id in its header).');
    }
    if (this.gameId !== 'GALE01') {
      throw new DiscError(`This disc is ${this.gameId}, not Super Smash Bros. Melee NTSC (GALE01).`);
    }
    if (this.revision !== 2) {
      throw new DiscError(`This is Melee NTSC revision 1.0${this.revision}. Melee Web Fighter needs version 1.02 (revision 2).`);
    }
    const dv = new DataView(header.buffer, header.byteOffset);
    const fstOffset = dv.getUint32(0x424);
    const fstSize = dv.getUint32(0x428);
    if (fstSize < 12 || fstSize > 4 << 20) throw new DiscError('The disc file table is damaged.');
    this.parseFst(await this.read(fstOffset, fstSize));
  }

  private parseFst(fst: Uint8Array): void {
    const dv = new DataView(fst.buffer, fst.byteOffset, fst.byteLength);
    const count = dv.getUint32(8);
    const strings = count * 12;
    const name = (off: number) => {
      let e = strings + off;
      while (e < fst.length && fst[e]) e++;
      return String.fromCharCode(...fst.subarray(strings + off, e));
    };
    const dirs: Array<{ name: string; end: number }> = [];
    for (let i = 1; i < count; i++) {
      while (dirs.length && i >= dirs[dirs.length - 1].end) dirs.pop();
      const e = i * 12;
      const isDir = fst[e] === 1;
      const n = name(dv.getUint32(e) & 0xffffff);
      const a = dv.getUint32(e + 4), b = dv.getUint32(e + 8);
      if (isDir) dirs.push({ name: n, end: b });
      else {
        const path = [...dirs.map((d) => d.name), n].join('/');
        this.files.set(path, { path, offset: a, size: b });
      }
    }
  }

  /** Reads bytes at a disc offset, resolving CISO blocks. */
  async read(offset: number, size: number): Promise<Uint8Array> {
    if (!this.blockMap) return this.raw(offset, size);
    const out = new Uint8Array(size);
    let done = 0;
    while (done < size) {
      const pos = offset + done;
      const block = Math.floor(pos / this.blockSize);
      const within = pos % this.blockSize;
      const take = Math.min(size - done, this.blockSize - within);
      const at = block < this.blockMap.length ? this.blockMap[block] : -1;
      if (at >= 0) out.set(await this.raw(at + within, take), done);
      done += take;
    }
    return out;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const f = this.files.get(path);
    if (!f) throw new DiscError(`The disc has no ${path}. Is it a modified Melee image?`);
    return this.read(f.offset, f.size);
  }
}
