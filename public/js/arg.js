// VEGA. You found the file: nice try, but everything past the first fragment is encrypted with the previous
// answer (see arg-data.js). The station only remembers what you solved on this device.
import DATA from './arg-data.js';
import { state, emit } from './state.js';
import { h, toast } from './ui.js';

const STORE = 'cc-vega';
const enc = new TextEncoder();
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const norm = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const MONTHS = ['septembre', 'octobre', 'novembre', 'décembre', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin'];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('calm');

// ------------------------------------------------------------ memory (this device only)
function load() {
  try { const v = JSON.parse(localStorage.getItem(STORE) || '{}'); return { found: !!v.found, keys: v.keys && typeof v.keys === 'object' ? v.keys : {} }; }
  catch { return { found: false, keys: {} }; }
}
let mem = load();
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(mem)); } catch { /* private mode */ } };

const chapter = (n) => DATA.chapters[n - 1];
export const solved = (n) => typeof mem.keys[n] === 'string';
export const argDone = () => solved(DATA.chapters.length);
/** School month now: 0 = September … 9 = June; July and August open everything. */
export function schoolMonth(d = new Date()) { const i = (d.getMonth() + 4) % 12; return i > 9 ? 9 : i; }
export const reachable = (n, d = new Date()) => !!chapter(n) && schoolMonth(d) >= chapter(n).month;
const current = () => DATA.chapters.find((c) => !solved(c.n))?.n || null;

async function keyOf(n) {
  return crypto.subtle.importKey('raw', unb64(mem.keys[n]), 'AES-GCM', false, ['decrypt']);
}
async function open(key, box, aad) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: enc.encode(aad) }, key, unb64(box.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

const clues = new Map();   // n -> { title, clue }
const hooks = new Map();   // n -> hook data
const logs = new Map();    // n -> text
async function decryptKnown() {
  for (const c of DATA.chapters) {
    try {
      if (c.n === 1) { clues.set(1, c.clue); if (c.hook) hooks.set(1, c.hook); }
      else if (solved(c.n - 1)) {
        const prev = await keyOf(c.n - 1);
        clues.set(c.n, await open(prev, c.clue, `clue|${c.n}`));
        if (c.hook) hooks.set(c.n, await open(prev, c.hook, `hook|${c.n}`));
      }
      if (solved(c.n)) logs.set(c.n, await open(await keyOf(c.n), c.log, `log|${c.n}`));
    } catch { delete mem.keys[c.n]; save(); }   // corrupted memory: that fragment is forgotten
  }
}
const ready = decryptKnown();

/** Tries an answer: every accepted answer wraps the fragment's key, so a wrong one simply opens nothing. */
export async function tryAnswer(n, answer) {
  const c = chapter(n);
  const a = norm(answer);
  if (!c || !a) return false;
  for (const w of c.wraps) {
    try {
      const base = await crypto.subtle.importKey('raw', enc.encode(a), 'PBKDF2', false, ['deriveKey']);
      const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(w.salt), iterations: DATA.iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const raw = await open(k, w, `wrap|${n}`);
      mem.keys[n] = raw;
      save();
      await decryptKnown();
      emit('vega', n);
      return true;
    } catch { /* not this one */ }
  }
  return false;
}

/** Hook data of fragment n, only once it is reachable (date) and its clue is readable. */
export const hookOf = (n) => (reachable(n) && hooks.has(n) ? hooks.get(n) : null);

// ------------------------------------------------------------ the terminal
let term = null;

function typeInto(el, text, speed = 14) {
  if (reduced()) { el.textContent = text; return Promise.resolve(); }
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      i = Math.min(text.length, i + 2);
      el.textContent = text.slice(0, i);
      if (i < text.length && el.isConnected) setTimeout(tick, speed); else resolve();
    };
    tick();
  });
}

