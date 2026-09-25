import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, getDocs, onSnapshot, query, where, collection, writeBatch, updateDoc, serverTimestamp } from 'firebase/firestore';
import { configured, auth, db, userRef, classRef, sub, plain, friendly, startAnalytics, clearOfflineData } from './fb.js';
import { state, emit, on, isDelegate, isDeputy, isTeacher, isPrincipal, canPublish } from './state.js';
import { unlockIdentity, storePrivateKey, loadPrivateKey, clearKeys } from './crypto.js';
import { loadKeys, shareNeeded, currentKey } from './keyring.js';
import { initAuthFlow } from './authflow.js';
import { initChat, startChat, stopAllChat, purgeExpired } from './chat.js';
import { startModeration, stopModeration } from './moderation.js';
import { initStudy, startStudy, stopStudy } from './study.js';
import { initCouncil, startCouncil, stopCouncil } from './council.js';
import { captureInvite, pendingInvite, clearInvite } from './invite.js';
import { initTimetable, startSlots, stopSlots } from './timetable.js';
import { initVotes, startProposals, stopProposals } from './votes.js';
import { initMembers, inviteCode } from './members.js';
import { startPresence, stopPresence } from './presence.js';
import { initConsent } from './consent.js';
import { initNotify, syncPush, stopPush } from './notify.js';
import { initInstall } from './install.js';
import { initGuide } from './guide.js';
import { initProfiles, startProfiles, stopProfiles } from './profiles.js';
import { initEvents, startEvents, stopEvents } from './events.js';
import { initTheme, applyTheme } from './theme.js';
import { applyQualityClass } from './quality.js';
import { initDM, startDM, stopDM, bindDMComposer } from './dm.js';
import { initLife, startLife, stopLife } from './life.js';
import { startSettings, stopSettings } from './admin.js';
import { initDisplay } from './display.js';
import { initCosmos } from './cosmos.js';
import { initSecurity, startDevice, stopDevice, forgetDevice } from './security.js';
import { initShortcuts } from './shortcuts.js';
import { initShare } from './share.js';
import { $, $$, h, toast, toastError, enableTilt, busy, avatar } from './ui.js';
import { safeColor } from './safe.js';

let authFlow = null;
let meUnsub = null;
let classUnsubs = [];
let liveClassId = null;
let routing = null;

// ------------------------------------------------------------ views
function show(view) {
  $$('.view').forEach((v) => {
    const active = v.id === `view-${view}`;
    v.classList.toggle('active', active);
    v.inert = !active;
  });
  state.space?.setMode(view === 'app' ? 'app' : view === 'auth' || view === 'setup' ? 'auth' : 'gate');
  document.body.dataset.view = view;
  enableTilt();
}

function showPanel(name) {
  $$('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.panel === name);
    b.setAttribute('aria-current', b.dataset.panel === name ? 'page' : 'false');
  });
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
  emit('panel', name);
}

function fillIdentity() {
  const me = state.me;
  $$('[data-me-name]').forEach((el) => { el.textContent = me?.display_name || ''; });
  $$('[data-me-role]').forEach((el) => {
    el.textContent = isPrincipal() ? '🎓 Prof principal' : isTeacher() ? '🎓 Professeur'
      : isDelegate() ? '★ Délégué' : isDeputy() ? '☆ Suppléant' : 'Élève';
  });
  $$('[data-me-avatar]').forEach((el) => {
    const next = avatar(me, 38);
    next.dataset.meAvatar = '';
    el.replaceWith(next);
  });
  $$('[data-class-name]').forEach((el) => { el.textContent = state.cls?.name || ''; });
  document.body.classList.toggle('is-delegate', isDelegate());
  document.body.classList.toggle('can-publish', canPublish());
  document.body.classList.toggle('is-teacher', isTeacher());
  emit('me');
}

function updateE2EEStatus() {
  const el = $('[data-e2ee]');
  if (!state.cls) return;
  const ok = !!currentKey();
  el.classList.toggle('waiting', !ok);
  el.querySelector('span').textContent = ok ? `Chiffré · clé n°${state.cls.key_epoch}` : 'En attente de la clé…';
}

function formError(form, msg) {
  const el = form.closest('.view').querySelector('.form-error');
  el.textContent = msg || '';
  if (msg) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
}

