// "Révisions IA": encrypted course library + revision tools (sheet, quiz, graded test, questions).
import { onSnapshot, query, orderBy, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { sub, plain } from './fb.js';
import { state, on, isDelegate, canPublish, memberName } from './state.js';
import { encryptJSON, decryptJSON, toB64 } from './crypto.js';
import { currentKey } from './keyring.js';
import { uploadEncrypted, downloadDecrypted, deleteFileChunks, compressImage, MAX_FILE } from './media.js';
import { generate, systemInstruction, prompts, quizSchema, examSchema, gradingSchema } from './ai.js';
import { renderMarkdown } from './md.js';
import { $, $$, h, icon, modal, toast, toastError, confirmDialog, fmtSize, fmtDay, busy } from './ui.js';

const KINDS = { cours: 'Cours', methode: 'Méthodes du cahier', exercices: 'Exercices corrigés', autre: 'Autre' };
const SUBJECTS = ['Mathématiques', 'Français', 'Histoire-Géographie', 'Physique-Chimie', 'SVT', 'Anglais', 'Espagnol', 'Allemand',
  'Philosophie', 'SES', 'NSI', 'EMC', 'Technologie', 'Arts', 'EPS'];
const ACCEPT = 'application/pdf,image/*,text/plain,text/markdown,.md,.txt';
const MAX_REQUEST = 18 * 1024 * 1024;   // Gemini inline data limit (~20 MB) minus prompt margin
const COOLDOWN_MS = 8000;

let courses = [];              // { id, uploader_id, created_at, meta: {title, subject, kind, files[]} | null }
const selected = new Set();
let subjectFilter = '';
let tool = 'sheet';
let unsub = null;
let lastRequest = 0;
let chatHistory = [];          // [{ role, parts }] for the "Question" tool
let root;

const courseAad = (c) => `course|${state.cls.id}|${c.epoch}|${c.uploader_id}`;

export function initStudy() {
  root = $('#panel-study');
  $('[data-action="new-course"]', root).addEventListener('click', openUpload);
  $$('[data-study-tool]', root).forEach((b) => b.addEventListener('click', () => {
    tool = b.dataset.studyTool;
    $$('[data-study-tool]', root).forEach((x) => x.classList.toggle('active', x === b));
    renderOptions();
  }));
  on('keys', decryptAll);
  on('me', renderLibrary);
  renderOptions();
}

export function startStudy() {
  stopStudy();
  unsub = onSnapshot(query(sub(state.cls.id, 'courses'), orderBy('created_at', 'desc')), async (snap) => {
    const known = new Map(courses.map((c) => [c.id, c]));
    const firstLoad = !courses.length;
    courses = await Promise.all(snap.docs.map(async (d) => {
      const row = plain(d);
      const prev = known.get(row.id);
      return prev?.meta ? prev : { ...row, meta: await decryptMeta(row) };
    }));
    for (const id of [...selected]) if (!courses.some((c) => c.id === id)) selected.delete(id);
    // New courses of the current subject are used by the AI right away.
    for (const c of courses) if (!known.has(c.id) && !firstLoad && c.meta?.subject === subjectFilter) selected.add(c.id);
    renderLibrary();
  }, toastError);
}
export function stopStudy() { unsub?.(); unsub = null; courses = []; selected.clear(); chatHistory = []; subjectFilter = ''; }

async function decryptMeta(row) {
  const key = state.classKeys.get(row.epoch);
  if (!key) return null;
  try { return await decryptJSON(key, row.iv, row.ciphertext, courseAad(row)); } catch { return null; }
}
async function decryptAll() {
  let changed = false;
  for (const c of courses) if (!c.meta) { c.meta = await decryptMeta(c); changed ||= !!c.meta; }
  if (changed) renderLibrary();
}

// ------------------------------------------------------------ library
/** Switches subject: all its courses are selected and the question thread starts over. */
function chooseSubject(subject) {
  subjectFilter = subject;
  selected.clear();
  for (const c of courses) if (c.meta?.subject === subject) selected.add(c.id);
  chatHistory = [];
  renderLibrary();
  renderOptions();
}

function renderLibrary() {
  if (!root) return;
  const readable = courses.filter((c) => c.meta);
  const counts = new Map();
  for (const c of readable) counts.set(c.meta.subject, (counts.get(c.meta.subject) || 0) + 1);
  // Subjects with courses first; publishers also see the usual subjects to start a new one.
  const withCourses = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
  const extra = canPublish() ? SUBJECTS.filter((s) => !counts.has(s)) : [];
  if (!subjectFilter || (!counts.has(subjectFilter) && !extra.includes(subjectFilter))) {
    if (withCourses.length) return chooseSubject(withCourses[0]);
    subjectFilter = extra[0] || '';
  }

  $('.subject-chips', root).replaceChildren(
    ...withCourses.map((s) => h(`button.subject-chip${s === subjectFilter ? '.active' : ''}`, {
      type: 'button', role: 'tab', 'aria-selected': String(s === subjectFilter), onclick: () => chooseSubject(s),
    }, s, h('b', counts.get(s)))),
    ...extra.map((s) => h(`button.subject-chip.empty${s === subjectFilter ? '.active' : ''}`, {
      type: 'button', role: 'tab', 'aria-selected': String(s === subjectFilter), onclick: () => chooseSubject(s),
      title: 'Aucun cours pour l\'instant',
    }, s)),
    canPublish() ? h('button.subject-chip.add', { type: 'button', onclick: addSubject }, '+ Autre matière') : null);

  $('[data-subject-title]', root).textContent = subjectFilter ? `Cours de ${subjectFilter}` : 'Cours';
  $('[data-new-course-label]').textContent = subjectFilter ? `Ajouter un cours de ${subjectFilter}` : 'Ajouter un cours';

  const list = $('.course-list', root);
  const shown = readable.filter((c) => c.meta.subject === subjectFilter);
  list.replaceChildren(...shown.map(courseItem));
  if (!shown.length) {
    list.append(h('div.empty.small-empty', icon('book'), h('p', !subjectFilter
      ? 'Aucun cours pour l\'instant. Les délégués, les suppléants, les professeurs et les membres de confiance peuvent en ajouter.'
      : canPublish()
        ? `Aucun cours de ${subjectFilter}. Ajoute le premier (PDF, photos du cahier ou texte) !`
        : `Aucun cours de ${subjectFilter} pour l'instant.`)));
  }
  const locked = courses.length - readable.length;
  if (locked) list.append(h('p.muted.small', icon('lock'), ` ${locked} cours chiffré(s) avec une clé que tu n'as pas encore.`));
  const size = selectedSize();
  $('.selection-info', root).textContent = shown.length
    ? `L'IA utilise ${selected.size}/${shown.length} cours de ${subjectFilter} · ${fmtSize(size)}${size > MAX_REQUEST ? ' — trop lourd, décoche des cours' : ''}`
    : '';
  $('.selection-info', root).classList.toggle('warn', size > MAX_REQUEST);
}

async function addSubject() {
  const input = h('input', { maxLength: 40, required: true, placeholder: 'Ex. Latin, Sciences numériques…' });
  modal({
    title: 'Nouvelle matière',
    body: h('label.field', h('span', 'Nom de la matière'), input),
    actions: [
      { label: 'Annuler' },
      { label: 'Choisir', variant: 'btn-primary', onClick: () => {
        const name = input.value.trim();
        if (name.length < 2) throw new Error('Nom de matière trop court');
        subjectFilter = name;
        if (!SUBJECTS.includes(name)) SUBJECTS.push(name);
        chooseSubject(name);
        openUpload();
      } },
    ],
  });
}

function courseItem(c) {
  const canDelete = c.uploader_id === state.me.id || isDelegate();
  const files = c.meta.files || [];
  return h(`label.course-item${selected.has(c.id) ? '.selected' : ''}`,
    h('input', { type: 'checkbox', checked: selected.has(c.id), onchange: (e) => {
      if (e.target.checked) selected.add(c.id); else selected.delete(c.id);
      renderLibrary();
    } }),
    h(`span.kind-dot.k-${c.meta.kind}`, { title: KINDS[c.meta.kind] }),
    h('div.ci-info',
      h('b', c.meta.title),
      h('small', `${KINDS[c.meta.kind] || ''} · ${files.length} fichier(s) · ${memberName(c.uploader_id)} · ${fmtDay(c.created_at).toLowerCase()}`)),
    h('button.icon-btn', { type: 'button', title: 'Ouvrir', 'aria-label': `Ouvrir ${c.meta.title}`, onclick: (e) => { e.preventDefault(); preview(c); } }, icon('book')),
    canDelete ? h('button.icon-btn', { type: 'button', title: 'Supprimer', 'aria-label': `Supprimer ${c.meta.title}`, onclick: (e) => { e.preventDefault(); removeCourse(c); } }, icon('trash')) : null);
}

const selectedSize = () => courses.filter((c) => selected.has(c.id) && c.meta)
  .reduce((s, c) => s + (c.meta.files || []).reduce((t, f) => t + f.size, 0) + (c.meta.text?.length || 0), 0);

async function preview(c) {
  const body = h('div.course-preview', h('div.spinner'));
  modal({ title: c.meta.title, wide: true, body });
  try {
    const key = state.classKeys.get(c.epoch);
    const items = [];
    if (c.meta.text) items.push(h('pre.course-text', c.meta.text));
    for (const f of c.meta.files || []) {
      const url = URL.createObjectURL(new Blob([await downloadDecrypted(f, key)], { type: f.mime }));
      if (f.mime.startsWith('image/')) items.push(h('img', { src: url, alt: `${c.meta.title} — ${f.name}` }));
      else items.push(h('a.btn.btn-ghost.btn-sm', { href: url, target: '_blank', rel: 'noopener', download: f.name }, icon('book'), h('span', `Ouvrir ${f.name}`)));
    }
    body.replaceChildren(...items);
  } catch (err) { body.replaceChildren(h('p', 'Impossible d\'ouvrir ce cours.')); toastError(err); }
}

async function removeCourse(c) {
  if (!(await confirmDialog('Supprimer ce cours ?', `« ${c.meta.title} » sera retiré de la bibliothèque pour toute la classe.`))) return;
  try {
    await deleteDoc(doc(sub(state.cls.id, 'courses'), c.id));
    for (const f of c.meta.files || []) await deleteFileChunks(f);
    selected.delete(c.id);
    toast('Cours supprimé');
  } catch (err) { toastError(err); }
}

// ------------------------------------------------------------ upload
function openUpload() {
  if (!canPublish()) return toast('Seuls les délégués et les membres de confiance peuvent ajouter des cours', 'error');
  const title = h('input', { required: true, maxLength: 80, placeholder: 'Ex. Chapitre 3 — Les fonctions affines' });
  const subjectList = h('datalist#subject-list', SUBJECTS.map((s) => h('option', { value: s })));
  const subject = h('input', { required: true, maxLength: 40, list: 'subject-list', placeholder: 'Mathématiques', value: subjectFilter || '' });
  const kind = h('select', Object.entries(KINDS).map(([v, l]) => h('option', { value: v }, l)));
  const files = h('input', { type: 'file', accept: ACCEPT, multiple: true });
  const text = h('textarea', { rows: 5, maxLength: 12000, placeholder: 'Ou colle ici le texte du cours / de la méthode (facultatif)' });
  const info = h('p.hint', icon('lock'), ' Les fichiers sont chiffrés dans la bibliothèque, mais leur contenu est envoyé à Google Gemini quand un élève génère une révision : ',
    h('b', 'aucune donnée personnelle'), ' (noms, notes, photos d\'élèves). Photos du cahier : une photo par page, bien éclairée. 15 Mo max par cours.');
  const progress = h('p.muted.small');

  modal({
    title: subjectFilter ? `Ajouter un cours de ${subjectFilter}` : 'Ajouter un cours',
    wide: true,
    body: h('form.slot-form', { onsubmit: (e) => e.preventDefault() },
      h('label.field', h('span', 'Titre'), title),
      h('div.row', h('label.field', h('span', 'Matière'), subject, subjectList), h('label.field', h('span', 'Type'), kind)),
      h('label.field', h('span', 'Fichiers (PDF, photos, .txt)'), files),
      h('label.field', h('span', 'Texte'), text),
      info, progress),
    actions: [
      { label: 'Annuler' },
      { label: 'Publier le cours', variant: 'btn-primary', onClick: async () => {
        if (title.value.trim().length < 2) throw new Error('Donne un titre au cours');
        if (subject.value.trim().length < 2) throw new Error('Indique la matière');
        const chosen = [...files.files];
        if (!chosen.length && !text.value.trim()) throw new Error('Ajoute au moins un fichier ou du texte');
        const bad = chosen.find((f) => !/^(application\/pdf|image\/|text\/)/.test(f.type) && !/\.(md|txt)$/i.test(f.name));
        if (bad) throw new Error(`Format non pris en charge : ${bad.name}. Convertis-le en PDF.`);
        const key = currentKey();
        if (!key) throw new Error('Clé de la classe pas encore reçue');
        const prepared = [];
        for (const f of chosen) prepared.push(f.type.startsWith('image/') ? await compressImage(f, 2400) : f);
        const total = prepared.reduce((s, f) => s + f.size, 0) + text.value.length;
        if (total > MAX_FILE) throw new Error(`Cours trop lourd (${fmtSize(total)}) : 15 Mo maximum. Découpe-le en plusieurs cours.`);
        const descs = [];
        for (let i = 0; i < prepared.length; i++) {
          progress.textContent = `Chiffrement et envoi du fichier ${i + 1}/${prepared.length}…`;
          const f = prepared[i];
          const typed = f.type ? f : new File([f], f.name, { type: 'text/plain' });
          descs.push({ ...(await uploadEncrypted(typed, key, (p) => {
            progress.textContent = `Envoi du fichier ${i + 1}/${prepared.length} : ${Math.round(p * 100)} %`;
          })), name: chosen[i].name.slice(0, 120) });
        }
        const meta = { v: 1, title: title.value.trim(), subject: subject.value.trim(), kind: kind.value, text: text.value.trim(), files: descs };
        const ref = doc(sub(state.cls.id, 'courses'));
        const epoch = state.cls.key_epoch;
        const enc = await encryptJSON(key, meta, `course|${state.cls.id}|${epoch}|${state.me.id}`);
        await setDoc(ref, { uploader_id: state.me.id, epoch, iv: enc.iv, ciphertext: enc.ciphertext, created_at: serverTimestamp() });
        toast('Cours publié 📚', 'success');
      } },
    ],
  });
}

// ------------------------------------------------------------ AI tools
function renderOptions() {
  const box = $('.study-options', root);
  const focus = h('input.study-focus', { maxLength: 150, placeholder: 'Sur quoi précisément ? (facultatif, ex. « le théorème de Pythagore »)' });
  const count = (values, def) => h('select.study-count', values.map((v) => h('option', { value: v, selected: v === def }, `${v} questions`)));
  const level = h('select.study-level', ['facile', 'moyen', 'difficile'].map((v) => h('option', { value: v, selected: v === 'moyen' }, `Niveau ${v}`)));
  const go = (label) => h('button.btn.btn-primary.study-go', { type: 'button', onclick: (e) => run(e.currentTarget) }, icon('sparkles'), h('span', label));

  const layouts = {
    sheet: [focus, go('Générer la fiche')],
    quiz: [h('div.row', count([5, 10, 15], 10), level), focus, go('Générer le quiz')],
    exam: [h('div.row', count([3, 5, 8], 5), level), focus, go('Générer l\'évaluation')],
    ask: [],
  };
  box.replaceChildren(...layouts[tool]);
  const out = $('.study-output', root);
  if (tool === 'ask') renderAsk(out);
  else out.replaceChildren(h('div.study-placeholder', icon('sparkles'), subjectFilter ? h('b', subjectFilter) : null, h('p', {
    sheet: 'Une fiche claire avec définitions, méthodes du cahier, exemples et auto-test.',
    quiz: 'Un QCM interactif corrigé instantanément, avec explications tirées de vos cours.',
    exam: 'Une évaluation notée sur 20 : réponds, rends ta copie, l\'IA corrige avec la méthode du cahier.',
  }[tool])));
}

/** Decrypts the selected courses into Gemini "parts" (text + inline PDF/images). */
async function courseParts() {
  const chosen = courses.filter((c) => selected.has(c.id) && c.meta);
  if (!chosen.length) {
    throw new Error(subjectFilter && !courses.some((c) => c.meta?.subject === subjectFilter)
      ? `Aucun cours de ${subjectFilter} pour l'instant : il faut d'abord en ajouter un.`
      : 'Coche au moins un cours de la matière.');
  }
  if (selectedSize() > MAX_REQUEST) throw new Error('Trop de cours sélectionnés (18 Mo max). Retires-en quelques-uns.');
  const parts = [{ text: 'DOCUMENTS DE COURS DE LA CLASSE (seule source autorisée) :' }];
  for (const c of chosen) {
    const key = state.classKeys.get(c.epoch);
    parts.push({ text: `\n=== DÉBUT DU DOCUMENT « ${c.meta.title} » — ${c.meta.subject} — ${KINDS[c.meta.kind]} ===` });
    if (c.meta.text) parts.push({ text: c.meta.text });
    for (const f of c.meta.files || []) {
      const bytes = await downloadDecrypted(f, key);
      if (f.mime.startsWith('text/') || /\.(md|txt)$/i.test(f.name)) parts.push({ text: new TextDecoder().decode(bytes) });
      else parts.push({ inlineData: { mimeType: f.mime, data: toB64(bytes) } });
    }
    parts.push({ text: `=== FIN DU DOCUMENT « ${c.meta.title} » ===` });
  }
  return parts;
}

function checkCooldown() {
  const wait = lastRequest + COOLDOWN_MS - Date.now();
  if (wait > 0) throw new Error(`Patiente ${Math.ceil(wait / 1000)} s avant une nouvelle demande.`);
  lastRequest = Date.now();
}

async function run(btn) {
  const out = $('.study-output', root);
  const opts = {
    focus: $('.study-focus', root)?.value.trim() || '',
    count: Number($('.study-count', root)?.value || 10),
    level: $('.study-level', root)?.value || 'moyen',
  };
  busy(btn, true);
  out.replaceChildren(thinking('Lecture de vos cours…'));
  try {
    checkCooldown();
    const docs = await courseParts();
    out.replaceChildren(thinking(tool === 'sheet' ? 'Rédaction de la fiche…' : 'Préparation des questions…'));
    const system = systemInstruction(state.cls.name);
    if (tool === 'sheet') {
      const md = await generate([...docs, { text: prompts.sheet(opts) }], { system });
      showSheet(out, md);
    } else if (tool === 'quiz') {
      const quiz = await generate([...docs, { text: prompts.quiz(opts) }], { system, schema: quizSchema });
      showQuiz(out, quiz);
    } else if (tool === 'exam') {
      const exam = await generate([...docs, { text: prompts.exam(opts) }], { system, schema: examSchema });
      showExam(out, exam, docs);
    }
  } catch (err) {
    out.replaceChildren(h('div.study-error', icon('lock'), h('p', err.message)));
  } finally {
    busy(btn, false);
  }
}

const thinking = (label) => h('div.study-thinking', h('div.orbit-loader', h('span'), h('span')), h('p', label));
const disclaimer = () => h('p.ai-disclaimer', '✨ Généré par IA à partir de vos cours uniquement. L\'IA peut se tromper : vérifie avec ton cahier.');

function download(name, content, type = 'text/markdown') {
  const a = h('a', { href: URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function showSheet(out, md) {
  const sheet = h('article.study-sheet.card', renderMarkdown(md));
  out.replaceChildren(
    h('div.study-actions',
      h('button.btn.btn-ghost.btn-sm', { onclick: async () => {
        try { await navigator.clipboard.writeText(md); toast('Fiche copiée', 'success'); } catch { toast('Copie impossible', 'error'); }
      } }, 'Copier'),
      h('button.btn.btn-ghost.btn-sm', { onclick: () => download('fiche-revision.md', md) }, 'Télécharger'),
      h('button.btn.btn-ghost.btn-sm', { onclick: () => printSheet(sheet) }, 'Imprimer')),
    sheet, disclaimer());
}

function printSheet(sheet) {
  const w = window.open('', '_blank');
  if (!w) return toast('Autorise les fenêtres pop-up pour imprimer', 'error');
  w.document.title = 'Fiche de révision';
  const style = w.document.createElement('style');
  style.textContent = 'body{font-family:system-ui,sans-serif;max-width:760px;margin:24px auto;line-height:1.6;color:#111}h2,h3{color:#3b2bb8}blockquote{border-left:3px solid #999;margin:0;padding-left:12px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}';
  w.document.head.append(style);
  document.querySelectorAll('link[data-katex]').forEach((l) => w.document.head.append(l.cloneNode()));
  w.document.body.append(sheet.cloneNode(true));
  setTimeout(() => w.print(), 600);
}

function showQuiz(out, quiz) {
  const questions = (quiz.questions || []).filter((q) => q.choices?.length >= 2);
  let answered = 0;
  let score = 0;
  const scoreEl = h('div.quiz-score', `0 / ${questions.length}`);
  const cards = questions.map((q, i) => {
    const feedback = h('div.quiz-feedback');
    const buttons = q.choices.map((choice, c) => h('button.quiz-choice', { type: 'button', onclick: () => {
      if (card.classList.contains('done')) return;
      card.classList.add('done');
      const good = c === q.answer_index;
      if (good) score++;
      answered++;
      buttons.forEach((b, k) => { b.classList.toggle('correct', k === q.answer_index); b.disabled = true; });
      if (!good) buttons[c].classList.add('wrong');
      feedback.replaceChildren(h('b', good ? '✔ Bonne réponse !' : '✘ Raté.'), ' ', renderMarkdown(q.explanation), q.source ? h('small.quiz-source', `Source : ${q.source}`) : '');
      scoreEl.textContent = `${score} / ${questions.length}`;
      if (answered === questions.length) {
        scoreEl.classList.add('final');
        toast(`Quiz terminé : ${score}/${questions.length} ${score / questions.length >= 0.8 ? '🚀' : score / questions.length >= 0.5 ? '👍' : '📚'}`, 'success');
      }
    } }, renderMarkdown(choice)));
    const card = h('div.quiz-card.card', h('div.quiz-num', `Question ${i + 1}`), renderMarkdown(q.question), h('div.quiz-choices', buttons), feedback);
    return card;
  });
  out.replaceChildren(h('div.study-actions', h('h3', quiz.title || 'Quiz'), scoreEl), ...cards, disclaimer());
}

function showExam(out, exam, docs) {
  const questions = exam.questions || [];
  const total = questions.reduce((s, q) => s + (q.points || 0), 0) || 20;
  const answers = questions.map(() => h('textarea', { rows: 4, placeholder: 'Ta réponse (rédige comme dans le cahier)…' }));
  const submit = h('button.btn.btn-primary', { type: 'button', onclick: async () => {
    if (answers.every((a) => !a.value.trim())) return toast('Réponds à au moins une question', 'error');
    busy(submit, true);
    const status = thinking('Correction de ta copie…');
    submit.after(status);
    try {
      checkCooldown();
      const grading = await generate([...docs, { text: prompts.grade({ exam, answers: answers.map((a) => a.value) }) }],
        { system: systemInstruction(state.cls.name), schema: gradingSchema });
      status.remove();
      showGrades(questions, grading, total);
      submit.remove();
      answers.forEach((a) => { a.readOnly = true; });
    } catch (err) {
      status.remove();
      toastError(err);
      busy(submit, false);
    }
  } }, h('span', 'Rendre ma copie'));

  const blocks = questions.map((q, i) => h('div.exam-q.card', { dataset: { index: i } },
    h('div.quiz-num', `Question ${i + 1} · ${q.points} pt${q.points > 1 ? 's' : ''}`),
    renderMarkdown(q.question), answers[i], h('div.exam-result')));
  out.replaceChildren(
    h('div.study-actions', h('h3', exam.title || 'Évaluation'), h('span.muted', `Sur ${total} points`)),
    exam.instructions ? h('p.muted', exam.instructions) : null,
    ...blocks, submit, disclaimer());

  function showGrades(qs, grading, max) {
    let sum = 0;
    for (const r of grading.results || []) {
      const block = blocks[r.index];
      if (!block) continue;
      const pts = Math.max(0, Math.min(Number(r.score) || 0, qs[r.index].points || 0));
      sum += pts;
      block.querySelector('.exam-result').replaceChildren(
        h('div.exam-score', `${pts} / ${qs[r.index].points}`),
        h('div.exam-feedback', renderMarkdown(r.feedback)),
        h('details', h('summary', 'Voir la correction (méthode du cahier)'), renderMarkdown(r.correction),
          qs[r.index].source ? h('small.quiz-source', `Source : ${qs[r.index].source}`) : null));
    }
    const on20 = Math.round((sum / max) * 20 * 10) / 10;
    out.prepend(h('div.exam-total.card', h('div.big-score', `${on20}`, h('small', '/20')),
      h('div', h('b', `${sum} / ${max} points`), grading.advice ? renderMarkdown(grading.advice) : null)));
    out.scrollTo?.({ top: 0, behavior: 'smooth' });
  }
}

// ------------------------------------------------------------ "Question" tool (grounded chat)
function renderAsk(out) {
  const thread = h('div.ask-thread');
  const input = h('textarea', { rows: 2, maxLength: 1000, placeholder: 'Pose une question sur vos cours… (ex. « Explique-moi la méthode pour résoudre une équation du 2nd degré »)' });
  const send = h('button.btn.btn-primary', { type: 'submit' }, icon('sparkles'), h('span', 'Demander'));
  const reset = h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { chatHistory = []; thread.replaceChildren(); } }, 'Nouvelle conversation');
  for (const turn of chatHistory.slice(1)) thread.append(bubble(turn.role, turn.parts.map((p) => p.text || '').join('')));

  const form = h('form.ask-form', { onsubmit: async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    busy(send, true);
    try {
      checkCooldown();
      if (!chatHistory.length) chatHistory.push({ role: 'user', parts: [...(await courseParts()), { text: 'Voici nos cours. Réponds à mes questions en t\'y limitant.' }] }, { role: 'model', parts: [{ text: 'Compris : je me limite à vos cours et aux méthodes du cahier.' }] });
      input.value = '';
      thread.append(bubble('user', q));
      const pending = thinking('Recherche dans vos cours…');
      thread.append(pending);
      chatHistory.push({ role: 'user', parts: [{ text: q }] });
      const answer = await generate({ contents: chatHistory }, { system: systemInstruction(state.cls.name) });
      chatHistory.push({ role: 'model', parts: [{ text: answer }] });
      pending.remove();
      thread.append(bubble('model', answer));
      thread.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      thread.querySelector('.study-thinking')?.remove();
      if (chatHistory.at(-1)?.role === 'user' && chatHistory.length > 2) chatHistory.pop();
      toastError(err);
    } finally { busy(send, false); }
  } }, input, h('div.ask-actions', reset, send));
  out.replaceChildren(h('p.muted.small', 'Les questions portent sur les cours sélectionnés dans la bibliothèque. Change la sélection puis « Nouvelle conversation » pour changer de sujet.'), thread, form, disclaimer());
}

const bubble = (role, text) => h(`div.ask-bubble.${role === 'user' ? 'me' : 'ai'}`, role === 'user' ? h('p', text) : renderMarkdown(text));
