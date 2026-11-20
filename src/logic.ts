// Build logic ported from midgard_build.py: what a run or a pre-run setup contains, the game's Bonus summary
// (scripts/ui/bonus_summary.gd), class records and planned builds.
import type { Game } from './game';

export const STAT_KEYS = ['str', 'agi', 'vit', 'int', 'dex', 'luk'];
export const MAX_SKILL_LEVEL = 5;
const COMBOS: Record<string, string> = {
  'fire,water': 'Vapor', 'water,wind': 'Electrocution', 'fire,wind': 'Blaze',
  'earth,fire': 'Lava', 'earth,water': 'Mud', 'earth,wind': 'Sand',
};

export const T = (g: Game, text: unknown) => { const s = String(text ?? ''); return g.tr[s] ?? s; };
export const tbl = (g: Game, t: string): Record<string, any> => g.G[t] ?? {};
export const nameOf = (g: Game, t: string, id: string) => T(g, tbl(g, t)[id]?.name ?? id);
export const descOf = (g: Game, t: string, id: string) => T(g, tbl(g, t)[id]?.desc ?? '');

export function fmtTime(s: number) { s = Math.floor(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
export function fmtNum(x: number) {
  for (const [u, d] of [['B', 1e9], ['M', 1e6], ['k', 1e3]] as const) if (x >= d) return (x / d).toFixed(1) + u;
  return String(Math.floor(x));
}

// item/card mod keys -> (label, shown as percent, sign flipped)
const MOD_LABELS: Record<string, [string, boolean, boolean]> = {
  dmg: ['damage', true, false], skill_dmg: ['skill damage', true, false], haste: ['cooldown', true, true],
  area: ['area', true, false], count: ['projectiles', false, false], max_hp_pct: ['max HP', true, false],
  armor: ['defense', false, false], crit: ['crit', true, false], crit_dmg: ['crit damage', true, false],
  aspd: ['attack speed', true, false], move: ['move speed', true, false], dodge: ['evasion', true, false],
  regen: ['HP regen', false, false], double_cast: ['double cast', true, false], proc_dmg: ['proc damage', true, false],
  basic_dmg: ['basic damage', true, false], int_pct: ['INT', true, false], dex_pct: ['DEX', true, false],
  str_pct: ['STR', true, false], block: ['block', true, false], summon_dmg: ['summon damage', true, false],
  duration: ['duration', true, false], status_chance: ['status chance', true, false], magnet: ['pickup range', true, false],
};

/** The item's own description (legendaries, uniques) or its stat bonuses spelled out. */
export function itemEffect(g: Game, id: string): string {
  const it = tbl(g, 'ITEMS')[id] ?? {};
  if (it.desc) return T(g, it.desc);
  return Object.entries(it.mods ?? {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => {
    const [label, pct, flip] = MOD_LABELS[k] ?? [k.replace(/_/g, ' '), true, false];
    const n = (flip ? -1 : 1) * (v as number);
    return pct ? `${n >= 0 ? '+' : ''}${Math.round(n * 100)}% ${label}` : `${n >= 0 ? '+' : ''}${+n.toFixed(2)} ${label}`;
  }).join(', ');
}

/** Damage-meter tags are skill ids, or prefixed sources like pet:<monster> and u_<unique>. */
export function meterLabel(g: Game, tag: string): string {
  if (tag === 'wiz_combo') return 'Elemental combos';
  if (tag === 'basic') return 'Basic attack';
  if (tbl(g, 'SKILLS')[tag]) return nameOf(g, 'SKILLS', tag);
  const uniq = tbl(g, 'UNIQUE_TAGS')[tag];
  if (uniq) return 'Unique: ' + nameOf(g, 'ITEMS', uniq);
  const [kind, rest] = tag.split(/:(.*)/s);
  if (rest) {
    if (kind === 'pet') return 'Pet: ' + T(g, (tbl(g, 'PETS')[rest] ?? tbl(g, 'MONSTERS')[rest] ?? {}).name ?? rest);
    return kind[0].toUpperCase() + kind.slice(1) + ': ' + meterLabel(g, rest);
  }
  return tag;
}

export interface GearRow { slot: string; id: string; name: string; refine: number; eternal: string[]; cards: string[] }

function gearRow(g: Game, slot: string, it: any, eternal: string[], cards: string[]): GearRow {
  return { slot, id: it.id, name: nameOf(g, 'ITEMS', it.id), refine: Math.floor(it.refine || 0), eternal, cards };
}

export function collectRun(g: Game, run: any) {
  const SK = tbl(g, 'SKILLS'), EVO = tbl(g, 'EVOLUTIONS');
  const levels: Record<string, number> = {};
  for (const [a, b] of run.skills ?? []) levels[String(a)] = Math.floor(b);
  const evolvedFrom = new Set(Object.values(EVO).map((e: any) => e.to));
  const skills: any[] = [], passives: any[] = [], evolutions: any[] = [];
  for (const [id, lvl] of Object.entries(levels)) {
    const s = SK[id] ?? {};
    if (s.type === 'passive') { passives.push({ id, name: nameOf(g, 'SKILLS', id), level: lvl }); continue; }
    skills.push({ id, name: nameOf(g, 'SKILLS', id), level: lvl, element: s.element ?? '',
      tag: s.evolved ? 'EVOLVED' : lvl >= MAX_SKILL_LEVEL ? 'MAX' : '' });
  }
  for (const s of skills) {
    const e = EVO[s.id];
    if (!e || evolvedFrom.has(s.id)) continue;
    const need: string[] = [];
    if (levels[s.id] < MAX_SKILL_LEVEL) need.push(`Lv${levels[s.id]}/${MAX_SKILL_LEVEL}`);
    if (!(e.passive in levels)) need.push('needs passive ' + nameOf(g, 'SKILLS', e.passive));
    evolutions.push({ from: s.id, to: e.to, fromName: s.name, toName: nameOf(g, 'SKILLS', e.to), ready: !need.length,
      state: need.length ? need.join(', ') : 'READY - pick it on level up' });
  }
  const elements = [...new Set(skills.map(s => s.element))].filter(e => ['fire', 'water', 'wind', 'earth'].includes(e)).sort();
  const combos = [...new Set(elements.flatMap(a => elements.filter(b => b !== a).map(b => COMBOS[[a, b].sort().join()])))].sort();
  const stats = STAT_KEYS.filter(k => k in (run.stats ?? {})).map(k => [k, run.stats[k]] as [string, number]);
  const gear = Object.entries(run.slots ?? {}).filter(([, it]) => it && typeof it === 'object')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slot, it]: [string, any]) => gearRow(g, slot, it, [], (it.cards ?? []).filter(Boolean)));
  const rows = Object.entries(run.meter ?? {}).filter(([, v]) => v && typeof v === 'object')
    .map(([k, v]: [string, any]) => ({ tag: k, dmg: Number(v.dmg || 0), max: Number(v.max || 0) })).sort((a, b) => b.dmg - a.dmg);
  const total = rows.reduce((a, r) => a + r.dmg, 0) || 1;
  const time = Number(run.time || 0);
  return {
    job: String(run.name ?? run.class), level: run.level, stage: run.stage, danger: run.danger ?? 1, time,
    kills: Number(run.kills || 0), hp: Number(run.hp || 0), saved: run.date ?? run.saved ?? '?',
    skills, passives, evolutions, elements, combos, stats, gear, total, dps: total / Math.max(1, time),
    damage: rows.slice(0, 10).map(r => ({ ...r, label: meterLabel(g, r.tag), pct: 100 * r.dmg / total })),
  };
}

