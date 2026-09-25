// Extra revision tools: flashcards (spaced repetition), mind map, photo of an exercise, revision planning,
// "on révise ensemble" (shared Pomodoro timer), collaborative whiteboard and a private grade book.
import {
  onSnapshot, query, orderBy, limit, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc, doc, serverTimestamp, Timestamp, deleteField,
} from 'firebase/firestore';
import { ref as rref, push, onChildAdded, onValue, set as rset } from 'firebase/database';
import { db, sub, plain, rtdb } from './fb.js';
import { state, emit, memberName } from './state.js';
import { h, modal, toast, toastError, confirmDialog, fmtDay } from './ui.js';
import { seal, unseal, txt } from './vault.js';
import { encryptJSON, decryptJSON, personalKey, toB64 } from './crypto.js';
import { generate } from './ai.js';
import { renderMarkdown } from './md.js';
import { compressImage } from './media.js';
import { allEvents, daysUntil } from './events.js';
import { Schema } from 'firebase/ai';

const col = (name) => sub(state.cls.id, name);

// ------------------------------------------------------------ AI formats
export const flashSchema = Schema.object({
  properties: { title: Schema.string(), cards: Schema.array({ items: Schema.object({ properties: { front: Schema.string(), back: Schema.string() } }) }) },
});
export const mindSchema = Schema.object({
  properties: {
    title: Schema.string(),
    branches: Schema.array({ items: Schema.object({ properties: {
      title: Schema.string(),
      items: Schema.array({ items: Schema.object({ properties: { title: Schema.string(), details: Schema.array({ items: Schema.string() }) } }) }),
    } }) }),
  },
});

// ------------------------------------------------------------ flashcards (Leitner boxes, progress kept on this device)
const BOX_DAYS = [0, 1, 3, 7, 14, 30];
const progressKey = (deckId) => `cc-srs-${state.cls.id}-${deckId}`;
const loadProgress = (deckId) => { try { return JSON.parse(localStorage.getItem(progressKey(deckId)) || '{}'); } catch { return {}; } };
const saveProgress = (deckId, p) => { try { localStorage.setItem(progressKey(deckId), JSON.stringify(p)); } catch { /* ignore */ } };

/** Generated from the selected courses, then saved for the whole class (encrypted). */
export async function makeFlashcards(docs, system, count, focus) {
  const res = await generate([...docs, { text: `Crée ${count} FLASHCARDS de révision à partir des documents ci-dessus${focus ? `, sur « ${focus} »` : ''}. Recto : une question courte ou une notion. Verso : la réponse exacte du cours (définition, formule, date, méthode), courte. Formules en LaTeX entre $…$. Rien qui ne soit pas dans les documents.` }],
    { system, schema: flashSchema, temperature: 0.3 });
  const cards = (res.cards || []).map((c) => ({ front: txt(c.front, 300), back: txt(c.back, 600) })).filter((c) => c.front && c.back).slice(0, 60);
  if (!cards.length) throw new Error('L\'IA n\'a pas réussi à créer de cartes : sélectionne d\'autres cours.');
  const title = txt(res.title, 80) || 'Flashcards';
  const ref = await addDoc(col('decks'), { by: state.me.id, count: cards.length, ...(await seal('deck', { title, cards })), created_at: serverTimestamp() });
  return { id: ref.id, title, cards };
}

