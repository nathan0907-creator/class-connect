// "Vie de classe" tab: question of the day, mascot, XP, compliments, playlist, journal, time capsule, birthday cards,
// end-of-year awards and the class photo. Everything written by members is end-to-end encrypted (see vault.js).
import {
  onSnapshot, query, where, orderBy, limit, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc, doc, writeBatch,
  serverTimestamp, Timestamp, deleteField,
} from 'firebase/firestore';
import { db, sub, plain } from './fb.js';
import { state, on, emit, isDelegate, memberName } from './state.js';
import { $, h, modal, toast, toastError, avatar, confirmDialog, fmtDay, isSafeAvatar } from './ui.js';
import { seal, unseal, txt } from './vault.js';
import { questionOfTheDay } from './daily.js';
import { mascot, myProgress, leaderboard, startStats, stopStats } from './stats.js';
import { fmtBirthday } from './profiles.js';
import { insertInComposer } from './chat.js';
import { openGames, openLiveQuiz } from './games.js';
import { openConstellation } from './cosmos.js';
import { orgTiles } from './orga.js';

let root;
let board = [];          // decrypted compliments / songs / memories
let unsubs = [];
const col = (name) => sub(state.cls.id, name);
const PHOTO_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const MUSIC = /^https:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be|open\.spotify\.com|spotify\.com|deezer\.com|soundcloud\.com|music\.apple\.com)\/[^\s"'<>]*$/i;

export function initLife() {
  root = $('#panel-life .life-body');
  on('panel', (name) => { if (name === 'life') render(); });
  on('stats', () => { if (isOpen()) render(); });
  on('profiles', () => { if (isOpen()) render(); openMyCard(); });
}
const isOpen = () => $('#panel-life')?.classList.contains('active');

export function startLife() {
  stopLife();
  startStats();
  unsubs.push(onSnapshot(query(col('board'), orderBy('created_at', 'desc'), limit(300)), async (snap) => {
    const out = [];
    for (const d of snap.docs) {
      const row = plain(d);
      const data = await unseal(`board:${row.kind}`, row);
      if (data) out.push({ ...row, data });
    }
    board = out;
    emit('board');
  }, () => {}));
}
export function stopLife() { unsubs.forEach((u) => u()); unsubs = []; board = []; stopStats(); }

// ------------------------------------------------------------ the tab
function render() {
  if (!root || !state.cls) return;
  const q = questionOfTheDay();
  const tile = (emoji, title, text, run) => h('button.life-tile.card.tilt', { type: 'button', onclick: run }, h('span.tile-emoji', emoji), h('b', title), h('small', text));
  root.replaceChildren(
    h('div.life-top',
      h('div.qotd.card',
        h('small', '💬 Question du jour'), h('p', q),
        h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => {
          emit('goto', 'chat');
          setTimeout(() => insertInComposer(`💬 Question du jour : « ${q} » — `), 150);
        } }, 'Répondre dans le chat')),
      h('div.card', mascot()),
      h('button.card.progress-card', { type: 'button', onclick: () => modal({ title: '🏆 Ma progression', wide: true, body: myProgress() }) }, myProgressMini())),
    h('h3.life-title', '🎉 S\'amuser'),
    h('div.life-grid',
      tile('🏆', 'Classement & badges', 'XP, séries et badges de chacun', () => modal({ title: '🏆 Classement de la classe', wide: true, body: h('div', leaderboard(), h('p.hint', 'Pour le fun : on gagne de l\'XP en participant (messages, votes, révisions, défis…).')) })),
      tile('🎮', 'Mini-jeux', 'Morpion, puissance 4, pierre-feuille-ciseaux', openGames),
      tile('⚡', 'Quiz en direct', 'Façon Kahoot, toute la classe joue en même temps', openLiveQuiz),
      tile('💐', 'Mur des compliments', 'Dis un truc sympa à quelqu\'un', openCompliments),
      tile('🎵', 'Playlist de la classe', 'Partage tes sons', openPlaylist),
      tile('📔', 'Journal de classe', 'Les souvenirs du mois', openJournal),
      tile('⏳', 'Capsule temporelle', 'Un message à ouvrir plus tard', openCapsules),
      tile('🎂', 'Cartes d\'anniversaire', 'Signe la carte des prochains anniversaires', openCards),
      tile('🏅', 'Album de fin d\'année', 'Les votes « le plus… » de la classe', openAwards),
      tile('🖼️', 'Photo de classe', 'Une mosaïque avec tous les avatars', openMosaic),
      tile('🌌', 'Constellation', 'Une étoile par membre, elle grandit avec la classe', openConstellation)),
    h('h3.life-title', '📋 S\'organiser'),
    h('div.life-grid', orgTiles(tile)));
}

