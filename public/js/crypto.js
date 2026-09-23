// End-to-end encryption primitives (Web Crypto API only).
//
//  • Password → PBKDF2 → two independent keys:
//      - authKey : sent to Supabase as the account password (the real password never leaves the device)
//      - encKey  : encrypts the user's ECDH private key, stored encrypted on the server
//  • Each class has a random AES-256-GCM key per "epoch". It is shared with each member
//    by wrapping it with ECDH(P-256) + HKDF between sender and recipient.
//  • Messages and files are encrypted with the class key; the server only stores ciphertext.

const subtle = crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();
const PBKDF2_ITERATIONS = 310_000;

export const toB64 = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

async function pbkdf2(password, salt) {
  const base = await subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  return subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, base, 256);
}

/** Password-equivalent sent to the auth server (hex, 64 chars), salted with the account e-mail. */
export async function deriveAuthKey(authEmail, password) {
  const bits = await pbkdf2(password, te.encode(`classconnect/auth/v1/${authEmail.toLowerCase()}`));
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveEncKey(password, salt) {
  const bits = await pbkdf2(password, salt);
  return subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Generates the user's identity key pair and encrypts the private half with the password. */
export async function createIdentity(password) {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const spki = await subtle.exportKey('spki', pair.publicKey);
  const pkcs8 = await subtle.exportKey('pkcs8', pair.privateKey);
  const salt = rand(16);
  const iv = rand(12);
  const encKey = await deriveEncKey(password, salt);
  const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, encKey, pkcs8);
  const privateKey = await subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  return {
    publicKey: toB64(spki),
    encSalt: toB64(salt),
    encPrivateKey: toB64(encrypted),
    privIv: toB64(iv),
    privateKey,
  };
}

/** Decrypts the stored private key. Throws if the password is wrong. */
export async function unlockIdentity(password, { enc_salt, enc_private_key, priv_iv }) {
  const encKey = await deriveEncKey(password, fromB64(enc_salt));
  const pkcs8 = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(priv_iv) }, encKey, fromB64(enc_private_key));
  return subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

const pubCache = new Map();
function importPublic(b64) {
  if (!pubCache.has(b64)) {
    pubCache.set(b64, subtle.importKey('spki', fromB64(b64), { name: 'ECDH', namedCurve: 'P-256' }, false, []));
  }
  return pubCache.get(b64);
}

async function pairKey(myPrivate, theirPublicB64, info) {
  const pub = await importPublic(theirPublicB64);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: pub }, myPrivate, 256);
  const hkdf = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: te.encode('classconnect/share/v1'), info: te.encode(info) },
    hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export const generateClassKey = () => subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

export async function wrapClassKey(classKey, myPrivate, recipientPublicB64, { classId, epoch, userId }) {
  const k = await pairKey(myPrivate, recipientPublicB64, `${classId}|${epoch}|${userId}`);
  const iv = rand(12);
  const raw = await subtle.exportKey('raw', classKey);
  const wrapped = await subtle.encrypt({ name: 'AES-GCM', iv }, k, raw);
  return { iv: toB64(iv), wrapped: toB64(wrapped) };
}

export async function unwrapClassKey(share, myPrivate, { classId, userId }) {
  const k = await pairKey(myPrivate, share.from_public_key, `${classId}|${share.epoch}|${userId}`);
  const raw = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(share.iv) }, k, fromB64(share.wrapped));
  return subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
}

export async function encryptJSON(key, obj, aad) {
  const iv = rand(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, te.encode(JSON.stringify(obj)));
  return { iv: toB64(iv), ciphertext: toB64(ct) };
}

export async function decryptJSON(key, ivB64, ctB64, aad) {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64), additionalData: te.encode(aad) }, key, fromB64(ctB64));
  return JSON.parse(td.decode(pt));
}

export async function encryptBytes(key, buffer) {
  const iv = rand(12);
  const data = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('file') }, key, buffer);
  return { iv: toB64(iv), data };
}

export function decryptBytes(key, ivB64, buffer) {
  return subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64), additionalData: te.encode('file') }, key, buffer);
}

/** Human-comparable safety number for a public key (like Signal). */
export async function fingerprint(publicKeyB64) {
  const hash = new Uint8Array(await subtle.digest('SHA-256', fromB64(publicKeyB64)));
  const groups = [];
  for (let i = 0; i < 30; i += 5) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = n * 256 + hash[i + j];
    groups.push(String(n % 100000).padStart(5, '0'));
  }
  return groups.join(' ');
}

// ---- local key storage (non-extractable CryptoKey kept in IndexedDB)
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('classconnect', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('keys', mode);
    const req = fn(t.objectStore('keys'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}
export const storePrivateKey = (userId, key) => idbDo('readwrite', (s) => s.put(key, `priv:${userId}`));
export const loadPrivateKey = (userId) => idbDo('readonly', (s) => s.get(`priv:${userId}`)).catch(() => null);
export const clearKeys = () => idbDo('readwrite', (s) => s.clear()).catch(() => {});
