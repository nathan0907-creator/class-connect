// Delegates' tools: dashboard, slow mode, banned words, welcome message, moderation log, mute and handover
// ("passation" to a deputy). Settings are encrypted like everything else; the rules check who may change them.
import {
  onSnapshot, query, where, orderBy, limit, getDocs, getCountFromServer, updateDoc, setDoc, doc, writeBatch, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db, sub, plain, classRef, userRef } from './fb.js';
import { state, on, emit, isDelegate, isTeacher, memberName, channelsFor, CHANNELS } from './state.js';
import { h, icon, modal, toast, toastError, confirmDialog, fmtDay, fmtTime } from './ui.js';
import { seal, unseal, txt } from './vault.js';

let unsubs = [];
export const settings = { banned: [], welcome: '' };
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function startSettings() {
  stopSettings();
  for (const id of ['filter', 'welcome']) {
    unsubs.push(onSnapshot(doc(sub(state.cls.id, 'settings'), id), async (snap) => {
      const data = snap.exists() ? await unseal(`settings:${id}`, plain(snap), snap.get('updated_by')) : null;
      if (id === 'filter') settings.banned = Array.isArray(data?.words) ? data.words.map((w) => txt(w, 40).trim()).filter(Boolean).slice(0, 200) : [];
      else { settings.welcome = txt(data?.text, 3000); showWelcome(); }
      emit('settings');
    }, () => {}));
  }
}
export function stopSettings() { unsubs.forEach((u) => u()); unsubs = []; settings.banned = []; settings.welcome = ''; }

// ------------------------------------------------------------ banned words (checked on the devices)
const wordRe = (w) => new RegExp(`(^|[^\\p{L}\\p{N}])(${norm(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^\\p{L}\\p{N}])`, 'giu');
/** First banned word found in a text (accents and case ignored), or ''. */
export function bannedIn(text) {
  const t = norm(text);
  return settings.banned.find((w) => wordRe(w).test(t)) || '';
}
/** The text with banned words replaced by ***. */
export function maskBanned(text) {
  if (!settings.banned.length || !text) return text;
  let out = text;
  for (const w of settings.banned) {
    const re = wordRe(w);
    const n = norm(out);
    let m;
    const cuts = [];
    while ((m = re.exec(n))) cuts.push([m.index + m[1].length, m[2].length]);
    for (const [at, len] of cuts.reverse()) out = out.slice(0, at) + '*'.repeat(len) + out.slice(at + len);
  }
  return out;
}

// ------------------------------------------------------------ welcome message (shown once to each member)
function showWelcome() {
  if (!settings.welcome || !state.cls) return;
  const key = `cc-welcome-${state.cls.id}-${settings.welcome.length}-${settings.welcome.slice(0, 20)}`;
  try { if (localStorage.getItem(key) === '1') return; localStorage.setItem(key, '1'); } catch { return; }
  modal({ title: `👋 Bienvenue dans ${state.cls.name} !`, body: h('div', h('p', { style: { whiteSpace: 'pre-wrap' } }, settings.welcome)), actions: [{ label: 'C\'est parti 🚀', variant: 'btn-primary' }] });
}

// ------------------------------------------------------------ moderation log helper
export function log(action, target = '', detail = '', channel = '') {
  return setDoc(doc(sub(state.cls.id, 'modlog')), { action, target, channel, detail: detail.slice(0, 200), by: state.me.id, at: serverTimestamp() }).catch(() => {});
}

// ------------------------------------------------------------ mute & handover (buttons of the crew list)
export function muteButton(m) {
  const until = m.muted_until && m.muted_until > Date.now() ? m.muted_until : 0;
  return h('button.btn.btn-sm.btn-ghost', {
    title: 'Empêche temporairement d\'écrire dans les canaux',
    onclick: async () => {
      if (until) {
        await updateDoc(userRef(m.id), { muted_until: null }).catch(toastError);
        log('unmute', m.id);
        return toast(`${m.display_name} peut de nouveau écrire`);
      }
      const choice = await pick(`🔇 Sourdine pour ${m.display_name}`, 'Pendant combien de temps ne pourra-t-il/elle plus écrire ?', [['15 min', 15], ['1 h', 60], ['1 jour', 1440], ['3 jours', 4320]]);
      if (!choice) return;
      try {
        await updateDoc(userRef(m.id), { muted_until: Timestamp.fromMillis(Date.now() + choice * 60000) });
        log('mute', m.id, `${choice} min`);
        toast(`${m.display_name} est en sourdine 🔇`, 'success');
      } catch (err) { toastError(err); }
    },
  }, until ? `🔈 Fin de sourdine (${fmtTime(until)})` : '🔇 Sourdine');
}

