// Class council ("conseil de classe") results: average, appraisal and mention per student and period.
// Every record has its own AES key, wrapped (ECDH) for the student concerned and for each teacher and delegate only,
// so neither other students nor the server can read anyone's results.
import { onSnapshot, query, where, doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { sub, plain } from './fb.js';
import { state, on, isTeacher, isDelegate } from './state.js';
import { generateClassKey, wrapClassKey, unwrapClassKey, encryptJSON, decryptJSON } from './crypto.js';
import { $, h, icon, avatar, toast, toastError, confirmDialog, busy } from './ui.js';

export const PERIODS = { T1: '1er trimestre', T2: '2e trimestre', T3: '3e trimestre', S1: '1er semestre', S2: '2nd semestre' };
const MENTIONS = ['', 'Félicitations', 'Compliments', 'Encouragements', 'Mise en garde (travail)', 'Mise en garde (comportement)', 'Avertissement'];

let records = new Map();   // doc id -> { row, data | null, key | null }
let unsub = null;
let period = 'T1';
let search = '';
let selectedId = null;
let root;

const recordId = (p, studentId) => `${p}_${studentId}`;
const aad = (id) => `council|${state.cls.id}|${id}`;
const wrapInfo = (id) => `council:${id}`;
const students = () => [...state.members.values()].filter((m) => m.status === 'active' && m.role !== 'teacher');
/** Teachers and delegates enter and read every result. */
const staff = () => [...state.members.values()].filter((m) => m.status === 'active' && ['teacher', 'delegate'].includes(m.role));
const isStaff = () => isTeacher() || isDelegate();

export function initCouncil() {
  root = $('#panel-council');
  on('members', () => { render(); if (isStaff()) rewrapMissing(); });
  on('me', render);
}

export function startCouncil() {
  stopCouncil();
  const col = sub(state.cls.id, 'council');
  // Students may only query their own records (enforced by the rules).
  const q = isStaff() ? col : query(col, where('student_id', '==', state.me.id));
  unsub = onSnapshot(q, async (snap) => {
    const next = new Map();
    for (const d of snap.docs) {
      const row = plain(d);
      const prev = records.get(row.id);
      next.set(row.id, prev && prev.row.updated_at === row.updated_at ? prev : { row, ...(await openRecord(row)) });
    }
    records = next;
    render();
    if (isStaff()) rewrapMissing();
  }, toastError);
}
export function stopCouncil() { unsub?.(); unsub = null; records = new Map(); selectedId = null; }

// ------------------------------------------------------------ crypto
async function openRecord(row) {
  const share = row.keys?.[state.me.id];
  if (!share) return { data: null, key: null };
  try {
    const key = await unwrapClassKey({ ...share, epoch: wrapInfo(row.id) }, state.privateKey, { classId: state.cls.id, userId: state.me.id });
    const data = await decryptJSON(key, row.iv, row.ciphertext, aad(row.id));
    return { data, key };
  } catch {
    return { data: null, key: null };
  }
}

async function wrapFor(key, id, member) {
  const w = await wrapClassKey(key, state.privateKey, member.public_key, { classId: state.cls.id, epoch: wrapInfo(id), userId: member.id });
  return { iv: w.iv, wrapped: w.wrapped, from_public_key: state.me.public_key, to_public_key: member.public_key };
}

/** Recipients of a record: the student concerned + every teacher and delegate of the class. */
async function recipientsKeys(key, id, studentId) {
  const keys = {};
  const student = state.members.get(studentId);
  for (const m of [student, ...staff()].filter(Boolean)) keys[m.id] = await wrapFor(key, id, m);
  return keys;
}

async function saveRecord(studentId, payload) {
  const id = recordId(period, studentId);
  const existing = records.get(id);
  const key = existing?.key || await generateClassKey();
  const enc = await encryptJSON(key, payload, aad(id));
  await setDoc(doc(sub(state.cls.id, 'council'), id), {
    student_id: studentId, period, author_id: state.me.id, updated_at: serverTimestamp(),
    iv: enc.iv, ciphertext: enc.ciphertext, keys: await recipientsKeys(key, id, studentId),
  });
}

let rewrapping = false;
/** A new teacher or delegate (or a student whose keys were reset) gets access to existing records automatically. */
async function rewrapMissing() {
  if (rewrapping || !records.size) return;
  rewrapping = true;
  try {
    for (const [id, rec] of records) {
      if (!rec.key) continue;
      const needed = [state.members.get(rec.row.student_id), ...staff()].filter(Boolean)
        .filter((m) => rec.row.keys?.[m.id]?.to_public_key !== m.public_key);
      if (!needed.length) continue;
      const keys = { ...rec.row.keys };
      for (const m of needed) keys[m.id] = await wrapFor(rec.key, id, m);
      await updateDoc(doc(sub(state.cls.id, 'council'), id), { keys, author_id: state.me.id, updated_at: serverTimestamp() }).catch(() => {});
    }
  } finally { rewrapping = false; }
}

// ------------------------------------------------------------ rendering
function render() {
  if (!root || !state.me) return;
  $('.council-body', root).replaceChildren(isStaff() ? teacherView() : studentView());
}

function studentView() {
  const mine = [...records.values()].filter((r) => r.row.student_id === state.me.id)
    .sort((a, b) => Object.keys(PERIODS).indexOf(a.row.period) - Object.keys(PERIODS).indexOf(b.row.period));
  if (!mine.length) {
    return h('div.empty', icon('award'), h('p', 'Aucun résultat pour l\'instant. Tes professeurs ou tes délégués les saisiront après le conseil de classe.'));
  }
  return h('div.council-cards', mine.map((r) => r.data
    ? h('article.council-card.card',
        h('div.cc-head', h('b', PERIODS[r.row.period]), r.data.mention ? h('span.mention', r.data.mention) : null),
        h('div.cc-average', h('span', fmtAvg(r.data.average)), h('small', '/20')),
        r.data.appreciation ? h('blockquote', r.data.appreciation) : h('p.muted', 'Pas d\'appréciation.'),
        h('small.muted', `Saisi par ${r.data.author || 'un professeur'}`))
    : h('article.council-card.card', h('b', PERIODS[r.row.period]), h('p.muted', icon('lock'), ' Résultat chiffré : un professeur ou un délégué doit te le retransmettre (il suffit qu\'il ouvre cet onglet).'))),
  h('p.hint', icon('lock'), ' Tes résultats sont chiffrés de bout en bout : seuls toi, tes professeurs et les délégués pouvez les lire.'));
}

const fmtAvg = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }));