export async function openDecks() {
  const list = h('div.post-list', h('div.spinner'));
  const m = modal({ title: '🃏 Paquets de flashcards de la classe', wide: true, body: h('div.slot-form', h('p.hint', 'Crée un paquet depuis l\'outil « Flashcards » (à partir des cours cochés). Ta progression est gardée sur cet appareil.'), list) });
  try {
    const rows = (await getDocs(query(col('decks'), orderBy('created_at', 'desc'), limit(40)))).docs.map(plain);
    const items = await Promise.all(rows.map(async (r) => {
      const d = await unseal('deck', r);
      if (!d || !Array.isArray(d.cards)) return null;
      const deck = { id: r.id, title: txt(d.title, 80), cards: d.cards.map((c) => ({ front: txt(c?.front, 300), back: txt(c?.back, 600) })).filter((c) => c.front) };
      const due = dueCards(deck).length;
      return h('div.post', h('b', deck.title), h('small', ` · ${deck.cards.length} cartes · par ${memberName(r.by)} · ${due} à revoir`),
        h('div.btn-row', h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => { m.close(); study(deck); } }, 'Réviser'),
          r.by === state.me.id ? h('button.link-btn', { type: 'button', onclick: () => deleteDoc(doc(col('decks'), r.id)).then(() => { m.close(); openDecks(); }).catch(toastError) }, 'Supprimer') : null));
    }));
    list.replaceChildren(...(items.filter(Boolean).length ? items.filter(Boolean) : [h('p.muted.small', 'Aucun paquet pour l\'instant.')]));
  } catch (err) { list.replaceChildren(h('p.form-error', err.message)); }
}

function dueCards(deck) {
  const p = loadProgress(deck.id);
  const now = Date.now();
  return deck.cards.map((c, i) => ({ ...c, i, box: p[i]?.box || 0, due: p[i]?.due || 0 })).filter((c) => c.due <= now);
}

export function study(deck) {
  const queue = dueCards(deck).sort((a, b) => a.box - b.box);
  const box = h('div.flash-box');
  let flipped = false;
  let done = 0;
  const show = () => {
    const c = queue[0];
    if (!c) {
      box.replaceChildren(h('div.flash-done', h('p.big', '🎉 Rien à revoir pour l\'instant !'), h('p.muted', `${done} carte(s) révisée(s). Reviens plus tard : les cartes reviennent au bon moment pour mieux mémoriser.`)));
      return;
    }
    flipped = false;
    const card = h('button.flash-card', { type: 'button', onclick: () => { flipped = !flipped; card.classList.toggle('flipped', flipped); rate.hidden = !flipped; } },
      h('div.flash-face.front', renderMarkdown(c.front)), h('div.flash-face.back', renderMarkdown(c.back)));
    const answer = (grade) => {
      const p = loadProgress(deck.id);
      const nextBox = grade === 0 ? 0 : Math.min(BOX_DAYS.length - 1, c.box + (grade === 2 ? 2 : 1));
      p[c.i] = { box: nextBox, due: Date.now() + BOX_DAYS[nextBox] * 864e5 };
      saveProgress(deck.id, p);
      queue.shift();
      if (grade === 0) queue.push({ ...c, box: 0 });
      done++;
      emit('activity', 'cards');
      show();
    };
    const rate = h('div.btn-row.flash-rate', { hidden: true },
      h('button.btn.btn-ghost', { type: 'button', onclick: () => answer(0) }, '😵 Pas su'),
      h('button.btn.btn-ghost', { type: 'button', onclick: () => answer(1) }, '🤔 Difficile'),
      h('button.btn.btn-primary', { type: 'button', onclick: () => answer(2) }, '😎 Facile'));
    box.replaceChildren(h('p.muted.small', `${queue.length} carte(s) à revoir · touche la carte pour la retourner`), card, rate,
      h('button.link-btn', { type: 'button', onclick: () => speak(`${c.front}. ${flipped ? c.back : ''}`) }, '🔊 Écouter'));
  };
  show();
  modal({ title: `🃏 ${deck.title}`, wide: true, body: box });
}

// ------------------------------------------------------------ mind map
export async function makeMindMap(docs, system, focus) {
  const res = await generate([...docs, { text: `Fais une CARTE MENTALE du cours ci-dessus${focus ? `, centrée sur « ${focus} »` : ''} : un titre central, 3 à 7 branches, chacune avec 2 à 6 éléments, et pour chaque élément 0 à 3 détails très courts (mots-clés, formules en $…$). Uniquement le contenu des documents.` }],
    { system, schema: mindSchema, temperature: 0.3 });
  return {
    title: txt(res.title, 80) || 'Carte mentale',
    branches: (res.branches || []).slice(0, 8).map((b) => ({
      title: txt(b.title, 80),
      items: (b.items || []).slice(0, 8).map((i) => ({ title: txt(i.title, 100), details: (i.details || []).slice(0, 4).map((d) => txt(d, 120)) })),
    })),
  };
}
const BRANCH_COLORS = ['#7c5cff', '#00d4ff', '#ff4fd8', '#ffb547', '#3dffa8', '#ff6b6b', '#5b8cff', '#c77dff'];
export function renderMindMap(map) {
  return h('div.mindmap',
    h('div.mm-center', renderMarkdown(map.title)),
    h('div.mm-branches', map.branches.map((b, i) => h('div.mm-branch', { style: { '--c': BRANCH_COLORS[i % BRANCH_COLORS.length] } },
      h('div.mm-branch-title', renderMarkdown(b.title)),
      h('ul', b.items.map((it) => h('li', renderMarkdown(it.title), it.details.length ? h('ul', it.details.map((d) => h('li', renderMarkdown(d)))) : null)))))));
}

