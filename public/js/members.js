import { doc, collection, getDoc, getDocs, query, where, updateDoc, writeBatch, deleteDoc, deleteField } from 'firebase/firestore';
import { reauthenticateWithCredential, EmailAuthProvider, deleteUser } from 'firebase/auth';
import { auth, db, sub, classRef, userRef, saltEmail, isSynthetic } from './fb.js';
import { state, on, emit, isDelegate, isTeacher, MAX_DELEGATES } from './state.js';
import { fingerprint, deriveAuthKey, clearKeys } from './crypto.js';
import { sharesFor, shareRefFor, rotateKey } from './keyring.js';
import { reportsCard, openReportsCount } from './moderation.js';
import { showInvite, shareInvite } from './invite.js';
import { adminCards, muteButton, actingButton, log } from './admin.js';
import { realName, sortName, showProfile, openProfileEditor, openRealNameEditor, eraseProfileOps, statusOf, isBirthday } from './profiles.js';
import { $, $$, h, icon, avatar, modal, toast, toastError, confirmDialog, enableTilt, busy } from './ui.js';

export function initMembers() {
  $$('[data-action="leave"]').forEach((b) => b.addEventListener('click', leave));
  $$('[data-action="delete-account"]').forEach((b) => b.addEventListener('click', deleteAccount));
  $$('[data-action="export-data"]').forEach((b) => b.addEventListener('click', exportMyData));
  on('members', () => { renderMembers(); renderAdmin(); });
  on('profiles', () => { renderMembers(); renderAdmin(); });
  $$('[data-action="edit-profile"]').forEach((b) => b.addEventListener('click', openProfileEditor));
  on('presence', renderMembers);
  on('keys', renderAdmin);
  on('reports', () => { renderAdmin(); renderMembers(); });
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
      eraseProfileOps(batch, state.cls.id, state.me.id);
    }
    batch.update(userRef(state.me.id), { class_id: null, status: 'none', role: 'student', trusted: false, principal: false, muted_until: null, acting_until: null });
    await batch.commit();
    emit('reroute');
  } catch (err) { toastError(err); }
}

/**
 * RGPD rights of access and portability: everything the app holds about me, decrypted on this device,
 * in a readable JSON file. Messages stay in the class (they belong to the conversation), so they are not included.
 */
