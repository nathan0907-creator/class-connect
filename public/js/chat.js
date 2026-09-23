import {
  query, orderBy, limit, startAfter, where, onSnapshot, getDocs, updateDoc, deleteDoc, doc,
  serverTimestamp, writeBatch, Timestamp, deleteField,
} from 'firebase/firestore';
import { openReport } from './moderation.js';
import { notify } from './notify.js';
import { recordVoice, voicePlayer, voiceSupported } from './voice.js';
import { statusEmoji, isBirthday, birthdaysToday } from './profiles.js';
import { db, sub, plain } from './fb.js';
import { state, on, isDelegate, isDeputy, isTeacher, memberName, CHANNELS, channelsFor } from './state.js';
import { encryptJSON, decryptJSON } from './crypto.js';
import { MAX_FILE, uploadEncrypted, downloadDecrypted, deleteFileChunks, compressImage } from './media.js';
import { currentKey } from './keyring.js';
import { sendTyping, watchTyping } from './presence.js';
import { GIPHY_API_KEY } from './config.js';
import { $, h, icon, avatar, toast, toastError, fmtTime, fmtDay, fmtSize, linkify, confirmDialog } from './ui.js';

const PAGE = 50;
const GROUP_MS = 5 * 60 * 1000;
const EMOJIS = ['😀','😂','🥹','😍','😎','🤔','😴','😭','😡','🤯','🥳','🤝','👍','👎','👏','🙏','💪','🔥','✨','🚀','🌌','🪐','⭐','🌙','☄️','👽','🛸','🌍','❤️','💜','💙','💯','✅','❌','⚠️','📚','📝','📅','⏰','🎉','🎮','⚽','🍕','☕','🎧','📸','🤫','👀'];
/** Quick reactions (same list as the security rules). */
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '🚀'];

let root, list, scroller, textarea, fileInput, pinnedBar;
let oldestSnap = null;
let unread = 0;
let unsubs = [];
const decrypted = new Map(); // message id -> payload | null
const mediaCache = new Map(); // file id -> object URL
const typingTimers = new Map();

let channel = 'messages';
let watchers = [];
const unreadChannels = new Set();
export const currentChannel = () => channel;

// The students' channel keeps the original format; other channels bind the channel name into the ciphertext.
const aadFor = (row) => {
  const ch = row.channel || channel;
  return ch === 'messages'
    ? `msg|${state.cls.id}|${row.epoch}|${row.user_id}`
    : `msg|${state.cls.id}|${ch}|${row.epoch}|${row.user_id}`;
};
const messagesCol = () => sub(state.cls.id, channel);
/** Who may pin / delete others' messages in a channel. */
const moderates = (ch = channel) => (ch === 'messages' ? isDelegate() || isDeputy()
  : ch === 'staff_messages' ? isTeacher() : isDelegate() || isDeputy() || isTeacher());

export function initChat() {
  root = $('#panel-chat');
  list = $('.messages', root);
  scroller = $('.chat-scroll', root);
  textarea = $('.composer textarea', root);
  fileInput = $('.composer input[type=file]', root);
  pinnedBar = $('.pinned-bar', root);

  $('.composer', root).addEventListener('submit', (e) => { e.preventDefault(); sendText(); });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendText(); }
  });
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
    sendTyping();
  });
  textarea.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); files.forEach(sendFile); }
  });

  root.addEventListener('click', (e) => {
    const tool = e.target.closest('[data-tool]')?.dataset.tool;
    if (tool === 'file') fileInput.click();
    if (tool === 'gif') togglePopover('.gif-pop');
    if (tool === 'emoji') togglePopover('.emoji-pop');
    if (tool === 'voice') recordVoice($('.composer', root), sendVoice);
    if (tool === 'gif-upload') { closePopovers(); fileInput.accept = 'image/gif'; fileInput.click(); fileInput.accept = 'image/*,video/*'; }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.popover, [data-tool]')) closePopovers();
  });
  fileInput.addEventListener('change', () => { [...fileInput.files].forEach(sendFile); fileInput.value = ''; });

  let dragDepth = 0;
  root.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; root.classList.add('dragging'); } });
  root.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; root.classList.remove('dragging'); } });
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    root.classList.remove('dragging');
    [...(e.dataTransfer?.files || [])].forEach(sendFile);
  });

  $('.load-more button', root).addEventListener('click', loadOlder);
  $('[data-tool="voice"]', root).hidden = !voiceSupported();
  bindLongPress();
  replyBar = h('div.reply-bar', { hidden: true });
  $('.composer', root).before(replyBar);
  textarea.addEventListener('input', saveDraft);
  textarea.addEventListener('keydown', (e) => { if (e.key === 'Escape' && replyTo) cancelReply(); });
  jumpBtn = h('button.jump-bottom', { type: 'button', hidden: true, 'aria-label': 'Revenir aux derniers messages', onclick: () => scrollToBottom(true) }, '↓', h('b'));
  $('.chat-scroll', root).after(jumpBtn);
  scroller.addEventListener('scroll', updateJump, { passive: true });
  // Double click (computer) = ❤️, like the double tap on a phone.
  list.addEventListener('dblclick', (e) => { const el = e.target.closest('.msg'); if (el?._row && !e.target.closest('a, button, video, img')) { window.getSelection()?.removeAllRanges(); doubleTapLove(el); } });
  buildEmojiPicker();
  buildGifPicker();

  on('typing', ({ id, channel: ch }) => { if (ch === channel) showTyping(id); });
  on('keys', redecryptFailed);
  on('members', refreshAuthors);
  on('profiles', () => { refreshAuthors(); renderBirthdays(); });
  on('panel', (name) => { if (name === 'chat') { setUnread(0); scrollToBottom(); } });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && root.classList.contains('active')) setUnread(0);
  });
}