// ------------------------------------------------------------ photo of an exercise
export async function explainPhoto(file, docs, system) {
  if (!file || !file.type.startsWith('image/') || /svg/i.test(file.type)) throw new Error('Choisis une photo de l\'exercice');
  const img = await compressImage(file, 2000);
  const data = toB64(new Uint8Array(await img.arrayBuffer()));
  return generate([...docs, { inlineData: { mimeType: img.type || 'image/jpeg', data } },
    { text: `La dernière image est la photo d'un EXERCICE de l'élève. Explique comment le résoudre PAS À PAS, en utilisant EXACTEMENT les méthodes et notations des documents de cours ci-dessus${docs.length ? '' : ' (aucun cours sélectionné : reste simple et prudent, et signale-le)'}. Ne donne pas seulement le résultat : fais comprendre chaque étape, puis donne la réponse finale. Markdown, formules en $…$.` }],
  { system, temperature: 0.2 });
}

// ------------------------------------------------------------ revision planning (from the countdowns)
export function openPlanning() {
  const tests = allEvents().filter((e) => e.kind === 'controle' && daysUntil(e.date) >= 1).sort((a, b) => a.date.localeCompare(b.date));
  const plan = (n) => [[7, '📄 Fiche de révision du chapitre'], [5, '🃏 Flashcards (1re série)'], [3, '❓ Quiz de 10 questions'], [2, '🃏 Flashcards (les cartes ratées)'], [1, '📝 Évaluation blanche + corrections']]
    .filter(([d]) => d < n).map(([d, what]) => ({ d, what }));
  const body = tests.length ? tests.map((t) => {
    const n = daysUntil(t.date);
    const steps = plan(n);
    return h('div.post', h('b', `📝 ${t.title}`), h('small', ` · dans ${n} jour${n > 1 ? 's' : ''}`),
      h('ol.plan', steps.map((s) => {
        const at = new Date(); at.setHours(18, 0, 0, 0); at.setDate(at.getDate() + (n - s.d));
        return h('li', h('b', at.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })), ` — ${s.what}`);
      })),
      steps.length ? h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          for (const s of steps) {
            const at = new Date(); at.setHours(18, 0, 0, 0); at.setDate(at.getDate() + (n - s.d));
            if (at <= Date.now()) continue;
            await addDoc(col('reminders'), { user_id: state.me.id, at: Timestamp.fromDate(at), ...(await seal('reminder', { text: `${s.what} — ${t.title}` })), created_at: serverTimestamp() });
          }
          toast('Rappels ajoutés : une notification à chaque étape ⏰', 'success');
        } catch (err) { toastError(err); btn.disabled = false; }
      } }, '⏰ M\'envoyer un rappel à chaque étape') : h('p.hint', 'C\'est très bientôt : fais un quiz et une évaluation blanche dès aujourd\'hui !'));
  }) : [h('p.muted', 'Aucun contrôle à venir : les délégués peuvent en ajouter dans les comptes à rebours (onglet Emploi du temps).')];
  modal({ title: '📅 Mon planning de révision', wide: true, body: h('div.post-list', body) });
}

