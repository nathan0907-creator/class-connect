// One-off: recovers the fragment keys of the published story (unwrapped with the answers) into arg/keys.json,
// so that rebuilding the story keeps everyone's progress. Run: node scripts/arg-keys-from-live.mjs [url]
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto as crypto } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { norm } from './arg-build.mjs';

const root = path.resolve(import.meta.dirname, '..');
const url = process.argv[2] || 'https://nathan0907-creator.github.io/class-connect/js/arg-data.js';
const src = await (await fetch(url, { cache: 'no-store' })).text();
const DATA = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
const { CHAPTERS } = await import(pathToFileURL(path.join(root, 'arg', 'story.mjs')).href);
const enc = new TextEncoder();
const keys = {};
for (const c of DATA.chapters) {
  for (const answer of CHAPTERS[c.n - 1].answers) {
    for (const w of c.wraps) {
      try {
        const base = await crypto.subtle.importKey('raw', enc.encode(norm(answer)), 'PBKDF2', false, ['deriveKey']);
        const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(w.salt, 'base64'), iterations: DATA.iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(w.iv, 'base64'), additionalData: enc.encode(`wrap|${c.n}`) }, k, Buffer.from(w.ct, 'base64'));
        keys[c.n] = JSON.parse(new TextDecoder().decode(plain));
        break;
      } catch { /* next */ }
    }
    if (keys[c.n]) break;
  }
  if (!keys[c.n]) throw new Error(`fragment ${c.n} : clé introuvable`);
}
fs.writeFileSync(path.join(root, 'arg', 'keys.json'), JSON.stringify(keys, null, 2));
console.log(`✔ ${Object.keys(keys).length} clés récupérées → arg/keys.json`);
