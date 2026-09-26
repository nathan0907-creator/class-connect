// Colour themes: other planets and nebulae for the 3D background, matching accent colours for the interface.
// The choice is kept on this device only.
import { state } from './state.js';
import { $$, h, modal, toast } from './ui.js';
import { argTheme } from './arg.js';
import { QUALITY, savedQuality, saveQuality, chosenQuality, autoQuality, applyQualityClass } from './quality.js';

const KEY = 'cc-theme';
export const THEMES = {
  nebuleuse: {
    label: 'Nébuleuse', emoji: '🪐', accent: '#7c5cff', accent2: '#00d4ff', mine: ['#6647f0', '#1f6fd6'],
    planet: ['#1b0f4d', '#6c4cff', '#29d3ff', '#ff5fd8'], atmo: '#5fd4ff', rings: ['#c8b8ff', '#ff9ee8', '#7ae6ff'],
    nebulae: [['#7c5cff', '#ff4fd8', '#3a1c8f'], ['#00d4ff', '#2b59ff', '#7c5cff'], ['#ff4fd8', '#ffb547', '#7c5cff']],
  },
  mars: {
    label: 'Mars', emoji: '🔴', accent: '#ff6b3d', accent2: '#ffcf6b', mine: ['#e0531f', '#b3261e'],
    planet: ['#2a0a05', '#c1440e', '#ff9a3c', '#ffd29a'], atmo: '#ff8a4c', rings: ['#ffcfa0', '#ff6b3d', '#ffd27a'],
    nebulae: [['#ff6b3d', '#ff2e63', '#5a1020'], ['#ffb547', '#ff6b3d', '#7a1f10'], ['#ff2e63', '#ffcf6b', '#8f2a1c']],
  },
  neptune: {
    label: 'Neptune', emoji: '🔵', accent: '#2b8cff', accent2: '#29f0d3', mine: ['#1f6fd6', '#0fa3b1'],
    planet: ['#041a3a', '#1f5fd6', '#29d3ff', '#7af0ff'], atmo: '#5fd4ff', rings: ['#a8e8ff', '#5fa8ff', '#c8fff4'],
    nebulae: [['#2b59ff', '#00d4ff', '#0a1f5c'], ['#29f0d3', '#2b8cff', '#08304a'], ['#7af0ff', '#5f7bff', '#102a6b']],
  },
  aurore: {
    label: 'Aurore', emoji: '🟢', accent: '#1fd18a', accent2: '#b4ff5c', mine: ['#12a36b', '#0b7f8c'],
    planet: ['#062a1c', '#1fb57a', '#7affc4', '#c6ff6b'], atmo: '#7affc4', rings: ['#b8ffd9', '#6bffb0', '#e8ffa0'],
    nebulae: [['#1fd18a', '#7c5cff', '#0a3a2a'], ['#b4ff5c', '#1fd18a', '#1a3a10'], ['#29f0d3', '#1fb57a', '#3a1c8f']],
  },
  soleil: {
    label: 'Soleil', emoji: '🟠', accent: '#ff9f1c', accent2: '#ffd166', mine: ['#ff7a1c', '#e0457b'],
    planet: ['#3a1d00', '#ff9f1c', '#ffe07a', '#ff5fa8'], atmo: '#ffd27a', rings: ['#ffe7b0', '#ffb86b', '#ff9ee8'],
    nebulae: [['#ff9f1c', '#ff4fd8', '#5a2a00'], ['#ffd166', '#ff7a1c', '#6b2a10'], ['#ff5fa8', '#ffd166', '#7c5cff']],
  },
};

// ------------------------------------------------------------ custom theme ("Perso"): two colours, the rest is derived
const CUSTOM_KEY = 'cc-theme-custom';
const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
/** Mix of two colours (t = 0 → a, 1 → b). */
export const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));

export function customColors() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}') || {}; } catch { /* ignore */ }
  return { a: HEX.test(c.a) ? c.a : '#ff4fd8', b: HEX.test(c.b) ? c.b : '#7c5cff' };
}

/** Full theme (planet, rings, nebulae, interface) built from two colours. */
export function buildCustom(a, b) {
  return {
    label: 'Perso', emoji: '🎨', accent: a, accent2: b, mine: [mix(a, '#000000', 0.2), mix(b, '#000000', 0.25)],
    planet: [mix(a, '#000000', 0.85), mix(a, b, 0.3), b, mix(b, '#ffffff', 0.55)], atmo: mix(b, '#ffffff', 0.3),
    rings: [mix(a, '#ffffff', 0.6), a, mix(b, '#ffffff', 0.5)],
    nebulae: [[a, b, mix(a, '#000000', 0.7)], [b, mix(a, b, 0.5), mix(b, '#000000', 0.7)], [mix(a, '#ffffff', 0.2), a, b]],
  };
}
const themeOf = (key) => (key === 'perso' ? buildCustom(customColors().a, customColors().b) : THEMES[key]);

