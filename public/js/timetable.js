import { onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { sub, plain } from './fb.js';
import { state, on, emit, isDelegate } from './state.js';
import { $, h, icon, modal, toast, toastError, confirmDialog, DAYS, enableTilt } from './ui.js';

const HOUR_PX = 64;
const SWATCHES = ['#7c5cff', '#00d4ff', '#ff4fd8', '#ffb547', '#3dffa8', '#ff6b6b', '#5b8cff', '#c77dff'];
export let slots = [];
let unsub = null;

const toMin = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
export const slotLabel = (s) => `${s.subject} · ${DAYS[s.day]} ${s.start_at}–${s.end_at}`;
const slotsCol = () => sub(state.cls.id, 'slots');

export function initTimetable() {
  const btn = $('#panel-timetable [data-action="new-slot"]');
  btn.addEventListener('click', () => { if (isDelegate()) openSlotForm({ mode: 'add' }); });
  on('me', render);
  setInterval(() => { if ($('#panel-timetable').classList.contains('active')) render(); }, 60_000);
}

export function startSlots() {
  stopSlots();
  unsub = onSnapshot(slotsCol(), (snap) => {
    slots = snap.docs.map(plain).sort((a, b) => a.day - b.day || a.start_at.localeCompare(b.start_at));
    render();
    emit('slots:loaded');
  }, toastError);
}
export function stopSlots() { unsub?.(); unsub = null; }

function render() {
  const root = $('#panel-timetable .timetable');
  const days = slots.some((s) => s.day === 5) ? 6 : 5;
  let minH = 8, maxH = 18;
  for (const s of slots) {
    minH = Math.min(minH, Math.floor(toMin(s.start_at) / 60));
    maxH = Math.max(maxH, Math.ceil(toMin(s.end_at) / 60));
  }
  const hours = maxH - minH;
  const today = (new Date().getDay() + 6) % 7;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  const head = h('div.tt-head', h('div.tt-corner'),
    ...Array.from({ length: days }, (_, d) => h(`div.tt-day${d === today ? '.today' : ''}`, DAYS[d])));

  const timeCol = h('div.tt-times', { style: { height: hours * HOUR_PX + 'px' } },
    ...Array.from({ length: hours + 1 }, (_, i) => h('span', { style: { top: i * HOUR_PX + 'px' } }, `${minH + i}h`)));

  const cols = Array.from({ length: days }, (_, d) => {
    const col = h(`div.tt-col${d === today ? '.today' : ''}`, { style: { height: hours * HOUR_PX + 'px', '--hour': HOUR_PX + 'px' } });
    const daySlots = slots.filter((s) => s.day === d);
    for (const [s, lane, lanes] of layoutLanes(daySlots)) {
      const top = ((toMin(s.start_at) - minH * 60) / 60) * HOUR_PX;
      const height = Math.max(((toMin(s.end_at) - toMin(s.start_at)) / 60) * HOUR_PX - 4, 22);
      col.append(h('button.slot.tilt', {
        style: { top: top + 'px', height: height + 'px', '--c': s.color, left: `calc(${(lane / lanes) * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)` },
        onclick: () => openSlotDetail(s),
      },
      h('b', s.subject),
      h('small', `${s.start_at} – ${s.end_at}`),
      height > 58 ? h('small.slot-meta', [s.room, s.teacher].filter(Boolean).join(' · ')) : null));
    }
    if (d === today && nowMin > minH * 60 && nowMin < maxH * 60) {
      col.append(h('div.now-line', { style: { top: ((nowMin - minH * 60) / 60) * HOUR_PX + 'px' } }));
    }
    return col;
  });

  root.replaceChildren(head, h('div.tt-body', timeCol, ...cols));
  if (!slots.length) {
    root.append(h('div.tt-empty', icon('calendar'), h('p', isDelegate()
      ? 'L\'emploi du temps est vide. Ajoute le premier cours !'
      : 'L\'emploi du temps est vide : ton délégué ne l\'a pas encore rempli.')));
  }
  enableTilt(root);
}

/** Assigns overlapping slots to side-by-side lanes. */
function layoutLanes(list) {
  const out = [];
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    const placed = cluster.map((s) => {
      let lane = lanes.findIndex((end) => end <= toMin(s.start_at));
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = toMin(s.end_at);
      return [s, lane];
    });
    for (const [s, lane] of placed) out.push([s, lane, lanes.length]);
    cluster = [];
  };
  for (const s of [...list].sort((a, b) => a.start_at.localeCompare(b.start_at))) {
    if (cluster.length && toMin(s.start_at) >= clusterEnd) flush();
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, toMin(s.end_at));
  }
  if (cluster.length) flush();
  return out;
}

