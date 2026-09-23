import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, terminate, clearIndexedDbPersistence,
  doc, collection,
} from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { FIREBASE_CONFIG, RECAPTCHA_SITE_KEY } from './config.js';

export const configured = Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
const app = configured ? initializeApp(FIREBASE_CONFIG) : null;
export const firebaseApp = app;

// Anti-abuse: App Check proves requests come from this site, not from a script reusing the API key.
// Only on the real site: reCAPTCHA keys are tied to the published domain (local tests would be rejected).
if (app && RECAPTCHA_SITE_KEY && !/^(localhost|127\.)/.test(location.hostname)) {
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
}

export const auth = app ? getAuth(app) : null;
// Offline mode: Firestore keeps what was already loaded (messages stay encrypted on the device) and queues what
// is sent without network. Falls back to the memory cache where IndexedDB is unavailable (private browsing…).
function makeDb() {
  try { return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch { return getFirestore(app); }
}
export const db = app ? makeDb() : null;
/** Logout: erase the offline copy of the class from this device. */
export async function clearOfflineData() {
  if (!db) return;
  try { await terminate(db); await clearIndexedDbPersistence(db); } catch { /* another tab still uses it */ }
}
export const rtdb = app && FIREBASE_CONFIG.databaseURL ? getDatabase(app) : null;

/** Google Analytics (via Firebase) — only called after the visitor accepts cookies. */
export async function startAnalytics() {
  if (!app || !FIREBASE_CONFIG.measurementId) return;
  const { getAnalytics, isSupported } = await import('firebase/analytics');
  if (await isSupported()) getAnalytics(app);
}

// Accounts without an e-mail get a synthetic, never-mailed address.
const SYNTH_DOMAIN = 'users.classconnect.app';
export const synthEmail = (username) => `${username.toLowerCase()}@${SYNTH_DOMAIN}`;
export const isSynthetic = (email) => email.endsWith('@' + SYNTH_DOMAIN);

// ---- paths
export const userRef = (uid) => doc(db, 'users', uid);
export const classRef = (cid) => doc(db, 'classes', cid);
export const sub = (cid, name, ...ids) => (ids.length ? doc(db, 'classes', cid, name, ...ids) : collection(db, 'classes', cid, name));

/** Firestore snapshot → plain object with `id` and timestamps as milliseconds. */
export function plain(snap) {
  const d = snap.data({ serverTimestamps: 'estimate' }) || {};
  for (const k of Object.keys(d)) if (d[k] && typeof d[k].toMillis === 'function') d[k] = d[k].toMillis();
  return { id: snap.id, ...d };
}

const MESSAGES = {
  'auth/invalid-credential': 'Identifiant ou mot de passe incorrect',
  'auth/wrong-password': 'Identifiant ou mot de passe incorrect',
  'auth/user-not-found': 'Identifiant ou mot de passe incorrect',
  'auth/invalid-login-credentials': 'Identifiant ou mot de passe incorrect',
  'auth/email-already-in-use': 'Cette adresse e-mail est déjà utilisée par un autre compte',
  'auth/invalid-email': 'Adresse e-mail invalide',
  'auth/too-many-requests': 'Trop de tentatives, réessaie dans quelques minutes',
  'auth/network-request-failed': 'Connexion impossible, vérifie ton réseau',
  'auth/operation-not-allowed': 'Active « E-mail/Mot de passe » dans Firebase Authentication (voir README)',
  'auth/requires-recent-login': 'Reconnecte-toi puis réessaie',
  'auth/firebase-app-check-token-is-invalid': 'Vérification anti-robot échouée, recharge la page',
  'permission-denied': 'Action non autorisée',
  'unavailable': 'Serveur injoignable, vérifie ta connexion',
  'resource-exhausted': 'Quota gratuit Firebase atteint pour aujourd\'hui',
  'failed-precondition': 'Base de données non initialisée (voir README)',
};
export function friendly(err) {
  if (!err) return 'Erreur inconnue';
  return MESSAGES[err.code] || err.message || String(err);
}
