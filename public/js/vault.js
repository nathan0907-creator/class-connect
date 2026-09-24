// Encrypted class items (alerts, compliments, playlist, capsules…): same recipe as the messages — JSON encrypted
// with the class key, bound to its kind, class, key epoch and author, so the server only stores ciphertext.
import { state } from './state.js';
import { encryptJSON, decryptJSON } from './crypto.js';
import { currentKey } from './keyring.js';

const aad = (kind, epoch, by) => `${kind}|${state.cls.id}|${epoch}|${by || ''}`;

/** { epoch, iv, ciphertext } of a new item. `by` = author written in the document ('' for anonymous items). */
export async function seal(kind, data, by = state.me.id) {
  const key = currentKey();
  if (!key) throw new Error('Clé de la classe pas encore reçue. Attends qu\'un membre en ligne te la transmette.');
  const epoch = state.cls.key_epoch;
  const { iv, ciphertext } = await encryptJSON(key, data, aad(kind, epoch, by));
  return { epoch, iv, ciphertext };
}

/** Decrypted content of an item, or null (key not received yet, or tampered with). */
export async function unseal(kind, row, by = row.by) {
  const key = state.classKeys.get(row.epoch);
  if (!key) return null;
  try {
    const data = await decryptJSON(key, row.iv, row.ciphertext, aad(kind, row.epoch, by));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
}

/** Plain string of at most `max` characters (anything else → ''). Decrypted data comes from other members. */
export const txt = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
