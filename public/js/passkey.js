// Quick login with a passkey (fingerprint, face, PIN of the device) using the WebAuthn "PRF" extension.
// The device's authenticator derives a secret that never leaves it; that secret encrypts the password, kept
// encrypted on this device only. Logging in = unlocking the passkey → decrypting the password → normal login.
// Nothing is sent to any server: without this device AND its fingerprint/face/PIN, the stored blob is useless.
const KEY = 'cc-passkey';
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

export const passkeySupported = () => !!(window.PublicKeyCredential && window.isSecureContext && navigator.credentials);

export function savedPasskey() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null');
    return p && p.v === 1 && p.id && p.salt && p.iv && p.ct && p.authEmail ? p : null;
  } catch { return null; }
}
export function forgetPasskey() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

async function aesKey(secret) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('class-connect-passkey-v1'), info: enc.encode('password') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function prfSecret(id, salt) {
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: random(32), allowCredentials: [{ type: 'public-key', id }], userVerification: 'required', timeout: 60000,
    extensions: { prf: { eval: { first: salt } } },
  } });
  const out = cred?.getClientExtensionResults?.().prf?.results?.first;
  if (!out) throw new Error('Cet appareil ne permet pas la connexion rapide (extension PRF absente).');
  return out;
}

/** Creates the passkey on this device and stores the password encrypted with its secret. */
export async function enrollPasskey({ authEmail, label, password }) {
  if (!passkeySupported()) throw new Error('Ton navigateur ne gère pas les clés d\'accès.');
  const salt = random(32);
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: random(32),
    rp: { name: 'Class Connect', id: location.hostname },
    user: { id: random(16), name: label, displayName: label },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
    timeout: 60000,
    extensions: { prf: { eval: { first: salt } } },
  } });
  const ext = cred.getClientExtensionResults?.() || {};
  if (!ext.prf?.enabled && !ext.prf?.results?.first) {
    throw new Error('Cet appareil ou ce navigateur ne permet pas encore la connexion rapide (extension PRF absente). La clé créée ne sera pas utilisée.');
  }
  // Some authenticators only give the secret when the passkey is used: ask once more.
  const secret = ext.prf.results?.first || await prfSecret(cred.rawId, salt);
  const iv = random(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`passkey|${authEmail}`) },
    await aesKey(secret), enc.encode(JSON.stringify({ password })));
  localStorage.setItem(KEY, JSON.stringify({ v: 1, id: b64(cred.rawId), salt: b64(salt), iv: b64(iv), ct: b64(ct), authEmail, label }));
}

/** Asks for the fingerprint / face / PIN and gives back what the normal login needs. */
export async function unlockPasskey() {
  const p = savedPasskey();
  if (!p) throw new Error('Pas de connexion rapide sur cet appareil');
  const secret = await prfSecret(unb64(p.id), unb64(p.salt));
  let data;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv), additionalData: enc.encode(`passkey|${p.authEmail}`) }, await aesKey(secret), unb64(p.ct));
    data = JSON.parse(new TextDecoder().decode(plain));
  } catch { throw new Error('Clé d\'accès invalide : réactive la connexion rapide depuis « 🔐 Sécurité ».'); }
  return { authEmail: p.authEmail, label: p.label, password: data.password };
}

/** WebAuthn errors in plain French. */
export function passkeyError(err) {
  if (err?.name === 'NotAllowedError') return 'Connexion rapide annulée';
  if (err?.name === 'InvalidStateError') return 'Une clé existe déjà sur cet appareil';
  if (err?.name === 'SecurityError') return 'Connexion rapide impossible sur cette adresse';
  return err?.message || 'Connexion rapide impossible';
}