// ------------------------------------------------------------ unlock & logout
function bindUnlock() {
  const unlock = $('#form-unlock');
  unlock.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = unlock.querySelector('[type=submit]');
    busy(btn, true);
    try {
      const uid = auth.currentUser.uid;
      const priv = await getDoc(doc(db, 'private', uid));
      if (!priv.exists()) throw new Error('Clés introuvables sur le serveur');
      try { state.privateKey = await unlockIdentity(unlock.elements.password.value, priv.data()); }
      catch { throw new Error('Mot de passe incorrect'); }
      await storePrivateKey(uid, state.privateKey);
      unlock.reset();
      formError(unlock, '');
      await state.space.warpJump();
      await route();
    } catch (err) {
      formError(unlock, friendly(err));
    } finally { busy(btn, false); }
  });
  $$('[data-action="logout"]').forEach((b) => b.addEventListener('click', logout));
}

async function logout() {
  await forgetDevice();
  stopClass();
  stopMe();
  await stopPush();
  try { await signOut(auth); } catch { /* offline */ }
  await clearKeys();
  await clearOfflineData();
  location.reload();
}

// ------------------------------------------------------------ class selection
/** Sends a join request with an invite code (typed, or coming from an invitation link). */
async function joinWithCode(raw) {
  const join = $('#form-join');
  const btn = join.querySelector('[type=submit]');
  const code = String(raw || '').trim().toUpperCase();
  join.elements.inviteCode.value = code;
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return formError(join, 'Le code ressemble à ABCD-EFGH');
  busy(btn, true);
  try {
    const invite = await getDoc(doc(db, 'invites', code));
    if (!invite.exists()) throw new Error('Code d\'invitation inconnu ou expiré : demande un nouveau lien à ton délégué');
    const role = invite.get('role') === 'teacher' ? 'teacher' : 'student';
    await updateDoc(userRef(state.me.id), { class_id: invite.get('class_id'), status: 'pending', role, invite_code: code });
    clearInvite();
    toast(role === 'teacher' ? 'Code professeur reconnu 🎓 Le délégué doit valider ta demande.' : 'Demande envoyée ! Un délégué doit la valider 🚀', 'success', 6000);
    join.reset();
    formError(join, '');
    await route();
  } catch (err) {
    clearInvite();
    formError(join, friendly(err));
  } finally { busy(btn, false); }
}

function bindClassForms() {
  const join = $('#form-join');
  join.addEventListener('submit', (e) => {
    e.preventDefault();
    joinWithCode(join.elements.inviteCode.value);
  });

  const create = $('#form-create');
  create.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = create.querySelector('[type=submit]');
    const name = create.elements.name.value.trim();
    if (name.length < 2) return formError(create, 'Nom de classe trop court');
    busy(btn, true);
    try {
      const ref = doc(collection(db, 'classes'));
      const code = inviteCode();
      const batch = writeBatch(db);
      batch.set(ref, { name, invite_code: code, key_epoch: 1, created_by: state.me.id, created_at: serverTimestamp() });
      batch.set(doc(db, 'invites', code), { class_id: ref.id });
      batch.update(userRef(state.me.id), { class_id: ref.id, status: 'active', role: 'delegate' });
      await batch.commit();
      create.reset();
      formError(create, '');
      await state.space.warpJump();
      await route();
      toast('Classe créée ! Partage le code d\'invitation depuis le Poste du délégué ⭐', 'success', 6000);
    } catch (err) { formError(create, friendly(err)); }
    finally { busy(btn, false); }
  });
}

