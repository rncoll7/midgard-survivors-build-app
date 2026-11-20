// Extract the game data the site needs into public/game/, so the site works without the player's game files:
//   data.json        the game_data tables the site reads, the save key and the game version
//   i18n/<lang>.json the game's translations, trimmed to the strings the site shows
//   icons/<kind>/    skill/item/job icons and card art, as the game's own WebP/PNG images
//
// usage: npm run extract [-- <game folder> <save folder>]
// (defaults: $MIDGARD_GAME / $MIDGARD_SAVE, then the usual Linux install and save locations)
// public/game/ is the game's material: it is git-ignored on purpose.
import { existsSync, mkdirSync, openAsBlob, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [argGame, argSave] = process.argv.slice(2);
const gameDir = argGame || process.env.MIDGARD_GAME || join(homedir(), 'code/midgard-survivors-midgard-survivors-linux');
const saveDir = argSave || process.env.MIDGARD_SAVE || join(homedir(), '.local/share/godot/app_userdata/Midgard Survivors');
const out = join(root, 'public', 'game');

const folder = dir => ({
  label: dir, live: true,
  async file(p) {
    const f = join(dir, p);
    if (!existsSync(f) || !statSync(f).isFile()) return null;
    const b = await openAsBlob(f);
    return Object.assign(b, { name: p.split('/').pop(), lastModified: statSync(f).mtimeMs, text: () => b.text() });
  },
  async list(d = '') { return readdirSync(join(dir, d), { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name); },
});

/** every string inside a JSON-able value */
function strings(v, into) {
  if (typeof v === 'string') into.add(v);
  else if (Array.isArray(v)) v.forEach(x => strings(x, into));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, into));
  return into;
}

const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { loadGame } = await vite.ssrLoadModule('/src/game.ts');
  const { parsePo, ctexImage } = await vite.ssrLoadModule('/src/godot.ts');
  const { GAME_TABLES, UI_STRINGS } = await vite.ssrLoadModule('/src/logic.ts');

  console.log(`game folder: ${gameDir}\nsave folder: ${saveDir}`);
  const game = await loadGame(folder(gameDir), folder(saveDir), m => console.log('  ' + m));
  console.log(`game version ${game.version} (packs: ${game.chain.packs.map(p => p.name).join(', ')})`);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const G = {};
  for (const t of GAME_TABLES) {
    if (game.G[t] === undefined) throw new Error(`table ${t} not found in the game data`);
    G[t] = game.G[t];
  }

  // icons: the game's own images, unchanged
  const icons = {};
  let bytes = 0;
  for (const [key, path] of Object.entries(game.icons)) {
    const raw = await game.chain.read(path);
    const img = raw && ctexImage(raw);
    if (!img) continue;
    const ext = img.mime === 'image/webp' ? 'webp' : 'png';
    const [kind, name] = key.split(/\/(.*)/s);
    mkdirSync(join(out, 'icons', kind), { recursive: true });
    writeFileSync(join(out, 'icons', kind, `${name}.${ext}`), img.bytes);
    icons[key] = ext;
    bytes += img.bytes.length;
  }
  console.log(`icons: ${Object.keys(icons).length} files, ${(bytes / 1e6).toFixed(1)} MB`);

  // translations, trimmed to what the site can show
  const wanted = strings(G, new Set(UI_STRINGS));
  const langs = [];
  mkdirSync(join(out, 'i18n'), { recursive: true });
  for (const path of game.chain.paths().keys()) {
    const m = /^locale\/(.+)\.po$/.exec(path);
    if (!m) continue;
    const all = parsePo(new TextDecoder().decode(await game.chain.read(path)));
    const tr = Object.fromEntries(Object.entries(all).filter(([k]) => wanted.has(k)));
    writeFileSync(join(out, 'i18n', `${m[1]}.json`), JSON.stringify(tr));
    langs.push(m[1]);
  }
  console.log(`translations: ${langs.sort().join(', ')}`);

  const data = { version: game.version, saveKey: game.saveKey, G, icons, langs };
  writeFileSync(join(out, 'data.json'), JSON.stringify(data));
  console.log(`data.json: ${(JSON.stringify(data).length / 1e6).toFixed(2)} MB → ${out}`);
} finally {
  await vite.close();
}
