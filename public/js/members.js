import { doc, getDocs, query, where, updateDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import { reauthenticateWithCredential, EmailAuthProvider, deleteUser } from 'firebase/auth';
import { auth, db, sub, classRef, userRef } from './fb.js';
import { state, on, emit, isDelegate } from './state.js';
import { fingerprint, deriveAuthKey, clearKeys } from './crypto.js';
import { sharesFor, shareRefFor, rotateKey } from './keyring.js';
import { $, $$, h, icon, avatar, modal, toast, toastError, confirmDialog, enableTilt, busy } from './ui.js';

export function initMembers() {
  $$('[data-action="leave"]').forEach((b) => b.addEventListener('click', leave));
  $$('[data-action="delete-account"]').forEach((b) => b.addEventListener('click', deleteAccount));
  on('members', () => { renderMembers(); renderAdmin(); });
  on('presence', renderMembers);
  on('keys', renderAdmin);
}

const active = () => [...state.members.values()].filter((m) => m.status === 'active');
const pending = () => [...state.members.values()].filter((m) => m.status === 'pending');

/** Leaves the class (or cancels a pending request). */
export async function leave() {
  const delegates = active().filter((m) => m.role === 'delegate');
  if (isDelegate() && delegates.length <= 1 && state.members.size > 1) {
    return toast('Nomme un autre délégué avant de quitter la classe', 'error');
  }
  const txt = state.me.status === 'pending'
    ? 'Ta demande sera annulée.'
    : 'Tu perdras l\'accès aux messages et devras être revalidé pour revenir.';
  if (!(await confirmDialog(state.me.status === 'pending' ? 'Annuler la demande ?' : 'Quitter la classe ?', txt, { label: 'Confirmer' }))) return;
  try {
    const batch = writeBatch(db);
    if (state.me.status === 'active') {
      const mine = await getDocs(query(sub(state.cls.id, 'shares'), where('user_id', '==', state.me.id)));
      mine.docs.forEach((d) => batch.delete(d.ref));
    }
    batch.update(userRef(state.me.id), { class_id: null, status: 'none', role: 'student' });
    await batch.commit();
    emit('reroute');
  } catch (err) { toastError(err); }
}

/** RGPD right to erasure: removes the profile, keys, pseudo and the Firebase account. */
function deleteAccount() {
  const delegates = active().filter((m) => m.role === 'delegate');
  if (isDelegate() && delegates.length <= 1 && state.members.size > 1) {
    return toast('Nomme un autre délégué avant de supprimer ton compte', 'error');
  }
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Mot de passe' });
  modal({
    title: 'Supprimer mon compte',
    body: h('div.slot-form',
      h('p', 'Cette action est définitive : ton profil, tes clés et ton pseudo seront effacés. Tes anciens messages resteront chiffrés et s\'afficheront comme « Ancien membre ».'),
      h('label.field', h('span', 'Confirme avec ton mot de passe'), pw)),
    actions: [
      { label: 'Annuler' },
      { label: 'Supprimer définitivement', variant: 'btn-danger', onClick: async () => {
        if (!pw.value) throw new Error('Entre ton mot de passe');
        const user = auth.currentUser;
        const key = await deriveAuthKey(user.email, pw.value);
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, key)).catch(() => {
          throw new Error('Mot de passe incorrect');
        });
        if (state.me.class_id) {
          const batch = writeBatch(db);
          if (state.me.status === 'active') {
            const mine = await getDocs(query(sub(state.cls.id, 'shares'), where('user_id', '==', state.me.id)));
            mine.docs.forEach((d) => batch.delete(d.ref));
          }
          batch.update(userRef(state.me.id), { class_id: null, status: 'none', role: 'student' });
          await batch.commit();
        }
        const batch = writeBatch(db);
        batch.delete(doc(db, 'private', state.me.id));
        batch.delete(doc(db, 'usernames', state.me.username));
        batch.delete(userRef(state.me.id));
        await batch.commit();
        await deleteDoc(doc(db, 'emails', user.email)).catch(() => {});
        await deleteUser(user);
        await clearKeys();
        location.reload();
      } },
    ],
  });
}

function roleBadge(m) {
  return m.role === 'delegate' ? h('span.role-badge', '★ Délégué') : h('span.role-badge.student', 'Élève');
}