// ------------------------------------------------------------ routing
async function route() {
  if (routing) return routing;
  routing = (async () => {
    const user = auth.currentUser;
    if (!user) { stopClass(); stopMe(); authFlow?.reset(); return show('auth'); }

    const meSnap = await getDoc(userRef(user.uid));
    if (!meSnap.exists()) {
      await signOut(auth);
      toast('Profil incomplet : recommence l\'inscription', 'error');
      return show('auth');
    }
    state.me = plain(meSnap);
    if (!state.privateKey) state.privateKey = await loadPrivateKey(user.uid);
    watchMe();
    if (!state.privateKey) { fillIdentity(); return show('unlock'); }

    state.cls = null;
    if (state.me.class_id) {
      const cs = await getDoc(classRef(state.me.class_id)).catch(() => null);
      if (cs?.exists()) state.cls = plain(cs);
    }
    fillIdentity();

    if (!state.cls || state.me.status === 'none') {
      stopClass();
      show('class');
      // Arrived through an invitation link: send the join request straight away.
      const invited = pendingInvite();
      if (invited) setTimeout(() => joinWithCode(invited), 600);
      return;
    }
    if (pendingInvite()) {
      clearInvite();
      toast('Tu fais déjà partie d\'une classe : quitte-la d\'abord pour utiliser une autre invitation.', 'info', 7000);
    }
    if (state.me.status === 'pending') {
      stopClass();
      const members = (await getDocs(query(collection(db, 'users'), where('class_id', '==', state.cls.id)))).docs.map(plain);
      const delegates = members.filter((m) => m.role === 'delegate' && m.status === 'active');
      $('[data-pending-delegates]').textContent = delegates.length
        ? `Délégué${delegates.length > 1 ? 's' : ''} : ${delegates.map((d) => d.display_name).join(', ')}` : '';
      return show('pending');
    }
    await enterApp();
  })().catch((err) => { toastError(err); }).finally(() => { routing = null; });
  return routing;
}

function watchMe() {
  if (meUnsub) return;
  meUnsub = onSnapshot(userRef(state.me.id), (snap) => {
    if (!snap.exists() || snap.metadata.hasPendingWrites) return;
    const before = state.me;
    const after = plain(snap);
    state.me = after;
    if (before.class_id !== after.class_id || before.status !== after.status || before.role !== after.role) {
      if (before.status === 'pending' && after.status === 'active') toast('Ta demande a été acceptée ! 🚀', 'success');
      if (before.class_id && !after.class_id && before.status !== 'none') toast('Tu ne fais plus partie de la classe', 'info');
      if (before.role !== after.role && after.status === 'active' && before.status === 'active') {
        toast({ delegate: 'Tu es maintenant délégué ⭐', deputy: 'Tu es maintenant suppléant ☆', student: 'Tu es maintenant élève (sans rôle particulier)' }[after.role] || 'Ton rôle a changé');
      }
      route();
    } else if (!!before.trusted !== !!after.trusted) {
      fillIdentity();
      toast(after.trusted ? 'Tu peux maintenant publier des cours pour l\'IA 📚' : 'Tu ne peux plus publier de cours');
    } else if (!!before.principal !== !!after.principal) {
      fillIdentity();
      startModeration();
      toast(after.principal ? 'Tu es prof principal : tu recevras tous les signalements 🎓' : 'Tu n\'es plus prof principal');
    }
  });
}
function stopMe() { meUnsub?.(); meUnsub = null; }

async function enterApp() {
  if (liveClassId !== state.cls.id) {
    stopClass();
    await startClass(state.cls.id);
  }
  fillIdentity();
  await loadKeys();
  updateE2EEStatus();
  shareNeeded();
  // Rights may have changed (e.g. promoted to delegate): refresh the role-dependent listeners.
  startCouncil();
  startProfiles();
  startDM();
  if (isDelegate() || isTeacher()) {
    startModeration();
    purgeExpired().catch(() => {});
  } else {
    stopModeration();
  }
  show('app');
  syncPush();
  startDevice();
  // Opened from a shortcut of the installed app (site.webmanifest): go to that tab once.
  const panel = new URLSearchParams(location.search).get('panel');
  if (panel && document.querySelector(`.nav-item[data-panel="${CSS.escape(panel)}"]`)) {
    showPanel(panel);
    history.replaceState(null, '', location.pathname + location.hash);
  }
  emit('app-ready');
}