// ------------------------------------------------------------ live data
/** Starts the class chat: the chosen channel is displayed, the others are watched for unread messages. */
export function startChat(requested) {
  const allowed = channelsFor();
  const next = allowed.includes(requested) ? requested : allowed.includes(channel) ? channel : allowed[0];
  stopWatchers();
  openChannel(next);
  for (const ch of allowed) {
    if (ch === next) continue;
    let first = true;
    watchers.push(onSnapshot(query(sub(state.cls.id, ch), orderBy('created_at', 'desc'), limit(1)), (snap) => {
      if (first) { first = false; return; }
      const added = snap.docChanges().some((c) => c.type === 'added' && c.doc.get('user_id') !== state.me.id && !c.doc.get('deleted_at'));
      if (added && ch !== channel) {
        unreadChannels.add(ch); renderChannelTabs(); setUnread(unread + 1);
        const from = snap.docs[0]?.get('user_id');
        notify(`Class Connect · ${CHANNELS[ch].label}`, `Nouveau message de ${memberName(from)}`, `cc-${ch}`);
      }
    }, () => {}));
  }
}

function stopWatchers() { watchers.forEach((u) => u()); watchers = []; }

function openChannel(ch) {
  stopChat();
  channel = ch;
  unreadChannels.delete(ch);
  renderChannelTabs();
  $('[data-channel-title]').textContent = CHANNELS[ch].title;
  $('[data-channel-hint]').textContent = CHANNELS[ch].hint;
  textarea.placeholder = `Message chiffré — ${CHANNELS[ch].label}…`;
  typingTimers.forEach((t) => clearTimeout(t));
  typingTimers.clear();
  renderTyping();
  watchTyping(ch);
  list.replaceChildren();
  decrypted.clear();
  cancelReply();
  restoreDraft();
  newBelow = 0;
  oldestSnap = null;
  let first = true;

  unsubs.push(onSnapshot(query(messagesCol(), orderBy('created_at', 'desc'), limit(PAGE)), (snap) => {
    if (first) {
      first = false;
      const docs = [...snap.docs].reverse();
      docs.forEach((d) => appendMessage(plain(d)));
      oldestSnap = snap.docs[snap.docs.length - 1] || null;
      $('.load-more', root).hidden = snap.size < PAGE;
      scrollToBottom();
      return;
    }
    const minTs = Math.min(...snap.docs.map((d) => plain(d).created_at));
    for (const ch of snap.docChanges()) {
      const row = plain(ch.doc);
      if (ch.type === 'added') onIncoming(row);
      else if (ch.type === 'modified') onModified(row);
      // A doc leaving a full window because newer ones arrived is not a deletion.
      else if (ch.type === 'removed' && (snap.size < PAGE || row.created_at >= minTs)) onRemoved(row.id);
    }
  }, (err) => toastError(err)));

  unsubs.push(onSnapshot(query(messagesCol(), where('pinned', '==', true), limit(20)), (snap) => renderPinned(snap.docs.map(plain))));
}

export function stopChat() {
  unsubs.forEach((u) => u());
  unsubs = [];
}
export function stopAllChat() { stopChat(); stopWatchers(); }

function renderChannelTabs() {
  const tabs = $('.channel-tabs', root);
  tabs.replaceChildren(...channelsFor().map((ch) => h(`button.channel-tab${ch === channel ? '.active' : ''}${unreadChannels.has(ch) ? '.unread' : ''}`, {
    type: 'button', role: 'tab', 'aria-selected': String(ch === channel),
    onclick: () => { if (ch !== channel) startChat(ch); },
  }, CHANNELS[ch].label)));
}

function onIncoming(row) {
  const atBottom = nearBottom();
  appendMessage(row);
  if (row.user_id !== state.me.id) {
    state.space.pulse();
    if (document.hidden || !root.classList.contains('active')) setUnread(unread + 1);
    if (document.hidden) {
      // Decrypted locally: the notification never goes through a server.
      decryptRow(row).then((p) => notify(`${memberName(row.user_id)} · ${CHANNELS[channel].label}`,
        !p ? 'Nouveau message chiffré' : p.text ? p.text.slice(0, 120) : p.t === 'audio' ? '🎤 Message vocal' : p.t === 'video' ? '🎬 Vidéo' : p.t === 'gif' ? 'GIF' : '🖼️ Image', `cc-${channel}`));
    }
  }
  if (atBottom || row.user_id === state.me.id) scrollToBottom(true);
  else if (row.user_id !== state.me.id) { newBelow++; updateJump(); }
  decryptRow(row).then((p) => { if (isParty(p)) { const el = list.querySelector(`[data-id="${row.id}"] .bubble`); if (el) setTimeout(() => confetti(el), 250); } });
}

// ------------------------------------------------------------ "back to the latest messages" button
let jumpBtn;
let newBelow = 0;
function updateJump() {
  if (!jumpBtn) return;
  const away = !nearBottom();
  if (!away) newBelow = 0;
  jumpBtn.hidden = !away;
  jumpBtn.querySelector('b').textContent = newBelow ? (newBelow > 99 ? '99+' : newBelow) : '';
}