export function actingButton(m) {
  if (m.role !== 'deputy') return null;
  const until = m.acting_until && m.acting_until > Date.now() ? m.acting_until : 0;
  return h('button.btn.btn-sm.btn-ghost', {
    title: 'Le suppléant a tous les pouvoirs du délégué pendant ton absence',
    onclick: async () => {
      if (until) {
        await updateDoc(userRef(m.id), { acting_until: null }).catch(toastError);
        log('acting', m.id, 'fin');
        return toast('Passation terminée');
      }
      const days = await pick(`🤝 Passation à ${m.display_name}`, 'Pendant ton absence, ton suppléant a tous tes pouvoirs de délégué. Pour combien de temps ?', [['1 jour', 1], ['3 jours', 3], ['1 semaine', 7], ['2 semaines', 14]]);
      if (!days) return;
      try {
        await updateDoc(userRef(m.id), { acting_until: Timestamp.fromMillis(Date.now() + days * 864e5) });
        log('acting', m.id, `${days} j`);
        toast(`${m.display_name} te remplace pendant ${days} jour${days > 1 ? 's' : ''} 🤝`, 'success');
      } catch (err) { toastError(err); }
    },
  }, until ? `🤝 Remplace jusqu'au ${new Date(until).toLocaleDateString('fr-FR')}` : '🤝 Passation');
}

function pick(title, text, options) {
  return new Promise((resolve) => {
    let chosen = null;
    modal({
      title, body: h('p', text), onClose: () => resolve(chosen),
      actions: [{ label: 'Annuler' }, ...options.map(([label, v]) => ({ label, variant: 'btn-primary', onClick: () => { chosen = v; } }))],
    });
  });
}

// ------------------------------------------------------------ admin cards
export function adminCards() {
  return [dashboardCard(), slowCard(), filterCard(), welcomeCard(), logCard()];
}

function dashboardCard() {
  const box = h('div.dash-grid', h('div.spinner'));
  const card = h('div.admin-card.card.span-2', h('h3', '📊 Tableau de bord'), box);
  (async () => {
    const members = [...state.members.values()];
    const since = Timestamp.fromMillis(Date.now() - 7 * 864e5);
    const counts = await Promise.all(channelsFor().map(async (ch) => {
      try { return [ch, (await getCountFromServer(query(sub(state.cls.id, ch), where('created_at', '>', since)))).data().count]; } catch { return [ch, '–']; }
    }));
    const stat = (n, label) => h('div.dash-stat', h('b', String(n)), h('small', label));
    box.replaceChildren(
      stat(members.filter((m) => m.status === 'active').length, 'membres actifs'),
      stat(members.filter((m) => m.status === 'pending').length, 'demandes en attente'),
      stat(state.online?.size || 0, 'en ligne maintenant'),
      ...counts.map(([ch, n]) => stat(n, `messages en 7 j · ${CHANNELS[ch].label}`)),
      stat(members.filter((m) => m.muted_until && m.muted_until > Date.now()).length, 'en sourdine'));
  })();
  return card;
}