function startClass(cid) {
  liveClassId = cid;
  state.classKeys.clear();
  let firstMembers;
  const membersReady = new Promise((r) => { firstMembers = r; });

  classUnsubs.push(onSnapshot(classRef(cid), (snap) => {
    if (!snap.exists()) return;
    const prevEpoch = state.cls?.key_epoch;
    state.cls = plain(snap);
    fillIdentity();
    emit('members');
    if (prevEpoch && prevEpoch !== state.cls.key_epoch) loadKeys().then(updateE2EEStatus);
  }));

  classUnsubs.push(onSnapshot(query(collection(db, 'users'), where('class_id', '==', cid)), (snap) => {
    // Colours end up in CSS: anything but "#rrggbb" is replaced (see safe.js).
    state.members = new Map(snap.docs.map((d) => { const m = plain(d); return [d.id, { ...m, color: safeColor(m.color) }]; }));
    emit('members');
    firstMembers();
    const someoneNew = snap.docChanges().some((c) => c.type !== 'removed' && c.doc.get('status') === 'active');
    if (someoneNew) shareNeeded();
  }, toastError));

  let firstShares = true;
  classUnsubs.push(onSnapshot(query(sub(cid, 'shares'), where('user_id', '==', state.me.id)), () => {
    if (firstShares) { firstShares = false; return; }
    loadKeys().then(updateE2EEStatus);
  }));

  startChat();
  startSlots();
  startEvents();
  startProposals();
  startStudy();
  startCouncil();
  startPresence(cid);
  startLife();
  startSettings();
  return membersReady;
}

function stopClass() {
  classUnsubs.forEach((u) => u());
  classUnsubs = [];
  stopAllChat();
  stopSlots();
  stopEvents();
  stopProposals();
  stopPresence();
  stopModeration();
  stopStudy();
  stopCouncil();
  stopProfiles();
  stopDM();
  stopLife();
  stopSettings();
  stopDevice();
  liveClassId = null;
}

// ------------------------------------------------------------ offline
function watchNetwork() {
  const update = () => {
    document.body.classList.toggle('offline', !navigator.onLine);
    $('[data-offline]').hidden = navigator.onLine;
  };
  window.addEventListener('online', () => { update(); toast('De retour en ligne 🛰️ Les messages en attente partent.', 'success'); });
  window.addEventListener('offline', () => { update(); toast('Hors ligne : tu peux relire la classe, tes messages partiront au retour du réseau.', 'info', 6000); });
  update();
}

// ------------------------------------------------------------ boot
async function boot() {
  initConsent({ onGranted: startAnalytics });
  applyQualityClass();
  initInstall();
  initGuide();
  initTheme();
  initDisplay();
  initShortcuts();
  initShare();
  watchNetwork();
  if (captureInvite()) {
    setTimeout(() => toast('✉️ Invitation reçue ! Connecte-toi ou crée ton compte : ta demande pour rejoindre la classe partira automatiquement.', 'info', 9000), 800);
  }
  // The 3D scene is loaded after the UI so the first paint stays fast; a stub stands in meanwhile.
  state.space = { mode: 'auth', setMode(m) { this.mode = m; }, warpJump: () => Promise.resolve(), pulse() {}, celebrate() {} };
  const startSpace = () => import('./space.js').then(({ createSpace }) => {
    const space = createSpace($('#space'));
    space.setMode(state.space.mode);
    state.space = space;
    applyTheme();
    document.body.classList.add('space-ready');
    emit('space-ready');
  }).catch((err) => console.warn('3D indisponible', err));
  if ('requestIdleCallback' in window) requestIdleCallback(startSpace, { timeout: 1200 }); else setTimeout(startSpace, 300);
  if (!configured) return show('setup');
  if (!window.isSecureContext || !crypto.subtle) {
    show('setup');
    $('#view-setup h2').textContent = 'Connexion sécurisée requise';
    $('#view-setup .setup-steps').replaceWith(h('p', 'Le chiffrement de bout en bout nécessite HTTPS. Ouvre le site via son adresse https://.'));
    return;
  }

  authFlow = initAuthFlow({
    onSuccess: async () => {
      await state.space.warpJump();
      await route();
    },
  });
  bindUnlock();
  bindClassForms();
  initChat();
  initTimetable();
  initVotes();
  initMembers();
  initStudy();
  initCouncil();
  initProfiles();
  initEvents();
  initDM();
  bindDMComposer();
  initLife();
  initNotify();
  initCosmos();
  initSecurity();

  $$('.nav-item').forEach((b) => b.addEventListener('click', () => showPanel(b.dataset.panel)));
  on('goto', showPanel);
  on('reroute', route);
  on('logout', logout);
  on('keys', updateE2EEStatus);
  on('profiles', fillIdentity);

  onAuthStateChanged(auth, () => {
    if (state.authFlowBusy) return;
    route();
  });
}

boot();
