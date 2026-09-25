// Birthday party: when someone opens the app on a classmate's birthday, the whole site celebrates
// (balloons, confetti, cake) with the "Joyeux anniversaire" tune, synthesised on the device (no audio file).
// Once per day and per birthday on each device; music can be turned off in « ✨ Affichage ».
import { state, emit } from './state.js';
import { h, avatar } from './ui.js';
import { birthdaysToday } from './profiles.js';
import { displayPrefs } from './display.js';
import { insertInComposer } from './chat.js';

const SEEN = 'cc-bday-party';
const calm = () => document.body.classList.contains('calm') || matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------ the tune (public domain), 3/4 time
const N = { G3: 196, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99 };
// [note, beats]
export const MELODY = [
  ['G4', 0.75], ['G4', 0.25], ['A4', 1], ['G4', 1], ['C5', 1], ['B4', 2],
  ['G4', 0.75], ['G4', 0.25], ['A4', 1], ['G4', 1], ['D5', 1], ['C5', 2],
  ['G4', 0.75], ['G4', 0.25], ['G5', 1], ['E5', 1], ['C5', 1], ['B4', 1], ['A4', 2],
  ['F5', 0.75], ['F5', 0.25], ['E5', 1], ['C5', 1], ['D5', 1], ['C5', 3],
];
// Bass chords, one per bar (3 beats), after the one-beat pickup.
const BASS = [['C4', 'G3'], ['G3', 'D4'], ['G3', 'D4'], ['C4', 'G3'], ['C4', 'E4'], ['F4', 'C4'], ['C4', 'G3'], ['G3', 'D4'], ['C4', 'G3']];

let ctx = null;
let master = null;
let playing = false;

function tone(freq, at, dur, { type = 'triangle', vol = 0.18 } = {}) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(vol, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(vol * 0.6, at + dur * 0.5);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur * 0.95);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + dur);
}

/** Plays the tune once. Resolves false if the browser still blocks sound (needs a tap first). */
export async function playTune() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
    if (ctx.state !== 'running') return false;
  } catch { return false; }
  if (playing) return true;
  playing = true;
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  const beat = 0.5;   // 120 bpm
  let t = ctx.currentTime + 0.1;
  const start = t;
  for (const [note, beats] of MELODY) {
    tone(N[note], t, beats * beat, { vol: 0.2 });
    tone(N[note] * 2, t, beats * beat * 0.8, { type: 'sine', vol: 0.04 });   // a little sparkle
    t += beats * beat;
  }
  BASS.forEach((chord, i) => chord.forEach((n) => tone(N[n] / 2, start + (1 + i * 3) * beat, 3 * beat, { type: 'sine', vol: 0.07 })));
  setTimeout(() => { playing = false; }, (t - ctx.currentTime + 0.3) * 1000);
  return true;
}
export function stopTune() {
  if (!master) return;
  try { master.gain.setTargetAtTime(0, ctx.currentTime, 0.05); } catch { /* ignore */ }
  master = null;
  playing = false;
}

// ------------------------------------------------------------ the party
let open = false;

/** Called whenever profiles / members change: throws the party once per day and per birthday. */
export function checkBirthdayParty() {
  if (open || !state.cls || !state.me || document.body.dataset.view !== 'app') return;
  const people = birthdaysToday();
  document.body.classList.toggle('bday-day', people.length > 0 && !calm());
  if (!people.length) return;
  const key = `${new Date().toDateString()}|${state.cls.id}|${people.map((m) => m.id).sort().join(',')}`;
  try { if (localStorage.getItem(SEEN) === key) return; localStorage.setItem(SEEN, key); } catch { /* private mode: party every time */ }
  party(people);
}

const COLORS = ['#ff4fd8', '#00d4ff', '#ffcf6b', '#3dffa8', '#7c5cff', '#ff6b3d'];
const rand = (a, b) => a + Math.random() * (b - a);

