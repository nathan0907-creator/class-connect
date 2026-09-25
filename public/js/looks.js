// Profile looks: banner, song of the moment, avatar frames (unlocked by badges), animated mood and the
// "space ID card". Chosen in the profile editor and saved in the encrypted profile (see profiles.js).
import { state } from './state.js';
import { h, modal, toast, avatar } from './ui.js';
import { statsOf, badgeList, levelOf } from './stats.js';
import { starName, constellationName } from './cosmos.js';

/** Banners: colour stops, used both in CSS and when drawing the ID card. */
export const BANNERS = {
  galaxy: ['🌌 Galaxie', ['#1b0f4d', '#6c4cff', '#ff4fd8']],
  sunset: ['🌅 Coucher de soleil', ['#ff7a1c', '#ff4fd8', '#6c4cff']],
  ocean: ['🌊 Océan', ['#041a3a', '#1f6fd6', '#29f0d3']],
  aurora: ['🟢 Aurore', ['#062a1c', '#1fd18a', '#7c5cff']],
  lava: ['🌋 Lave', ['#2a0a05', '#e0531f', '#ffcf6b']],
  candy: ['🍬 Bonbon', ['#ff9ee8', '#c77dff', '#7ae6ff']],
  matrix: ['💚 Matrice', ['#000000', '#0b6b4f', '#3dffa8']],
  gold: ['👑 Or', ['#3a2a00', '#b8860b', '#ffe07a']],
  night: ['🌙 Nuit', ['#03020a', '#1c2a6b', '#5f7bff']],
};
export const bannerCss = (key) => (BANNERS[key] ? `linear-gradient(120deg, ${BANNERS[key][1].join(', ')})` : '');

/** Avatar frames: free, or unlocked by a badge (see stats.js). */
export const FRAMES = {
  neon: { label: 'Néon', colors: ['#00d4ff', '#7c5cff'] },
  rocket: { label: 'Décollage', badge: 'first', colors: ['#7ae6ff', '#1f4fd6'], emoji: '🚀' },
  heart: { label: 'Bienveillant', badge: 'kind', colors: ['#ff9ee8', '#ff4d6d'], emoji: '💐' },
  brain: { label: 'Révisionniste', badge: 'reviser', colors: ['#b4ff5c', '#1fd18a'], emoji: '📚' },
  gamer: { label: 'Joueur', badge: 'gamer', colors: ['#c77dff', '#ff4fd8'], emoji: '🎮' },
  fire: { label: 'Semaine de feu', badge: 'streak7', colors: ['#ffcf6b', '#ff5f1f'], emoji: '🔥' },
  comet: { label: 'Comète', badge: 'streak30', colors: ['#7af0ff', '#ffffff'], emoji: '☄️' },
  planet: { label: 'Astronaute', badge: 'xp1000', colors: ['#6c4cff', '#29d3ff'], emoji: '🪐' },
  star: { label: 'Légende du chat', badge: 'legend', colors: ['#fff1a0', '#ffcf6b'], emoji: '🌟' },
  crown: { label: 'Commandant', badge: 'xp10000', colors: ['#ffe07a', '#b8860b'], emoji: '👑' },
};
export const frameUnlocked = (uid, key) => Object.hasOwn(FRAMES, key) && (!FRAMES[key].badge || (statsOf(uid).badges || []).includes(FRAMES[key].badge));

/** Animated moods: an emoji and its animation. */
export const MOODS = {
  happy: ['😄', 'bounce', 'Joyeux'], cool: ['😎', 'tilt', 'Tranquille'], love: ['🥰', 'pulse', 'Amoureux'],
  sleepy: ['😴', 'float', 'Fatigué'], focus: ['🧠', 'pulse', 'Concentré'], party: ['🥳', 'shake', 'En fête'],
  stressed: ['😰', 'shake', 'Stressé'], sick: ['🤒', 'float', 'Malade'], fire: ['🔥', 'flicker', 'En feu'],
  rocket: ['🚀', 'launch', 'Motivé'], music: ['🎧', 'tilt', 'En musique'], sad: ['😢', 'float', 'Triste'],
  angry: ['😤', 'shake', 'Énervé'], star: ['🤩', 'spin', 'Émerveillé'], alien: ['👽', 'float', 'Dans la lune'],
};

export const SONG_MAX = 80;
const own = (o, k) => typeof k === 'string' && Object.hasOwn(o, k);
export const cleanLooks = (p) => ({
  banner: own(BANNERS, p.banner) ? p.banner : '',
  frame: own(FRAMES, p.frame) ? p.frame : '',
  mood: own(MOODS, p.mood) ? p.mood : '',
  song: String(p.song || '').replace(/\s+/g, ' ').trim().slice(0, SONG_MAX),
});

