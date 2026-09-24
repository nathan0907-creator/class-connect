// "Contacter les délégués": a private conversation between one student and the delegates, optionally with the
// head teachers ("profs principaux"). Each conversation has its own AES key, wrapped (ECDH) for its participants only:
// other students, other teachers and the server can't read it.
import {
  onSnapshot, query, where, orderBy, limitToLast, doc, getDoc, setDoc, updateDoc, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { sub, plain } from './fb.js';
import { state, on, emit, isDelegate, isPrincipal, isTeacher, memberName } from './state.js';
import { generateClassKey, wrapClassKey, unwrapClassKey, encryptJSON, decryptJSON } from './crypto.js';
import { notify } from './notify.js';
import { $, $$, h, icon, avatar, toast, toastError, fmtTime, fmtDay, linkify, modal } from './ui.js';

let root;
let threads = new Map();        // sid -> thread row
let current = null;             // open conversation (student id)
let unsubList = null;
let unsubMsgs = null;
const keys = new Map();         // sid -> AES key
let firstList = true;

const threadRef = (sid) => sub(state.cls.id, 'threads', sid);
const dmCol = (sid) => sub(state.cls.id, 'threads', sid, 'dm');
const info = (sid) => `dm:${sid}`;
const aad = (sid, uid) => `dm|${state.cls.id}|${sid}|${uid}`;
const seenKey = (sid) => `cc-dm-seen-${state.cls?.id}-${sid}`;
const getSeen = (sid) => { try { return Number(localStorage.getItem(seenKey(sid)) || 0); } catch { return 0; } };
const setSeen = (sid, t) => { try { localStorage.setItem(seenKey(sid), String(t)); } catch { /* ignore */ } };

const active = () => [...state.members.values()].filter((m) => m.status === 'active');
const delegates = () => active().filter((m) => m.role === 'delegate');
const principals = () => active().filter((m) => m.role === 'teacher' && m.principal);
/** Staff who see every conversation (delegates) or the ones they are invited to (head teachers). */
const isInbox = () => isDelegate() || isPrincipal();
const canUse = () => !isTeacher() || isPrincipal();

function participants(t) {
  const list = [state.members.get(t.student_id), ...delegates(), ...(t.include_principal ? principals() : [])];
  return [...new Map(list.filter((m) => m?.public_key).map((m) => [m.id, m])).values()];
}

async function wrapFor(key, sid, m) {
  const w = await wrapClassKey(key, state.privateKey, m.public_key, { classId: state.cls.id, epoch: info(sid), userId: m.id });
  return { from_public_key: state.me.public_key, to_public_key: m.public_key, iv: w.iv, wrapped: w.wrapped };
}
async function keyFor(t) {
  if (keys.has(t.student_id)) return keys.get(t.student_id);
  const share = t.keys?.[state.me.id];
  if (!share) return null;
  try {
    const key = await unwrapClassKey({ ...share, epoch: info(t.student_id) }, state.privateKey, { classId: state.cls.id, userId: state.me.id });
    keys.set(t.student_id, key);
    return key;
  } catch { return null; }
}
/** New delegates / invited head teachers receive the conversation key from whoever is online. */
async function shareMissing(t) {
  const key = await keyFor(t);
  if (!key) return;
  const missing = participants(t).filter((m) => t.keys?.[m.id]?.to_public_key !== m.public_key);
  if (!missing.length) return;
  const patch = { updated_at: serverTimestamp() };
  for (const m of missing) patch[`keys.${m.id}`] = await wrapFor(key, t.student_id, m);
  await updateDoc(threadRef(t.student_id), patch).catch(() => {});
}

// ------------------------------------------------------------ lifecycle
export function initDM() {
  root = $('#panel-dm');
  $$('[data-open-dm]').forEach((b) => b.addEventListener('click', () => emit('goto', 'dm')));
  on('panel', (name) => { if (name === 'dm') { if (!isInbox() && !current) openThread(state.me.id); render(); markSeen(); } });
  on('members', () => { render(); threads.forEach((t) => shareMissing(t)); });
  on('profiles', render);
}

export function startDM() {
  stopDM();
  document.body.classList.toggle('can-dm', canUse());
  if (!canUse()) return;
  // Students contact the delegates; delegates and head teachers receive the conversations.
  $$('[data-dm-label]').forEach((el) => { el.textContent = el.closest('.nav-item') ? 'Privé' : isInbox() ? '✉️ Messages privés' : '✉️ Contacter les délégués'; });
  $('[data-dm-title]').textContent = isInbox() ? 'Messages privés' : 'Contacter les délégués';
  firstList = true;
  const col = sub(state.cls.id, 'threads');
  const q = isDelegate() ? col : isPrincipal() ? query(col, where('include_principal', '==', true)) : null;
  const onRows = (rows, snap) => {
    const before = new Map(threads);
    threads = new Map(rows.map((r) => [r.student_id, r]));
    for (const t of threads.values()) {
      const prev = before.get(t.student_id);
      if (!firstList && t.last_by !== state.me.id && (!prev || prev.last_at !== t.last_at) && !(isOpen() && current === t.student_id)) {
        notify(`✉️ Message privé · ${memberName(t.last_by)}`, 'Nouveau message dans « Contacter les délégués »', `cc-dm-${t.student_id}`);
        toast(`✉️ Nouveau message privé de ${memberName(t.last_by)}`);
      }
      shareMissing(t);
    }
    if (!snap.metadata.fromCache) firstList = false;
    // The open conversation was just created (e.g. a delegate wrote first): start listening to it.
    if (current && threads.has(current) && !unsubMsgs) openThread(current);
    render();
  };
  if (q) unsubList = onSnapshot(q, (snap) => onRows(snap.docs.map(plain), snap), toastError);
  else unsubList = onSnapshot(threadRef(state.me.id), (d) => onRows(d.exists() ? [plain(d)] : [], d), () => {});
  // Students go straight to their own conversation; delegates and head teachers start from the list.
  if (!isInbox()) current = state.me.id;
}
export function stopDM() {
  unsubList?.(); unsubList = null;
  unsubMsgs?.(); unsubMsgs = null;
  threads = new Map(); keys.clear(); current = null;
  updateBadge();
}

const isOpen = () => root?.classList.contains('active') && !document.hidden;
function markSeen() {
  const t = threads.get(current);
  if (t && isOpen()) setSeen(current, t.last_at || Date.now());
  updateBadge();
}
const unreadCount = () => [...threads.values()].filter((t) => t.last_by !== state.me.id && (t.last_at || 0) > getSeen(t.student_id)).length;
function updateBadge() {
  const n = state.cls ? unreadCount() : 0;
  $$('[data-badge="dm"]').forEach((b) => { b.textContent = n || ''; });
  document.body.classList.toggle('dm-unread', n > 0);
}

// ------------------------------------------------------------ open a conversation
function openThread(sid) {
  current = sid;
  unsubMsgs?.();
  unsubMsgs = null;
  const box = root.querySelector('.dm-messages');
  if (box) box.replaceChildren();
  const t = threads.get(sid);
  if (!t) { render(); return; }
  unsubMsgs = onSnapshot(query(dmCol(sid), orderBy('created_at'), limitToLast(200)), async (snap) => {
    const key = await keyFor(threads.get(sid) || t);
    const rows = await Promise.all(snap.docs.map(async (d) => {
      const r = plain(d);
      let text = null;
      if (key) {
        try {
          const t = (await decryptJSON(key, r.iv, r.ciphertext, aad(sid, r.user_id)))?.text;
          if (typeof t === 'string') text = t.slice(0, 20000);
        } catch { /* unreadable */ }
      }
      return { ...r, text };
    }));
    renderMessages(rows);
    markSeen();
  }, toastError);
  render();
}

async function send(text) {
  const sid = current;
  let t = threads.get(sid);
  let key = t ? await keyFor(t) : null;
  if (!t) {
    // First message: create the conversation and its key.
    key = await generateClassKey();
    const draft = { student_id: sid, include_principal: false };
    const wraps = {};
    for (const m of participants(draft)) wraps[m.id] = await wrapFor(key, sid, m);
    if (!wraps[state.me.id]) wraps[state.me.id] = await wrapFor(key, sid, state.me);
    await setDoc(threadRef(sid), { ...draft, keys: wraps, last_at: serverTimestamp(), last_by: state.me.id, updated_at: serverTimestamp() });
    keys.set(sid, key);
    t = plain(await getDoc(threadRef(sid)));
    threads.set(sid, t);
    openThread(sid);
  }
  if (!key) throw new Error('Clé de la conversation pas encore reçue : un délégué doit se connecter pour te la transmettre.');
  const enc = await encryptJSON(key, { v: 1, text }, aad(sid, state.me.id));
  await addDoc(dmCol(sid), { user_id: state.me.id, iv: enc.iv, ciphertext: enc.ciphertext, created_at: serverTimestamp() });
  await updateDoc(threadRef(sid), { last_at: serverTimestamp(), last_by: state.me.id, updated_at: serverTimestamp() });
}

async function setPrincipal(on) {
  const t = threads.get(state.me.id);
  if (!t) return toast('Envoie d\'abord un message aux délégués');
  if (on && !principals().length) return toast('Aucun prof principal n\'a encore été désigné par les délégués', 'error');
  try {
    const patch = { include_principal: on, updated_at: serverTimestamp() };
    if (on) {
      const key = await keyFor(t);
      for (const m of principals()) patch[`keys.${m.id}`] = await wrapFor(key, t.student_id, m);
    }
    await updateDoc(threadRef(t.student_id), patch);
    toast(on ? 'Le prof principal a été ajouté à la conversation 🎓' : 'Le prof principal ne voit plus la conversation', 'success');
  } catch (err) { toastError(err); }
}

// ------------------------------------------------------------ rendering
function render() {
  if (!root || !state.cls) return;
  updateBadge();
  if (!canUse()) return;
  const inbox = root.querySelector('.dm-inbox');
  const view = root.querySelector('.dm-view');
  root.classList.toggle('is-inbox', isInbox());

  if (isInbox()) {
    const rows = [...threads.values()].sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
    inbox.replaceChildren(...[
      isDelegate() ? h('button.btn.btn-ghost.btn-sm.dm-new', { type: 'button', onclick: pickStudent }, icon('plus'), h('span', 'Écrire à un élève')) : null,
      ...rows.map((t) => {
        const m = state.members.get(t.student_id);
        const unread = t.last_by !== state.me.id && (t.last_at || 0) > getSeen(t.student_id);
        return h(`button.dm-item${t.student_id === current ? '.active' : ''}${unread ? '.unread' : ''}`, { type: 'button', onclick: () => openThread(t.student_id) },
          avatar(m, 36),
          h('span.dm-item-body',
            h('b', t.student_id === state.me.id ? 'Toi → délégués' : memberName(t.student_id)),
            h('small', t.last_at ? `${fmtDay(t.last_at)} · ${fmtTime(t.last_at)}` : '', t.include_principal ? ' · 🎓' : '')),
          unread ? h('i.dm-dot') : null);
      }),
      !rows.length ? h('p.muted.small', 'Aucune conversation pour l\'instant.') : null,
      isDelegate() && !threads.has(state.me.id) ? h('button.dm-item', { type: 'button', onclick: () => openThread(state.me.id) },
        avatar(state.me, 36), h('span.dm-item-body', h('b', 'Écrire à l\'autre délégué'), h('small', 'Ta conversation avec les délégués'))) : null,
    ].filter(Boolean));
  }

  // Conversation header + composer
  const t = threads.get(current);
  const who = current === state.me.id
    ? `Toi, ${delegates().filter((d) => d.id !== state.me.id).map((d) => d.display_name).join(' et ') || 'les délégués'}${t?.include_principal ? ' et le prof principal' : ''}`
    : `${memberName(current)}, les délégués${t?.include_principal ? ' et le prof principal' : ''}`;
  const head = view.querySelector('.dm-head');
  view.classList.toggle('open', !!current);
  if (!current) {
    head.replaceChildren(h('p.muted', 'Choisis une conversation.'));
    view.querySelector('.dm-composer').hidden = true;
    return;
  }
  view.querySelector('.dm-composer').hidden = false;
  head.replaceChildren(...[
    isInbox() ? h('button.icon-btn.dm-back', { type: 'button', 'aria-label': 'Retour à la liste', onclick: () => { current = null; unsubMsgs?.(); unsubMsgs = null; render(); } }, '←') : null,
    h('div', h('b', current === state.me.id ? 'Délégués' : memberName(current)), h('small.muted', `🔒 Visible uniquement par : ${who}`)),
    current === state.me.id && !isTeacher()
      ? h('label.dm-principal', h('input', { type: 'checkbox', checked: !!t?.include_principal, onchange: (e) => setPrincipal(e.target.checked) }), h('span', 'Inclure le prof principal'))
      : null,
  ].filter(Boolean));
  if (!t) view.querySelector('.dm-messages').replaceChildren(h('div.dm-empty', h('span', '✉️'),
    h('p', current === state.me.id
      ? 'Un souci, une question, une idée ? Écris ici : seuls les délégués le liront. Tu peux aussi inviter le prof principal.'
      : 'Écris le premier message : la conversation sera privée entre cet élève et les délégués.')));
}

function renderMessages(rows) {
  const box = root.querySelector('.dm-messages');
  let lastDay = '';
  box.replaceChildren(...rows.flatMap((r) => {
    const out = [];
    const day = fmtDay(r.created_at);
    if (day !== lastDay) { out.push(h('div.day-sep', h('span', day))); lastDay = day; }
    const mine = r.user_id === state.me.id;
    const author = state.members.get(r.user_id);
    out.push(h(`div.msg.dm-msg${mine ? '.mine' : ''}`,
      h('div.msg-avatar', avatar(author, 30)),
      h('div.msg-body',
        h('div.msg-head', h('b', { style: { color: author?.color } }, memberName(r.user_id)),
          author?.role === 'teacher' ? h('span.role-badge.teacher', '🎓') : author?.role === 'delegate' ? h('span.role-badge', '★') : null,
          h('time', fmtTime(r.created_at))),
        h('div.bubble', r.text == null ? h('span.locked-text', icon('lock'), ' Message illisible pour l\'instant') : h('div.text', linkify(r.text))))));
    return out;
  }));
  box.scrollTop = box.scrollHeight;
}

function pickStudent() {
  const list = active().filter((m) => m.role !== 'teacher' && m.id !== state.me.id)
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr'));
  const m = modal({
    title: 'Écrire à un élève',
    body: h('div.dm-pick', list.map((s) => h('button.dm-item', { type: 'button', onclick: () => { m.close(); openThread(s.id); } },
      avatar(s, 32), h('span.dm-item-body', h('b', s.display_name), h('small', '@' + s.username))))),
  });
}

export function bindDMComposer() {
  const form = $('#panel-dm .dm-composer');
  const input = form.querySelector('textarea');
  const submit = async () => {
    const text = input.value.trim();
    if (!text || !current) return;
    input.value = '';
    try { await send(text); } catch (err) { input.value = text; toastError(err); }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
}
