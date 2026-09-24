// NIVEAU 4 — la migration de sécurité (server/migrate-securite.mjs) jouée sur les émulateurs Auth + Firestore :
// après le déménagement, chaque compte se connecte toujours avec le même mot de passe, comme dans l'appli.
// Lancer : npm run test:migration
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth';

globalThis.location = new URL('http://localhost:5173/');
const { deriveAuthKey } = await import('../public/js/crypto.js');
const { saltEmail, otherSynth, synthEmail, isSynthetic } = await import('../public/js/fb.js');
const { connect, migrate } = await import('../server/migrate-securite.mjs');

const { db, auth } = connect('demo-classconnect');
const client = getAuth(initializeApp({ apiKey: 'demo-key', projectId: 'demo-classconnect' }, 'client'));
connectAuthEmulator(client, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
const PW = 'mot-de-passe-de-test';
const OLD = 'lea@users.classconnect.app';
const NEW = 'lea@pseudo.class-connect.invalid';

/** Same steps as the app's login (authflow.js): address found from the pseudo, password key salted by saltEmail. */
async function login(pseudoOrEmail) {
  const authEmail = pseudoOrEmail.includes('@') ? pseudoOrEmail : (await db.doc(`usernames/${pseudoOrEmail}`).get()).get('email');
  const cred = await signInWithEmailAndPassword(client, authEmail, await deriveAuthKey(saltEmail(authEmail), PW));
  await signOut(client);
  return cred.user.uid;
}

before(async () => {
  // Accounts as they were created before the migration.
  await auth.createUser({ uid: 'lea', email: OLD, password: await deriveAuthKey(OLD, PW) });
  await db.doc('usernames/lea').set({ uid: 'lea', email: OLD });
  await auth.createUser({ uid: 'tom', email: 'tom@exemple.fr', password: await deriveAuthKey('tom@exemple.fr', PW) });
  await db.doc('usernames/tom').set({ uid: 'tom', email: 'tom@exemple.fr' });
  await db.doc('usernames/bizarre').set({ uid: 'lea', email: 'autre@users.classconnect.app' });   // anomaly: left alone
  await db.doc('classes/c1').set({ name: 'Classe', invite_code: 'AAAA-AAAA', teacher_code: 'TTTT-TTTT', key_epoch: 1 });
  await db.doc('users/lea').set({ username: 'lea', color: 'url(https://evil.example/pixel)' });
  await db.doc('users/tom').set({ username: 'tom', color: '#00d4ff' });
});

test('avant : le compte pseudo se connecte avec l\'ancienne adresse', async () => {
  assert.equal(await login('lea'), 'lea');
});

test('simulation : compte ce qu\'il faut changer, sans rien modifier', async () => {
  const n = await migrate({ db, auth });
  assert.deepEqual(n, { pseudos: 1, emails_retires: 1, codes_profs: 1, couleurs: 1, ignores: 1 });
  assert.equal((await auth.getUser('lea')).email, OLD);
  assert.equal((await db.doc('usernames/tom').get()).get('email'), 'tom@exemple.fr');
  assert.equal((await db.doc('classes/c1').get()).get('teacher_code'), 'TTTT-TTTT');
});

test('application : adresse réservée, e-mail retiré du pseudo, code prof à l\'abri, couleur corrigée', async () => {
  await migrate({ db, auth, apply: true });
  assert.equal((await auth.getUser('lea')).email, NEW);
  assert.equal((await db.doc('usernames/lea').get()).get('email'), NEW);
  assert.deepEqual((await db.doc('usernames/tom').get()).data(), { uid: 'tom' });
  assert.equal((await db.doc('usernames/bizarre').get()).get('email'), 'autre@users.classconnect.app');
  assert.equal((await db.doc('classes/c1').get()).get('teacher_code'), undefined);
  assert.equal((await db.doc('classes/c1/secrets/codes').get()).get('teacher_code'), 'TTTT-TTTT');
  assert.equal((await db.doc('users/lea').get()).get('color'), '#7c5cff');
  assert.equal((await db.doc('users/tom').get()).get('color'), '#00d4ff');
});

test('relancer la migration ne change plus rien', async () => {
  assert.deepEqual(await migrate({ db, auth, apply: true }), { pseudos: 0, emails_retires: 0, codes_profs: 0, couleurs: 0, ignores: 1 });
});

test('après : même pseudo, même mot de passe → connexion OK ; l\'ancienne adresse ne marche plus', async () => {
  assert.equal(await login('lea'), 'lea');
  await assert.rejects(signInWithEmailAndPassword(client, OLD, await deriveAuthKey(OLD, PW)));
  // An app page still holding the old address falls back to the new one (authflow.js, otherSynth).
  assert.equal(otherSynth(OLD), NEW);
  assert.equal(otherSynth(NEW), OLD);
});

test('le compte avec e-mail se connecte avec son adresse, inchangée', async () => {
  assert.equal(await login('tom@exemple.fr'), 'tom');
});

test('les nouveaux comptes pseudo naissent sur le domaine réservé, avec le même sel de mot de passe', () => {
  assert.equal(synthEmail('Nina'), 'nina@pseudo.class-connect.invalid');
  assert.equal(saltEmail(synthEmail('Nina')), 'nina@users.classconnect.app');
  assert.equal(saltEmail('nina@exemple.fr'), 'nina@exemple.fr');
  assert.ok(isSynthetic(OLD) && isSynthetic(NEW) && !isSynthetic('nina@exemple.fr'));
});
