// Class Connect — notifications sans PC allumé : ce script fait UN passage puis s'arrête. GitHub Actions le lance
// toutes les 5 minutes (.github/workflows/notifier.yml), gratuitement. Il fait le travail de push-server.mjs :
// notifications des nouveaux messages, messages programmés, rappels et résumé du matin.
// Comme lui, il ne peut PAS lire les messages (chiffrés de bout en bout) : il les relaie tels quels.
// Accès à Firebase : sans clé, GitHub est reconnu directement par Google (fédération d'identité).
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { clockIn, inQuiet, weekLetter, digestText } from './clock.mjs';

const SITE = 'https://nathan0907-creator.github.io/class-connect/';
const CHANNELS = {
  messages: { label: 'Classe', canRead: (role) => role !== 'teacher' },
  mixed_messages: { label: 'Profs & élèves', canRead: () => true },
  staff_messages: { label: 'Salle des profs', canRead: (role) => role === 'teacher' },
  announcements: { label: 'Annonces', canRead: () => true },
};
const DEAD_TOKEN = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);
const log = (...a) => console.log('·', ...a);

// On GitHub: no key at all, Google recognises the repository itself (workload identity federation, see notifier.yml).
// Elsewhere: a key in FIREBASE_SERVICE_ACCOUNT still works.
if (process.env.FIREBASE_SERVICE_ACCOUNT) initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) initializeApp({ credential: applicationDefault(), projectId: 'class-connectv3' });
else { console.log('Aucun accès Firebase configuré : rien à faire.'); process.exit(0); }
const db = getFirestore();

const now = Timestamp.now();
const stateRef = db.doc('server_state/cron');
const state = (await stateRef.get()).data() || {};
// The PC server (push-server.mjs) says "I'm alive" every minute: when it is running, it does the job in real time.
const beat = (await db.doc('server_state/push').get()).get('at');
if (beat && now.toMillis() - beat.toMillis() < 3 * 60e3) {
  await stateRef.set({ last: now }, { merge: true });
  console.log('Le serveur du PC est en marche : rien à faire ici.');
  process.exit(0);
}
// Since the last passage (at most one hour back, so a long pause doesn't flood everyone).
const since = Timestamp.fromMillis(Math.max(state.last?.toMillis?.() || now.toMillis() - 6 * 60e3, now.toMillis() - 60 * 60e3));

const users = new Map((await db.collection('users').where('status', '==', 'active').get()).docs.map((d) => [d.id, d.data()]));
const tokens = new Map((await db.collection('push_tokens').get()).docs.map((d) => [d.id, { uid: d.get('uid'), token: d.get('token'), quiet: d.get('quiet') || null, digest: !!d.get('digest'), tz: d.get('tz') || 'Europe/Paris' }]));
const classes = new Map((await db.collection('classes').get()).docs.map((d) => [d.id, d.data()]));
const className = (cid) => classes.get(cid)?.name || 'ta classe';

async function sendTokens(targets, data, label) {
  if (!targets.length) return;
  const res = await getMessaging().sendEach(targets.map(([, t]) => ({ token: t.token, data, webpush: { headers: { Urgency: 'high', TTL: String(24 * 3600) } } })));
  const dead = res.responses.map((r, i) => (!r.success && DEAD_TOKEN.has(r.error?.code) ? targets[i][0] : null)).filter(Boolean);
  await Promise.all(dead.map((id) => db.doc(`push_tokens/${id}`).delete().catch(() => {})));
  log(`🔔 ${label} : ${res.successCount}/${targets.length}${dead.length ? `, ${dead.length} appareil(s) oublié(s)` : ''}`);
}
const sendTo = (recipients, data, label) => sendTokens([...tokens].filter(([, t]) => recipients.has(t.uid) && !inQuiet(t)), data, label);
const inWindow = (q, field) => q.where(field, '>', since).where(field, '<=', now);

// ------------------------------------------------------------ new messages: one notification per channel (the latest message)
for (const [channel, ch] of Object.entries(CHANNELS)) {
  const latest = new Map();   // cid -> { msg, count }
  for (const d of (await inWindow(db.collectionGroup(channel), 'created_at').get()).docs) {
    const cid = d.ref.parent.parent?.id;
    const msg = d.data();
    if (!cid || msg.deleted_at) continue;
    const cur = latest.get(cid);
    if (!cur || msg.created_at.toMillis() > cur.msg.created_at.toMillis()) latest.set(cid, { msg, count: (cur?.count || 0) + 1 });
    else cur.count++;
  }
  for (const [cid, { msg, count }] of latest) {
    const sender = users.get(msg.user_id);
    if (!sender || sender.class_id !== cid) continue;
    const recipients = new Set([...users].filter(([uid, u]) => uid !== msg.user_id && u.class_id === cid && ch.canRead(u.role)).map(([uid]) => uid));
    const data = {
      title: `${sender.display_name || 'Quelqu\'un'} · ${ch.label}${count > 1 ? ` (+${count - 1})` : ''}`,
      body: `Nouveau message chiffré dans ${className(cid)}`, tag: `cc-${channel}`, url: SITE,
    };
    if (typeof msg.ciphertext === 'string' && msg.ciphertext.length <= 3000) {
      Object.assign(data, { cid, channel, epoch: String(msg.epoch), user_id: msg.user_id, iv: msg.iv, ciphertext: msg.ciphertext });
    }
    await sendTo(recipients, data, `${className(cid)} · ${ch.label}`).catch((err) => log('⚠ envoi :', err.message));
  }
}