function teacherView() {
  const list = students().sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr'));
  const recFor = (m) => records.get(recordId(period, m.id));
  const done = list.filter((m) => recFor(m)?.data);
  const avgs = done.map((m) => Number(recFor(m).data.average)).filter((n) => !Number.isNaN(n));
  const classAvg = avgs.length ? avgs.reduce((s, n) => s + n, 0) / avgs.length : null;

  const periodSel = h('select', { 'aria-label': 'Période', onchange: (e) => { period = e.target.value; render(); } },
    Object.entries(PERIODS).map(([v, l]) => h('option', { value: v, selected: v === period }, l)));
  const searchInput = h('input.council-search', {
    type: 'search', placeholder: 'Rechercher un élève…', value: search, 'aria-label': 'Rechercher un élève',
    oninput: (e) => { search = e.target.value; renderList(); },
  });
  const listEl = h('div.council-list', { role: 'listbox', 'aria-label': 'Élèves' });

  function renderList() {
    const q = search.trim().toLowerCase();
    const shown = list.filter((m) => !q || m.display_name.toLowerCase().includes(q) || m.username.includes(q));
    listEl.replaceChildren(...shown.map((m) => {
      const r = recFor(m);
      return h(`button.council-item${m.id === selectedId ? '.active' : ''}`, {
        type: 'button', role: 'option', 'aria-selected': String(m.id === selectedId),
        onclick: () => { selectedId = m.id; render(); },
      },
      avatar(m, 32),
      h('span.ci-name', h('b', m.display_name), h('small', '@' + m.username)),
      r?.data ? h('span.ci-avg', fmtAvg(r.data.average)) : h('span.ci-todo', 'à saisir'));
    }));
    if (!shown.length) listEl.append(h('p.muted.small', q ? 'Aucun élève ne correspond.' : 'Aucun élève dans la classe.'));
  }
  renderList();

  return h('div.council-teacher',
    h('div.council-toolbar',
      h('label.field', h('span', 'Période'), periodSel),
      h('div.council-stats',
        h('span', h('b', `${done.length}/${list.length}`), ' saisis'),
        h('span', h('b', classAvg == null ? '—' : fmtAvg(classAvg)), ' moyenne de classe'))),
    h('div.council-layout',
      h('aside.council-picker', searchInput, listEl),
      h('div.council-editor', editor(list.find((m) => m.id === selectedId), recFor))));
}