function myProgressMini() {
  const box = myProgress();
  const level = box.querySelector('.level');
  const bar = box.querySelector('.xp-bar');
  return h('div.progress-mini', h('small', '🏆 Ma progression'), level, bar, h('small.muted', 'Défis de la semaine et badges →'));
}

// ------------------------------------------------------------ posts (compliments, songs, memories)
async function post(kind, data, extra = {}) {
  await addDoc(col('board'), { kind, by: state.me.id, ...extra, ...(await seal(`board:${kind}`, data)), created_at: serverTimestamp() });
}
function likeBtn(item) {
  const likes = item.likes || {};
  const count = Object.values(likes).filter(Boolean).length;
  const mine = likes[state.me.id] === true;
  return h(`button.like${mine ? '.mine' : ''}`, {
    type: 'button', 'aria-label': mine ? 'Retirer mon cœur' : 'Mettre un cœur', title: Object.keys(likes).map(memberName).join(', '),
    onclick: () => updateDoc(doc(col('board'), item.id), { [`likes.${state.me.id}`]: mine ? deleteField() : true }).catch(toastError),
  }, mine ? '❤️' : '🤍', count ? ` ${count}` : '');
}
function removeBtn(item, can) {
  return can ? h('button.link-btn', { type: 'button', onclick: async () => {
    if (!(await confirmDialog('Supprimer ?', 'Ce sera effacé pour toute la classe.'))) return;
    deleteDoc(doc(col('board'), item.id)).catch(toastError);
  } }, 'Supprimer') : null;
}
/** A list modal that refreshes itself when the board changes. */
function liveList(title, form, draw) {
  const listBox = h('div.post-list');
  const refresh = () => listBox.replaceChildren(...(draw().length ? draw() : [h('p.muted.small', 'Rien pour l\'instant : sois le premier !')]));
  refresh();
  const off = on('board', refresh);
  modal({ title, wide: true, body: h('div.slot-form', form, listBox), onClose: off });
}

function openCompliments() {
  const to = h('select', { 'aria-label': 'À qui ?' }, h('option', { value: '' }, '— À qui ? —'),
    [...state.members.values()].filter((m) => m.status === 'active' && m.id !== state.me.id)
      .sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr')).map((m) => h('option', { value: m.id }, m.display_name)));
  const text = h('textarea', { rows: 2, maxLength: 300, placeholder: 'Ex. Merci pour ton aide en maths hier, t\'es au top !' });
  const form = h('div.post-form', to, text, h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: async (e) => {
    if (!to.value) return toast('Choisis à qui', 'error');
    if (text.value.trim().length < 3) return toast('Écris ton compliment', 'error');
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await post('compliment', { text: text.value.trim() }, { to: to.value }); text.value = ''; emit('activity', 'compliments'); toast('Compliment envoyé 💐', 'success'); }
    catch (err) { toastError(err); } finally { btn.disabled = false; }
  } }, 'Envoyer 💐'), h('p.hint', 'Signé de ton nom. Les compliments méchants ou moqueurs peuvent être supprimés par la personne visée ou les délégués.'));
  liveList('💐 Mur des compliments', form, () => board.filter((b) => b.kind === 'compliment').map((b) => h('div.post.compliment',
    h('div.post-head', avatar(state.members.get(b.to), 28), h('b', memberName(b.to)), h('small', ` · de ${memberName(b.by)} · ${fmtDay(b.created_at)}`)),
    h('p', txt(b.data.text, 300)), h('div.post-foot', likeBtn(b), removeBtn(b, b.by === state.me.id || b.to === state.me.id || isDelegate())))));
}