function onModified(row) {
  if (row.deleted_at) return onRemoved(row.id);
  const el = list.querySelector(`[data-id="${row.id}"]`);
  if (!el) return;
  el.classList.toggle('pinned', !!row.pinned);
  el._row.pinned = row.pinned;
  el._row.reactions = row.reactions;
  renderReactions(el);
  if (row.created_at && Number(el.dataset.ts) !== row.created_at) {
    el.dataset.ts = row.created_at;
    el.querySelector('.msg-head time').textContent = fmtTime(row.created_at);
  }
}

function onRemoved(id) {
  const el = list.querySelector(`[data-id="${id}"]`);
  if (el) { el.classList.add('removing'); setTimeout(() => { el.remove(); regroup(); }, 350); }
}

async function loadOlder() {
  if (!oldestSnap) return;
  const snap = await getDocs(query(messagesCol(), orderBy('created_at', 'desc'), startAfter(oldestSnap), limit(PAGE)));
  const prevHeight = scroller.scrollHeight;
  const frag = document.createDocumentFragment();
  [...snap.docs].reverse().map(plain).filter((r) => !r.deleted_at).forEach((r) => frag.append(messageEl(r)));
  list.prepend(frag);
  regroup();
  scroller.scrollTop += scroller.scrollHeight - prevHeight;
  oldestSnap = snap.docs[snap.docs.length - 1] || oldestSnap;
  $('.load-more', root).hidden = snap.size < PAGE;
}

// ------------------------------------------------------------ rendering
function appendMessage(row) {
  if (row.deleted_at || list.querySelector(`[data-id="${row.id}"]`)) return;
  list.append(messageEl(row));
  regroup(list.lastElementChild);
}

const roleTag = (author) => (author?.role === 'teacher' ? h('span.role-badge.teacher', author.principal ? '🎓 prof principal' : '🎓 prof')
  : author?.role === 'delegate' ? h('span.role-badge', '★ délégué')
  : author?.role === 'deputy' ? h('span.role-badge.deputy', '☆ suppléant') : null);

function messageEl(row) {
  row.channel ||= channel;
  const author = state.members.get(row.user_id);
  const mine = row.user_id === state.me.id;
  const el = h(`div.msg${mine ? '.mine' : ''}${row.pinned ? '.pinned' : ''}`, {
    dataset: { id: row.id, user: row.user_id, ts: row.created_at },
  },
  h('div.msg-avatar', avatar(author, 36)),
  h('div.msg-body',
    h('div.msg-head',
      h('b', { style: { color: author?.color } }, memberName(row.user_id)),
      h('span.head-extra', headExtra(row.user_id)),
      roleTag(author),
      h('time', fmtTime(row.created_at))),
    h('div.bubble', h('span.decrypting', icon('lock'), ' déchiffrement…')),
    h('div.reactions')),
  h('div.msg-actions', actionButtons(row)));
  el._row = row;
  fillBubble(el, row);
  renderReactions(el);
  return el;
}

// ------------------------------------------------------------ reactions
function renderReactions(el) {
  const all = el._row.reactions || {};
  const counts = new Map();
  for (const [uid, e] of Object.entries(all)) {
    if (!REACTIONS.includes(e)) continue;
    if (!counts.has(e)) counts.set(e, []);
    counts.get(e).push(uid);
  }
  const mine = all[state.me.id];
  el.querySelector('.reactions').replaceChildren(...REACTIONS.filter((e) => counts.has(e)).map((e) => {
    const who = counts.get(e);
    return h(`button.reaction${e === mine ? '.mine' : ''}`, {
      type: 'button', title: who.map(memberName).join(', '),
      'aria-label': `${e} ${who.length} — ${e === mine ? 'retirer ma réaction' : 'réagir'}`,
      onclick: () => react(el._row, e),
    }, e, h('b', who.length));
  }));
}

/** Toggles my reaction (one per message; choosing another one replaces it). */
function react(row, emoji) {
  const mine = row.reactions?.[state.me.id];
  updateDoc(doc(messagesCol(), row.id), { [`reactions.${state.me.id}`]: mine === emoji ? deleteField() : emoji }).catch(toastError);
}

function openReactionPicker(btn, row) {
  document.querySelector('.reaction-pop')?.remove();
  const pop = h('div.reaction-pop', { role: 'menu' }, REACTIONS.map((e) => h('button', {
    type: 'button', role: 'menuitem', 'aria-label': `Réagir ${e}`, onclick: () => { pop.remove(); react(row, e); },
  }, e)));
  btn.closest('.msg').append(pop);
  const off = (e) => { if (!pop.contains(e.target) && e.target !== btn) { pop.remove(); document.removeEventListener('pointerdown', off); } };
  setTimeout(() => document.addEventListener('pointerdown', off));
}

/** Status emoji + 🎂 on birthdays, next to the author's name. */
const headExtra = (uid) => [statusEmoji(uid), isBirthday(uid) ? '🎂' : ''].filter(Boolean).join(' ');

