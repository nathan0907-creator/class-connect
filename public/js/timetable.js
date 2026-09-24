import {
  onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, Timestamp, writeBatch, getDocs, deleteField,
} from 'firebase/firestore';
import { db, sub, plain, classRef } from './fb.js';
import { state, on, emit, isDelegate, isDeputy, isTeacher } from './state.js';
import { $, h, icon, modal, toast, toastError, confirmDialog, DAYS, enableTilt, busy } from './ui.js';
import { seal, unseal, txt } from './vault.js';
import { postTo, ALERTS, fmtDate } from './chat.js';
import { compressImage } from './media.js';
import { toB64 } from './crypto.js';
import { generate, timetableSchema, TIMETABLE_SYSTEM, timetablePrompt } from './ai.js';
import { renderCalendar } from './calendar.js';

const HOUR_PX = 64;
const SWATCHES = ['#7c5cff', '#00d4ff', '#ff4fd8', '#ffb547', '#3dffa8', '#ff6b6b', '#5b8cff', '#c77dff'];
/** Usual colours per subject, so an imported timetable looks like a hand-made one. */
const SUBJECT_COLORS = [
  [/^eps$|sport/i, '#3dffa8'], [/math/i, '#7c5cff'], [/fran[cç]ais|litt/i, '#ff6b6b'], [/hist|g[ée]o|emc/i, '#ffb547'], [/physi|chimie/i, '#00d4ff'],
  [/svt|bio|vie et de la terre/i, '#3dffa8'], [/anglais|espagnol|allemand|italien|lv\d|langue/i, '#ff4fd8'],
  [/philo|ses|[ée]co/i, '#c77dff'], [/nsi|info|techno|sni/i, '#5b8cff'], [/eps|sport/i, '#3dffa8'], [/art|musi/i, '#ff4fd8'],
];
export let slots = [];
let alerts = [];          // decrypted "prof absent / salle changée / cours annulé"
let unsubs = [];
let weekOffset = 0;       // 0 = this week, 1 = next week…
let mode = 'week';        // 'week' | 'month'

const toMin = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
export const slotLabel = (s) => `${s.subject} · ${DAYS[s.day]} ${s.start_at}–${s.end_at}${s.week ? ` (sem. ${s.week})` : ''}`;
const slotsCol = () => sub(state.cls.id, 'slots');
const alertsCol = () => sub(state.cls.id, 'alerts');
const canAlertAdmin = () => isDelegate() || isDeputy() || isTeacher();

// ------------------------------------------------------------ dates & A/B weeks
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/** 'A' or 'B' for the week of a date, or null when the class doesn't alternate weeks. */
export function weekOf(date = new Date()) {
  const ref = state.cls?.week_a;
  if (!ref) return null;
  const [y, m, d] = ref.split('-').map(Number);
  const weeks = Math.round((mondayOf(date) - mondayOf(new Date(y, m - 1, d))) / (7 * 864e5));
  return ((weeks % 2) + 2) % 2 === 0 ? 'A' : 'B';
}
const hasAB = () => slots.some((s) => s.week);
/** Slots of one day of the calendar (A/B weeks taken into account). */
export const slotsOn = (date) => {
  const w = weekOf(date);
  const day = (date.getDay() + 6) % 7;
  return slots.filter((s) => s.day === day && (!s.week || !w || s.week === w));
};
export const alertsOn = (dateStr) => alerts.filter((a) => a.date === dateStr);

export function initTimetable() {
  $('#panel-timetable [data-action="new-slot"]').addEventListener('click', () => { if (isDelegate()) openSlotForm({ mode: 'add' }); });
  $('#panel-timetable [data-action="import-timetable"]').addEventListener('click', () => { if (isDelegate()) openImport(); });
  on('me', render);
  on('events', () => { if (mode === 'month') render(); });
  on('profiles', () => { if (mode === 'month') render(); });
  setInterval(() => { if ($('#panel-timetable').classList.contains('active')) render(); }, 60_000);
  $('[data-next-class]')?.addEventListener('click', () => emit('goto', 'timetable'));
  setInterval(renderNextClass, 30_000);
}

