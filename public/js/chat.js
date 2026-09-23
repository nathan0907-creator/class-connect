import {
  query, orderBy, limit, startAfter, where, onSnapshot, getDocs, getDoc, setDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, Bytes, writeBatch,
} from 'firebase/firestore';
import { db, sub, plain } from './fb.js';
import { state, on, isDelegate, memberName } from './state.js';
import { encryptJSON, decryptJSON, encryptBytes, decryptBytes } from './crypto.js';
import { currentKey } from './keyring.js';
import { sendTyping } from './presence.js';
import { GIPHY_API_KEY } from './config.js';
import { $, h, icon, avatar, toast, toastError, fmtTime, fmtDay, fmtSize, linkify, confirmDialog } from './ui.js';

const PAGE = 50;
const MAX_FILE = 15 * 1024 * 1024;
const CHUNK = 900_000;
const GROUP_MS = 5 * 60 * 1000;
const EMOJIS = ['😀','😂','🥹','😍','😎','🤔','😴','😭','😡','🤯','🥳','🤝','👍','👎','👏','🙏','💪','🔥','✨','🚀','🌌','🪐','⭐','🌙','☄️','👽','🛸','🌍','❤️','💜','💙','💯','✅','❌','⚠️','📚','📝','📅','⏰','🎉','🎮','⚽','🍕','☕','🎧','📸','🤫','👀'];

let root, list, scroller, textarea, fileInput, pinnedBar;
let oldestSnap = null;
let unread = 0;
let unsubs = [];
const decrypted = new Map(); // message id -> payload | null
const mediaCache = new Map(); // file id -> object URL
const typingTimers = new Map();

const aadFor = (row) => `msg|${state.cls.id}|${row.epoch}|${row.user_id}`;
const messagesCol = () => sub(state.cls.id, 'messages');

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
  buildEmojiPicker();
  buildGifPicker();

  on('typing', ({ id }) => showTyping(id));
  on('keys', redecryptFailed);
  on('members', refreshAuthors);
  on('panel', (name) => { if (name === 'chat') { setUnread(0); scrollToBottom(); } });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && root.classList.contains('active')) setUnread(0);
  });
}

// ------------------------------------------------------------ live data
export function startChat() {
  stopChat();
  list.replaceChildren();
  decrypted.clear();
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

function onIncoming(row) {
  const atBottom = nearBottom();
  appendMessage(row);
  if (row.user_id !== state.me.id) {
    state.space.pulse();
    if (document.hidden || !root.classList.contains('active')) setUnread(unread + 1);
  }
  if (atBottom || row.user_id === state.me.id) scrollToBottom(true);
}

function onModified(row) {
  const el = list.querySelector(`[data-id="${row.id}"]`);
  if (!el) return;
  el.classList.toggle('pinned', !!row.pinned);
  el._row.pinned = row.pinned;
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
  [...snap.docs].reverse().forEach((d) => frag.append(messageEl(plain(d))));
  list.prepend(frag);
  regroup();
  scroller.scrollTop += scroller.scrollHeight - prevHeight;
  oldestSnap = snap.docs[snap.docs.length - 1] || oldestSnap;
  $('.load-more', root).hidden = snap.size < PAGE;
}

// ------------------------------------------------------------ rendering
function appendMessage(row) {
  if (list.querySelector(`[data-id="${row.id}"]`)) return;
  list.append(messageEl(row));
  regroup(list.lastElementChild);
}

function messageEl(row) {
  const author = state.members.get(row.user_id);
  const mine = row.user_id === state.me.id;
  const el = h(`div.msg${mine ? '.mine' : ''}${row.pinned ? '.pinned' : ''}`, {
    dataset: { id: row.id, user: row.user_id, ts: row.created_at },
  },
  h('div.msg-avatar', avatar(author, 36)),
  h('div.msg-body',
    h('div.msg-head',
      h('b', { style: { color: author?.color } }, memberName(row.user_id)),
      author?.role === 'delegate' ? h('span.role-badge', '★ délégué') : null,
      h('time', fmtTime(row.created_at))),
    h('div.bubble', h('span.decrypting', icon('lock'), ' déchiffrement…'))),
  h('div.msg-actions', actionButtons(row)));
  el._row = row;
  fillBubble(el, row);
  return el;
}

function refreshAuthors() {
  for (const el of list.querySelectorAll('.msg')) {
    const author = state.members.get(el.dataset.user);
    if (!author) continue;
    const b = el.querySelector('.msg-head b');
    b.textContent = author.display_name;
    b.style.color = author.color;
  }
}

function actionButtons(row) {
  const out = [];
  if (isDelegate()) {
    out.push(h('button.icon-btn', { title: 'Épingler / désépingler', onclick: () => {
      updateDoc(doc(messagesCol(), row.id), { pinned: !row.pinned }).catch(toastError);
    } }, icon('pin')));
  }
  if (row.user_id === state.me.id || isDelegate()) {
    out.push(h('button.icon-btn', { title: 'Supprimer', onclick: async () => {
      if (!(await confirmDialog('Supprimer le message ?', 'Il disparaîtra pour toute la classe.'))) return;
      try {
        const payload = decrypted.get(row.id);
        await deleteDoc(doc(messagesCol(), row.id));
        onRemoved(row.id);
        if (payload?.file?.id) {
          await Promise.allSettled(Array.from({ length: payload.file.chunks }, (_, n) =>
            deleteDoc(sub(state.cls.id, 'chunks', `${payload.file.id}_${n}`))));
        }
      } catch (err) { toastError(err); }
    } }, icon('trash')));
  }
  return out;
}

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
  } else if ((payload.t === 'image' || payload.t === 'video') && payload.file) {
    parts.push(mediaEl(payload, row.epoch));
  }
  if (payload.text) parts.push(h('div.text', linkify(payload.text)));
  if (isOnlyEmoji(payload.text) && parts.length === 1) bubble.classList.add('jumbo');
  bubble.classList.toggle('has-media', payload.t !== 'text');
  bubble.replaceChildren(...parts);
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