function openPlaylist() {
  const title = h('input', { maxLength: 100, placeholder: 'Titre – artiste' });
  const url = h('input', { type: 'url', maxLength: 300, placeholder: 'Lien YouTube, Spotify, Deezer, SoundCloud…' });
  const form = h('div.post-form', title, url, h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: async () => {
    if (title.value.trim().length < 2) return toast('Donne le titre', 'error');
    if (url.value && !MUSIC.test(url.value.trim())) return toast('Lien accepté : YouTube, Spotify, Deezer, SoundCloud ou Apple Music', 'error');
    try { await post('song', { title: title.value.trim(), url: url.value.trim() }); title.value = ''; url.value = ''; toast('Ajouté à la playlist 🎵', 'success'); }
    catch (err) { toastError(err); }
  } }, 'Ajouter 🎵'));
  liveList('🎵 Playlist de la classe', form, () => board.filter((b) => b.kind === 'song')
    .sort((a, b) => Object.keys(b.likes || {}).length - Object.keys(a.likes || {}).length).map((b) => {
      const link = txt(b.data.url, 300);
      return h('div.post.song',
        h('b', txt(b.data.title, 100)), h('small', ` · proposé par ${memberName(b.by)}`),
        MUSIC.test(link) ? h('a.btn.btn-ghost.btn-sm', { href: link, target: '_blank', rel: 'noopener noreferrer' }, '▶ Écouter') : null,
        h('div.post-foot', likeBtn(b), removeBtn(b, b.by === state.me.id || isDelegate())));
    }));
}

async function smallPhoto(file) {
  const bmp = await createImageBitmap(file);
  for (const [max, q] of [[900, 0.8], [700, 0.7], [500, 0.6]]) {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/webp', q);
    if (url.startsWith('data:image/webp') && url.length < 200000) { bmp.close(); return url; }
  }
  bmp.close();
  throw new Error('Photo trop lourde');
}

