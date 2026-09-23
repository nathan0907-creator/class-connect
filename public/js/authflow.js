// Single-CTA authentication "mission":
//   1. one field (pseudo or e-mail) + « Décoller » → the rocket lifts off, the pseudo is loaded on board
//   2a. known pilot → password (+ forgot password) → landing on Mars « Connexion en cours »
//   2b. new pseudo  → password + optional e-mail   → landing on Mars « Compte créé ! »
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updatePassword, sendPasswordResetEmail, deleteUser, signOut,
} from 'firebase/auth';
import { doc, getDoc, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { auth, db, synthEmail, isSynthetic, friendly } from './fb.js';
import { deriveAuthKey, createIdentity, unlockIdentity, storePrivateKey } from './crypto.js';
import { resetIdentity } from './keyring.js';
import { state } from './state.js';
import { $, $$, h, toast } from './ui.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COLORS = ['#7c5cff', '#00d4ff', '#ff4fd8', '#ffb547', '#3dffa8', '#ff6b6b', '#5b8cff', '#c77dff'];

// ------------------------------------------------------------ stage (rocket, Earth, Mars)
export class Stage {
  constructor(el) {
    this.el = el;
    this.rocket = $('.rocket-wrap', el);
    this.earth = $('.earth-ground', el);
    this.mars = $('.mars-ground', el);
    this.caption = $('.stage-caption', el);
    this.burstEl = $('.burst', el);
    this.reset();
  }
  set(cls, on = true) { this.el.classList.toggle(cls, on); }
  thrust(v) { this.el.style.setProperty('--thrust', v); }
  say(text) {
    this.caption.classList.remove('show');
    void this.caption.offsetWidth;
    this.caption.textContent = text || '';
    if (text) this.caption.classList.add('show');
  }
  move(el, from, to, duration, easing) {
    return el.animate([{ transform: `translateY(${from}px)` }, { transform: `translateY(${to}px)` }],
      { duration: reduced ? 1 : duration, easing, fill: 'forwards' }).finished.catch(() => {});
  }
  reset() {
    for (const el of [this.rocket, this.earth, this.mars]) el.getAnimations().forEach((a) => a.cancel());
    this.el.className = 'stage idle';
    this.thrust(0);
    this.say('Prêt au décollage');
  }
  async launch(text) {
    this.set('idle', false);
    this.say('Allumage des moteurs…');
    this.thrust(0.45);
    this.set('smoking');
    this.set('shake');
    state.space?.pulse?.();
    await wait(reduced ? 0 : 750);
    this.say(text);
    this.thrust(1.25);
    this.set('streak');
    const up = this.move(this.rocket, 0, -300, 1300, 'cubic-bezier(.5,0,.9,.4)');
    this.move(this.earth, 0, 240, 1500, 'cubic-bezier(.5,0,.8,.5)');
    await wait(reduced ? 0 : 450);
    this.set('smoking', false);
    this.set('shake', false);
    await up;
    this.thrust(0);
    this.set('streak', false);
    this.set('cruise');
    this.say('En orbite');
  }
  async backToPad() {
    this.set('cruise', false);
    this.say('Retour à la base');
    this.thrust(0.8);
    this.move(this.earth, 240, 0, 1100, 'cubic-bezier(.2,.6,.3,1)');
    await this.move(this.rocket, -300, 0, 1500, 'cubic-bezier(.15,.7,.3,1)');
    this.thrust(0);
    this.set('smoking');
    await wait(reduced ? 0 : 450);
    this.set('smoking', false);
    this.set('idle');
    this.say('Prêt au décollage');
  }
  async descend(text) {
    this.set('cruise', false);
    this.say(text);
    this.move(this.mars, 240, 0, 1200, 'cubic-bezier(.2,.7,.3,1)');
    this.thrust(1);
    await this.move(this.rocket, -300, -48, 1700, 'cubic-bezier(.12,.75,.35,1)');
    this.thrust(0.55);
    this.set('hovering');
  }
  async touchdown(text) {
    this.set('hovering', false);
    this.thrust(0.4);
    await this.move(this.rocket, -48, 0, 750, 'cubic-bezier(.4,0,.2,1)');
    this.thrust(0);
    this.set('dusting');
    this.set('landed');
    this.set('success');
    this.say(text);
    this.burst();
    state.space?.pulse?.();
    await wait(reduced ? 300 : 1900);
  }
  async abort() {
    this.set('hovering', false);
    this.say('Atterrissage annulé');
    this.thrust(1.25);
    this.move(this.mars, 0, 240, 1000, 'ease-in');
    await this.move(this.rocket, -48, -300, 900, 'cubic-bezier(.5,0,.9,.4)');
    this.thrust(0);
    this.set('cruise');
    this.say('En orbite');
  }
  burst() {
    if (reduced) return;
    const colors = ['#3dffa8', '#00d4ff', '#ffcf6b', '#ff4fd8', '#ffffff'];
    for (let i = 0; i < 28; i++) {
      const p = h('i', { style: { background: colors[i % colors.length] } });
      this.burstEl.append(p);
      const a = (i / 28) * Math.PI * 2 + Math.random() * 0.3;
      const d = 50 + Math.random() * 80;
      p.animate([
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d * 0.7}px) scale(0)`, opacity: 0 },
      ], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.1,.8,.3,1)' }).finished.then(() => p.remove());
    }
  }
}

// ------------------------------------------------------------ account operations
async function lookup(identifier) {
  if (identifier.includes('@')) {
    if (!EMAIL_RE.test(identifier)) throw new Error('Adresse e-mail invalide');
    const email = identifier.toLowerCase();
    // Accounts register their e-mail in /emails so the site knows whether to log in or sign up.
    const known = await getDoc(doc(db, 'emails', email)).then((s) => s.exists()).catch(() => false);
    return known
      ? { mode: 'login', authEmail: email, label: identifier }
      : { mode: 'register', email, username: null, label: identifier };
  }
  if (!USERNAME_RE.test(identifier)) throw new Error('Pseudo : 3 à 24 caractères (lettres, chiffres, _ . -)');
  const snap = await getDoc(doc(db, 'usernames', identifier.toLowerCase()));
  return snap.exists()
    ? { mode: 'login', authEmail: snap.get('email'), label: identifier }
    : { mode: 'register', username: identifier, label: identifier };
}

async function createAccount({ username, password, email }) {
  const authEmail = (email || synthEmail(username)).toLowerCase();
  const [authKey, identity] = await Promise.all([deriveAuthKey(authEmail, password), createIdentity(password)]);
  const cred = await createUserWithEmailAndPassword(auth, authEmail, authKey);
  const uid = cred.user.uid;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'usernames', username.toLowerCase()), { uid, email: authEmail });
    batch.set(doc(db, 'users', uid), {
      username: username.toLowerCase(), display_name: username, color: COLORS[Math.floor(Math.random() * COLORS.length)],
      public_key: identity.publicKey, class_id: null, role: 'student', status: 'none', created_at: serverTimestamp(),
    });
    batch.set(doc(db, 'private', uid), { enc_salt: identity.encSalt, enc_private_key: identity.encPrivateKey, priv_iv: identity.privIv });
    await batch.commit();
  } catch (err) {
    await deleteUser(cred.user).catch(() => {});
    throw err.code === 'permission-denied' ? new Error('Ce pseudo vient d\'être pris, choisis-en un autre') : err;
  }
  if (!isSynthetic(authEmail)) await setDoc(doc(db, 'emails', authEmail), { uid }).catch(() => {});
  state.privateKey = identity.privateKey;
  await storePrivateKey(uid, identity.privateKey);
}

/**
 * Signs in with the password-derived key. If that fails, the password may have been reset by
 * e-mail (Firebase then stores the raw password): accept it once, re-harden it and regenerate keys.
 */
async function signIn(authEmail, password) {
  const derived = await deriveAuthKey(authEmail, password);
  let cred;
  let wasReset = false;
  try {
    cred = await signInWithEmailAndPassword(auth, authEmail, derived);
  } catch (err) {
    if (!['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(err.code)) throw err;
    try {
      cred = await signInWithEmailAndPassword(auth, authEmail, password);
    } catch { throw err; }
    await updatePassword(cred.user, derived);
    wasReset = true;
  }
  const uid = cred.user.uid;
  // Accounts created before the e-mail index existed get registered on their next login.
  if (!isSynthetic(authEmail)) setDoc(doc(db, 'emails', authEmail), { uid }).catch(() => {});
  const priv = await getDoc(doc(db, 'private', uid));
  if (wasReset || !priv.exists()) {
    await resetIdentity(uid, password);
    return { reset: true };
  }
  try {
    state.privateKey = await unlockIdentity(password, priv.data());
  } catch {
    throw new Error('Impossible de déchiffrer tes clés avec ce mot de passe');
  }
  await storePrivateKey(uid, state.privateKey);
  return { reset: false };
}

const maskEmail = (e) => e.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => a + '•'.repeat(Math.min(b.length, 6)) + c);

// ------------------------------------------------------------ UI flow
export function initAuthFlow({ onSuccess }) {
  const card = $('.auth-card');
  const stage = new Stage($('.stage', card));
  const forms = Object.fromEntries($$('[data-step]', card).map((f) => [f.dataset.step, f]));
  const errorEl = $('.form-error', card);
  const infoEl = $('.form-info', card);
  let ctx = {};
  let current = 'id';
  let shownAt = Date.now();
  let failures = 0;
  let lockedUntil = 0;

  const error = (msg) => {
    infoEl.textContent = '';
    errorEl.textContent = msg || '';
    if (msg) { errorEl.classList.remove('shake'); void errorEl.offsetWidth; errorEl.classList.add('shake'); }
  };
  const info = (msg) => { errorEl.textContent = ''; infoEl.textContent = msg || ''; };
  const lock = (on) => card.classList.toggle('locked', on);

  function go(name, { back = false } = {}) {
    for (const [key, f] of Object.entries(forms)) {
      f.classList.toggle('active', key === name);
      f.classList.toggle('from-back', key === name && back);
    }
    current = name;
    shownAt = Date.now();
    const focus = forms[name].querySelector('input:not([type=hidden]):not(.sr-only):not([tabindex="-1"])');
    if (focus) setTimeout(() => focus.focus(), 250);
  }

  /** The typed pseudo flies into the rocket and vanishes. */
  function cargo(input) {
    if (reduced || !input.value) return Promise.resolve();
    const from = input.getBoundingClientRect();
    const to = stage.rocket.getBoundingClientRect();
    const tag = h('div.cargo', input.value);
    document.body.append(tag);
    Object.assign(tag.style, { left: from.left + 12 + 'px', top: from.top + from.height / 2 - 16 + 'px' });
    const dx = to.left + to.width / 2 - (from.left + 12) - 30;
    const dy = to.top + to.height * 0.4 - (from.top + from.height / 2);
    input.classList.add('vanish');
    return tag.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1, filter: 'blur(0)' },
      { transform: `translate(${dx * 0.6}px, ${dy * 0.5 - 30}px) scale(.8)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.1)`, opacity: 0, filter: 'blur(2px)' },
    ], { duration: 800, easing: 'cubic-bezier(.4,0,.2,1)' }).finished.then(() => tag.remove());
  }

  const botLike = (form) => form.elements.website?.value || Date.now() - shownAt < 800;

  // Step 1 — pseudo or e-mail
  forms.id.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = forms.id.elements.identifier;
    const value = input.value.trim();
    if (!value) return error('Entre ton pseudo ou ton adresse e-mail');
    if (botLike(forms.id)) return error('Doucement, pilote… réessaie.');
    error('');
    lock(true);
    try {
      ctx = await lookup(value);
    } catch (err) {
      lock(false);
      return error(friendly(err));
    }
    const target = ctx.mode === 'login' ? 'login-pass' : 'reg-pass';
    const pass = forms[target];
    pass.elements.username.value = ctx.mode === 'login' ? ctx.label : (ctx.username || ctx.email).toLowerCase();
    $('[data-pilot]', pass).textContent = ctx.label;
    if (ctx.mode === 'register') {
      // Started with an e-mail → ask for a pseudo; started with a pseudo → offer the optional e-mail.
      $('[data-only="pseudo"]', pass).hidden = !!ctx.username;
      $('[data-only="email"]', pass).hidden = !!ctx.email;
      $('[data-back]', pass).textContent = ctx.username ? '← Changer de pseudo' : '← Changer d\'adresse';
    }
    await Promise.all([cargo(input), stage.launch(ctx.mode === 'login' ? 'Décollage !' : 'Nouveau pilote : décollage !')]);
    input.classList.remove('vanish');
    lock(false);
    go(target);
  });

  // Back to step 1: the rocket returns to its pad and the pseudo reappears.
  $$('[data-back]', card).forEach((b) => b.addEventListener('click', async () => {
    if (card.classList.contains('locked')) return;
    error('');
    info('');
    lock(true);
    go('id', { back: true });
    forms.id.elements.identifier.classList.add('reappear');
    await stage.backToPad();
    forms.id.elements.identifier.classList.remove('reappear');
    lock(false);
  }));

  // Password strength meter
  const regPass = forms['reg-pass'];
  const loginPass = forms['login-pass'];
  regPass.elements.password.addEventListener('input', () => {
    const p = regPass.elements.password.value;
    const score = [p.length >= 8, p.length >= 12, /[A-Z]/.test(p) && /[a-z]/.test(p), /\d/.test(p), /[^A-Za-z0-9]/.test(p)].filter(Boolean).length;
    const bar = $('.strength', regPass);
    bar.style.setProperty('--s', score / 5);
    bar.dataset.level = score <= 2 ? 'weak' : score <= 3 ? 'ok' : 'strong';
    $('.strength-label', regPass).textContent = p ? ['Très faible', 'Faible', 'Faible', 'Correct', 'Solide', 'Excellent'][score] : '';
  });

  /** Mars landing while `task` runs; aborts back to `step` on failure. Resolves true on success. */
  async function land(task, { descending, success, busyText, step, onError }) {
    state.authFlowBusy = true;
    go('busy');
    $('.busy-text', card).textContent = busyText;
    lock(true);
    const result = task.then((v) => ({ ok: true, v }), (err) => ({ ok: false, err }));
    await stage.descend(descending);
    const r = await result;
    if (r.ok) {
      await stage.touchdown(success);
      state.authFlowBusy = false;
      lock(false);
      await onSuccess(r.v);
      return true;
    }
    if (auth.currentUser) await signOut(auth).catch(() => {});
    state.authFlowBusy = false;
    await stage.abort();
    lock(false);
    if (onError?.(r.err)) return false;
    go(step, { back: true });
    error(friendly(r.err));
    return false;
  }

  /** Switches to the password step for an existing account (e.g. e-mail already registered). */
  function toLogin(authEmail, label, message) {
    ctx = { mode: 'login', authEmail, label };
    loginPass.elements.username.value = label;
    $('[data-pilot]', loginPass).textContent = label;
    go('login-pass', { back: true });
    info(message);
  }

  // Step 2b — new account
  regPass.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = regPass.elements;
    if (botLike(regPass)) return error('Doucement, pilote… réessaie.');
    const username = ctx.username || f.pseudo.value.trim();
    if (!USERNAME_RE.test(username)) return error('Pseudo : 3 à 24 caractères (lettres, chiffres, _ . -)');
    if (f.password.value.length < 8) return error('Mot de passe : 8 caractères minimum');
    if (f.password.value !== f.confirm.value) return error('Les mots de passe ne correspondent pas');
    const email = ctx.email || f.email.value.trim();
    if (email && !EMAIL_RE.test(email)) return error('Adresse e-mail invalide');
    if (!f.terms.checked) return error('Accepte les CGU et la politique de confidentialité pour continuer');
    if (!ctx.username) {
      const taken = await getDoc(doc(db, 'usernames', username.toLowerCase())).then((s) => s.exists()).catch(() => false);
      if (taken) return error(`Le pseudo « ${username} » est déjà pris, choisis-en un autre`);
    }
    error('');
    const ok = await land(createAccount({ username, password: f.password.value, email }), {
      descending: 'Cap sur Mars…', success: 'Compte créé !', busyText: 'Création du compte…', step: 'reg-pass',
      onError: (err) => {
        if (err.code !== 'auth/email-already-in-use') return false;
        toLogin(email.toLowerCase(), email, 'Un compte existe déjà avec cette adresse : entre ton mot de passe pour te connecter.');
        return true;
      },
    });
    if (ok) regPass.reset();
  });

  // Step 2a — login
  loginPass.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = loginPass.elements.password.value;
    if (!pw) return error('Entre ton mot de passe');
    if (Date.now() < lockedUntil) return error(`Trop d'essais. Réessaie dans ${Math.ceil((lockedUntil - Date.now()) / 1000)} s.`);
    error('');
    const task = signIn(ctx.authEmail, pw).catch((err) => {
      if (++failures >= 5) { lockedUntil = Date.now() + 30_000; failures = 0; }
      throw err;
    });
    const ok = await land(task, {
      descending: 'Connexion en cours…', success: 'Connexion réussie', busyText: 'Connexion en cours…', step: 'login-pass',
    });
    if (ok) loginPass.reset();
  });

  // Forgot password
  const forgotBtn = $('[data-forgot]', card);
  forgotBtn.addEventListener('click', async () => {
    if (!ctx.authEmail || isSynthetic(ctx.authEmail)) {
      return error('Aucune adresse e-mail n\'est liée à ce compte : le mot de passe ne peut pas être réinitialisé.');
    }
    forgotBtn.disabled = true;
    forgotBtn.textContent = 'Envoi en cours…';
    try {
      await sendPasswordResetEmail(auth, ctx.authEmail);
      const msg = `📧 E-mail envoyé à ${maskEmail(ctx.authEmail)} ! Ouvre le lien reçu (regarde aussi dans les spams), choisis un nouveau mot de passe puis reviens te connecter ici.`;
      info(msg);
      toast(msg, 'success', 9000);
    } catch (err) {
      error(friendly(err));
    } finally {
      forgotBtn.disabled = false;
      forgotBtn.textContent = 'Mot de passe oublié ?';
    }
  });

  return {
    reset() { stage.reset(); go('id'); error(''); info(''); ctx = {}; },
    get busy() { return current === 'busy'; },
  };
}
