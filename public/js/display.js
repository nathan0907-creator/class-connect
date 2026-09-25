// Display settings, kept on this device only: text size, easier-to-read fonts (dyslexia), colour-blind mode,
// chat wallpaper, blurred photos and sounds.
import { $$, h, modal, toast } from './ui.js';
import { setSounds, play } from './sounds.js';

const KEY = 'cc-display';
export const SIZES = { s: ['Petit', 0.92], m: ['Normal', 1], l: ['Grand', 1.12], xl: ['Très grand', 1.25] };
export const FONTS = {
  inter: { label: 'Classique', css: "'Inter', system-ui, sans-serif" },
  lexend: { label: 'Lexend (lecture facilitée)', css: "'Lexend', system-ui, sans-serif", google: 'Lexend:wght@400;600;700' },
  atkinson: { label: 'Atkinson (très lisible)', css: "'Atkinson Hyperlegible', system-ui, sans-serif", google: 'Atkinson+Hyperlegible:wght@400;700' },
  dys: { label: 'Mode dyslexie', css: "'Lexend', 'Atkinson Hyperlegible', system-ui, sans-serif", google: 'Lexend:wght@400;600;700', spaced: true },
};
export const WALLPAPERS = {
  none: 'Aucun',
  stars: '✨ Étoiles',
  grid: '🌆 Rétro',
  nebula: '🌌 Nébuleuse',
  aurora: '🟢 Aurore',
  dots: '🔵 Pois',
  waves: '🌊 Vagues',
};
const DEFAULTS = { size: 'm', font: 'inter', colorblind: false, wallpaper: 'none', blurMedia: false, sounds: false, motion: false, bdayMusic: true };

export function displayPrefs() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* ignore */ }
  const p = { ...DEFAULTS, ...saved };
  if (!Object.hasOwn(SIZES, p.size)) p.size = 'm';
  if (!Object.hasOwn(FONTS, p.font)) p.font = 'inter';
  if (!Object.hasOwn(WALLPAPERS, p.wallpaper)) p.wallpaper = 'none';
  return p;
}

function save(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: applied for this visit only */ }
}

const loadedFonts = new Set();
function loadFont(spec) {
  if (!spec || loadedFonts.has(spec)) return;
  loadedFonts.add(spec);
  document.head.append(h('link', { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${spec}&display=swap` }));
}

export function applyDisplay(p = displayPrefs()) {
  const root = document.documentElement;
  const body = document.body;
  root.style.setProperty('--ui-zoom', String(SIZES[p.size][1]));
  const font = FONTS[p.font];
  loadFont(font.google);
  root.style.setProperty('--font', font.css);
  body.classList.toggle('font-spaced', !!font.spaced);
  body.classList.toggle('colorblind', !!p.colorblind);
  body.classList.toggle('blur-media', !!p.blurMedia);
  body.classList.toggle('calm', !!p.motion);
  body.dataset.wallpaper = p.wallpaper;
  setSounds(p.sounds);
}

export function initDisplay() {
  applyDisplay();
  $$('[data-action="display"]').forEach((b) => b.addEventListener('click', openDisplay));
}

export function openDisplay() {
  const p = displayPrefs();
  const update = (change) => { Object.assign(p, change); save(p); applyDisplay(p); };

  const seg = (label, options, key) => {
    const box = h('div.seg.seg-sm.seg-wrap', { role: 'radiogroup', 'aria-label': label }, Object.entries(options).map(([k, v]) => h(`button${p[key] === k ? '.active' : ''}`, {
      type: 'button', role: 'radio', 'aria-checked': String(p[key] === k),
      onclick: (e) => {
        update({ [key]: k });
        box.querySelectorAll('button').forEach((b) => { b.classList.toggle('active', b === e.currentTarget); b.setAttribute('aria-checked', String(b === e.currentTarget)); });
      },
    }, Array.isArray(v) ? v[0] : v.label || v)));
    return h('div.field', h('span', label), box);
  };
  const toggle = (label, hint, key, after) => h('label.switch-row',
    h('input', { type: 'checkbox', checked: !!p[key], onchange: (e) => { update({ [key]: e.target.checked }); after?.(e.target.checked); } }),
    h('span', h('b', label), h('small.muted', hint)));

  const walls = h('div.wall-grid', Object.entries(WALLPAPERS).map(([k, label]) => h(`button.wall-card${p.wallpaper === k ? '.active' : ''}`, {
    type: 'button', 'data-wall': k, 'aria-pressed': String(p.wallpaper === k),
    onclick: (e) => {
      update({ wallpaper: k });
      walls.querySelectorAll('.wall-card').forEach((c) => { c.classList.toggle('active', c === e.currentTarget); c.setAttribute('aria-pressed', String(c === e.currentTarget)); });
    },
  }, h('span', label))));

  modal({
    title: '✨ Affichage',
    wide: true,
    body: h('div.slot-form.display-form',
      h('p.muted', 'Ces réglages ne concernent que cet appareil.'),
      seg('Taille du texte', SIZES, 'size'),
      seg('Police', FONTS, 'font'),
      h('p.sample', 'Aperçu : Le petit prince regardait les étoiles depuis sa planète B 612. 🪐'),
      h('div.field', h('span', 'Fond du chat'), walls),
      toggle('Mode daltonien', 'Remplace le rouge et le vert par du bleu et de l\'orange (réussi / raté, en ligne…)', 'colorblind'),
      toggle('Flouter toutes les photos', 'Les photos et vidéos du chat restent floutées jusqu\'à ce que tu les touches', 'blurMedia',
        () => toast('Appliqué aux prochains messages affichés')),
      toggle('Musique d\'anniversaire', 'Joue « Joyeux anniversaire » quand c\'est l\'anniversaire de quelqu\'un de la classe', 'bdayMusic'),
      toggle('Sons', 'Petits bruitages spatiaux à l\'envoi et à la réception', 'sounds', (on) => on && play('pop')),
      toggle('Moins d\'animations', 'Coupe les effets qui bougent beaucoup (aurores, étoiles filantes…)', 'motion')),
  });
}
