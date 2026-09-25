// Class Connect — serveur de notifications (à faire tourner sur un vieux PC allumé en permanence).
// Gratuit : Firebase Cloud Messaging ne coûte rien, et les lectures Firestore restent dans le quota gratuit
// (les membres et les appareils sont gardés en mémoire, un nouveau message ne coûte presque aucune lecture).
//
// Les messages sont chiffrés de bout en bout : ce serveur ne peut PAS les lire. Il sait seulement que quelqu'un a
// écrit dans un canal, et envoie « Nouveau message de <pseudo> » aux appareils des membres qui ont accès à ce canal.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { clockIn, inQuiet, weekLetter, digestText } from './clock.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = process.env.CC_KEY_FILE || path.join(here, 'service-account.json');
const SITE = 'https://nathan0907-creator.github.io/class-connect/';
const CHANNELS = {
  messages: { label: 'Classe', canRead: (role) => role !== 'teacher' },
  mixed_messages: { label: 'Profs & élèves', canRead: () => true },
  staff_messages: { label: 'Salle des profs', canRead: (role) => role === 'teacher' },
  announcements: { label: 'Annonces', canRead: () => true },
};
const DEAD_TOKEN = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);

const log = (...a) => console.log(new Date().toLocaleString('fr-FR'), '·', ...a);