export async function openTerminal() {
  await ready;
  if (term) return;
  mem.found = true;
  save();
  const screen = h('div.vega-screen');
  const close = () => { term?.remove(); term = null; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  term = h('div.vega-term', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Terminal VEGA' },
    h('div.vega-frame',
      h('div.vega-bar', h('span', 'VEGA://terminal'), h('button', { type: 'button', 'aria-label': 'Fermer', onclick: close }, '×')),
      screen));
  document.body.append(term);
  document.addEventListener('keydown', onKey);
  render(screen);
}

async function render(screen) {
  const total = DATA.chapters.length;
  const done = DATA.chapters.filter((c) => solved(c.n)).length;
  const head = h('pre.vega-line');
  screen.replaceChildren(head);
  await typeInto(head, `VEGA > système de bord réveillé.\nVEGA > mémoire restaurée : ${done}/${total} fragments.`);
  // Solved fragments: the logs, to read again.
  for (const c of DATA.chapters.filter((x) => solved(x.n))) {
    screen.append(h('details.vega-log', h('summary', `Fragment ${c.n} · ${clues.get(c.n)?.title || ''}`), h('pre', logs.get(c.n) || '')));
  }
  const n = current();
  if (!n) { screen.append(h('pre.vega-line.vega-ok', 'VEGA > ÉCHO-7 est rentrée. Merci, équipage. 🛸')); return; }
  if (!reachable(n)) {
    const month = MONTHS[chapter(n).month];
    screen.append(h('pre.vega-line.vega-dim', `VEGA > fragment ${n} hors de portée.\nVEGA > prochain signal attendu en ${month}. Reviens écouter.`));
    return;
  }
  const c = clues.get(n);
  const box = h('pre.vega-line');
  screen.append(h('p.vega-title', `◉ Fragment ${n}/${total} · ${c.title}`), box);
  await typeInto(box, c.clue);
  if (n === 2 && hookOf(2)) {
    screen.append(h('button.vega-btn', { type: 'button', onclick: () => playTransmission(hookOf(2).notes, screen) }, '📡 Capter la transmission'));
  }
  const input = h('input', { type: 'text', autocomplete: 'off', spellcheck: false, 'aria-label': 'Réponse', maxLength: 60 });
  const out = h('pre.vega-line.vega-dim');
  const form = h('form.vega-input', { onsubmit: async (e) => {
    e.preventDefault();
    if (!input.value.trim() || input.disabled) return;
    input.disabled = true;
    out.textContent = 'VEGA > analyse du signal…';
    const ok = await tryAnswer(n, input.value);
    await new Promise((r) => setTimeout(r, ok ? 300 : 1200));   // no rush when it's wrong
    input.disabled = false;
    if (!ok) { out.textContent = 'VEGA > signal brouillé. Ce n\'est pas ça.'; input.select(); return; }
    state.space?.warpJump?.();
    if (n === total) toast('🛸 Mémoire restaurée à 100 %', 'success', 7000);
    render(screen);
  } }, h('span', '>'), input);
  screen.append(form, out);
  input.focus();
}

/** A short message from VEGA (clues hidden in the site). */
export function transmission(text, title = 'Transmission') {
  const box = h('pre');
  const el = h('div.vega-toast', { role: 'status' }, h('b', `📡 ${title}`), box,
    h('button', { type: 'button', 'aria-label': 'Fermer', onclick: () => el.remove() }, '×'));
  document.body.append(el);
  typeInto(box, text, 28);
  setTimeout(() => el.remove(), 30000);
}

// ------------------------------------------------------------ hooks hidden around the site
/** Fragment 2: the tune, as beeps from far away. */
function playTransmission(notes, screen) {
  const F = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88 };
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let t = ctx.currentTime + 0.2;
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = F[note];
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.65);
      t += 0.8;
    }
    setTimeout(() => ctx.close(), (t - ctx.currentTime + 1) * 1000);
  } catch { /* no audio */ }
  const bars = h('div.vega-bars', notes.map((_, i) => h('i', { style: { animationDelay: `${0.2 + i * 0.8}s` } })));
  screen.querySelector('.vega-bars')?.remove();
  screen.querySelector('.vega-btn')?.after(bars);
}

