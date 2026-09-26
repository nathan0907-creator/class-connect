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
  const published = ['public/js/arg-data.js', 'public/js/arg.js', 'public/index.html'].map((f) => fs.readFileSync(path.join(root, f), 'utf8').toLowerCase()).join('\n');
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
  // The last hook data (fragment 9) could only be read with fragment 8's key: it is there now.
  assert.equal(arg.schoolMonth(new Date(2027, 5, 10)), 9);
  assert.equal(arg.schoolMonth(new Date(2026, 8, 1)), 0);
  assert.equal(arg.schoolMonth(new Date(2027, 6, 14)), 9);
  assert.equal(arg.reachable(2, new Date(2026, 8, 30)), false);
  assert.equal(arg.reachable(2, new Date(2026, 9, 1)), true);
});
