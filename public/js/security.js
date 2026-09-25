// « 🔐 Sécurité » : connected devices (with remote logout), quick login with a passkey, quiet hours and the
// morning summary. Devices are listed in devices/{uid}_{deviceId}, readable only by their owner.
import { doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { db, plain, auth } from './fb.js';
import { state, emit } from './state.js';
import { $$, h, modal, toast, toastError, fmtDay, fmtTime, confirmDialog } from './ui.js';
import { unlockIdentity } from './crypto.js';
import { passkeySupported, savedPasskey, enrollPasskey, forgetPasskey, passkeyError } from './passkey.js';
import { pushPrefs, savePushPrefs } from './push.js';
import { notifyOn } from './notify.js';

const DEVICE_KEY = 'cc-device-id';
let unsub = null;
let leaving = false;

function localId() {
  let id = '';
  try { id = localStorage.getItem(DEVICE_KEY) || ''; } catch { /* ignore */ }
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(id)) {
    id = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    try { localStorage.setItem(DEVICE_KEY, id); } catch { /* ignore */ }
  }
  return id;
}
const myDeviceId = () => `${state.me.id}_${localId()}`;
const deviceRef = (id) => doc(db, 'devices', id);

/** "Chrome · Windows", "Safari · iPhone"… (only the kind of device, nothing that identifies it). */
export function deviceName(ua = navigator.userAgent) {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Appareil';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  const app = matchMedia('(display-mode: standalone)').matches ? ' (appli)' : '';
  return `${browser} · ${os}${app}`;
}

/** Registers this device and logs it out as soon as it is disconnected from another one. */
export async function startDevice() {
  stopDevice();
  const id = myDeviceId();
  try {
    const snap = await getDoc(deviceRef(id));
    if (!snap.exists()) {
      await setDoc(deviceRef(id), { uid: state.me.id, name: deviceName(), created_at: serverTimestamp(), last_seen: serverTimestamp(), revoked: false });
    } else if (snap.get('revoked')) {
      return kicked();
    } else if (Date.now() - (snap.get('last_seen')?.toMillis?.() || 0) > 3600e3 || snap.get('name') !== deviceName()) {
      await updateDoc(deviceRef(id), { last_seen: serverTimestamp(), name: deviceName() });
    }
  } catch { return; }   // offline: checked again next time
  let seen = false;
  unsub = onSnapshot(deviceRef(id), (snap) => {
    if (snap.exists()) seen = true;
    if (leaving || snap.metadata.hasPendingWrites) return;
    if ((snap.exists() && snap.get('revoked')) || (seen && !snap.exists() && !snap.metadata.fromCache)) kicked();
  }, () => {});
}
export function stopDevice() { unsub?.(); unsub = null; }

function kicked() {
  if (leaving) return;
  leaving = true;
  toast('Cet appareil a été déconnecté à distance 🔒', 'info', 8000);
  setTimeout(() => emit('logout'), 1200);
}

/** Called on logout: this device leaves the list. */
export async function forgetDevice() {
  leaving = true;
  stopDevice();
  if (state.me?.id && auth.currentUser) await deleteDoc(deviceRef(myDeviceId())).catch(() => {});
}

// ------------------------------------------------------------ the « 🔐 Sécurité » window
export function initSecurity() {
  $$('[data-action="security"]').forEach((b) => b.addEventListener('click', openSecurity));
}

