// Dev check: print the Bonus summary table computed by src/logic.ts for one class (compare with midgard_build.py).
import { openAsBlob, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
const [gameDir, saveDir, cid = 'mage'] = process.argv.slice(2);
const folder = root => ({ label: root, live: true,
  async file(p) { const f = join(root, p); return existsSync(f) ? await openAsBlob(f) : null; },
  async list(d = '') { return readdirSync(join(root, d), { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name); } });
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const g = await vite.ssrLoadModule('/src/game.ts'), L = await vite.ssrLoadModule('/src/logic.ts');
  const game = await g.loadGame(folder(gameDir), folder(saveDir), () => {});
  await g.setLanguage(game, 'en');
  const prof = await g.loadProfile(game);
  const b = L.collectPregame(game, prof, cid);
  const [cols, rows] = L.summaryTable(game, L.pregameSources(game, prof, cid, b));
  console.log(['', ...cols, 'Total'].join(' | '));
  for (const [l, v, t] of rows) console.log([l, ...v, t].join(' | '));
} finally { await vite.close(); }