// ------------------------------------------------------------ private conversations ("Contacter les délégués")
{
  const latest = new Map();   // thread path -> message
  for (const d of (await inWindow(db.collectionGroup('dm'), 'created_at').get()).docs) latest.set(d.ref.parent.parent.path, { ref: d.ref.parent.parent, msg: d.data() });
  for (const { ref, msg } of latest.values()) {
    const cid = ref.parent.parent?.id;
    const t = (await ref.get()).data();
    const sender = users.get(msg.user_id);
    if (!t || !sender || sender.class_id !== cid) continue;
    const recipients = new Set([t.student_id, ...[...users].filter(([, u]) => u.class_id === cid && (u.role === 'delegate' || (t.include_principal && u.role === 'teacher' && u.principal))).map(([uid]) => uid)]);
    recipients.delete(msg.user_id);
    if (users.get(t.student_id)?.class_id !== cid) recipients.delete(t.student_id);
    await sendTo(recipients, { title: `✉️ ${sender.display_name || 'Quelqu\'un'} · Message privé`, body: 'Nouveau message privé chiffré (Contacter les délégués)', tag: `cc-dm-${t.student_id}`, url: SITE },
      `${className(cid)} · message privé`).catch((err) => log('⚠ envoi :', err.message));
  }
}

// ------------------------------------------------------------ scheduled messages whose time has come
for (const d of (await db.collectionGroup('scheduled').where('send_at', '<=', now).get()).docs) {
  const m = d.data();
  const cid = d.ref.parent.parent.id;
  const author = users.get(m.user_id);
  const ch = CHANNELS[m.channel];
  const allowed = author && author.class_id === cid && ch && ch.canRead(author.role)
    && (m.channel !== 'announcements' || ['delegate', 'deputy', 'teacher'].includes(author.role));
  const batch = db.batch();
  if (allowed) batch.set(db.collection(`classes/${cid}/${m.channel}`).doc(), { user_id: m.user_id, epoch: m.epoch, iv: m.iv, ciphertext: m.ciphertext, pinned: false, created_at: FieldValue.serverTimestamp() });
  batch.delete(d.ref);
  await batch.commit();   // the message itself is notified at the next passage
  log(allowed ? `⏰ message programmé envoyé (${className(cid)})` : '⏰ message programmé annulé : l\'auteur n\'a plus accès au canal');
}

// ------------------------------------------------------------ personal reminders
for (const d of (await db.collectionGroup('reminders').where('at', '<=', now).get()).docs) {
  const r = d.data();
  const cid = d.ref.parent.parent.id;
  if (users.get(r.user_id)?.class_id === cid) {
    await sendTo(new Set([r.user_id]), { title: '⏰ Rappel', body: 'Tu avais demandé un rappel', tag: `cc-reminder-${d.id}`, url: SITE,
      kind: 'reminder', cid, epoch: String(r.epoch), user_id: r.user_id, iv: r.iv, ciphertext: r.ciphertext }, 'rappel').catch((err) => log('⚠ rappel :', err.message));
  }
  await d.ref.delete();
}

// ------------------------------------------------------------ morning summary (7:00–8:00 on each device's clock, once a day)
const digestSent = state.digest || {};
const digestCache = new Map();
for (const t of tokens.values()) {
  const u = users.get(t.uid);
  if (!t.digest || !u?.class_id) continue;
  const clock = clockIn(t.tz, now.toDate());
  if (clock.minutes < 7 * 60 || clock.minutes >= 8 * 60 || digestSent[t.uid] === clock.ymd || inQuiet(t, now.toDate())) continue;
  digestSent[t.uid] = clock.ymd;
  const key = `${u.class_id}|${clock.ymd}`;
  if (!digestCache.has(key)) {
    const col = (name) => db.collection(`classes/${u.class_id}/${name}`);
    const [slots, events, alerts] = await Promise.all([col('slots').get(), col('events').where('date', '==', clock.ymd).get(), col('alerts').where('date', '==', clock.ymd).get()]);
    digestCache.set(key, digestText({ slots: slots.docs.map((d) => ({ id: d.id, ...d.data() })), events: events.docs.map((d) => d.data()),
      alerts: alerts.docs.map((d) => d.data()), day: clock.day, week: weekLetter(classes.get(u.class_id)?.week_a, clock.ymd) }));
  }
  const body = digestCache.get(key);
  if (!body) continue;
  await sendTokens([...tokens].filter(([, x]) => x.uid === t.uid && x.digest && !inQuiet(x, now.toDate())),
    { title: '☀️ Bonjour ! Ta journée', body, tag: 'cc-digest', url: `${SITE}?panel=timetable`, kind: 'digest' }, `${className(u.class_id)} · résumé du matin`).catch((err) => log('⚠ résumé :', err.message));
}
// Keep only today's and yesterday's marks.
const oldest = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
for (const uid of Object.keys(digestSent)) if (digestSent[uid] < oldest) delete digestSent[uid];

await stateRef.set({ last: now, digest: digestSent });
console.log(`Passage terminé (${users.size} membres, ${tokens.size} appareils).`);
process.exit(0);
