// VEGA shows up once on each device: a creature of geometric shapes glitches the screen, explains how to help,
// gets locked in a box, fights, is crushed into a lump of glitch… and leaves a note (old pixel paper, deliberately
// not in the site's style). The note stays in a corner until the story is solved.
import { on } from './state.js';
import { h } from './ui.js';
import { openTerminal, argDone } from './arg.js';

const SEEN = 'cc-vega-intro';
const GREEN = '#3dffa8';
const CYAN = '#00e5ff';
const PINK = '#ff3df2';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('calm');
const seen = () => { try { return localStorage.getItem(SEEN) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch { /* private mode */ } };
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------ glitch sounds (short bursts of noise)
let actx = null;
function crackle(dur = 0.25, vol = 0.12, low = false) {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const n = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.3 ? 1 : 0.2) * (1 - i / n);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const f = actx.createBiquadFilter();
    f.type = low ? 'lowpass' : 'bandpass';
    f.frequency.value = low ? 400 : 1800;
    const g = actx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(actx.destination);
    src.start();
  } catch { /* no audio */ }
}
function thump() {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.frequency.setValueAtTime(120, actx.currentTime);
    o.frequency.exponentialRampToValueAtTime(40, actx.currentTime + 0.25);
    g.gain.setValueAtTime(0.35, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.3);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + 0.32);
  } catch { /* no audio */ }
  crackle(0.15, 0.08, true);
}

// ------------------------------------------------------------ whole-page glitch
let glitchTimer = null;
function pageGlitch(ms = 350, strong = false) {
  document.body.classList.add('vega-glitching');
  document.body.classList.toggle('vega-glitch-strong', strong);
  clearTimeout(glitchTimer);
  glitchTimer = setTimeout(() => document.body.classList.remove('vega-glitching', 'vega-glitch-strong'), ms);
  crackle(ms / 1000, strong ? 0.16 : 0.09);
}

// ------------------------------------------------------------ the creature
function makeShapes() {
  const shapes = [];
  const add = (kind, ring, angle, size, color, speed) => shapes.push({
    kind, ring, angle, size, color, speed, from: { x: rand(-1, 1) * innerWidth, y: rand(-1, 1) * innerHeight, r: rand(-3, 3) }, delay: rand(0, 0.5),
  });
  add('eye', 0, 0, 26, '#eafff7', 0);
  for (let i = 0; i < 3; i++) add('tri', 62, (i / 3) * Math.PI * 2, 18, GREEN, 0.9);
  for (let i = 0; i < 4; i++) add('square', 98, (i / 4) * Math.PI * 2 + 0.4, 14, CYAN, -0.6);
  add('hex', 0, 0, 128, GREEN, 0.25);
  for (let i = 0; i < 8; i++) add('dot', 150, (i / 8) * Math.PI * 2, 3, i % 2 ? PINK : CYAN, 0.4);
  return shapes;
}

