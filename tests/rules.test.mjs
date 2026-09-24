// NIVEAUX 2 et 3 — les règles de sécurité Firestore attaquées sur l'émulateur (aucune donnée réelle n'est touchée).
// Lancer : npm run test:rules   (démarre l'émulateur Firestore automatiquement)
import { test, describe, before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, collectionGroup, query, where,
  writeBatch, serverTimestamp, Timestamp, deleteField, Bytes,
} from 'firebase/firestore';

const root = path.resolve(import.meta.dirname, '..');
let env;
const PK = 'P'.repeat(88);   // fake public key (50–400 chars)
const C1 = 'classe1';
const C2 = 'classe2';

const USERS = {
  alice: { role: 'student', class_id: C1, status: 'active' },
  bob: { role: 'student', class_id: C1, status: 'active' },
  dele: { role: 'delegate', class_id: C1, status: 'active' },
  depu: { role: 'deputy', class_id: C1, status: 'active' },
  prof: { role: 'teacher', class_id: C1, status: 'active' },
  princ: { role: 'teacher', class_id: C1, status: 'active', principal: true },
  pend: { role: 'student', class_id: C1, status: 'pending' },
  eve: { role: 'delegate', class_id: C2, status: 'active' },   // délégué… d'une autre classe
  newbie: { role: 'student', class_id: null, status: 'none' },
};
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@users.classconnect.app` }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const c = (db, ...p) => doc(db, 'classes', ...p);
const enc = { iv: 'I'.repeat(16), ciphertext: 'C'.repeat(40) };

/** A message written the way the app does it (message + anti-spam rate document in one batch). */
function postMessage(db, uid, channel = 'messages', extra = {}, rateUid = uid) {
  const b = writeBatch(db);
  b.set(doc(collection(db, 'classes', C1, channel)), { user_id: uid, epoch: 1, ...enc, pinned: false, created_at: serverTimestamp(), ...extra });
  b.set(c(db, C1, 'rate', rateUid), { last: serverTimestamp() });
  return b.commit();
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-classconnect',
    firestore: { rules: fs.readFileSync(process.env.RULES_FILE || path.join(root, 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    for (const [uid, u] of Object.entries(USERS)) {
      await setDoc(doc(db, 'users', uid), {
        username: uid, display_name: uid, color: '#7c5cff', public_key: PK, created_at: now,
        trusted: false, principal: false, invite_code: null, ...u,
      });
      await setDoc(doc(db, 'usernames', uid), { uid, email: `${uid}@users.classconnect.app` });
      await setDoc(doc(db, 'private', uid), { enc_salt: 'S', enc_private_key: 'K'.repeat(40), priv_iv: 'V' });
    }
    await setDoc(c(db, C1), { name: 'Classe 1', invite_code: 'AAAA-AAAA', teacher_code: 'TTTT-TTTT', key_epoch: 1, created_by: 'dele', created_at: now });
    await setDoc(c(db, C2), { name: 'Classe 2', invite_code: 'BBBB-BBBB', key_epoch: 1, created_by: 'eve', created_at: now });
    await setDoc(doc(db, 'invites', 'AAAA-AAAA'), { class_id: C1 });
    await setDoc(doc(db, 'invites', 'TTTT-TTTT'), { class_id: C1, role: 'teacher' });
    await setDoc(doc(db, 'invites', 'BBBB-BBBB'), { class_id: C2 });
    await setDoc(c(db, C1, 'shares', '1_alice'), { epoch: 1, user_id: 'alice', from_user_id: 'dele', from_public_key: PK, iv: 'I'.repeat(16), wrapped: 'W'.repeat(40) });
    await setDoc(c(db, C1, 'messages', 'm1'), { user_id: 'alice', epoch: 1, ...enc, pinned: false, created_at: now, reactions: { bob: '👍' } });
    await setDoc(c(db, C1, 'staff_messages', 's1'), { user_id: 'prof', epoch: 1, ...enc, pinned: false, created_at: now });
    await setDoc(c(db, C1, 'mixed_messages', 'x1'), { user_id: 'prof', epoch: 1, ...enc, pinned: false, created_at: now });
    await setDoc(c(db, C1, 'council', 'T1_alice'), { student_id: 'alice', period: 'T1', author_id: 'prof', updated_at: now, ...enc, keys: { alice: {} } });
    await setDoc(c(db, C1, 'names', 'alice'), { epoch: 1, ...enc, updated_by: 'alice', updated_at: now });
    await setDoc(c(db, C1, 'profiles', 'alice'), { epoch: 1, ...enc, updated_by: 'alice', updated_at: now });
    await setDoc(c(db, C1, 'threads', 'alice'), { student_id: 'alice', include_principal: false, keys: { alice: {}, dele: {} }, last_at: now, last_by: 'alice', updated_at: now });
    await setDoc(c(db, C1, 'threads', 'alice', 'dm', 'd1'), { user_id: 'alice', ...enc, created_at: now });
    await setDoc(c(db, C1, 'threads', 'bob'), { student_id: 'bob', include_principal: true, keys: { bob: {}, dele: {}, princ: {} }, last_at: now, last_by: 'bob', updated_at: now });
    await setDoc(c(db, C1, 'reports', 'r1'), { reporter_id: 'bob', reported_id: 'alice', channel: 'messages', status: 'open', handled_by: null, expire_at: Timestamp.fromMillis(Date.now() + 30 * 864e5) });
    await setDoc(c(db, C1, 'proposals', 'p1'), { author_id: 'dele', title: 'Vote', status: 'open', action: 'poll', yes: 0, no: 0, abstain: 0, deadline: Timestamp.fromMillis(Date.now() + 864e5) });
    await setDoc(c(db, C1, 'chunks', 'f1_0'), { uploader: 'alice', n: 0, data: Bytes.fromUint8Array(new Uint8Array([1, 2, 3])) });
    await setDoc(doc(db, 'push_tokens', 'tok1'), { uid: 'alice', token: 'T'.repeat(40), updated_at: now });
  });
});

// =====================================================================================================
describe('NIVEAU 2 — contrôle d\'accès de base', () => {
  test('un visiteur non connecté ne lit rien', async () => {
    const db = anon();
    await assertFails(getDoc(doc(db, 'users', 'alice')));
    await assertFails(getDoc(c(db, C1)));
    await assertFails(getDocs(collection(db, 'classes', C1, 'messages')));
    await assertFails(getDoc(doc(db, 'private', 'alice')));
  });
  test('un pseudo peut être vérifié (connexion) mais la liste des pseudos est impossible', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'usernames', 'alice')));
    await assertFails(getDocs(collection(anon(), 'usernames')));
    await assertFails(getDocs(collection(as('alice'), 'emails')));
  });
  test('un membre lit sa classe, un intrus d\'une autre classe non', async () => {
    await assertSucceeds(getDoc(c(as('alice'), C1)));
    await assertSucceeds(getDocs(collection(as('alice'), 'classes', C1, 'messages')));
    await assertFails(getDoc(c(as('eve'), C1)));
    await assertFails(getDocs(collection(as('eve'), 'classes', C1, 'messages')));
    await assertFails(getDoc(doc(as('eve'), 'users', 'alice')));
  });
  test('un élève en attente de validation ne lit pas les messages', async () => {
    await assertFails(getDocs(collection(as('pend'), 'classes', C1, 'messages')));
  });
  test('la clé privée chiffrée de quelqu\'un n\'est lisible que par lui', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'private', 'alice')));
    await assertFails(getDoc(doc(as('bob'), 'private', 'alice')));
    await assertFails(getDoc(doc(as('dele'), 'private', 'alice')));
  });
  test('salle des profs : interdite aux élèves ET aux délégués ; canal élèves interdit aux profs', async () => {
    await assertFails(getDocs(collection(as('alice'), 'classes', C1, 'staff_messages')));
    await assertFails(getDocs(collection(as('dele'), 'classes', C1, 'staff_messages')));
    await assertSucceeds(getDocs(collection(as('prof'), 'classes', C1, 'staff_messages')));
    await assertFails(getDocs(collection(as('prof'), 'classes', C1, 'messages')));
    await assertSucceeds(getDocs(collection(as('prof'), 'classes', C1, 'mixed_messages')));
  });
  test('les jetons de notification ne sont lisibles par personne depuis le site', async () => {
    await assertFails(getDoc(doc(as('alice'), 'push_tokens', 'tok1')));
    await assertFails(getDocs(collection(as('dele'), 'push_tokens')));
  });
  test('les fichiers chiffrés d\'une classe sont invisibles pour une autre classe', async () => {
    await assertSucceeds(getDoc(c(as('bob'), C1, 'chunks', 'f1_0')));
    await assertFails(getDoc(c(as('eve'), C1, 'chunks', 'f1_0')));
  });
});

// =====================================================================================================
describe('NIVEAU 3 — attaques poussées', () => {
  describe('élévation de privilèges', () => {
    test('un élève ne peut pas se nommer délégué, prof, de confiance ou prof principal', async () => {
      const db = as('alice');
      await assertFails(updateDoc(doc(db, 'users', 'alice'), { role: 'delegate' }));
      await assertFails(updateDoc(doc(db, 'users', 'alice'), { role: 'teacher' }));
      await assertFails(updateDoc(doc(db, 'users', 'alice'), { trusted: true }));
      await assertFails(updateDoc(doc(db, 'users', 'alice'), { principal: true }));
      // témoin : changer son nom affiché est permis
      await assertSucceeds(updateDoc(doc(db, 'users', 'alice'), { display_name: 'Alice 🚀' }));
    });
    test('un élève ne peut pas changer le rôle d\'un autre ni l\'exclure', async () => {
      await assertFails(updateDoc(doc(as('alice'), 'users', 'bob'), { role: 'delegate' }));
      await assertFails(updateDoc(doc(as('alice'), 'users', 'bob'), { class_id: null, status: 'none', role: 'student', trusted: false, principal: false }));
    });
    test('un élève ne peut pas valider lui-même sa demande d\'adhésion', async () => {
      await assertFails(updateDoc(doc(as('pend'), 'users', 'pend'), { status: 'active' }));
      await assertSucceeds(updateDoc(doc(as('dele'), 'users', 'pend'), { status: 'active' }));
    });
    test('un délégué d\'une autre classe n\'a aucun pouvoir ici', async () => {
      await assertFails(updateDoc(doc(as('eve'), 'users', 'pend'), { status: 'active' }));
      await assertFails(updateDoc(doc(as('eve'), 'users', 'alice'), { role: 'delegate' }));
      await assertFails(updateDoc(c(as('eve'), C1), { name: 'Piratée' }));
    });
    test('un délégué peut nommer un élève professeur, sans autre privilège au passage', async () => {
      // pas d'escalade : on ne devient pas "prof principal" (tous les signalements) ni "de confiance" dans la foulée
      await assertFails(updateDoc(doc(as('dele'), 'users', 'alice'), { role: 'teacher', principal: true, trusted: false }));
      await assertFails(updateDoc(doc(as('eve'), 'users', 'alice'), { role: 'teacher', principal: false, trusted: false }));
      await assertFails(updateDoc(doc(as('depu'), 'users', 'alice'), { role: 'teacher', principal: false, trusted: false }));
      await assertSucceeds(updateDoc(doc(as('dele'), 'users', 'alice'), { role: 'teacher', principal: false, trusted: false }));
      // …et peut annuler une erreur
      await assertSucceeds(updateDoc(doc(as('dele'), 'users', 'alice'), { role: 'student', principal: false, trusted: false }));
    });
    test('un délégué ne peut pas se nommer lui-même professeur', async () => {
      await assertFails(updateDoc(doc(as('dele'), 'users', 'dele'), { role: 'teacher', principal: false, trusted: false }));
    });
    test('changer son pseudo de connexion ou sa date de création est impossible', async () => {
      await assertFails(updateDoc(doc(as('alice'), 'users', 'alice'), { username: 'dele' }));
      await assertFails(updateDoc(doc(as('alice'), 'users', 'alice'), { created_at: Timestamp.fromMillis(0) }));
    });
  });

  describe('adhésion à une classe', () => {
    test('rejoindre sans code valide est impossible', async () => {
      await assertFails(updateDoc(doc(as('newbie'), 'users', 'newbie'), { class_id: C1, status: 'pending', role: 'student', invite_code: 'ZZZZ-ZZZZ' }));
    });
    test('un code élève ne permet pas d\'entrer comme prof (et inversement)', async () => {
      await assertFails(updateDoc(doc(as('newbie'), 'users', 'newbie'), { class_id: C1, status: 'pending', role: 'teacher', invite_code: 'AAAA-AAAA' }));
      await assertFails(updateDoc(doc(as('newbie'), 'users', 'newbie'), { class_id: C1, status: 'pending', role: 'student', invite_code: 'TTTT-TTTT' }));
    });
    test('on ne peut pas entrer directement "actif" sans validation', async () => {
      await assertFails(updateDoc(doc(as('newbie'), 'users', 'newbie'), { class_id: C1, status: 'active', role: 'student', invite_code: 'AAAA-AAAA' }));
    });
    test('un code valide envoie bien une demande en attente', async () => {
      await assertSucceeds(updateDoc(doc(as('newbie'), 'users', 'newbie'), { class_id: C1, status: 'pending', role: 'student', invite_code: 'AAAA-AAAA' }));
    });
    test('un code d\'une autre classe ne fait pas entrer dans celle-ci', async () => {
      await assertFails(updateDoc(doc(as('newbie'), 'users', 'newbie'), { class_id: C1, status: 'pending', role: 'student', invite_code: 'BBBB-BBBB' }));
    });
    test('personne ne peut lister les codes d\'invitation ni en créer pour une classe qu\'il ne dirige pas', async () => {
      await assertFails(getDocs(collection(as('alice'), 'invites')));
      await assertFails(setDoc(doc(as('alice'), 'invites', 'HACK-HACK'), { class_id: C1 }));
      await assertFails(setDoc(doc(as('eve'), 'invites', 'HACK-HACK'), { class_id: C1, role: 'teacher' }));
      // témoin : le délégué de la classe peut créer un code
      await assertSucceeds(setDoc(doc(as('dele'), 'invites', 'NEW1-NEW1'), { class_id: C1 }));
    });
  });

  describe('usurpation et falsification de messages', () => {
    test('envoyer un message normal fonctionne', async () => {
      await assertSucceeds(postMessage(as('alice'), 'alice'));
    });
    test('écrire au nom de quelqu\'un d\'autre est impossible', async () => {
      // Alice remplit correctement son propre anti-spam : seul le champ auteur est falsifié.
      await assertFails(postMessage(as('alice'), 'bob', 'messages', {}, 'alice'));
    });
    test('un message ne peut pas arriver déjà épinglé, ni avec une fausse clé, ni antidaté', async () => {
      await assertFails(postMessage(as('alice'), 'alice', 'messages', { pinned: true }));
      await assertFails(postMessage(as('alice'), 'alice', 'messages', { epoch: 99 }));
      await assertFails(postMessage(as('alice'), 'alice', 'messages', { created_at: Timestamp.fromMillis(0) }));
    });
    test('anti-spam : sans le document de limitation, le message est refusé', async () => {
      await assertFails(addDoc(collection(as('alice'), 'classes', C1, 'messages'), { user_id: 'alice', epoch: 1, ...enc, pinned: false, created_at: serverTimestamp() }));
    });
    test('anti-spam : deux messages dans la même seconde sont refusés', async () => {
      await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'classes', C1, 'rate', 'alice'), { last: Timestamp.now() }));
      await assertFails(postMessage(as('alice'), 'alice'));
    });
    test('un élève ne peut pas écrire dans la salle des profs', async () => {
      await assertFails(postMessage(as('alice'), 'alice', 'staff_messages'));
    });
    test('modifier le contenu d\'un message existant est impossible, même pour son auteur', async () => {
      await assertFails(updateDoc(c(as('alice'), C1, 'messages', 'm1'), { ciphertext: 'X'.repeat(40) }));
      await assertFails(updateDoc(c(as('alice'), C1, 'messages', 'm1'), { user_id: 'bob' }));
    });
    test('un élève ne peut pas supprimer le message d\'un autre ; un délégué oui (suppression douce)', async () => {
      const del = (uid) => ({ deleted_at: serverTimestamp(), deleted_by: uid, pinned: false });
      await assertFails(updateDoc(c(as('bob'), C1, 'messages', 'm1'), del('bob')));
      await assertSucceeds(updateDoc(c(as('dele'), C1, 'messages', 'm1'), del('dele')));
    });
    test('effacer définitivement un message avant 30 jours (preuves de harcèlement) est impossible', async () => {
      await assertFails(deleteDoc(c(as('alice'), C1, 'messages', 'm1')));
      await assertFails(deleteDoc(c(as('dele'), C1, 'messages', 'm1')));
    });
    test('réactions : on ne touche qu\'à la sienne, et seulement avec un emoji autorisé', async () => {
      await assertSucceeds(updateDoc(c(as('alice'), C1, 'messages', 'm1'), { 'reactions.alice': '🔥' }));
      await assertFails(updateDoc(c(as('alice'), C1, 'messages', 'm1'), { 'reactions.bob': deleteField() }));
      await assertFails(updateDoc(c(as('alice'), C1, 'messages', 'm1'), { 'reactions.bob': '😢' }));
      await assertFails(updateDoc(c(as('alice'), C1, 'messages', 'm1'), { 'reactions.alice': '<script>' }));
    });
  });

  describe('données confidentielles', () => {
    test('conseil de classe : un élève ne voit pas les résultats des autres', async () => {
      await assertSucceeds(getDoc(c(as('alice'), C1, 'council', 'T1_alice')));
      await assertFails(getDoc(c(as('bob'), C1, 'council', 'T1_alice')));
      await assertFails(getDocs(collection(as('bob'), 'classes', C1, 'council')));
      await assertSucceeds(getDocs(collection(as('prof'), 'classes', C1, 'council')));
    });
    test('conseil de classe : un élève ne peut pas écrire ses propres notes', async () => {
      await assertFails(setDoc(c(as('alice'), C1, 'council', 'T1_alice'), {
        student_id: 'alice', period: 'T1', author_id: 'alice', updated_at: serverTimestamp(), ...enc, keys: { alice: {} },
      }));
      // témoin : un prof peut saisir
      await assertSucceeds(setDoc(c(as('prof'), C1, 'council', 'T1_bob'), {
        student_id: 'bob', period: 'T1', author_id: 'prof', updated_at: serverTimestamp(), ...enc, keys: { bob: {} },
      }));
    });
    test('vrai nom : invisible pour les autres élèves, visible pour les profs et délégués', async () => {
      await assertFails(getDoc(c(as('bob'), C1, 'names', 'alice')));
      await assertFails(getDocs(collection(as('bob'), 'classes', C1, 'names')));
      await assertSucceeds(getDoc(c(as('prof'), C1, 'names', 'alice')));
      await assertSucceeds(getDoc(c(as('dele'), C1, 'names', 'alice')));
    });
    test('personne ne peut écraser le profil ou le vrai nom d\'un autre élève', async () => {
      const d = (by) => ({ epoch: 1, ...enc, updated_by: by, updated_at: serverTimestamp() });
      await assertFails(setDoc(c(as('bob'), C1, 'profiles', 'alice'), d('bob')));
      await assertFails(setDoc(c(as('bob'), C1, 'names', 'alice'), d('bob')));
      await assertSucceeds(setDoc(c(as('prof'), C1, 'names', 'alice'), d('prof')));
    });
    test('signalements : seul le signaleur et les modérateurs les voient', async () => {
      await assertFails(getDoc(c(as('alice'), C1, 'reports', 'r1')));
      await assertSucceeds(getDoc(c(as('bob'), C1, 'reports', 'r1')));
      await assertSucceeds(getDoc(c(as('dele'), C1, 'reports', 'r1')));
    });
  });

  describe('« Contacter les délégués » (messages privés)', () => {
    test('un élève ne lit pas la conversation d\'un autre élève', async () => {
      await assertFails(getDoc(c(as('bob'), C1, 'threads', 'alice')));
      await assertFails(getDocs(collection(as('bob'), 'classes', C1, 'threads', 'alice', 'dm')));
      await assertFails(getDocs(collection(as('bob'), 'classes', C1, 'threads')));
    });
    test('les délégués lisent toutes les conversations, le prof principal seulement s\'il est invité', async () => {
      await assertSucceeds(getDocs(collection(as('dele'), 'classes', C1, 'threads')));
      await assertFails(getDoc(c(as('princ'), C1, 'threads', 'alice')));
      await assertSucceeds(getDoc(c(as('princ'), C1, 'threads', 'bob')));
      await assertSucceeds(getDocs(query(collection(as('princ'), 'classes', C1, 'threads'), where('include_principal', '==', true))));
    });
    test('un prof non principal et un suppléant n\'y ont pas accès', async () => {
      await assertFails(getDoc(c(as('prof'), C1, 'threads', 'bob')));
      await assertFails(getDoc(c(as('depu'), C1, 'threads', 'alice')));
    });
    test('un délégué ne peut pas inviter le prof principal à la place de l\'élève', async () => {
      await assertFails(updateDoc(c(as('dele'), C1, 'threads', 'alice'), { include_principal: true, updated_at: serverTimestamp() }));
      await assertSucceeds(updateDoc(c(as('alice'), C1, 'threads', 'alice'), { include_principal: true, updated_at: serverTimestamp() }));
    });
    test('un élève ne peut pas glisser un message dans la conversation d\'un autre', async () => {
      await assertFails(addDoc(collection(as('bob'), 'classes', C1, 'threads', 'alice', 'dm'), { user_id: 'bob', ...enc, created_at: serverTimestamp() }));
      await assertSucceeds(addDoc(collection(as('dele'), 'classes', C1, 'threads', 'alice', 'dm'), { user_id: 'dele', ...enc, created_at: serverTimestamp() }));
    });
    test('un message privé ne peut être ni modifié ni effacé', async () => {
      await assertFails(updateDoc(c(as('alice'), C1, 'threads', 'alice', 'dm', 'd1'), { ciphertext: 'X'.repeat(40) }));
      await assertFails(deleteDoc(c(as('dele'), C1, 'threads', 'alice', 'dm', 'd1')));
    });
    test('un élève ne peut pas ouvrir une conversation au nom d\'un autre', async () => {
      await assertFails(setDoc(c(as('bob'), C1, 'threads', 'pend'), {
        student_id: 'pend', include_principal: false, keys: { bob: {} }, last_at: serverTimestamp(), last_by: 'bob', updated_at: serverTimestamp(),
      }));
      // témoin : on peut ouvrir la sienne
      await assertSucceeds(setDoc(c(as('depu'), C1, 'threads', 'depu'), {
        student_id: 'depu', include_principal: false, keys: { depu: {} }, last_at: serverTimestamp(), last_by: 'depu', updated_at: serverTimestamp(),
      }));
    });
  });

  describe('clés de chiffrement', () => {
    test('un élève ne peut pas fabriquer un partage de clé en se faisant passer pour un autre', async () => {
      await assertFails(setDoc(c(as('bob'), C1, 'shares', '1_bob'), {
        epoch: 1, user_id: 'bob', from_user_id: 'alice', from_public_key: PK, iv: 'I'.repeat(16), wrapped: 'W'.repeat(40),
      }));
    });
    test('un élève qui n\'a pas la clé ne peut pas en distribuer une (clé piégée)', async () => {
      await assertFails(setDoc(c(as('bob'), C1, 'shares', '1_bob'), {
        epoch: 1, user_id: 'bob', from_user_id: 'bob', from_public_key: PK, iv: 'I'.repeat(16), wrapped: 'W'.repeat(40),
      }));
      // témoin : le délégué transmet la clé à bob
      await assertSucceeds(setDoc(c(as('dele'), C1, 'shares', '1_bob'), {
        epoch: 1, user_id: 'bob', from_user_id: 'dele', from_public_key: PK, iv: 'I'.repeat(16), wrapped: 'W'.repeat(40),
      }));
    });
    test('seul un délégué peut renouveler la clé de la classe', async () => {
      await assertFails(updateDoc(c(as('alice'), C1), { key_epoch: 2 }));
      await assertSucceeds(updateDoc(c(as('dele'), C1), { key_epoch: 2 }));
      await assertFails(updateDoc(c(as('dele'), C1), { key_epoch: 10 }));
    });
  });

  describe('votes, comptes à rebours, divers', () => {
    test('bourrer l\'urne : +2 voix ou une voix sans bulletin sont refusés', async () => {
      await assertFails(updateDoc(c(as('alice'), C1, 'proposals', 'p1'), { yes: 2 }));
      await assertFails(updateDoc(c(as('alice'), C1, 'proposals', 'p1'), { yes: 1 }));
      // témoin : un vrai vote (bulletin + compteur dans le même lot) passe
      const db = as('alice');
      const b = writeBatch(db);
      b.set(c(db, C1, 'proposals', 'p1', 'votes', 'alice'), { value: 1 });
      b.update(c(db, C1, 'proposals', 'p1'), { yes: 1 });
      await assertSucceeds(b.commit());
    });
    test('un élève ne peut pas clôturer un vote ni en lancer un', async () => {
      await assertFails(updateDoc(c(as('alice'), C1, 'proposals', 'p1'), { status: 'accepted', closed_at: serverTimestamp() }));
      await assertFails(addDoc(collection(as('alice'), 'classes', C1, 'proposals'), { author_id: 'alice', title: 'Pirate' }));
    });
    test('les bulletins de vote des autres sont secrets', async () => {
      await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'classes', C1, 'proposals', 'p1', 'votes', 'bob'), { value: 1 }));
      await assertFails(getDoc(c(as('alice'), C1, 'proposals', 'p1', 'votes', 'bob')));
      await assertFails(getDoc(c(as('dele'), C1, 'proposals', 'p1', 'votes', 'bob')));
    });
    test('comptes à rebours : réservés aux délégués/profs, date au bon format', async () => {
      const ev = (by, date = '2027-06-30') => ({ title: 'Vacances', date, kind: 'vacances', author_id: by, created_at: serverTimestamp() });
      await assertFails(addDoc(collection(as('alice'), 'classes', C1, 'events'), ev('alice')));
      await assertSucceeds(addDoc(collection(as('dele'), 'classes', C1, 'events'), ev('dele')));
      await assertFails(addDoc(collection(as('dele'), 'classes', C1, 'events'), ev('dele', '<img src=x>')));
    });
    test('requête « toutes classes confondues » (collectionGroup) refusée à un élève', async () => {
      await assertFails(getDocs(collectionGroup(as('alice'), 'messages')));
      await assertFails(getDocs(collectionGroup(as('dele'), 'dm')));
    });
    test('un membre ne peut pas supprimer son compte tant qu\'il est dans une classe (preuves)', async () => {
      await assertFails(deleteDoc(doc(as('alice'), 'users', 'alice')));
    });
    test('voler le pseudo d\'un autre à l\'inscription est impossible', async () => {
      await assertFails(setDoc(doc(as('newbie'), 'usernames', 'alice'), { uid: 'newbie', email: 'newbie@users.classconnect.app' }));
      await assertFails(deleteDoc(doc(as('newbie'), 'usernames', 'alice')));
      // témoin : réserver un pseudo libre pour soi fonctionne
      await assertSucceeds(setDoc(doc(as('newbie'), 'usernames', 'newbie2'), { uid: 'newbie', email: 'newbie@users.classconnect.app' }));
    });
  });
});
