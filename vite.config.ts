import { execSync } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Which build this is, for the footer: `1.0`, the number of commits behind it and the commit itself, plus the
 * moment it was built. The count only means anything on a full clone, so the workflow checks out the whole
 * history; a build without git at all still runs, it just says `dev`.
 */
function stamp(): { version: string; at: string } {
  const git = (args: string) => execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  const at = new Date().toISOString();
  try {
    return { version: `1.0.${git('rev-list --count HEAD')}.${git('rev-parse --short HEAD')}`, at };
  } catch {
    return { version: '1.0.dev', at };
  }
}

/**
 * Dev only: serve two local folders to the page so `npm run dev` can read them without the folder picker
 * (and follow the current run live in any browser). Set MIDGARD_GAME and MIDGARD_SAVE, then open /?devfolders.
 * Bound to the dev server only; never part of the production build.
 */
function devFolders(): Plugin {
  const roots: Record<string, string | undefined> = { game: process.env.MIDGARD_GAME, save: process.env.MIDGARD_SAVE };
  return {
    name: 'dev-folders',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__folders', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const [, key, op, ...rest] = url.pathname.split('/');
        if (key === 'info') {
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ game: !!roots.game, save: !!roots.save }));
        }
        const root = roots[key];
        if (!root) { res.statusCode = 404; return res.end(); }
        const target = resolve(root, decodeURIComponent(op === 'list' ? url.searchParams.get('dir') ?? '' : rest.join('/')));
        if (relative(root, target).startsWith('..')) { res.statusCode = 403; return res.end(); }
        try {
          if (op === 'list') {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify(readdirSync(target, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name)));
          }
          const st = statSync(target);
          if (!st.isFile()) throw new Error('not a file');
          res.setHeader('X-Mtime', String(Math.floor(st.mtimeMs)));
          res.setHeader('Cache-Control', 'no-store');
          const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
          if (req.method === 'HEAD') { res.setHeader('Content-Length', String(st.size)); return res.end(); }
          if (m) {
            const start = Number(m[1]), end = m[2] ? Number(m[2]) : st.size - 1;
            res.statusCode = 206;
            res.setHeader('Content-Length', String(end - start + 1));
            return createReadStream(target, { start, end }).pipe(res);
          }
          res.setHeader('Content-Length', String(st.size));
          createReadStream(target).pipe(res);
        } catch {
          res.statusCode = 404; res.end();
        }
      });
    },
  };
}

/** A build without the extracted game data would publish a site that cannot show anything: refuse it. */
function requireGameData(): Plugin {
  return {
    name: 'require-game-data',
    apply: 'build',
    buildStart() {
      if (!existsSync(resolve(__dirname, 'public/game/data.json')))
        this.error('public/game/data.json is missing: run `npm run extract` (needs the game files) before building.');
    },
  };
}

// Static site: game data comes from public/game/ (npm run extract); the player's save is read in their browser.
export default defineConfig({
  define: { __BUILD__: JSON.stringify(stamp()) },
  base: './',
  build: { target: 'es2022' },
  plugins: [devFolders(), requireGameData()],
});