function slowCard() {
  const current = Number(state.cls.slow) || 0;
  return h('div.admin-card.card',
    h('h3', '🐢 Mode lent'),
    h('p.muted', current > 1 ? `Activé : ${current} s entre deux messages d'élève.` : 'Quand une discussion s\'emballe, impose un délai entre deux messages des élèves.'),
    h('div.seg.seg-sm.seg-wrap', [[0, 'Désactivé'], [10, '10 s'], [30, '30 s'], [60, '1 min'], [300, '5 min']].map(([v, l]) => h(`button${(current > 1 ? current : 0) === v ? '.active' : ''}`, {
      type: 'button', onclick: async () => {
        try { await updateDoc(classRef(state.cls.id), { slow: v }); log('slow', '', l); toast(v ? `Mode lent : ${l} 🐢` : 'Mode lent désactivé', 'success'); }
        catch (err) { toastError(err); }
      },
    }, l))));
}

async function saveSetting(id, data) {
  await setDoc(doc(sub(state.cls.id, 'settings'), id), { ...(await seal(`settings:${id}`, data)), updated_by: state.me.id, updated_at: serverTimestamp() });
}

function filterCard() {
  const area = h('textarea', { rows: 3, maxLength: 4000, value: settings.banned.join(', '), placeholder: 'Mots séparés par des virgules' });
  return h('div.admin-card.card',
    h('h3', '🚫 Mots interdits'),
    h('p.muted', 'Un message qui en contient ne part pas, et ils sont masqués (***) à l\'affichage. La vérification se fait sur les téléphones : le chiffrement reste intact.'),
    area,
    h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: async () => {
      const words = area.value.split(/[,\n]/).map((w) => w.trim()).filter(Boolean).slice(0, 200);
      try { await saveSetting('filter', { words }); log('filter', '', `${words.length} mot(s)`); toast('Liste enregistrée', 'success'); } catch (err) { toastError(err); }
    } }, 'Enregistrer'));
}

function welcomeCard() {
  const area = h('textarea', { rows: 3, maxLength: 3000, value: settings.welcome, placeholder: 'Ex. Bienvenue ! Ici on reste respectueux, les devoirs sont dans le canal Classe…' });
  return h('div.admin-card.card',
    h('h3', '👋 Message d\'accueil'),
    h('p.muted', 'Affiché une fois à chaque membre (et à chaque nouvel arrivant).'),
    area,
    h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: async () => {
      try { await saveSetting('welcome', { text: area.value.trim() }); log('welcome'); toast('Message d\'accueil enregistré', 'success'); } catch (err) { toastError(err); }
    } }, 'Enregistrer'));
}

const ACTIONS = { delete: '🗑️ a supprimé un message de', pin: '📌 a épinglé un message de', unpin: '📌 a désépinglé un message de', mute: '🔇 a mis en sourdine', unmute: '🔈 a levé la sourdine de', kick: '🚪 a exclu', role: '⭐ a changé le rôle de', slow: '🐢 a réglé le mode lent', filter: '🚫 a modifié les mots interdits', welcome: '👋 a modifié le message d\'accueil', acting: '🤝 passation à' };
function logCard() {
  const list = h('div.post-list', h('div.spinner'));
  const card = h('div.admin-card.card.span-2', h('h3', '📜 Journal de modération'), h('p.muted', 'Chaque action de modération est enregistrée ici (visible par les délégués et les profs).'), list);
  getDocs(query(sub(state.cls.id, 'modlog'), orderBy('at', 'desc'), limit(40))).then((snap) => {
    const rows = snap.docs.map(plain);
    list.replaceChildren(...(rows.length ? rows.map((r) => h('div.log-line',
      h('small', `${fmtDay(r.at)} ${fmtTime(r.at)}`),
      h('span', `${memberName(r.by)} ${ACTIONS[r.action] || r.action} ${r.target ? memberName(r.target) : ''}${r.channel ? ` (${CHANNELS[r.channel]?.label || r.channel})` : ''}${r.detail ? ` · ${r.detail}` : ''}`))) : [h('p.muted.small', 'Rien pour l\'instant.')]));
  }).catch(() => list.replaceChildren(h('p.muted.small', 'Journal indisponible')));
  return card;
}

export const isMuted = () => !!state.me?.muted_until && state.me.muted_until > Date.now();
export const slowSeconds = () => (isDelegate() || isTeacher() || state.me?.role === 'deputy' ? 0 : Number(state.cls?.slow) > 1 ? Number(state.cls.slow) : 0);