/** Fragment 1 (and 7): the star that belongs to nobody, in the class constellation. */
export function argStar(svg) {
  const g = svg('g', { class: 'vega-star', tabindex: 0, role: 'button', 'aria-label': 'Étoile inconnue' },
    svg('circle', { cx: 566, cy: 34, r: 9, fill: 'transparent' }),
    svg('circle', { cx: 566, cy: 34, r: 1.6, class: 'vega-core' }));
  const core = g.lastChild;
  const hook = hookOf(1);
  if (hook && !solved(1) && !reduced()) {
    // Morse, 1 unit = 260 ms: · = 1 on, — = 3 on, 1 off between signs, 3 between letters, 7 then again.
    const seq = [];
    for (const letter of hook.morse.split(' ')) {
      for (const s of letter) seq.push([s === '-' ? 3 : 1, true], [1, false]);
      seq.push([2, false]);
    }
    seq.push([6, false]);
    let i = 0;
    const step = () => {
      if (!g.isConnected && i > 0) return;
      const [units, on] = seq[i % seq.length];
      core.classList.toggle('on', on);
      i++;
      setTimeout(step, units * 260);
    };
    setTimeout(step, 600);
  }
  const act = () => { if (hookOf(7) && solved(6) && !solved(7)) vegaCard(hookOf(7).card); else openTerminal(); };
  g.addEventListener('click', act);
  g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
  return g;
}

function vegaCard(card) {
  const el = h('div.vega-term', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Carte d\'identité' },
    h('div.id-card.vega-card', { style: { '--b1': '#000000', '--b2': '#0b6b4f', '--b3': '#3dffa8' } },
      h('div.id-top', h('b', '🛰️ CLASS CONNECT'), h('small', 'Carte d\'identité spatiale')),
      h('div.id-body',
        h('div.avatar.vega-avatar', { style: { width: '92px', height: '92px', fontSize: '40px' } }, '◉'),
        h('div.id-fields',
          h('b.id-name', card.name),
          h('small', card.role),
          h('dl', h('dt', 'Étoile'), h('dd', `⭐ ${card.star}`), h('dt', 'En service depuis'), h('dd', card.since), h('dt', 'Équipage'), h('dd', card.crew)))),
      h('div.id-foot', h('code', card.id), h('button.vega-btn', { type: 'button', onclick: () => { el.remove(); openTerminal(); } }, 'Ouvrir le terminal'))));
  el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
  document.body.append(el);
}

/** Fragment 4: a mark on the solstice in the class calendar. */
export function argMark(ymd) {
  const hook = hookOf(4);
  if (!hook || !solved(3) || ymd.slice(5) !== hook.date) return null;
  return h('span.arg-mark', { title: '✦', onclick: (e) => { e.stopPropagation(); transmission(hook.text, 'Solstice'); } }, '✦');
}

/** Fragment 5: a planet too many around the subjects. */
export const argPhantom = () => (solved(4) ? hookOf(5) : null);

/** Fragment 6: a keyboard shortcut that echoes a word backwards. */
export const argShortcut = () => (solved(5) ? hookOf(6) : null);
export function argEcho() {
  const hook = argShortcut();
  if (!hook) return false;
  const el = h('div.vega-echo', { 'aria-hidden': 'true' }, hook.word);
  document.body.append(el);
  setTimeout(() => el.remove(), 5200);
  return true;
}

/** Fragment 8: the station painted with the right colours. */
export function argTheme(a, b) {
  const hook = solved(7) ? hookOf(8) : null;
  if (!hook || a.toLowerCase() !== hook.a || b.toLowerCase() !== hook.b) return;
  state.space?.warpJump?.();
  transmission(`…${hook.word.split('').join(' · ')}…`, '1420 MHz');
}

// ------------------------------------------------------------ ways in (none of them is written anywhere)
export function initArg() {
  // 1. Typing my name anywhere but in a text box.
  let typed = '';
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
    if (e.key.length !== 1) return;
    typed = (typed + e.key.toLowerCase()).slice(-4);
    if (typed === 'vega' && document.body.dataset.view === 'app') { typed = ''; openTerminal(); }
  });
  // 2. The frequency in the address.
  const byHash = () => { if (location.hash === '#1420') { history.replaceState(null, '', location.pathname + location.search); openTerminal(); } };
  window.addEventListener('hashchange', byHash);
  byHash();
  // 3. Fragment 9: the mascot talks if you insist.
  let clicks = 0;
  let timer;
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('.mascot-body')) return;
    const hook = solved(8) ? hookOf(9) : null;
    if (!hook) return;
    clearTimeout(timer);
    timer = setTimeout(() => { clicks = 0; }, 2500);
    if (++clicks >= hook.clicks) { clicks = 0; transmission(hook.riddle, 'Astro'); }
  });
  // 4. For the curious who open the console.
  console.log('%c📡 VEGA ▸ …signal faible… 1420 MHz…', 'color:#3dffa8;font:600 13px monospace');
}