function openJournal() {
  const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  let month = monthKey();
  const text = h('textarea', { rows: 2, maxLength: 1000, placeholder: 'Un souvenir de ce mois (sortie, fou rire, victoire…)' });
  const file = h('input', { type: 'file', accept: 'image/*' });
  const nav = h('div.week-nav');
  const form = h('div.post-form', nav, text, h('label.field', h('span', 'Photo (facultatif)'), file),
    h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: async (e) => {
      if (text.value.trim().length < 3) return toast('Écris ton souvenir', 'error');
      const btn = e.currentTarget;
    btn.disabled = true;
      try {
        const f = file.files[0];
        const photo = f && f.type.startsWith('image/') && !/svg/i.test(f.type) ? await smallPhoto(f) : '';
        await post('memory', { text: text.value.trim(), photo }, { month: monthKey() });
        text.value = ''; file.value = '';
        toast('Souvenir ajouté 📔', 'success');
      } catch (err) { toastError(err); } finally { btn.disabled = false; }
    } }, 'Ajouter au journal'));
  const fmt = (m) => new Date(`${m}-01T12:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const shift = (n) => { const [y, mo] = month.split('-').map(Number); month = monthKey(new Date(y, mo - 1 + n, 1)); drawNav(); emit('board'); };
  const drawNav = () => nav.replaceChildren(h('button.icon-btn', { type: 'button', onclick: () => shift(-1), 'aria-label': 'Mois précédent' }, '‹'),
    h('b', fmt(month)), h('button.icon-btn', { type: 'button', onclick: () => shift(1), 'aria-label': 'Mois suivant', disabled: month >= monthKey() }, '›'));
  drawNav();
  liveList('📔 Journal de classe', form, () => board.filter((b) => b.kind === 'memory' && b.month === month).map((b) => h('div.post.memory',
    h('div.post-head', avatar(state.members.get(b.by), 28), h('b', memberName(b.by)), h('small', ` · ${fmtDay(b.created_at)}`)),
    h('p', txt(b.data.text, 1000)),
    PHOTO_RE.test(b.data.photo || '') ? h('img.memory-photo', { src: b.data.photo, alt: 'Souvenir' }) : null,
    h('div.post-foot', likeBtn(b), removeBtn(b, b.by === state.me.id || isDelegate())))));
}

// ------------------------------------------------------------ time capsule
async function openCapsules() {
  const text = h('textarea', { rows: 3, maxLength: 3000, placeholder: 'Un message pour la classe du futur : tes prédictions, un souvenir, un défi…' });
  const nextJuly = new Date(new Date().getMonth() >= 6 ? new Date().getFullYear() + 1 : new Date().getFullYear(), 5, 30);
  const when = h('input', { type: 'date', value: nextJuly.toISOString().slice(0, 10), min: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) });
  const listBox = h('div.post-list', h('div.spinner'));
  const m = modal({
    title: '⏳ Capsule temporelle', wide: true,
    body: h('div.slot-form',
      h('p.hint', 'Le message reste scellé jusqu\'à la date choisie : personne ne peut le lire avant (même pas les délégués). Toi seul peux le relire.'),
      text, h('label.field', h('span', 'À ouvrir le'), when),
      h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: async () => {
        const at = new Date(`${when.value}T08:00`);
        if (text.value.trim().length < 3) return toast('Écris ton message', 'error');
        if (!(at > Date.now() + 864e5)) return toast('Choisis une date dans plus d\'un jour', 'error');
        try {
          const ref = doc(col('capsules'));
          const batch = writeBatch(db);
          batch.set(ref, { by: state.me.id, open_at: Timestamp.fromDate(at), ...(await seal('capsule', { text: text.value.trim() })), created_at: serverTimestamp() });
          batch.set(doc(col('capsule_dates'), ref.id), { by: state.me.id, open_at: Timestamp.fromDate(at) });
          await batch.commit();
          toast('Capsule scellée ⏳', 'success');
          m.close();
        } catch (err) { toastError(err); }
      } }, 'Sceller la capsule'),
      h('h4', 'Capsules de la classe'), listBox),
  });
  try {
    const dates = (await getDocs(col('capsule_dates'))).docs.map(plain).sort((a, b) => a.open_at - b.open_at);
    const items = await Promise.all(dates.map(async (c) => {
      const open = c.open_at <= Date.now() || c.by === state.me.id;
      if (!open) return h('div.post.sealed', `🔒 Capsule de ${memberName(c.by)} · s'ouvre le ${new Date(c.open_at).toLocaleDateString('fr-FR', { dateStyle: 'long' })}`);
      const snap = await getDoc(doc(col('capsules'), c.id)).catch(() => null);
      const data = snap?.exists() ? await unseal('capsule', plain(snap)) : null;
      return h('div.post', h('small', `${c.open_at <= Date.now() ? '🔓 Ouverte' : '🔒 (toi seul la vois)'} · de ${memberName(c.by)} · ${new Date(c.open_at).toLocaleDateString('fr-FR', { dateStyle: 'long' })}`),
        h('p', txt(data?.text, 3000) || '…'));
    }));
    listBox.replaceChildren(...(items.length ? items : [h('p.muted.small', 'Aucune capsule pour l\'instant.')]));
  } catch (err) { listBox.replaceChildren(h('p.form-error', err.message)); }
}

// ------------------------------------------------------------ birthday cards
function nextBirthday(md) {
  const [mo, d] = md.split('-').map(Number);
  const now = new Date();
  // Midnight UTC of the day: the year of the card id is the same for the server and the app.
  let at = new Date(Date.UTC(now.getFullYear(), mo - 1, d));
  if (at < Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) at = new Date(Date.UTC(now.getFullYear() + 1, mo - 1, d));
  return at;
}
const cardId = (uid, at) => `${uid}_${at.getUTCFullYear()}`;
const cardAad = (id) => `card:${id}`;

async function openCards() {
  const people = [...state.members.values()].filter((m) => m.status === 'active' && m.id !== state.me.id && state.profiles?.get(m.id)?.birthday)
    .map((m) => ({ m, at: nextBirthday(state.profiles.get(m.id).birthday) })).sort((a, b) => a.at - b.at).slice(0, 12);
  const body = h('div.post-list', people.length ? people.map(({ m, at }) => h('div.post',
    h('div.post-head', avatar(m, 28), h('b', m.display_name), h('small', ` · 🎂 ${fmtBirthday(state.profiles.get(m.id).birthday)} (${Math.round((at - new Date().setHours(0, 0, 0, 0)) / 864e5) || 'aujourd\'hui'}${Math.round((at - new Date().setHours(0, 0, 0, 0)) / 864e5) ? ' j' : ''})`)),
    h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => signCard(m, at) }, '✍️ Signer sa carte'))) : [h('p.muted.small', 'Personne n\'a encore indiqué son anniversaire.')]);
  modal({ title: '🎂 Cartes d\'anniversaire', wide: true, body: h('div.slot-form', h('p.hint', 'La personne découvre sa carte le jour J, avec tous les messages de la classe. Surprise garantie 🤫'), body) });
}

