// 💬 Messages privés entre élèves + 📞 appels. One conversation per pair of students, encrypted with a key only the two
// of them can derive (ECDH of their identity keys): delegates, teachers and the server can't read it. Each one can block
// the other, and report a problem to the delegates (quoting messages only if they choose to).
import {
  onSnapshot, query, where, orderBy, limitToLast, setDoc, updateDoc, addDoc, serverTimestamp, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { sub, plain } from './fb.js';
import { state, on, isTeacher, memberName } from './state.js';
import { peerKey, encryptJSON, decryptJSON } from './crypto.js';
import { notify } from './notify.js';
import { $, $$, h, icon, avatar, toast, toastError, fmtTime, fmtDay, linkify, modal } from './ui.js';
import { badWord, maskBad } from './modbot.js';
import { reportToDelegates, updateBadge } from './dm.js';
import { startCall, inCall } from './call.js';

let root;
let pairs = new Map();          // pid -> pair doc
let current = null;             // open conversation: the other student's id
let unsubList = null;
let unsubMsgs = null;
let firstList = true;
let lastRows = [];              // decrypted messages of the open conversation (for reports)
let search = '';
const keys = new Map();         // `${pid}|${public key}` -> AES key

export const pairId = (otherId) => [state.me.id, otherId].sort().join('_');
const pairRef = (otherId) => sub(state.cls.id, 'pairs', pairId(otherId));
const pmCol = (otherId) => sub(state.cls.id, 'pairs', pairId(otherId), 'pm');
const otherOf = (p) => p.members.find((x) => x !== state.me.id);
const aad = (pid, uid) => `pm|${state.cls.id}|${pid}|${uid}`;
const seenKey = (pid) => `cc-pm-seen-${state.cls?.id}-${pid}`;
const getSeen = (pid) => { try { return Number(localStorage.getItem(seenKey(pid)) || 0); } catch { return 0; } };
const setSeen = (pid, t) => { try { localStorage.setItem(seenKey(pid), String(t)); } catch { /* ignore */ } };
const canPM = () => !!state.me && !isTeacher() && state.me.status === 'active';
const classmates = () => [...state.members.values()]
  .filter((m) => m.status === 'active' && m.role !== 'teacher' && m.id !== state.me.id)
  .sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr'));

/** The key shared with that classmate (also used to encrypt the set-up of calls). */
export async function pairKeyFor(otherId) {
  const m = state.members.get(otherId);
  if (!m?.public_key) throw new Error(`${memberName(otherId)} n'a pas encore activé son compte chiffré`);
  const id = `${pairId(otherId)}|${m.public_key}`;
  if (!keys.has(id)) keys.set(id, await peerKey(state.privateKey, m.public_key, `pm|${state.cls.id}|${pairId(otherId)}`));
  return keys.get(id);
}
const blockedState = (otherId) => {
  const b = pairs.get(pairId(otherId))?.blocked || [];
  return b.includes(state.me.id) ? 'me' : b.length ? 'them' : null;
};

/** Creates the conversation if needed (calls need it too). Throws when it is blocked. */
export async function ensurePair(otherId) {
  const p = pairs.get(pairId(otherId));
  if (p) {
    if (p.blocked?.length) throw new Error('Cette conversation est bloquée');
    return p;
  }
  await setDoc(pairRef(otherId), {
    members: [state.me.id, otherId].sort(), last_at: serverTimestamp(), last_by: state.me.id, updated_at: serverTimestamp(), blocked: [],
  });
  const row = { id: pairId(otherId), members: [state.me.id, otherId].sort(), last_at: Date.now(), last_by: state.me.id, blocked: [] };
  pairs.set(row.id, row);
  return row;
}

async function post(otherId, payload) {
  await ensurePair(otherId);
  const key = await pairKeyFor(otherId);
  const enc = await encryptJSON(key, { v: 1, ...payload }, aad(pairId(otherId), state.me.id));
  await addDoc(pmCol(otherId), { user_id: state.me.id, iv: enc.iv, ciphertext: enc.ciphertext, created_at: serverTimestamp() });
  await updateDoc(pairRef(otherId), { last_at: serverTimestamp(), last_by: state.me.id, updated_at: serverTimestamp() });
}
/** Written by the caller when a call ends, so it shows in the conversation (« Appel vidéo · 3 min »). */
export const logCall = (otherId, info) => post(otherId, { call: info }).catch(() => {});

// ------------------------------------------------------------ lifecycle
export function initPM() {
  root = $('#panel-dm');
  $$('[data-dm-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.dmTab)));
  root.querySelector('.pm-search').addEventListener('input', (e) => { search = e.target.value.trim().toLowerCase(); renderList(); });
  on('panel', (name) => { if (name === 'dm') { renderList(); markSeen(); } });
  on('members', () => { renderList(); renderHead(); });
  on('profiles', renderList);
  document.addEventListener('visibilitychange', markSeen);
  bindComposer();
}

function showTab(tab) {
  if (!canPM()) tab = 'staff';
  $$('[data-dm-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.dmTab === tab)));
  $$('[data-dm-pane]').forEach((p) => { p.hidden = p.dataset.dmPane !== tab; });
  try { localStorage.setItem('cc-dm-tab', tab); } catch { /* ignore */ }
}

export function startPM() {
  stopPM();
  document.body.classList.toggle('can-pm', canPM());
  let tab = 'pm';
  try { tab = localStorage.getItem('cc-dm-tab') || 'pm'; } catch { /* ignore */ }
  showTab(tab);
  if (!canPM()) return;
  firstList = true;
  unsubList = onSnapshot(query(sub(state.cls.id, 'pairs'), where('members', 'array-contains', state.me.id)), (snap) => {
    const before = new Map(pairs);
    pairs = new Map(snap.docs.map((d) => [d.id, plain(d)]));
    for (const p of pairs.values()) {
      const prev = before.get(p.id);
      const other = otherOf(p);
      if (!firstList && p.last_by !== state.me.id && (!prev || prev.last_at !== p.last_at) && !(isOpen() && current === other)) {
        notify(`💬 ${memberName(other)}`, 'Nouveau message privé chiffré', `cc-pm-${p.id}`);
        toast(`💬 Nouveau message de ${memberName(other)}`);
      }
    }
    if (!snap.metadata.fromCache) firstList = false;
    renderList();
    renderHead();
    updateBadge();
  }, toastError);
  renderList();
}
export function stopPM() {
  unsubList?.(); unsubList = null;
  unsubMsgs?.(); unsubMsgs = null;
  pairs = new Map(); keys.clear(); current = null; lastRows = [];
  root?.querySelector('.pm-layout')?.classList.remove('open');
}

const isOpen = () => root?.classList.contains('active') && !document.hidden && !root.querySelector('.pm-layout').hidden;
function markSeen() {
  const p = current && pairs.get(pairId(current));
  if (p && isOpen()) setSeen(p.id, p.last_at || Date.now());
  updateBadge();
  renderTabBadges();
}
const unread = (p) => p.last_by !== state.me.id && (p.last_at || 0) > getSeen(p.id);
export const pmUnread = () => (state.cls && canPM() ? [...pairs.values()].filter(unread).length : 0);
function renderTabBadges() {
  $$('[data-badge="pm"]').forEach((b) => { b.textContent = pmUnread() || ''; });
}

// ------------------------------------------------------------ list of classmates
function callButtons(m, big = false) {
  const disabled = !m.public_key;
  const btn = (video) => h(`button.${big ? 'call-cta' : 'pm-call'}${video ? '.video' : ''}`, {
    type: 'button', disabled, title: disabled ? 'Compte pas encore activé' : `${video ? 'Appel vidéo' : 'Appel audio'} avec ${m.display_name}`,
    'aria-label': `${video ? 'Appel vidéo' : 'Appeler'} ${m.display_name}`,
    onclick: (e) => { e.stopPropagation(); call(m.id, video); },
  }, icon(video ? 'video' : 'phone'), big ? h('span', video ? 'Vidéo' : 'Appeler') : null);
  return [btn(false), btn(true)];
}

function call(otherId, video) {
  if (blockedState(otherId)) return toast('Cette conversation est bloquée', 'error');
  if (inCall()) return toast('Tu es déjà en appel');
  startCall(otherId, video);
}

function renderList() {
  if (!root || !state.cls) return;
  renderTabBadges();
  const list = root.querySelector('.pm-list');
  if (!canPM()) { list.replaceChildren(); return; }
  const match = (m) => !search || m.display_name.toLowerCase().includes(search) || (m.username || '').includes(search);
  const conv = [...pairs.values()].filter((p) => state.members.get(otherOf(p))?.status === 'active')
    .sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
  const withConv = new Set(conv.map(otherOf));
  const row = (m, p) => {
    const blocked = p && blockedState(m.id);
    return h(`div.pm-item${m.id === current ? '.active' : ''}${p && unread(p) ? '.unread' : ''}`,
      h('button.pm-open', { type: 'button', onclick: () => open(m.id) },
        avatar(m, 40),
        h('span.dm-item-body', h('b', m.display_name),
          h('small', blocked ? '⛔ Bloqué' : p?.last_at ? `${fmtDay(p.last_at)} · ${fmtTime(p.last_at)}` : `@${m.username}`)),
        p && unread(p) ? h('i.dm-dot', { 'aria-label': 'non lu' }) : null),
      blocked ? null : h('span.pm-calls', callButtons(m)));
  };
  const convRows = conv.map((p) => state.members.get(otherOf(p))).filter((m) => m && match(m)).map((m) => row(m, pairs.get(pairId(m.id))));
  const others = classmates().filter((m) => !withConv.has(m.id) && match(m)).map((m) => row(m, null));
  list.replaceChildren(...[
    convRows.length ? h('p.pm-section', 'Conversations') : null,
    ...convRows,
    others.length ? h('p.pm-section', 'Toute la classe') : null,
    ...others,
    !convRows.length && !others.length ? h('p.muted.small', search ? 'Personne ne correspond.' : 'Personne d\'autre dans la classe pour l\'instant.') : null,
  ].filter(Boolean));
}

// ------------------------------------------------------------ one conversation
function open(otherId) {
  current = otherId;
  lastRows = [];
  unsubMsgs?.();
  root.querySelector('.pm-layout').classList.add('open');
  root.querySelector('.pm-messages').replaceChildren();
  const pid = pairId(otherId);
  unsubMsgs = onSnapshot(query(pmCol(otherId), orderBy('created_at'), limitToLast(200)), async (snap) => {
    let key = null;
    try { key = await pairKeyFor(otherId); } catch { /* no key yet */ }
    const rows = await Promise.all(snap.docs.map(async (d) => {
      const r = plain(d);
      let body = null;
      if (key) {
        try { body = await decryptJSON(key, r.iv, r.ciphertext, aad(pid, r.user_id)); } catch { /* unreadable */ }
      }
      return { ...r, text: typeof body?.text === 'string' ? body.text.slice(0, 20000) : null, call: body?.call || null };
    }));
    if (current !== otherId) return;
    lastRows = rows;
    renderMessages(rows);
    markSeen();
  }, toastError);
  renderList();
  renderHead();
  markSeen();
  root.querySelector('.pm-composer textarea').focus({ preventScroll: true });
}

function renderHead() {
  if (!root) return;
  const head = root.querySelector('.pm-head');
  const composer = root.querySelector('.pm-composer');
  const m = current && state.members.get(current);
  if (!m) {
    head.replaceChildren();
    composer.hidden = true;
    root.querySelector('.pm-messages').replaceChildren(h('div.dm-empty.pm-welcome', h('span', '💬'),
      h('b', 'Discute en privé avec ta classe'),
      h('p', 'Choisis un camarade à gauche pour lui écrire, ou appuie sur 📞 / 🎥 pour l\'appeler directement.'),
      h('p.small', '🔒 Seuls vous deux pouvez lire ou entendre la conversation. En cas de problème : ⋯ → Signaler.')));
    return;
  }
  const blocked = blockedState(m.id);
  composer.hidden = !!blocked;
  head.replaceChildren(
    h('button.icon-btn.pm-back', { type: 'button', 'aria-label': 'Retour à la liste', onclick: close }, '←'),
    avatar(m, 42),
    h('div.pm-who', h('b', m.display_name), h('small.muted', blocked ? '⛔ Conversation bloquée' : '🔒 Chiffré de bout en bout · vous deux seulement')),
    blocked ? null : h('div.pm-head-calls', callButtons(m, true)),
    h('button.icon-btn.pm-more', { type: 'button', 'aria-label': 'Plus d\'options', title: 'Bloquer, signaler…', onclick: () => options(m) }, '⋯'),
  );
  const banner = root.querySelector('.pm-blocked');
  banner?.remove();
  if (blocked) {
    head.after(h('div.pm-blocked', blocked === 'me'
      ? [h('span', `Tu as bloqué ${m.display_name} : ni messages ni appels.`), h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => setBlock(m, false) }, 'Débloquer')]
      : h('span', 'Cette conversation n\'est plus disponible.')));
  }
}

function close() {
  current = null;
  unsubMsgs?.(); unsubMsgs = null;
  root.querySelector('.pm-layout').classList.remove('open');
  root.querySelector('.pm-blocked')?.remove();
  renderList();
  renderHead();
}

const fmtDuration = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : `${s} s`);
function callLine(r) {
  const c = r.call;
  const mine = r.user_id === state.me.id;
  const kind = c.video ? 'Appel vidéo' : 'Appel audio';
  const text = c.status === 'done' ? `${kind} · ${fmtDuration(Math.max(0, Math.round(c.seconds || 0)))}`
    : c.status === 'declined' ? `${kind} refusé`
      : mine ? `${kind} sans réponse` : `${kind} manqué`;
  return h(`div.pm-callog${c.status === 'done' ? '' : '.missed'}`,
    h('span', c.status === 'done' ? (c.video ? '🎥' : '📞') : '📵'), h('b', text), h('time', fmtTime(r.created_at)),
    blockedState(current) ? null : h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => call(current, !!c.video) }, 'Rappeler'));
}

