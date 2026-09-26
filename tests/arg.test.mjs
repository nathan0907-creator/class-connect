// The hidden story of the year: solvable from start to end, and no answer readable in the published files.
// Needs the private story (arg/story.mjs): skipped where it isn't (e.g. on GitHub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';

const root = path.resolve(import.meta.dirname, '..');
const storyFile = path.join(root, 'arg', 'story.mjs');
const skip = !fs.existsSync(storyFile) && 'histoire privée absente (arg/story.mjs)';

const { window, document } = parseHTML('<!doctype html><html><head></head><body><div class="toasts"></div></body></html>');
const store = new Map();
Object.assign(globalThis, {
  window, document, Node: window.Node, HTMLElement: window.HTMLElement, matchMedia: () => ({ matches: true }), location: new URL('http://localhost:5173/'),
  localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
});

test('aucune réponse en clair dans les fichiers publiés', { skip }, async () => {
  const { CHAPTERS } = await import(pathToFileURL(storyFile).href);
  const published = ['public/js/arg-data.js', 'public/js/arg.js', 'public/index.html', 'public/js/relais-data.js', 'public/js/relais.js'].map((f) => fs.readFileSync(path.join(root, f), 'utf8').toLowerCase()).join('\n');
  // The last answer is an everyday word on purpose (« nous », « la classe »…): not a leak.
  for (const c of CHAPTERS.slice(0, -1)) for (const a of c.answers) if (a.length >= 5) assert.ok(!published.includes(a), `réponse visible : ${a}`);
  // Nor any clue beyond the first one.
  for (const c of CHAPTERS.slice(1)) assert.ok(!published.includes(c.clue.slice(0, 30).toLowerCase()), `indice visible : ${c.title}`);
});

test('le souvenir du code source mène bien au fragment 3', { skip }, async () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const b64 = html.match(/VEGA · mémoire 3 · ([A-Za-z0-9+/=]+)/)[1];
  const { CHAPTERS } = await import(pathToFileURL(storyFile).href);
  const { norm } = await import('../public/js/arg.js');
  assert.ok(CHAPTERS[2].answers.includes(norm(Buffer.from(b64, 'base64').toString())));
});

test('l\'histoire se résout du début à la fin, et seulement dans l\'ordre', { skip, timeout: 120000 }, async () => {
  const { CHAPTERS } = await import(pathToFileURL(storyFile).href);
  const arg = await import('../public/js/arg.js');
  assert.equal(await arg.tryAnswer(1, 'andromede'), false);
  assert.equal(arg.solved(1), false);
  for (const [i, c] of CHAPTERS.entries()) {
    const n = i + 1;
    // Accents, capitals and spaces don't matter.
    const typed = c.answers[0].toUpperCase().split('').join(i % 2 ? ' ' : '');
    assert.equal(await arg.tryAnswer(n, typed), true, `fragment ${n}`);
    assert.equal(arg.solved(n), true);
  }
  assert.equal(arg.argDone(), true);
});

test('le relais ne s\'ouvre qu\'avec le code de la vidéo', { skip }, async () => {
  const { webcrypto: wc } = await import('node:crypto');
  const { CHAPTERS } = await import(pathToFileURL(storyFile).href);
  const config = await import(pathToFileURL(path.join(root, 'arg', 'config.mjs')).href);
  const DATA = (await import('../public/js/relais-data.js')).default;
  const published = fs.readFileSync(path.join(root, 'public/js/relais-data.js'), 'utf8') + fs.readFileSync(path.join(root, 'public', config.RELAY_PAGE), 'utf8');
  assert.ok(!published.includes(config.MC_ADDRESS), 'adresse du serveur visible');
  const { norm } = await import('../public/js/arg.js');
  const enc = new TextEncoder();
  const open = async (key, box, aad) => JSON.parse(new TextDecoder().decode(await wc.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(box.iv, 'base64'), additionalData: enc.encode(aad) }, key, Buffer.from(box.ct, 'base64'))));
  const tryCode = async (code) => {
    for (const w of DATA.wraps) {
      try {
        const base = await wc.subtle.importKey('raw', enc.encode(norm(code)), 'PBKDF2', false, ['deriveKey']);
        const k = await wc.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(w.salt, 'base64'), iterations: DATA.iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const key = await wc.subtle.importKey('raw', Buffer.from(await open(k, w, 'wrap|relais'), 'base64'), 'AES-GCM', false, ['decrypt']);
        return await open(key, DATA.box, 'relais');
      } catch { /* next */ }
    }
    return null;
  };
  assert.equal(await tryCode('mauvais'), null);
  assert.equal((await tryCode(CHAPTERS[3].answers[0].toUpperCase())).address, config.MC_ADDRESS);
});