async function signCard(m, at) {
  const id = cardId(m.id, at);
  const ref = doc(col('cards'), id);
  let card = await getDoc(ref).catch(() => null);
  if (!card?.exists()) {
    await setDoc(ref, { target: m.id, open_at: Timestamp.fromDate(at), epoch: state.cls.key_epoch, signatures: {} }).catch(() => {});
    card = await getDoc(ref);
  }
  const data = plain(card);
  const mineSig = data.signatures?.[state.me.id];
  const text = h('textarea', { rows: 3, maxLength: 500, placeholder: `Joyeux anniversaire ${m.display_name} ! …` });
  const others = Object.keys(data.signatures || {}).filter((u) => u !== state.me.id).map(memberName);
  modal({
    title: `🎂 Carte pour ${m.display_name}`,
    body: h('div.slot-form', others.length ? h('p.hint', `Déjà signée par : ${others.join(', ')}`) : h('p.hint', 'Tu es le premier à signer !'),
      mineSig ? h('p.hint', '✅ Tu l\'as déjà signée : ton nouveau message remplacera l\'ancien.') : null, text),
    actions: [
      { label: 'Annuler' },
      { label: 'Signer', variant: 'btn-primary', onClick: async () => {
        if (text.value.trim().length < 2) throw new Error('Écris un petit mot');
        const s = await seal(cardAad(id), { text: text.value.trim() }, state.me.id, data.epoch);
        await updateDoc(ref, { [`signatures.${state.me.id}`]: { iv: s.iv, ciphertext: s.ciphertext } });
        toast('Carte signée 🎉', 'success');
      } },
    ],
  });
}

/** On my birthday, my card opens by itself (once per device). */
let cardShown = false;
async function openMyCard() {
  const md = state.profiles?.get(state.me?.id)?.birthday;
  const today = new Date();
  if (cardShown || !md || md !== `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`) return;
  cardShown = true;
  const id = `${state.me.id}_${today.getFullYear()}`;
  try { if (localStorage.getItem(`cc-card-${id}`) === '1') return; } catch { /* ignore */ }
  const snap = await getDoc(doc(col('cards'), id)).catch(() => null);
  if (!snap?.exists()) return;
  const data = plain(snap);
  const words = [];
  for (const [uid, s] of Object.entries(data.signatures || {})) {
    const w = await unseal(cardAad(id), { ...s, epoch: data.epoch }, uid);
    if (w) words.push(h('div.card-word', h('b', memberName(uid)), h('p', txt(w.text, 500))));
  }
  if (!words.length) return;
  try { localStorage.setItem(`cc-card-${id}`, '1'); } catch { /* ignore */ }
  modal({ title: '🎂 Joyeux anniversaire !', wide: true, body: h('div.bday-card', h('p.big', `Toute la classe a signé ta carte 🥳 (${words.length} message${words.length > 1 ? 's' : ''})`), words) });
}