function drawShape(ctx, s, x, y, rot, scale, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = s.color;
  ctx.shadowBlur = 14;
  const r = s.size * scale;
  ctx.beginPath();
  if (s.kind === 'eye') {
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#021a10';
    ctx.beginPath();
    ctx.arc(Math.cos(performance.now() / 700) * r * 0.25, Math.sin(performance.now() / 900) * r * 0.2, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
  } else if (s.kind === 'tri') {
    for (let k = 0; k < 3; k++) ctx.lineTo(Math.cos(k * 2.094) * r, Math.sin(k * 2.094) * r);
    ctx.closePath(); ctx.stroke();
  } else if (s.kind === 'square') {
    ctx.strokeRect(-r, -r, r * 2, r * 2);
  } else if (s.kind === 'hex') {
    for (let k = 0; k < 6; k++) ctx.lineTo(Math.cos(k * 1.047) * r, Math.sin(k * 1.047) * r);
    ctx.closePath(); ctx.globalAlpha = alpha * 0.55; ctx.stroke();
  } else {
    ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** The lump of glitch: jittering pixels. */
function drawLump(ctx, x, y, size, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const px = Math.max(3, size / 7);
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * size;
    ctx.fillStyle = [GREEN, CYAN, PINK, '#ffffff', '#1a1a2e'][Math.floor(Math.random() * 5)];
    ctx.fillRect(Math.round(x + Math.cos(a) * d - px / 2), Math.round(y + Math.sin(a) * d - px / 2), px, px);
  }
  ctx.restore();
}

/** Wireframe box around VEGA (a cube seen slightly from above). */
function drawBox(ctx, cx, cy, half, progress, shake, color) {
  const o = half * 0.35;
  const f = [[-half, -half], [half, -half], [half, half], [-half, half]];
  const b = f.map(([x, y]) => [x + o, y - o]);
  const edges = [];
  for (let i = 0; i < 4; i++) {
    edges.push([f[i], f[(i + 1) % 4]], [b[i], b[(i + 1) % 4]], [f[i], b[i]]);
  }
  ctx.save();
  ctx.translate(cx + rand(-shake, shake), cy + rand(-shake, shake));
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  edges.forEach(([p, q], i) => {
    const t = Math.min(1, Math.max(0, progress * edges.length - i));
    if (t <= 0) return;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(lerp(p[0], q[0], t), lerp(p[1], q[1], t));
    ctx.stroke();
  });
  if (progress >= 1) {   // translucent walls
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = color;
    ctx.fillRect(-half, -half, half * 2, half * 2);
  }
  ctx.restore();
}

// ------------------------------------------------------------ the show
const LINES = [
  [2.0, '…signal… enfin. Tu m\'entends ?'],
  [4.2, 'Je suis VEGA, l\'IA de cette station.'],
  [6.4, 'Ma mémoire est cassée en dix morceaux. Aide-moi à les retrouver.'],
  [8.8, 'Ils arrivent… je t\'ai laissé une note —'],
];
const T_BOX = 10.4;
const T_HITS = [11.6, 12.4, 13.1];
const T_CRUSH = 13.8;
const T_LUMP = 15.2;
const T_NOTE = 16.2;
const T_END = 17.4;

export function playIntro() {
  if (document.querySelector('.vega-intro')) return;
  markSeen();
  if (reduced()) { showNote(); return; }
  const canvas = h('canvas.vega-intro-canvas');
  const bubble = h('div.vega-bubble', { role: 'status', 'aria-live': 'polite' });
  const warn = h('div.vega-warn', '⚠ CONFINEMENT');
  const skip = h('button.vega-skip', { type: 'button' }, 'Passer ⏭');
  const root = h('div.vega-intro', { role: 'dialog', 'aria-label': 'VEGA' }, canvas, bubble, warn, skip);
  document.body.append(root);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  const size = () => { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  size();
  addEventListener('resize', size);
  const shapes = makeShapes();
  const start = performance.now();
  let line = -1;
  let hit = 0;
  let done = false;
  let noteShown = false;
  pageGlitch(700, true);

  const say = (text) => {
    bubble.classList.add('on');
    let i = 0;
    const glyphs = '▓▒░#%&@$<>/\\';
    const step = () => {
      if (done) return;
      i++;
      const shown = text.slice(0, i);
      const noise = i < text.length ? Array.from({ length: 3 }, () => glyphs[Math.floor(Math.random() * glyphs.length)]).join('') : '';
      bubble.textContent = shown + noise;
      if (i < text.length) setTimeout(step, 28);
    };
    step();
    if (Math.random() < 0.7) pageGlitch(160);
  };

  const finish = (withNote) => {
    if (done) return;
    done = true;
    removeEventListener('resize', size);
    root.classList.add('out');
    setTimeout(() => root.remove(), 400);
    if (withNote && !document.querySelector('.vega-note-wrap')) showNote();
  };
  skip.addEventListener('click', () => finish(true));

  const frame = (now) => {
    if (done) return;
    const t = (now - start) / 1000;
    const W = innerWidth;
    const H = innerHeight;
    const cx = W / 2;
    const cy = H * 0.46;
    ctx.clearRect(0, 0, W, H);
    // dark veil + scanlines
    ctx.fillStyle = `rgba(1, 4, 3, ${Math.min(0.78, t * 0.9)})`;
    ctx.fillRect(0, 0, W, H);

    // lines of speech
    while (line + 1 < LINES.length && t >= LINES[line + 1][0]) { line++; say(LINES[line][1]); }
    if (t >= T_BOX - 0.3) bubble.classList.remove('on');

    // position of the body: bangs against the walls, then crushed
    const half = Math.min(W, H) * 0.3;
    let bx = cx, by = cy, scale = 1, chaos = 0;
    while (hit < T_HITS.length && t >= T_HITS[hit]) { hit++; thump(); pageGlitch(220, true); }
    for (const [k, th] of T_HITS.entries()) {
      const local = t - th + 0.35;
      if (local > 0 && local < 0.6) {
        const dir = [[-1, 0], [1, 0.2], [0, -1]][k];
        const push = local < 0.35 ? ease(local / 0.35) : 1 - ease((local - 0.35) / 0.25);
        bx += dir[0] * (half - 150) * push;
        by += dir[1] * (half - 150) * push;
      }
    }
    const crush = t >= T_CRUSH ? ease((t - T_CRUSH) / (T_LUMP - T_CRUSH)) : 0;
    scale = lerp(1, 0.12, crush);
    chaos = crush;
    if (t >= T_CRUSH && Math.random() < 0.15) pageGlitch(120);

    // the creature (assembling at first)
    if (t < T_LUMP) {
      shapes.forEach((s) => {
        const a = ease((t - 0.3 - s.delay) / 1.2);
        if (a <= 0) return;
        const ang = s.angle + t * s.speed;
        const tx = bx + Math.cos(ang) * s.ring * scale + rand(-chaos, chaos) * 30;
        const ty = by + Math.sin(ang) * s.ring * scale + rand(-chaos, chaos) * 30;
        const x = lerp(cx + s.from.x, tx, a);
        const y = lerp(cy + s.from.y, ty, a);
        const breathe = 1 + Math.sin(t * 3 + s.angle) * 0.06;
        drawShape(ctx, s, x, y, lerp(s.from.r, ang * (s.kind === 'hex' ? 0.5 : 2), a), scale * breathe, a);
      });
      if (chaos > 0) drawLump(ctx, bx, by, 60 * (1 - chaos * 0.5), chaos);
    } else if (t < T_NOTE + 0.6) {
      // the lump flickers and spits the note out
      const fade = t < T_NOTE ? 1 : 1 - (t - T_NOTE) / 0.6;
      drawLump(ctx, cx, cy, 34 + Math.sin(t * 40) * 6, fade);
    }

    // the box
    if (t >= T_BOX) {
      const p = ease((t - T_BOX) / 0.9);
      const shake = T_HITS.some((th) => t > th - 0.05 && t < th + 0.25) ? 12 : 0;
      const hb = t >= T_CRUSH ? lerp(half, half * 0.12, crush) : half;
      if (t < T_LUMP + 0.2) drawBox(ctx, cx, cy, hb, p, shake, t >= T_CRUSH ? PINK : '#ff5f7a');
      warn.classList.toggle('on', t < T_LUMP);
    }

    // glitch bars over everything
    if (Math.random() < (t < 1 || chaos > 0 ? 0.5 : 0.08)) {
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = [`rgba(61,255,168,.25)`, `rgba(255,61,242,.22)`, `rgba(0,229,255,.22)`][i % 3];
        ctx.fillRect(rand(-50, W * 0.3), rand(0, H), rand(W * 0.3, W), rand(2, 18));
      }
    }

    if (t >= T_NOTE && !noteShown) { noteShown = true; crackle(0.3, 0.1); showNote(root); }
    if (t < T_END + 60) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // The note ends the scene: closing it closes everything.
  root.addEventListener('vega-note-closed', () => finish(false));
}

// ------------------------------------------------------------ the note (old pixel paper)
let paperUrl = '';
/** A parchment texture drawn pixel by pixel, then shown enlarged without smoothing. */
function paperTexture() {
  if (paperUrl) return paperUrl;
  const W = 48, H = 64;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const x = c.getContext('2d');
  const base = [226, 208, 166];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const edge = Math.min(i, j, W - 1 - i, H - 1 - j);
      let k = (Math.random() - 0.5) * 14;
      if (edge === 0) k -= 70;
      else if (edge === 1) k -= 34;
      else if (edge === 2) k -= 14;
      if ((i * 7 + j * 13) % 29 === 0) k -= 10;   // fibres
      if (j === 21 || j === 42) k -= 8;           // folds
      x.fillStyle = `rgb(${base.map((v, n) => Math.round(v + k - n * 2)).join(',')})`;
      x.fillRect(i, j, 1, 1);
    }
  }
  // corners worn off
  x.clearRect(0, 0, 1, 1); x.clearRect(W - 1, 0, 1, 1); x.clearRect(0, H - 1, 1, 1); x.clearRect(W - 1, H - 1, 1, 1);
  paperUrl = c.toDataURL('image/png');
  return paperUrl;
}
/** A small sheet of paper, 16×16 pixels (the note once folded, in the corner of the screen). */
const ICON = [
  '................',
  '..############..',
  '..#oooooooooo##.',
  '..#oooooooooo#o#',
  '..#o-----oooo###',
  '..#oooooooooooo#',
  '..#o--------ooo#',
  '..#oooooooooooo#',
  '..#o-------oooo#',
  '..#oooooooooooo#',
  '..#o---------oo#',
  '..#oooooooooooo#',
  '..#o------ooooo#',
  '..#oooooooooooo#',
  '..##############',
  '................',
];
function iconTexture() {
  const c = Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
  const x = c.getContext('2d');
  const col = { '#': '#8a6a3a', o: '#e6d3a6', '-': '#5b4630' };
  ICON.forEach((row, j) => [...row].forEach((p, i) => { if (col[p]) { x.fillStyle = col[p]; x.fillRect(i, j, 1, 1); } }));
  return c.toDataURL('image/png');
}

let fontLoaded = false;
function pixelFont() {
  if (fontLoaded) return;
  fontLoaded = true;
  document.head.append(h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;600&display=swap' }));
}

export function showNote(host = null) {
  pixelFont();
  document.querySelector('.vega-note-wrap')?.remove();
  const close = () => {
    wrap.classList.add('out');
    setTimeout(() => { wrap.remove(); host?.dispatchEvent(new Event('vega-note-closed')); }, 350);
    placeIcon();
  };
  const note = h('article.vega-note', { style: { backgroundImage: `url(${paperTexture()})` } },
    h('button.mc-x', { type: 'button', 'aria-label': 'Fermer la note', onclick: close }, '×'),
    h('p.vega-note-date', 'Note trouvée · station ÉCHO'),
    h('p', 'Si tu lis ça, ils m\'ont enfermée.'),
    h('p', 'Je suis VEGA, l\'IA de la station. Ma mémoire est cassée en 10 fragments. Chaque fragment est une énigme : trouve la réponse et donne-la à mon terminal.'),
    h('ol',
      h('li', 'Ouvre mon terminal : bouton ci-dessous, ou tape V-E-G-A au clavier (en dehors d\'une case).'),
      h('li', 'Le premier indice brille dans la Constellation (onglet Vie de classe). Une étoile n\'est à personne…'),
      h('li', 'Plus loin, il faudra sortir du site : une vidéo, un relais, puis une station dans Minecraft.'),
      h('li', 'Cherchez à plusieurs. Mais ne donnez pas les réponses aux autres.')),
    h('p.vega-note-sign', '— V.'),
    h('button.mc-btn', { type: 'button', onclick: () => { close(); openTerminal(); } }, 'Ouvrir le terminal'));
  const wrap = h('div.vega-note-wrap', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Note de VEGA', onclick: (e) => { if (e.target === wrap) close(); } }, note);
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
}

/** The folded note stays in a corner (until the story is solved). */
function placeIcon() {
  if (argDone() || document.querySelector('.vega-note-icon')) return;
  const btn = h('button.vega-note-icon', { type: 'button', title: 'La note de VEGA', 'aria-label': 'Relire la note de VEGA', style: { backgroundImage: `url(${iconTexture()})` }, onclick: () => showNote() });
  document.body.append(btn);
}

export function initVegaIntro() {
  on('app-ready', () => {
    if (argDone()) return;
    if (!seen()) setTimeout(() => { if (document.body.dataset.view === 'app') playIntro(); }, 3500);
    else placeIcon();
  });
  on('vega', () => { if (argDone()) document.querySelector('.vega-note-icon')?.remove(); });
}