function renderMembers() {
  const grid = $('#panel-members .member-grid');
  const list = active().sort((a, b) => (b.role === 'delegate') - (a.role === 'delegate') || a.display_name.localeCompare(b.display_name));
  grid.replaceChildren(...list.map((m) => h(`div.member.card.tilt${state.online.has(m.id) ? '.online' : ''}`,
    h('div.member-avatar', avatar(m, 56), h('span.orbit')),
    h('div.member-info',
      h('b', m.display_name, m.id === state.me.id ? h('small.you', ' (toi)') : null),
      h('small', '@' + m.username),
      roleBadge(m)),
    h('button.btn.btn-sm.btn-ghost', { onclick: () => showFingerprint(m) }, icon('lock'), h('span', 'Empreinte')))));
  enableTilt(grid);

  const onlineMembers = list.filter((m) => state.online.has(m.id));
  $('[data-online-count]').textContent = onlineMembers.length;
  $('[data-online-stack]').replaceChildren(...onlineMembers.slice(0, 6).map((m) => avatar(m, 28)));
}

async function showFingerprint(m) {
  const [theirs, mine] = await Promise.all([fingerprint(m.public_key), fingerprint(state.me.public_key)]);
  modal({
    title: `Empreinte de ${m.display_name}`,
    body: h('div.fingerprint',
      h('p.muted', 'Compare ce numéro avec celui affiché sur l\'appareil de ton camarade. S\'il est identique, personne (pas même le serveur) ne peut lire vos échanges.'),
      h('div.fp-code', { style: { '--c': m.color } }, theirs),
      m.id !== state.me.id ? [h('p.muted.small', 'Ton empreinte :'), h('div.fp-code.small', mine)] : null),
  });
}