// ------------------------------------------------------------ birthdays: banner + confetti (once a day per device)
function renderBirthdays() {
  const people = birthdaysToday();
  let banner = root.querySelector('.bday-banner');
  if (!people.length) { banner?.remove(); return; }
  const names = people.map((m) => (m.id === state.me.id ? 'toi' : m.display_name));
  const text = people.length === 1 && people[0].id === state.me.id
    ? 'Joyeux anniversaire ! Toute la classe te souhaite une super journée 🥳'
    : `C'est l'anniversaire de ${names.join(', ').replace(/, ([^,]*)$/, ' et $1')} aujourd'hui ! Souhaite-${people.length > 1 ? 'leur' : 'lui'} 🎉`;
  if (!banner) {
    banner = h('div.bday-banner', { role: 'status' });
    root.querySelector('.channel-tabs').after(banner);
  }
  banner.replaceChildren(h('span.bday-cake', '🎂'), h('span', text),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Fermer', onclick: () => banner.remove() }, '✕'));
  const key = `cc-bday-${new Date().toDateString()}-${people.map((m) => m.id).join(',')}`;
  let seen = false;
  try { seen = localStorage.getItem(key) === '1'; localStorage.setItem(key, '1'); } catch { /* ignore */ }
  if (!seen && root.classList.contains('active')) {
    setTimeout(() => { confetti(banner); setTimeout(() => confetti(banner), 350); }, 400);
  }
}

function refreshAuthors() {
  for (const el of list.querySelectorAll('.msg')) {
    const author = state.members.get(el.dataset.user);
    if (!author) continue;
    const b = el.querySelector('.msg-head b');
    b.textContent = author.display_name;
    b.style.color = author.color;
    const extra = el.querySelector('.head-extra');
    if (extra) extra.textContent = headExtra(el.dataset.user);
    el.querySelector('.msg-avatar')?.replaceChildren(avatar(author, 36));
  }
}

/** What can be done with a message (shared by the hover buttons and the phone long-press sheet). */
function messageActions(row) {
  const out = [{ icon: 'reply', label: 'Répondre', run: () => startReply(row) }];
  const text = decrypted.get(row.id)?.text;
  if (text) {
    out.push({ icon: 'edit', label: 'Copier le texte', run: () => navigator.clipboard.writeText(text).then(() => toast('Texte copié 📋'), () => toast('Copie impossible', 'error')), sheetOnly: true });
  }
  if (moderates(row.channel)) {
    out.push({ icon: 'pin', label: row.pinned ? 'Désépingler' : 'Épingler', title: 'Épingler / désépingler',
      run: () => updateDoc(doc(messagesCol(), row.id), { pinned: !row.pinned }).catch(toastError) });
  }
  if (row.user_id !== state.me.id) {
    out.push({ icon: 'flag', label: 'Signaler', title: 'Signaler ce message', run: () => openReport(row) });
  }
  if (row.user_id === state.me.id || moderates(row.channel)) {
    out.push({ icon: 'trash', label: 'Supprimer', danger: true, run: async () => {
      if (!(await confirmDialog('Supprimer le message ?', 'Il disparaîtra pour tout le canal. Par sécurité (harcèlement), il reste conservé chiffré 30 jours et peut être joint à un signalement.'))) return;
      try {
        await updateDoc(doc(messagesCol(), row.id), { deleted_at: serverTimestamp(), deleted_by: state.me.id, pinned: false });
        onRemoved(row.id);
      } catch (err) { toastError(err); }
    } });
  }
  return out;
}

function actionButtons(row) {
  return [
    h('button.icon-btn', { title: 'Réagir', 'aria-label': 'Réagir', onclick: (e) => openReactionPicker(e.currentTarget, row) }, icon('smile')),
    ...messageActions(row).filter((a) => !a.sheetOnly).map((a) => h('button.icon-btn', {
      title: a.title || a.label, 'aria-label': a.title || a.label, onclick: a.run,
    }, icon(a.icon))),
  ];
}

// ------------------------------------------------------------ phone: long press → options sheet
const isTouch = () => matchMedia('(hover: none) and (pointer: coarse)').matches;

function openMessageSheet(el) {
  const row = el._row;
  closeMessageSheet();
  navigator.vibrate?.(12);
  el.classList.add('held');
  const close = () => closeMessageSheet();
  const mine = row.reactions?.[state.me.id];
  const sheet = h('div.msg-sheet', { role: 'dialog', 'aria-label': 'Options du message' },
    h('div.sheet-grip'),
    h('div.sheet-reactions', REACTIONS.map((e) => h(`button${e === mine ? '.mine' : ''}`, {
      type: 'button', 'aria-label': `Réagir ${e}`, onclick: () => { close(); react(row, e); },
    }, e))),
    h('div.sheet-actions', messageActions(row).map((a) => h(`button.sheet-action${a.danger ? '.danger' : ''}`, {
      type: 'button', onclick: () => { close(); a.run(); },
    }, icon(a.icon), h('span', a.label)))),
    h('button.sheet-cancel', { type: 'button', onclick: close }, 'Annuler'));
  const backdrop = h('div.sheet-backdrop', { onclick: (e) => { if (e.target === backdrop) close(); } }, sheet);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));
  history.pushState({ ccSheet: true }, '');
}
function closeMessageSheet(fromHistory = false) {
  const backdrop = document.querySelector('.sheet-backdrop');
  document.querySelectorAll('.msg.held').forEach((m) => m.classList.remove('held'));
  if (!backdrop) return;
  backdrop.classList.remove('open');
  setTimeout(() => backdrop.remove(), 250);
  if (!fromHistory && history.state?.ccSheet) history.back();
}
// The phone's back button closes the sheet instead of leaving the app.
window.addEventListener('popstate', () => closeMessageSheet(true));

/**
 * Phone gestures on messages, like in messaging apps:
 *  - long press (≈ 0.45 s without moving) → options sheet
 *  - swipe right → reply
 *  - double tap → ❤️
 */