// ------------------------------------------------------------ "on révise ensemble" (shared Pomodoro)
export function openStudyRoom() {
  const ref = doc(col('study_room'), 'current');
  const box = h('div.study-room', h('div.spinner'));
  let unsub = null;
  let tick = null;
  let room = null;
  let lastPhase = null;
  const phaseOf = (r) => {
    if (!r?.start) return null;
    const cycle = (r.focus + r.pause) * 60000;
    const t = Date.now() - r.start;
    if (t < 0 || t >= cycle * r.rounds) return { ended: true };
    const inCycle = t % cycle;
    const focus = inCycle < r.focus * 60000;
    return { round: Math.floor(t / cycle) + 1, focus, left: focus ? r.focus * 60000 - inCycle : cycle - inCycle };
  };
  const draw = () => {
    const p = phaseOf(room);
    const people = Object.keys(room?.people || {}).filter((u) => room.people[u]);
    const joined = people.includes(state.me.id);
    if (p && !p.ended && lastPhase?.focus && !p.focus && joined) { emit('activity', 'pomodoros'); navigator.vibrate?.([80, 60, 80]); toast('🍅 Pause ! Bien joué', 'success'); }
    if (p && !p.ended && lastPhase && !lastPhase.focus && p.focus && joined) { navigator.vibrate?.(80); toast('📚 C\'est reparti !', 'info'); }
    lastPhase = p;
    const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
    box.replaceChildren(
      !p || p.ended ? h('div.slot-form', h('p', 'Aucune session en cours. Lance-en une : tout le monde voit le même minuteur, et on bosse ensemble !'),
        h('div.btn-row', [[25, 5, 4, '25 min + 5 min (×4)'], [50, 10, 2, '50 min + 10 min (×2)'], [15, 5, 3, '15 min + 5 min (×3)']].map(([f, pa, r, l]) => h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () =>
          setDoc(ref, { by: state.me.id, focus: f, pause: pa, rounds: r, start: Date.now() + 5000, people: { [state.me.id]: true }, updated_at: serverTimestamp() }).catch(toastError) }, l))))
        : h('div.pomodoro', { class: p.focus ? 'focus' : 'pause' },
          h('p.pomo-phase', p.focus ? `📚 Concentration · tour ${p.round}/${room.rounds}` : `☕ Pause · tour ${p.round}/${room.rounds}`),
          h('p.pomo-time', mmss(p.left)),
          h('p.muted.small', `${people.length} en train de réviser : ${people.map(memberName).join(', ')}`),
          h('div.btn-row',
            h('button.btn.btn-sm', { class: joined ? 'btn-ghost' : 'btn-primary', type: 'button', onclick: () => updateDoc(ref, { [`people.${state.me.id}`]: joined ? deleteField() : true, updated_at: serverTimestamp() }).catch(toastError) }, joined ? 'Quitter la session' : 'Rejoindre'),
            room.by === state.me.id ? h('button.link-btn', { type: 'button', onclick: () => deleteDoc(ref).catch(toastError) }, 'Arrêter pour tout le monde') : null)));
  };
  modal({ title: '🍅 On révise ensemble', wide: true, body: box, onClose: () => { unsub?.(); clearInterval(tick); } });
  unsub = onSnapshot(ref, (snap) => { room = snap.exists() ? plain(snap) : null; if (room) room.start = snap.get('start'); draw(); }, (err) => box.replaceChildren(h('p.form-error', err.message)));
  tick = setInterval(draw, 1000);
}

