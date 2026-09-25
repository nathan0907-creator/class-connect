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
const SYNTH = '@pseudo.class-connect.invalid';
const as = (uid, email = uid + SYNTH) => env.authenticatedContext(uid, { email }).firestore();
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
      await setDoc(doc(db, 'usernames', uid), { uid, email: uid + SYNTH });
      await setDoc(doc(db, 'private', uid), { enc_salt: 'S', enc_private_key: 'K'.repeat(40), priv_iv: 'V' });
    }
    await setDoc(c(db, C1), { name: 'Classe 1', invite_code: 'AAAA-AAAA', teacher_code: 'TTTT-TTTT', key_epoch: 1, created_by: 'dele', created_at: now });
    await setDoc(c(db, C2), { name: 'Classe 2', invite_code: 'BBBB-BBBB', key_epoch: 1, created_by: 'eve', created_at: now });
    await setDoc(doc(db, 'invites', 'AAAA-AAAA'), { class_id: C1 });
    await setDoc(doc(db, 'invites', 'TTTT-TTTT'), { class_id: C1, role: 'teacher' });
    await setDoc(doc(db, 'invites', 'BBBB-BBBB'), { class_id: C2 });
    await setDoc(c(db, C1, 'secrets', 'codes'), { teacher_code: 'TTTT-TTTT' });
    await setDoc(doc(db, 'invites', 'UUUU-UUUU'), { class_id: C1, role: 'teacher' });
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
      // sans trace dans le journal de modération : refusé
      await assertFails(updateDoc(c(as('dele'), C1, 'messages', 'm1'), del('dele')));
      const db = as('dele');
      const b = writeBatch(db);
      b.update(c(db, C1, 'messages', 'm1'), del('dele'));
      b.set(c(db, C1, 'modlog', 'm1_del'), { action: 'delete', target: 'alice', channel: 'messages', detail: '', by: 'dele', at: serverTimestamp() });
      await assertSucceeds(b.commit());
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
      await assertFails(setDoc(doc(as('newbie'), 'usernames', 'alice'), { uid: 'newbie', email: 'newbie' + SYNTH }));
      await assertFails(deleteDoc(doc(as('newbie'), 'usernames', 'alice')));
      // témoin : réserver un pseudo libre pour soi fonctionne
      await assertSucceeds(setDoc(doc(as('nouveau'), 'usernames', 'nouveau'), { uid: 'nouveau', email: 'nouveau' + SYNTH }));
    });
  });

  describe('comptes, confidentialité et clés', () => {
    test('le pseudo (lisible par tous) ne peut jamais révéler une vraie adresse e-mail', async () => {
      const reel = as('reel', 'reel@exemple.fr');
      await assertFails(setDoc(doc(reel, 'usernames', 'reel'), { uid: 'reel', email: 'reel@exemple.fr' }));
      // témoin : un compte avec e-mail réserve son pseudo sans l'adresse
      await assertSucceeds(setDoc(doc(reel, 'usernames', 'reel'), { uid: 'reel' }));
    });
    test("adresse de pseudo : ni l'ancien domaine (il appartient à quelqu'un d'autre), ni celle d'un autre pseudo", async () => {
      await assertFails(setDoc(doc(as('vieux', 'vieux@users.classconnect.app'), 'usernames', 'vieux'), { uid: 'vieux', email: 'vieux@users.classconnect.app' }));
      await assertFails(setDoc(doc(as('nouveau'), 'usernames', 'autre'), { uid: 'nouveau', email: 'nouveau' + SYNTH }));
    });
    test('une couleur piégée (injection CSS) est refusée', async () => {
      await assertFails(updateDoc(doc(as('alice'), 'users', 'alice'), { color: 'url(https://evil.example/pixel)' }));
      await assertFails(updateDoc(doc(as('alice'), 'users', 'alice'), { color: '#12345' }));
      await assertSucceeds(updateDoc(doc(as('alice'), 'users', 'alice'), { color: '#12ab5f' }));
    });
    test("une nouvelle clé (mot de passe réinitialisé) repasse par la validation d'un délégué", async () => {
      const newKey = { public_key: 'Q'.repeat(88) };
      await assertFails(updateDoc(doc(as('alice'), 'users', 'alice'), newKey));
      await assertFails(updateDoc(doc(as('prof'), 'users', 'prof'), newKey));
      await assertSucceeds(updateDoc(doc(as('alice'), 'users', 'alice'), { ...newKey, status: 'pending' }));
      // le délégué garde son accès (personne d'autre ne pourrait le valider)
      await assertSucceeds(updateDoc(doc(as('dele'), 'users', 'dele'), newKey));
    });
    test('en attente de revalidation, plus aucune lecture de la classe', async () => {
      await updateDoc(doc(as('alice'), 'users', 'alice'), { public_key: 'Q'.repeat(88), status: 'pending' });
      await assertFails(getDocs(collection(as('alice'), 'classes', C1, 'messages')));
      await assertFails(getDocs(collection(as('alice'), 'classes', C1, 'shares')));
    });
    test("le code professeurs n'est lisible et modifiable que par les délégués", async () => {
      for (const u of ['alice', 'prof', 'depu', 'pend', 'eve']) await assertFails(getDoc(c(as(u), C1, 'secrets', 'codes')));
      await assertSucceeds(getDoc(c(as('dele'), C1, 'secrets', 'codes')));
      // un code élève ne peut pas être enregistré comme code professeurs
      await assertFails(setDoc(c(as('dele'), C1, 'secrets', 'codes'), { teacher_code: 'AAAA-AAAA' }));
      await assertFails(setDoc(c(as('alice'), C1, 'secrets', 'codes'), { teacher_code: 'UUUU-UUUU' }));
      await assertSucceeds(setDoc(c(as('dele'), C1, 'secrets', 'codes'), { teacher_code: 'UUUU-UUUU' }));
    });
    test('le code professeurs ne peut plus être remis dans le document de classe (lisible par tous)', async () => {
      await assertFails(updateDoc(c(as('dele'), C1), { teacher_code: 'UUUU-UUUU' }));
      await assertSucceeds(updateDoc(c(as('dele'), C1), { teacher_code: deleteField() }));
    });
  });

  describe('emploi du temps et annonces', () => {
    const slot = { day: 1, start_at: '08:00', end_at: '09:00', subject: 'Maths', teacher: '', room: 'B204', color: '#7c5cff' };
    const alert = (by, extra = {}) => ({ kind: 'absent', slot_id: 's1', date: '2030-01-15', epoch: 1, ...enc, by, created_at: serverTimestamp(), ...extra });

    test('annonces : tout le monde lit, seuls délégués / suppléants / profs publient', async () => {
      for (const u of ['alice', 'prof', 'dele']) await assertSucceeds(getDocs(collection(as(u), 'classes', C1, 'announcements')));
      await assertFails(getDocs(collection(as('pend'), 'classes', C1, 'announcements')));
      await assertFails(postMessage(as('alice'), 'alice', 'announcements'));
      await assertSucceeds(postMessage(as('dele'), 'dele', 'announcements'));
      await assertSucceeds(postMessage(as('prof'), 'prof', 'announcements'));
    });
    test('un élève peut seulement y signaler un changement de cours (alerte)', async () => {
      await assertSucceeds(postMessage(as('alice'), 'alice', 'announcements', { kind: 'alert' }));
      await assertFails(postMessage(as('bob'), 'bob', 'announcements', { kind: 'annonce' }));
      // le champ « kind » n'ouvre rien ailleurs
      await assertFails(postMessage(as('alice'), 'alice', 'staff_messages', { kind: 'alert' }));
    });
    test('alertes « prof absent » : chacun prévient, personne ne signe à la place d\'un autre', async () => {
      await assertSucceeds(addDoc(collection(as('alice'), 'classes', C1, 'alerts'), alert('alice')));
      await assertFails(addDoc(collection(as('alice'), 'classes', C1, 'alerts'), alert('bob')));
      await assertFails(addDoc(collection(as('alice'), 'classes', C1, 'alerts'), alert('alice', { kind: 'fete' })));
      await assertFails(addDoc(collection(as('alice'), 'classes', C1, 'alerts'), alert('alice', { date: 'demain' })));
      await assertFails(addDoc(collection(as('eve'), 'classes', C1, 'alerts'), alert('eve')));
      await assertFails(addDoc(collection(as('pend'), 'classes', C1, 'alerts'), alert('pend')));
    });
    test('une alerte ne peut être retirée que par son auteur ou l\'équipe (délégués, profs)', async () => {
      await env.withSecurityRulesDisabled((ctx) => setDoc(c(ctx.firestore(), C1, 'alerts', 'a1'), { ...alert('alice'), created_at: Timestamp.now() }));
      await assertFails(deleteDoc(c(as('bob'), C1, 'alerts', 'a1')));
      await assertFails(updateDoc(c(as('alice'), C1, 'alerts', 'a1'), { kind: 'room' }));
      await assertSucceeds(deleteDoc(c(as('dele'), C1, 'alerts', 'a1')));
    });
    test('sondages : un vote par personne, seulement le sien, seulement sur un sondage', async () => {
      await env.withSecurityRulesDisabled((ctx) => setDoc(c(ctx.firestore(), C1, 'messages', 'p1'), { user_id: 'dele', epoch: 1, ...enc, pinned: false, created_at: Timestamp.now(), kind: 'poll' }));
      await assertSucceeds(updateDoc(c(as('alice'), C1, 'messages', 'p1'), { 'votes.alice': 1 }));
      await assertSucceeds(updateDoc(c(as('alice'), C1, 'messages', 'p1'), { 'votes.alice': 0 }));
      await assertFails(updateDoc(c(as('alice'), C1, 'messages', 'p1'), { 'votes.bob': 1 }));
      await assertFails(updateDoc(c(as('alice'), C1, 'messages', 'p1'), { 'votes.alice': 42 }));
      await assertFails(updateDoc(c(as('alice'), C1, 'messages', 'p1'), { 'votes.alice': 'oui' }));
      await assertFails(updateDoc(c(as('alice'), C1, 'messages', 'm1'), { 'votes.alice': 1 }));   // pas un sondage
      await assertFails(updateDoc(c(as('prof'), C1, 'messages', 'p1'), { 'votes.prof': 1 }));    // canal élèves
    });
    test('modifier son message : seulement l\'auteur, dans les 15 minutes', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(c(ctx.firestore(), C1, 'messages', 'recent'), { user_id: 'alice', epoch: 1, ...enc, pinned: false, created_at: Timestamp.now() });
        await setDoc(c(ctx.firestore(), C1, 'messages', 'vieux'), { user_id: 'alice', epoch: 1, ...enc, pinned: false, created_at: Timestamp.fromMillis(Date.now() - 3600e3) });
      });
      const edit = { iv: 'J'.repeat(16), ciphertext: 'D'.repeat(40), edited_at: serverTimestamp() };
      await assertSucceeds(updateDoc(c(as('alice'), C1, 'messages', 'recent'), edit));
      await assertFails(updateDoc(c(as('bob'), C1, 'messages', 'recent'), edit));
      await assertFails(updateDoc(c(as('dele'), C1, 'messages', 'recent'), edit));
      await assertFails(updateDoc(c(as('alice'), C1, 'messages', 'vieux'), edit));
      await assertFails(updateDoc(c(as('alice'), C1, 'messages', 'recent'), { ...edit, user_id: 'bob' }));
    });
    test('messages éphémères : 7 jours maximum, et conservés 30 jours comme preuve', async () => {
      await assertSucceeds(postMessage(as('alice'), 'alice', 'messages', { expire_at: Timestamp.fromMillis(Date.now() + 864e5) }));
      await assertFails(postMessage(as('bob'), 'bob', 'messages', { expire_at: Timestamp.fromMillis(Date.now() + 30 * 864e5) }));
      await assertFails(postMessage(as('depu'), 'depu', 'messages', { expire_at: Timestamp.fromMillis(Date.now() - 1000) }));
      await env.withSecurityRulesDisabled((ctx) => setDoc(c(ctx.firestore(), C1, 'messages', 'eph'), { user_id: 'alice', epoch: 1, ...enc, pinned: false, created_at: Timestamp.now(), expire_at: Timestamp.fromMillis(Date.now() - 864e5) }));
      await assertFails(deleteDoc(c(as('dele'), C1, 'messages', 'eph')));
    });
    test('messages programmés : invisibles pour les autres, jamais au nom d\'un autre', async () => {
      const sched = (uid, extra = {}) => ({ user_id: uid, channel: 'messages', epoch: 1, ...enc, send_at: Timestamp.fromMillis(Date.now() + 3600e3), created_at: serverTimestamp(), ...extra });
      await assertSucceeds(setDoc(c(as('alice'), C1, 'scheduled', 's1'), sched('alice')));
      await assertFails(setDoc(c(as('alice'), C1, 'scheduled', 's2'), sched('bob')));
      await assertFails(setDoc(c(as('alice'), C1, 'scheduled', 's3'), sched('alice', { channel: 'staff_messages' })));
      await assertFails(setDoc(c(as('alice'), C1, 'scheduled', 's4'), sched('alice', { channel: 'announcements' })));
      await assertFails(setDoc(c(as('alice'), C1, 'scheduled', 's5'), sched('alice', { send_at: Timestamp.fromMillis(Date.now() + 60 * 864e5) })));
      await assertFails(getDoc(c(as('bob'), C1, 'scheduled', 's1')));
      await assertFails(getDocs(collection(as('dele'), 'classes', C1, 'scheduled')));
      await assertSucceeds(getDocs(query(collection(as('alice'), 'classes', C1, 'scheduled'), where('user_id', '==', 'alice'))));
      await assertFails(deleteDoc(c(as('bob'), C1, 'scheduled', 's1')));
    });
    test('stickers : ajoutés par les membres, supprimés par leur auteur ou l\'équipe', async () => {
      const st = { by: 'alice', epoch: 1, ...enc, created_at: serverTimestamp() };
      await assertSucceeds(setDoc(c(as('alice'), C1, 'stickers', 'st1'), st));
      await assertFails(setDoc(c(as('bob'), C1, 'stickers', 'st2'), st));
      await assertFails(setDoc(c(as('eve'), C1, 'stickers', 'st3'), { ...st, by: 'eve' }));
      await assertFails(deleteDoc(c(as('bob'), C1, 'stickers', 'st1')));
      await assertSucceeds(deleteDoc(c(as('dele'), C1, 'stickers', 'st1')));
    });
    test('réactions : seulement les emojis de la liste (rien de lisible en clair)', async () => {
      await assertSucceeds(updateDoc(c(as('alice'), C1, 'messages', 'm1'), { 'reactions.alice': '🫡' }));
      await assertFails(updateDoc(c(as('alice'), C1, 'messages', 'm1'), { 'reactions.alice': 'message secret' }));
    });
    test('XP et badges : chacun écrit seulement ses propres compteurs', async () => {
      const st = { xp: 10, streak: 1, best_streak: 1, last_day: 100, week: 14, w: {}, total: {}, badges: [], updated_at: serverTimestamp() };
      await assertSucceeds(setDoc(c(as('alice'), C1, 'stats', 'alice'), st));
      await assertFails(setDoc(c(as('alice'), C1, 'stats', 'bob'), st));
      await assertFails(setDoc(c(as('alice'), C1, 'stats', 'alice'), { ...st, xp: -5 }));
      await assertFails(setDoc(c(as('alice'), C1, 'stats', 'alice'), { ...st, admin: true }));
      await assertFails(getDoc(c(as('eve'), C1, 'stats', 'alice')));
    });
    test('compliments & playlist : signés par leur auteur, cœurs seulement pour soi', async () => {
      const post = { kind: 'compliment', by: 'alice', to: 'bob', epoch: 1, ...enc, created_at: serverTimestamp() };
      await assertSucceeds(setDoc(c(as('alice'), C1, 'board', 'b1'), post));
      await assertFails(setDoc(c(as('alice'), C1, 'board', 'b2'), { ...post, by: 'bob' }));
      await assertFails(setDoc(c(as('alice'), C1, 'board', 'b3'), { ...post, kind: 'pub' }));
      await assertSucceeds(updateDoc(c(as('dele'), C1, 'board', 'b1'), { 'likes.dele': true }));
      await assertFails(updateDoc(c(as('dele'), C1, 'board', 'b1'), { 'likes.alice': true }));
      await assertFails(deleteDoc(c(as('pend'), C1, 'board', 'b1')));
      await assertSucceeds(deleteDoc(c(as('bob'), C1, 'board', 'b1')));   // la personne visée peut effacer
    });
    test('capsule temporelle : scellée jusqu\'à sa date, même pour les délégués', async () => {
      const at = Timestamp.fromMillis(Date.now() + 30 * 864e5);
      const alice = as('alice');
      const b = writeBatch(alice);
      b.set(c(alice, C1, 'capsules', 'k1'), { by: 'alice', open_at: at, epoch: 1, ...enc, created_at: serverTimestamp() });
      b.set(c(alice, C1, 'capsule_dates', 'k1'), { by: 'alice', open_at: at });
      await assertSucceeds(b.commit());
      await assertSucceeds(getDoc(c(as('alice'), C1, 'capsules', 'k1')));
      await assertFails(getDoc(c(as('dele'), C1, 'capsules', 'k1')));
      await assertSucceeds(getDoc(c(as('dele'), C1, 'capsule_dates', 'k1')));
      await env.withSecurityRulesDisabled((ctx) => setDoc(c(ctx.firestore(), C1, 'capsules', 'k2'), { by: 'alice', open_at: Timestamp.fromMillis(Date.now() - 1000), epoch: 1, ...enc }));
      await assertSucceeds(getDoc(c(as('bob'), C1, 'capsules', 'k2')));
    });
    test('carte d\'anniversaire : cachée à la personne fêtée, chacun signe seulement pour soi', async () => {
      const at = new Date(Date.now() + 10 * 864e5);
      const id = `bob_${at.getUTCFullYear()}`;
      await assertSucceeds(setDoc(c(as('alice'), C1, 'cards', id), { target: 'bob', open_at: Timestamp.fromDate(at), epoch: 1, signatures: {} }));
      await assertSucceeds(updateDoc(c(as('alice'), C1, 'cards', id), { 'signatures.alice': { iv: 'I'.repeat(16), ciphertext: 'C'.repeat(40) } }));
      await assertFails(updateDoc(c(as('alice'), C1, 'cards', id), { 'signatures.dele': { iv: 'I'.repeat(16), ciphertext: 'C'.repeat(40) } }));
      await assertFails(getDoc(c(as('bob'), C1, 'cards', id)));
      await assertFails(setDoc(c(as('bob'), C1, 'cards', `bob_${at.getUTCFullYear() + 1}`), { target: 'bob', open_at: Timestamp.fromDate(at), epoch: 1, signatures: {} }));
    });
    test('album de fin d\'année : un vote pour un autre membre de la classe', async () => {
      await assertSucceeds(setDoc(c(as('dele'), C1, 'awards', 'aw'), { title: 'Le plus drôle', open: true, votes: {}, created_at: serverTimestamp() }));
      await assertFails(setDoc(c(as('alice'), C1, 'awards', 'aw2'), { title: 'Triche', open: true, votes: {}, created_at: serverTimestamp() }));
      await assertSucceeds(updateDoc(c(as('alice'), C1, 'awards', 'aw'), { 'votes.alice': 'bob' }));
      await assertFails(updateDoc(c(as('alice'), C1, 'awards', 'aw'), { 'votes.alice': 'alice' }));
      await assertFails(updateDoc(c(as('alice'), C1, 'awards', 'aw'), { 'votes.bob': 'alice' }));
      await assertFails(updateDoc(c(as('alice'), C1, 'awards', 'aw'), { 'votes.alice': 'eve' }));
    });
    test('mini-jeux : seuls les deux joueurs jouent, chacun à son tour', async () => {
      const g = { kind: 'ttt', players: ['alice', 'bob'], turn: 'alice', board: '.........', winner: '', commits: {}, reveals: {}, created_at: serverTimestamp(), updated_at: serverTimestamp() };
      await assertSucceeds(setDoc(c(as('alice'), C1, 'games', 'g1'), g));
      await assertFails(setDoc(c(as('alice'), C1, 'games', 'g2'), { ...g, players: ['bob', 'alice'] }));
      await assertFails(updateDoc(c(as('bob'), C1, 'games', 'g1'), { board: 'X........', turn: 'alice', updated_at: serverTimestamp() }));
      await assertFails(updateDoc(c(as('dele'), C1, 'games', 'g1'), { board: 'X........', turn: 'bob', updated_at: serverTimestamp() }));
      await assertSucceeds(updateDoc(c(as('alice'), C1, 'games', 'g1'), { board: 'X........', turn: 'bob', winner: '', updated_at: serverTimestamp() }));
      await assertFails(updateDoc(c(as('bob'), C1, 'games', 'g1'), { winner: 'bob', updated_at: serverTimestamp() }));   // on n'abandonne qu'au profit de l'autre
    });
    test('quiz en direct : réponse chronométrée, une seule par question, au nom de soi', async () => {
      await env.withSecurityRulesDisabled((ctx) => setDoc(c(ctx.firestore(), C1, 'quizzes', 'q1'), { host: 'dele', title: 'Quiz', epoch: 1, ...enc, count: 3, phase: 'question', index: 0, started_at: Timestamp.now(), answer: null }));
      const ans = (uid, extra = {}) => ({ uid, index: 0, choice: 1, at: serverTimestamp(), ...extra });
      await assertSucceeds(setDoc(c(as('alice'), C1, 'quizzes', 'q1', 'answers', 'alice_0'), ans('alice')));
      await assertFails(setDoc(c(as('alice'), C1, 'quizzes', 'q1', 'answers', 'alice_0'), ans('alice', { choice: 2 })));
      await assertFails(setDoc(c(as('alice'), C1, 'quizzes', 'q1', 'answers', 'bob_0'), ans('bob')));
      await assertFails(setDoc(c(as('bob'), C1, 'quizzes', 'q1', 'answers', 'bob_1'), ans('bob', { index: 1 })));
      await assertFails(updateDoc(c(as('alice'), C1, 'quizzes', 'q1'), { phase: 'end' }));
    });
    test('boîte à idées et questions aux profs : anonymes, limitées par l\'anti-spam', async () => {
      const anon = (db, name, id) => { const b = writeBatch(db); b.set(c(db, C1, name, id), { epoch: 1, ...enc, created_at: serverTimestamp() }); b.set(c(db, C1, 'rate', 'alice'), { last: serverTimestamp() }); return b.commit(); };
      await assertSucceeds(anon(as('alice'), 'ideas', 'i1'));
      await assertFails(setDoc(c(as('bob'), C1, 'ideas', 'i2'), { epoch: 1, ...enc, created_at: serverTimestamp() }));   // sans anti-spam
      await assertFails(setDoc(c(as('bob'), C1, 'ideas', 'i3'), { epoch: 1, ...enc, created_at: serverTimestamp(), by: 'bob' }));
      await assertFails(getDoc(c(as('bob'), C1, 'ideas', 'i1')));
      await assertSucceeds(getDoc(c(as('dele'), C1, 'ideas', 'i1')));
      await env.withSecurityRulesDisabled((ctx) => setDoc(c(ctx.firestore(), C1, 'questions', 'qq'), { epoch: 1, ...enc, created_at: Timestamp.now() }));
      const reply = { answer_epoch: 1, answer_iv: 'I'.repeat(16), answer_ct: 'C'.repeat(40), answered_by: 'prof' };
      await assertFails(updateDoc(c(as('alice'), C1, 'questions', 'qq'), { ...reply, answered_by: 'alice' }));
      await assertSucceeds(updateDoc(c(as('prof'), C1, 'questions', 'qq'), reply));
    });
    test('questionnaires : réponses lues seulement par l\'auteur et les délégués', async () => {
      await assertSucceeds(setDoc(c(as('prof'), C1, 'surveys', 'sv'), { by: 'prof', anonymous: false, open: true, epoch: 1, ...enc, created_at: serverTimestamp() }));
      await assertFails(setDoc(c(as('alice'), C1, 'surveys', 'sv2'), { by: 'alice', anonymous: false, open: true, epoch: 1, ...enc, created_at: serverTimestamp() }));
      await assertSucceeds(setDoc(c(as('alice'), C1, 'surveys', 'sv', 'answers', 'alice'), { epoch: 1, ...enc, created_at: serverTimestamp() }));
      await assertFails(setDoc(c(as('alice'), C1, 'surveys', 'sv', 'answers', 'bob'), { epoch: 1, ...enc, created_at: serverTimestamp() }));
      await assertFails(getDoc(c(as('bob'), C1, 'surveys', 'sv', 'answers', 'alice')));
      await assertSucceeds(getDoc(c(as('prof'), C1, 'surveys', 'sv', 'answers', 'alice')));
    });
    test('organisation : chacun coche seulement ce qu\'il apporte, seul l\'organisateur coche qui a payé', async () => {
      await assertSucceeds(setDoc(c(as('alice'), C1, 'org', 'l1'), { kind: 'list', by: 'alice', claims: {}, epoch: 1, ...enc, created_at: serverTimestamp() }));
      await assertSucceeds(updateDoc(c(as('bob'), C1, 'org', 'l1'), { 'claims.bob': [0, 2] }));
      await assertFails(updateDoc(c(as('bob'), C1, 'org', 'l1'), { 'claims.alice': [1] }));
      await assertSucceeds(setDoc(c(as('alice'), C1, 'org', 'k1'), { kind: 'kitty', by: 'alice', paid: {}, epoch: 1, ...enc, created_at: serverTimestamp() }));
      await assertFails(updateDoc(c(as('bob'), C1, 'org', 'k1'), { 'paid.bob': true }));
      await assertSucceeds(updateDoc(c(as('alice'), C1, 'org', 'k1'), { 'paid.bob': true }));
      await assertFails(setDoc(c(as('alice'), C1, 'org', 'm1'), { kind: 'minutes', by: 'alice', epoch: 1, ...enc, created_at: serverTimestamp() }));
    });
    test('carnet de notes : lisible seulement par son propriétaire', async () => {
      await assertSucceeds(setDoc(doc(as('alice'), 'private_data', 'alice'), { ...enc, updated_at: serverTimestamp() }));
      await assertFails(getDoc(doc(as('dele'), 'private_data', 'alice')));
      await assertFails(setDoc(doc(as('bob'), 'private_data', 'alice'), { ...enc, updated_at: serverTimestamp() }));
    });
    test('flashcards partagées : signées par leur auteur', async () => {
      await assertSucceeds(setDoc(c(as('alice'), C1, 'decks', 'd1'), { by: 'alice', count: 20, epoch: 1, ...enc, created_at: serverTimestamp() }));
      await assertFails(setDoc(c(as('alice'), C1, 'decks', 'd2'), { by: 'bob', count: 20, epoch: 1, ...enc, created_at: serverTimestamp() }));
      await assertFails(deleteDoc(c(as('bob'), C1, 'decks', 'd1')));
    });
    test('« on révise ensemble » : chacun rejoint pour soi, une session en cours ne peut pas être volée', async () => {
      const room = (uid) => ({ by: uid, focus: 25, pause: 5, rounds: 4, start: Date.now(), people: { [uid]: true }, updated_at: serverTimestamp() });
      await assertSucceeds(setDoc(c(as('alice'), C1, 'study_room', 'current'), room('alice')));
      await assertSucceeds(updateDoc(c(as('bob'), C1, 'study_room', 'current'), { 'people.bob': true, updated_at: serverTimestamp() }));
      await assertFails(updateDoc(c(as('bob'), C1, 'study_room', 'current'), { 'people.alice': deleteField(), updated_at: serverTimestamp() }));
      await assertFails(setDoc(c(as('bob'), C1, 'study_room', 'current'), room('bob')));
      await assertFails(setDoc(c(as('bob'), C1, 'study_room', 'autre'), room('bob')));
    });
    test('sourdine : un élève réduit au silence ne peut plus écrire (7 jours max, jamais un prof)', async () => {
      await assertFails(updateDoc(doc(as('alice'), 'users', 'bob'), { muted_until: Timestamp.fromMillis(Date.now() + 3600e3) }));
      await assertFails(updateDoc(doc(as('dele'), 'users', 'bob'), { muted_until: Timestamp.fromMillis(Date.now() + 30 * 864e5) }));
      await assertFails(updateDoc(doc(as('dele'), 'users', 'prof'), { muted_until: Timestamp.fromMillis(Date.now() + 3600e3) }));
      await assertSucceeds(updateDoc(doc(as('dele'), 'users', 'bob'), { muted_until: Timestamp.fromMillis(Date.now() + 3600e3) }));
      await assertFails(postMessage(as('bob'), 'bob'));
      await assertFails(updateDoc(doc(as('bob'), 'users', 'bob'), { muted_until: null }));
      await assertSucceeds(postMessage(as('alice'), 'alice'));
    });
    test('un élève envoie plusieurs messages de suite (au rythme normal)', async () => {
      await env.withSecurityRulesDisabled((ctx) => setDoc(c(ctx.firestore(), C1, 'rate', 'alice'), { last: Timestamp.fromMillis(Date.now() - 5000) }));
      await assertSucceeds(postMessage(as('alice'), 'alice'));
      await assertSucceeds(postMessage(as('prof'), 'prof', 'mixed_messages'));
      await assertFails(postMessage(as('alice'), 'alice'));   // moins d'une seconde après
    });
    test('mode lent : les élèves attendent entre deux messages, pas l\'équipe', async () => {
      await assertFails(updateDoc(c(as('alice'), C1), { slow: 30 }));
      await assertSucceeds(updateDoc(c(as('prof'), C1), { slow: 30 }));
      await env.withSecurityRulesDisabled(async (ctx) => {
        for (const u of ['alice', 'dele']) await setDoc(c(ctx.firestore(), C1, 'rate', u), { last: Timestamp.fromMillis(Date.now() - 5000) });
      });
      await assertFails(postMessage(as('alice'), 'alice'));
      await assertSucceeds(postMessage(as('dele'), 'dele'));
    });
    test('passation : un suppléant a les pouvoirs du délégué seulement pendant la période donnée', async () => {
      await assertFails(updateDoc(doc(as('depu'), 'users', 'pend'), { status: 'active' }));
      await assertFails(updateDoc(doc(as('alice'), 'users', 'depu'), { acting_until: Timestamp.fromMillis(Date.now() + 864e5) }));
      await assertFails(updateDoc(doc(as('dele'), 'users', 'bob'), { acting_until: Timestamp.fromMillis(Date.now() + 864e5) }));
      await assertSucceeds(updateDoc(doc(as('dele'), 'users', 'depu'), { acting_until: Timestamp.fromMillis(Date.now() + 864e5) }));
      await assertSucceeds(updateDoc(doc(as('depu'), 'users', 'pend'), { status: 'active' }));
      await assertFails(updateDoc(doc(as('depu'), 'users', 'depu'), { acting_until: Timestamp.fromMillis(Date.now() + 20 * 864e5) }));
    });
    test('journal de modération : écrit par l\'équipe à son nom, lu par délégués et profs', async () => {
      const log = (by) => ({ action: 'mute', target: 'bob', channel: '', detail: '1 h', by, at: serverTimestamp() });
      await assertSucceeds(setDoc(c(as('dele'), C1, 'modlog', 'l1'), log('dele')));
      await assertFails(setDoc(c(as('dele'), C1, 'modlog', 'l2'), log('prof')));
      await assertFails(setDoc(c(as('alice'), C1, 'modlog', 'l3'), log('alice')));
      await assertFails(getDoc(c(as('alice'), C1, 'modlog', 'l1')));
      await assertFails(updateDoc(c(as('dele'), C1, 'modlog', 'l1'), { detail: 'rien' }));
      await assertSucceeds(getDoc(c(as('prof'), C1, 'modlog', 'l1')));
    });
    test('mots interdits et message d\'accueil : réglés par les délégués / profs', async () => {
      const set = (by) => ({ epoch: 1, ...enc, updated_by: by, updated_at: serverTimestamp() });
      await assertSucceeds(setDoc(c(as('dele'), C1, 'settings', 'filter'), set('dele')));
      await assertFails(setDoc(c(as('alice'), C1, 'settings', 'filter'), set('alice')));
      await assertFails(setDoc(c(as('dele'), C1, 'settings', 'autre'), set('dele')));
      await assertSucceeds(getDoc(c(as('alice'), C1, 'settings', 'filter')));
    });
    test('rappels : privés', async () => {
      await assertSucceeds(setDoc(c(as('alice'), C1, 'reminders', 'r1'), { user_id: 'alice', at: Timestamp.fromMillis(Date.now() + 3600e3), epoch: 1, ...enc, created_at: serverTimestamp() }));
      await assertFails(getDoc(c(as('dele'), C1, 'reminders', 'r1')));
      await assertFails(setDoc(c(as('alice'), C1, 'reminders', 'r2'), { user_id: 'bob', at: Timestamp.fromMillis(Date.now() + 3600e3), epoch: 1, ...enc, created_at: serverTimestamp() }));
    });
    test('semaines A / B : cours marqués A ou B, et seul un délégué fixe la semaine A', async () => {
      await assertSucceeds(setDoc(c(as('dele'), C1, 'slots', 'sa'), { ...slot, week: 'A' }));
      await assertFails(setDoc(c(as('dele'), C1, 'slots', 'sc'), { ...slot, week: 'C' }));
      await assertFails(setDoc(c(as('alice'), C1, 'slots', 'sb'), { ...slot, week: 'B' }));
      await assertSucceeds(updateDoc(c(as('dele'), C1), { week_a: '2030-01-14' }));
      await assertFails(updateDoc(c(as('dele'), C1), { week_a: 'lundi' }));
      await assertFails(updateDoc(c(as('alice'), C1), { week_a: '2030-01-14' }));
    });
  });
});

