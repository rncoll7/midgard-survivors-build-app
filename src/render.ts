// HTML for the pages, ported from midgard_build.py. Icons are <img data-icon="kind/name"> placeholders that
// main.ts fills with the URLs of the extracted game icons (public/game/icons).
import type { Game } from './game';
import { iconKey } from './game';
import type { Plan, Pregame, Sources } from './logic';
import {
  STAT_KEYS, T, cardTiers, classRecords, collectPregame, collectRun, descOf, fmtNum, fmtTime, itemEffect, nameOf,
  pregameSources, runSources, summaryTable, tbl,
} from './logic';

export interface Opts { desc: boolean }

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const ELEMENT_COLORS: Record<string, string> = { fire: '#ff7a3d', water: '#4fb3ff', wind: '#9be15d', earth: '#c99a5b', ghost: '#b59cff',
  holy: '#ffe27a', shadow: '#8a6bb8', poison: '#7fd36b', undead: '#9aa3b5', neutral: '#c9ccd6' };
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;

export const img = (key: string, cls = 'ico') => key ? `<img class="${cls}" data-icon="${esc(key)}" alt="">` : `<span class="${cls} blank"></span>`;

function skillIcon(g: Game, id: string): string {
  const base = id.endsWith('_x') ? id.slice(0, -2) : id;
  return iconKey(g, 'skill_icons', tbl(g, 'SKILLS')[id]?.icon, id, base) || iconKey(g, 'item_icons', id, base);
}
const cardIcon = (g: Game, c: string) => iconKey(g, 'cards', c);
const itemIcon = (g: Game, id: string) => iconKey(g, 'item_icons', tbl(g, 'ITEMS')[id]?.icon, id);

function cardChips(g: Game, ids: string[], eternal = false) {
  return ids.map(c => `<span class="card${eternal ? ' eternal' : ''}">${img(cardIcon(g, c), '')}${esc(nameOf(g, 'CARDS', c))}</span>`).join('');
}

function gearRows(g: Game, gear: { slot: string; id: string; name: string; refine: number; eternal: string[]; cards: string[] }[], o: Opts) {
  return gear.map(r => {
    const cards = cardChips(g, r.eternal, true) + cardChips(g, r.cards);
    const effect = o.desc ? itemEffect(g, r.id) : '';
    return `<div class="row">${img(itemIcon(g, r.id))}<div class="name">${esc(r.name)}${r.refine ? ` <span class="lv">+${r.refine}</span>` : ''}
      <span class="slot">${esc(r.slot)}</span>${effect ? `<div class="desc">${esc(effect)}</div>` : ''}${cards ? `<div class="cards">${cards}</div>` : ''}</div></div>`;
  }).join('');
}

type InfoRow = [icon: string, title: string, desc: string, right: string];
function infoRows(rows: InfoRow[], o: Opts, cls = '') {
  return `<div class="${cls}">${rows.map(([icon, title, desc, right]) =>
    `<div class="row">${icon}<div class="name">${title}${desc && o.desc ? `<div class="desc">${esc(desc)}</div>` : ''}</div>${right}</div>`).join('')}</div>`;
}

function cardLegend(g: Game, groups: string[][], o: Opts) {
  if (!o.desc) return '';
  const counts = new Map<string, number>();
  for (const ids of groups) for (const c of ids) counts.set(c, (counts.get(c) ?? 0) + 1);
  const rows: InfoRow[] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c, n]) =>
    [`<span class="cardthumb">${img(cardIcon(g, c), '')}</span>`, esc(nameOf(g, 'CARDS', c)) + (n > 1 ? ` <span class="lv">×${n}</span>` : ''), descOf(g, 'CARDS', c), '']);
  return rows.length ? infoRows(rows, o, 'cols2') : '';
}

export function header(g: Game, job: string, title: string, sub: string, tag = '') {
  const jid = tbl(g, 'JOB_ICON_IDS')[job];
  return `<header>${img(jid != null ? iconKey(g, 'job_icons', jid) : '', 'job')}<div><h1>${esc(title)}</h1><div class="sub">${sub}</div></div><div class="tag">${tag}</div></header>`;
}