function bindLongPress() {
  let timer = null;
  let start = null;
  let el = null;
  let swiping = false;
  let held = false;
  let lastTap = { id: null, t: 0 };
  const SWIPE = 64;
  const bodyOf = (m) => m?.querySelector('.msg-body');
  const resetSwipe = (m) => {
    const b = bodyOf(m);
    if (b) { b.style.transition = 'transform .25s var(--spring)'; b.style.transform = ''; setTimeout(() => { b.style.transition = ''; }, 260); }
    m?.classList.remove('swipe-ready');
    swiping = false;
  };
  const cancelTimer = () => { clearTimeout(timer); timer = null; };

  list.addEventListener('pointerdown', (e) => {
    held = false;
    if (e.pointerType === 'mouse' || !isTouch()) return;
    const m = e.target.closest('.msg');
    if (!m?._row || m.classList.contains('pending') || e.target.closest('a, button, video')) { el = null; return; }
    el = m;
    start = { x: e.clientX, y: e.clientY, t: Date.now() };
    swiping = false;
    timer = setTimeout(() => { timer = null; held = true; openMessageSheet(m); }, 450);
  }, true);

  list.addEventListener('pointermove', (e) => {
    if (!el || !start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > 10) cancelTimer();
    if (!swiping && dx > 14 && Math.abs(dy) < dx * 0.6) swiping = true;
    if (swiping) {
      bodyOf(el).style.transform = `translateX(${Math.max(0, Math.min(dx, SWIPE + 24))}px)`;
      const ready = dx >= SWIPE;
      if (ready && !el.classList.contains('swipe-ready')) navigator.vibrate?.(8);
      el.classList.toggle('swipe-ready', ready);
    }
  });

  const end = (e) => {
    cancelTimer();
    if (!el || !start) return;
    const m = el;
    if (swiping) {
      if (e.type === 'pointerup' && e.clientX - start.x >= SWIPE) startReply(m._row);
      resetSwipe(m);
    } else if (e.type === 'pointerup' && !held && Date.now() - start.t < 250 && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 10) {
      // Two quick taps on the same message = ❤️
      const now = Date.now();
      if (lastTap.id === m._row.id && now - lastTap.t < 320) { lastTap = { id: null, t: 0 }; doubleTapLove(m); }
      else lastTap = { id: m._row.id, t: now };
    }
    el = null;
    start = null;
  };
  ['pointerup', 'pointercancel'].forEach((t) => list.addEventListener(t, end));

  // The finger lifting after a long press must not also "click" (e.g. open the photo viewer).
  list.addEventListener('click', (e) => { if (held) { held = false; e.preventDefault(); e.stopPropagation(); } }, true);
  // Android fires "contextmenu" on long press: keep our sheet instead of the browser menu.
  list.addEventListener('contextmenu', (e) => { if (isTouch() && e.target.closest('.msg')) e.preventDefault(); });
}

/** Moderators' clients permanently erase messages (and their media) deleted more than 30 days ago. */
export async function purgeExpired() {
  const cutoff = Timestamp.fromMillis(Date.now() - 30 * 864e5);
  for (const ch of channelsFor().filter((c) => moderates(c))) {
    const old = await getDocs(query(sub(state.cls.id, ch), where('deleted_at', '<', cutoff), limit(100))).catch(() => null);
    for (const d of old?.docs || []) {
      const row = { ...plain(d), channel: ch };
      const payload = await decryptRow(row);
      if (payload?.file?.id) await deleteFileChunks(payload.file);
      await deleteDoc(d.ref).catch(() => {});
    }
  }
}

export const decryptMessage = (row) => decryptRow(row);

async function decryptRow(row) {
  if (decrypted.get(row.id)) return decrypted.get(row.id);
  const key = state.classKeys.get(row.epoch);
  if (!key) { decrypted.set(row.id, null); return null; }
  try {
    const payload = await decryptJSON(key, row.iv, row.ciphertext, aadFor(row));
    decrypted.set(row.id, payload);
    return payload;
  } catch {
    decrypted.set(row.id, null);
    return null;
  }
}

async function fillBubble(el, row) {
  const payload = await decryptRow(row);
  const bubble = el.querySelector('.bubble');
  if (!payload) {
    el.classList.add('locked');
    bubble.replaceChildren(h('span.locked-text', icon('lock'),
      state.classKeys.has(row.epoch) ? ' Message illisible (intégrité non vérifiée)' : ' Chiffré avec une clé que tu ne possèdes pas (encore)'));
    return;
  }
  el.classList.remove('locked');
  const parts = [];
  if (payload.t === 'gif' && payload.gif?.url && /^https:\/\/[a-z0-9]+\.giphy\.com\//.test(payload.gif.url)) {
    parts.push(h('div.media.gif', { style: ratio(payload.gif) },
      h('img', { src: payload.gif.url, alt: payload.gif.title || 'GIF', loading: 'lazy' }), h('span.media-tag', 'GIF')));
  } else if (payload.t === 'audio' && payload.file) {
    parts.push(voicePlayer(payload.file, row.epoch));
  } else if ((payload.t === 'image' || payload.t === 'video') && payload.file) {
    parts.push(mediaEl(payload, row.epoch));
  }
  if (payload.text) parts.push(h('div.text', linkify(payload.text)));
  if (isOnlyEmoji(payload.text) && parts.length === 1) bubble.classList.add('jumbo');
  // Quoted message (reply): tap to jump to the original.
  if (payload.reply?.id) {
    parts.unshift(h('button.reply-quote', { type: 'button', onclick: () => jumpTo(payload.reply.id) },
      h('b', memberName(payload.reply.user_id)), h('span', String(payload.reply.text || '…').slice(0, 140))));
  }
  bubble.classList.toggle('has-media', payload.t !== 'text');
  bubble.replaceChildren(...parts);
  // @pseudo mentions of me are highlighted.
  const me = state.me;
  el.classList.toggle('mentions-me', row.user_id !== me.id && !!payload.text
    && new RegExp(`@(${escapeRe(me.username)}|${escapeRe(me.display_name)})\\b`, 'i').test(payload.text));
}
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------ replies
let replyTo = null;
let replyBar;
function startReply(row) {
  const p = decrypted.get(row.id);
  const preview = !p ? 'message chiffré' : p.text || (p.t === 'audio' ? '🎤 Message vocal' : p.t === 'video' ? '🎬 Vidéo' : p.t === 'gif' ? 'GIF' : '🖼️ Photo');
  replyTo = { id: row.id, user_id: row.user_id, text: preview.slice(0, 120) };
  replyBar.replaceChildren(icon('reply'),
    h('div', h('b', `Réponse à ${memberName(row.user_id)}`), h('span', replyTo.text)),
    h('button.icon-btn', { type: 'button', title: 'Annuler la réponse', 'aria-label': 'Annuler la réponse', onclick: cancelReply }, '✕'));
  replyBar.hidden = false;
  root.classList.add('replying');
  textarea.focus();
}
function cancelReply() { replyTo = null; if (replyBar) replyBar.hidden = true; root?.classList.remove('replying'); }