export function party(people) {
  open = true;
  const mine = people.some((m) => m.id === state.me.id);
  const others = people.filter((m) => m.id !== state.me.id);
  const names = people.map((m) => m.display_name);
  const title = mine && people.length === 1 ? `Joyeux anniversaire ${state.me.display_name} !`
    : `Joyeux anniversaire ${names.length > 1 ? names.slice(0, -1).join(', ') + ' et ' + names.at(-1) : names[0]} !`;
  const lite = calm();

  const musicBtn = h('button.btn.btn-ghost.btn-sm.bday-music', { type: 'button' }, '🎵 Musique');
  const startMusic = async () => {
    const ok = await playTune();
    musicBtn.textContent = ok ? '🔇 Couper la musique' : '▶️ Lancer la musique';
    musicBtn.classList.toggle('pulse', !ok);
    return ok;
  };
  musicBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (playing) { stopTune(); musicBtn.textContent = '🎵 Rejouer la musique'; } else startMusic();
  });

  const layer = h('div.bday-party', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    lite ? null : h('div.bday-confetti', Array.from({ length: 90 }, () => h('i', { style: {
      left: `${rand(0, 100)}%`, background: COLORS[Math.floor(rand(0, COLORS.length))], animationDelay: `${rand(0, 4)}s`,
      animationDuration: `${rand(3, 6)}s`, '--drift': `${rand(-120, 120)}px`, '--spin': `${rand(-720, 720)}deg`, width: `${rand(6, 11)}px`, height: `${rand(10, 16)}px`,
    } }))),
    lite ? null : h('div.bday-balloons', Array.from({ length: 14 }, (_, i) => h('span', { style: {
      left: `${(i * 7.3 + rand(0, 5)) % 96}%`, animationDelay: `${rand(0, 5)}s`, animationDuration: `${rand(7, 11)}s`, '--sway': `${rand(-40, 40)}px`,
      fontSize: `${rand(34, 58)}px`, filter: `hue-rotate(${Math.floor(rand(0, 360))}deg)`,
    } }, '🎈'))),
    h('div.bday-card',
      h('div.bday-avatars', people.slice(0, 4).map((m) => avatar(m, 84))),
      h('div.bday-cake', { 'aria-hidden': 'true' }, '🎂'),
      h('h2.bday-title', title),
      h('p.bday-sub', mine
        ? (others.length ? `Et c'est aussi l'anniversaire de ${others.map((m) => m.display_name).join(', ')} ! Toute la classe vous le souhaite 🥳` : 'Toute la classe te souhaite une super journée 🥳✨')
        : 'Toute la classe fait la fête 🥳 Souhaite-le dans le chat !'),
      h('div.bday-actions',
        others.length ? h('button.btn.btn-primary', { type: 'button', onclick: (e) => {
          e.stopPropagation();
          close();
          emit('goto', 'chat');
          setTimeout(() => insertInComposer(`🎉🎂 Joyeux anniversaire ${others.map((m) => m.display_name).join(' et ')} ! 🥳🎈 `), 200);
        } }, '💬 Le souhaiter dans le chat') : null,
        musicBtn,
        h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: (e) => { e.stopPropagation(); close(); } }, 'Fermer'))));

  function close() {
    stopTune();
    layer.classList.add('out');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { layer.remove(); open = false; }, 500);
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.body.append(layer);
  requestAnimationFrame(() => layer.classList.add('in'));
  state.space?.celebrate?.(!lite);

  // Music: right away if the browser allows it, otherwise at the first tap on the party.
  if (displayPrefs().bdayMusic !== false) {
    startMusic().then((ok) => {
      if (ok) return;
      layer.addEventListener('pointerdown', () => { if (!playing) startMusic(); }, { once: true });
    });
  } else {
    musicBtn.textContent = '🎵 Musique';
  }
  setTimeout(() => { if (layer.isConnected) close(); }, 30000);
}