// ------------------------------------------------------------ "next class" chip (chat header)
const hhmm = (min) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
/** Current or next class, with a human sentence: "Maths dans 12 min · B204". Skips cancelled / absent ones. */
export function nextClass(now = new Date()) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const alertOf = (s, date) => alertsOn(ymd(date)).find((a) => a.slot_id === s.id);
  const todays = slotsOn(now).sort((a, b) => a.start_at.localeCompare(b.start_at));
  const current = todays.find((s) => toMin(s.start_at) <= nowMin && nowMin < toMin(s.end_at));
  if (current) {
    const a = alertOf(current, now);
    return { slot: current, now: true, alert: a, text: `${a ? `${ALERTS[a.kind]} : ` : 'En cours : '}${current.subject} · jusqu'à ${hhmm(toMin(current.end_at))}` };
  }
  for (let i = 0; i < 8; i++) {
    const date = addDays(now, i);
    const next = slotsOn(date).filter((s) => i > 0 || toMin(s.start_at) > nowMin).sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
    if (!next) continue;
    const start = toMin(next.start_at);
    const when = i === 0
      ? (start - nowMin <= 90 ? `dans ${start - nowMin} min` : `à ${hhmm(start)}`)
      : `${i === 1 ? 'demain' : DAYS[(date.getDay() + 6) % 7].toLowerCase()} à ${hhmm(start)}`;
    const a = alertOf(next, date);
    return { slot: next, now: false, alert: a, text: `${a ? `${ALERTS[a.kind]} : ` : ''}${next.subject} ${when}` };
  }
  return null;
}
function renderNextClass() {
  const chip = $('[data-next-class]');
  if (!chip) return;
  const n = nextClass();
  chip.hidden = !n;
  if (!n) return;
  chip.classList.toggle('now', n.now);
  chip.classList.toggle('alerted', !!n.alert);
  chip.style.setProperty('--c', n.slot.color);
  const room = n.alert?.kind === 'room' && n.alert.room ? n.alert.room : n.slot.room;
  chip.replaceChildren(h('i.dot'), h('span', n.text + (room ? ` · ${room}` : '')));
  chip.title = 'Voir l\'emploi du temps';
}

export function startSlots() {
  stopSlots();
  unsubs.push(onSnapshot(slotsCol(), (snap) => {
    slots = snap.docs.map(plain).sort((a, b) => a.day - b.day || a.start_at.localeCompare(b.start_at));
    render();
    renderNextClass();
    emit('slots:loaded');
  }, toastError));
  unsubs.push(onSnapshot(alertsCol(), async (snap) => {
    const rows = snap.docs.map(plain);
    const out = [];
    for (const r of rows) {
      const data = await unseal('alert', r);
      out.push({ ...r, subject: txt(data?.subject, 40), room: txt(data?.room, 20), note: txt(data?.note, 300), readable: !!data });
    }
    alerts = out;
    render();
    renderNextClass();
    emit('alerts');
    // Past alerts are cleaned up by the delegates' / teachers' devices.
    if (canAlertAdmin()) {
      const old = ymd(addDays(new Date(), -7));
      for (const a of rows) if (a.date < old) deleteDoc(doc(alertsCol(), a.id)).catch(() => {});
    }
  }, () => {}));
}
export function stopSlots() { unsubs.forEach((u) => u()); unsubs = []; alerts = []; }
on('keys', () => { if (unsubs.length) startSlots(); });