function statTiles(stats: [string, number, number?][]) {
  return `<div class="stats">${stats.map(([k, v, pt]) => `<div class="stat"><span>${k.toUpperCase()}</span><b>${v}</b>${pt ? `<i>+${pt} class</i>` : ''}</div>`).join('')}</div>`;
}

function recordTiles(r: ReturnType<typeof classRecords>) {
  const tiles: [string, string, string][] = [
    ['Best run level', r.bestLevel ? String(r.bestLevel) : '-', `last 50 runs · account best ${r.accountLevel}`],
    ['Endless Tower', r.towerFloor ? `Floor ${r.towerFloor}` : '-', 'best floor reached'],
    ['Runs', String(r.runs), 'with this class'],
    ['Longest run', r.longest ? fmtTime(r.longest) : '-', 'survival time']];
  return `<div class="stats" style="grid-template-columns:repeat(4,1fr)">${tiles.map(([a, b, c]) =>
    `<div class="stat"><span>${esc(a)}</span><b>${b}</b><i style="color:#8f97b8">${esc(c)}</i></div>`).join('')}</div>`;
}

export function summaryHtml(g: Game, sources: Sources) {
  const [cols, rows] = summaryTable(g, sources);
  if (!rows.length) return `<div class="desc">${esc(T(g, 'Tu equipo, tus cartas y tus platos aún no dan bonos.'))}</div>`;
  const cell = (v: string) => `<td class="${v === '·' ? 'nil' : v.startsWith('-') ? 'neg' : 'pos'}">${esc(v)}</td>`;
  return `<table class="sum"><tr><th></th>${cols.map(c => `<th>${esc(c)}</th>`).join('')}<th class="tot">${esc(T(g, 'Total'))}</th></tr>${
    rows.map(([l, v, t]) => `<tr><th class="lab">${esc(l)}</th>${v.map(cell).join('')}<td class="tot">${esc(t)}</td></tr>`).join('')}</table>
    <div class="desc" style="margin-top:6px;display:block">${esc(T(g, 'Tus atributos, tus habilidades y lo que ganes durante la partida suman aparte.'))}</div>`;
}

/** The site's own build: stamped in UTC by vite.config.ts and shown in the viewer's time zone. */
export const appStamp = () => `app ${__BUILD__.version} · ${new Date(__BUILD__.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`;

export function footer(g: Game) {
  return `<footer>Midgard Survivors v${esc(g.version)} · build card · ${new Date().toLocaleString()}<br>${esc(appStamp())}</footer>`;
}

// ---- pages

