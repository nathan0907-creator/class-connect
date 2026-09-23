// Class key lifecycle: bootstrap, unwrap, share with members, rotate after removals, reset after password loss.
import { collection, doc, getDoc, getDocs, query, where, limit, setDoc, updateDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import { db, sub, classRef, userRef, plain } from './fb.js';
import { state, emit, isDelegate } from './state.js';
import { generateClassKey, wrapClassKey, unwrapClassKey, createIdentity, storePrivateKey, storeClassKey } from './crypto.js';

export const currentKey = () => state.classKeys.get(state.cls?.key_epoch);
/** Device copy of the class keys, used to decrypt push notifications while the app is closed. */
const persistKeys = () => Promise.allSettled([...state.classKeys].map(([epoch, key]) => storeClassKey(state.cls.id, epoch, key)));
const shareRef = (cid, epoch, uid) => sub(cid, 'shares', `${epoch}_${uid}`);

async function shareDoc(key, epoch, userId, publicKey) {
  const w = await wrapClassKey(key, state.privateKey, publicKey, { classId: state.cls.id, epoch, userId });
  return { epoch, user_id: userId, from_user_id: state.me.id, from_public_key: state.me.public_key, iv: w.iv, wrapped: w.wrapped };
}

export async function loadKeys() {
  const cid = state.cls.id;
  const mine = (await getDocs(query(sub(cid, 'shares'), where('user_id', '==', state.me.id)))).docs.map(plain);

  if (!mine.length && isDelegate()) {
    // Brand-new class: the delegate creates the first key.
    const any = await getDocs(query(sub(cid, 'shares'), limit(1)));
    if (any.empty) {
      const key = await generateClassKey();
      try {
        await setDoc(shareRef(cid, state.cls.key_epoch, state.me.id), await shareDoc(key, state.cls.key_epoch, state.me.id, state.me.public_key));
        state.classKeys.set(state.cls.key_epoch, key);
      } catch (err) { console.warn('Initialisation de la clé', err); }
    }
  }

  for (const s of mine) {
    if (state.classKeys.has(s.epoch)) continue;
    try {
      state.classKeys.set(s.epoch, await unwrapClassKey(s, state.privateKey, { classId: cid, userId: state.me.id }));
    } catch (err) {
      console.warn('Impossible de déballer la clé', s.epoch, err);
    }
  }
  persistKeys();
  emit('keys');
}

/** Share documents for every epoch we hold, addressed to one member (used when approving). */
export async function sharesFor(userId, publicKey) {
  const out = [];
  for (const [epoch, key] of state.classKeys) out.push(await shareDoc(key, epoch, userId, publicKey));
  return out;
}
export const shareRefFor = (epoch, userId) => shareRef(state.cls.id, epoch, userId);

let sharing = null;
/** Hands keys to any active member missing some. Runs on every online client; duplicates are rejected by the rules. */
export function shareNeeded() {
  if (sharing || !state.classKeys.size || !state.cls) return sharing;
  sharing = (async () => {
    try {
      await new Promise((r) => setTimeout(r, isDelegate() ? 150 : 500 + Math.random() * 2000));
      const cid = state.cls.id;
      const have = new Set((await getDocs(sub(cid, 'shares'))).docs.map((d) => d.id));
      const jobs = [];
      for (const m of state.members.values()) {
        if (m.status !== 'active') continue;
        for (const [epoch, key] of state.classKeys) {
          if (have.has(`${epoch}_${m.id}`)) continue;
          jobs.push(shareDoc(key, epoch, m.id, m.public_key).then((d) => setDoc(shareRef(cid, epoch, m.id), d)));
        }
      }
      await Promise.allSettled(jobs);
    } catch (err) {
      console.warn('Partage de clés', err);
    } finally {
      sharing = null;
    }
  })();
  return sharing;
}

/** New key epoch: removed members can no longer read future messages. */
export async function rotateKey() {
  const cid = state.cls.id;
  const cls = plain(await getDoc(classRef(cid)));
  const members = (await getDocs(query(collection(db, 'users'), where('class_id', '==', cid)))).docs.map(plain)
    .filter((m) => m.status === 'active');
  const epoch = cls.key_epoch + 1;
  const key = await generateClassKey();
  const batch = writeBatch(db);
  batch.update(classRef(cid), { key_epoch: epoch });
  for (const m of members) batch.set(shareRef(cid, epoch, m.id), await shareDoc(key, epoch, m.id, m.public_key));
  await batch.commit();
  state.classKeys.set(epoch, key);
  state.cls.key_epoch = epoch;
  persistKeys();
  emit('keys');
}

/**
 * After a password reset the old private key can't be decrypted anymore: create a new identity,
 * drop our stale shares, and let classmates re-share every key with the new public key.
 */
export async function resetIdentity(uid, password) {
  const identity = await createIdentity(password);
  await setDoc(doc(db, 'private', uid), {
    enc_salt: identity.encSalt, enc_private_key: identity.encPrivateKey, priv_iv: identity.privIv,
  });
  const me = plain(await getDoc(userRef(uid)));
  if (me.class_id && me.status === 'active') {
    const old = await getDocs(query(sub(me.class_id, 'shares'), where('user_id', '==', uid)));
    await Promise.allSettled(old.docs.map((d) => deleteDoc(d.ref)));
  }
  await updateDoc(userRef(uid), { public_key: identity.publicKey });
  state.privateKey = identity.privateKey;
  state.classKeys.clear();
  await storePrivateKey(uid, identity.privateKey);
}