function openSlotDetail(s) {
  const actions = [];
  if (isDelegate()) {
    actions.push({ label: 'Supprimer', variant: 'btn-danger', onClick: async () => {
      if (!(await confirmDialog('Supprimer ce cours ?', slotLabel(s)))) return false;
      await deleteDoc(doc(slotsCol(), s.id));
      toast('Cours supprimé');
    } });
    actions.push({ label: 'Modifier', variant: 'btn-primary', onClick: () => { openSlotForm({ mode: 'edit', slot: s }); } });
    actions.splice(1, 0, { label: 'Mettre au vote', onClick: () => { openSlotForm({ mode: 'propose', action: 'modify', slot: s }); } });
  }
  modal({
    title: s.subject,
    body: h('div.slot-detail', { style: { '--c': s.color } },
      h('div.slot-detail-bar'),
      h('p', icon('calendar'), ` ${DAYS[s.day]}, ${s.start_at} – ${s.end_at}`),
      s.room ? h('p', icon('pin'), ` Salle ${s.room}`) : null,
      s.teacher ? h('p', icon('users'), ` ${s.teacher}`) : null),
    actions,
  });
}

/**
 * Slot editor, shared by the timetable and the vote panel.
 * mode: 'add' | 'edit' (delegate, direct) | 'propose' (vote, action = add | modify | delete)
 */
