// Encrypted file storage shared by the chat and the course library.
// Files are encrypted with the class key, then split into ~900 KB Firestore documents ("chunks").
import { doc, getDoc, setDoc, deleteDoc, Bytes } from 'firebase/firestore';
import { sub } from './fb.js';
import { state } from './state.js';
import { encryptBytes, decryptBytes } from './crypto.js';

export const MAX_FILE = 15 * 1024 * 1024;
const CHUNK = 900_000;

/** Encrypts and uploads a file. Returns the descriptor to store in an (encrypted) payload. */
export async function uploadEncrypted(file, key, onProgress) {
  const { iv, data } = await encryptBytes(key, await file.arrayBuffer());
  const bytes = new Uint8Array(data);
  const chunks = Math.ceil(bytes.length / CHUNK);
  const id = doc(sub(state.cls.id, 'chunks')).id;
  for (let n = 0; n < chunks; n++) {
    onProgress?.(n / chunks);
    await setDoc(sub(state.cls.id, 'chunks', `${id}_${n}`), {
      uploader: state.me.id, n, data: Bytes.fromUint8Array(bytes.subarray(n * CHUNK, (n + 1) * CHUNK)),
    });
  }
  onProgress?.(1);
  return { id, chunks, iv, mime: file.type || 'application/octet-stream', name: (file.name || 'fichier').slice(0, 120), size: file.size };
}

/** Downloads and decrypts a file descriptor. Returns an ArrayBuffer. */
export async function downloadDecrypted(file, key) {
  const parts = await Promise.all(Array.from({ length: file.chunks }, async (_, n) => {
    const snap = await getDoc(sub(state.cls.id, 'chunks', `${file.id}_${n}`));
    if (!snap.exists()) throw new Error('Morceau de fichier manquant');
    return snap.get('data').toUint8Array();
  }));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return decryptBytes(key, file.iv, out.buffer);
}

export function deleteFileChunks(file) {
  return Promise.allSettled(Array.from({ length: file.chunks }, (_, n) =>
    deleteDoc(sub(state.cls.id, 'chunks', `${file.id}_${n}`))));
}

/** Downscales large photos (GIFs are kept intact to preserve animation). */
export async function compressImage(file, max = 2048) {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.2 * 1024 * 1024) { bmp.close(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    let blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.85));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name, { type: blob.type }) : file;
  } catch {
    return file;
  }
}