// Every avatar of the app gets its frame and mood through this hook (ui.js can't import this module).
state.avatarDeco = (uid, size) => {
  const p = state.profiles?.get(uid);
  if (!p) return null;
  const frame = p.frame && frameUnlocked(uid, p.frame) ? FRAMES[p.frame] : null;
  const mood = size >= 30 && MOODS[p.mood] ? MOODS[p.mood] : null;
  if (!frame && !mood) return null;
  return {
    className: frame ? 'framed' : '',
    style: frame ? { '--f1': frame.colors[0], '--f2': frame.colors[1] } : {},
    child: mood ? h(`span.mood-badge.mood-${mood[1]}`, { 'aria-label': `Humeur : ${mood[2]}`, title: mood[2] }, mood[0]) : null,
  };
};

// ------------------------------------------------------------ editor (inside « Personnaliser mon compte »)
export function looksEditor(current = {}) {
  const me = state.me;
  const chosen = cleanLooks(current);
  const pick = (grid, cls, key, value) => {
    chosen[key] = chosen[key] === value ? '' : value;
    grid.querySelectorAll(`.${cls}`).forEach((b) => b.classList.toggle('active', b.dataset.v === chosen[key]));
  };

  const banners = h('div.banner-grid', Object.entries(BANNERS).map(([k, [label]]) => h(`button.banner-pick${chosen.banner === k ? '.active' : ''}`, {
    type: 'button', 'data-v': k, style: { background: bannerCss(k) }, onclick: () => pick(banners, 'banner-pick', 'banner', k),
  }, label)));

  const frames = h('div.frame-grid', Object.entries(FRAMES).map(([k, f]) => {
    const ok = frameUnlocked(me.id, k);
    return h(`button.frame-pick${chosen.frame === k ? '.active' : ''}${ok ? '' : '.locked'}`, {
      type: 'button', 'data-v': k, disabled: !ok,
      title: ok ? f.label : `🔒 À débloquer : badge « ${f.label} »`,
      onclick: () => pick(frames, 'frame-pick', 'frame', k),
    }, h('span.frame-demo', { style: { '--f1': f.colors[0], '--f2': f.colors[1] } }, f.emoji || '✨'),
    h('small', ok ? f.label : `🔒 ${f.label}`));
  }));

  const moods = h('div.mood-grid', Object.entries(MOODS).map(([k, [emoji, anim, label]]) => h(`button.mood-pick${chosen.mood === k ? '.active' : ''}`, {
    type: 'button', 'data-v': k, title: label, 'aria-label': label, onclick: () => pick(moods, 'mood-pick', 'mood', k),
  }, h(`span.mood-${anim}`, emoji))));

  const song = h('input', { value: chosen.song, maxLength: SONG_MAX, placeholder: 'Ex. Daft Punk – Harder, Better, Faster, Stronger', 'aria-label': 'Son du moment' });

  const el = h('details.looks-box',
    h('summary', '🎨 Bannière, cadre, humeur et son du moment'),
    h('div.field', h('span', 'Bannière de profil'), banners),
    h('div.field', h('span', 'Cadre d\'avatar (débloqué par tes badges)'), frames),
    h('div.field', h('span', 'Humeur animée'), moods),
    h('label.field', h('span', '🎵 Son du moment'), song));
  return { el, value: () => cleanLooks({ ...chosen, song: song.value }) };
}

// ------------------------------------------------------------ on the profile card
export function profileBanner(p) {
  return p.banner ? h('div.pv-banner', { style: { background: bannerCss(p.banner) } }) : null;
}
export function songLine(p) {
  if (!p.song) return null;
  // Only a search link built here (never a link typed by someone): no way to smuggle a dangerous address.
  const url = `https://music.youtube.com/search?q=${encodeURIComponent(p.song)}`;
  return h('p.pv-song', '🎵 ', h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, p.song));
}
export function moodLine(p) {
  const m = MOODS[p.mood];
  return m ? h('p.pv-mood', h(`span.mood-${m[1]}`, m[0]), ` ${m[2]}`) : null;
}

// ------------------------------------------------------------ space ID card
const matricule = (uid) => {
  let x = 0;
  for (const c of uid) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return `CC-${x.toString(36).toUpperCase().padStart(7, '0').slice(0, 7)}`;
};

function cardData(m) {
  const p = state.profiles.get(m.id) || {};
  const s = statsOf(m.id);
  return {
    name: m.display_name, username: m.username, cls: state.cls?.name || '', level: levelOf(s.xp || 0), xp: s.xp || 0,
    star: starName(m.id), constellation: constellationName(), badges: badgeList(m.id).map((b) => b.emoji).join(' '),
    mood: MOODS[p.mood]?.[0] || '', song: p.song || '', banner: BANNERS[p.banner]?.[1] || BANNERS.galaxy[1],
    photo: /^data:image\//.test(p.photo || '') ? p.photo : '', color: m.color || '#7c5cff', id: matricule(m.id),
    since: m.created_at ? new Date(m.created_at).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : '',
    role: { teacher: 'Professeur', delegate: 'Délégué', deputy: 'Suppléant' }[m.role] || 'Élève',
  };
}