// ------------------------------------------------------------ toolbar (week navigation, A/B, week / month)
function toolbar() {
  const monday = addDays(mondayOf(new Date()), weekOffset * 7);
  const w = weekOf(monday);
  const label = weekOffset === 0 ? 'Cette semaine' : weekOffset === 1 ? 'Semaine prochaine'
    : `Semaine du ${monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
  const bar = h('div.tt-toolbar',
    h('div.seg.seg-sm', ['week', 'month'].map((m) => h(`button${m === mode ? '.active' : ''}`, {
      type: 'button', onclick: () => { mode = m; render(); },
    }, m === 'week' ? 'Semaine' : 'Mois'))),
    mode === 'week' ? h('div.week-nav',
      h('button.icon-btn', { type: 'button', 'aria-label': 'Semaine précédente', disabled: weekOffset <= 0, onclick: () => { weekOffset--; render(); } }, '‹'),
      h('b', label, w && hasAB() ? h('span.week-tag', `Sem. ${w}`) : null),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Semaine suivante', disabled: weekOffset >= 8, onclick: () => { weekOffset++; render(); } }, '›')) : null,
    mode === 'week' && hasAB() && isDelegate() ? h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => setWeekLetter(monday) },
      w ? 'Corriger A/B' : 'Indiquer semaine A ou B') : null);
  if (mode === 'week' && hasAB() && !w) {
    bar.append(h('p.hint.small', 'Cet emploi du temps alterne semaines A et B : ', isDelegate() ? 'indique laquelle est cette semaine.' : 'le délégué doit indiquer laquelle est cette semaine.'));
  }
  return bar;
}

async function setWeekLetter(monday) {
  const pick = await new Promise((resolve) => {
    let chosen = null;
    modal({
      title: 'Semaine A ou B ?',
      body: h('p', `La semaine du ${monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} est une…`),
      onClose: () => resolve(chosen),
      actions: [
        { label: 'Semaine A', variant: 'btn-primary', onClick: () => { chosen = 'A'; } },
        { label: 'Semaine B', variant: 'btn-primary', onClick: () => { chosen = 'B'; } },
      ],
    });
  });
  if (!pick) return;
  const refMonday = pick === 'A' ? monday : addDays(monday, -7);
  try {
    await updateDoc(classRef(state.cls.id), { week_a: ymd(refMonday) });
    toast(`C'est noté : semaine ${pick} ✅`, 'success');
  } catch (err) { toastError(err); }
}