export function runPage(g: Game, run: any, prof: any | null, o: Opts) {
  const b = collectRun(g, run);
  const elDot = (e: string) => e ? `<span class="el" style="background:${ELEMENT_COLORS[e] ?? '#888'}"></span>${cap(e)}` : '';
  const skills = infoRows(b.skills.map(s => [img(skillIcon(g, s.id)), `${esc(s.name)} <span class="slot">${elDot(s.element)}</span>`,
    descOf(g, 'SKILLS', s.id), `${s.tag ? `<span class="pill ${s.tag === 'EVOLVED' ? 'evo' : 'max'}">${s.tag}</span>` : ''}<span class="lv">Lv ${s.level}</span>`]), o);
  const passives = infoRows(b.passives.map(s => [img(skillIcon(g, s.id)), esc(s.name), descOf(g, 'SKILLS', s.id), `<span class="lv">Lv ${s.level}</span>`]), o);
  const evos = b.evolutions.map(e => `<div class="row">${img(skillIcon(g, e.from))}<div class="name">${esc(e.fromName)} → ${esc(e.toName)}
    <div class="desc" style="display:block">${e.ready ? '' : esc(e.state)}</div></div>${e.ready ? '<span class="pill ready">READY</span>' : ''}</div>`).join('')
    || '<div class="row">Nothing left to evolve</div>';
  const combos = b.elements.length >= 2 ? `<div class="row"><div class="name">${b.elements.map(e =>
    `<span class="pill"><span class="el" style="background:${ELEMENT_COLORS[e]}"></span>${cap(e)}</span>`).join(' ')}
    <div class="desc" style="display:block">combos: ${b.combos.join(', ')}</div></div></div>` : '';
  const dmg = b.damage.map(r => `<div class="row"><div class="name">${esc(r.label)}<div class="bar"><i style="width:${r.pct.toFixed(1)}%"></i></div></div>
    <span class="lv">${r.pct.toFixed(1)}%</span><small style="color:#8f97b8;width:120px;text-align:right">${fmtNum(r.dmg)} · max ${fmtNum(r.max)}</small></div>`).join('');
  const legend = cardLegend(g, b.gear.map(r => [...r.eternal, ...r.cards]), o);
  const body = `<section class="full"><h2>Skills <b>${b.skills.length}</b></h2>${skills}</section>
    <section><h2>Passives <b>${b.passives.length}</b></h2>${passives}</section>
    <section><h2>Evolutions</h2>${evos}${combos}</section>
    ${b.stats.length ? `<section class="full"><h2>Stats</h2>${statTiles(b.stats)}</section>` : ''}
    <section><h2>Equipment</h2>${gearRows(g, b.gear, o)}</section>
    ${b.damage.length ? `<section><h2>Damage <b>${fmtNum(b.total)}</b> · ${fmtNum(b.dps)} DPS</h2>${dmg}</section>` : ''}
    ${legend ? `<section class="full"><h2>Card effects</h2>${legend}</section>` : ''}
    <section class="full"><h2>Bonus summary</h2>${summaryHtml(g, runSources(g, run, prof))}</section>`;
  const sub = `Lv ${b.level} · ${esc(cap(String(b.stage)))} (danger ${b.danger}) · ${fmtTime(b.time)} · ${fmtNum(b.kills)} kills`;
  return { title: b.job + ' build', head: header(g, b.job, b.job, sub, `HP ${fmtNum(b.hp)}<br>saved ${esc(b.saved)}`), body };
}

