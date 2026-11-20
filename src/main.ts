import './style.css';
import { toPng } from 'html-to-image';
import type { Folder } from './folders';
import { canPickFolders, devFolder, listFolder, pickFolder, rememberedFolder } from './folders';
import type { Game } from './game';
import { iconUrl, latestRun, loadBundled, loadProfile, saveFolderVersion, setLanguage } from './game';
import type { Plan } from './logic';
import { applyPlan, nameOf, tbl } from './logic';
import { decodePlan, encodePlan, mountPlanner, plannerBody, plannerToolbar } from './planner';
import { appStamp, cardsPage, esc, footer, header, homePage, pregamePage, runPage } from './render';

const app = document.getElementById('app')!;
let game: Game | null = null;
let prof: any = null;
let liveStamp = -1;
let planner: { isDirty(): boolean } | null = null;
let lastHash = location.hash;

const DESC_KEY = 'midgard_build_desc';
const descOn = () => { try { return localStorage.getItem(DESC_KEY) !== '0'; } catch { return true; } };
const setDesc = (on: boolean) => { try { localStorage.setItem(DESC_KEY, on ? '1' : '0'); } catch { /* private mode */ } };

// ---- icons

function hydrate(root: ParentNode = document) {
  if (!game) return;
  root.querySelectorAll<HTMLImageElement>('img[data-icon]:not([src])').forEach(el => {
    iconUrl(game!, el.dataset.icon!).then(u => { if (u) el.src = u; });
  });
}

async function iconsReady(root: ParentNode) {
  const imgs = [...root.querySelectorAll<HTMLImageElement>('img[data-icon]')];
  await Promise.all(imgs.map(async el => {
    if (!el.src) el.src = await iconUrl(game!, el.dataset.icon!);
    if (!el.src || (el.complete && el.naturalWidth)) return;
    // decode() can stall while the tab is in the background; a loaded image is enough, so don't wait forever
    await Promise.race([el.decode().catch(() => undefined), new Promise(ok => { el.addEventListener('load', ok, { once: true }); setTimeout(ok, 3000); })]);
  }));
}

// ---- page shell

interface Shell { toolbar: string; title: string; head: string; body: string; png?: string; descToggle?: boolean }

function show(s: Shell) {
  document.title = `${s.title} · Midgard Survivors`;
  const tools = `${s.toolbar}${versionNote ? `<span class="warn">${esc(versionNote)}</span>` : ''}<span class="sp"></span>${s.descToggle === false ? '' :
    `<label><input type="checkbox" id="desc"${descOn() ? ' checked' : ''}> Show descriptions</label>`}${
    s.png ? '<button class="btn primary" id="png">Export PNG</button>' : ''}`;
  app.innerHTML = `<div class="sheet" id="sheet"><div class="toolbar">${tools}</div>${s.head}<div class="grid">${s.body}</div>${footer(game!)}</div>`;
  document.body.classList.toggle('nodesc', !descOn());
  const box = document.getElementById('desc') as HTMLInputElement | null;
  if (box) box.onchange = () => { setDesc(box.checked); route(true); };
  const png = document.getElementById('png');
  if (png) png.onclick = () => exportPng(png, s.png!);
  hydrate();
}

async function exportPng(btn: HTMLElement, name: string) {
  const sheet = document.getElementById('sheet')!;
  btn.textContent = 'Exporting…';
  sheet.classList.add('exporting'); // fixed 980 px card, toolbar hidden
  try {
    await iconsReady(sheet);
    const url = await toPng(sheet, { pixelRatio: 1, backgroundColor: '#0d0f16' });
    const a = document.createElement('a');
    a.href = url; a.download = `midgard_${name}${descOn() ? '' : '_compact'}.png`; a.click();
  } catch (e) {
    alert('PNG export failed: ' + e);
  } finally {
    sheet.classList.remove('exporting');
    btn.textContent = 'Export PNG';
  }
}

const back = '<a class="btn" href="#/">← Characters</a>';

// ---- routes