// ------------------------------------------------------------ week grid
function render() {
  const panel = $('#panel-timetable');
  if (!panel || !state.cls) return;
  const bar = $('.tt-toolbar-slot', panel);
  bar.replaceChildren(toolbar());
  const root = $('.timetable', panel);
  if (mode === 'month') { root.replaceChildren(renderCalendar()); return; }

  const monday = addDays(mondayOf(new Date()), weekOffset * 7);
  const w = weekOf(monday);
  const shown = slots.filter((s) => !s.week || !w || s.week === w);
  const days = shown.some((s) => s.day === 5) ? 6 : 5;
  let minH = 8, maxH = 18;
  for (const s of shown) {
    minH = Math.min(minH, Math.floor(toMin(s.start_at) / 60));
    maxH = Math.max(maxH, Math.ceil(toMin(s.end_at) / 60));
  }
  const hours = maxH - minH;
  const todayIdx = weekOffset === 0 ? (new Date().getDay() + 6) % 7 : -1;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  const head = h('div.tt-head', h('div.tt-corner'),
    ...Array.from({ length: days }, (_, d) => h(`div.tt-day${d === todayIdx ? '.today' : ''}`,
      DAYS[d], h('small', ` ${addDays(monday, d).getDate()}`))));

  const timeCol = h('div.tt-times', { style: { height: hours * HOUR_PX + 'px' } },
    ...Array.from({ length: hours + 1 }, (_, i) => h('span', { style: { top: i * HOUR_PX + 'px' } }, `${minH + i}h`)));

  const cols = Array.from({ length: days }, (_, d) => {
    const date = ymd(addDays(monday, d));
    const col = h(`div.tt-col${d === todayIdx ? '.today' : ''}`, { style: { height: hours * HOUR_PX + 'px', '--hour': HOUR_PX + 'px' } });
    for (const [s, lane, lanes] of layoutLanes(shown.filter((x) => x.day === d))) {
      const top = ((toMin(s.start_at) - minH * 60) / 60) * HOUR_PX;
      const height = Math.max(((toMin(s.end_at) - toMin(s.start_at)) / 60) * HOUR_PX - 4, 22);
      const a = alertsOn(date).find((x) => x.slot_id === s.id);
      const room = a?.kind === 'room' && a.room ? a.room : s.room;
      col.append(h(`button.slot.tilt${a ? `.alerted.alert-${a.kind}` : ''}`, {
        style: { top: top + 'px', height: height + 'px', '--c': s.color, left: `calc(${(lane / lanes) * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)` },
        onclick: () => openSlotDetail(s, date),
      },
      h('b', s.subject),
      h('small', `${s.start_at} – ${s.end_at}`),
      a ? h('small.slot-alert', a.kind === 'room' ? `Salle ${a.room || '?'}` : ALERTS[a.kind]) : null,
      height > 58 && !a ? h('small.slot-meta', [room, s.teacher].filter(Boolean).join(' · ')) : null));
    }
    if (d === todayIdx && nowMin > minH * 60 && nowMin < maxH * 60) {
      col.append(h('div.now-line', { style: { top: ((nowMin - minH * 60) / 60) * HOUR_PX + 'px' } }));
    }
    return col;
  });

  root.replaceChildren(head, h('div.tt-body', timeCol, ...cols));
  if (!slots.length) {
    root.append(h('div.tt-empty', icon('calendar'), h('p', isDelegate()
      ? 'L\'emploi du temps est vide. Importe une photo ou un PDF de ton emploi du temps, ou ajoute les cours un par un.'
      : 'L\'emploi du temps est vide : ton délégué ne l\'a pas encore rempli.'),
    isDelegate() ? h('button.btn.btn-primary', { type: 'button', onclick: openImport }, '📷 Importer une photo ou un PDF') : null));
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

/** Next date (from today) on which a slot takes place. */
function nextDateOf(s) {
  for (let i = 0; i < 21; i++) {
    const d = addDays(new Date(), i);
    if (slotsOn(d).some((x) => x.id === s.id)) return ymd(d);
  }
  return ymd(new Date());
}

function openSlotDetail(s, date = nextDateOf(s)) {
  const actions = [];
  if (isDelegate()) {
    actions.push({ label: 'Supprimer', variant: 'btn-danger', onClick: async () => {
      if (!(await confirmDialog('Supprimer ce cours ?', slotLabel(s)))) return false;
      await deleteDoc(doc(slotsCol(), s.id));
      toast('Cours supprimé');
    } });
    actions.push({ label: 'Mettre au vote', onClick: () => { openSlotForm({ mode: 'propose', action: 'modify', slot: s }); } });
    actions.push({ label: 'Modifier', variant: 'btn-primary', onClick: () => { openSlotForm({ mode: 'edit', slot: s }); } });
  }
  const upcoming = alerts.filter((a) => a.slot_id === s.id && a.date >= ymd(new Date())).sort((a, b) => a.date.localeCompare(b.date));
  const m = modal({
    title: s.subject,
    body: h('div.slot-detail', { style: { '--c': s.color } },
      h('div.slot-detail-bar'),
      h('p', icon('calendar'), ` ${DAYS[s.day]}, ${s.start_at} – ${s.end_at}${s.week ? ` · semaine ${s.week} seulement` : ''}`),
      s.room ? h('p', icon('pin'), ` Salle ${s.room}`) : null,
      s.teacher ? h('p', icon('users'), ` ${s.teacher}`) : null,
      upcoming.length ? h('div.alert-list', upcoming.map((a) => h(`div.alert-card.alert-${a.kind}`,
        h('b', ALERTS[a.kind]), h('span', fmtDate(a.date) + (a.kind === 'room' && a.room ? ` · salle ${a.room}` : '')),
        a.note ? h('small', a.note) : null,
        a.by === state.me.id || canAlertAdmin() ? h('button.link-btn', { type: 'button', onclick: async () => {
          try { await deleteDoc(doc(alertsCol(), a.id)); toast('Info retirée'); m.close(); } catch (err) { toastError(err); }
        } }, 'Retirer') : null))) : null,
      h('div.alert-buttons',
        h('p.hint', 'Un changement pour ce cours ? Préviens toute la classe :'),
        h('div.btn-row', Object.entries(ALERTS).map(([kind, label]) => h('button.btn.btn-ghost.btn-sm', {
          type: 'button', onclick: () => { m.close(); openAlertForm(s, kind, date); },
        }, label))))),
    actions,
  });
}

// ------------------------------------------------------------ "prof absent / salle changée / cours annulé"
function openAlertForm(s, kind, date) {
  const dateInput = h('input', { type: 'date', value: date, min: ymd(new Date()), required: true });
  const room = h('input', { maxLength: 20, placeholder: 'Ex. B105', required: kind === 'room' });
  const note = h('textarea', { maxLength: 300, rows: 2, placeholder: kind === 'absent' ? 'Ex. Le CDI est ouvert, pas de devoir à rendre' : 'Précision (facultatif)' });
  modal({
    title: `${ALERTS[kind]} · ${s.subject}`,
    body: h('form.slot-form', { onsubmit: (e) => e.preventDefault() },
      h('label.field', h('span', 'Date du cours'), dateInput),
      kind === 'room' ? h('label.field', h('span', 'Nouvelle salle'), room) : null,
      h('label.field', h('span', 'Précision'), note),
      h('p.hint', icon('bell'), ' Toute la classe est prévenue (canal Annonces + notification), et l\'emploi du temps l\'affiche ce jour-là.')),
    actions: [
      { label: 'Annuler' },
      { label: 'Prévenir la classe', variant: 'btn-primary', onClick: async () => {
        if (!dateInput.value) throw new Error('Choisis la date');
        if (kind === 'room' && !room.value.trim()) throw new Error('Indique la nouvelle salle');
        const data = { kind, date: dateInput.value, subject: s.subject, room: room.value.trim(), note: note.value.trim() };
        await addDoc(alertsCol(), {
          kind, slot_id: s.id, date: data.date, ...(await seal('alert', { subject: data.subject, room: data.room, note: data.note })),
          by: state.me.id, created_at: serverTimestamp(),
        });
        // Posted in the announcements channel too: notifications for everyone, even with the app closed.
        await postTo('announcements', { v: 1, t: 'alert', alert: data }, { kind: 'alert' }).catch(() => {});
        toast('Classe prévenue 📢', 'success');
      } },
    ],
  });
}

// ------------------------------------------------------------ import from a photo / screenshot / PDF (AI)
function colorFor(subject, used) {
  const known = slots.find((s) => s.subject.toLowerCase() === subject.toLowerCase());
  if (known) return known.color;
  if (used.has(subject.toLowerCase())) return used.get(subject.toLowerCase());
  const hit = SUBJECT_COLORS.find(([re]) => re.test(subject));
  const c = hit ? hit[1] : SWATCHES[[...subject].reduce((a, ch) => a + ch.charCodeAt(0), 0) % SWATCHES.length];
  used.set(subject.toLowerCase(), c);
  return c;
}
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const fixTime = (t) => {
  const m = String(t || '').trim().replace(/h/i, ':').match(/^(\d{1,2}):?(\d{2})?$/);
  if (!m) return '';
  const v = `${m[1].padStart(2, '0')}:${m[2] || '00'}`;
  return HHMM.test(v) ? v : '';
};

// Pronote / ENT write in capitals without accents: usual subjects get their proper name back.
const SUBJECT_NAMES = [
  [/^(ed(ucation)?\.? ?physique.*sport.*|e\.?p\.?s\.?)$/i, 'EPS'], [/^math[ée]matiques?$/i, 'Mathématiques'], [/^fran[cç]ais$/i, 'Français'],
  [/^hist(oire)?\.?[\s\-&/]*g[ée]o(graphie)?\.?$/i, 'Histoire-Géographie'], [/^physique[\s\-&]*chimie$/i, 'Physique-Chimie'],
  [/^sciences? [ée]cono.*sociales?$/i, 'SES'], [/^ens(eignement)?\.? moral.*civique$/i, 'EMC'], [/^philosophie$/i, 'Philosophie'],
  [/^sciences? num[ée]riques? et techno.*$/i, 'SNT'], [/^num[ée]rique.*sc.*inform.*$/i, 'NSI'], [/^sciences? de la vie.*terre$/i, 'SVT'],
];
const ACRONYM = /^(lv\d|svt|ses|emc|nsi|snt|eps|ap|ds|td|tp|hggsp|llcer|ecjs|ase|dnl)$/i;
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-'./(&])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase())
  .replace(/[\p{L}\d]+/gu, (w) => (ACRONYM.test(w) ? w.toUpperCase() : w));
/** "MATHEMATIQUES" → "Mathématiques", "MME MARTIN" → "Mme Martin" (text already in mixed case is kept). */
export function niceName(s, subject = false) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (subject) { const hit = SUBJECT_NAMES.find(([re]) => re.test(t)); if (hit) return hit[1]; }
  return /\p{Ll}/u.test(t) ? t : titleCase(t);
}

/** Cleans what the AI read: only valid slots with the lengths allowed by the security rules. */
export function cleanImported(list) {
  const used = new Map();
  return (Array.isArray(list) ? list : []).map((s) => ({
    day: Number.isInteger(s?.day) && s.day >= 0 && s.day <= 5 ? s.day : -1,
    start_at: fixTime(s?.start_at), end_at: fixTime(s?.end_at),
    subject: niceName(txt(s?.subject, 60), true).slice(0, 40), teacher: niceName(txt(s?.teacher, 60)).slice(0, 40), room: txt(s?.room, 20).trim(),
    week: ['A', 'B'].includes(String(s?.week || '').trim().toUpperCase()) ? String(s.week).trim().toUpperCase() : '',
  })).filter((s) => s.day >= 0 && s.start_at && s.end_at && s.start_at < s.end_at && s.subject)
    .map((s) => ({ ...s, color: colorFor(s.subject, used) }));
}

function openImport() {
  const file = h('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true });
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const body = h('div.import-tt',
    h('p', 'Envoie une photo, une capture d\'écran (Pronote, ENT…) ou le PDF de ton emploi du temps : l\'IA le recopie, tu vérifies, et c\'est rempli.'),
    h('div.btn-row',
      h('button.btn.btn-primary', { type: 'button', onclick: () => file.click() }, '📄 Choisir une photo ou un PDF'),
      h('button.btn.btn-ghost.phone-only', { type: 'button', onclick: () => camera.click() }, '📷 Prendre en photo')),
    h('p.hint.small', icon('lock'), ' Le document est lu par l\'IA Gemini (Google) le temps de l\'analyse. Évite d\'y laisser des informations personnelles (nom, adresse…).'),
    file, camera);
  const m = modal({ title: '📷 Importer l\'emploi du temps', body, wide: true });
  const go = (f) => { if (f) analyse(f, body, m).catch((err) => { toastError(err); }); };
  file.addEventListener('change', () => go(file.files[0]));
  camera.addEventListener('change', () => go(camera.files[0]));
}

async function analyse(f, body, m) {
  const isPdf = f.type === 'application/pdf';
  if (!isPdf && !f.type.startsWith('image/')) throw new Error('Choisis une image ou un PDF');
  if (/svg/i.test(f.type)) throw new Error('Les images SVG ne sont pas acceptées');
  const ready = isPdf ? f : await compressImage(f, 2400);
  if (ready.size > 15 * 1024 * 1024) throw new Error('Fichier trop lourd (15 Mo max)');
  body.replaceChildren(h('div.ai-loading', h('div.spinner'), h('p', 'L\'IA lit ton emploi du temps…'), h('small.muted', 'Ça prend en général 10 à 30 secondes.')));
  let result;
  try {
    const data = toB64(new Uint8Array(await ready.arrayBuffer()));
    result = await generate([{ inlineData: { mimeType: isPdf ? 'application/pdf' : (ready.type || 'image/jpeg'), data } }, { text: timetablePrompt }],
      { system: TIMETABLE_SYSTEM, schema: timetableSchema, temperature: 0 });
  } catch (err) {
    body.replaceChildren(h('p.form-error', err.message), h('button.btn.btn-ghost', { type: 'button', onclick: () => { m.close(); openImport(); } }, 'Réessayer'));
    return;
  }
  const rows = cleanImported(result?.slots);
  reviewImport(rows, txt(result?.notes, 400), body, m);
}

/** Editable table of what the AI read: the delegate checks it before anything is saved. */
function reviewImport(rows, notes, body, m) {
  const tbody = h('tbody');
  const dayOpts = (v) => DAYS.map((d, i) => h('option', { value: i, selected: i === v }, d));
  const addRow = (s = { day: 0, start_at: '08:00', end_at: '09:00', subject: '', teacher: '', room: '', week: '' }) => {
    const tr = h('tr',
      h('td', h('select', { name: 'day', 'aria-label': 'Jour' }, dayOpts(s.day))),
      h('td', h('input', { type: 'time', name: 'start', value: s.start_at, step: 300, 'aria-label': 'Début' })),
      h('td', h('input', { type: 'time', name: 'end', value: s.end_at, step: 300, 'aria-label': 'Fin' })),
      h('td', h('input', { name: 'subject', value: s.subject, maxLength: 40, placeholder: 'Matière', 'aria-label': 'Matière' })),
      h('td', h('input', { name: 'teacher', value: s.teacher, maxLength: 40, placeholder: 'Prof', 'aria-label': 'Professeur' })),
      h('td', h('input', { name: 'room', value: s.room, maxLength: 20, placeholder: 'Salle', 'aria-label': 'Salle' })),
      h('td', h('select', { name: 'week', 'aria-label': 'Semaine' }, [['', 'Toutes'], ['A', 'A'], ['B', 'B']].map(([v, l]) => h('option', { value: v, selected: v === s.week }, l)))),
      h('td', h('button.icon-btn', { type: 'button', 'aria-label': 'Retirer cette ligne', onclick: () => { tr.remove(); count(); } }, '✕')));
    tr._color = s.color;
    tbody.append(tr);
  };
  rows.forEach(addRow);
  const counter = h('b');
  const count = () => { counter.textContent = `${tbody.children.length} cours`; };
  count();
  const replace = h('input', { type: 'checkbox', checked: slots.length > 0 });
  body.replaceChildren(
    h('p', rows.length ? '✅ Voilà ce que l\'IA a lu. Vérifie et corrige si besoin avant d\'enregistrer :' : '😕 L\'IA n\'a trouvé aucun cours lisible. Essaie une photo plus nette, ou ajoute les lignes à la main.'),
    notes ? h('p.hint', '⚠️ ', notes) : null,
    h('div.import-table-wrap', h('table.import-table',
      h('thead', h('tr', ['Jour', 'Début', 'Fin', 'Matière', 'Prof', 'Salle', 'Semaine', ''].map((t) => h('th', t)))), tbody)),
    h('div.btn-row', h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { addRow(); count(); } }, '＋ Ajouter une ligne'), counter),
    slots.length ? h('label.check', replace, h('span', `Remplacer l'emploi du temps actuel (${slots.length} cours) au lieu de compléter`)) : null,
    h('div.modal-actions',
      h('button.btn.btn-ghost', { type: 'button', onclick: () => m.close() }, 'Annuler'),
      h('button.btn.btn-primary', { type: 'button', onclick: async (e) => {
        const btn = e.currentTarget;
        busy(btn, true);
        try { await saveImported(tbody, replace.checked); m.close(); } catch (err) { toastError(err); } finally { busy(btn, false); }
      } }, 'Enregistrer l\'emploi du temps')));
}