// ------------------------------------------------------------ drafts (kept per channel on this device)
const draftKey = () => `cc-draft-${state.cls?.id}-${channel}`;
const saveDraft = () => { try { if (textarea.value.trim()) localStorage.setItem(draftKey(), textarea.value); else localStorage.removeItem(draftKey()); } catch { /* ignore */ } };
function restoreDraft() {
  let v = '';
  try { v = localStorage.getItem(draftKey()) || ''; } catch { /* ignore */ }
  textarea.value = v;
  textarea.style.height = 'auto';
  if (v) textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
}

// ------------------------------------------------------------ fun details
/** Confetti burst from an element (🎉 messages). */
function confetti(from) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = from.getBoundingClientRect();
  const colors = ['#7c5cff', '#00d4ff', '#ff4fd8', '#ffcf6b', '#3dffa8'];
  const box = h('div.confetti', { style: { left: r.left + r.width / 2 + 'px', top: r.top + r.height / 2 + 'px' } });
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 60 + Math.random() * 110;
    box.append(h('i', { style: {
      background: colors[i % colors.length], '--x': Math.cos(a) * d + 'px', '--y': Math.sin(a) * d - 40 + 'px',
      '--r': Math.random() * 720 - 360 + 'deg', animationDelay: Math.random() * 80 + 'ms',
    } }));
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 1400);
}
const isParty = (p) => !!p?.text && /🎉|🥳/.test(p.text) && p.text.length <= 40;

/** Heart burst on double tap. */
function heartBurst(el) {
  const b = el.querySelector('.bubble');
  if (!b) return;
  const heart = h('span.heart-burst', '❤️');
  b.append(heart);
  setTimeout(() => heart.remove(), 900);
}
function doubleTapLove(el) {
  const row = el._row;
  heartBurst(el);
  navigator.vibrate?.(8);
  // Like Instagram: a double tap only ever adds the heart (use the reaction chip to remove it).
  if (row.reactions?.[state.me.id] !== '❤️') react(row, '❤️');
}

function redecryptFailed() {
  for (const el of list.querySelectorAll('.msg.locked')) {
    decrypted.delete(el._row.id);
    fillBubble(el, el._row);
  }
}

const ratio = ({ w, h: hh }) => (w && hh ? { aspectRatio: `${w} / ${hh}`, width: Math.min(320, w) + 'px' } : {});

const mediaObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    mediaObserver.unobserve(e.target);
    e.target._load?.();
  }
}, { rootMargin: '300px' });

function mediaEl({ t, file }, epoch) {
  const box = h(`div.media.loading${t === 'video' ? '.video' : ''}`, { style: ratio(file) },
    h('div.media-lock', icon('lock'), h('small', `${t === 'video' ? 'Vidéo' : 'Image'} chiffrée · ${fmtSize(file.size || 0)}`)));
  box._load = async () => {
    try {
      let url = mediaCache.get(file.id);
      if (!url) {
        const plainBytes = await downloadDecrypted(file, state.classKeys.get(epoch));
        url = URL.createObjectURL(new Blob([plainBytes], { type: file.mime }));
        mediaCache.set(file.id, url);
      }
      const media = t === 'video'
        ? h('video', { src: url, controls: true, playsInline: true, preload: 'metadata' })
        : h('img', { src: url, alt: file.name || 'image', onclick: () => openLightbox(url) });
      box.classList.remove('loading');
      box.replaceChildren(media);
      if (file.mime === 'image/gif') box.append(h('span.media-tag', 'GIF'));
    } catch (err) {
      console.warn(err);
      box.classList.remove('loading');
      box.classList.add('error');
      box.replaceChildren(h('div.media-lock', icon('lock'), h('small', 'Média indisponible')));
    }
  };
  mediaObserver.observe(box);
  return box;
}

function openLightbox(url) {
  const lb = $('.lightbox');
  lb.querySelector('img').src = url;
  lb.hidden = false;
  requestAnimationFrame(() => lb.classList.add('open'));
  const close = () => { lb.classList.remove('open'); setTimeout(() => { lb.hidden = true; }, 250); };
  lb.onclick = close;
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
}

