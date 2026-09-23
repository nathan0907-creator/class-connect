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
  ['on peut écrire au nom d\'un autre', "&& request.resource.data.user_id == uid()\n          && request.resource.data.epoch == get(classPath(cid)).data.key_epoch", "&& request.resource.data.epoch == get(classPath(cid)).data.key_epoch"],
  ['conseil de classe lisible par toute la classe', "allow read: if isCouncilStaff() || (isActiveMember(cid) && resource.data.student_id == uid());", 'allow read: if isActiveMember(cid);'],
  ['vrai nom lisible par tous', "allow read: if (isActiveMember(cid) && userId == uid()) || namesStaff();", 'allow read: if isActiveMember(cid);'],
  ['messages privés lisibles par toute la classe', "allow read: if isActiveMember(cid) && (sid == uid() || isDelegate(cid)", 'allow read: if isActiveMember(cid) && (true || isDelegate(cid)'],
  ['pas d\'anti-spam', "|| request.time > resource.data.last + duration.value(1, 's'));", '|| true);'],
  ['jetons de notification lisibles', "match /push_tokens/{id} {\n      allow read: if false;", "match /push_tokens/{id} {\n      allow read: if signedIn();"],
  ['réactions des autres modifiables', ".affectedKeys().hasOnly([uid()])", '.affectedKeys().size() >= 0'],
  ['adhésion sans validation', "&& a.status == 'pending' && a.invite_code is string", "&& a.status in ['pending', 'active'] && a.invite_code is string"],
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