// ------------------------------------------------------------ delegate console
function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const s = [...bytes].map((b) => alphabet[b % 32]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
export { inviteCode };

function renderAdmin() {
  const root = $('#panel-admin .admin-grid');
  const pend = pending();
  $('[data-badge="admin"]').textContent = isDelegate() && pend.length ? pend.length : '';
  if (!isDelegate() || !state.cls) { root.replaceChildren(); return; }

  const codeEl = h('div.invite-code', state.cls.invite_code);
  const invite = h('div.admin-card.card.tilt.span-2',
    h('h3', icon('rocket'), ' Invitation'),
    h('p.muted', 'Partage ce code à tes camarades. Chaque demande devra être validée ici.'),
    codeEl,
    h('div.btn-row',
      h('button.btn.btn-primary.btn-sm', { onclick: async () => {
        try { await navigator.clipboard.writeText(state.cls.invite_code); toast('Code copié 📋', 'success'); }
        catch { toast('Copie impossible, sélectionne le code', 'error'); }
      } }, h('span', 'Copier')),
      h('button.btn.btn-ghost.btn-sm', { onclick: async () => {
        if (!(await confirmDialog('Nouveau code ?', 'L\'ancien code ne fonctionnera plus.', { danger: false }))) return;
        try {
          const code = inviteCode();
          const batch = writeBatch(db);
          batch.set(doc(db, 'invites', code), { class_id: state.cls.id });
          batch.update(classRef(state.cls.id), { invite_code: code });
          batch.delete(doc(db, 'invites', state.cls.invite_code));
          await batch.commit();
          state.cls.invite_code = code;
          codeEl.textContent = code;
        } catch (err) { toastError(err); }
      } }, 'Régénérer')));

  const pendingCard = h('div.admin-card.card.tilt.span-2',
    h('h3', icon('users'), ' Demandes en attente ', pend.length ? h('b.count', pend.length) : null),
    pend.length ? h('div.pending-list', pend.map((m) => h('div.pending-item',
      avatar(m, 40),
      h('div.pi-info', h('b', m.display_name), h('small', '@' + m.username)),
      h('button.btn.btn-sm.btn-ghost', { onclick: () => showFingerprint(m), title: 'Empreinte de sécurité', 'aria-label': 'Empreinte de sécurité' }, icon('lock')),
      h('button.btn.btn-sm.btn-ghost', { onclick: () => removeMember(m, false) }, 'Refuser'),
      h('button.btn.btn-sm.btn-primary', { onclick: (e) => approve(m, e.currentTarget) }, h('span', 'Accepter')))))
      : h('p.muted', 'Aucune demande. Partage le code d\'invitation !'));

  const others = active().filter((m) => m.id !== state.me.id);
  const crew = h('div.admin-card.card.span-2',
    h('h3', icon('star'), ' Gestion de l\'équipage'),
    others.length ? h('div.crew-list', others.map((m) => h('div.crew-item',
      avatar(m, 34),
      h('div.pi-info', h('b', m.display_name), roleBadge(m)),
      h('button.btn.btn-sm.btn-ghost', { onclick: () => setRole(m) }, m.role === 'delegate' ? 'Retirer délégué' : 'Nommer délégué'),
      h('button.btn.btn-sm.btn-danger', { onclick: () => removeMember(m, true) }, 'Exclure'))))
      : h('p.muted', 'Personne d\'autre pour l\'instant.'));

  const nameInput = h('input', { value: state.cls.name, maxLength: 60, minLength: 2, required: true, 'aria-label': 'Nom de la classe' });
  const settings = h('form.admin-card.card.tilt', { onsubmit: async (e) => {
    e.preventDefault();
    try { await updateDoc(classRef(state.cls.id), { name: nameInput.value.trim() }); toast('Nom mis à jour', 'success'); }
    catch (err) { toastError(err); }
  } },
  h('h3', icon('edit'), ' Classe'),
  h('label.field', h('span', 'Nom de la classe'), nameInput),
  h('button.btn.btn-ghost.btn-sm', { type: 'submit' }, 'Enregistrer'));

  const security = h('div.admin-card.card.tilt',
    h('h3', icon('lock'), ' Chiffrement'),
    h('p.muted', `Clé de classe n°${state.cls.key_epoch}. Renouvelle-la si tu penses qu'un appareil a été compromis : les anciens membres ne pourront plus lire les nouveaux messages.`),
    h('button.btn.btn-ghost.btn-sm', { onclick: async (e) => {
      if (!(await confirmDialog('Renouveler la clé ?', 'Une nouvelle clé sera générée et transmise à tous les membres actifs.', { danger: false }))) return;
      busy(e.currentTarget, true);
      try { await rotateKey(); toast('Nouvelle clé distribuée 🔐', 'success'); } catch (err) { toastError(err); }
      finally { busy(e.currentTarget, false); }
    } }, 'Renouveler la clé'));

  root.replaceChildren(invite, pendingCard, crew, settings, security);
  enableTilt(root);
}

async function approve(m, btn) {
  busy(btn, true);
  try {
    const batch = writeBatch(db);
    batch.update(userRef(m.id), { status: 'active' });
    for (const s of await sharesFor(m.id, m.public_key)) batch.set(shareRefFor(s.epoch, m.id), s);
    await batch.commit();
    toast(`${m.display_name} a rejoint l'équipage 🚀`, 'success');
  } catch (err) { toastError(err); busy(btn, false); }
}

async function removeMember(m, wasActive) {
  const ok = wasActive
    ? await confirmDialog(`Exclure ${m.display_name} ?`, 'Il perdra immédiatement l\'accès. La clé de chiffrement sera renouvelée pour qu\'il ne puisse plus lire les nouveaux messages.', { label: 'Exclure' })
    : await confirmDialog('Refuser la demande ?', `${m.display_name} ne rejoindra pas la classe.`);
  if (!ok) return;
  try {
    const batch = writeBatch(db);
    if (wasActive) {
      const theirs = await getDocs(query(sub(state.cls.id, 'shares'), where('user_id', '==', m.id)));
      theirs.docs.forEach((d) => batch.delete(d.ref));
    }
    batch.update(userRef(m.id), { class_id: null, status: 'none', role: 'student' });
    await batch.commit();
    if (wasActive) {
      await rotateKey();
      toast(`${m.display_name} a été exclu, clé renouvelée 🔐`, 'success');
    }
  } catch (err) { toastError(err); }
}

async function setRole(m) {
  const promote = m.role !== 'delegate';
  const ok = await confirmDialog(promote ? 'Nommer délégué ?' : 'Retirer le rôle de délégué ?',
    promote ? `${m.display_name} pourra gérer les membres, l'emploi du temps et les votes.` : `${m.display_name} redeviendra élève.`,
    { danger: !promote });
  if (!ok) return;
  try { await updateDoc(userRef(m.id), { role: promote ? 'delegate' : 'student' }); }
  catch (err) { toastError(err); }
}