async function saveImported(tbody, replace) {
  const used = new Map();
  const list = [...tbody.children].map((tr) => {
    const v = (n) => tr.querySelector(`[name="${n}"]`).value;
    return { day: Number(v('day')), start_at: v('start'), end_at: v('end'), subject: v('subject').trim(), teacher: v('teacher').trim(), room: v('room').trim(), week: v('week'), color: tr._color };
  });
  const bad = list.findIndex((s) => !s.subject || !HHMM.test(s.start_at) || !HHMM.test(s.end_at) || s.start_at >= s.end_at);
  if (bad >= 0) throw new Error(`Ligne ${bad + 1} : il manque la matière, ou l'heure de fin est avant le début`);
  if (!list.length) throw new Error('Aucun cours à enregistrer');
  const docs = list.map((s) => {
    const d = { day: s.day, start_at: s.start_at, end_at: s.end_at, subject: s.subject, teacher: s.teacher, room: s.room, color: s.color || colorFor(s.subject, used) };
    if (s.week) d.week = s.week;
    return d;
  });
  const old = replace ? (await getDocs(slotsCol())).docs.map((d) => d.ref) : [];
  const writes = [...old.map((ref) => (b) => b.delete(ref)), ...docs.map((d) => (b) => b.set(doc(slotsCol()), d))];
  for (let i = 0; i < writes.length; i += 400) {
    const b = writeBatch(db);
    writes.slice(i, i + 400).forEach((w) => w(b));
    await b.commit();
  }
  toast(`Emploi du temps enregistré : ${docs.length} cours 🎉`, 'success', 6000);
  if (docs.some((d) => d.week) && !state.cls.week_a) setTimeout(() => setWeekLetter(mondayOf(new Date())), 800);
}

