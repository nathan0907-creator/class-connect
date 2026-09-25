// The class as a cosmos: a star per member, the constellation that grows with each new crew member, the
// subjects' solar system, shooting stars on birthdays, an aurora when the class is lively, and a few easter eggs.
import { state, on } from './state.js';
import { h, modal, toast } from './ui.js';
import { statsOf, levelOf } from './stats.js';
import { showProfile, birthdaysToday } from './profiles.js';
import { allSlots } from './timetable.js';
import { play } from './sounds.js';
import { checkBirthdayParty } from './birthday.js';

const GREEK = ['Alpha', 'Bêta', 'Gamma', 'Delta', 'Epsilon', 'Zêta', 'Êta', 'Thêta', 'Iota', 'Kappa', 'Lambda', 'Mu',
  'Nu', 'Xi', 'Omicron', 'Pi', 'Rhô', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Khi', 'Psi', 'Oméga'];

/** Stable 32-bit hash of a string (same result on every device). */
export function hash(str, seed = 0) {
  let x = 2166136261 ^ seed;
  for (const c of str) { x ^= c.codePointAt(0); x = Math.imul(x, 16777619) >>> 0; }
  return x >>> 0;
}

/** Each member's own star, e.g. « Sigma-42 ». */
export const starName = (uid) => { const x = hash(uid); return `${GREEK[x % 24]}-${(x >>> 5) % 90 + 10}`; };
export const constellationName = () => `Constellation ${state.cls?.name || 'de la classe'}`;

const crew = () => [...state.members.values()].filter((m) => m.status === 'active')
  .sort((a, b) => (a.created_at || 0) - (b.created_at || 0) || a.id.localeCompare(b.id));
const calm = () => document.body.classList.contains('calm') || matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------ the constellation
/** Star positions: from the member's id, spread apart; each new star links to the closest older one. */
export function layoutStars(members, W = 600, H = 400) {
  const stars = [];
  for (const m of members) {
    let best = null;
    for (let i = 0; i < 24; i++) {
      const x = hash(m.id, i * 2 + 1);
      const p = { x: 40 + (x % 1000) / 1000 * (W - 80), y: 40 + ((x >>> 10) % 1000) / 1000 * (H - 80) };
      const gap = Math.min(Infinity, ...stars.map((s) => Math.hypot(s.x - p.x, s.y - p.y)));
      if (!best || gap > best.gap) best = { ...p, gap };
      if (gap > 70) break;
    }
    const link = stars.length ? stars.reduce((a, s) => (Math.hypot(s.x - best.x, s.y - best.y) < Math.hypot(a.x - best.x, a.y - best.y) ? s : a)) : null;
    stars.push({ m, x: best.x, y: best.y, link });
  }
  return stars;
}

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  el.append(...kids.flat().filter(Boolean));
  return el;
};

export function openConstellation() {
  const members = crew();
  const stars = layoutStars(members);
  const labels = h('input', { type: 'checkbox', checked: true });
  const sky = svg('svg', { viewBox: '0 0 600 400', class: 'constellation', role: 'img', 'aria-label': `${constellationName()} : ${members.length} étoiles` },
    svg('defs', {}, svg('radialGradient', { id: 'cc-glow' }, svg('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': '1' }), svg('stop', { offset: '100%', 'stop-color': '#fff', 'stop-opacity': '0' }))),
    // faint background stars
    Array.from({ length: 70 }, (_, i) => svg('circle', { cx: (i * 97) % 600, cy: (i * 53 + (i % 7) * 31) % 400, r: (i % 3) * 0.4 + 0.3, class: 'bg-star', style: `animation-delay:${(i % 9) * 0.4}s` })),
    stars.filter((s) => s.link).map((s, i) => svg('line', { x1: s.link.x, y1: s.link.y, x2: s.x, y2: s.y, class: 'c-line', style: `animation-delay:${0.3 + i * 0.12}s` })),
    stars.map((s, i) => {
      const lvl = levelOf(statsOf(s.m.id).xp || 0);
      const r = 3 + Math.min(lvl, 10) * 0.55;
      const g = svg('g', { class: 'c-star', tabindex: 0, role: 'button', 'aria-label': `${s.m.display_name} · ${starName(s.m.id)}`, style: `animation-delay:${i * 0.12}s` },
        svg('title', {}, `${s.m.display_name} — ⭐ ${starName(s.m.id)} · niveau ${lvl}`),
        svg('circle', { cx: s.x, cy: s.y, r: r * 4, fill: 'url(#cc-glow)', opacity: 0.25 }),
        svg('circle', { cx: s.x, cy: s.y, r, fill: s.m.color || '#fff', class: 'c-core', style: `animation-delay:${(i % 5) * 0.7}s` }),
        svg('text', { x: s.x, y: s.y + r + 13, class: 'c-label' }, s.m.display_name.slice(0, 16)));
      const open = () => showProfile(s.m);
      g.addEventListener('click', open);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      return g;
    }));
  labels.addEventListener('change', () => sky.classList.toggle('no-labels', !labels.checked));
  modal({
    title: `🌌 ${constellationName()}`,
    wide: true,
    body: h('div.constellation-box',
      h('p.muted', `${members.length} étoile${members.length > 1 ? 's' : ''} : chaque membre a la sienne, plus brillante à chaque niveau gagné. La constellation grandit à chaque nouvel arrivant ✨`),
      sky,
      h('label.switch-row.small', labels, h('span', 'Afficher les noms')),
      h('p.hint', `Ton étoile : ⭐ ${starName(state.me.id)}`)),
  });
}

// ------------------------------------------------------------ the subjects' solar system (from the timetable)
const minutes = (hhmm) => { const [a, b] = String(hhmm).split(':').map(Number); return a * 60 + b; };