async function route(keepScroll = false) {
  const y = window.scrollY;
  planner = null;
  window.onbeforeunload = null;
  if (!game) return;
  try {
    prof = await loadProfile(game);
  } catch (e) {
    return setup(String(e));
  }
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent);
  const o = { desc: descOn() };
  const classes = tbl(game, 'CLASSES');
  if (parts[0] === 'cards') {
    const p = cardsPage(game, prof);
    show({ toolbar: back + p.filters, title: p.title, head: p.head, body: p.body });
    wireCardFilters();
  } else if (parts[0] === 'class' && classes[parts[1]]) {
    const cid = parts[1];
    show({ ...pregamePage(game, prof, cid, o), png: cid,
      toolbar: `${back}<a class="btn" href="#/plan/${encodeURIComponent(cid)}">Plan a build</a>` });
  } else if (parts[0] === 'plan' && classes[parts[1]]) {
    const cid = parts[1];
    const job = Number(prof.rebirths?.[cid] || 0) > 0 ? tbl(game, 'HIGH_NAMES')[cid] ?? nameOf(game, 'CLASSES', cid) : nameOf(game, 'CLASSES', cid);
    show({ toolbar: plannerToolbar(cid, nameOf(game, 'CLASSES', cid)), title: 'Plan a build',
      head: header(game, job, `Plan a build · ${nameOf(game, 'CLASSES', cid)}`, 'Edit, save and compare builds'), body: plannerBody });
    planner = mountPlanner(game, prof, cid, hydrate, (p: Plan) => { location.hash = `#/plancard/${cid}/${encodePlan(p)}`; });
  } else if (parts[0] === 'plancard' && classes[parts[1]]) {
    const cid = parts[1], plan = decodePlan(parts[2] ?? '');
    if (!plan) { location.hash = `#/plan/${cid}`; return; }
    show({ ...pregamePage(game, applyPlan(prof, cid, plan), cid, o, plan), png: 'plan_' + (plan.name || 'build').replace(/[^\w-]+/g, '_'),
      toolbar: `${back}<a class="btn" href="#/plan/${encodeURIComponent(cid)}">Back to planner</a>` });
  } else if (parts[0] === 'run') {
    const live = await latestRun(game);
    liveStamp = live?.stamp ?? 0;
    const note = game.save.live ? '<span class="livedot">Live · updates when the game saves</span>'
      : '<span class="slot">Snapshot of the folder you picked · pick it again to refresh (live updates need Chrome or Edge)</span>';
    if (live) show({ ...runPage(game, live.run, prof, o), png: 'run', toolbar: back + note });
    else show({ toolbar: back + note, title: 'Current session', head: header(game, 'Novice', 'Current session', 'Waiting for the game'),
      body: `<section class="full"><h2>Current session</h2><div class="desc" style="display:block">No run in progress. The game writes its autosave
        about 15 s into a solo stage run (not in town, Training, Tower, co-op, MVP raids or the Morroc event).</div></section>`, descToggle: false });
  } else {
    const live = await latestRun(game);
    liveStamp = live?.stamp ?? 0;
    show({ ...homePage(game, prof, live), descToggle: false,
      toolbar: `<button class="btn" id="folders">Change folders</button>${game.save.live ? '' : ' <span class="slot">Snapshot mode: pick the save folder again to see new progress</span>'}` });
    document.getElementById('folders')!.onclick = () => setup();
  }
  if (keepScroll) window.scrollTo(0, y);
}

function wireCardFilters() {
  const f = ['q', 'type', 'tier', 'own'].map(id => document.getElementById(id) as HTMLInputElement);
  const run = () => {
    let shown = 0;
    document.querySelectorAll<HTMLElement>('.ccard').forEach(c => {
      const ok = c.dataset.name!.includes(f[0].value.toLowerCase()) && (!f[1].value || c.dataset.type === f[1].value)
        && (!f[2].value || c.dataset.tier === f[2].value) && (!f[3].value || c.dataset.own === f[3].value);
      c.hidden = !ok; shown += +ok;
    });
    document.getElementById('shown')!.textContent = String(shown);
  };
  f.forEach(el => el.oninput = run);
  run();
}

window.addEventListener('hashchange', () => {
  if (planner?.isDirty() && !confirm('Leave the planner? Unsaved changes will be lost.')) {
    history.replaceState(null, '', lastHash || '#/');
    return;
  }
  lastHash = location.hash;
  route();
});

