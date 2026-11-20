// Godot file formats: var_to_str text (the run autosave), encrypted files (the profile), .po translations,
// and the version stored in project.binary.
import aesjs from 'aes-js';
import { md5 } from 'js-md5';

/** Parse Godot's var_to_str() text, e.g. { "a": Vector3(1, 2, 3), "b": Array[String](["x"]) }. */
export function parseVarText(text: string): any {
  const re = /\s*(?:(&?"(?:[^"\\]|\\.)*")|([-+]?(?:\d+\.?\d*(?:e[-+]?\d+)?|inf|nan))|([A-Za-z_][A-Za-z_0-9]*)|([{}\[\](),:=]))/gy;
  const toks: [number, string][] = [];
  re.lastIndex = 0;
  while (re.lastIndex < text.length) {
    const at = re.lastIndex;
    const m = re.exec(text);
    if (!m) {
      if (text.slice(at).trim() === '') break;
      throw new Error('cannot parse save near: ' + text.slice(at, at + 40));
    }
    const kind = m[1] ? 0 : m[2] ? 1 : m[3] ? 2 : 3;
    toks.push([kind, m[1] ?? m[2] ?? m[3] ?? m[4]]);
  }
  let i = 0;
  const take = (want?: string) => {
    const t = toks[i++];
    if (want && t?.[1] !== want) throw new Error(`expected ${want}`);
    return t;
  };
  const peek = () => toks[i]?.[1];
  function value(): any {
    const [kind, v] = take();
    if (kind === 0) return JSON.parse(v.replace(/^&/, ''));
    if (kind === 1) return v === 'inf' ? Infinity : v === 'nan' ? NaN : Number(v);
    if (v === '{') {
      const o: Record<string, any> = {};
      while (peek() !== '}') { const k = value(); take(':'); o[String(k)] = value(); if (peek() === ',') i++; }
      take('}'); return o;
    }
    if (v === '[') {
      const a: any[] = [];
      while (peek() !== ']') { a.push(value()); if (peek() === ',') i++; }
      take(']'); return a;
    }
    if (kind === 2) {
      if (v === 'true' || v === 'false') return v === 'true';
      if (v === 'null') return null;
      if (peek() === '[') { let depth = 0; do { const t = take()[1]; if (t === '[') depth++; if (t === ']') depth--; } while (depth > 0); }
      if (peek() === '(') {
        i++;
        const args: any[] = [];
        while (peek() !== ')') { args.push(value()); if (peek() === ',') i++; }
        take(')');
        return (v === 'Array' || v === 'Dictionary') && args.length === 1 ? args[0] : { __type: v, args };
      }
      return v;
    }
    throw new Error('unexpected token ' + v);
  }
  return value();
}

/** Decrypt a FileAccess.open_encrypted_with_pass() file: "GDEC", md5, u64 length, 16-byte IV, AES-256-CFB data. */
export function decryptGodot(d: Uint8Array, password: string): Uint8Array {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (String.fromCharCode(...d.subarray(0, 4)) !== 'GDEC') return d;
  const sum = d.subarray(4, 20);
  const length = Number(dv.getBigUint64(20, true));
  const iv = d.subarray(28, 44);
  const key = new TextEncoder().encode(md5(password)); // the hex digest's 32 characters are the key
  const body = d.slice(44);
  const cfb = new aesjs.ModeOfOperation.cfb(key, iv, 16);
  const plain = cfb.decrypt(body).subarray(0, length);
  if (md5(plain) !== [...sum].map(b => b.toString(16).padStart(2, '0')).join('')) {
    throw new Error('Could not decrypt the profile (the game may have changed its save key).');
  }
  return plain;
}

/** {Spanish source text: translation} from a .po file (the game's text is authored in Spanish). */
export function parsePo(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const part = '((?:"(?:[^"\\\\]|\\\\.)*"\\s*)+)';
  const join = (s: string) => [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => JSON.parse(`"${m[1]}"`)).join('');
  for (const m of text.matchAll(new RegExp(`msgid ${part}msgstr ${part}`, 'g'))) {
    const k = join(m[1]), v = join(m[2]);
    if (k && v) out[k] = v;
  }
  return out;
}

/** application/config/version from project.binary. */
export function projectVersion(raw: Uint8Array | null): string {
  if (!raw) return '';
  const key = new TextEncoder().encode('application/config/version');
  outer: for (let i = 0; i + key.length < raw.length; i++) {
    for (let j = 0; j < key.length; j++) if (raw[i + j] !== key[j]) continue outer;
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const o = i + key.length;
    if (dv.getUint32(o + 4, true) !== 4) return '';
    const n = dv.getUint32(o + 8, true);
    return new TextDecoder().decode(raw.subarray(o + 12, o + 12 + n));
  }
  return '';
}

/** (mime, bytes) of a CompressedTexture2D (.ctex) that wraps a PNG or WebP. */
export function ctexImage(raw: Uint8Array): { mime: string; bytes: Uint8Array } | null {
  if (String.fromCharCode(...raw.subarray(0, 4)) !== 'GST2') return null;
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const mime = ({ 1: 'image/png', 2: 'image/webp' } as Record<number, string>)[dv.getUint32(36, true)];
  return mime ? { mime, bytes: raw.subarray(56, 56 + dv.getUint32(52, true)) } : null;
}