function editor(student, recFor) {
  if (!student) {
    return h('div.study-placeholder', icon('award'), h('p', 'Sélectionne un élève dans la liste pour saisir ses résultats.'));
  }
  const rec = recFor(student);
  const data = rec?.data || {};
  const average = h('input', { type: 'number', min: 0, max: 20, step: 0.01, value: data.average ?? '', required: true, 'aria-label': 'Moyenne' });
  const mention = h('select', { 'aria-label': 'Mention' }, MENTIONS.map((m) => h('option', { value: m, selected: m === (data.mention || '') }, m || '— Aucune —')));
  const appreciation = h('textarea', { rows: 6, maxLength: 1000, placeholder: 'Appréciation du conseil de classe…', 'aria-label': 'Appréciation' });
  appreciation.value = data.appreciation || '';
  const counter = h('small.muted', `${appreciation.value.length}/1000`);
  appreciation.addEventListener('input', () => { counter.textContent = `${appreciation.value.length}/1000`; });
  const save = h('button.btn.btn-primary', { type: 'submit' }, h('span', rec ? 'Mettre à jour' : 'Enregistrer'));

  return h('form.council-form.card', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const avg = Number(String(average.value).replace(',', '.'));
    if (average.value === '' || Number.isNaN(avg) || avg < 0 || avg > 20) return toast('La moyenne doit être comprise entre 0 et 20', 'error');
    busy(save, true);
    try {
      await saveRecord(student.id, {
        v: 1, name: student.display_name, average: Math.round(avg * 100) / 100, mention: mention.value,
        appreciation: appreciation.value.trim(), author: state.me.display_name, period,
      });
      toast(`Résultats de ${student.display_name} enregistrés 🔐`, 'success');
      const next = students().sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr'))
        .find((m) => !records.get(recordId(period, m.id))?.data && m.id !== student.id);
      if (next) selectedId = next.id;
    } catch (err) { toastError(err); }
    finally { busy(save, false); }
  } },
  h('div.cf-head', avatar(student, 48), h('div', h('h3', student.display_name), h('small.muted', `@${student.username} · ${PERIODS[period]}`))),
  h('div.row', h('label.field', h('span', 'Moyenne générale (/20)'), average), h('label.field', h('span', 'Mention'), mention)),
  h('label.field', h('span', 'Appréciation'), appreciation), counter,
  h('p.hint', icon('lock'), ` Chiffré pour ${student.display_name}, les professeurs et les délégués uniquement.`),
  h('div.btn-row',
    save,
    rec ? h('button.btn.btn-ghost', { type: 'button', onclick: async () => {
      if (!(await confirmDialog('Supprimer ces résultats ?', `Les résultats de ${student.display_name} pour le ${PERIODS[period]} seront effacés.`))) return;
      try { await deleteDoc(doc(sub(state.cls.id, 'council'), recordId(period, student.id))); toast('Résultats supprimés'); }
      catch (err) { toastError(err); }
    } }, 'Supprimer') : null));
}