// live session: re-render the home or run page when the game writes a new autosave
setInterval(async () => {
  if (!game?.save.live) return;
  const page = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (page && page !== 'run') return;
  const live = await latestRun(game).catch(() => null);
  const stamp = live?.stamp ?? 0;
  if (stamp !== liveStamp) { liveStamp = stamp; route(true); }
}, 3000);

// ---- folder setup

let versionNote = ''; // set when the player's game is another version than the site's data

async function connect(save: Folder) {
  app.innerHTML = '<div class="loading" id="msg">Loading…</div>';
  const msg = (t: string) => { const el = document.getElementById('msg'); if (el) el.textContent = t; };
  try {
    game = await loadBundled(save, msg);
    prof = await loadProfile(game);
    await setLanguage(game, String(prof.settings?.language || 'en'));
    const theirs = await saveFolderVersion(save);
    versionNote = theirs && theirs !== game.version
      ? `This site has data for game v${game.version}; your game is v${theirs}, so new items or skills may show as ids.` : '';
    route();
  } catch (e) {
    game = null;
    setup(e instanceof Error ? e.message : String(e));
  }
}

function setup(error = '') {
  game = null;
  const pickUi = canPickFolders
    ? `<div class="pickrow"><button class="btn primary" id="pick-save">Choose save folder</button><span class="state" id="st-save"></span></div>
       <div class="pickrow" id="reconnect-row" hidden><button class="btn" id="reconnect">Reconnect last folder</button>
         <span class="state">Your browser asks again for access to the folder you picked last time.</span></div>`
    : `<div class="pickrow"><label class="btn primary">Choose save folder<input type="file" id="in-save" webkitdirectory hidden></label><span class="state" id="st-save"></span></div>
       <div class="desc" style="display:block">This browser reads the folder once (a snapshot). Chrome or Edge can remember it and follow your current run live.</div>`;
  document.title = 'Midgard Survivors build viewer';
  app.innerHTML = `<div class="sheet"><header><div><h1>Midgard Survivors build viewer</h1>
    <div class="sub">Characters, card collection, live session and a build planner</div></div></header>
    <div class="grid"><section class="full setup"><h2>Pick your save folder</h2>
      <ol><li><code>~/.local/share/godot/app_userdata/Midgard Survivors</code> on Linux
          (press Ctrl+H in the folder picker to see hidden folders)</li>
        <li><code>%APPDATA%\\Godot\\app_userdata\\Midgard Survivors</code> on Windows</li>
        <li><code>~/Library/Application Support/Godot/app_userdata/Midgard Survivors</code> on macOS</li></ol>
      ${pickUi}
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      <div class="desc" style="display:block;margin-top:12px">Your save is read inside your browser: it never leaves your computer,
        and nothing is ever written to it. The site only reads <code>profile.json</code>, the current run's <code>profile.run</code>
        and <code>patches/state.json</code> (to tell which game version you have).</div>
    </section></div><footer>${esc(appStamp())}</footer></div>`;
  const picked = (f: Folder) => {
    const el = document.getElementById('st-save')!;
    el.textContent = '✓ ' + f.label; el.classList.add('ok');
    connect(f);
  };
  if (canPickFolders) {
    document.getElementById('pick-save')!.onclick = async () => { try { picked(await pickFolder('save')); } catch { /* cancelled */ } };
    rememberedFolder('save', false).then(s => { if (s) document.getElementById('reconnect-row')!.hidden = false; });
    document.getElementById('reconnect')!.onclick = async () => {
      const s = await rememberedFolder('save', true);
      if (s && s !== 'denied') connect(s);
    };
  } else {
    (document.getElementById('in-save') as HTMLInputElement).onchange = e => {
      const files = (e.target as HTMLInputElement).files;
      if (files?.length) picked(listFolder(files));
    };
  }
}

async function start() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('devfolders')) {
    const info = await fetch('/__folders/info').then(r => r.json()).catch(() => ({}));
    if (info.save) return connect(devFolder('save'));
    return setup('Dev folder is not set: start with MIDGARD_SAVE=… npm run dev');
  }
  if (canPickFolders) {
    const s = await rememberedFolder('save', false).catch(() => null);
    if (s && s !== 'denied') return connect(s);
  }
  setup();
}

start();