export function pregamePage(g: Game, prof: any, cid: string, o: Opts, plan?: Plan) {
  const b: Pregame = collectPregame(g, prof, cid);
  const album = b.album.map(c => `<figure>${img(cardIcon(g, c), '')}${esc(nameOf(g, 'CARDS', c))}</figure>`).join('') || '-';
  const petDesc = o.desc ? T(g, tbl(g, 'PETS')[b.pet]?.desc ?? '') : '';
  const pet = `<div class="pet">${img(cardIcon(g, b.pet + '_card'), '')}<div><b>${esc(b.petName || '-')}</b><div class="desc">${esc(petDesc)}</div></div></div>`;
  const dishes = infoRows(b.dishes.map(d => [img(iconKey(g, 'item_icons', tbl(g, 'RECIPES')[d]?.icon, d)), esc(nameOf(g, 'RECIPES', d)), descOf(g, 'RECIPES', d), '']), o);
  const pacts = infoRows(b.pacts.map(x => [img(iconKey(g, 'skill_icons', tbl(g, 'PACTS')[x]?.icon, x)), esc(nameOf(g, 'PACTS', x)), descOf(g, 'PACTS', x), '']), o);
  const order = b.order.map((r, n) => `<div class="row${r.banned ? ' banned' : ''}"><span class="n">${n + 1}</span>
    ${r.stat ? `<span class="ico statb">${esc(r.id.toUpperCase())}</span>` : img(skillIcon(g, r.id))}<div class="name">${esc(r.label)}</div>
    ${r.cap > 0 ? `<span class="pill">≤ Lv ${r.cap}</span>` : ''}</div>`).join('');
  let extra = '';
  if (b.alsoBanned.length) extra += `<div class="row"><small style="color:#8f97b8">Also banned: ${esc(b.alsoBanned.join(', '))}</small></div>`;
  if (b.favs.length) extra += `<div class="row"><small style="color:#8f97b8">Favorites: ${esc(b.favs.join(', '))}</small></div>`;
  const upIcon = (id: string) => img(iconKey(g, 'item_icons', id) || iconKey(g, 'skill_icons', id));
  const upgrades = (rows: Pregame['kafra'], table: string) => !rows.length ? '-' : o.desc
    ? infoRows(rows.map(u => [upIcon(u.id), esc(u.name) + (u.off ? ' <span class="pill off">OFF</span>' : ''), descOf(g, table, u.id),
        `<span class="lv">${u.lv}/${u.max}</span>`]), o, 'cols2')
    : `<div class="chips">${rows.map(u => `<span class="chip${u.off ? ' off' : ''}">${upIcon(u.id)}${esc(u.name)} <b class="lv">${u.lv}/${u.max}</b></span>`).join('')}</div>`;
  const legend = cardLegend(g, [...b.gear.map(r => [...r.eternal, ...r.cards]), b.album], o);
  const notes = plan?.notes?.trim();
  const body = `${notes ? `<section class="full"><h2>Notes</h2><div style="white-space:pre-wrap">${esc(notes)}</div></section>` : ''}
    <section class="full"><h2>Records</h2>${recordTiles(b.records)}</section>
    <section class="full"><h2>Start stats</h2>${statTiles(b.stats)}</section>
    <section><h2>Starting gear <b>${b.gear.length}</b> · gold border = eternal card</h2>${gearRows(g, b.gear, o)}</section>
    <section><h2>Pet</h2>${pet}<h2 style="margin-top:14px">Dishes</h2>${dishes || '-'}<h2 style="margin-top:14px">Pacts <b>${b.pacts.length}/3</b></h2>${pacts || '-'}</section>
    <section class="full"><h2>Album cards <b>${b.album.length}/${b.albumSlots}</b></h2><div class="album">${album}</div>
      ${legend ? `<h2 style="margin-top:14px">Card effects · gear and album</h2>${legend}` : ''}</section>
    <section class="full"><h2>Auto-pick priority · <b>${b.bansUsed}/${b.bansMax}</b> Holy Water bans used${b.fill ? ' · new skills first, then evolutions' : ''}</h2>
      <div class="order">${order || '<div class="row">No order set</div>'}</div>${extra}</section>
    <section class="full"><h2>Kafra upgrades</h2>${upgrades(b.kafra, 'UPGRADES')}</section>
    <section class="full"><h2>Sage arts</h2>${upgrades(b.sage, 'SAGE_UPGRADES')}</section>
    <section class="full"><h2>Bonus summary</h2>${summaryHtml(g, pregameSources(g, prof, cid, b))}</section>`;
  let title = `${b.reborn ? 'Reborn ' : ''}${b.className}`;
  let sub = `Pre-run setup · class Lv ${b.level}${b.rlv ? ` · rebirth Lv ${b.rlv}` : ''}`;
  if (plan) { sub = `Planned build · ${title} · class Lv ${b.level}`; title = plan.name || 'Planned build'; }
  return { title, head: header(g, b.job, title, sub), body };
}

export function homePage(g: Game, prof: any, live: { run: any } | null) {
  const history = (prof.history ?? []).filter((h: any) => h && typeof h === 'object');
  let session: string;
  if (live) {
    const r = live.run, jid = tbl(g, 'JOB_ICON_IDS')[String(r.name)];
    session = `<a class="tile" href="#/run">${img(jid != null ? iconKey(g, 'job_icons', jid) : '', 'job')}<div><b>${esc(r.name)} · Lv ${esc(r.level)}</b>
      <span class="livedot">Live · ${esc(cap(String(r.stage ?? '')))} · ${fmtTime(Number(r.time || 0))} · ${fmtNum(Number(r.kills || 0))} kills</span></div></a>`;
  } else {
    session = `<a class="tile" href="#/run"><div><b>No run in progress</b><div class="desc" style="display:block">Start a solo stage:
      the game writes its autosave about 15 s in.</div></div></a>`;
  }
  const cards = tbl(g, 'CARDS');
  const owned = Object.keys(cards).filter(c => prof.cards?.[c] || prof.eternal?.[c]).length;
  const tiles = Object.keys(tbl(g, 'CLASSES')).map(cid => {
    const prog = prof.classes?.[cid];
    const reborn = Number(prof.rebirths?.[cid] || 0) > 0;
    const name = nameOf(g, 'CLASSES', cid);
    const job = reborn ? (tbl(g, 'HIGH_NAMES')[cid] ?? name) : name;
    const jid = tbl(g, 'JOB_ICON_IDS')[job];
    const runs = history.filter((h: any) => h.class === cid);
    const last = Math.max(0, ...runs.map((h: any) => Number(h.at || 0)));
    let info = prog ? `Class Lv ${prog.level ?? 1}${prog.rlv ? ` · rebirth Lv ${prog.rlv}` : ''}` : 'Not played yet';
    const rec = classRecords(prof, cid);
    if (rec.bestLevel || rec.towerFloor) info += `<br>Best Lv ${rec.bestLevel || '-'} · Tower floor ${rec.towerFloor || '-'}`;
    if (runs.length) info += `<br>last played ${new Date(last * 1000).toISOString().slice(0, 10)}`;
    return [-last, `<a class="tile${prog ? '' : ' dim'}" href="#/class/${encodeURIComponent(cid)}">${img(jid != null ? iconKey(g, 'job_icons', jid) : '', 'job')}
      <div><b>${reborn ? 'Reborn ' : ''}${esc(name)}</b><span class="slot">${info}</span></div></a>`] as [number, string];
  }).sort((a, b) => a[0] - b[0]).map(t => t[1]).join('');
  const body = `<section><h2>Current session</h2>${session}</section>
    <section><h2>Collection</h2><a class="tile" href="#/cards"><div><b>Card collection</b><span class="slot">${owned} / ${Object.keys(cards).length} cards collected</span></div></a></section>
    <section class="full"><h2>Characters</h2><div class="tiles">${tiles}</div></section>`;
  return { title: 'Midgard Survivors', head: header(g, 'Novice', 'Midgard Survivors', 'Characters, cards and your current session',
    `Game version<br><b style="color:#f4d77d;font-size:16px">v${esc(g.version)}</b>`), body };
}

