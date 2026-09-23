// Harassment reports.
// Messages are end-to-end encrypted, so nobody can scan them. When a member reports a message, their own
// device decrypts it together with its context (10 messages before/after, including deleted ones, which are
// kept 30 days) and shares that evidence with the class delegates. Reports are erased after 30 days.
import {
  query, orderBy, limit, limitToLast, endBefore, startAfter, where, getDocs, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { sub, plain } from './fb.js';
import { state, emit, memberName, isDelegate, isTeacher, isPrincipal, CHANNELS } from './state.js';
import { decryptMessage } from './chat.js';
import { h, icon, modal, toast, fmtDay, fmtTime } from './ui.js';

export const REASONS = {
  harcelement: 'Harcèlement',
  insulte: 'Insulte ou humiliation',
  menace: 'Menace',
  contenu_choquant: 'Contenu choquant ou intime',
  usurpation: 'Usurpation d\'identité',
  autre: 'Autre',
};
const RETENTION_DAYS = 30;
const MODERATORS = {
  messages: 'aux délégués et au(x) professeur(s) principal(aux)',
  mixed_messages: 'aux délégués, aux professeurs et au(x) professeur(s) principal(aux)',
  staff_messages: 'aux professeurs de la classe',
};
/** Channels whose reports the current member handles (head teachers receive every report). */
const moderatedChannels = () => (isPrincipal() ? ['messages', 'mixed_messages', 'staff_messages']
  : isTeacher() ? ['mixed_messages', 'staff_messages']
  : isDelegate() ? ['messages', 'mixed_messages'] : []);
export let reports = [];
let unsub = null;

// ------------------------------------------------------------ evidence
function describe(payload) {
  if (!payload) return { type: 'illisible', text: '[message chiffré illisible]' };
  const text = (payload.text || '').slice(0, 4000);
  if (payload.t === 'image' || payload.t === 'video') {
    return { type: payload.t, text: `${text ? text + ' ' : ''}[${payload.t === 'video' ? 'vidéo' : 'image'} : ${payload.file?.name || 'fichier'}]` };
  }
  if (payload.t === 'gif') return { type: 'gif', text: `[GIF : ${payload.gif?.title || payload.gif?.url || ''}]` };
  return { type: 'text', text };
}

async function collectEvidence(row) {
  const col = sub(state.cls.id, row.channel || 'messages');
  const at = Timestamp.fromMillis(row.created_at);
  const [before, after] = await Promise.all([
    getDocs(query(col, orderBy('created_at'), endBefore(at), limitToLast(10))),
    getDocs(query(col, orderBy('created_at'), startAfter(at), limit(10))),
  ]);
  const rows = [...before.docs.map(plain), row, ...after.docs.map(plain)].map((r) => ({ ...r, channel: row.channel }));
  return Promise.all(rows.map(async (r) => ({
    message_id: r.id,
    user_id: r.user_id,
    name: memberName(r.user_id),
    created_at: r.created_at,
    deleted: !!r.deleted_at,
    reported: r.id === row.id,
    ...describe(await decryptMessage(r)),
  })));
}

// ------------------------------------------------------------ report a message
export function openReport(row) {
  const reason = h('select', { required: true, 'aria-label': 'Motif' },
    Object.entries(REASONS).map(([v, l]) => h('option', { value: v }, l)));
  const comment = h('textarea', { rows: 3, maxLength: 1000, placeholder: 'Explique ce qui se passe (facultatif)' });
  modal({
    title: 'Signaler ce message',
    wide: true,
    body: h('div.slot-form',
      h('p.muted', `Message de ${memberName(row.user_id)} — ${fmtDay(row.created_at)} à ${fmtTime(row.created_at)}.`),
      h('label.field', h('span', 'Motif'), reason),
      h('label.field', h('span', 'Précisions'), comment),
      h('div.report-notice',
        h('p', icon('lock'), ' Ton appareil va déchiffrer ce message et les 10 messages avant/après (même supprimés) pour les transmettre ',
          h('b', MODERATORS[row.channel || 'messages']), '. La personne signalée n\'est pas prévenue. Le signalement est effacé automatiquement après 30 jours.'),
        h('p', '🆘 En danger ou harcelé·e ? Parles-en à un adulte de confiance et appelle le ', h('b', '3018'),
          ' (gratuit, anonyme, 7j/7). Contenu illégal : ', h('a', { href: 'https://www.internet-signalement.gouv.fr', target: '_blank', rel: 'noopener' }, 'PHAROS'), '.'))),
    actions: [
      { label: 'Annuler' },
      { label: 'Envoyer le signalement', variant: 'btn-danger', onClick: async () => {
        const evidence = await collectEvidence(row);
        const report = {
          channel: row.channel || 'messages',
          reporter_id: state.me.id, reported_id: row.user_id, message_id: row.id, reason: reason.value,
          comment: comment.value.trim(), evidence, status: 'open', handled_by: null,
          created_at: serverTimestamp(), expire_at: Timestamp.fromMillis(Date.now() + RETENTION_DAYS * 864e5),
        };
        await addDoc(sub(state.cls.id, 'reports'), report);
        toast('Signalement envoyé aux délégués. Tu peux télécharger la preuve pour un adulte ou le 3018.', 'success', 8000);
        modal({
          title: 'Signalement envoyé ✔',
          body: h('div.slot-form',
            h('p', 'Merci. Les délégués ont reçu le signalement. Garde une copie de la preuve si tu veux la montrer à un adulte, à ton établissement, au 3018 ou à la police.'),
            h('button.btn.btn-primary', { onclick: () => downloadEvidence({ ...report, created_at: Date.now(), expire_at: report.expire_at.toMillis() }) },
              h('span', 'Télécharger la preuve (.txt)'))),
        });
      } },
    ],
  });
}

// ------------------------------------------------------------ delegate follow-up
export function startModeration() {
  stopModeration();
  const channels = moderatedChannels();
  if (!channels.length) return;
  // Filtered by channel so the query only returns reports this member is allowed to read.
  const q = query(sub(state.cls.id, 'reports'), where('channel', 'in', channels), limit(100));
  let purged = false;
  unsub = onSnapshot(q, (snap) => {
    reports = snap.docs.map(plain).sort((a, b) => b.created_at - a.created_at);
    emit('reports');
    if (!purged) {
      purged = true;
      const expired = snap.docs.filter((d) => plain(d).expire_at < Date.now());
      Promise.allSettled(expired.map((d) => deleteDoc(d.ref)));
    }
  }, () => {});
}
export function stopModeration() { unsub?.(); unsub = null; reports = []; }

export function reportsCard() {
  const open = reports.filter((r) => r.status === 'open');
  return h('div.admin-card.card.span-2',
    h('h3', icon('flag'), ' Signalements ', open.length ? h('b.count', open.length) : null),
    h('p.muted', isPrincipal()
      ? 'En tant que prof principal, tu reçois tous les signalements de la classe (tous les canaux). Conservés 30 jours puis effacés automatiquement.'
      : isTeacher()
      ? 'Signalements des canaux « Profs & élèves » et « Salle des profs ». Conservés 30 jours puis effacés automatiquement.'
      : 'Preuves transmises par les membres (messages déchiffrés + contexte). Conservées 30 jours puis effacées automatiquement.'),
    reports.length
      ? h('div.pending-list', reports.map((r) => h(`div.pending-item.report-item${r.status === 'open' ? '.open' : ''}`,
          h('div.pi-info',
            h('b', `${REASONS[r.reason] || r.reason} — visant ${memberName(r.reported_id)}`),
            h('small', `${CHANNELS[r.channel]?.label || ''} · signalé par ${memberName(r.reporter_id)} · ${fmtDay(r.created_at)} · expire le ${new Date(r.expire_at).toLocaleDateString('fr-FR')}`)),
          h('span.role-badge', { class: r.status === 'open' ? '' : 'student' }, r.status === 'open' ? 'À traiter' : 'Traité'),
          h('button.btn.btn-sm.btn-ghost', { onclick: () => showReport(r) }, 'Voir'))))
      : h('p.muted', 'Aucun signalement. 🎉'));
}

function showReport(r) {
  const transcript = h('div.transcript', r.evidence.map((e) => h(`div.tr-line${e.reported ? '.reported' : ''}${e.deleted ? '.deleted' : ''}`,
    h('time', `${new Date(e.created_at).toLocaleString('fr-FR')}`),
    h('b', e.name),
    h('span', e.text || '—'),
    e.deleted ? h('em', ' (supprimé)') : null)));
  const involved = r.reported_id === state.me.id;
  modal({
    title: `Signalement : ${REASONS[r.reason] || r.reason}`,
    wide: true,
    body: h('div.slot-form',
      h('p.muted', `Visant ${memberName(r.reported_id)} · signalé par ${memberName(r.reporter_id)} le ${new Date(r.created_at).toLocaleString('fr-FR')}`),
      r.comment ? h('blockquote', r.comment) : null,
      transcript,
      involved ? h('p.report-notice', 'Ce signalement te concerne : un autre délégué doit le traiter.') : null,
      h('p.report-notice', 'Conduite à tenir : parles-en à un adulte (CPE, professeur principal). Si des faits graves sont en jeu, contactez le 3018 ou la police avec la preuve téléchargée.')),
    actions: [
      { label: 'Télécharger la preuve', onClick: () => { downloadEvidence(r); return false; } },
      ...(involved ? [] : [{
        label: r.status === 'open' ? 'Marquer comme traité' : 'Rouvrir',
        variant: 'btn-primary',
        onClick: () => updateDoc(doc(sub(state.cls.id, 'reports'), r.id), { status: r.status === 'open' ? 'handled' : 'open', handled_by: state.me.id }),
      }]),
    ],
  });
}

function downloadEvidence(r) {
  const lines = [
    'CLASS CONNECT — EXTRAIT DE SIGNALEMENT',
    '======================================',
    `Classe : ${state.cls.name} — canal « ${CHANNELS[r.channel]?.label || 'Classe'} »`,
    `Motif : ${REASONS[r.reason] || r.reason}`,
    `Personne signalée : ${memberName(r.reported_id)} (identifiant ${r.reported_id})`,
    `Signalé par : ${memberName(r.reporter_id)} (identifiant ${r.reporter_id})`,
    `Date du signalement : ${new Date(r.created_at).toLocaleString('fr-FR')}`,
    `Conservation jusqu'au : ${new Date(r.expire_at).toLocaleString('fr-FR')}`,
    r.comment ? `Précisions : ${r.comment}` : '',
    '',
    'Conversation (horodatage serveur Firebase, >>> = message signalé) :',
    '',
    ...r.evidence.map((e) => `${e.reported ? '>>> ' : '    '}[${new Date(e.created_at).toLocaleString('fr-FR')}] ${e.name}${e.deleted ? ' (message supprimé)' : ''} : ${e.text}`),
    '',
    `Identifiant du message signalé : ${r.message_id}`,
    'Aide : 3018 (cyberharcèlement, gratuit, 7j/7) · Contenus illicites : www.internet-signalement.gouv.fr',
  ].filter((l) => l !== undefined);
  const blob = new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `signalement-${new Date(r.created_at).toISOString().slice(0, 10)}.txt` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function openReportsCount() { return reports.filter((r) => r.status === 'open' && r.reported_id !== state.me?.id).length; }