function renderMessages(rows) {
  const box = root.querySelector('.pm-messages');
  if (!rows.length) {
    box.replaceChildren(h('div.dm-empty', h('span', '👋'), h('p', `Dis bonjour à ${memberName(current)} ! Ce que vous écrivez ici reste entre vous deux.`)));
    return;
  }
  let lastDay = '';
  box.replaceChildren(...rows.flatMap((r) => {
    const out = [];
    const day = fmtDay(r.created_at);
    if (day !== lastDay) { out.push(h('div.day-sep', h('span', day))); lastDay = day; }
    if (r.call) { out.push(callLine(r)); return out; }
    const mine = r.user_id === state.me.id;
    const author = state.members.get(r.user_id);
    out.push(h(`div.msg.dm-msg${mine ? '.mine' : ''}`,
      h('div.msg-avatar', avatar(author, 30)),
      h('div.msg-body',
        h('div.msg-head', h('b', { style: { color: author?.color } }, memberName(r.user_id)), h('time', fmtTime(r.created_at))),
        h('div.bubble', r.text == null ? h('span.locked-text', icon('lock'), ' Message illisible') : h('div.text', linkify(maskBad(r.text)))))));
    return out;
  }));
  box.scrollTop = box.scrollHeight;
}

function bindComposer() {
  const form = root.querySelector('.pm-composer');
  const input = form.querySelector('textarea');
  const submit = async () => {
    const text = input.value.trim();
    if (!text || !current) return;
    if (badWord(text)) return toast('🤖 Message bloqué par la modération automatique : langage vulgaire ou inapproprié. Reformule ton message.', 'error', 6000);
    input.value = '';
    try { await post(current, { text }); } catch (err) { input.value = text; toastError(err); }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
}

// ------------------------------------------------------------ block / report
async function setBlock(m, block) {
  try {
    if (block) await ensurePair(m.id).catch(() => {});
    await updateDoc(pairRef(m.id), { blocked: block ? arrayUnion(state.me.id) : arrayRemove(state.me.id), updated_at: serverTimestamp() });
    toast(block ? `${m.display_name} est bloqué·e : plus de messages ni d'appels` : `${m.display_name} est débloqué·e`, 'success');
  } catch (err) { toastError(err); }
}

function options(m) {
  const blocked = blockedState(m.id);
  const dlg = modal({
    title: m.display_name,
    body: h('div.pm-options',
      h('button.dm-item', { type: 'button', onclick: () => { dlg.close(); report(m); } },
        h('span.pm-opt-ico', '🛡️'), h('span.dm-item-body', h('b', 'Signaler aux délégués'), h('small', 'Harcèlement, contenu choquant, menace… Les délégués te répondront en privé.'))),
      blocked === 'them' ? null : h('button.dm-item', { type: 'button', onclick: () => { dlg.close(); setBlock(m, blocked !== 'me'); } },
        h('span.pm-opt-ico', blocked === 'me' ? '✅' : '⛔'),
        h('span.dm-item-body', h('b', blocked === 'me' ? 'Débloquer' : 'Bloquer'),
          h('small', blocked === 'me' ? 'Vous pourrez de nouveau vous écrire et vous appeler.' : 'Plus aucun message ni appel entre vous. Il ou elle n\'est pas prévenu·e.')))),
  });
}

function report(m) {
  const theirs = lastRows.filter((r) => r.user_id === m.id && r.text).slice(-5);
  const text = h('textarea', { rows: 4, maxlength: 2000, placeholder: 'Explique ce qui s\'est passé…' });
  const quote = h('input', { type: 'checkbox', checked: theirs.length > 0, disabled: !theirs.length });
  modal({
    title: `🛡️ Signaler ${m.display_name}`,
    body: h('div.form-stack',
      h('p.muted.small', 'Ton signalement part dans ta conversation privée avec les délégués (chiffrée). Ils pourront agir et te répondre.'),
      text,
      h('label.check', quote, h('span', theirs.length ? `Joindre ses ${theirs.length} derniers messages` : 'Aucun message de sa part à joindre'))),
    actions: [{ label: 'Annuler' }, {
      label: 'Envoyer aux délégués', variant: 'btn-primary', onClick: async () => {
        const lines = [`🛡️ Signalement : ${m.display_name} (@${m.username})`, text.value.trim() || '(sans commentaire)'];
        if (quote.checked) lines.push('— Ses derniers messages :', ...theirs.map((r) => `« ${r.text.slice(0, 300)} » (${fmtDay(r.created_at)} ${fmtTime(r.created_at)})`));
        await reportToDelegates(lines.join('\n'));
        toast('Signalement envoyé aux délégués 🛡️', 'success');
      },
    }],
  });
}