function exportMyData() {
  const me = state.me;
  const p = state.profiles.get(me.id) || {};
  const email = auth.currentUser?.email || '';
  const data = {
    info: 'Données personnelles détenues par Class Connect (export RGPD, articles 15 et 20).',
    exporte_le: new Date().toISOString(),
    compte: {
      pseudo: me.username, nom_affiche: me.display_name, couleur: me.color,
      email: isSynthetic(email) ? '(aucun e-mail lié)' : email,
      cree_le: me.created_at ? new Date(me.created_at).toISOString() : null,
      empreinte_de_securite_cle_publique: me.public_key,
    },
    classe: state.cls ? { nom: state.cls.name, role: me.role, statut: me.status, confiance: !!me.trusted, prof_principal: !!me.principal } : null,
    profil: {
      bio: p.bio || '', statut: p.status || '', anniversaire_jour_mois: p.birthday || '',
      avatar: p.gif ? { type: 'GIF', lien: p.gif } : p.photo ? { type: 'image', image: p.photo } : 'initiales',
      vrai_nom: realName(me.id) || '',
    },
    note: 'Tes messages, résultats du conseil de classe et messages privés restent consultables dans l\'appli. Pour tout effacer : Équipage → Supprimer mon compte.',
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: `class-connect-mes-donnees-${me.username}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Tes données ont été téléchargées 📦', 'success');
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
        const key = await deriveAuthKey(saltEmail(user.email), pw.value);
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, key)).catch(() => {
          throw new Error('Mot de passe incorrect');
        });
        if (state.me.class_id) {
          const batch = writeBatch(db);
          if (state.me.status === 'active') {
            const mine = await getDocs(query(sub(state.cls.id, 'shares'), where('user_id', '==', state.me.id)));
            mine.docs.forEach((d) => batch.delete(d.ref));
            eraseProfileOps(batch, state.cls.id, state.me.id);
          }
          batch.update(userRef(state.me.id), { class_id: null, status: 'none', role: 'student', trusted: false, principal: false, muted_until: null, acting_until: null });
          await batch.commit();
        }
        const batch = writeBatch(db);
        batch.delete(doc(db, 'private', state.me.id));
        batch.delete(doc(db, 'private_data', state.me.id));
        (await getDocs(query(collection(db, 'devices'), where('uid', '==', state.me.id)))).docs.forEach((d) => batch.delete(d.ref));
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
  if (m.role === 'teacher') return h('span.role-badge.teacher', m.principal ? '🎓 Prof principal' : '🎓 Professeur');
  if (m.role === 'delegate') return h('span.role-badge', '★ Délégué');
  if (m.role === 'deputy') return h('span.role-badge.deputy', '☆ Suppléant');
  if (m.trusted) return h('span.role-badge.trusted', '✓ Confiance');
  return h('span.role-badge.student', 'Élève');
}

async function toggleTrusted(m) {
  const on = !m.trusted;
  const ok = await confirmDialog(on ? `Accorder la confiance à ${m.display_name} ?` : `Retirer la confiance à ${m.display_name} ?`,
    on ? 'Il pourra publier des cours dans la bibliothèque utilisée par l\'assistant de révision IA.'
      : 'Il ne pourra plus publier de cours (ceux déjà publiés restent).', { danger: !on });
  if (!ok) return;
  try { await updateDoc(userRef(m.id), { trusted: on }); toast(on ? `${m.display_name} peut maintenant publier des cours 📚` : 'Confiance retirée', 'success'); }
  catch (err) { toastError(err); }
}

const RANK = { teacher: 0, delegate: 1, deputy: 2, student: 3 };

function renderMembers() {
  const grid = $('#panel-members .member-grid');
  const list = active().sort((a, b) => RANK[a.role] - RANK[b.role] || sortName(a).localeCompare(sortName(b), 'fr'));
  const staffView = isDelegate() || isTeacher();
  // Teachers handle reports from the shared channel and the staff room from here.
  const teacherBox = $('#panel-members .teacher-reports');
  teacherBox.replaceChildren(...(isTeacher() ? [reportsCard()] : []));
  $('[data-badge="members"]').textContent = isTeacher() && openReportsCount() ? openReportsCount() : '';
  grid.replaceChildren(...list.map((m) => {
    const bio = state.profiles.get(m.id)?.bio;
    const rn = (staffView || m.id === state.me.id) ? realName(m.id) : '';
    return h(`div.member.card.tilt${state.online.has(m.id) ? '.online' : ''}`,
      h('button.member-avatar', { type: 'button', title: 'Voir le profil', 'aria-label': `Profil de ${m.display_name}`, onclick: () => showProfile(m) }, avatar(m, 56), h('span.orbit')),
      h('div.member-info',
        h('b', m.display_name, isBirthday(m.id) ? h('span.bday-tag', { title: 'C\'est son anniversaire !' }, ' 🎂') : null,
          m.id === state.me.id ? h('small.you', ' (toi)') : null),
        h('small', '@' + m.username, rn ? h('span.real-name', ' · ', rn) : null),
        roleBadge(m),
        statusOf(m.id) ? h('span.member-status', statusOf(m.id)) : null,
        bio ? h('p.member-bio', bio) : null),
      h('div.member-actions',
        m.id === state.me.id ? h('button.btn.btn-sm.btn-primary', { onclick: openProfileEditor }, icon('edit'), h('span', 'Mon profil')) : null,
        staffView && m.id !== state.me.id ? h('button.btn.btn-sm.btn-ghost', { onclick: () => openRealNameEditor(m), title: 'Vrai nom (conseil de classe)' }, icon('edit'), h('span', rn ? 'Vrai nom' : 'Ajouter le nom')) : null,
        h('button.btn.btn-sm.btn-ghost', { onclick: () => showFingerprint(m) }, icon('lock'), h('span', 'Empreinte'))));
  }));
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

/** One invite code (students or teachers) with copy / (re)generate buttons. */
// The teachers' code stays out of the class document (every member can read it): delegates keep it in secrets/codes.
const secret = { cid: null, code: null };
function teacherCode() {
  if (secret.cid !== state.cls.id) {
    const cid = state.cls.id;
    Object.assign(secret, { cid, code: state.cls.teacher_code || null });
    getDoc(sub(cid, 'secrets', 'codes')).then((s) => {
      if (s.exists() && secret.cid === cid) { secret.code = s.get('teacher_code'); renderAdmin(); }
    }).catch(() => {});
  }
  return secret.code;
}

function codeBlock(title, field, role, hint) {
  const current = role === 'teacher' ? teacherCode() : state.cls[field];
  const codeEl = h(`div.invite-code${role === 'teacher' ? '.teacher' : ''}`, current || '— — — —');
  const regenerate = async () => {
    if (current && !(await confirmDialog('Nouveau code ?', 'L\'ancien code ne fonctionnera plus.', { danger: false }))) return;
    try {
      const code = inviteCode();
      const batch = writeBatch(db);
      batch.set(doc(db, 'invites', code), { class_id: state.cls.id, role });
      if (role === 'teacher') {
        batch.set(sub(state.cls.id, 'secrets', 'codes'), { teacher_code: code });
        if (state.cls.teacher_code) batch.update(classRef(state.cls.id), { teacher_code: deleteField() });
      } else {
        batch.update(classRef(state.cls.id), { [field]: code });
      }
      if (current) batch.delete(doc(db, 'invites', current));
      await batch.commit();
      if (role === 'teacher') { secret.code = code; delete state.cls.teacher_code; } else state.cls[field] = code;
      codeEl.textContent = code;
      renderAdmin();
    } catch (err) { toastError(err); }
  };
  return h('div.invite-block',
    h('b', title), h('small.muted', hint), codeEl,
    h('div.btn-row',
      current ? h('button.btn.btn-primary.btn-sm', { onclick: () => showInvite(current, state.cls.name, role) }, icon('send'), h('span', 'Lien & QR code')) : null,
      current ? h('button.btn.btn-ghost.btn-sm', { onclick: () => shareInvite(current, state.cls.name, role) }, navigator.share ? 'Partager' : 'Copier le lien') : null,
      current ? h('button.btn.btn-ghost.btn-sm', { onclick: async () => {
        try { await navigator.clipboard.writeText(current); toast('Code copié 📋', 'success'); }
        catch { toast('Copie impossible, sélectionne le code', 'error'); }
      } }, 'Copier le code') : null,
      h(`button.btn.btn-sm.${current ? 'btn-ghost' : 'btn-primary'}`, { onclick: regenerate }, h('span', current ? 'Régénérer' : 'Créer le code'))));
}

function renderAdmin() {
  const root = $('#panel-admin .admin-grid');
  const pend = pending();
  const toHandle = pend.length + openReportsCount();
  $('[data-badge="admin"]').textContent = isDelegate() && toHandle ? toHandle : '';
  if (!isDelegate() || !state.cls) { root.replaceChildren(); return; }

  const invite = h('div.admin-card.card.tilt.span-2',
    h('h3', icon('rocket'), ' Invitations'),
    h('p.muted', 'Chaque demande devra être validée ici. Vérifie en vrai l\'identité des professeurs avant de les accepter.'),
    h('div.invite-grid',
      codeBlock('Code élèves', 'invite_code', 'student', 'À partager avec tes camarades.'),
      codeBlock('Code professeurs', 'teacher_code', 'teacher', 'À donner uniquement aux professeurs : ils accéderont à la salle des profs et au canal Profs & élèves.')));

  const pendingCard = h('div.admin-card.card.tilt.span-2',
    h('h3', icon('users'), ' Demandes en attente ', pend.length ? h('b.count', pend.length) : null),
    pend.length ? h('div.pending-list', pend.map((m) => h('div.pending-item',
      avatar(m, 40),
      h('div.pi-info', h('b', m.display_name), h('small', '@' + m.username), m.role === 'teacher' ? roleBadge(m) : null),
      h('button.btn.btn-sm.btn-ghost', { onclick: () => showFingerprint(m), title: 'Empreinte de sécurité', 'aria-label': 'Empreinte de sécurité' }, icon('lock')),
      h('button.btn.btn-sm.btn-ghost', { onclick: () => removeMember(m, false) }, 'Refuser'),
      h('button.btn.btn-sm.btn-primary', { onclick: (e) => approve(m, e.currentTarget) }, h('span', 'Accepter')))))
      : h('p.muted', 'Aucune demande. Partage le code d\'invitation !'));

  const others = active().filter((m) => m.id !== state.me.id);
  const all = active();
  const count = (role) => all.filter((m) => m.role === role).length;
  const principals = all.filter((m) => m.role === 'teacher' && m.principal).length;
  const crew = h('div.admin-card.card.span-2',
    h('h3', icon('star'), ' Rôles et équipage'),
    h('div.role-summary',
      h('span', h('b', `${count('delegate')}/${MAX_DELEGATES}`), ' délégués'),
      h('span', h('b', count('deputy')), ' suppléant(s)'),
      h('span', h('b', count('teacher')), ' professeur(s)'),
      h('span', h('b', principals), ' prof(s) principal(aux)')),
    principals ? null : h('p.report-notice', '⚠️ Aucun prof principal : désigne-en un pour qu\'il reçoive tous les signalements de harcèlement.'),
    others.length ? h('div.crew-list', others.map((m) => h('div.crew-item',
      avatar(m, 34),
      h('div.pi-info', h('b', m.display_name), roleBadge(m)),
      m.role === 'teacher'
        ? [
            h(`button.btn.btn-sm.${m.principal ? 'btn-ghost' : 'btn-primary'}`, { onclick: () => togglePrincipal(m) },
              h('span', m.principal ? 'Retirer prof principal' : 'Nommer prof principal')),
            h('button.btn.btn-sm.btn-ghost', { onclick: () => backToStudent(m), title: 'Si ce compte a été nommé professeur par erreur' }, 'Repasser élève'),
          ]
        : [
            roleSelect(m, count('delegate')),
            m.role === 'student'
              ? h('button.btn.btn-sm.btn-ghost', { onclick: () => toggleTrusted(m), title: 'Les membres de confiance peuvent publier des cours pour l\'IA' },
                m.trusted ? 'Retirer confiance' : 'Confiance')
              : null,
          ],
      m.role !== 'teacher' ? muteButton(m) : null,
      actingButton(m),
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

  root.replaceChildren(invite, pendingCard, reportsCard(), crew, ...adminCards(), settings, security);
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
      eraseProfileOps(batch, state.cls.id, m.id);
    }
    batch.update(userRef(m.id), { class_id: null, status: 'none', role: 'student', trusted: false, principal: false, muted_until: null, acting_until: null });
    await batch.commit();
    if (wasActive) {
      log('kick', m.id);
      await rotateKey();
      toast(`${m.display_name} a été exclu, clé renouvelée 🔐`, 'success');
    }
  } catch (err) { toastError(err); }
}

const ROLE_INFO = {
  student: ['Élève', 'redeviendra simple élève.'],
  deputy: ['Suppléant', 'pourra modérer les canaux élèves (épingler, supprimer) et publier des cours pour l\'IA, pour remplacer un délégué absent.'],
  delegate: ['Délégué', 'aura tous les pouvoirs : membres, rôles, emploi du temps, votes et signalements.'],
  teacher: ['Professeur', 'deviendra professeur : il accédera à la salle des profs, au canal Profs & élèves et à TOUS les résultats du conseil de classe (et au vrai nom de chacun). Il ne verra plus le canal des élèves. À réserver aux vrais professeurs !'],
};

/** Student role picker: élève / suppléant / délégué (2 delegates max, like a French class council). */
function roleSelect(m, delegates) {
  const full = delegates >= MAX_DELEGATES && m.role !== 'delegate';
  const select = h('select.role-select', { 'aria-label': `Rôle de ${m.display_name}` },
    Object.entries(ROLE_INFO).map(([value, [label]]) => h('option', {
      value, selected: m.role === value, disabled: value === 'delegate' && full,
    }, value === 'delegate' && full ? `${label} (2 max)` : label)));
  select.addEventListener('change', async () => {
    const role = select.value;
    const [label, effect] = ROLE_INFO[role];
    const ok = await confirmDialog(`${m.display_name} : ${label} ?`, `${m.display_name} ${effect}`, { danger: role === 'student' || role === 'teacher', label: 'Confirmer' });
    if (!ok) { select.value = m.role; return; }
    try {
      // Becoming a teacher drops the student-only "trusted" flag (required by the security rules).
      await updateDoc(userRef(m.id), role === 'teacher' ? { role, trusted: false, principal: false } : { role });
      log('role', m.id, role);
      toast(`${m.display_name} est maintenant ${label.toLowerCase()}`, 'success');
    } catch (err) { select.value = m.role; toastError(err); }
  });
  return select;
}

/** Undo a mistaken "Professeur": back to a plain student account. */
async function backToStudent(m) {
  const ok = await confirmDialog(`Repasser ${m.display_name} en élève ?`,
    `${m.display_name} perdra l'accès à la salle des profs et aux résultats des autres élèves, et retrouvera le canal de la classe.`, { label: 'Repasser élève' });
  if (!ok) return;
  try { await updateDoc(userRef(m.id), { role: 'student', principal: false, trusted: false }); toast(`${m.display_name} est de nouveau élève`, 'success'); }
  catch (err) { toastError(err); }
}

async function togglePrincipal(m) {
  const on = !m.principal;
  const ok = await confirmDialog(on ? `Nommer ${m.display_name} prof principal ?` : 'Retirer le rôle de prof principal ?',
    on ? `${m.display_name} recevra TOUS les signalements de harcèlement de la classe, y compris ceux du canal des élèves (uniquement les messages signalés et leur contexte).`
      : `${m.display_name} ne recevra plus les signalements du canal des élèves.`, { danger: !on });
  if (!ok) return;
  try { await updateDoc(userRef(m.id), { principal: on }); toast(on ? 'Prof principal nommé 🎓' : 'Rôle retiré', 'success'); }
  catch (err) { toastError(err); }
}