// ------------------------------------------------------------ end-of-year awards
async function openAwards() {
  const box = h('div.post-list', h('div.spinner'));
  const title = h('input', { maxLength: 60, placeholder: 'Ex. Le plus drôle, le plus en retard, le futur président…' });
  const m = modal({
    title: '🏅 Album de fin d\'année', wide: true,
    body: h('div.slot-form', isDelegate() ? h('div.post-form', title, h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: async () => {
      if (title.value.trim().length < 2) return toast('Donne un titre à la catégorie', 'error');
      try { await addDoc(col('awards'), { title: title.value.trim(), open: true, votes: {}, created_at: serverTimestamp() }); m.close(); openAwards(); }
      catch (err) { toastError(err); }
    } }, 'Nouvelle catégorie')) : null,
    h('p.hint', 'Vote pour un camarade dans chaque catégorie (pas pour toi !). Les résultats s\'affichent quand le délégué clôt la catégorie. Les votes ne sont pas anonymes pour le délégué.'), box),
  });
  const members = [...state.members.values()].filter((x) => x.status === 'active' && x.role !== 'teacher').sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr'));
  const draw = async () => {
    const rows = (await getDocs(col('awards'))).docs.map(plain).sort((a, b) => a.created_at - b.created_at);
    box.replaceChildren(...(rows.length ? rows.map((a) => {
      const counts = new Map();
      for (const v of Object.values(a.votes || {})) counts.set(v, (counts.get(v) || 0) + 1);
      const ranking = [...counts].sort((x, y) => y[1] - x[1]).slice(0, 3);
      const select = h('select', { 'aria-label': a.title, onchange: async (e) => {
        try { await updateDoc(doc(col('awards'), a.id), { [`votes.${state.me.id}`]: e.target.value || deleteField() }); toast('Vote enregistré 🗳️'); }
        catch (err) { toastError(err); }
      } }, h('option', { value: '' }, '— Mon vote —'), members.filter((x) => x.id !== state.me.id).map((x) => h('option', { value: x.id, selected: a.votes?.[state.me.id] === x.id }, x.display_name)));
      return h('div.post.award', h('b', `🏅 ${a.title}`),
        a.open ? select : h('ol.award-podium', ranking.map(([uid, c]) => h('li', `${memberName(uid)} — ${c} vote${c > 1 ? 's' : ''}`))),
        h('small.muted', `${Object.keys(a.votes || {}).length} vote(s)${a.open ? '' : ' · catégorie close'}`),
        isDelegate() ? h('div.btn-row',
          h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => updateDoc(doc(col('awards'), a.id), { open: !a.open }).then(draw).catch(toastError) }, a.open ? 'Clore et révéler' : 'Rouvrir'),
          h('button.link-btn', { type: 'button', onclick: () => deleteDoc(doc(col('awards'), a.id)).then(draw).catch(toastError) }, 'Supprimer')) : null);
    }) : [h('p.muted.small', isDelegate() ? 'Crée la première catégorie !' : 'Le délégué n\'a pas encore créé de catégorie.')]));
  };
  draw().catch((err) => box.replaceChildren(h('p.form-error', err.message)));
}

// ------------------------------------------------------------ class photo (mosaic of avatars)
async function openMosaic() {
  const members = [...state.members.values()].filter((m) => m.status === 'active').sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr'));
  const cols = Math.ceil(Math.sqrt(members.length || 1));
  const S = 160;
  const c = h('canvas.mosaic', { width: cols * S, height: Math.ceil(members.length / cols) * S + 70 });
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0820';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  ctx.font = '700 30px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(state.cls.name, c.width / 2, 45);
  const load = (src) => new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  await Promise.all(members.map(async (m, i) => {
    const x = (i % cols) * S, y = Math.floor(i / cols) * S + 70;
    const p = state.profiles?.get(m.id);
    const src = [p?.photo, p?.gif].find((s) => isSafeAvatar(s));
    const img = src ? await load(src) : null;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + S / 2, y + S / 2 - 12, S / 2 - 22, 0, Math.PI * 2);
    ctx.clip();
    if (img) ctx.drawImage(img, x + 22, y + 10 - 12, S - 44, S - 44);
    else {
      ctx.fillStyle = m.color;
      ctx.fillRect(x, y, S, S);
      ctx.fillStyle = '#fff';
      ctx.font = '700 44px Inter, sans-serif';
      ctx.fillText(m.display_name.slice(0, 2).toUpperCase(), x + S / 2, y + S / 2 + 4);
    }
    ctx.restore();
    ctx.fillStyle = '#ecebff';
    ctx.font = '600 15px Inter, sans-serif';
    ctx.fillText(m.display_name.slice(0, 16), x + S / 2, y + S - 8);
  }));
  modal({
    title: '🖼️ Photo de classe', wide: true, body: h('div.mosaic-box', c),
    actions: [{ label: 'Fermer' }, { label: 'Télécharger l\'image', variant: 'btn-primary', onClick: () => {
      try {
        const a = h('a', { href: c.toDataURL('image/png'), download: `photo-de-classe-${state.cls.name}.png` });
        a.click();
      } catch { throw new Error('Téléchargement impossible (un avatar animé bloque l\'export) : fais une capture d\'écran'); }
      return false;
    } }],
  });
}
