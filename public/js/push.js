// Push notifications when the app is closed: this device's Firebase Cloud Messaging token is stored in
// push_tokens/{sha256(token)}; the "pushOnMessage" Cloud Function notifies the class members' devices.
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, firebaseApp, auth } from './fb.js';

const TOKEN_DOC = 'cc-push-doc';
let messaging = null;

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getMessagingIfSupported() {
  if (messaging) return messaging;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !firebaseApp) return null;
  const { getMessaging, isSupported } = await import('firebase/messaging');
  if (!(await isSupported())) return null;
  messaging = getMessaging(firebaseApp);
  return messaging;
}

/** Registers (or refreshes) this device. Returns false when the browser can't receive push messages. */
export async function enablePush() {
  const m = await getMessagingIfSupported();
  const user = auth.currentUser;
  if (!m || !user || Notification.permission !== 'granted') return false;
  const { getToken } = await import('firebase/messaging');
  const reg = await navigator.serviceWorker.ready;
  const token = await getToken(m, { serviceWorkerRegistration: reg });
  if (!token) return false;
  const id = await sha256(token);
  await setDoc(doc(db, 'push_tokens', id), { uid: user.uid, token, updated_at: serverTimestamp() });
  try {
    const prev = localStorage.getItem(TOKEN_DOC);
    if (prev && prev !== id) await deleteDoc(doc(db, 'push_tokens', prev)).catch(() => {});
    localStorage.setItem(TOKEN_DOC, id);
  } catch { /* ignore */ }
  return true;
}

/** Stops push on this device (notifications turned off, or logout). */
export async function disablePush() {
  let id = null;
  try { id = localStorage.getItem(TOKEN_DOC); localStorage.removeItem(TOKEN_DOC); } catch { /* ignore */ }
  if (id && auth.currentUser) await deleteDoc(doc(db, 'push_tokens', id)).catch(() => {});
  const m = await getMessagingIfSupported().catch(() => null);
  if (m) {
    const { deleteToken } = await import('firebase/messaging');
    await deleteToken(m).catch(() => {});
  }
}
