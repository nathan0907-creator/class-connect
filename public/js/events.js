// Countdowns: holidays, tests, trips… The nearest one is shown in the chat header, all of them above the timetable.
import { onSnapshot, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { sub, plain } from './fb.js';
import { state, on, emit, isDelegate, isDeputy, isTeacher } from './state.js';
import { $, h, icon, modal, toast, toastError, confirmDialog } from './ui.js';

export const KINDS = {
  vacances: { emoji: '🏖️', label: 'Vacances' },
  controle: { emoji: '📝', label: 'Contrôle' },
  sortie: { emoji: '🚌', label: 'Sortie' },
  autre: { emoji: '📌', label: 'Autre' },
};
let events = [];
let unsub = null;
const canEdit = () => isDelegate() || isDeputy() || isTeacher();
const eventsCol = () => sub(state.cls.id, 'events');

/** Whole days between today and a YYYY-MM-DD date (0 = today). */
export function daysUntil(date) {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 864e5);
}
export const whenText = (n) => (n === 0 ? 'aujourd\'hui' : n === 1 ? 'demain' : `dans ${n} jours`);
const dateFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
/** Every countdown of the class (month calendar). */
export const allEvents = () => events;
const upcoming = () => events.filter((e) => daysUntil(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date));

export const canEditEvents = () => canEdit();
export function initEvents() {
  $('[data-next-event]')?.addEventListener('click', () => emit('goto', 'timetable'));
  on('me', render);
  // Days change at midnight.
  setInterval(render, 10 * 60_000);
}

export function startEvents() {
  stopEvents();
  unsub = onSnapshot(eventsCol(), (snap) => {
    events = snap.docs.map(plain);
    render();
    emit('events');
    cleanup();
  }, toastError);
}
export function stopEvents() { unsub?.(); unsub = null; events = []; render(); }

/** Past events are removed a week later by whoever can edit them. */
function cleanup() {
  if (!canEdit()) return;
  for (const e of events) if (daysUntil(e.date) < -7) deleteDoc(doc(eventsCol(), e.id)).catch(() => {});
}

function render() {
  const list = upcoming();
  // Chat header: the nearest countdown.
  const chip = $('[data-next-event]');
  if (chip) {
    const next = list[0];
    chip.hidden = !next;
    if (next) {
      chip.replaceChildren(h('span', `${KINDS[next.kind].emoji} ${next.title} ${whenText(daysUntil(next.date))}`));
      chip.classList.toggle('soon', daysUntil(next.date) <= 1);
    }
  }
  // Timetable panel: every countdown + add button.
  const strip = $('[data-events]');
  if (!strip) return;
  strip.replaceChildren(...[
    ...list.map((e) => {
      const n = daysUntil(e.date);
      return h(`button.event-card.kind-${e.kind}${n <= 1 ? '.soon' : ''}`, { type: 'button', onclick: () => openEvent(e) },
        h('span.ev-emoji', KINDS[e.kind].emoji),
        h('span.ev-body', h('b', e.title), h('small', whenText(n))),
        h('span.ev-count', n === 0 ? 'J' : `J-${n}`));
    }),
    canEdit() ? h('button.event-card.add', { type: 'button', onclick: () => openEventForm() }, icon('plus'), h('span', 'Compte à rebours')) : null,
  ].filter(Boolean));
  strip.hidden = !list.length && !canEdit();
}

function openEvent(e) {
  const n = daysUntil(e.date);
  const [y, m, d] = e.date.split('-').map(Number);
  modal({
    title: `${KINDS[e.kind].emoji} ${e.title}`,
    body: h('div.event-detail',
      h('div.ev-big', n === 0 ? 'Aujourd\'hui !' : `J-${n}`),
      h('p', dateFmt.format(new Date(y, m - 1, d)), ` · ${KINDS[e.kind].label}`),
      h('p.muted.small', `Ajouté par ${state.members.get(e.author_id)?.display_name || 'un ancien membre'}`)),
    actions: [
      canEdit() ? { label: 'Supprimer', variant: 'btn-danger', onClick: async () => {
        if (!(await confirmDialog('Supprimer ce compte à rebours ?', e.title))) return false;
        await deleteDoc(doc(eventsCol(), e.id));
        toast('Supprimé');
      } } : null,
      { label: 'Fermer' },
    ].filter(Boolean),
  });
}

export function openEventForm(preset = '') {
  let kind = 'controle';
  const title = h('input', { maxLength: 60, required: true, placeholder: 'Ex. Contrôle de maths (chapitre 4)' });
  const date = h('input', { type: 'date', required: true, min: new Date().toISOString().slice(0, 10), value: preset });
  const seg = h('div.seg.seg-sm.seg-wrap', Object.entries(KINDS).map(([k, v]) => h(`button${k === kind ? '.active' : ''}`, {
    type: 'button', onclick: (ev) => {
      kind = k;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === ev.currentTarget));
      if (!title.value || Object.values(KINDS).some((x) => title.value === x.label)) title.value = k === 'autre' ? '' : v.label;
    },
  }, `${v.emoji} ${v.label}`)));
  const form = h('form.slot-form', { onsubmit: (e) => e.preventDefault() },
    h('div.field', h('span', 'Type'), seg),
    h('label.field', h('span', 'Titre'), title),
    h('label.field', h('span', 'Date'), date),
    h('p.hint', icon('clock'), ' Toute la classe verra le compte à rebours en haut du chat et au-dessus de l\'emploi du temps.'));
  modal({
    title: 'Nouveau compte à rebours', body: form,
    actions: [
      { label: 'Annuler' },
      { label: 'Ajouter', variant: 'btn-primary', onClick: async () => {
        if (title.value.trim().length < 2) throw new Error('Donne un titre');
        if (!date.value) throw new Error('Choisis la date');
        if (daysUntil(date.value) < 0) throw new Error('La date est déjà passée');
        await addDoc(eventsCol(), { title: title.value.trim(), date: date.value, kind, author_id: state.me.id, created_at: serverTimestamp() });
        toast('Compte à rebours ajouté ⏳', 'success');
      } },
    ],
  });
}
