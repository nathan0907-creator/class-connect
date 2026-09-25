// NIVEAU 3+ — test de mutation : on affaiblit volontairement une règle à la fois ;
// si les tests de sécurité ne le remarquent pas, c'est qu'ils ne protègent pas vraiment ce point.
// Lancer (émulateur démarré par le script npm) : npm run test:mutation
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const original = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

const MUTANTS = [
  ['un élève peut lire la salle des profs', "|| (ch == 'staff_messages' && isTeacher(cid))", "|| (ch == 'staff_messages' && isActiveMember(cid))"],
  ['un élève peut se nommer délégué', "(onlyChanged(['display_name', 'color', 'public_key'])", "(onlyChanged(['display_name', 'color', 'public_key', 'role'])"],
  ['on peut écrire au nom d\'un autre', "&& request.resource.data.user_id == uid() && notMuted()\n          && request.resource.data.epoch", "&& notMuted()\n          && request.resource.data.epoch"],
  ['conseil de classe lisible par toute la classe', "allow read: if isCouncilStaff() || (isActiveMember(cid) && resource.data.student_id == uid());", 'allow read: if isActiveMember(cid);'],
  ['vrai nom lisible par tous', "allow read: if (isActiveMember(cid) && userId == uid()) || namesStaff();", 'allow read: if isActiveMember(cid);'],
  ['messages privés lisibles par toute la classe', "allow read: if isActiveMember(cid) && (sid == uid() || isDelegate(cid)", 'allow read: if isActiveMember(cid) && (true || isDelegate(cid)'],
  ['pas d\'anti-spam', "|| request.time > resource.data.last + duration.value(slowSecs(cid), 's'));", '|| true);'],
  ['un élève réduit au silence peut quand même écrire', '&& request.resource.data.user_id == uid() && notMuted()', '&& request.resource.data.user_id == uid()'],
  ['suppression par un modérateur sans trace', "(r.user_id == uid() || (mod && logged(mid + '_del')))", '(r.user_id == uid() || mod)'],
  ['jetons de notification lisibles', "match /push_tokens/{id} {\n      allow read: if false;", "match /push_tokens/{id} {\n      allow read: if signedIn();"],
  ['réactions des autres modifiables', "d.reactions.diff(r.get('reactions', {})).affectedKeys().hasOnly([uid()])", 'true'],
  ['adhésion sans validation', "&& a.status == 'pending' && a.invite_code is string", "&& a.status in ['pending', 'active'] && a.invite_code is string"],
  ['nommer prof en donnant aussi « prof principal »', "&& notTrusted(a) && notPrincipal(a)\n            && ((b.role != 'teacher'", "&& notTrusted(a)\n            && ((b.role != 'teacher'"],
  ['vraie adresse e-mail publiée avec le pseudo', "&& request.resource.data.email == name + '@pseudo.class-connect.invalid'", ''],
  ['couleur non vérifiée (injection CSS)', "str(a.display_name, 1, 40) && validColor(a.color)", 'str(a.display_name, 1, 40)'],
  ['nouvelle clé sans revalidation', "(a.public_key == b.public_key || b.status != 'active' || b.role == 'delegate')", 'true'],
  ['code professeurs lisible par les élèves', "match /secrets/{docId} {\n        allow read: if isDelegate(cid);", "match /secrets/{docId} {\n        allow read: if isActiveMember(cid);"],
  ['un élève publie dans les annonces', "(ch != 'announcements' || isStaff(cid) || d.get('kind', '') == 'alert')", 'true'],
  ['alerte signée au nom d\'un autre', '&& request.resource.data.slot_id is string && request.resource.data.by == uid()', '&& request.resource.data.slot_id is string'],
  ['voter à la place d\'un autre', "d.votes.diff(r.get('votes', {})).affectedKeys().hasOnly([uid()])", 'true'],
  ['réécrire un vieux message', "&& request.time < r.created_at + duration.value(15, 'm')", ''],
  ['messages programmés lisibles par tous', 'allow read, delete: if signedIn() && resource.data.user_id == uid();', 'allow read, delete: if signedIn();'],
  ['capsule lisible avant sa date', "(resource.data.by == uid() || request.time >= resource.data.open_at)", 'true'],
  ['boîte à idées lisible par les élèves', "match /ideas/{iid} {\n        allow read: if isDelegate(cid) || isTeacher(cid);", "match /ideas/{iid} {\n        allow read: if isActiveMember(cid);"],
  ['compteurs XP d\'un autre modifiables', "allow create, update: if isActiveMember(cid) && userId == uid()\n          && request.resource.data.keys().hasOnly(['xp'", "allow create, update: if isActiveMember(cid)\n          && request.resource.data.keys().hasOnly(['xp'"],
  ['jouer à la place de l\'adversaire', "(resource.data.kind in ['ttt', 'c4'] && resource.data.turn == uid()", "(resource.data.kind in ['ttt', 'c4']"],
  ['déconnecter l\'appareil d\'un autre', "allow update: if signedIn() && resource.data.uid == uid() && (\n        (request.resource.data.diff", "allow update: if signedIn() && (\n        (request.resource.data.diff"],
  ['annuler une déconnexion à distance', "hasOnly(['revoked']) && request.resource.data.revoked == true)", "hasOnly(['revoked']))"],
  ['liste des appareils d\'un autre', "allow get: if signedIn() && id.matches('^' + uid() + '_[A-Za-z0-9_-]{16,40}$');", 'allow get: if signedIn();'],
  ['clé privée lisible par tous', "match /private/{userId} {\n      allow read: if signedIn() && userId == uid();", "match /private/{userId} {\n      allow read: if signedIn();"],
];

let survived = 0;
for (const [name, from, to] of MUTANTS) {
  if (!original.includes(from)) { console.log(`⚠  mutant introuvable (règle modifiée ?) : ${name}`); survived++; continue; }
  const file = path.join(os.tmpdir(), `cc-mutant-${Date.now()}.rules`);
  fs.writeFileSync(file, original.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', path.join(root, 'tests', 'rules.test.mjs')], {
    env: { ...process.env, RULES_FILE: file }, encoding: 'utf8',
  });
  fs.rmSync(file, { force: true });
  const failed = Number(r.stdout.match(/ℹ fail (\d+)/)?.[1] || 0);
  if (failed > 0) console.log(`✔ détecté (${failed} test(s) en échec) : ${name}`);
  else { console.log(`✖ NON DÉTECTÉ : ${name}`); survived++; }
}
console.log(survived ? `\n${survived} faiblesse(s) non détectée(s) par les tests` : `\nTous les ${MUTANTS.length} affaiblissements ont été détectés ✔`);
process.exit(survived ? 1 : 0);