// ------------------------------------------------------------ collaborative whiteboard (encrypted strokes, live)
export function openWhiteboard() {
  if (!rtdb) return toast('Tableau indisponible', 'error');
  const W = 1200, H = 800;
  const canvas = h('canvas.board-canvas', { width: W, height: H, 'aria-label': 'Tableau blanc partagé' });
  const ctx = canvas.getContext('2d');
  let color = '#111111';
  let size = 4;
  let points = [];
  let clearedAt = 0;
  const base = `boards/${state.cls.id}`;
  const offs = [];
  const bg = () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); };
  bg();
  const stroke = (s) => {
    if (!Array.isArray(s.p) || s.p.length < 2) return;
    ctx.strokeStyle = /^#[0-9a-f]{6}$/i.test(s.c) ? s.c : '#111111';
    ctx.lineWidth = Math.min(40, Math.max(1, Number(s.w) || 3));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s.p[0], s.p[1]);
    for (let i = 2; i + 1 < s.p.length; i += 2) ctx.lineTo(s.p[i], s.p[i + 1]);
    ctx.stroke();
  };
  const key = () => state.classKeys.get(state.cls.key_epoch);
  const aad = (by) => `board|${state.cls.id}|${by}`;
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * (W / r.width)), Math.round((e.clientY - r.top) * (H / r.height))]; };
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); points = at(e); });
  canvas.addEventListener('pointermove', (e) => {
    if (!points.length) return;
    const [x, y] = at(e);
    const [px, py] = points.slice(-2);
    ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
    points.push(x, y);
  });
  const end = async () => {
    if (points.length < 4) { points = []; return; }
    const s = { p: points.slice(0, 2000), c: color, w: size };
    points = [];
    try {
      const enc = await encryptJSON(key(), s, aad(state.me.id));
      await push(rref(rtdb, `${base}/strokes`), { by: state.me.id, e: state.cls.key_epoch, iv: enc.iv, ct: enc.ciphertext, t: Date.now() });
    } catch { toast('Trait non envoyé', 'error'); }
  };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => canvas.addEventListener(t, end));
  const pens = h('div.draw-colors', ['#111111', '#ff5f7a', '#2b7bff', '#1fa971', '#ff9f1c', '#8e44ad', '#ffffff'].map((c) => h('button.swatch', {
    type: 'button', style: { '--c': c }, 'aria-label': c === '#ffffff' ? 'Gomme' : `Couleur ${c}`,
    onclick: () => { color = c; size = c === '#ffffff' ? 30 : 4; },
  })));
  modal({
    title: '🧑‍🏫 Tableau blanc de la classe', wide: true,
    body: h('div.draw-box', canvas, h('div.draw-tools', pens,
      h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: async () => {
        if (!(await confirmDialog('Effacer le tableau ?', 'Il sera effacé pour tout le monde.', { danger: false, label: 'Effacer' }))) return;
        rset(rref(rtdb, `${base}/cleared_at`), Date.now()).catch(toastError);
      } }, 'Tout effacer'),
      h('small.muted', 'Tout le monde dessine en direct. Les traits sont chiffrés comme les messages.'))),
    onClose: () => offs.forEach((o) => o()),
  });
  offs.push(onValue(rref(rtdb, `${base}/cleared_at`), (snap) => {
    clearedAt = Number(snap.val()) || 0;
    bg();
    redraw();
  }));
  const strokes = [];
  const redraw = () => strokes.filter((s) => s.t > clearedAt).forEach((s) => stroke(s));
  offs.push(onChildAdded(rref(rtdb, `${base}/strokes`), async (snap) => {
    const v = snap.val() || {};
    const k = state.classKeys.get(v.e);
    if (!k || typeof v.iv !== 'string' || typeof v.ct !== 'string') return;
    try {
      const s = await decryptJSON(k, v.iv, v.ct, aad(v.by));
      s.t = Number(v.t) || 0;
      strokes.push(s);
      if (s.t > clearedAt) stroke(s);
    } catch { /* not from this class */ }
  }));
}

// ------------------------------------------------------------ private grade book (only I can read it)
async function gradeKey() { return personalKey(state.privateKey, state.me.public_key, `grades|${state.me.id}`); }
const gradesRef = () => doc(db, 'private_data', state.me.id);
async function loadGrades() {
  const snap = await getDoc(gradesRef());
  if (!snap.exists()) return [];
  try {
    const data = await decryptJSON(await gradeKey(), snap.get('iv'), snap.get('ciphertext'), `grades|${state.me.id}`);
    return Array.isArray(data?.grades) ? data.grades : [];
  } catch { return null; }
}
async function saveGrades(grades) {
  const enc = await encryptJSON(await gradeKey(), { grades }, `grades|${state.me.id}`);
  await setDoc(gradesRef(), { iv: enc.iv, ciphertext: enc.ciphertext, updated_at: serverTimestamp() });
}
/** Weighted average out of 20. */
export function average(list) {
  let sum = 0, coef = 0;
  for (const g of list) {
    const v = Number(g.value), max = Number(g.max) || 20, c = Number(g.coef) || 1;
    if (!Number.isFinite(v) || max <= 0) continue;
    sum += (v / max) * 20 * c;
    coef += c;
  }
  return coef ? sum / coef : null;
}

