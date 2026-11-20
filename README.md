# Midgard Survivors build viewer

A static site that shows your Midgard Survivors characters, card collection, current run (live) and pre-run
setup, with the game's Bonus summary, a build planner and PNG export.

The game's data, translations, icons and card art are extracted once from a local install with
`npm run extract` and served by the site, so players only pick their **save folder**. The save is read inside
their browser: nothing is uploaded and nothing is ever written to it.

> `public/game/` (what `npm run extract` writes) is the game's own material (its art, text and save key). It is
> git-ignored so it never lands in the repository; publishing the built site does serve it.

## The folder the site asks for

The **save folder**: `~/.local/share/godot/app_userdata/Midgard Survivors` (Linux; Ctrl+H shows hidden
folders in the picker), `%APPDATA%\Godot\app_userdata\Midgard Survivors` (Windows),
`~/Library/Application Support/Godot/app_userdata/Midgard Survivors` (macOS).

It reads only `profile.json`, the current run's `profile.run` and `patches/state.json` (to warn when the
player's game is a different version than the extracted data).

Chrome and Edge remember the folder and follow the current run live. Firefox and Safari read it once
(a snapshot); pick the folder again to refresh.

## Extract the game data

```bash
npm run extract                       # defaults: ~/code/midgard-survivors-midgard-survivors-linux and the Linux save folder
npm run extract -- <game folder> <save folder>
```

It reads the base pack plus the auto-update patches in the save folder (so the data matches the version you
play) and writes `public/game/`: `data.json` (the tables the site uses, the save key, the version),
`i18n/<lang>.json` and `icons/`. Run it again after a game update. `npm run build` refuses to build without it.

## Develop

```bash
npm install
npm run extract
npm run dev
```

To skip the folder picker while developing (and get live updates in any browser), give the dev server the
save folder and open `http://localhost:5173/?devfolders`:

```bash
MIDGARD_SAVE="$HOME/.local/share/godot/app_userdata/Midgard Survivors" npm run dev
```

That folder bridge exists only in the dev server; it is not part of the build.

`tools/check-readers.mjs` and `tools/check-summary.mjs` run the pack readers and the Bonus summary in Node
against local files, to compare with `midgard_build.py`.

## Deploy

The site is published at <https://midgard-build.rn7.dev.br> by a Cloudflare Worker that only serves static
assets, on the personal account (same setup as `led_scroller`). The configuration is in `wrangler.jsonc`.

```bash
npm run extract   # once, and after each game update
npm run deploy    # npm run build && wrangler deploy
```

The deploy needs a token for the personal Cloudflare account in `.env.local` (git-ignored):

```
CLOUDFLARE_API_TOKEN=<token from the "Edit Cloudflare Workers" template>
```

`account_id` is pinned in `wrangler.jsonc`, so a token for another account makes the deploy fail instead of
publishing in the wrong place. On the first publish wrangler creates the DNS record and certificate for the
subdomain.

Deploys happen only from a computer with the game installed: the build needs `public/game/`, which comes from
the local game files and is never committed, so there is no GitHub Actions deploy.

## Code map

| File | What it does |
|---|---|
| `tools/extract-assets.mjs` | `npm run extract`: game packs → `public/game/` |
| `src/pck.ts` | Reads Godot `.pck` packs lazily (directory + requested files only); used by the extractor |
| `src/gdscript.ts` | Decodes compiled GDScript tokens and evaluates its `const` data tables; used by the extractor |
| `src/godot.ts` | Run autosave text, profile decryption (AES-256-CFB), `.po`, `project.binary`, `.ctex` |
| `src/game.ts` | Game data from the bundle (site) or from the packs (extractor), profile, run, icons |
| `src/logic.ts` | Build collectors, Bonus summary (port of the game's `bonus_summary.gd`), records, plans |
| `src/render.ts` | Page HTML |
| `src/planner.ts` | Build planner (saved in localStorage) |
| `src/main.ts` | Save-folder setup, routes, live updates, PNG export |