export function openIdCard(m) {
  const d = cardData(m);
  const card = h('div.id-card', { style: { '--b1': d.banner[0], '--b2': d.banner[1], '--b3': d.banner[2] } },
    h('div.id-top', h('b', '🛰️ CLASS CONNECT'), h('small', 'Carte d\'identité spatiale')),
    h('div.id-body',
      avatar(m, 92),
      h('div.id-fields',
        h('b.id-name', d.name, d.mood ? ` ${d.mood}` : ''),
        h('small', `@${d.username} · ${d.role}`),
        h('dl',
          h('dt', 'Équipage'), h('dd', d.cls),
          h('dt', 'Étoile'), h('dd', `⭐ ${d.star}`),
          h('dt', 'Niveau'), h('dd', `${d.level} · ${d.xp} XP`),
          d.since ? [h('dt', 'À bord depuis'), h('dd', d.since)] : null,
          d.song ? [h('dt', 'En boucle'), h('dd', `🎵 ${d.song}`)] : null),
        d.badges ? h('div.id-badges', d.badges) : null)),
    h('div.id-foot', h('code', d.id), h('span', d.constellation)));
  modal({
    title: '🆔 Carte d\'identité spatiale',
    wide: true,
    body: h('div', card),
    actions: [
      { label: 'Fermer' },
      { label: '💾 Enregistrer l\'image', variant: 'btn-primary', onClick: async () => { await saveCard(d); return false; } },
    ],
  });
}

/** Draws the card on a canvas and gives it as a PNG (made on this device, nothing is sent). */
async function saveCard(d) {
  const W = 960, H = 600;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const x = c.getContext('2d');
  const round = (px, py, w, hh, r) => { x.beginPath(); x.roundRect(px, py, w, hh, r); };
  const g = x.createLinearGradient(0, 0, W, H);
  d.banner.forEach((col, i) => g.addColorStop(i / (d.banner.length - 1), col));
  round(0, 0, W, H, 40); x.fillStyle = g; x.fill();
  x.fillStyle = 'rgba(5, 3, 15, .55)'; round(24, 110, W - 48, H - 134, 28); x.fill();
  // little stars
  x.fillStyle = 'rgba(255,255,255,.8)';
  for (let i = 0; i < 40; i++) { x.beginPath(); x.arc((i * 137) % W, (i * 71) % 100 + 6, (i % 3) + 0.6, 0, 7); x.fill(); }
  x.fillStyle = '#fff';
  x.font = '900 34px Orbitron, sans-serif'; x.fillText('🛰️ CLASS CONNECT', 40, 62);
  x.font = '600 22px Inter, sans-serif'; x.fillText('Carte d\'identité spatiale', 40, 94);
  // photo or initials
  x.save(); x.beginPath(); x.arc(170, 300, 110, 0, 7); x.clip();
  if (d.photo) {
    const img = new Image(); img.src = d.photo;
    await img.decode().catch(() => {});
    x.drawImage(img, 60, 190, 220, 220);
  } else {
    x.fillStyle = d.color; x.fillRect(60, 190, 220, 220);
    x.fillStyle = '#fff'; x.font = '700 90px Inter, sans-serif'; x.textAlign = 'center';
    x.fillText(d.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(), 170, 332); x.textAlign = 'left';
  }
  x.restore();
  const line = (label, value, y) => {
    x.fillStyle = 'rgba(255,255,255,.65)'; x.font = '600 20px Inter, sans-serif'; x.fillText(label, 330, y);
    x.fillStyle = '#fff'; x.font = '700 26px Inter, sans-serif'; x.fillText(String(value).slice(0, 40), 500, y);
  };
  x.fillStyle = '#fff'; x.font = '800 44px Inter, sans-serif'; x.fillText(`${d.name} ${d.mood}`.slice(0, 26), 330, 190);
  x.fillStyle = 'rgba(255,255,255,.7)'; x.font = '600 22px Inter, sans-serif'; x.fillText(`@${d.username} · ${d.role}`, 330, 224);
  line('Équipage', d.cls, 280);
  line('Étoile', `⭐ ${d.star}`, 322);
  line('Niveau', `${d.level} · ${d.xp} XP`, 364);
  if (d.since) line('À bord depuis', d.since, 406);
  if (d.song) line('En boucle', `🎵 ${d.song}`, 448);
  if (d.badges) { x.font = '34px sans-serif'; x.fillText(d.badges.slice(0, 40), 330, 510); }
  x.fillStyle = 'rgba(255,255,255,.75)'; x.font = '600 20px monospace'; x.fillText(d.id, 60, 555);
  x.textAlign = 'right'; x.font = '600 20px Inter, sans-serif'; x.fillText(d.constellation, W - 60, 555);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  if (!blob) return toast('Impossible de créer l\'image', 'error');
  const file = new File([blob], `carte-spatiale-${d.username}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    await navigator.share({ files: [file], title: 'Ma carte d\'identité spatiale' }).catch(() => {});
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: file.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Carte enregistrée 🆔', 'success');
}