async function downloadFile(file) {
  const parts = await Promise.all(Array.from({ length: file.chunks }, async (_, n) => {
    const snap = await getDoc(sub(state.cls.id, 'chunks', `${file.id}_${n}`));
    if (!snap.exists()) throw new Error('Morceau manquant');
    return snap.get('data').toUint8Array();
  }));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out.buffer;
}

function mediaEl({ t, file }, epoch) {
  const box = h(`div.media.loading${t === 'video' ? '.video' : ''}`, { style: ratio(file) },
    h('div.media-lock', icon('lock'), h('small', `${t === 'video' ? 'Vidéo' : 'Image'} chiffrée · ${fmtSize(file.size || 0)}`)));
  box._load = async () => {
    try {
      let url = mediaCache.get(file.id);
      if (!url) {
        const plainBytes = await decryptBytes(state.classKeys.get(epoch), file.iv, await downloadFile(file));
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
  if (!rows.length) { pinnedBar.hidden = true; return; }
  rows.sort((a, b) => b.created_at - a.created_at);
  const items = await Promise.all(rows.map(async (r) => {
    const p = await decryptRow(r);
    const preview = !p ? '🔒 message chiffré' : p.text || (p.t === 'video' ? '🎬 Vidéo' : p.t === 'gif' ? 'GIF' : '🖼️ Image');
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
  const enc = await encryptJSON(key, payload, `msg|${state.cls.id}|${epoch}|${state.me.id}`);
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
  textarea.value = '';
  textarea.style.height = 'auto';
  try {
    await postPayload({ v: 1, t: 'text', text });
  } catch (err) {
    textarea.value = text;
    toastError(err);
  }
}

async function sendFile(original) {
  const kind = original.type.startsWith('video/') ? 'video' : original.type.startsWith('image/') ? 'image' : null;
  if (!kind) return toast('Seules les images, GIFs et vidéos sont acceptés', 'error');
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
    const { iv, data } = await encryptBytes(key, await file.arrayBuffer());
    const bytes = new Uint8Array(data);
    const chunks = Math.ceil(bytes.length / CHUNK);
    const fileId = doc(sub(state.cls.id, 'chunks')).id;
    for (let n = 0; n < chunks; n++) {
      label.textContent = `Envoi chiffré… ${Math.round((n / chunks) * 100)} %`;
      bar.style.width = (n / chunks) * 100 + '%';
      await setDoc(sub(state.cls.id, 'chunks', `${fileId}_${n}`), {
        uploader: state.me.id, n, data: Bytes.fromUint8Array(bytes.subarray(n * CHUNK, (n + 1) * CHUNK)),
      });
    }
    bar.style.width = '100%';
    mediaCache.set(fileId, URL.createObjectURL(file));
    await postPayload({ v: 1, t: kind, file: {
      id: fileId, chunks, iv, mime: file.type, name: original.name.slice(0, 120), size: file.size, ...dims,
    } });
  } catch (err) {
    toastError(err);
  } finally {
    pending.remove();
  }
}

/** Downscales large photos (GIFs are kept intact to preserve animation). */
async function compressImage(file) {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  try {
    const bmp = await createImageBitmap(file);
    const max = 2048;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.2 * 1024 * 1024) { bmp.close(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    let blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.85));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name, { type: blob.type }) : file;
  } catch {
    return file;
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
  const names = [...typingTimers.keys()].map(memberName);
  const el = $('.typing', root);
  el.replaceChildren(names.length ? h('span', h('i.dots', h('b'), h('b'), h('b')),
    names.length === 1 ? ` ${names[0]} écrit…` : ` ${names.slice(0, 2).join(' et ')} écrivent…`) : '');
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
