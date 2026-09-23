// Profiles: photo + bio (visible to the class) and real name (visible to the person, the teachers and the delegates,
// used to find students when entering the class council results). Everything is end-to-end encrypted with the class key.
import { onSnapshot, doc, setDoc, deleteDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { sub, plain, userRef } from './fb.js';
import { state, on, emit, isTeacher, isDelegate } from './state.js';
import { encryptJSON, decryptJSON } from './crypto.js';
import { currentKey } from './keyring.js';
import { h, icon, avatar, modal, toast, toastError, busy } from './ui.js';

const BIO_MAX = 160;
const NAME_MAX = 60;
const PHOTO_PX = 192;
const PHOTO_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;

let unsubs = [];
const rows = { profiles: new Map(), names: new Map() };   // raw encrypted rows, kept to retry when keys arrive
state.profiles = new Map();   // uid -> { bio, photo }
state.realNames = new Map();  // uid -> "Prénom Nom"

const aad = (kind, uid, epoch) => `${kind}|${state.cls.id}|${epoch}|${uid}`;
const isNamesStaff = () => isTeacher() || isDelegate();
export const realName = (uid) => state.realNames.get(uid) || '';
/** Name used to sort and find people: the real name when known, otherwise the pseudo. */
export const sortName = (m) => realName(m.id) || m.display_name;

export function initProfiles() {
  on('keys', decryptAll);
}

export function startProfiles() {
  stopProfiles();
  const cid = state.cls.id;
  unsubs.push(onSnapshot(sub(cid, 'profiles'), (snap) => { rows.profiles = new Map(snap.docs.map((d) => [d.id, plain(d)])); decryptAll(); }, () => {}));
  // Students only read their own real name (enforced by the rules).
  const names = isNamesStaff()
    ? onSnapshot(sub(cid, 'names'), (snap) => { rows.names = new Map(snap.docs.map((d) => [d.id, plain(d)])); decryptAll(); }, () => {})
    : onSnapshot(sub(cid, 'names', state.me.id), (d) => { rows.names = new Map(d.exists() ? [[d.id, plain(d)]] : []); decryptAll(); }, () => {});
  unsubs.push(names);
}
export function stopProfiles() {
  unsubs.forEach((u) => u());
  unsubs = [];
  rows.profiles.clear(); rows.names.clear();
  state.profiles.clear(); state.realNames.clear();
}

async function open(kind, row) {
  const key = state.classKeys.get(row.epoch);
  if (!key) return null;
  try { return await decryptJSON(key, row.iv, row.ciphertext, aad(kind, row.id, row.epoch)); } catch { return null; }
}

async function decryptAll() {
  if (!state.cls) return;
  const profiles = new Map();
  for (const [uid, row] of rows.profiles) {
    const p = await open('profile', row);
    if (p) profiles.set(uid, { bio: String(p.bio || '').slice(0, BIO_MAX), photo: PHOTO_RE.test(p.photo || '') ? p.photo : '' });
  }
  const names = new Map();
  for (const [uid, row] of rows.names) {
    const p = await open('name', row);
    if (p?.name) names.set(uid, String(p.name).slice(0, NAME_MAX));
  }
  state.profiles = profiles;
  state.realNames = names;
  emit('profiles');
}

async function encryptedDoc(kind, uid, payload) {
  const key = currentKey();
  if (!key) throw new Error('Clé de la classe pas encore reçue : réessaie dans un instant.');
  const epoch = state.cls.key_epoch;
  const enc = await encryptJSON(key, payload, aad(kind, uid, epoch));
  return { epoch, iv: enc.iv, ciphertext: enc.ciphertext, updated_by: state.me.id, updated_at: serverTimestamp() };
}

async function saveRealName(uid, name) {
  const ref = sub(state.cls.id, 'names', uid);
  if (!name) return deleteDoc(ref);
  return setDoc(ref, await encryptedDoc('name', uid, { v: 1, name }));
}

/** Square, centre-cropped, compressed photo (a few KB) so it fits in the encrypted profile. */
async function photoFrom(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choisis une image');
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = Object.assign(document.createElement('canvas'), { width: PHOTO_PX, height: PHOTO_PX });
  canvas.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, PHOTO_PX, PHOTO_PX);
  bmp.close();
  const webp = canvas.toDataURL('image/webp', 0.82);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
}

