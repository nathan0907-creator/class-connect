// « Écrire au créateur » : anyone signed in can send a message that only the creator of Class Connect can read.
// End-to-end encrypted: a fresh key per message, wrapped (ECDH) for the creator's public key only.
import { doc, getDoc, setDoc, deleteDoc, collection, query, orderBy, limit, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, plain } from './fb.js';
import { state, on } from './state.js';
import { generateClassKey, wrapClassKey, unwrapClassKey, encryptJSON, decryptJSON } from './crypto.js';
import { OWNER_UID } from './config.js';
import { $$, h, modal, toast, toastError, fmtDay, fmtTime } from './ui.js';

const MAX = 2000;
const ownerRef = () => doc(db, 'public', 'owner');
const info = (id) => `feedback:${id}`;
const aad = (id, from) => `feedback|${id}|${from}`;
export const isOwner = () => !!OWNER_UID && state.me?.id === OWNER_UID;

/** The creator's public key is published (only by the creator) so anyone can encrypt for them. */
async function publishOwnerKey() {
  if (!isOwner() || !state.me.public_key) return;
  const cur = await getDoc(ownerRef()).catch(() => null);
  if (cur?.get('public_key') === state.me.public_key) return;
  await setDoc(ownerRef(), { uid: OWNER_UID, public_key: state.me.public_key, updated_at: serverTimestamp() }).catch(() => {});
}

async function send(text) {
  const owner = await getDoc(ownerRef());
  if (!owner.exists()) throw new Error('La boîte du créateur n\'est pas encore ouverte : réessaie plus tard.');
  const id = doc(collection(db, 'feedback')).id;
  const key = await generateClassKey();
  const enc = await encryptJSON(key, { v: 1, text, name: state.me.display_name, username: state.me.username, cls: state.cls?.name || '' }, aad(id, state.me.id));
  const w = await wrapClassKey(key, state.privateKey, owner.get('public_key'), { classId: 'feedback', epoch: info(id), userId: OWNER_UID });
  const batch = writeBatch(db);
  batch.set(doc(db, 'feedback_rate', state.me.id), { last: serverTimestamp() });
  batch.set(doc(db, 'feedback', id), {
    from: state.me.id, created_at: serverTimestamp(), iv: enc.iv, ciphertext: enc.ciphertext,
    wrap: { iv: w.iv, wrapped: w.wrapped, from_public_key: state.me.public_key, to_public_key: owner.get('public_key') },
  });
  await batch.commit();
}

/** The message folds into a paper plane and flies off among the stars. */
function flyAway(card) {
  const r = card.getBoundingClientRect();
  const plane = h('div.fb-plane', { 'aria-hidden': 'true' }, '✉️');
  Object.assign(plane.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` });
  document.body.append(plane);
  for (let i = 0; i < 14; i++) {
    const s = h('i.fb-spark', { 'aria-hidden': 'true' });
    Object.assign(s.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px`, '--dx': `${(Math.random() - 0.5) * 260}px`, '--dy': `${(Math.random() - 0.5) * 220}px`, animationDelay: `${Math.random() * 0.25}s` });
    document.body.append(s);
    setTimeout(() => s.remove(), 1400);
  }
  setTimeout(() => plane.remove(), 1700);
}

export function openFeedback() {
  if (isOwner()) return openInbox();
  const area = h('textarea', { rows: 6, maxLength: MAX, placeholder: 'Une idée, un bug, un merci, une question… Écris ce que tu veux.', 'aria-label': 'Ton message' });
  const count = h('small.muted', `0 / ${MAX}`);
  area.addEventListener('input', () => { count.textContent = `${area.value.length} / ${MAX}`; });
  const body = h('div.fb-box',
    h('div.fb-hero', { 'aria-hidden': 'true' }, h('span.fb-orbit'), h('span.fb-icon', '📨')),
    h('p', 'Ce message part directement au créateur de Class Connect. Lui seul peut le lire : il est chiffré de bout en bout, même le serveur ne voit rien.'),
    area, count);
  const m = modal({
    title: '📨 Écrire au créateur',
    body,
    actions: [
      { label: 'Annuler' },
      { label: 'Envoyer ✨', variant: 'btn-primary', onClick: async () => {
        const text = area.value.trim();
        if (text.length < 2) throw new Error('Écris d\'abord ton message');
        try { await send(text); }
        catch (err) {
          if (err?.code === 'permission-denied') throw new Error('Doucement : un message par minute maximum.');
          throw err;
        }
        flyAway(m.card);
        setTimeout(() => toast('Message envoyé au créateur ✨ Merci !', 'success', 5000), 900);
      } },
    ],
  });
}

// ------------------------------------------------------------ the creator's inbox
async function openInbox() {
  const list = h('div.fb-inbox', h('div.spinner'));
  modal({ title: '📨 Messages pour toi', wide: true, body: list });
  try {
    const rows = (await getDocs(query(collection(db, 'feedback'), orderBy('created_at', 'desc'), limit(100)))).docs.map(plain);
    const items = await Promise.all(rows.map(async (r) => {
      try {
        const key = await unwrapClassKey({ ...r.wrap, epoch: info(r.id) }, state.privateKey, { classId: 'feedback', userId: OWNER_UID });
        return { r, m: await decryptJSON(key, r.iv, r.ciphertext, aad(r.id, r.from)) };
      } catch { return { r, m: null }; }
    }));
    list.replaceChildren(...(items.length ? items.map(({ r, m }) => {
      const card = h('article.fb-msg',
        h('header', h('b', m ? `${m.name} (@${m.username})` : 'Message illisible'), h('small.muted', `${m?.cls ? m.cls + ' · ' : ''}${fmtDay(r.created_at)} ${fmtTime(r.created_at)}`)),
        m ? h('p', String(m.text).slice(0, MAX)) : h('p.muted', 'Chiffré pour une ancienne clé.'),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: async () => {
          try { await deleteDoc(doc(db, 'feedback', r.id)); card.remove(); } catch (err) { toastError(err); }
        } }, 'Supprimer'));
      return card;
    }) : [h('p.muted', 'Aucun message pour l\'instant.')]));
  } catch (err) { list.replaceChildren(h('p.muted', 'Boîte indisponible')); toastError(err); }
}

export function initFeedback() {
  $$('[data-action="feedback"]').forEach((b) => b.addEventListener('click', openFeedback));
  on('app-ready', () => {
    publishOwnerKey();
    $$('[data-action="feedback"]').forEach((b) => { b.textContent = isOwner() ? '📨 Messages pour toi' : '📨 Écrire au créateur'; });
  });
}
