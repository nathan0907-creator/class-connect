// Colour themes: other planets and nebulae for the 3D background, matching accent colours for the interface.
// The choice is kept on this device only.
import { state } from './state.js';
import { $$, h, modal, toast } from './ui.js';

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

export const currentTheme = () => {
  let k = 'nebuleuse';
  try { k = localStorage.getItem(KEY) || k; } catch { /* ignore */ }
  return THEMES[k] ? k : 'nebuleuse';
};

/** Interface colours right away; the 3D scene when it is ready (see main.js). */
export function applyTheme(key = currentTheme()) {
  const t = THEMES[key];
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
      toast(`Thème ${t.label} ${t.emoji}`);
    },
  },
  h('span.theme-planet', { style: { '--p1': t.planet[1], '--p2': t.planet[2], '--p3': t.planet[3], '--r': t.rings[0] } }),
  h('b', t.label))));
  modal({ title: '🎨 Thème de l\'espace', body: h('div', h('p.muted', 'Change la planète, les nébuleuses et les couleurs de l\'appli. Le choix est gardé sur cet appareil.'), grid) });
}