// ------------------------------------------------------------ editors
export function openProfileEditor() {
  const me = state.me;
  const current = state.profiles.get(me.id) || {};
  let photo = current.photo || '';

  const preview = h('div.profile-photo');
  const renderPreview = () => {
    preview.replaceChildren(avatar({ ...me, id: me.id }, 96, photo));
    removeBtn.hidden = !photo;
  };
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try { photo = await photoFrom(f); renderPreview(); } catch (err) { toastError(err); }
  } });
  const removeBtn = h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { photo = ''; renderPreview(); } }, 'Retirer');

  const displayName = h('input', { value: me.display_name, maxLength: 40, required: true, 'aria-label': 'Pseudo affiché' });
  const bio = h('textarea', { rows: 3, maxLength: BIO_MAX, placeholder: 'Ex. Fan d\'astronomie, capitaine de l\'équipe de hand 🤾', 'aria-label': 'Bio' });
  bio.value = current.bio || '';
  const bioCount = h('small.muted', `${bio.value.length}/${BIO_MAX}`);
  bio.addEventListener('input', () => { bioCount.textContent = `${bio.value.length}/${BIO_MAX}`; });
  const real = h('input', { value: realName(me.id), maxLength: NAME_MAX, autocomplete: 'name', placeholder: 'Prénom Nom', 'aria-label': 'Vrai nom' });

  const body = h('form.slot-form.profile-form', { onsubmit: (e) => e.preventDefault() },
    h('div.profile-photo-row', preview,
      h('div.btn-row', h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => fileInput.click() }, icon('image'), h('span', 'Choisir une photo')), removeBtn),
      fileInput),
    h('label.field', h('span', 'Pseudo affiché'), displayName),
    h('label.field', h('span', 'Bio'), bio), bioCount,
    h('label.field', h('span', 'Vrai nom'), real),
    h('p.hint', icon('lock'), ' Ta photo et ta bio sont visibles par ta classe. Ton vrai nom n\'est visible que par toi, les professeurs et les délégués (pour le conseil de classe). Tout est chiffré de bout en bout.'));
  renderPreview();

  modal({
    title: 'Mon profil', body, wide: true,
    actions: [
      { label: 'Annuler' },
      { label: 'Enregistrer', variant: 'btn-primary', onClick: async () => {
        const name = displayName.value.trim();
        if (!name) throw new Error('Le pseudo affiché ne peut pas être vide');
        const jobs = [];
        if (name !== me.display_name) jobs.push(updateDoc(userRef(me.id), { display_name: name }));
        jobs.push(encryptedDoc('profile', me.id, { v: 1, bio: bio.value.trim().slice(0, BIO_MAX), photo })
          .then((d) => setDoc(sub(state.cls.id, 'profiles', me.id), d)));
        if (real.value.trim() !== realName(me.id)) jobs.push(saveRealName(me.id, real.value.trim()));
        await Promise.all(jobs);
        toast('Profil enregistré ✨', 'success');
      } },
    ],
  });
}

/** Teachers and delegates set the real name of a member, to find them in the class council. */
export function openRealNameEditor(m) {
  const input = h('input', { value: realName(m.id), maxLength: NAME_MAX, placeholder: 'Prénom Nom', 'aria-label': 'Vrai nom' });
  modal({
    title: `Vrai nom de ${m.display_name}`,
    body: h('div.slot-form',
      h('label.field', h('span', 'Prénom et nom'), input),
      h('p.hint', icon('lock'), ' Visible uniquement par cette personne, les professeurs et les délégués. Chiffré de bout en bout.')),
    actions: [
      { label: 'Annuler' },
      { label: 'Enregistrer', variant: 'btn-primary', onClick: async () => {
        await saveRealName(m.id, input.value.trim());
        toast('Vrai nom enregistré', 'success');
      } },
    ],
  });
}

/** Read-only profile card (tap on a member). */
export function showProfile(m) {
  const p = state.profiles.get(m.id) || {};
  const rn = realName(m.id);
  modal({
    title: m.display_name,
    body: h('div.profile-view',
      avatar(m, 112),
      h('div',
        h('b.pv-name', m.display_name),
        h('small.muted', '@' + m.username),
        rn && (isNamesStaff() || m.id === state.me.id) ? h('p.pv-real', icon('users'), ' ', rn) : null,
        h('p.pv-bio', p.bio || h('span.muted', 'Pas encore de bio.')))),
    actions: [
      m.id === state.me.id ? { label: 'Modifier', variant: 'btn-primary', onClick: () => { openProfileEditor(); } } : null,
      isNamesStaff() && m.id !== state.me.id ? { label: rn ? 'Modifier le vrai nom' : 'Ajouter le vrai nom', onClick: () => { openRealNameEditor(m); } } : null,
      { label: 'Fermer' },
    ].filter(Boolean),
  });
}

/** Leaving / being removed from the class: the profile and real name are erased. */
export function eraseProfileOps(batch, cid, uid) {
  batch.delete(doc(sub(cid, 'profiles'), uid));
  batch.delete(doc(sub(cid, 'names'), uid));
}