export function openSecurity() {
  const devicesBox = h('div.device-list', h('div.spinner'));
  const passBox = h('div.passkey-box');
  const quietBox = quietSection();

  async function loadDevices() {
    try {
      const rows = (await getDocs(query(collection(db, 'devices'), where('uid', '==', state.me.id)))).docs.map(plain)
        .sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
      const mine = myDeviceId();
      const others = rows.filter((r) => r.id !== mine && !r.revoked);
      devicesBox.replaceChildren(
        ...rows.map((r) => h(`div.device-row${r.id === mine ? '.current' : ''}`,
          h('span.device-icon', /iPhone|Android|iPad/.test(r.name) ? '📱' : '💻'),
          h('div', h('b', r.name, r.id === mine ? h('span.dev-tag', 'cet appareil') : null),
            h('small.muted', r.revoked ? '⏳ Déconnexion dès qu\'il se reconnecte' : `Vu ${fmtDay(r.last_seen).toLowerCase()} à ${fmtTime(r.last_seen)} · ajouté le ${new Date(r.created_at).toLocaleDateString('fr-FR')}`)),
          r.id === mine ? null : r.revoked
            ? h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: async () => { await deleteDoc(deviceRef(r.id)).catch(toastError); loadDevices(); } }, 'Retirer')
            : h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => revoke([r]) }, 'Déconnecter'))),
        others.length > 1 ? h('button.btn.btn-danger.btn-sm', { type: 'button', onclick: () => revoke(others) }, `Déconnecter les ${others.length} autres appareils`) : null,
        h('p.hint.small', 'Un appareil déconnecté se déconnecte dès qu\'il revient en ligne. Si tu penses qu\'on connaît ton mot de passe, change-le aussi (« Mot de passe oublié ? » avec ton e-mail).'));
    } catch (err) { devicesBox.replaceChildren(h('p.muted.small', 'Liste indisponible')); toastError(err); }
  }
  async function revoke(list) {
    if (!(await confirmDialog(list.length > 1 ? `Déconnecter ${list.length} appareils ?` : `Déconnecter « ${list[0].name} » ?`,
      'Il faudra se reconnecter avec le mot de passe sur ces appareils.', { label: 'Déconnecter' }))) return;
    try { await Promise.all(list.map((r) => updateDoc(deviceRef(r.id), { revoked: true }))); toast('Déconnexion envoyée 🔒', 'success'); }
    catch (err) { toastError(err); }
    loadDevices();
  }

  function renderPasskey() {
    const saved = savedPasskey();
    if (!passkeySupported()) { passBox.replaceChildren(h('p.muted.small', 'Ton navigateur ne gère pas les clés d\'accès.')); return; }
    if (saved) {
      passBox.replaceChildren(h('p', `✅ Activée sur cet appareil pour « ${saved.label} ».`),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { forgetPasskey(); renderPasskey(); toast('Connexion rapide désactivée'); } }, 'Désactiver'));
      return;
    }
    const pw = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Mot de passe', placeholder: 'Ton mot de passe' });
    const btn = h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: async () => {
      if (!pw.value) return toast('Entre ton mot de passe', 'error');
      btn.disabled = true;
      try {
        // Checked locally: it must open this account's keys.
        const priv = await getDoc(doc(db, 'private', state.me.id));
        try { await unlockIdentity(pw.value, priv.data()); } catch { throw new Error('Mot de passe incorrect'); }
        await enrollPasskey({ authEmail: auth.currentUser.email, label: state.me.username || state.me.display_name, password: pw.value });
        pw.value = '';
        toast('Connexion rapide activée 🔑 La prochaine fois, touche « Connexion rapide ».', 'success', 6000);
        renderPasskey();
      } catch (err) { toast(passkeyError(err), 'error', 7000); }
      finally { btn.disabled = false; }
    } }, '🔑 Activer');
    passBox.replaceChildren(
      h('p.muted.small', 'Connecte-toi avec ton empreinte, ton visage ou le code de ton téléphone. Ton mot de passe est gardé chiffré sur cet appareil : seule ta clé d\'accès peut l\'ouvrir. Rien n\'est envoyé en ligne.'),
      h('div.row', pw, btn));
  }

  renderPasskey();
  loadDevices();
  modal({
    title: '🔐 Sécurité et appareils',
    wide: true,
    body: h('div.slot-form.security-form',
      h('h4', '📱 Appareils connectés'), devicesBox,
      h('h4', '🔑 Connexion rapide sur cet appareil'), passBox,
      h('h4', '🌙 Notifications'), quietBox),
  });
}

const toMin = (v) => { const [a, b] = String(v).split(':').map(Number); return a * 60 + b; };
const toHHMM = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

function quietSection() {
  const p = pushPrefs();
  const on = h('input', { type: 'checkbox', checked: !!p.quiet });
  const from = h('input', { type: 'time', value: toHHMM(p.quiet?.from ?? 1320), 'aria-label': 'Début' });
  const to = h('input', { type: 'time', value: toHHMM(p.quiet?.to ?? 420), 'aria-label': 'Fin' });
  const digest = h('input', { type: 'checkbox', checked: p.digest });
  const save = async () => {
    const next = { quiet: on.checked && from.value && to.value && from.value !== to.value ? { from: toMin(from.value), to: toMin(to.value) } : null, digest: digest.checked };
    try {
      const sent = await savePushPrefs(next);
      toast(sent ? 'Réglages enregistrés 🌙' : 'Enregistré : active les notifications sur cet appareil pour que ça compte', sent ? 'success' : 'info', 5000);
    } catch (err) { toastError(err); }
  };
  [on, from, to, digest].forEach((el) => el.addEventListener('change', save));
  return h('div',
    notifyOn() ? null : h('p.hint.small', 'Les notifications sont coupées sur cet appareil : ces réglages serviront quand tu les activeras.'),
    h('label.switch-row', on, h('span', h('b', 'Heures calmes'), h('small.muted', 'Aucune notification pendant cette plage (la nuit, en cours…)'))),
    h('div.row.quiet-range', h('label.field', h('span', 'De'), from), h('label.field', h('span', 'À'), to)),
    h('label.switch-row', digest, h('span', h('b', '☀️ Résumé du matin (7 h)'), h('small.muted', 'Tes cours du jour, les profs absents et les événements, en une notification'))));
}
