// Push notifications when the app is closed.
// Messages are end-to-end encrypted: this function never sees their content. It only knows that someone posted
// in a channel, and sends "New message from <name>" to the devices of the members allowed to read that channel.
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
// Same region as the Firestore database; few instances so a spam burst can't run up costs.
setGlobalOptions({ region: 'europe-north2', maxInstances: 3, memory: '256MiB' });

const SITE = 'https://nathan0907-creator.github.io/class-connect/';
const CHANNELS = {
  messages: { label: 'Classe', canRead: (role) => role !== 'teacher' },
  mixed_messages: { label: 'Profs & élèves', canRead: () => true },
  staff_messages: { label: 'Salle des profs', canRead: (role) => role === 'teacher' },
};
const DEAD_TOKEN = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);

async function pushOnMessage(event, channel) {
  const { cid } = event.params;
  const ch = CHANNELS[channel];
  const msg = event.data?.data();
  if (!ch || !msg?.user_id) return;

  const db = getFirestore();
  const [cls, members] = await Promise.all([
    db.doc(`classes/${cid}`).get(),
    db.collection('users').where('class_id', '==', cid).where('status', '==', 'active').get(),
  ]);
  const sender = members.docs.find((d) => d.id === msg.user_id);
  if (!sender) return;
  const recipients = members.docs.filter((d) => d.id !== msg.user_id && ch.canRead(d.get('role'))).map((d) => d.id);
  if (!recipients.length) return;

  const tokens = [];
  for (let i = 0; i < recipients.length; i += 30) {
    const snap = await db.collection('push_tokens').where('uid', 'in', recipients.slice(i, i + 30)).get();
    snap.forEach((d) => tokens.push({ ref: d.ref, token: d.get('token') }));
  }
  if (!tokens.length) return;

  const className = cls.get('name') || 'Class Connect';
  const data = {
    title: `${sender.get('display_name') || 'Quelqu\'un'} · ${ch.label}`,
    body: `Nouveau message chiffré dans ${className}`,
    tag: `cc-${channel}`,
    url: SITE,
  };
  const res = await getMessaging().sendEach(tokens.map(({ token }) => ({
    token, data,
    webpush: { headers: { Urgency: 'high', TTL: String(24 * 3600) } },
  })));

  // Forget devices that uninstalled the app or revoked the permission.
  const dead = res.responses.map((r, i) => (!r.success && DEAD_TOKEN.has(r.error?.code) ? tokens[i].ref : null)).filter(Boolean);
  await Promise.all(dead.map((ref) => ref.delete().catch(() => {})));
  logger.info(`push ${channel}: ${res.successCount} envoyée(s), ${dead.length} appareil(s) oublié(s)`);
}

// One trigger per channel, so media chunks, votes, etc. never wake the function up.
exports.pushClasse = onDocumentCreated('classes/{cid}/messages/{mid}', (e) => pushOnMessage(e, 'messages'));
exports.pushMixte = onDocumentCreated('classes/{cid}/mixed_messages/{mid}', (e) => pushOnMessage(e, 'mixed_messages'));
exports.pushProfs = onDocumentCreated('classes/{cid}/staff_messages/{mid}', (e) => pushOnMessage(e, 'staff_messages'));