export function openSlotForm({ mode, action = 'add', slot = null }) {
  const proposing = mode === 'propose';
  const base = slot || { day: 0, start_at: '08:00', end_at: '09:00', subject: '', teacher: '', room: '', color: SWATCHES[0] };
  let current = { action, slot };

  const f = {
    title: h('input', { name: 'title', maxLength: 80, required: true, placeholder: 'Ex. Déplacer les maths au mardi' }),
    reason: h('textarea', { name: 'reason', maxLength: 600, rows: 3, placeholder: 'Pourquoi ce changement ?' }),
    duration: h('select', { name: 'duration' },
      [[1, '1 heure'], [6, '6 heures'], [24, '24 heures'], [72, '3 jours'], [168, '1 semaine']]
        .map(([v, l]) => h('option', { value: v, selected: v === 24 }, l))),
    slotSelect: h('select', { name: 'slot' },
      h('option', { value: '' }, '— Choisir un cours —'),
      slots.map((s) => h('option', { value: s.id, selected: slot?.id === s.id }, slotLabel(s)))),
    day: h('select', { name: 'day' }, DAYS.map((d, i) => h('option', { value: i, selected: i === base.day }, d))),
    start: h('input', { type: 'time', name: 'start', value: base.start_at, required: true, step: 300 }),
    end: h('input', { type: 'time', name: 'end', value: base.end_at, required: true, step: 300 }),
    subject: h('input', { name: 'subject', value: base.subject, maxLength: 40, required: true, placeholder: 'Mathématiques' }),
    teacher: h('input', { name: 'teacher', value: base.teacher, maxLength: 40, placeholder: 'Mme Curie' }),
    room: h('input', { name: 'room', value: base.room, maxLength: 20, placeholder: 'B204' }),
  };
  let color = base.color;
  const swatches = h('div.swatches', SWATCHES.map((c) => h(`button.swatch${c === color ? '.active' : ''}`, {
    type: 'button', style: { '--c': c }, title: c,
    onclick: (e) => { color = c; swatches.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', b === e.currentTarget)); },
  })));

  const field = (label, input, extra = '') => h(`label.field${extra}`, h('span', label), input);
  const actionSeg = h('div.seg.seg-sm.seg-wrap', [['poll', 'Question libre'], ['add', 'Nouveau cours'], ['modify', 'Modifier un cours'], ['delete', 'Supprimer un cours']].map(([a, l]) =>
    h(`button${a === action ? '.active' : ''}`, { type: 'button', onclick: (e) => {
      current.action = a;
      actionSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget));
      sync();
    } }, l)));

  const slotRow = field('Cours concerné', f.slotSelect);
  const slotFields = h('div.slot-fields',
    h('div.row', field('Jour', f.day), field('Début', f.start), field('Fin', f.end)),
    field('Matière', f.subject),
    h('div.row', field('Professeur', f.teacher), field('Salle', f.room)),
    h('div.field', h('span', 'Couleur'), swatches));

  function autoTitle() {
    if (current.action === 'poll') return '';
    const s = slots.find((x) => String(x.id) === f.slotSelect.value);
    if (current.action === 'add') return f.subject.value ? `Ajouter ${f.subject.value} le ${DAYS[f.day.value].toLowerCase()}` : '';
    if (!s) return '';
    return current.action === 'delete' ? `Supprimer ${s.subject} du ${DAYS[s.day].toLowerCase()}` : `Modifier ${s.subject} du ${DAYS[s.day].toLowerCase()}`;
  }
  let titleTouched = false;
  f.title.addEventListener('input', () => { titleTouched = true; });
  const refreshTitle = () => { if (!titleTouched) f.title.value = autoTitle(); };
  [f.subject, f.day].forEach((el) => el.addEventListener('input', refreshTitle));
  f.slotSelect.addEventListener('change', () => {
    const s = slots.find((x) => String(x.id) === f.slotSelect.value);
    if (s && current.action === 'modify') {
      f.day.value = s.day; f.start.value = s.start_at; f.end.value = s.end_at;
      f.subject.value = s.subject; f.teacher.value = s.teacher; f.room.value = s.room; color = s.color;
      swatches.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', b.title === color));
    }
    refreshTitle();
  });

  function sync() {
    slotRow.hidden = !proposing || ['add', 'poll'].includes(current.action);
    slotFields.hidden = ['delete', 'poll'].includes(current.action);
    // Hidden sections must not block the form's validation.
    slotFields.querySelectorAll('input, select').forEach((i) => { i.disabled = slotFields.hidden; });
    f.slotSelect.disabled = slotRow.hidden;
    f.title.placeholder = current.action === 'poll' ? 'Ex. Sortie de fin d\'année : parc ou bowling ?' : 'Ex. Déplacer les maths au mardi';
    f.reason.placeholder = current.action === 'poll' ? 'Détails de la question (facultatif)' : 'Pourquoi ce changement ?';
    refreshTitle();
  }

  const form = h('form.slot-form', { onsubmit: (e) => { e.preventDefault(); submit().catch(toastError); } },
    proposing ? [
      !slot ? actionSeg : null,
      slotRow,
      field('Question / titre du vote', f.title),
    ] : null,
    slotFields,
    proposing ? [
      field('Explications', f.reason),
      field('Durée du vote', f.duration),
      h('p.hint', icon('vote'), ' Toute la classe vote pour / contre / abstention (vote secret). Tu décides ensuite d\'adopter ou non.'),
    ] : null,
    h('button', { type: 'submit', hidden: true }));
  sync();

  const titles = { add: 'Ajouter un cours', edit: 'Modifier le cours', propose: 'Nouveau vote' };
  const m = modal({
    title: titles[mode], body: form, wide: true,
    actions: [
      { label: 'Annuler' },
      { label: proposing ? 'Soumettre au vote' : 'Enregistrer', variant: 'btn-primary', onClick: submit },
    ],
  });

  async function submit() {
    if (!form.reportValidity()) return false;
    const data = {
      day: Number(f.day.value), start_at: f.start.value, end_at: f.end.value,
      subject: f.subject.value.trim(), teacher: f.teacher.value.trim(), room: f.room.value.trim(), color,
    };
    const needsSlot = !['delete', 'poll'].includes(current.action);
    if (needsSlot && data.start_at >= data.end_at) throw new Error('La fin doit être après le début');
    if (mode === 'add') {
      await addDoc(slotsCol(), data);
      toast('Cours ajouté', 'success');
    } else if (mode === 'edit') {
      await updateDoc(doc(slotsCol(), slot.id), data);
      toast('Cours modifié', 'success');
    } else {
      const slotId = ['add', 'poll'].includes(current.action) ? null : (f.slotSelect.value || slot?.id || null);
      if (['modify', 'delete'].includes(current.action) && !slotId) throw new Error('Choisis le cours concerné');
      if (f.title.value.trim().length < 3) throw new Error('Écris la question ou le titre du vote');
      await addDoc(sub(state.cls.id, 'proposals'), {
        author_id: state.me.id, title: f.title.value.trim(), reason: f.reason.value.trim(), action: current.action,
        slot_id: slotId, data: needsSlot ? data : {}, status: 'open', yes: 0, no: 0, abstain: 0,
        deadline: Timestamp.fromMillis(Date.now() + Number(f.duration.value) * 3600e3),
        created_at: serverTimestamp(), closed_at: null,
      });
      toast('Vote lancé 🗳️', 'success');
      emit('goto', 'votes');
    }
    m.close();
    return false;
  }
  return m;
}
