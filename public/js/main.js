import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, getDocs, onSnapshot, query, where, collection, writeBatch, updateDoc, serverTimestamp } from 'firebase/firestore';
import { configured, auth, db, userRef, classRef, sub, plain, friendly, startAnalytics } from './fb.js';
import { state, emit, on, isDelegate } from './state.js';
import { unlockIdentity, storePrivateKey, loadPrivateKey, clearKeys } from './crypto.js';
import { loadKeys, shareNeeded, currentKey } from './keyring.js';
import { initAuthFlow } from './authflow.js';
import { initChat, startChat, stopChat, purgeExpired } from './chat.js';
import { startModeration, stopModeration } from './moderation.js';
import { initTimetable, startSlots, stopSlots } from './timetable.js';
import { initVotes, startProposals, stopProposals } from './votes.js';
import { initMembers, inviteCode } from './members.js';
import { startPresence, stopPresence } from './presence.js';
import { initConsent } from './consent.js';
import { $, $$, h, toast, toastError, enableTilt, busy, avatar } from './ui.js';

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
  $$('[data-me-role]').forEach((el) => { el.textContent = isDelegate() ? '★ Délégué' : 'Élève'; });
  $$('[data-me-avatar]').forEach((el) => {
    const next = avatar(me, 38);
    next.dataset.meAvatar = '';
    el.replaceWith(next);
  });
  $$('[data-class-name]').forEach((el) => { el.textContent = state.cls?.name || ''; });
  document.body.classList.toggle('is-delegate', isDelegate());
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
  stopClass();
  stopMe();
  try { await signOut(auth); } catch { /* offline */ }
  await clearKeys();
  location.reload();
}

// ------------------------------------------------------------ class selection
function bindClassForms() {
  const join = $('#form-join');
  join.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = join.querySelector('[type=submit]');
    const code = join.elements.inviteCode.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return formError(join, 'Le code ressemble à ABCD-EFGH');
    busy(btn, true);
    try {
      const invite = await getDoc(doc(db, 'invites', code));
      if (!invite.exists()) throw new Error('Code d\'invitation inconnu');
      await updateDoc(userRef(state.me.id), { class_id: invite.get('class_id'), status: 'pending', role: 'student', invite_code: code });
      join.reset();
      formError(join, '');
      await route();
    } catch (err) { formError(join, friendly(err)); }
    finally { busy(btn, false); }
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

    if (!state.cls || state.me.status === 'none') { stopClass(); return show('class'); }
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
        toast(after.role === 'delegate' ? 'Tu es maintenant délégué ⭐' : 'Tu n\'es plus délégué');
      }
      route();
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
  if (isDelegate()) {
    startModeration();
    purgeExpired().catch(() => {});
  } else {
    stopModeration();
  }
  show('app');
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
    state.members = new Map(snap.docs.map((d) => [d.id, plain(d)]));
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
  startProposals();
  startPresence(cid);
  return membersReady;
}

function stopClass() {
  classUnsubs.forEach((u) => u());
  classUnsubs = [];
  stopChat();
  stopSlots();
  stopProposals();
  stopPresence();
  stopModeration();
  liveClassId = null;
}

// ------------------------------------------------------------ boot
async function boot() {
  initConsent({ onGranted: startAnalytics });
  // The 3D scene is loaded after the UI so the first paint stays fast; a stub stands in meanwhile.
  state.space = { mode: 'auth', setMode(m) { this.mode = m; }, warpJump: () => Promise.resolve(), pulse() {} };
  const startSpace = () => import('./space.js').then(({ createSpace }) => {
    const space = createSpace($('#space'));
    space.setMode(state.space.mode);
    state.space = space;
    document.body.classList.add('space-ready');
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

  $$('.nav-item').forEach((b) => b.addEventListener('click', () => showPanel(b.dataset.panel)));
  on('goto', showPanel);
  on('reroute', route);
  on('keys', updateE2EEStatus);

  onAuthStateChanged(auth, () => {
    if (state.authFlowBusy) return;
    route();
  });
}

boot();