export const currentTheme = () => {
  let k = 'nebuleuse';
  try { k = localStorage.getItem(KEY) || k; } catch { /* ignore */ }
  return Object.hasOwn(THEMES, k) || k === 'perso' ? k : 'nebuleuse';
};

/** Interface colours right away; the 3D scene when it is ready (see main.js). */
export function applyTheme(key = currentTheme()) {
  const t = themeOf(key) || THEMES.nebuleuse;
  const root = document.documentElement;
  root.dataset.theme = key;
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-2', t.accent2);
  root.style.setProperty('--mine-a', t.mine[0]);
  root.style.setProperty('--mine-b', t.mine[1]);
  state.space?.setTheme?.(t);
}

export function initTheme() {
  applyTheme();
  // The 3D scene lowered its quality by itself because the device was struggling.
  document.addEventListener('cc-quality-auto', () => toast('Animations allégées pour garder l\'appli fluide ⚡ (réglable dans « 🎨 Thème »)'));
  $$('[data-action="theme"]').forEach((b) => b.addEventListener('click', openThemePicker));
}

function openThemePicker() {
  const now = currentTheme();
  const grid = h('div.theme-grid', Object.entries(THEMES).map(([key, t]) => h(`button.theme-card${key === now ? '.active' : ''}`, {
    type: 'button', 'aria-pressed': String(key === now),
    onclick: (e) => {
      try { localStorage.setItem(KEY, key); } catch { /* ignore */ }
      applyTheme(key);
      grid.querySelectorAll('.theme-card').forEach((c) => { c.classList.toggle('active', c === e.currentTarget); c.setAttribute('aria-pressed', String(c === e.currentTarget)); });
      perso.classList.remove('active');
      toast(`Thème ${t.label} ${t.emoji}`);
    },
  },
  h('span.theme-planet', { style: { '--p1': t.planet[1], '--p2': t.planet[2], '--p3': t.planet[3], '--r': t.rings[0] } }),
  h('b', t.label))));
  // Custom theme: pick two colours, the planet and the nebulae follow.
  const cc = customColors();
  const colA = h('input', { type: 'color', value: cc.a, 'aria-label': 'Couleur principale' });
  const colB = h('input', { type: 'color', value: cc.b, 'aria-label': 'Deuxième couleur' });
  const persoPlanet = h('span.theme-planet');
  const paint = () => {
    const t = buildCustom(colA.value, colB.value);
    Object.entries({ '--p1': t.planet[1], '--p2': t.planet[2], '--p3': t.planet[3], '--r': t.rings[0] }).forEach(([k, v]) => persoPlanet.style.setProperty(k, v));
  };
  paint();
  let persoTimer;
  const applyPerso = () => {
    paint();
    clearTimeout(persoTimer);
    persoTimer = setTimeout(() => {
      try { localStorage.setItem(CUSTOM_KEY, JSON.stringify({ a: colA.value, b: colB.value })); localStorage.setItem(KEY, 'perso'); } catch { /* ignore */ }
      applyTheme('perso');
      argTheme(colA.value, colB.value);
      grid.querySelectorAll('.theme-card').forEach((c) => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
      perso.classList.add('active');
    }, 250);
  };
  colA.addEventListener('input', applyPerso);
  colB.addEventListener('input', applyPerso);
  const perso = h(`div.theme-perso.card${now === 'perso' ? '.active' : ''}`, persoPlanet,
    h('div', h('b', '🎨 Mon thème'), h('small.muted', 'Choisis deux couleurs : la planète, les nébuleuses et l\'appli suivent.')),
    h('div.theme-perso-colors', colA, colB));
  // Performance: automatic by default (economy on phones), can be forced.
  const current = savedQuality();
  const options = [['auto', `Auto (${QUALITY[autoQuality()].label.toLowerCase()})`], ...Object.entries(QUALITY).map(([k, q]) => [k, q.label])];
  const perf = h('div.seg.seg-sm.seg-wrap.perf-seg', { role: 'radiogroup', 'aria-label': 'Performances' },
    options.map(([k, label]) => h(`button${k === current ? '.active' : ''}`, {
      type: 'button', role: 'radio', 'aria-checked': String(k === current), title: QUALITY[k]?.hint || 'Choisi selon ton appareil',
      onclick: (e) => {
        saveQuality(k);
        const q = chosenQuality();
        state.space?.setQuality?.(q);
        applyQualityClass(q);
        perf.querySelectorAll('button').forEach((b) => { b.classList.toggle('active', b === e.currentTarget); b.setAttribute('aria-checked', String(b === e.currentTarget)); });
        toast(`Performances : ${QUALITY[q].label} ⚡`);
      },
    }, label)));
  modal({
    title: '🎨 Thème de l\'espace',
    body: h('div',
      h('p.muted', 'Change la planète, les nébuleuses et les couleurs de l\'appli. Le choix est gardé sur cet appareil.'), grid, perso,
      h('h4.perf-title', '⚡ Performances'),
      h('p.muted.small', 'Si l\'appli rame sur ton téléphone, choisis « Économie » : fond plus simple, moins d\'effets, batterie préservée.'),
      perf),
  });
}
