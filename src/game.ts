// The game's data: data tables, translations, icons, save key and version. The site loads them from the files
// `npm run extract` writes to public/game/; the extractor itself reads them from the game's packs (base pack +
// auto-update patches) with loadGame().
import type { Folder } from './folders';
import { kvGet, kvSet } from './folders';
import { decodeTokens, evalConsts } from './gdscript';
import { ctexImage, decryptGodot, parsePo, parseVarText, projectVersion } from './godot';
import { Pack, PackChain } from './pck';

const ICON_DIRS = ['skill_icons', 'item_icons', 'cards', 'job_icons'];
const CACHE_VERSION = 1;
/** Where `npm run extract` puts the game data, relative to the site. */
export const BUNDLE = 'game';

export interface Game {
  G: Record<string, any>;        // the `const` tables of game_data.gd
  tr: Record<string, string>;    // translation of the game's Spanish text
  lang: string;
  langs?: string[];              // translations available in the bundle
  version: string;
  saveKey: string;
  /** packs, when read from game files (extractor); absent when loaded from the bundle */
  chain?: PackChain;
  /** "kind/name" -> .ctex path inside the packs, or the image file extension in the bundle */
  icons: Record<string, string>;
  save: Folder;
}

/** The bundle written by `npm run extract`. */
export interface Bundle { version: string; saveKey: string; G: Record<string, any>; icons: Record<string, string>; langs: string[] }

export async function loadBundled(save: Folder, progress: (msg: string) => void): Promise<Game> {
  progress('Loading game data…');
  const r = await fetch(`${BUNDLE}/data.json`);
  if (!r.ok) throw new Error('This site has no game data: run `npm run extract` before building it.');
  const b = (await r.json()) as Bundle;
  return { G: b.G, icons: b.icons, saveKey: b.saveKey, version: b.version, langs: b.langs, tr: {}, lang: 'es', save };
}

/** The game version of the player's install, from the auto-update state in their save folder ('' if unknown). */
export async function saveFolderVersion(save: Folder): Promise<string> {
  try {
    const f = await save.file('patches/state.json');
    const state = f ? JSON.parse(await f.text()) : null;
    if (!state) return '';
    const has = async (n?: string) => !!n && !!(await save.file('patches/' + n));
    if (await has(state.file)) return String(state.version ?? '');
    if (await has(state.bridge?.file)) return String(state.bridge.version ?? '');
    return String(state.base ?? '');
  } catch {
    return '';
  }
}

async function bytes(f: File | null): Promise<Uint8Array | null> {
  return f ? new Uint8Array(await f.arrayBuffer()) : null;
}

export async function openPacks(gameDir: Folder, save: Folder): Promise<{ chain: PackChain; version: string }> {
  let base = await gameDir.file('MidgardSurvivors.pck');
  if (!base) {
    const name = (await gameDir.list()).find(n => n.endsWith('.pck'));
    base = name ? await gameDir.file(name) : null;
  }
  if (!base) throw new Error('No MidgardSurvivors.pck in the game folder you picked.');
  const basePack = await Pack.open('base', base);
  const baseVersion = projectVersion(await basePack.read('project.binary'));
  const packs: Pack[] = [];
  let version = baseVersion;
  // Same rule as the game's Updater: patches only count when made for this base version.
  const stateRaw = await bytes(await save.file('patches/state.json'));
  if (stateRaw) {
    try {
      const state = JSON.parse(new TextDecoder().decode(stateRaw));
      if (!baseVersion || state.base === baseVersion) {
        const bridge = state.bridge || {};
        const bf = bridge.file ? await save.file('patches/' + bridge.file) : null;
        const pf = state.file ? await save.file('patches/' + state.file) : null;
        if (pf) { packs.push(await Pack.open(state.file, pf)); version = state.version || version; }
        if (bf) { packs.push(await Pack.open(bridge.file, bf)); if (!pf) version = bridge.version || version; }
      }
    } catch { /* unreadable state: base pack only */ }
  }
  packs.push(basePack);
  return { chain: new PackChain(packs), version: version || 'unknown' };
}