export function classRecords(prof: any, cid: string) {
  const hist = (prof.history ?? []).filter((h: any) => h && h.class === cid);
  const rec = prof.records?.[cid] ?? {};
  return {
    bestLevel: Math.max(0, ...hist.map((h: any) => Number(h.level || 0))),
    towerFloor: Number(prof.tower?.best?.[cid] || 0),
    runs: Number(rec.runs || 0), longest: Number(rec.time || 0),
    accountLevel: Number(prof.stats?.run_level || 0),
  };
}

const upgradeLevel = (prof: any, id: string) =>
  (prof.settings?.upgrades_off ?? []).includes(id) ? 0 : Number(prof.upgrades?.[id] || 0);

/** Mirror of Player.profile_of(): what a new run of class `cid` starts with. */
export function collectPregame(g: Game, prof: any, cid: string) {
  const settings = prof.settings ?? {};
  const prog = prof.classes?.[cid] ?? {};
  const reborn = Number(prof.rebirths?.[cid] || 0) > 0;
  const className = nameOf(g, 'CLASSES', cid);
  const base = tbl(g, 'CLASSES')[cid]?.stats ?? {};
  const bonus = reborn ? Number(g.G.REBIRTH_STAT_BONUS ?? 2) : 0;
  const points: Record<string, number> = {};
  for (const [k, v] of Object.entries(prog.stats ?? {})) points[k] = Math.floor(Number(v));
  const stats = STAT_KEYS.map(k => [k, (base[k] ?? 0) + bonus + (points[k] ?? 0), points[k] ?? 0] as [string, number, number]);
  const storage = new Map<string, any>((prof.storage ?? []).map((it: any) => [String(it.uid), it]));
  const gear: GearRow[] = Object.entries(prof.loadouts?.[cid] ?? {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([slot, uid]) => [slot, storage.get(String(uid))] as [string, any]).filter(([, it]) => it)
    .map(([slot, it]) => gearRow(g, slot, it, [...(it.eternal ?? [])], (it.cards ?? []).filter(Boolean)));
  const albumSlots = Number(g.G.BASE_CARD_SLOTS ?? 1) + upgradeLevel(prof, 'card_slot');
  const holy = upgradeLevel(prof, 'fly_wing');
  const bans: string[] = (settings.run_bans?.[cid] ?? []).slice(0, holy);
  const banned = new Set(bans.map(b => String(b).split(':')[1]));
  const label = (i: string) => STAT_KEYS.includes(i) ? i.toUpperCase() : nameOf(g, 'SKILLS', i);
  const order: string[] = settings.pick_order?.[cid] ?? [];
  const limits = settings.pick_limits?.[cid] ?? {};
  const pet = String(prof.pet ?? '');
  const upgrades = (t: string) => Object.entries(tbl(g, t)).filter(([i]) => Number(prof.upgrades?.[i] || 0))
    .map(([i, u]: [string, any]) => ({ id: i, name: T(g, u.name ?? i), lv: Number(prof.upgrades[i]), max: u.max ?? '?',
      off: (settings.upgrades_off ?? []).includes(i) }));
  return {
    cid, className, reborn, job: reborn ? (tbl(g, 'HIGH_NAMES')[cid] ?? className) : className,
    level: Number(prog.level || 1), rlv: Number(prog.rlv || 0), stats, gear, records: classRecords(prof, cid),
    albumSlots, album: (prof.card_slots ?? []).slice(0, albumSlots) as string[],
    pet, petName: T(g, (tbl(g, 'PETS')[pet] ?? tbl(g, 'MONSTERS')[pet] ?? {}).name ?? pet),
    dishes: (prof.dishes ?? []).slice(0, Number(prof.cook_level || 1)) as string[],
    pacts: (prof.pacts?.[cid] ?? []).slice(0, 3) as string[],
    bansUsed: bans.length, bansMax: holy, fill: settings.pick_fill ?? true,
    order: order.map(i => ({ id: i, label: label(i), stat: STAT_KEYS.includes(i), cap: Number(limits[i] || 0), banned: banned.has(i) })),
    alsoBanned: [...banned].filter(i => !order.includes(i)).map(label).sort(),
    favs: (settings.run_favs?.[cid] ?? []).map((f: string) => label(String(f).split(':')[1] ?? f)),
    kafra: upgrades('UPGRADES'), sage: upgrades('SAGE_UPGRADES'),
  };
}
export type Pregame = ReturnType<typeof collectPregame>;

// ---- Bonus summary (port of scripts/ui/bonus_summary.gd)

const SUMMARY_ROWS: [string, string, boolean][] = [
  ['all_pct', 'Todos los atributos', true], ['dmg', 'Daño', true], ['grade_mult', 'Daño del grado del arma', true],
  ['skill_dmg', 'Daño de habilidades', true], ['basic_dmg', 'Daño básico', true], ['proc_dmg', 'Daño de procs', true],
  ['proc_power', 'Poder de procs', true], ['vs_boss', 'Daño a jefes', true], ['vs_mvp', 'Daño a MVP', true],
  ['double_cast', 'Doble lanzamiento', true], ['double', 'Golpe doble', true], ['crit', 'Crítico', true],
  ['crit_dmg', 'Daño crítico', true], ['aspd', 'Vel. de ataque', true], ['haste', 'Recarga', true],
  ['grade_haste', 'Recarga del grado', true], ['area', 'Área', true], ['duration', 'Duración', true],
  ['buff_power', 'Poder de bufos', true], ['proc_chance', 'Prob. de efectos de cartas', true],
  ['skill_burn', 'Probabilidad de quemar', true], ['burn_power', 'Daño de quemaduras', true],
  ['bleed_hit', 'Sangrado con el ataque básico', true], ['bleed_power', 'Potencia de sangrado', true],
  ['bleed_dmg', 'Daño de sangrado', true], ['poison_dmg', 'Daño de veneno', true],
  ['poison_cap', 'Cargas máx. de veneno', true], ['poison_stack', 'Cargas por dosis', false],
  ['poison_growth', 'Crecimiento del veneno', true], ['poison_amp', 'Corrosión del veneno', true],
  ['summon_dmg', 'Daño de invocaciones', true], ['falcon_dmg', 'Daño del halcón', true],
  ['status_chance', 'Probabilidad de estados', true], ['status_time', 'Duración de estados', true],
  ['wing_fill', 'Llenado del Aguante', true], ['wing_broken', 'Daño a jefes aturdidos', true],
  ['max_hp_pct', 'Vida máx.', true], ['grade_hp', 'Vida máx. del grado', true], ['max_hp', 'Vida', false],
  ['armor', 'Defensa', false], ['dodge', 'Evasión', true], ['grade_mech', 'Menos daño de mecánicas', true],
  ['grade_hit', 'Menos daño recibido', true], ['heal_power', 'Curación', true], ['kill_heal', 'Curación al matar', true],
  ['lifesteal', 'Robo de vida', true], ['regen', 'Vida/s', false], ['move', 'Velocidad', true], ['loot', 'Zeny', true],
  ['xp', 'EXP', true], ['card', 'Probabilidad de cartas', true], ['drop_find', 'Probabilidad de drop', true]];
const SUMMARY_EFFECTS = ['proc_power', 'double_cast', 'buff_power', 'vs_boss', 'double', 'burn_power', 'bleed_power', 'bleed_dmg',
  'poison_dmg', 'poison_cap', 'poison_stack', 'poison_growth', 'poison_amp', 'summon_dmg', 'status_chance', 'status_time',
  'wing_fill', 'wing_broken', 'heal_power', 'lifesteal', 'drop_find', 'proc_chance', 'skill_burn', 'bleed_hit', 'kill_heal'];

/** game_data.gd tables the site reads; `npm run extract` ships only these. */
export const GAME_TABLES = ['BASE_CARD_SLOTS', 'CARDS', 'CLASSES', 'EQUIP_SLOTS', 'EVOLUTIONS', 'GEAR_GRADES', 'HARMONY_MIN_PIECES',
  'HARMONY_SHARE', 'HARMONY_SLOTS', 'HEL_WINGS_KEEP', 'HEL_WINGS_MULT', 'HIGH_NAMES', 'ITEMS', 'ITEM_TIERS', 'JOB_ICON_IDS', 'MONSTERS',
  'OFFHAND_SHARE', 'PACTS', 'PETS', 'POTENTIAL_LINES', 'POTENTIAL_TIERS', 'PURPLE_TRAITS', 'REBIRTH_STAT_BONUS', 'RECIPES',
  'REFINE_OVER_DMG', 'REFINE_RATES', 'REFINE_SLOW_GROWTH', 'REFINE_STAT_STEP', 'SAGE_UPGRADES', 'SETS', 'SKILLS', 'UNIQUE_TAGS',
  'UPGRADES', 'WEAPON_GRADES'];

/** The game's own UI text the pages show (translated through the game's .po files). */
export const UI_STRINGS = [...SUMMARY_ROWS.map(r => r[1]), 'Total', 'Equipo', 'Armonía', 'Potencial', 'Cartas', 'Sets', 'Platos',
  'Mascota', 'Pactos', 'Tu equipo, tus cartas y tus platos aún no dan bonos.',
  'Tus atributos, tus habilidades y lo que ganes durante la partida suman aparte.'];

type Mods = Record<string, number>;
const add = (into: Mods, mods: any, share = 1) => {
  for (const [k, v] of Object.entries(mods ?? {})) if (typeof v === 'number') into[k] = (into[k] ?? 0) + v * share;
};
const shown = (fx: any): Mods => {
  const out: Mods = {};
  if (fx && typeof fx === 'object') for (const k of SUMMARY_EFFECTS) if (k in fx) out[k] = Number(fx[k]);
  return out;
};

function wingFx(r: number): Mods {
  const fx: Mods = {};
  const cap = (r >= 1 ? 2 : 0) + (r >= 4 ? 2 : 0) + (r >= 10 ? 5 : 0);
  if (cap) fx.wing_stat_cap = cap;
  for (const [need, k, v] of [[2, 'wing_stun', 1], [5, 'wing_ymir', 0.5], [6, 'wing_break_cd', 0.3], [7, 'wing_fill', 0.25], [9, 'wing_broken', 0.2]] as const)
    if (r >= need) fx[k] = v;
  if (r >= 3) fx.wing_card = r >= 8 ? 0.3 : 0.15;
  return fx;
}

function weaponLevel(G: any, it: any): number {
  const d = G.ITEMS[it.id];
  if ('wlv' in d) return Number(d.wlv);
  if (d.legendary) return 4;
  const rank = Number(d.rank ?? 1);
  if (rank <= 1) for (const [i, o] of Object.entries<any>(G.ITEMS))
    if (o.slot === 'weapon' && (o.class ?? '') === (d.class ?? '')) return i === it.id ? 1 : 2;
  return Math.min(4, rank + 1);
}

function refineSafe(G: any, it: any): number {
  const key = G.ITEMS[it.id].slot === 'weapon' ? `w${weaponLevel(G, it)}` : 'armor';
  const table: number[] = G.REFINE_RATES[key] ?? [];
  let safe = 0;
  while (safe < table.length && Number(table[safe]) >= 1) safe++;
  return safe;
}

function baseMods(G: any, it: any): Mods {
  const d = G.ITEMS[it.id];
  const r = Math.floor(it.refine || 0);
  const mult = Number(G.ITEM_TIERS[Math.max(0, Math.min(3, Math.floor(it.slots || 0)))].mult);
  const grow = 'refine' in d ? 1 + G.REFINE_STAT_STEP * r : 1;
  const hel = it.hel && d.wings;
  const out: Mods = {};
  for (const [k, raw] of Object.entries<any>(d.mods ?? {})) {
    if (typeof raw !== 'number') continue;
    let v = raw * mult;
    if (hel && v > 0 && !G.HEL_WINGS_KEEP.includes(k)) v *= G.HEL_WINGS_MULT;
    const gr = k in G.REFINE_SLOW_GROWTH && 'refine' in d ? 1 + G.REFINE_STAT_STEP * Number(G.REFINE_SLOW_GROWTH[k]) * r : grow;
    out[k] = (out[k] ?? 0) + (v > 0 ? v * gr : v);
  }
  for (const [k, v] of Object.entries<any>(d.refine ?? {})) out[k] = (out[k] ?? 0) + Number(v) * r;
  const over = r - refineSafe(G, it);
  if (d.slot === 'weapon' && over > 0) out.dmg = (out.dmg ?? 0) + G.REFINE_OVER_DMG * over;
  return out;
}

function grade(G: any, it: any): number {
  const kind = G.ITEMS[it.id]?.slot;
  if (kind !== 'weapon' && !(kind in G.GEAR_GRADES)) return 0;
  return Math.max(0, Math.min(G.WEAPON_GRADES.length - 1, Math.floor(it.grade || 0)));
}

function potential(G: any, it: any): [Mods, Mods] {
  const mods: Mods = {}, fx: Mods = {};
  const pot = it.pot;
  if (!pot || typeof pot !== 'object') return [mods, fx];
  const tiers = G.POTENTIAL_TIERS.length;
  for (const l of (pot.lines ?? []).filter((l: any) => l && l.k in G.POTENTIAL_LINES).slice(0, 3)) {
    const d = G.POTENTIAL_LINES[l.k];
    let i = Math.max(1, Math.min(tiers, Math.floor(l.t ?? 1))) - 1;
    if (i >= tiers - 1 && Math.floor(l.t ?? 0) >= tiers && l.p) i++;
    const v = Number(d.vals[Math.min(i, d.vals.length - 1)]);
    if (d.mod) mods[d.mod] = (mods[d.mod] ?? 0) + v;
    for (const e of d.fx ?? []) fx[e] = (fx[e] ?? 0) + v;
  }
  return [mods, fx];
}

function harmony(G: any, slots: Record<string, any>): Mods {
  const piece = (it: any) => it && G.ITEMS[it.id] && G.ITEMS[it.id].slot !== 'weapon' && G.ITEMS[it.id].slot in G.GEAR_GRADES && !G.ITEMS[it.id].face;
  let n = 0, low = 99;
  for (const k of G.HARMONY_SLOTS) if (piece(slots[k])) { n++; low = Math.min(low, grade(G, slots[k])); }
  const level = n >= G.HARMONY_MIN_PIECES && low < 99 ? low : 0;
  const out: Mods = {};
  if (level > 0) {
    const share = Number(G.HARMONY_SHARE[Math.min(level, G.HARMONY_SHARE.length - 1)]);
    for (const k of G.HARMONY_SLOTS) {
      const it = slots[k];
      if (!piece(it) || grade(G, it) <= 0) continue;
      const gg = G.GEAR_GRADES[G.ITEMS[it.id].slot];
      for (const key of gg.keys) out[key] = (out[key] ?? 0) + Number(gg.vals[grade(G, it)]) * share;
    }
  }
  return out;
}

function activeSets(G: any, slots: Record<string, any>, cards: string[]): any[] {
  const have = new Set(Object.values(slots).filter(Boolean).map((it: any) => it.id));
  const out: any[] = [];
  for (const st of Object.values<any>(G.SETS)) {
    if (st.more) {
      const worn = [...(st.items ?? []), ...st.more].filter((i: string) => have.has(i)).length;
      if (worn >= 2) out.push(st);
      if (worn >= 4) out.push({ mods: st.full_mods ?? {}, effects: st.full_effects ?? {} });
      continue;
    }
    if ((st.items ?? []).every((i: string) => have.has(i)) && (st.cards ?? []).every((c: string) => cards.includes(c))) out.push(st);
  }
  return out;
}

export type Sources = [string, Mods][];

/** BonusSummary._sources(): columns in the game's order. */
export function bonusSources(g: Game, slots: Record<string, any>, album: string[], dishes: string[], pet: string, pacts: string[], meta: Mods): Sources {
  const G = g.G;
  const gear: Mods = {}, pot: Mods = {}, cards: Mods = {}, sets: Mods = {}, food: Mods = {}, petMods: Mods = {}, pactMods: Mods = {};
  for (const [k, it] of Object.entries(slots)) {
    if (!it || !G.ITEMS[it.id]) continue;
    const d = G.ITEMS[it.id];
    const share = k === 'shield' && d.slot === 'weapon' ? (d.offhand_full ? 1 : G.OFFHAND_SHARE) : 1;
    const refine = Math.floor(it.refine || 0);
    add(gear, baseMods(G, it), share);
    add(gear, shown((d.soul_of ? G.ITEMS[d.soul_of] ?? {} : d).effects), share);
    const trait = G.PURPLE_TRAITS[String(it.trait ?? '')];
    if (trait) {
      const tier = Math.max(1, Math.min(3, Math.floor(it.slots || 0)));
      const fx: Mods = {};
      for (const [f, v] of Object.entries<any>(trait.fx ?? {})) if (Number(v[tier - 1]) > 0) fx[f] = Number(v[tier - 1]);
      add(gear, shown(fx));
    }
    const gr = grade(G, it);
    if (gr > 0 && d.slot === 'weapon') add(gear, { grade_mult: Number(G.WEAPON_GRADES[gr].dmg) }, share);
    else if (gr > 0 && d.slot in G.GEAR_GRADES) {
      const gg = G.GEAR_GRADES[d.slot];
      add(gear, Object.fromEntries(gg.keys.map((key: string) => [key, Number(gg.vals[gr])])), share);
    }
    let wingK = 0;
    if (d.wings) { add(gear, shown(wingFx(refine)), share); wingK = wingFx(refine).wing_card ?? 0; }
    const [pm, pf] = potential(G, it);
    add(pot, pm, share); add(pot, shown(pf), share);
    for (const c of it.cards ?? []) {
      const card = G.CARDS[c];
      if (!card) continue;
      for (const part of [card.mods ?? {}, shown(card.effects)]) {
        const more: Mods = {};
        for (const [mk, v] of Object.entries<any>(part)) if (typeof v === 'number') more[mk] = v * (v > 0 ? 1 + wingK : 1);
        add(cards, more, share);
      }
    }
  }
  const socketed = Object.values(slots).filter(Boolean).flatMap((it: any) => it.cards ?? []);
  for (const st of activeSets(G, slots, [...socketed, ...album])) { add(sets, st.mods); add(sets, shown(st.effects)); }
  for (const c of album) if (G.CARDS[c]) { add(cards, G.CARDS[c].mods); add(cards, shown(G.CARDS[c].effects)); }
  for (const d of dishes) { const r = G.RECIPES[d] ?? {}; add(food, r.mods); add(food, shown(r.effects)); }
  if (G.PETS[pet]) { add(petMods, G.PETS[pet].mods); add(petMods, shown(G.PETS[pet].effects)); }
  for (const x of pacts.slice(0, 3)) { const p = G.PACTS[x] ?? {}; add(pactMods, p.mods); add(pactMods, shown(p.effects)); }
  return [['Equipo', gear], ['Armonía', harmony(G, slots)], ['Potencial', pot], ['Cartas', cards], ['Sets', sets],
    ['Platos', food], ['Mascota', petMods], ['Pactos', pactMods], ['Kafra', meta]];
}

/** GameData.meta_mods(): what the Kafra upgrades add. */
export function kafraMeta(g: Game, prof: any): Mods {
  const out: Mods = {};
  for (const [i, u] of Object.entries<any>(tbl(g, 'UPGRADES'))) { const lv = upgradeLevel(prof, i); if (lv > 0) add(out, u.mods, lv); }
  return out;
}

/** Equipment.new(cid) plus the stored loadout, as BonusSummary.of_class() builds it. */
export function classSlots(g: Game, prof: any, cid: string): Record<string, any> {
  const G = g.G;
  let weapon = String(G.CLASSES[cid]?.start_weapon ?? '');
  if (!weapon) weapon = Object.entries<any>(G.ITEMS).find(([, d]) => d.slot === 'weapon' && (d.class ?? '') === cid)?.[0] ?? 'sword';
  const slots: Record<string, any> = Object.fromEntries(G.EQUIP_SLOTS.map((k: string) => [k, null]));
  slots.weapon = { id: weapon, slots: Number(G.ITEMS[weapon]?.fixed_slots ?? 0), refine: 0, cards: [] };
  const storage = new Map<string, any>((prof.storage ?? []).map((it: any) => [String(it.uid), it]));
  for (const [k, uid] of Object.entries(prof.loadouts?.[cid] ?? {})) {
    const st = storage.get(String(uid));
    if (!st || !G.ITEMS[st.id] || !(k in slots)) continue;
    if (k === 'weapon' && G.ITEMS[st.id].slot !== 'weapon') continue;
    slots[k] = { ...st, slots: Math.floor(st.slots || 0), refine: Math.floor(st.refine || 0),
      cards: (st.eternal ?? []).filter((c: string) => G.CARDS[c]) };
  }
  return slots;
}

export function pregameSources(g: Game, prof: any, cid: string, b: Pregame): Sources {
  return bonusSources(g, classSlots(g, prof, cid), b.album, b.dishes, b.pet, b.pacts, kafraMeta(g, prof));
}

export function runSources(g: Game, run: any, prof: any | null): Sources {
  const picks = run.picks ?? {};
  return bonusSources(g, run.slots ?? {}, picks.cards ?? [], picks.dishes ?? [], String(picks.pet ?? ''), picks.pacts ?? [],
    prof ? kafraMeta(g, prof) : {});
}

/** (columns, rows of [label, cells, total]) with only the non-empty rows and columns, as the game shows it. */
export function summaryTable(g: Game, sources: Sources): [string[], [string, string[], string][]] {
  const nz = (v: number) => Math.abs(v) >= 0.0005;
  const cols = sources.filter(([, m]) => SUMMARY_ROWS.some(([k]) => nz(m[k] ?? 0)));
  const rows: [string, string[], string][] = [];
  for (const [key, label, pct] of SUMMARY_ROWS) {
    const vals = cols.map(([, m]) => m[key] ?? 0);
    if (!vals.some(nz)) continue;
    const fmt = (v: number) => {
      if (!pct) return Math.abs(v) >= 10 ? `${v >= 0 ? '+' : ''}${Math.round(v)}` : `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
      if (key === 'haste') return `-${Math.round(v * 100)}%`;
      const p = v * 100;
      return Math.abs(p - Math.round(p)) < 0.05 ? `${p >= 0 ? '+' : ''}${Math.round(p)}%` : `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
    };
    rows.push([T(g, label), vals.map(v => nz(v) ? fmt(v) : '·'), fmt(vals.reduce((a, b) => a + b, 0))]);
  }
  return [cols.map(([n]) => T(g, n)), rows];
}

// ---- planned builds

export interface Plan {
  id?: string; cid?: string; name?: string; notes?: string; updated?: number;
  stats: Record<string, number>; gear: Record<string, string>; album: string[]; dishes: string[]; pacts: string[];
  pet: string; order: string[]; caps: Record<string, number>; bans: string[]; favs: string[];
}

/** A copy of the profile with the planned build in place of the current setup (in memory only). */
export function applyPlan(prof: any, cid: string, plan: Plan): any {
  const p = structuredClone(prof);
  p.classes ??= {}; p.classes[cid] ??= { level: 1 };
  p.classes[cid].stats = Object.fromEntries(Object.entries(plan.stats ?? {}).filter(([k, v]) => STAT_KEYS.includes(k) && v > 0));
  p.loadouts ??= {}; p.loadouts[cid] = Object.fromEntries(Object.entries(plan.gear ?? {}).filter(([, v]) => v));
  p.card_slots = [...(plan.album ?? [])];
  p.dishes = [...(plan.dishes ?? [])];
  p.pacts ??= {}; p.pacts[cid] = (plan.pacts ?? []).slice(0, 3);
  p.pet = plan.pet ?? '';
  const s = p.settings ??= {};
  for (const [k, v] of [['pick_order', plan.order ?? []], ['run_bans', plan.bans ?? []], ['run_favs', (plan.favs ?? []).slice(0, 2)],
    ['pick_limits', Object.fromEntries(Object.entries(plan.caps ?? {}).filter(([, n]) => n > 0))]] as const) {
    if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = {};
    s[k][cid] = v;
  }
  return p;
}

/** Every skill and passive of a class across all its job paths (job2, alternative job, transcendent). */
export function classTreeIds(d: any): string[] {
  if (!d || typeof d !== 'object') return [];
  return [...(d.skills ?? []), ...(d.passives ?? []), ...['job2', 'job2_alt', 'trans'].flatMap(k => classTreeIds(d[k]))];
}

export function currentPlan(prof: any, cid: string, b: Pregame): Plan {
  const storage = new Set((prof.storage ?? []).map((it: any) => String(it.uid)));
  return {
    name: 'Current setup', notes: '',
    stats: Object.fromEntries(b.stats.filter(([, , pt]) => pt).map(([k, , pt]) => [k, pt])),
    gear: Object.fromEntries(Object.entries<any>(prof.loadouts?.[cid] ?? {}).map(([k, v]) => [k, String(v)]).filter(([, v]) => storage.has(v))),
    album: [...b.album], dishes: [...b.dishes], pacts: [...b.pacts], pet: b.pet,
    order: b.order.map(o => o.id), caps: Object.fromEntries(b.order.filter(o => o.cap > 0).map(o => [o.id, o.cap])),
    bans: [...(prof.settings?.run_bans?.[cid] ?? [])], favs: [...(prof.settings?.run_favs?.[cid] ?? [])],
  };
}

export function cardTiers(g: Game): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of Object.values<any>(tbl(g, 'MONSTERS'))) if (m?.card) out[m.card] = m.mvp ? 'mvp' : m.boss ? 'boss' : 'normal';
  return out;
}
