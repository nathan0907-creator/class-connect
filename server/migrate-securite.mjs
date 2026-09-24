// Class Connect — migration de sécurité (septembre 2026). À lancer UNE fois, depuis ce dossier, sur le vieux PC :
//   node migrate-securite.mjs              → simulation : affiche seulement ce qui serait changé
//   node migrate-securite.mjs --appliquer  → applique (sans risque de le relancer : ce qui est fait est sauté)
//
// 1. Comptes « pseudo » : leur adresse de connexion passe de @users.classconnect.app (un domaine qui appartient à
//    quelqu'un d'autre : il pourrait recevoir les liens « mot de passe oublié ») à @pseudo.class-connect.invalid
//    (domaine réservé, qui ne reçoit jamais de mail). Le mot de passe ne change pas.
// 2. Comptes avec e-mail : l'adresse est retirée de /usernames (lisible par n'importe qui à partir du pseudo).
// 3. Code professeurs : sorti du document de la classe (lisible par tous les élèves) → classes/{id}/secrets/codes.
// 4. Couleurs de membre invalides → couleur par défaut.
// Rien de personnel n'est affiché : seulement des nombres.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const OLD = '@users.classconnect.app';
const NEW = '@pseudo.class-connect.invalid';
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Admin access: the service key, or the local emulators (tests) when FIRESTORE_EMULATOR_HOST is set. */
export function connect(projectId = 'demo-classconnect') {
  if (process.env.FIRESTORE_EMULATOR_HOST) initializeApp({ projectId });
  else {
    const keyFile = process.env.CC_KEY_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), 'service-account.json');
    initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyFile, 'utf8'))) });
  }
  return { db: getFirestore(), auth: getAuth() };
}

export async function migrate({ db, auth, apply = false }) {
  const n = { pseudos: 0, emails_retires: 0, codes_profs: 0, couleurs: 0, ignores: 0 };

  for (const d of (await db.collection('usernames').get()).docs) {
    const { uid, email } = d.data();
    if (!email || email.endsWith(NEW)) continue;
    if (email.endsWith(OLD)) {
      // Only when everything matches (pseudo ↔ address ↔ account): anything unexpected is left untouched.
      const user = await auth.getUser(uid).catch(() => null);
      if (email !== d.id + OLD || user?.email !== email) { n.ignores++; continue; }
      if (apply) {
        await auth.updateUser(uid, { email: d.id + NEW });
        await d.ref.update({ email: d.id + NEW });
      }
      n.pseudos++;
    } else {
      if (apply) await d.ref.update({ email: FieldValue.delete() });
      n.emails_retires++;
    }
  }

  for (const c of (await db.collection('classes').get()).docs) {
    const code = c.get('teacher_code');
    if (!code) continue;
    if (apply) {
      const batch = db.batch();
      batch.set(c.ref.collection('secrets').doc('codes'), { teacher_code: code });
      batch.update(c.ref, { teacher_code: FieldValue.delete() });
      await batch.commit();
    }
    n.codes_profs++;
  }

  for (const u of (await db.collection('users').get()).docs) {
    if (COLOR.test(u.get('color') || '')) continue;
    if (apply) await u.ref.update({ color: '#7c5cff' });
    n.couleurs++;
  }
  return n;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const apply = process.argv.includes('--appliquer');
  const n = await migrate({ ...connect(), apply });
  console.log(apply ? '✔ Migration appliquée :' : 'Simulation (rien n\'a été modifié) :');
  console.log(`  • comptes pseudo déplacés vers le domaine réservé : ${n.pseudos}`);
  console.log(`  • adresses e-mail retirées de /usernames : ${n.emails_retires}`);
  console.log(`  • codes professeurs mis à l'abri : ${n.codes_profs}`);
  console.log(`  • couleurs invalides corrigées : ${n.couleurs}`);
  if (n.ignores) console.log(`  • ignorés (données inattendues, laissés tels quels) : ${n.ignores}`);
  if (!apply) console.log('\nPour appliquer : node migrate-securite.mjs --appliquer');
  process.exit(0);
}