export async function loadGame(gameDir: Folder, save: Folder, progress: (msg: string) => void): Promise<Game> {
  progress('Reading game packs…');
  const { chain, version } = await openPacks(gameDir, save);
  const sig = chain.packs.map(p => `${p.name}:${p.blob.size}`).join('|');
  const cacheKey = `data-v${CACHE_VERSION}-${sig}`;
  let cached = await kvGet<{ G: Record<string, any>; icons: Record<string, string>; saveKey: string }>(cacheKey).catch(() => undefined);
  if (!cached) {
    progress('Decoding game data (first visit for this game version, a few seconds)…');
    const gd = await chain.read('scripts/autoload/game_data.gdc');
    const sv = await chain.read('scripts/autoload/save.gdc');
    if (!gd || !sv) throw new Error('Game data scripts not found in the packs.');
    const G = evalConsts(decodeTokens(gd));
    const saveKey = String(evalConsts(decodeTokens(sv)).SAVE_KEY ?? '');
    progress('Indexing icons…');
    const icons: Record<string, string> = {};
    const re = new RegExp(`^assets/ro/ui/skin/(${ICON_DIRS.join('|')})/(.+)\\.png\\.import$`);
    const jobs: Promise<void>[] = [];
    const all = chain.paths();
    for (const [path, pack] of all) {
      const m = re.exec(path);
      if (!m) continue;
      jobs.push(pack.read(path).then(raw => {
        const t = raw && /path="res:\/\/(.*?)"/.exec(new TextDecoder().decode(raw));
        if (t && all.has(t[1])) icons[`${m[1]}/${m[2]}`] = t[1];
      }));
    }
    await Promise.all(jobs);
    cached = { G, icons, saveKey };
    await kvSet(cacheKey, cached).catch(() => undefined);
  }
  return { ...cached, tr: {}, lang: 'es', version, chain, save };
}

export async function setLanguage(game: Game, lang: string): Promise<void> {
  if (lang === game.lang) return;
  if (lang === 'es') { game.tr = {}; game.lang = lang; return; }
  if (game.chain) {
    const raw = await game.chain.read(`locale/${lang}.po`);
    if (!raw) return;
    game.tr = parsePo(new TextDecoder().decode(raw));
  } else {
    if (game.langs && !game.langs.includes(lang)) return;
    const r = await fetch(`${BUNDLE}/i18n/${lang}.json`);
    if (!r.ok) return;
    game.tr = await r.json();
  }
  game.lang = lang;
}

export async function loadProfile(game: Game): Promise<Record<string, any>> {
  const raw = await bytes(await game.save.file('profile.json'));
  if (!raw) throw new Error('No profile.json in the save folder you picked.');
  return JSON.parse(new TextDecoder().decode(decryptGodot(raw, game.saveKey)));
}

/** The newest run autosave (*.run), written every 15 s during a solo stage run. */
export async function latestRun(game: Game): Promise<{ run: any; stamp: number } | null> {
  let best: File | null = null;
  for (const name of await game.save.list()) {
    if (!name.endsWith('.run')) continue;
    const f = await game.save.file(name);
    if (f && (!best || f.lastModified > best.lastModified)) best = f;
  }
  if (!best) return null;
  try { return { run: parseVarText(await best.text()), stamp: best.lastModified }; } catch { return null; }
}

// ---- icons: decoded on demand and served as blob: URLs

const iconUrls = new Map<string, Promise<string>>();

export function iconUrl(game: Game, key: string): Promise<string> {
  if (!game.chain) {
    const [kind, name] = key.split(/\/(.*)/s);
    return Promise.resolve(game.icons[key] ? `${BUNDLE}/icons/${kind}/${encodeURIComponent(name)}.${game.icons[key]}` : '');
  }
  let p = iconUrls.get(key);
  if (!p) {
    p = (async () => {
      const path = game.icons[key];
      const raw = path ? await game.chain!.read(path) : null;
      const img = raw && ctexImage(raw);
      return img ? URL.createObjectURL(new Blob([img.bytes as BlobPart], { type: img.mime })) : '';
    })();
    iconUrls.set(key, p);
  }
  return p;
}

/** First "kind/name" that has an icon, or ''. */
export function iconKey(game: Game, kind: string, ...names: unknown[]): string {
  for (const n of names) if (n != null && game.icons[`${kind}/${n}`]) return `${kind}/${n}`;
  return '';
}