export function cardsPage(g: Game, prof: any) {
  const cards = tbl(g, 'CARDS'), tiers = cardTiers(g);
  const owned = Object.keys(cards).filter(c => prof.cards?.[c] || prof.eternal?.[c]).length;
  const rows = Object.keys(cards).sort((a, b) => String(cards[a].type ?? '').localeCompare(String(cards[b].type ?? '')) || nameOf(g, 'CARDS', a).localeCompare(nameOf(g, 'CARDS', b)))
    .map(c => {
      const a = Number(prof.cards?.[c] || 0), e = Number(prof.eternal?.[c] || 0), typ = String(cards[c].type ?? ''), tier = tiers[c] ?? 'normal';
      const meta = [a ? `<span class="own">album ×${a}</span>` : '', e ? `<span class="ete">eternal ×${e}</span>` : '', typ, tier !== 'normal' ? tier.toUpperCase() : ''].filter(Boolean);
      const key = cardIcon(g, c);
      return `<div class="ccard${a || e ? '' : ' miss'}" data-name="${esc(nameOf(g, 'CARDS', c).toLowerCase())}" data-type="${esc(typ)}" data-tier="${tier}" data-own="${a || e ? 'yes' : 'no'}">
        ${key ? img(key, '') : '<span class="noart">?</span>'}<div><b>${esc(nameOf(g, 'CARDS', c))}</b><div class="meta">${meta.join(' · ')}</div>
        <div class="desc">${esc(descOf(g, 'CARDS', c))}</div></div></div>`;
    }).join('');
  const types = [...new Set(Object.values<any>(cards).map(d => String(d.type ?? '')).filter(Boolean))].sort();
  const opts = (vals: [string, string][]) => vals.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  const filters = `<input type="search" id="q" placeholder="Search cards"><select id="type">${opts([['', 'All slots'], ...types.map(t => [t, cap(t)] as [string, string])])}</select>
    <select id="tier">${opts([['', 'All monsters'], ['mvp', 'MVP'], ['boss', 'Boss'], ['normal', 'Normal']])}</select>
    <select id="own">${opts([['', 'Owned and missing'], ['yes', 'Owned'], ['no', 'Missing']])}</select><span class="slot"><span id="shown"></span> shown</span>`;
  return { title: 'Card collection', filters,
    head: header(g, 'Novice', 'Card collection', `${owned} of ${Object.keys(cards).length} cards collected`),
    body: `<section class="full"><h2>Cards <b>${owned} / ${Object.keys(cards).length}</b> collected</h2><div class="cgrid">${rows}</div></section>` };
}

export const statKeys = STAT_KEYS;