/** Adds date separators and collapses consecutive messages from the same author. */
function regroup(only) {
  const items = only ? [only] : [...list.children];
  for (const el of items) {
    if (!el.classList.contains('msg')) continue;
    let prev = el.previousElementSibling;
    while (prev && !prev.classList.contains('msg')) prev = prev.previousElementSibling;
    const ts = Number(el.dataset.ts);
    const sameDay = prev && new Date(Number(prev.dataset.ts)).toDateString() === new Date(ts).toDateString();
    const cont = prev && sameDay && prev.dataset.user === el.dataset.user && ts - Number(prev.dataset.ts) < GROUP_MS;
    el.classList.toggle('cont', !!cont);
    const sep = el.previousElementSibling?.classList.contains('day-sep') ? el.previousElementSibling : null;
    if (!sameDay && !sep) el.before(h('div.day-sep', h('span', fmtDay(ts))));
    if (sameDay && sep) sep.remove();
  }
}

// ------------------------------------------------------------ pinned
async function renderPinned(rows) {
  rows = rows.filter((r) => !r.deleted_at);
  if (!rows.length) { pinnedBar.hidden = true; return; }
  rows.sort((a, b) => b.created_at - a.created_at);
  const items = await Promise.all(rows.map(async (r) => {
    const p = await decryptRow(r);
    const preview = !p ? '🔒 message chiffré' : p.text || (p.t === 'audio' ? '🎤 Message vocal' : p.t === 'video' ? '🎬 Vidéo' : p.t === 'gif' ? 'GIF' : '🖼️ Image');
    return h('button.pinned-item', { onclick: () => jumpTo(r.id) },
      icon('pin'), h('b', memberName(r.user_id)), h('span', preview.slice(0, 140)));
  }));
  pinnedBar.replaceChildren(h('div.pinned-label', 'Épinglé'), ...items);
  pinnedBar.hidden = false;
}

function jumpTo(id) {
  const el = list.querySelector(`[data-id="${id}"]`);
  if (!el) return toast('Message trop ancien : charge plus d\'historique');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

// ------------------------------------------------------------ sending
async function postPayload(payload) {
  const key = currentKey();
  if (!key) throw new Error('Clé de la classe pas encore reçue. Attends qu\'un membre en ligne te la transmette.');
  const epoch = state.cls.key_epoch;
  const ref = doc(messagesCol());
  const enc = await encryptJSON(key, payload, aadFor({ epoch, user_id: state.me.id, channel }));
  decrypted.set(ref.id, payload);
  // The rate document lets the security rules enforce one message per second (anti-spam).
  const batch = writeBatch(db);
  batch.set(ref, { user_id: state.me.id, epoch, iv: enc.iv, ciphertext: enc.ciphertext, pinned: false, created_at: serverTimestamp() });
  batch.set(sub(state.cls.id, 'rate', state.me.id), { last: serverTimestamp() });
  try {
    await batch.commit();
  } catch (err) {
    if (err.code === 'permission-denied') throw new Error('Doucement ! Un message par seconde maximum.');
    throw err;
  }
}

async function sendText() {
  const text = textarea.value.trim();
  if (!text) return;
  const reply = replyTo;
  textarea.value = '';
  textarea.style.height = 'auto';
  cancelReply();
  saveDraft();
  try {
    await postPayload({ v: 1, t: 'text', text, ...(reply ? { reply } : {}) });
  } catch (err) {
    textarea.value = text;
    if (reply) { replyTo = reply; replyBar.hidden = false; root.classList.add('replying'); }
    saveDraft();
    toastError(err);
  }
}

/** Voice message: encrypted and uploaded like a photo, then posted (as a reply if one is being written). */
async function sendVoice(blob, seconds) {
  const key = currentKey();
  if (!key) return toast('Clé de la classe pas encore reçue', 'error');
  if (!navigator.onLine) return toast('Hors ligne : réessaie une fois le réseau revenu', 'error');
  const reply = replyTo;
  cancelReply();
  const pending = h('div.msg.mine.pending', h('div.msg-avatar'), h('div.msg-body',
    h('div.bubble', h('div.upload', h('div.spinner'), h('div.upload-info', h('span', 'Envoi du message vocal chiffré…'))))));
  list.append(pending);
  scrollToBottom(true);
  try {
    const desc = await uploadEncrypted(new File([blob], 'message-vocal', { type: blob.type }), key);
    await postPayload({ v: 1, t: 'audio', file: { ...desc, duration: seconds }, ...(reply ? { reply } : {}) });
  } catch (err) {
    toastError(err);
  } finally {
    pending.remove();
  }
}

async function sendFile(original) {
  const kind = original.type.startsWith('video/') ? 'video' : original.type.startsWith('image/') ? 'image' : null;
  if (!kind) return toast('Seules les images, GIFs et vidéos sont acceptés', 'error');
  if (!navigator.onLine) return toast('Hors ligne : les images et vidéos s\'envoient une fois le réseau revenu', 'error');
  const key = currentKey();
  if (!key) return toast('Clé de la classe pas encore reçue', 'error');

  const label = h('span', `Préparation de ${original.name}…`);
  const bar = h('i');
  const pending = h('div.msg.mine.pending', h('div.msg-avatar'), h('div.msg-body',
    h('div.bubble', h('div.upload', h('div.spinner'), h('div.upload-info', label, h('div.upload-bar', bar))))));
  list.append(pending);
  scrollToBottom(true);
  try {
    const file = kind === 'image' ? await compressImage(original) : original;
    if (file.size > MAX_FILE) throw new Error(`Fichier trop lourd (${fmtSize(file.size)}, 15 Mo max)`);
    const dims = await mediaSize(file, kind);
    label.textContent = 'Chiffrement…';
    const desc = await uploadEncrypted(file, key, (p) => {
      label.textContent = `Envoi chiffré… ${Math.round(p * 100)} %`;
      bar.style.width = p * 100 + '%';
    });
    mediaCache.set(desc.id, URL.createObjectURL(file));
    await postPayload({ v: 1, t: kind, file: { ...desc, name: original.name.slice(0, 120), ...dims } });
  } catch (err) {
    toastError(err);
  } finally {
    pending.remove();
  }
}

async function mediaSize(file, kind) {
  try {
    if (kind === 'image') {
      const bmp = await createImageBitmap(file);
      const out = { w: bmp.width, h: bmp.height };
      bmp.close();
      return out;
    }
    return await new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => { resolve({ w: v.videoWidth, h: v.videoHeight }); URL.revokeObjectURL(v.src); };
      v.onerror = () => resolve({});
      v.src = URL.createObjectURL(file);
    });
  } catch { return {}; }
}

