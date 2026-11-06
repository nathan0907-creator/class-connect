// 📚 Cahier de devoirs de la classe: anyone adds a homework, a test or something to read, for a date; everyone sees
// it (encrypted with the class key, like the timetable alerts) and ticks it off on their own device. The date proposed
// is the next lesson of that subject, read from the timetable. Old entries are cleaned up by the delegates' devices.
import { onSnapshot, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { sub, plain } from './fb.js';
import { state, on, emit, isDelegate, isDeputy, isTeacher, memberName } from './state.js';
import { seal, unseal, txt } from './vault.js';
import { allSlots, slotsOn, ymd } from './timetable.js';
import { $, h, toast, toastError, modal, confirmDialog, linkify } from './ui.js';
import { notify } from './notify.js';

export const KINDS = {
  devoir: { label: 'Devoir', ico: '📝' },
  controle: { label: 'Contrôle', ico: '🧪' },
  lecture: { label: 'À lire / apprendre', ico: '📖' },
  oral: { label: 'Exposé / oral', ico: '🎤' },
};
let rows = [];            // decrypted entries
let raw = [];
let unsub = null;
let box = null;
let showDone = false;

const col = () => sub(state.cls.id, 'homework');
const canAdmin = () => isDelegate() || isDeputy() || isTeacher();
const doneKey = () => `cc-hw-done-${state.cls?.id}`;
function doneSet() { try { return new Set(JSON.parse(localStorage.getItem(doneKey()) || '[]')); } catch { return new Set(); } }
function setDone(id, yes) {
  const s = doneSet();
  if (yes) s.add(id); else s.delete(id);
  try { localStorage.setItem(doneKey(), JSON.stringify([...s].slice(-400))); } catch { /* ignore */ }
}
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => ymd(new Date());
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const subjects = () => [...new Set(allSlots().map((s) => s.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
const colorOf = (subject) => allSlots().find((s) => s.subject === subject)?.color || '#7c5cff';

/** Date of the next lesson of a subject (after today), from the timetable — what « pour le prochain cours » means. */
export function nextLesson(subject, from = new Date()) {
  for (let i = 1; i <= 21; i++) {
    const d = addDays(from, i);
    if (slotsOn(d).some((s) => s.subject === subject)) return ymd(d);
  }
  return null;
}

function dueLabel(due) {
  const days = Math.round((parse(due) - parse(today())) / 864e5);
  if (days < 0) return { text: 'Passé', cls: 'past' };
  if (days === 0) return { text: 'Aujourd\'hui', cls: 'soon' };
  if (days === 1) return { text: 'Demain', cls: 'soon' };
  const d = parse(due);
  const name = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
  return { text: days < 7 ? name[0].toUpperCase() + name.slice(1) : `Dans ${days} j · ${name}`, cls: days <= 3 ? 'near' : '' };
}

// ------------------------------------------------------------ lifecycle
export function initHomework() {
  box = $('[data-homework]');
  $('[data-next-hw]')?.addEventListener('click', () => emit('goto', 'timetable'));
  on('keys', decryptAll);
  on('slots:loaded', render);
}
export function startHomework() {
  stopHomework();
  reminder = setInterval(remind, 10 * 60 * 1000);
  unsub = onSnapshot(col(), (snap) => {
    raw = snap.docs.map(plain);
    decryptAll().then(remind);
    if (canAdmin()) {
      const old = ymd(addDays(new Date(), -3));
      for (const r of raw) if (r.due < old) deleteDoc(doc(col(), r.id)).catch(() => {});
    }
  }, () => {});
}
export function stopHomework() { unsub?.(); unsub = null; rows = []; raw = []; clearInterval(reminder); render(); }

// ⏰ From 18:00, one reminder a day (notification if the app is in the background, otherwise a message) for what is
// due tomorrow and not ticked yet.
let reminder = null;
function remind() {
  if (new Date().getHours() < 18 || !state.cls) return;
  const key = `cc-hw-reminded-${state.cls.id}`;
  const tomorrow = ymd(addDays(new Date(), 1));
  try { if (localStorage.getItem(key) === tomorrow) return; } catch { return; }
  const done = doneSet();
  const left = rows.filter((r) => r.due === tomorrow && r.readable && !done.has(r.id));
  if (!left.length) return;
  try { localStorage.setItem(key, tomorrow); } catch { /* ignore */ }
  const list = left.map((r) => r.subject).join(', ');
  notify(`📚 ${left.length} devoir${left.length > 1 ? 's' : ''} pour demain`, list, 'cc-homework');
  if (!document.hidden) toast(`📚 N'oublie pas pour demain : ${list}`, 'info', 7000);
}

async function decryptAll() {
  const out = [];
  for (const r of raw) {
    const data = await unseal('homework', r);
    out.push({
      ...r, readable: !!data, subject: txt(data?.subject, 40), text: txt(data?.text, 1000),
      kind: KINDS[data?.kind] ? data.kind : 'devoir',
    });
  }
  rows = out.sort((a, b) => a.due.localeCompare(b.due) || (a.created_at || 0) - (b.created_at || 0));
  render();
}

// ------------------------------------------------------------ rendering
function render() {
  renderChip();
  if (!box) return;
  if (!state.cls) { box.replaceChildren(); return; }
  const done = doneSet();
  const upcoming = rows.filter((r) => r.due >= today());
  const todo = upcoming.filter((r) => !done.has(r.id));
  const list = showDone ? upcoming : todo;
  const groups = new Map();
  for (const r of list) {
    const { text } = dueLabel(r.due);
    const key = r.due === today() ? 'Pour aujourd\'hui' : text === 'Demain' ? 'Pour demain' : parse(r.due) - parse(today()) < 7 * 864e5 ? 'Cette semaine' : 'Plus tard';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const doneCount = upcoming.length - todo.length;
  box.replaceChildren(
    h('div.hw-head',
      h('h3', '📚 Devoirs', todo.length ? h('span.hw-count', String(todo.length)) : null),
      h('div.hw-actions',
        doneCount ? h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { showDone = !showDone; render(); } }, showDone ? 'Masquer les faits' : `Voir les faits (${doneCount})`) : null,
        h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => openForm() }, '+ Ajouter'))),
    list.length
      ? h('div.hw-groups', [...groups].map(([title, items]) => h('section.hw-group', h('p.hw-group-title', title), items.map(item))))
      : h('p.hw-empty', upcoming.length ? '🎉 Tout est fait ! Profite.' : 'Rien à faire pour l\'instant. Un prof a donné un devoir ? Ajoute-le pour toute la classe.'),
  );
}

function item(r) {
  const done = doneSet().has(r.id);
  const due = dueLabel(r.due);
  const k = KINDS[r.kind];
  const mine = r.by === state.me?.id;
  return h(`article.hw-item${done ? '.done' : ''}${r.kind === 'controle' ? '.test' : ''}`, { style: { '--c': colorOf(r.subject) } },
    h('label.hw-check', { title: done ? 'Marquer comme pas fait' : 'Marquer comme fait' },
      h('input', { type: 'checkbox', checked: done, 'aria-label': `Fait : ${r.subject}`, onchange: (e) => { setDone(r.id, e.target.checked); if (e.target.checked) toast('✅ Bien joué !', 'success', 1600); render(); } }),
      h('span')),
    h('div.hw-body',
      h('div.hw-meta', h('b.hw-subject', r.readable ? r.subject : '🔒'), h('span.hw-kind', `${k.ico} ${k.label}`), h(`span.hw-due.${due.cls || 'later'}`, due.text)),
      h('p.hw-text', r.readable ? linkify(r.text) : 'Illisible pour l\'instant (clé de la classe pas encore reçue)'),
      h('small.hw-by', `Ajouté par ${memberName(r.by)}`)),
    mine || canAdmin() ? h('button.icon-btn.hw-del', { type: 'button', 'aria-label': 'Supprimer', title: 'Supprimer', onclick: () => remove(r) }, '✕') : null);
}

function renderChip() {
  const chip = $('[data-next-hw]');
  if (!chip) return;
  const tomorrow = ymd(addDays(new Date(), 1));
  const done = doneSet();
  // After 16:00, what matters is tomorrow; before, today.
  const target = new Date().getHours() >= 16 ? tomorrow : today();
  const n = rows.filter((r) => r.due === target && !done.has(r.id)).length;
  chip.hidden = !n;
  if (n) chip.replaceChildren(h('span', `📚 ${n} devoir${n > 1 ? 's' : ''} pour ${target === today() ? 'aujourd\'hui' : 'demain'}`));
}

async function remove(r) {
  if (!await confirmDialog('Supprimer ce devoir ?', 'Il disparaîtra pour toute la classe.', { label: 'Supprimer' })) return;
  try { await deleteDoc(doc(col(), r.id)); } catch (err) { toastError(err); }
}

export function openForm(preset = {}) {
  const list = subjects();
  const subject = list.length
    ? h('select', { required: true }, list.map((s) => h('option', { value: s, selected: s === preset.subject }, s)), h('option', { value: '__other' }, 'Autre…'))
    : null;
  const other = h('input', { type: 'text', maxLength: 40, placeholder: 'Matière', hidden: !!list.length });
  const kind = h('select', Object.entries(KINDS).map(([v, k]) => h('option', { value: v }, `${k.ico} ${k.label}`)));
  const due = h('input', { type: 'date', required: true, min: today() });
  const text = h('textarea', { rows: 3, maxLength: 1000, required: true, placeholder: 'Ex. Exercices 4 et 5 page 112' });
  const hint = h('small.muted');
  const suggest = () => {
    const s = subject && subject.value !== '__other' ? subject.value : other.value.trim();
    other.hidden = !!subject && subject.value !== '__other';
    const next = s && nextLesson(s);
    if (next && !due.dataset.touched) { due.value = next; hint.textContent = '📅 Date du prochain cours de cette matière'; } else if (!due.value) hint.textContent = '';
  };
  subject?.addEventListener('change', suggest);
  due.addEventListener('input', () => { due.dataset.touched = '1'; hint.textContent = ''; });
  suggest();
  if (!due.value) due.value = ymd(addDays(new Date(), 1));
  modal({
    title: '📚 Ajouter un devoir pour la classe',
    body: h('div.form-stack',
      h('label', h('span', 'Matière'), subject, other),
      h('label', h('span', 'Type'), kind),
      h('label', h('span', 'Pour le'), due, hint),
      h('label', h('span', 'À faire'), text),
      h('p.muted.small', '🔒 Chiffré pour la classe. Chacun coche « fait » sur son propre appareil.')),
    actions: [{ label: 'Annuler' }, {
      label: 'Ajouter', variant: 'btn-primary', onClick: async () => {
        const s = (subject && subject.value !== '__other' ? subject.value : other.value).trim();
        if (!s) throw new Error('Choisis la matière');
        if (!text.value.trim()) throw new Error('Écris ce qu\'il y a à faire');
        if (!due.value || due.value < today()) throw new Error('Choisis une date à venir');
        const sealed = await seal('homework', { subject: s, kind: kind.value, text: text.value.trim() });
        await addDoc(col(), { due: due.value, ...sealed, by: state.me.id, created_at: serverTimestamp() });
        toast('Devoir ajouté pour toute la classe 📚', 'success');
      },
    }],
  });
}