export async function openGrades() {
  const box = h('div.slot-form', h('div.spinner'));
  modal({ title: '📒 Mon carnet de notes', wide: true, body: box });
  let grades = await loadGrades().catch(() => null);
  if (grades === null) { box.replaceChildren(h('p.form-error', 'Carnet illisible (mot de passe réinitialisé ?). Tu peux en recommencer un nouveau.'), h('button.btn.btn-ghost', { type: 'button', onclick: async () => { await saveGrades([]); grades = []; draw(); } }, 'Recommencer à zéro')); return; }
  const subject = h('input', { maxLength: 40, placeholder: 'Matière', list: 'grade-subjects' });
  const value = h('input', { type: 'number', min: 0, max: 100, step: 0.25, placeholder: 'Note' });
  const max = h('input', { type: 'number', min: 1, max: 100, value: 20, 'aria-label': 'Sur' });
  const coef = h('input', { type: 'number', min: 0.25, max: 10, step: 0.25, value: 1, 'aria-label': 'Coefficient' });
  const draw = () => {
    const subjects = [...new Set(grades.map((g) => g.subject))].sort((a, b) => a.localeCompare(b, 'fr'));
    const overall = average(subjects.map((s) => ({ value: average(grades.filter((g) => g.subject === s)), max: 20, coef: 1 })));
    box.replaceChildren(
      h('p.hint', '🔒 Chiffré avec ta clé personnelle : personne d\'autre (ni la classe, ni le serveur) ne peut le lire.'),
      h('div.post-form.grade-form', subject, value, h('span', 'sur'), max, h('span', 'coef.'), coef,
        h('datalist#grade-subjects', subjects.map((s) => h('option', { value: s }))),
        h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: async () => {
          const g = { subject: subject.value.trim(), value: Number(value.value), max: Number(max.value) || 20, coef: Number(coef.value) || 1, date: new Date().toISOString().slice(0, 10) };
          if (!g.subject || !Number.isFinite(g.value) || value.value === '' || g.value > g.max) return toast('Matière et note valides, s\'il te plaît', 'error');
          grades = [...grades, g].slice(-500);
          try { await saveGrades(grades); value.value = ''; draw(); } catch (err) { toastError(err); }
        } }, 'Ajouter')),
      h('div.grade-overall', h('b', 'Moyenne générale : '), overall == null ? '—' : `${overall.toFixed(2)} / 20`),
      h('div.post-list', subjects.map((s) => {
        const list = grades.map((g, i) => ({ ...g, i })).filter((g) => g.subject === s);
        const avg = average(list);
        return h('div.post', h('b', `${s} — ${avg == null ? '—' : `${avg.toFixed(2)} / 20`}`),
          h('div.grade-chips', list.map((g) => h('button.grade-chip', { type: 'button', title: `${g.date} · coef. ${g.coef} · toucher pour supprimer`, onclick: async () => {
            if (!(await confirmDialog('Supprimer cette note ?', `${g.value}/${g.max} en ${g.subject}`, { label: 'Supprimer' }))) return;
            grades = grades.filter((_, k) => k !== g.i);
            await saveGrades(grades).catch(toastError);
            draw();
          } }, `${g.value}/${g.max}${g.coef !== 1 ? ` (×${g.coef})` : ''}`))));
      })));
  };
  draw();
}

// ------------------------------------------------------------ read aloud
export function speak(text) {
  if (!('speechSynthesis' in window)) return toast('Lecture à voix haute indisponible sur cet appareil', 'error');
  speechSynthesis.cancel();
  const clean = String(text).replace(/\$+([^$]*)\$+/g, '$1').replace(/[#*_`>|]/g, ' ').slice(0, 30000);
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'fr-FR';
  u.rate = 1;
  speechSynthesis.speak(u);
}
export const stopSpeaking = () => { if ('speechSynthesis' in window) speechSynthesis.cancel(); };
