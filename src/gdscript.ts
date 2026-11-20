// Compiled GDScript (.gdc, Godot 4.4+ binary tokens): decode the token stream and evaluate `const` data tables.
// Only literals, containers and arithmetic are evaluated; calls such as Color(...) become null. No game code runs.
import { decompress } from 'fzstd';

// Godot GDScriptTokenizer::Token::Type, in enum order.
const T = ('EMPTY ANNOTATION IDENTIFIER LITERAL < <= > >= == != and or not && || ! & | ~ ^ << >> + - * ** / % = += -= *= **= ' +
  '/= %= <<= >>= &= |= ^= if elif else for while break continue pass return match when as assert await breakpoint class ' +
  'class_name const enum extends func in is namespace preload self signal static super trait var void yield [ ] { } ( ) , ; ' +
  '. .. ... : $ -> _ NEWLINE INDENT DEDENT PI TAU INF NAN').split(' ');

type Tok = { t: string; v?: unknown };

function variant(dv: DataView, o: number, dec: TextDecoder): [unknown, number] {
  const tag = dv.getUint32(o, true); o += 4;
  const type = tag & 0xffff, wide = (tag & (1 << 16)) !== 0;
  switch (type) {
    case 0: return [null, o];
    case 1: return [dv.getUint32(o, true) !== 0, o + 4];
    case 2: return wide ? [Number(dv.getBigInt64(o, true)), o + 8] : [dv.getInt32(o, true), o + 4];
    case 3: return wide ? [dv.getFloat64(o, true), o + 8] : [Math.fround(dv.getFloat32(o, true)), o + 4];
    case 4: case 21: case 22: {
      const n = dv.getUint32(o, true); o += 4;
      const s = dec.decode(new Uint8Array(dv.buffer, dv.byteOffset + o, n));
      return [s, o + ((n + 3) & ~3)];
    }
  }
  const sizes: Record<number, number> = { 5: 8, 6: 8, 7: 16, 8: 16, 9: 12, 10: 12, 12: 16, 13: 16, 14: 16, 15: 16, 20: 16 };
  if (type in sizes) return [null, o + sizes[type]];
  throw new Error(`unsupported constant type ${type}`);
}

export function decodeTokens(raw: Uint8Array): Tok[] {
  if (String.fromCharCode(...raw.subarray(0, 4)) !== 'GDSC') throw new Error('not a compiled GDScript file');
  const d = decompress(raw.subarray(12));
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const dec = new TextDecoder();
  const [ni, nc, nl, nt] = [0, 4, 8, 12].map(i => dv.getUint32(i, true));
  let o = 16;
  const ids: string[] = [];
  for (let i = 0; i < ni; i++) {
    const n = dv.getUint32(o, true); o += 4;
    let s = '';
    for (let j = 0; j < n; j++) s += String.fromCodePoint((dv.getUint32(o + 4 * j, true) ^ 0xb6b6b6b6) & 0x1fffff);
    ids.push(s); o += 4 * n;
  }
  const consts: unknown[] = [];
  for (let i = 0; i < nc; i++) { const [v, no] = variant(dv, o, dec); consts.push(v); o = no; }
  o += nl * 16; // line and column maps
  const toks: Tok[] = [];
  for (let i = 0; i < nt; i++) {
    const v = dv.getUint32(o, true); o += 8;
    const t = T[v & 0x7f] ?? '?', dat = v >>> 8;
    toks.push(t === 'IDENTIFIER' || t === 'ANNOTATION' ? { t, v: ids[dat] } : t === 'LITERAL' ? { t, v: consts[dat] } : { t });
  }
  return toks;
}

/** Evaluate every top-level `const NAME := <expr>` (later consts may refer to earlier ones by name). */
export function evalConsts(toks: Tok[]): Record<string, any> {
  const out: Record<string, any> = {};
  let i = 0;
  const peek = () => toks[i]?.t;
  const take = (t?: string) => {
    const k = toks[i++];
    if (t && k?.t !== t) throw new Error(`expected ${t}, got ${k?.t}`);
    return k;
  };
  const skipNl = () => { while (peek() === 'NEWLINE' || peek() === 'INDENT' || peek() === 'DEDENT') i++; };

  function primary(): any {
    skipNl();
    const k = take();
    switch (k.t) {
      case 'LITERAL': return k.v;
      case 'PI': return Math.PI;
      case 'TAU': return 2 * Math.PI;
      case 'INF': return Infinity;
      case 'NAN': return NaN;
      case '(': { const v = expr(); skipNl(); take(')'); return v; }
      case '[': {
        const arr: any[] = [];
        for (skipNl(); peek() !== ']'; skipNl()) { arr.push(expr()); skipNl(); if (peek() === ',') i++; }
        take(']'); return arr;
      }
      case '{': {
        const obj: Record<string, any> = {};
        for (skipNl(); peek() !== '}'; skipNl()) {
          let key: any;
          if (peek() === 'IDENTIFIER' && toks[i + 1]?.t === '=') { key = take().v; i++; } // Lua-style { a = 1 }
          else { key = expr(); skipNl(); take(':'); }
          obj[String(key)] = expr(); skipNl();
          if (peek() === ',') i++;
        }
        take('}'); return obj;
      }
      case 'IDENTIFIER': {
        const name = k.v as string;
        if (peek() === '(') { // a call: Color(...), Vector2(...)
          i++;
          for (skipNl(); peek() !== ')'; skipNl()) { expr(); skipNl(); if (peek() === ',') i++; }
          take(')'); return null;
        }
        return name in out ? out[name] : null;
      }
    }
    throw new Error(`unexpected ${k.t}`);
  }
  function postfix(): any {
    let v = primary();
    for (;;) {
      if (peek() === '.') { i += 2; v = null; if (peek() === '(') primary(); } // attribute / method: unsupported
      else if (peek() === '[') { i++; const key = expr(); take(']'); v = v == null ? null : v[key]; }
      else return v;
    }
  }
  function unary(): any {
    skipNl();
    if (peek() === '-') { i++; const v = unary(); return typeof v === 'number' ? -v : null; }
    if (peek() === 'not') { i++; return !unary(); }
    return postfix();
  }
  function term(): any {
    let v = unary();
    while (['*', '/', '%'].includes(peek())) {
      const op = take().t, r = unary();
      v = typeof v === 'number' && typeof r === 'number' ? (op === '*' ? v * r : op === '/' ? v / r : v % r) : null;
    }
    return v;
  }
  function expr(): any {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = take().t, r = term();
      v = typeof v === 'number' && typeof r === 'number' ? (op === '+' ? v + r : v - r)
        : typeof v === 'string' && typeof r === 'string' && op === '+' ? v + r : null;
    }
    return v;
  }

  while (i < toks.length) {
    if (toks[i].t !== 'const' || toks[i + 1]?.t !== 'IDENTIFIER') { i++; continue; }
    const name = toks[i + 1].v as string;
    i += 2;
    while (i < toks.length && toks[i].t !== '=' && toks[i].t !== 'NEWLINE') i++; // `: Type =` or `:=`
    if (toks[i]?.t !== '=') continue;
    i++;
    const start = i;
    try {
      out[name] = expr();
    } catch {
      i = start; // skip what we cannot read up to the end of the statement
      let depth = 0;
      while (i < toks.length && !(depth <= 0 && toks[i].t === 'NEWLINE')) {
        const t = toks[i].t;
        if ('([{'.includes(t)) depth++;
        if (')]}'.includes(t)) depth--;
        i++;
      }
    }
  }
  return out;
}
