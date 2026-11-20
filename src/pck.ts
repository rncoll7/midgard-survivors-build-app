// Godot 4 .pck packs, read lazily from a File/Blob (only the directory and the files asked for).

export interface PackEntry { offset: number; size: number }

export class Pack {
  constructor(readonly name: string, readonly blob: Blob, readonly entries: Map<string, PackEntry>) {}

  static async open(name: string, blob: Blob): Promise<Pack> {
    const head = new DataView(await blob.slice(0, 0x70).arrayBuffer());
    if (head.getUint32(0, true) !== 0x43504447) throw new Error(`${name} is not a Godot pack`); // "GDPC"
    const base = Number(head.getBigUint64(24, true));
    const dirOff = Number(head.getBigUint64(32, true));
    const dir = new DataView(await blob.slice(dirOff).arrayBuffer());
    const dec = new TextDecoder();
    const entries = new Map<string, PackEntry>();
    let o = 0;
    const n = dir.getUint32(o, true); o += 4;
    for (let i = 0; i < n; i++) {
      const len = dir.getUint32(o, true); o += 4;
      let path = dec.decode(new Uint8Array(dir.buffer, dir.byteOffset + o, len)); o += len;
      path = path.replace(/\0+$/, '');
      const off = Number(dir.getBigUint64(o, true));
      const size = Number(dir.getBigUint64(o + 8, true));
      o += 16 + 16 + 4; // offset, size, md5, flags
      entries.set(path, { offset: off + base, size });
    }
    return new Pack(name, blob, entries);
  }

  async read(path: string): Promise<Uint8Array | null> {
    const e = this.entries.get(path);
    if (!e) return null;
    return new Uint8Array(await this.blob.slice(e.offset, e.offset + e.size).arrayBuffer());
  }
}

/** Packs as the game mounts them, newest first: auto-update patch, bridge, base pack. */
export class PackChain {
  constructor(readonly packs: Pack[]) {}

  async read(path: string): Promise<Uint8Array | null> {
    for (const p of this.packs) {
      const got = await p.read(path);
      if (got) return got;
    }
    return null;
  }

  /** Every path in any pack, mapped to the pack that wins for it. */
  paths(): Map<string, Pack> {
    const out = new Map<string, Pack>();
    for (const p of [...this.packs].reverse()) for (const path of p.entries.keys()) out.set(path, p);
    return out;
  }
}
