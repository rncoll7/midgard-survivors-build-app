// Dev check: load the browser readers in Node (through Vite) against local game files.
// usage: node tools/check-readers.mjs <game folder> <save folder>
import { openAsBlob, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

const [gameDir, saveDir] = process.argv.slice(2);
const folder = root => ({
  label: root, live: true,
  async file(p) {
    const f = join(root, p);
    if (!existsSync(f)) return null;
    const b = await openAsBlob(f);
    return Object.assign(b, { name: p.split('/').pop(), lastModified: 0, text: () => b.text() });
  },
  async list(d = '') { return readdirSync(join(root, d), { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name); },
});

globalThis.indexedDB = undefined; // no cache in Node
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const g = await vite.ssrLoadModule('/src/game.ts');
  const t0 = Date.now();
  const game = await g.loadGame(folder(gameDir), folder(saveDir), m => console.log('  ' + m));
  console.log('loaded in', Date.now() - t0, 'ms; version', game.version, '; packs', game.chain.packs.map(p => p.name).join(', '));
  const G = game.G;
  for (const k of ['ITEMS', 'CARDS', 'SKILLS', 'EVOLUTIONS', 'CLASSES', 'PETS', 'PACTS', 'RECIPES', 'UPGRADES', 'SAGE_UPGRADES', 'SETS', 'MONSTERS'])
    console.log(k.padEnd(14), G[k] ? Object.keys(G[k]).length : 'MISSING');
  console.log('REFINE_SLOW_GROWTH', JSON.stringify(G.REFINE_SLOW_GROWTH), 'HARMONY_SHARE', JSON.stringify(G.HARMONY_SHARE));
  console.log('staff', JSON.stringify(G.ITEMS.staff_of_destruction));
  console.log('icons', Object.keys(game.icons).length, 'saveKey', game.saveKey ? 'found' : 'MISSING');
  await g.setLanguage(game, 'en');
  console.log('en', Object.keys(game.tr).length, '|', game.tr[G.PACTS.overload.name]);
  const prof = await g.loadProfile(game);
  console.log('profile keys', Object.keys(prof).length, 'mage level', prof.classes.mage.level);
  const run = await g.latestRun(game);
  console.log('run', run ? `${run.run.name} Lv ${run.run.level}` : 'none');
} finally {
  await vite.close();
}