/**
 * Slot editor, shared by the timetable and the vote panel.
 * mode: 'add' | 'edit' (delegate, direct) | 'propose' (vote, action = add | modify | delete)
 */
export function openSlotForm({ mode: formMode, action = 'add', slot = null }) {
  const proposing = formMode === 'propose';
  const base = slot || { day: 0, start_at: '08:00', end_at: '09:00', subject: '', teacher: '', room: '', color: SWATCHES[0], week: '' };
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
    week: h('select', { name: 'week' }, [['', 'Toutes les semaines'], ['A', 'Semaine A'], ['B', 'Semaine B']]
      .map(([v, l]) => h('option', { value: v, selected: v === (base.week || '') }, l))),
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
    field('Semaine', f.week),
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
      f.subject.value = s.subject; f.teacher.value = s.teacher; f.room.value = s.room; f.week.value = s.week || ''; color = s.color;
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
    title: titles[formMode], body: form, wide: true,
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
    if (f.week.value) data.week = f.week.value;
    const needsSlot = !['delete', 'poll'].includes(current.action);
    if (needsSlot && data.start_at >= data.end_at) throw new Error('La fin doit être après le début');
    if (formMode === 'add') {
      await addDoc(slotsCol(), data);
      toast('Cours ajouté', 'success');
    } else if (formMode === 'edit') {
      // A slot going back to "every week" must lose its week field.
      await updateDoc(doc(slotsCol(), slot.id), { ...data, ...(f.week.value ? {} : { week: deleteField() }) });
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