export function subjectsOrbit(slots) {
  const bySubject = new Map();
  for (const s of slots) {
    const k = s.subject.trim();
    const cur = bySubject.get(k) || { subject: k, color: s.color, minutes: 0 };
    cur.minutes += (minutes(s.end_at) - minutes(s.start_at)) * (s.week ? 0.5 : 1);   // A/B weeks: every other week
    bySubject.set(k, cur);
  }
  return [...bySubject.values()].sort((a, b) => b.minutes - a.minutes);
}

export function openSolarSystem() {
  const planets = subjectsOrbit(allSlots());
  if (!planets.length) return toast('Ajoute d\'abord l\'emploi du temps 📅', 'info');
  const S = 1000;
  const c = S / 2;
  const sky = svg('svg', { viewBox: `0 0 ${S} ${S}`, class: 'solar', role: 'img', 'aria-label': 'Système solaire des matières' },
    svg('circle', { cx: c, cy: c, r: 46, class: 'sun' }),
    svg('text', { x: c, y: c + 8, class: 'sun-label' }, '☀️'),
    planets.map((p, i) => {
      const orbit = 80 + i * (400 / Math.max(planets.length, 1));
      const r = Math.min(26, 7 + p.minutes / 60 * 2.2);
      const start = (hash(p.subject) % 360);
      return svg('g', {},
        svg('circle', { cx: c, cy: c, r: orbit, class: 'orbit' }),
        svg('g', { class: 'planet-spin', style: `animation-duration:${14 + i * 7}s;transform:rotate(${start}deg)` },
          svg('circle', { cx: c + orbit, cy: c, r, fill: p.color, class: 'planet' }),
          svg('title', {}, `${p.subject} · ${(p.minutes / 60).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h par semaine`)));
    }));
  modal({
    title: '🪐 Le système solaire des matières',
    wide: true,
    body: h('div.solar-box',
      h('p.muted', 'Chaque matière est une planète : plus elle a d\'heures dans la semaine, plus elle est grosse et proche du soleil.'),
      sky,
      h('ul.solar-legend', planets.map((p) => h('li', h('span.dot', { style: { background: p.color } }), h('b', p.subject),
        h('small', ` ${(p.minutes / 60).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h / sem.`))))),
  });
}

// ------------------------------------------------------------ living sky: birthdays and a lively class
let aurora = null;
function updateSky() {
  if (!state.cls) return;
  const birthdays = birthdaysToday();
  state.space?.celebrate?.(birthdays.length > 0 && !calm());
  // Birthday party with music, once per day on this device (see birthday.js).
  checkBirthdayParty();
  // Aurora: at least 3 members online (or a third of the class).
  const online = state.online?.size || 0;
  const active = crew().length;
  aurora ||= document.body.appendChild(h('div.aurora', { 'aria-hidden': 'true' }, h('span'), h('span'), h('span')));
  document.body.classList.toggle('class-lively', online >= 3 || (active > 0 && online / active >= 0.34 && online >= 2));
}

export function initCosmos() {
  on('profiles', updateSky);
  on('presence', updateSky);
  on('members', updateSky);
  on('space-ready', updateSky);
  on('app-ready', updateSky);
  initEggs();
}

// ------------------------------------------------------------ easter eggs
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

export function hyperspace() {
  play('warp', true);
  state.space?.warpJump?.();
  document.body.classList.add('rainbow');
  setTimeout(() => document.body.classList.remove('rainbow'), 6000);
}

/** Special messages sent in the chat (called after sending). */
export function textEgg(text) {
  const t = text.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (t === '42') toast('🌌 La réponse à la grande question sur la vie, l\'univers et le reste.', 'info', 5000);
  else if (/houston.*probleme/.test(t)) toast('🛰️ Ici Houston, on vous reçoit 5 sur 5.', 'info', 5000);
  else if (/^(bonne nuit|bn)( |!|$)/.test(t)) { state.space?.celebrate?.(true); setTimeout(updateSky, 8000); }
  else if (/hyperespace|hyperspace/.test(t)) hyperspace();
  else if (/^(gg|bravo|trop fort)\b/.test(t)) play('level');
}

function initEggs() {
  let pos = 0;
  document.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    pos = k === KONAMI[pos] ? pos + 1 : k === KONAMI[0] ? 1 : 0;
    if (pos === KONAMI.length) { pos = 0; hyperspace(); toast('🚀 Code secret : saut en hyperespace !', 'success'); }
  });
  // 7 taps on the little logo: barrel roll.
  let taps = 0;
  let tapTimer;
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('.logo-mini')) return;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { taps = 0; }, 1500);
    if (++taps < 7) return;
    taps = 0;
    document.body.classList.add('barrel-roll');
    setTimeout(() => document.body.classList.remove('barrel-roll'), 1300);
    toast('🌀 Tonneau réussi, pilote !');
  });
  // Special days (once per day on this device).
  const d = new Date();
  const md = `${d.getMonth() + 1}-${d.getDate()}`;
  const DAYS = { '5-4': '✨ 4 mai : que la Force soit avec toi !', '3-14': '🥧 Jour de π : 3,14159265…', '4-12': '🧑‍🚀 12 avril : Youri Gagarine est le premier humain dans l\'espace (1961)', '7-21': '🌕 21 juillet 1969 : premiers pas sur la Lune !', '10-4': '🛰️ 4 octobre 1957 : Spoutnik, le premier satellite' };
  if (DAYS[md]) {
    let seen = '';
    try { seen = localStorage.getItem('cc-egg-day') || ''; localStorage.setItem('cc-egg-day', d.toDateString()); } catch { /* ignore */ }
    if (seen !== d.toDateString()) setTimeout(() => toast(DAYS[md], 'info', 7000), 4000);
  }
}