if (!fs.existsSync(KEY_FILE)) {
  console.error(`\n❌ Clé introuvable : ${KEY_FILE}\n   Suis l'étape 2 du fichier LISEZMOI.md (télécharger la clé du compte de service).\n`);
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'))) });
const db = getFirestore();

// ------------------------------------------------------------ in-memory copies (kept up to date live)
const users = new Map();    // uid -> { class_id, status, role, display_name }
const tokens = new Map();   // docId -> { uid, token }
const classes = new Map();  // cid -> name
const weekA = new Map();    // cid -> "YYYY-MM-DD" of a week A day (timetables alternating A/B weeks)
const ready = { users: false, tokens: false, classes: false };

function watch(name, ref, onSnap) {
  ref.onSnapshot((snap) => {
    onSnap(snap);
    if (!ready[name]) { ready[name] = true; log(`✔ ${name} chargés (${snap.size})`); }
  }, (err) => { log(`⚠ écoute ${name} interrompue :`, err.message, '→ redémarrage dans 30 s'); setTimeout(() => process.exit(1), 30000); });
}

watch('users', db.collection('users').where('status', '==', 'active'), (snap) => {
  for (const c of snap.docChanges()) {
    if (c.type === 'removed') users.delete(c.doc.id);
    else users.set(c.doc.id, c.doc.data());
  }
});
watch('tokens', db.collection('push_tokens'), (snap) => {
  for (const c of snap.docChanges()) {
    if (c.type === 'removed') tokens.delete(c.doc.id);
    else tokens.set(c.doc.id, { uid: c.doc.get('uid'), token: c.doc.get('token'), quiet: c.doc.get('quiet') || null, digest: !!c.doc.get('digest'), tz: c.doc.get('tz') || 'Europe/Paris' });
  }
});
watch('classes', db.collection('classes'), (snap) => {
  for (const c of snap.docChanges()) {
    if (c.type === 'removed') classes.delete(c.doc.id);
    else { classes.set(c.doc.id, c.doc.get('name')); weekA.set(c.doc.id, c.doc.get('week_a') || null); }
  }
});

// ------------------------------------------------------------ new messages → notifications
const startedAt = Timestamp.now();
for (const [channel, ch] of Object.entries(CHANNELS)) {
  db.collectionGroup(channel).where('created_at', '>', startedAt).onSnapshot((snap) => {
    for (const c of snap.docChanges()) {
      if (c.type !== 'added') continue;
      const cid = c.doc.ref.parent.parent?.id;
      if (cid) notifyClass(cid, channel, ch, c.doc.data()).catch((err) => log('⚠ envoi :', err.message));
    }
  }, (err) => {
    log(`⚠ écoute ${channel} interrompue :`, err.message);
    if (/index/i.test(err.message)) log('   → Index manquant : lance « firebase deploy --only firestore:indexes » depuis le dossier du site.');
    setTimeout(() => process.exit(1), 30000);
  });
}

async function notifyClass(cid, channel, ch, msg) {
  const sender = users.get(msg.user_id);
  if (!sender || sender.class_id !== cid) return;
  const recipients = new Set([...users].filter(([uid, u]) => uid !== msg.user_id && u.class_id === cid && ch.canRead(u.role)).map(([uid]) => uid));
  const data = {
    title: `${sender.display_name || 'Quelqu\'un'} · ${ch.label}`,
    body: `Nouveau message chiffré dans ${classes.get(cid) || 'ta classe'}`,
    tag: `cc-${channel}`,
    url: SITE,
  };
  // The encrypted message itself travels with the notification: the phone decrypts it with its class key
  // and shows the real text. This server still can't read it. (FCM payloads are limited to 4 KB.)
  if (typeof msg.ciphertext === 'string' && msg.ciphertext.length <= 3000) {
    Object.assign(data, { cid, channel, epoch: String(msg.epoch), user_id: msg.user_id, iv: msg.iv, ciphertext: msg.ciphertext });
  }
  await sendTo(recipients, data, `${classes.get(cid) || cid} · ${ch.label}`);
}

// ------------------------------------------------------------ private conversations ("Contacter les délégués")
// Participants: the student, the delegates, and the head teachers if the student invited them.
db.collectionGroup('dm').where('created_at', '>', startedAt).onSnapshot((snap) => {
  for (const c of snap.docChanges()) {
    if (c.type !== 'added') continue;
    const thread = c.doc.ref.parent.parent;
    const cid = thread?.parent.parent?.id;
    if (cid) notifyDM(cid, thread, c.doc.data()).catch((err) => log('⚠ envoi :', err.message));
  }
}, (err) => {
  log('⚠ écoute des messages privés interrompue :', err.message);
  setTimeout(() => process.exit(1), 30000);
});

async function notifyDM(cid, threadRef, msg) {
  const t = (await threadRef.get()).data();
  const sender = users.get(msg.user_id);
  if (!t || !sender || sender.class_id !== cid) return;
  const recipients = new Set([t.student_id, ...[...users]
    .filter(([, u]) => u.class_id === cid && (u.role === 'delegate' || (t.include_principal && u.role === 'teacher' && u.principal)))
    .map(([uid]) => uid)]);
  recipients.delete(msg.user_id);
  // `users` only holds active members: a student who left, or waits for re-approval, gets nothing.
  if (users.get(t.student_id)?.class_id !== cid) recipients.delete(t.student_id);
  await sendTo(recipients, {
    title: `✉️ ${sender.display_name || 'Quelqu\'un'} · Message privé`,
    body: 'Nouveau message privé chiffré (Contacter les délégués)',
    tag: `cc-dm-${t.student_id}`,
    url: SITE,
  }, `${classes.get(cid) || cid} · message privé`);
}

async function sendTo(recipients, data, label) {
  // Quiet hours: nothing is sent to that device during the range it chose.
  await sendTokens([...tokens].filter(([, t]) => recipients.has(t.uid) && !inQuiet(t)), data, label);
}

async function sendTokens(targets, data, label) {
  if (!targets.length) return;
  const res = await getMessaging().sendEach(targets.map(([, t]) => ({
    token: t.token, data,
    webpush: { headers: { Urgency: 'high', TTL: String(24 * 3600) } },
  })));

  // Forget devices that uninstalled the app or revoked the permission.
  const dead = res.responses.map((r, i) => (!r.success && DEAD_TOKEN.has(r.error?.code) ? targets[i][0] : null)).filter(Boolean);
  await Promise.all(dead.map((id) => db.doc(`push_tokens/${id}`).delete().catch(() => {})));
  const errors = [...new Set(res.responses.filter((r) => !r.success).map((r) => r.error?.code || r.error?.message))];
  log(`🔔 ${label} : ${res.successCount}/${targets.length} notification(s)${dead.length ? `, ${dead.length} appareil(s) oublié(s)` : ''}${errors.length ? ` · erreurs : ${errors.join(', ')}` : ''}`);
  if (errors.some((e) => /auth|credential|invalid_grant|ACCOUNT_STATE/i.test(String(e)))) {
    log('   → La clé service-account.json est refusée par Google (supprimée ou désactivée ?) : génère-en une nouvelle (voir LISEZMOI.md).');
  }
}

// ------------------------------------------------------------ scheduled messages ("envoyer demain à 7 h")
// The message was encrypted by its author when it was written; at the chosen time this server only moves it into the
// channel (it still can't read it), after checking that the author may still write there.
const timers = new Map();   // scheduled doc path -> timeout
const MAX_WAIT = 2 ** 31 - 1;
function plan(ref, data) {
  clearTimeout(timers.get(ref.path));
  const wait = data.send_at.toMillis() - Date.now();
  if (wait > MAX_WAIT) return;   // can't happen: the rules allow 24 days at most
  timers.set(ref.path, setTimeout(() => deliver(ref).catch((err) => log('⚠ message programmé :', err.message)), Math.max(0, wait)));
}
async function deliver(ref) {
  timers.delete(ref.path);
  const snap = await ref.get();
  if (!snap.exists) return;
  const m = snap.data();
  const cid = ref.parent.parent.id;
  const author = users.get(m.user_id);
  const ch = CHANNELS[m.channel];
  const allowed = author && author.class_id === cid && ch && ch.canRead(author.role)
    && (m.channel !== 'announcements' || ['delegate', 'deputy', 'teacher'].includes(author.role));
  const batch = db.batch();
  if (allowed) {
    batch.set(db.collection(`classes/${cid}/${m.channel}`).doc(), {
      user_id: m.user_id, epoch: m.epoch, iv: m.iv, ciphertext: m.ciphertext, pinned: false, created_at: FieldValue.serverTimestamp(),
    });
  }
  batch.delete(ref);
  await batch.commit();
  log(allowed ? `⏰ message programmé envoyé (${classes.get(cid) || cid})` : '⏰ message programmé annulé : l\'auteur n\'a plus accès au canal');
}
db.collectionGroup('scheduled').where('send_at', '>', Timestamp.fromMillis(0)).onSnapshot((snap) => {
  for (const c of snap.docChanges()) {
    if (c.type === 'removed') { clearTimeout(timers.get(c.doc.ref.path)); timers.delete(c.doc.ref.path); }
    else plan(c.doc.ref, c.doc.data());
  }
}, (err) => { log('⚠ écoute des messages programmés interrompue :', err.message); setTimeout(() => process.exit(1), 30000); });


// ------------------------------------------------------------ personal reminders ("Mes rappels")
// Encrypted with the class key: the phone decrypts the text itself when the notification arrives.
const reminderTimers = new Map();
async function remind(ref) {
  reminderTimers.delete(ref.path);
  const snap = await ref.get();
  if (!snap.exists) return;
  const r = snap.data();
  const cid = ref.parent.parent.id;
  if (users.get(r.user_id)?.class_id === cid) {
    await sendTo(new Set([r.user_id]), {
      title: '⏰ Rappel', body: 'Tu avais demandé un rappel', tag: `cc-reminder-${ref.id}`, url: SITE,
      kind: 'reminder', cid, epoch: String(r.epoch), user_id: r.user_id, iv: r.iv, ciphertext: r.ciphertext,
    }, 'rappel');
  }
  await ref.delete();
}
db.collectionGroup('reminders').where('at', '>', Timestamp.fromMillis(0)).onSnapshot((snap) => {
  for (const c of snap.docChanges()) {
    clearTimeout(reminderTimers.get(c.doc.ref.path));
    reminderTimers.delete(c.doc.ref.path);
    if (c.type === 'removed') continue;
    const wait = c.doc.get('at').toMillis() - Date.now();
    if (wait < MAX_WAIT) reminderTimers.set(c.doc.ref.path, setTimeout(() => remind(c.doc.ref).catch((err) => log('⚠ rappel :', err.message)), Math.max(0, wait)));
  }
}, (err) => { log('⚠ écoute des rappels interrompue :', err.message); setTimeout(() => process.exit(1), 30000); });

log('🚀 Serveur de notifications Class Connect démarré. Laisse cette fenêtre ouverte.');
// ------------------------------------------------------------ morning summary (7:00 on each device's clock)
// Built only from what this server may read: timetable slots, countdown events and the kind of teacher alerts.
const DIGEST_AT = 7 * 60;
const digestSent = new Map();    // uid -> ymd
const digestCache = new Map();   // cid|ymd -> Promise<text | null>

function classDigest(cid, clock) {
  const key = `${cid}|${clock.ymd}`;
  if (!digestCache.has(key)) {
    const col = (name) => db.collection(`classes/${cid}/${name}`);
    digestCache.set(key, Promise.all([
      col('slots').get(), col('events').where('date', '==', clock.ymd).get(), col('alerts').where('date', '==', clock.ymd).get(),
    ]).then(([slots, events, alerts]) => digestText({
      slots: slots.docs.map((d) => ({ id: d.id, ...d.data() })), events: events.docs.map((d) => d.data()),
      alerts: alerts.docs.map((d) => d.data()), day: clock.day, week: weekLetter(weekA.get(cid), clock.ymd),
    })).catch((err) => { log('⚠ résumé du matin :', err.message); return null; }));
    if (digestCache.size > 500) digestCache.delete(digestCache.keys().next().value);
  }
  return digestCache.get(key);
}

async function morningDigest() {
  const now = new Date();
  for (const t of [...tokens.values()]) {
    const u = users.get(t.uid);
    if (!t.digest || !u?.class_id) continue;
    const clock = clockIn(t.tz, now);
    if (clock.minutes < DIGEST_AT || clock.minutes >= DIGEST_AT + 15 || digestSent.get(t.uid) === clock.ymd || inQuiet(t, now)) continue;
    digestSent.set(t.uid, clock.ymd);
    const body = await classDigest(u.class_id, clock);
    if (!body) continue;
    // Every device of this person that asked for the summary and isn't in its quiet hours.
    const targets = [...tokens].filter(([, x]) => x.uid === t.uid && x.digest && !inQuiet(x, now));
    await sendTokens(targets, { title: '☀️ Bonjour ! Ta journée', body, tag: 'cc-digest', url: `${SITE}?panel=timetable`, kind: 'digest' },
      `${classes.get(u.class_id) || u.class_id} · résumé du matin`).catch((err) => log('⚠ résumé du matin :', err.message));
  }
}
setInterval(() => { if (ready.tokens && ready.users && ready.classes) morningDigest(); }, 60_000);

setInterval(() => log(`… toujours en marche · ${users.size} membres · ${tokens.size} appareil(s) abonné(s)`), 6 * 3600e3);
