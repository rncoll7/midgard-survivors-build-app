// Build planner: edit a build starting from the current setup; builds are saved in this browser's localStorage.
// The game save is never written.
import type { Game } from './game';
import { iconKey } from './game';
import type { Plan } from './logic';
import { STAT_KEYS, applyPlan, classTreeIds, collectPregame, currentPlan, descOf, itemEffect, nameOf, pregameSources, tbl } from './logic';
import { esc, img, summaryHtml } from './render';

const STORE = 'midgard_build_plans';
const FREE_SLOTS = ['mid', 'low', 'wings', 'soul'];

export const loadPlans = (): Plan[] => { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; } };
const savePlans = (list: Plan[]) => {
  try { localStorage.setItem(STORE, JSON.stringify(list)); return true; } catch (e) { alert('Could not save in this browser: ' + e); return false; }
};
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

export const encodePlan = (p: Plan) => btoa(unescape(encodeURIComponent(JSON.stringify(p)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function decodePlan(s: string): Plan | null {
  try { return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return null; }
}

interface Opt { id: string; name: string; icon: string; desc: string }

function catalog(g: Game, prof: any, cid: string) {
  const b = collectPregame(g, prof, cid);
  const current = currentPlan(prof, cid, b);
  const opt = (t: string, id: string, icon: string): Opt => ({ id, name: nameOf(g, t, id), icon, desc: descOf(g, t, id) });
  const gear: Record<string, Opt[]> = {};
  for (const it of prof.storage ?? []) {
    const d = tbl(g, 'ITEMS')[it.id] ?? {};
    if (!d.slot || (d.slot === 'weapon' && (d.class ?? cid) !== cid)) continue;
    const ete = (it.eternal ?? []).map((c: string) => nameOf(g, 'CARDS', c));
    const name = `${nameOf(g, 'ITEMS', it.id)}${it.refine ? ' +' + Math.floor(it.refine) : ''}${ete.length ? '  [' + ete.join(', ') + ']' : ''}`;
    for (const slot of d.slot === 'acc' ? ['acc1', 'acc2'] : [d.slot])
      (gear[slot] ??= []).push({ id: String(it.uid), name, icon: iconKey(g, 'item_icons', d.icon, it.id), desc: itemEffect(g, it.id) });
  }
  for (const v of Object.values(gear)) v.sort((a, b) => a.name.localeCompare(b.name));
  const skillIcon = (id: string) => iconKey(g, 'skill_icons', tbl(g, 'SKILLS')[id]?.icon, id, id.replace(/_x$/, '')) || iconKey(g, 'item_icons', id);
  const tree = [...new Set([...current.order, ...classTreeIds(tbl(g, 'CLASSES')[cid]), ...STAT_KEYS])]
    .filter(i => STAT_KEYS.includes(i) || tbl(g, 'SKILLS')[i]);
  return {
    b, current,
    limits: { holy: b.bansMax, favs: 2, pacts: 3, dishes: Number(prof.cook_level || 1), album: b.albumSlots,
      pieces: 2 + ((prof.settings?.upgrades_off ?? []).includes('kafra_cart') ? 0 : Number(prof.upgrades?.kafra_cart || 0)) },
    slots: (g.G.EQUIP_SLOTS as string[]).filter(s => gear[s] || current.gear[s]),
    base: Object.fromEntries(b.stats.map(([k, v, pt]) => [k, v - pt])) as Record<string, number>,
    pets: Object.entries<any>(prof.pets ?? {}).filter(([i, on]) => on && tbl(g, 'PETS')[i])
      .map(([i]) => opt('PETS', i, iconKey(g, 'cards', i + '_card'))).sort((a, b) => a.name.localeCompare(b.name)),
    recipes: Object.keys(tbl(g, 'RECIPES')).map(i => opt('RECIPES', i, iconKey(g, 'item_icons', tbl(g, 'RECIPES')[i].icon, i))),
    pacts: Object.keys(tbl(g, 'PACTS')).map(i => opt('PACTS', i, iconKey(g, 'skill_icons', tbl(g, 'PACTS')[i].icon, i))),
    cards: Object.keys(tbl(g, 'CARDS')).filter(c => prof.cards?.[c] || prof.eternal?.[c])
      .map(c => opt('CARDS', c, iconKey(g, 'cards', c))).sort((a, b) => a.name.localeCompare(b.name)),
    gear,
    pool: tree.map(i => ({ id: i, stat: STAT_KEYS.includes(i), name: STAT_KEYS.includes(i) ? i.toUpperCase() : nameOf(g, 'SKILLS', i),
      icon: STAT_KEYS.includes(i) ? '' : skillIcon(i), desc: '' })),
  };
}

export const plannerToolbar = (cid: string, className: string) => `<a class="btn" href="#/class/${encodeURIComponent(cid)}">← ${esc(className)}</a>
  <select id="plans"></select><button class="btn" id="new">New from current</button><button class="btn" id="dup">Duplicate</button>
  <button class="btn" id="del">Delete</button><button class="btn primary" id="save">Save</button><span id="dirty"></span><span class="sp"></span>
  <button class="btn" id="card">Open card</button><button class="btn" id="exportjson">Export file</button>
  <label class="btn" style="padding:7px 13px">Import file<input type="file" id="importjson" accept=".json" hidden></label>`;

export const plannerBody = `
  <section class="full pl"><h2>Build</h2><label class="f">Name</label><input type="text" id="name">
    <label class="f">Notes</label><textarea id="notes" placeholder="Level-up order, tips, when to evolve…"></textarea>
    <div class="desc" style="margin-top:6px;display:block">Saved builds stay in this browser only (localStorage). The game save is never
    changed: set the build up in the game yourself.</div></section>
  <section class="full pl"><h2>Class stat points</h2><div class="stats" id="stats"></div><div id="statcount" style="margin-top:6px"></div></section>
  <section class="pl"><h2>Pet</h2><div id="pet"></div><h2 style="margin-top:12px">Dishes</h2><div id="dishes"></div>
    <h2 style="margin-top:12px">Pacts</h2><div id="pacts"></div></section>
  <section class="pl"><h2>Album cards</h2><div id="album"></div></section>
  <section class="full pl"><h2>Starting gear · <span id="gearcount"></span></h2><div class="cols2" id="gear"></div></section>
  <section class="full pl"><h2>Auto-pick priority · <span id="bancount"></span></h2>
    <div class="desc" style="margin-bottom:6px;display:block">Cap = stop picking it after that level. ★ favorite (offered twice as often, max 2).
    ⊘ ban (spends one Holy Water at the start of the run).</div><div class="ord" id="order"></div></section>
  <section class="full pl"><h2>Changes from your current setup</h2><div class="diff" id="diff"></div></section>
  <section class="full pl"><h2>Bonus summary</h2><div id="summary"></div></section>`;

/** Wire up the planner inside an already rendered page. `hydrate` loads icons for newly added <img data-icon>. */
export function mountPlanner(g: Game, prof: any, cid: string, hydrate: (root: ParentNode) => void, openCard: (p: Plan) => void) {
  const CAT = catalog(g, prof, cid);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
  const mine = () => loadPlans().filter(p => p.cid === cid).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  let plan: Plan, dirty = false;

  const fresh = (from?: Plan): Plan => {
    const p = clone(from ?? CAT.current);
    p.id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    p.cid = cid; p.name = from ? (from.name || 'Build') + ' (copy)' : 'New build'; p.updated = Date.now();
    for (const s of CAT.pool) if (!p.order.includes(s.id)) p.order.push(s.id);
    return p;
  };
  const pickList = () => {
    const list = mine();
    $<HTMLSelectElement>('#plans').innerHTML = list.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('') || '<option value="">No saved builds yet</option>';
    if (plan && list.some(p => p.id === plan.id)) $<HTMLSelectElement>('#plans').value = plan.id!;
  };
  const setDirty = (v: boolean) => { dirty = v; $('#dirty').textContent = v ? 'Unsaved changes' : ''; };
  const changed = () => { setDirty(true); summary(); diff(); counts(); };
  const byId = (list: Opt[], id: string) => list.find(x => x.id === id);

  function picker(list: Opt[], value: string, onPick: (v: string) => void, art = false) {
    const box = document.createElement('div');
    const cur = byId(list, value);
    box.innerHTML = `<div class="pick">${cur?.icon ? img(cur.icon, art ? 'card-art' : '') : '<span class="ph"></span>'}
      <select><option value="">— none —</option>${list.map(x => `<option value="${esc(x.id)}"${x.id === value ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="desc" style="margin:-2px 0 6px 36px">${esc(cur?.desc ?? '')}</div>`;
    box.querySelector('select')!.onchange = e => onPick((e.target as HTMLSelectElement).value);
    return box;
  }
  function multi(el: HTMLElement, list: Opt[], values: string[], max: number, art = false) {
    el.innerHTML = '';
    for (let i = 0; i < max; i++) el.append(picker(list, values[i] || '', v => {
      values[i] = v; while (values.length && !values[values.length - 1]) values.pop(); render(); changed();
    }, art));
  }

  function render() {
    $<HTMLInputElement>('#name').value = plan.name || '';
    $<HTMLTextAreaElement>('#notes').value = plan.notes || '';
    $('#stats').innerHTML = STAT_KEYS.map(k => `<div class="stat"><span>${k.toUpperCase()}</span>
      <input type="number" min="0" max="999" data-k="${k}" value="${plan.stats[k] || 0}"><i>start ${CAT.base[k] + (plan.stats[k] || 0)}</i></div>`).join('');
    $('#stats').querySelectorAll<HTMLInputElement>('input').forEach(inp => inp.oninput = () => {
      const k = inp.dataset.k!;
      plan.stats[k] = Math.max(0, parseInt(inp.value || '0', 10) || 0);
      inp.nextElementSibling!.textContent = 'start ' + (CAT.base[k] + plan.stats[k]);
      changed();
    });
    $('#pet').innerHTML = ''; $('#pet').append(picker(CAT.pets, plan.pet, v => { plan.pet = v; render(); changed(); }, true));
    multi($('#dishes'), CAT.recipes, plan.dishes, CAT.limits.dishes);
    multi($('#pacts'), CAT.pacts, plan.pacts, CAT.limits.pacts);
    multi($('#album'), CAT.cards, plan.album, CAT.limits.album, true);
    const gear = $('#gear'); gear.innerHTML = '';
    for (const slot of CAT.slots) {
      const lab = document.createElement('label'); lab.className = 'f';
      lab.textContent = slot + (FREE_SLOTS.includes(slot) ? ' · free slot' : '');
      gear.append(lab, picker(CAT.gear[slot] ?? [], plan.gear[slot] || '', v => { if (v) plan.gear[slot] = v; else delete plan.gear[slot]; render(); changed(); }));
    }
    order(); counts(); summary(); diff();
    hydrate(document);
  }

  function order() {
    const el = $('#order'); el.innerHTML = '';
    plan.order.forEach((id, i) => {
      const s = CAT.pool.find(p => p.id === id) ?? { id, name: id, stat: false, icon: '' };
      const key = (s.stat ? 'stat:' : 'skill:') + id;
      const banned = plan.bans.includes(key), fav = plan.favs.includes(key);
      const row = document.createElement('div'); row.className = 'row' + (banned ? ' banned' : '');
      row.innerHTML = `<span class="n">${i + 1}</span>${s.stat ? `<span class="ico statb">${esc(id.toUpperCase())}</span>` : img(s.icon)}
        <div class="name">${esc(s.name)}</div>
        <input type="number" min="0" placeholder="no cap" title="Stop picking it after this level" value="${plan.caps[id] || ''}">
        <button class="mini" title="Move up">↑</button><button class="mini" title="Move down">↓</button>
        <button class="mini${fav ? ' on' : ''}" title="Favorite: offered twice as often">★</button>
        <button class="mini ban${banned ? ' on' : ''}" title="Ban (uses one Holy Water)">⊘</button>`;
      const cap = row.querySelector('input')!, [up, down, star, ban] = row.querySelectorAll('button');
      cap.oninput = () => { const v = parseInt(cap.value || '0', 10); if (v > 0) plan.caps[id] = v; else delete plan.caps[id]; changed(); };
      const swap = (j: number) => { [plan.order[j], plan.order[i]] = [plan.order[i], plan.order[j]]; order(); changed(); };
      up.onclick = () => { if (i > 0) swap(i - 1); };
      down.onclick = () => { if (i < plan.order.length - 1) swap(i + 1); };
      star.onclick = () => { plan.favs = fav ? plan.favs.filter(x => x !== key) : [...plan.favs, key]; order(); changed(); };
      ban.onclick = () => { plan.bans = banned ? plan.bans.filter(x => x !== key) : [...plan.bans, key]; order(); changed(); };
      el.append(row);
    });
    hydrate(el);
  }

  function counts() {
    const line = (n: number, max: number, what: string) =>
      `<span class="${n > max ? 'warn' : 'ok'}">${n}/${max} ${what}${n > max ? ' — over the limit, the game will not take the extra ones' : ''}</span>`;
    const pieces = Object.keys(plan.gear).filter(s => !FREE_SLOTS.includes(s)).length;
    $('#gearcount').innerHTML = line(pieces, CAT.limits.pieces, 'pieces');
    $('#bancount').innerHTML = line(plan.bans.length, CAT.limits.holy, 'Holy Water bans') + ' · ' + line(plan.favs.length, CAT.limits.favs, 'favorites');
    const used = Object.values(plan.stats).reduce((a, b) => a + (b || 0), 0);
    const now = Object.values(CAT.current.stats).reduce((a, b) => a + b, 0);
    $('#statcount').innerHTML = `<span class="${used > now ? 'warn' : 'ok'}">${used} class points used · current setup uses ${now}${used > now ? ' — more than you have spent now' : ''}</span>`;
  }

  let timer = 0;
  function summary() {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const pp = applyPlan(prof, cid, plan);
      $('#summary').innerHTML = summaryHtml(g, pregameSources(g, pp, cid, collectPregame(g, pp, cid)));
    }, 150);
  }

  function diff() {
    const c = CAT.current, out: string[] = [];
    const nm = (list: Opt[], id: string) => byId(list, id)?.name ?? (id || '—');
    const setDiff = (label: string, list: Opt[], a: string[], b: string[]) => {
      const plus = b.filter(x => x && !a.includes(x)), minus = a.filter(x => x && !b.includes(x));
      if (plus.length || minus.length) out.push(`${label}: ${[...plus.map(x => '+ ' + esc(nm(list, x))), ...minus.map(x => '− ' + esc(nm(list, x)))].join(', ')}`);
    };
    for (const k of STAT_KEYS) if ((plan.stats[k] || 0) !== (c.stats[k] || 0)) out.push(`${k.toUpperCase()} points: ${c.stats[k] || 0} → ${plan.stats[k] || 0}`);
    if (plan.pet !== c.pet) out.push(`Pet: ${esc(nm(CAT.pets, c.pet))} → ${esc(nm(CAT.pets, plan.pet))}`);
    setDiff('Dishes', CAT.recipes, c.dishes, plan.dishes);
    setDiff('Pacts', CAT.pacts, c.pacts, plan.pacts);
    setDiff('Album', CAT.cards, c.album, plan.album);
    for (const slot of CAT.slots) if ((plan.gear[slot] || '') !== (c.gear[slot] || ''))
      out.push(`${slot}: ${esc(nm(CAT.gear[slot] ?? [], c.gear[slot] || ''))} → ${esc(nm(CAT.gear[slot] ?? [], plan.gear[slot] || ''))}`);
    const newBans = (a: string[], b: string[]) => b.filter(x => !a.includes(x)).map(x => x.split(':')[1]);
    const label = (id: string) => esc(CAT.pool.find(p => p.id === id)?.name ?? id);
    if (newBans(c.bans, plan.bans).length) out.push('New bans: ' + newBans(c.bans, plan.bans).map(label).join(', '));
    if (newBans(plan.bans, c.bans).length) out.push('Unbanned: ' + newBans(plan.bans, c.bans).map(label).join(', '));
    const top = (l: string[]) => l.filter(x => CAT.pool.some(p => p.id === x)).slice(0, 12).join();
    if (top(plan.order) !== top(c.order)) out.push('Auto-pick order changed');
    $('#diff').innerHTML = out.length ? '<ul>' + out.map(x => `<li>${x}</li>`).join('') + '</ul>' : '<div class="desc" style="display:block">Same as your current setup.</div>';
  }

  function openPlan(p: Plan) {
    plan = p;
    plan.stats ??= {}; plan.gear ??= {}; plan.caps ??= {};
    for (const k of ['album', 'dishes', 'pacts', 'order', 'bans', 'favs'] as const) plan[k] ??= [];
    render(); pickList(); setDirty(false);
  }

  $<HTMLInputElement>('#name').oninput = e => { plan.name = (e.target as HTMLInputElement).value; changed(); };
  $<HTMLTextAreaElement>('#notes').oninput = e => { plan.notes = (e.target as HTMLTextAreaElement).value; changed(); };
  $<HTMLSelectElement>('#plans').onchange = e => {
    if (dirty && !confirm('Discard unsaved changes?')) { pickList(); return; }
    const p = mine().find(x => x.id === (e.target as HTMLSelectElement).value);
    if (p) openPlan(clone(p));
  };
  $('#new').onclick = () => { if (dirty && !confirm('Discard unsaved changes?')) return; openPlan(fresh()); setDirty(true); };
  $('#dup').onclick = () => { openPlan(fresh(plan)); setDirty(true); };
  $('#save').onclick = () => {
    plan.updated = Date.now(); plan.cid = cid;
    if (savePlans([...loadPlans().filter(p => p.id !== plan.id), clone(plan)])) { setDirty(false); pickList(); }
  };
  $('#del').onclick = () => {
    if (!mine().some(p => p.id === plan.id)) { openPlan(fresh()); return; }
    if (!confirm(`Delete "${plan.name}" from this browser?`)) return;
    savePlans(loadPlans().filter(p => p.id !== plan.id));
    const left = mine(); openPlan(left.length ? clone(left[0]) : fresh());
  };
  $('#card').onclick = () => openCard(plan);
  $('#exportjson').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 1)], { type: 'application/json' }));
    a.download = (plan.name || 'build').replace(/[^\w-]+/g, '_') + '.json'; a.click();
  };
  $<HTMLInputElement>('#importjson').onchange = async e => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      if (p.cid && p.cid !== cid) { alert(`That build is for ${p.cid}.`); return; }
      openPlan(Object.assign(fresh(p), { name: p.name || 'Imported build' })); setDirty(true);
    } catch (err) { alert('Not a build file: ' + err); }
  };
  window.onbeforeunload = ev => { if (dirty) { ev.preventDefault(); return ''; } };
  const saved = mine();
  openPlan(saved.length ? clone(saved[0]) : fresh());
  if (!saved.length) setDirty(true);
  return { isDirty: () => dirty };
}
