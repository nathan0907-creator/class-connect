// XP, daily streak, badges, weekly challenges and the class mascot. Counters are kept per member in stats/{uid}
// (written only by that member): it's a game between classmates, not a grade.
import { onSnapshot, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { sub, plain } from './fb.js';
import { state, on, emit } from './state.js';
import { h, toast } from './ui.js';
import { dayIndex, weekIndex, challengesOfTheWeek } from './daily.js';
import { play } from './sounds.js';

export const XP = { messages: 2, voice: 5, reactions: 1, votes: 3, qotd: 10, compliments: 10, quizzes: 15, games: 10, cards: 1, pomodoros: 20 };
const COUNTERS = Object.keys(XP);

export const BADGES = [
  { id: 'first', emoji: '🚀', name: 'Décollage', text: 'Premier message', ok: (t) => t.messages >= 1 },
  { id: 'chatty', emoji: '💬', name: 'Bavard', text: '100 messages', ok: (t) => t.messages >= 100 },
  { id: 'legend', emoji: '🌟', name: 'Légende du chat', text: '1 000 messages', ok: (t) => t.messages >= 1000 },
  { id: 'voice', emoji: '🎤', name: 'Voix de l\'espace', text: 'Premier vocal', ok: (t) => t.voice >= 1 },
  { id: 'react', emoji: '❤️', name: 'Réactif', text: '50 réactions', ok: (t) => t.reactions >= 50 },
  { id: 'voter', emoji: '🗳️', name: 'Citoyen', text: '10 votes à des sondages', ok: (t) => t.votes >= 10 },
  { id: 'thinker', emoji: '🤔', name: 'Philosophe', text: '10 questions du jour', ok: (t) => t.qotd >= 10 },
  { id: 'kind', emoji: '💐', name: 'Bienveillant', text: '5 compliments', ok: (t) => t.compliments >= 5 },
  { id: 'reviser', emoji: '📚', name: 'Révisionniste', text: '10 quiz de révision', ok: (t) => t.quizzes >= 10 },
  { id: 'gamer', emoji: '🎮', name: 'Joueur', text: '10 parties de mini-jeux', ok: (t) => t.games >= 10 },
  { id: 'memory', emoji: '🐘', name: 'Mémoire d\'éléphant', text: '200 flashcards', ok: (t) => t.cards >= 200 },
  { id: 'focus', emoji: '🍅', name: 'Concentré', text: '5 sessions « on révise ensemble »', ok: (t) => t.pomodoros >= 5 },
  { id: 'streak7', emoji: '🔥', name: 'Semaine de feu', text: '7 jours d\'affilée', ok: (t, s) => s.best_streak >= 7 },
  { id: 'streak30', emoji: '☄️', name: 'Comète', text: '30 jours d\'affilée', ok: (t, s) => s.best_streak >= 30 },
  { id: 'xp1000', emoji: '🪐', name: 'Astronaute', text: '1 000 XP', ok: (t, s) => s.xp >= 1000 },
  { id: 'xp10000', emoji: '👑', name: 'Commandant', text: '10 000 XP', ok: (t, s) => s.xp >= 10000 },
];
const LEVELS = [0, 100, 300, 700, 1500, 3000, 6000, 10000, 16000, 25000];
export const levelOf = (xp) => { let l = 0; while (l + 1 < LEVELS.length && xp >= LEVELS[l + 1]) l++; return l + 1; };

export let allStats = new Map();   // uid -> stats
let unsub = null;
let pending = null;
let timer = null;
const empty = () => ({ xp: 0, streak: 0, best_streak: 0, last_day: 0, week: weekIndex(), w: {}, total: {}, badges: [] });
const mine = () => allStats.get(state.me?.id) || empty();
const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

export function startStats() {
  stopStats();
  let first = true;
  unsub = onSnapshot(sub(state.cls.id, 'stats'), (snap) => {
    allStats = new Map(snap.docs.map((d) => [d.id, plain(d)]));
    emit('stats');
    if (first) { first = false; checkIn(); }
  }, () => {});
}
export function stopStats() { unsub?.(); unsub = null; allStats = new Map(); }

on('activity', (type) => {
  if (!state.cls || !COUNTERS.includes(type)) return;
  pending ||= {};
  pending[type] = (pending[type] || 0) + 1;
  clearTimeout(timer);
  timer = setTimeout(flush, 4000);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

/** Daily visit: +5 XP and the streak goes on (or starts again). */
function checkIn() {
  const s = mine();
  const today = dayIndex();
  if (s.last_day === today) return;
  pending ||= {};
  pending._day = true;
  flush();
}

async function flush() {
  clearTimeout(timer);
  if (!pending || !state.cls || state.me?.status !== 'active') return;
  const add = pending;
  pending = null;
  const s = { ...empty(), ...mine() };
  const week = weekIndex();
  const w = s.week === week ? { ...s.w } : {};
  const total = { ...s.total };
  let xp = n(s.xp);
  for (const k of COUNTERS) {
    if (!add[k]) continue;
    w[k] = n(w[k]) + add[k];
    total[k] = n(total[k]) + add[k];
    xp += XP[k] * add[k];
  }
  let { streak, best_streak: best, last_day: last } = s;
  const today = dayIndex();
  if (add._day && last !== today) {
    streak = last === today - 1 ? n(streak) + 1 : 1;
    best = Math.max(n(best), streak);
    last = today;
    xp += 5 + Math.min(streak, 30);
  }
  // Weekly challenges completed now: +50 XP each (once).
  const before = challengesOfTheWeek().filter((c) => c.check(s.week === week ? s.w || {} : {}));
  const after = challengesOfTheWeek().filter((c) => c.check(w));
  for (const c of after) if (!before.includes(c)) { xp += 50; toast(`🏅 Défi de la semaine réussi : ${c.text} (+50 XP)`, 'success', 6000); }
  const next = { xp: Math.min(xp, 10000000), streak: n(streak), best_streak: n(best), last_day: n(last), week, w, total, badges: [] };
  next.badges = BADGES.filter((b) => b.ok(total, next)).map((b) => b.id);
  for (const id of next.badges) if (!(s.badges || []).includes(id)) {
    const b = BADGES.find((x) => x.id === id);
    toast(`${b.emoji} Nouveau badge : ${b.name} !`, 'success', 6000);
  }
  if (levelOf(next.xp) > levelOf(n(s.xp)) && s.xp) { toast(`⬆️ Niveau ${levelOf(next.xp)} atteint !`, 'success', 5000); play('level'); }
  allStats.set(state.me.id, next);
  try { await setDoc(doc(sub(state.cls.id, 'stats'), state.me.id), { ...next, updated_at: serverTimestamp() }); } catch { /* retried next time */ }
}

// ------------------------------------------------------------ widgets
export function statsOf(uid) { return allStats.get(uid) || empty(); }

export function badgeList(uid) {
  const s = statsOf(uid);
  return BADGES.filter((b) => (s.badges || []).includes(b.id));
}

/** Class leaderboard (XP) — for fun. */
export function leaderboard() {
  const rows = [...state.members.values()].filter((m) => m.status === 'active')
    .map((m) => ({ m, s: statsOf(m.id) })).sort((a, b) => n(b.s.xp) - n(a.s.xp));
  return h('ol.leaderboard', rows.map(({ m, s }, i) => h(`li${m.id === state.me.id ? '.me' : ''}`,
    h('span.rank', i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}`),
    h('b', m.display_name),
    h('small', `niv. ${levelOf(n(s.xp))} · ${n(s.xp)} XP${n(s.streak) > 1 ? ` · 🔥 ${s.streak}` : ''}`),
    h('span.lb-badges', badgeList(m.id).map((b) => b.emoji).join('')))));
}

export function myProgress() {
  const s = mine();
  const lvl = levelOf(n(s.xp));
  const from = LEVELS[lvl - 1];
  const to = LEVELS[lvl] ?? from;
  const pct = to > from ? Math.round(((n(s.xp) - from) / (to - from)) * 100) : 100;
  const week = s.week === weekIndex() ? s.w || {} : {};
  return h('div.my-progress',
    h('div.level', h('b', `Niveau ${lvl}`), h('span', `${n(s.xp)} XP`), n(s.streak) ? h('span.streak', `🔥 ${s.streak} jour${s.streak > 1 ? 's' : ''}`) : null),
    h('div.xp-bar', h('i', { style: { width: `${pct}%` } })),
    h('h4', 'Défis de la semaine (+50 XP chacun)'),
    h('ul.challenges', challengesOfTheWeek().map((c) => h(`li${c.check(week) ? '.done' : ''}`, c.check(week) ? '✅ ' : '⬜ ', c.text))),
    h('h4', 'Mes badges'),
    h('div.badges', BADGES.map((b) => h(`span.badge-chip${(s.badges || []).includes(b.id) ? '.got' : ''}`, { title: b.text }, b.emoji, h('small', b.name)))));
}

// ------------------------------------------------------------ the class mascot, fed by everyone's XP
const STAGES = [
  [0, '🥚', 'un œuf mystérieux'], [500, '🐣', 'un bébé astro'], [2000, '🐥', 'un petit pilote'],
  [6000, '🦅', 'un aigle de l\'espace'], [15000, '🐉', 'un dragon cosmique'], [40000, '🌌', 'une galaxie vivante'],
];
export function mascot() {
  const xp = [...allStats.values()].reduce((sum, s) => sum + n(s.xp), 0);
  let i = 0;
  while (i + 1 < STAGES.length && xp >= STAGES[i + 1][0]) i++;
  const next = STAGES[i + 1];
  const pct = next ? Math.round(((xp - STAGES[i][0]) / (next[0] - STAGES[i][0])) * 100) : 100;
  return h('div.mascot',
    h('div.mascot-body', { 'aria-hidden': 'true' }, STAGES[i][1]),
    h('div',
      h('b', 'Astro, la mascotte de la classe'),
      h('p.muted.small', `C'est ${STAGES[i][2]} ! Toute la classe le fait grandir en gagnant de l'XP (${xp} XP en tout).`),
      next ? h('div.xp-bar', h('i', { style: { width: `${pct}%` } })) : h('p.small', 'Stade final atteint 🎉'),
      next ? h('small.muted', `Prochaine évolution à ${next[0]} XP`) : null));
}