// =====================================================================================================
describe('Vague 9 — appareils et notifications', () => {
  const dev = (uid, extra = {}) => ({ uid, name: 'Chrome · Windows', created_at: serverTimestamp(), last_seen: serverTimestamp(), revoked: false, ...extra });
  const ID = 'abcdefghijklmnop1234';
  test('appareils : chacun ne voit et ne gère que les siens', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'devices', `alice_${ID}`), dev('alice')));
    await assertFails(setDoc(doc(as('bob'), 'devices', `alice_${ID}X`), dev('bob')));
    await assertFails(setDoc(doc(as('bob'), 'devices', `bob_${ID}`), dev('alice')));
    await assertFails(setDoc(doc(as('bob'), 'devices', `bob_${ID}`), dev('bob', { revoked: true })));
    await assertSucceeds(getDoc(doc(as('alice'), 'devices', `alice_${ID}`)));
    await assertSucceeds(getDoc(doc(as('alice'), 'devices', `alice_${ID}zz`)));
    await assertFails(getDoc(doc(as('bob'), 'devices', `alice_${ID}`)));
    await assertSucceeds(getDocs(query(collection(as('alice'), 'devices'), where('uid', '==', 'alice'))));
    await assertFails(getDocs(collection(as('bob'), 'devices')));
    await assertFails(updateDoc(doc(as('bob'), 'devices', `alice_${ID}`), { revoked: true }));
    await assertFails(deleteDoc(doc(as('bob'), 'devices', `alice_${ID}`)));
  });
  test('déconnexion à distance : définitive, et plus de « je suis encore là » ensuite', async () => {
    const ref = doc(as('alice'), 'devices', `alice_${ID}`);
    await assertSucceeds(setDoc(ref, dev('alice')));
    await assertSucceeds(updateDoc(ref, { last_seen: serverTimestamp() }));
    await assertFails(updateDoc(ref, { uid: 'bob' }));
    await assertSucceeds(updateDoc(ref, { revoked: true }));
    await assertFails(updateDoc(ref, { revoked: false }));
    await assertFails(updateDoc(ref, { last_seen: serverTimestamp() }));
    await assertSucceeds(deleteDoc(ref));
  });
  test('heures calmes et résumé du matin : format vérifié', async () => {
    const tok = (extra) => ({ uid: 'alice', token: 'T'.repeat(40), updated_at: serverTimestamp(), ...extra });
    const ref = doc(as('alice'), 'push_tokens', 'tok2');
    await assertSucceeds(setDoc(ref, tok({ quiet: { from: 1320, to: 420 }, digest: true, tz: 'Europe/Paris' })));
    await assertSucceeds(setDoc(ref, tok({ quiet: null, digest: false, tz: 'Europe/Paris' })));
    await assertFails(setDoc(ref, tok({ quiet: { from: 1320, to: 2000 } })));
    await assertFails(setDoc(ref, tok({ quiet: { from: 60, to: 60 } })));
    await assertFails(setDoc(ref, tok({ quiet: { from: 60, to: 120, extra: 1 } })));
    await assertFails(setDoc(ref, tok({ digest: 'oui' })));
    await assertFails(setDoc(ref, tok({ tz: '' })));
  });
});
