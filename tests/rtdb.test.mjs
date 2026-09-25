// NIVEAU 3 — règles de la base temps réel (présence en ligne, « … est en train d'écrire »), attaquées sur l'émulateur.
// Lancé avec les règles Firestore : npm run test:rules
import { test, before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, get, set } from 'firebase/database';

const root = path.resolve(import.meta.dirname, '..');
const CID = 'AbCdEfGhIjKlMnOpQrSt';   // same shape as a Firestore class id (20 letters/digits)
let env;
const as = (uid) => env.authenticatedContext(uid).database();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-classconnect',
    database: { rules: fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8'), host: '127.0.0.1', port: 9000 },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('un visiteur non connecté ne voit ni qui est en ligne ni qui écrit', async () => {
  const db = env.unauthenticatedContext().database();
  await assertFails(get(ref(db, `presence/${CID}`)));
  await assertFails(get(ref(db, `typing/${CID}/messages`)));
  await assertFails(set(ref(db, `presence/${CID}/x`), true));
});

test('personne ne lit la base entière (liste des classes)', async () => {
  await assertFails(get(ref(as('alice'), '/')));
  await assertFails(get(ref(as('alice'), 'presence')));
  await assertFails(get(ref(as('alice'), 'typing')));
});

test('on ne signale que sa propre présence, jamais celle d\'un autre', async () => {
  await assertSucceeds(set(ref(as('alice'), `presence/${CID}/alice`), true));
  await assertFails(set(ref(as('alice'), `presence/${CID}/bob`), true));
});

test('pas de données arbitraires : booléen / horodatage uniquement', async () => {
  await assertFails(set(ref(as('alice'), `presence/${CID}/alice`), 'x'.repeat(10000)));
  await assertFails(set(ref(as('alice'), `typing/${CID}/messages/alice`), { spam: true }));
  // horodatage dans le futur lointain (« écrit » pour toujours)
  await assertFails(set(ref(as('alice'), `typing/${CID}/messages/alice`), Date.now() + 3600e3));
  await assertSucceeds(set(ref(as('alice'), `typing/${CID}/messages/alice`), Date.now()));
});

test('tableau blanc : traits signés de leur auteur, jamais modifiés ni au format libre', async () => {
  const s = { by: 'alice', e: 1, iv: 'I'.repeat(16), ct: 'C'.repeat(100), t: Date.now() };
  await assertSucceeds(set(ref(as('alice'), `boards/${CID}/strokes/s1`), s));
  await assertFails(set(ref(as('bob'), `boards/${CID}/strokes/s2`), s));
  await assertFails(set(ref(as('alice'), `boards/${CID}/strokes/s1`), { ...s, ct: 'X'.repeat(100) }));
  await assertFails(set(ref(as('alice'), `boards/${CID}/strokes/s3`), { ...s, ct: 'C'.repeat(50000) }));
  await assertFails(set(ref(as('alice'), `boards/${CID}/strokes/s4`), { ...s, pub: 'spam' }));
  await assertSucceeds(set(ref(as('bob'), `boards/${CID}/cleared_at`), Date.now()));
  await assertFails(get(ref(env.unauthenticatedContext().database(), `boards/${CID}`)));
});

test('pas de classes ni de canaux inventés (remplissage de la base)', async () => {
  await assertFails(set(ref(as('alice'), 'presence/pas-une-classe/alice'), true));
  await assertFails(set(ref(as('alice'), `typing/${CID}/canal-invente/alice`), Date.now()));
  await assertFails(get(ref(as('alice'), `typing/${CID}/canal-invente`)));
});