// ------------------------------------------------------------ pickers
function togglePopover(sel) {
  const pop = $(sel, root);
  const show = pop.hidden;
  closePopovers();
  pop.hidden = !show;
  if (show && sel === '.gif-pop') { $('.gif-search', pop).focus(); if (!pop.dataset.loaded) searchGifs(''); }
}
function closePopovers() { root.querySelectorAll('.popover').forEach((p) => { p.hidden = true; }); }

function buildEmojiPicker() {
  const pop = $('.emoji-pop', root);
  pop.append(...EMOJIS.map((e) => h('button', { type: 'button', onclick: () => {
    const { selectionStart: s, selectionEnd: en, value } = textarea;
    textarea.value = value.slice(0, s) + e + value.slice(en);
    textarea.selectionStart = textarea.selectionEnd = s + e.length;
    textarea.focus();
  } }, e)));
}

function buildGifPicker() {
  const input = $('.gif-search', root);
  let timer;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => searchGifs(input.value), 350); });
}

async function searchGifs(term) {
  const pop = $('.gif-pop', root);
  const grid = $('.gif-grid', pop);
  pop.dataset.loaded = '1';
  if (!GIPHY_API_KEY) {
    $('.gif-search', pop).hidden = true;
    grid.replaceChildren(h('p.muted.small', 'Recherche désactivée : ajoute une clé GIPHY dans js/config.js. Tu peux quand même importer un GIF.'));
    return;
  }
  grid.replaceChildren(h('div.spinner'));
  try {
    const endpoint = term.trim() ? 'search' : 'trending';
    const params = new URLSearchParams({ api_key: GIPHY_API_KEY, q: term.trim(), limit: '24', rating: 'pg-13', lang: 'fr' });
    const res = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params}`);
    const json = await res.json();
    const items = (json.data || []).map((g) => ({
      preview: g.images?.fixed_width_small?.url, url: g.images?.downsized_medium?.url || g.images?.original?.url,
      w: Number(g.images?.original?.width) || 0, h: Number(g.images?.original?.height) || 0, title: g.title,
    })).filter((g) => g.url && g.preview);
    grid.replaceChildren(...items.map((g) => h('button.gif-item', { type: 'button', onclick: async () => {
      closePopovers();
      try { await postPayload({ v: 1, t: 'gif', gif: { url: g.url, w: g.w, h: g.h, title: g.title } }); } catch (err) { toastError(err); }
    } }, h('img', { src: g.preview, alt: g.title, loading: 'lazy' }))));
    if (!items.length) grid.replaceChildren(h('p.muted.small', 'Aucun résultat'));
  } catch {
    grid.replaceChildren(h('p.muted.small', 'Recherche GIF indisponible'));
  }
}

// ------------------------------------------------------------ typing & misc
function showTyping(id) {
  if (id === state.me.id || !state.members.has(id)) return;
  clearTimeout(typingTimers.get(id));
  typingTimers.set(id, setTimeout(() => { typingTimers.delete(id); renderTyping(); }, 3500));
  renderTyping();
}
function renderTyping() {
  const ids = [...typingTimers.keys()];
  const names = ids.map(memberName);
  const el = $('.typing', root);
  const who = names.length === 1 ? `${names[0]} écrit…`
    : names.length === 2 ? `${names[0]} et ${names[1]} écrivent…`
      : `${names[0]}, ${names[1]} et ${names.length - 2} autre${names.length > 3 ? 's' : ''} écrivent…`;
  el.replaceChildren(names.length ? h('span.typing-pill',
    h('span.typing-avatars', ids.slice(0, 3).map((id) => avatar(state.members.get(id), 20))),
    h('i.dots', h('b'), h('b'), h('b')), h('span', who)) : '');
}

function setUnread(n) {
  unread = n;
  const badge = document.querySelector('[data-badge="chat"]');
  badge.textContent = n ? (n > 99 ? '99+' : n) : '';
  document.title = n ? `(${n}) Class Connect` : 'Class Connect';
}

const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
function scrollToBottom(smooth) {
  requestAnimationFrame(() => scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }));
}
const isOnlyEmoji = (s) => !!s && s.length <= 12 && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\s)+$/u.test(s) && !/\d/.test(s);
