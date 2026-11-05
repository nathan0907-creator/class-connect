// « Vote des thèmes » : 5 universes for the app, each with a short demo video; everyone signed in votes (and may
// change their mind), results update live. Offered once per device after login, then from Équipage / Vie de classe.
import { doc, setDoc, collection, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from './fb.js';
import { state, on } from './state.js';
import { $$, h, modal, toast, toastError } from './ui.js';
import { welcomeVideoDone } from './welcome-video.js';

export const CANDIDATES = [
  { id: 'galaxie', name: '🪐 Galaxie', text: 'L\'univers actuel : planète à anneaux, nébuleuses et étoiles.' },
  { id: 'abysses', name: '🌊 Abysses', text: 'Au fond de l\'océan : bulles, méduses lumineuses et rayons de lumière.' },
  { id: 'sakura', name: '🌸 Sakura', text: 'Un crépuscule japonais : montagnes, soleil couchant et pétales qui tombent.' },
  { id: 'neon', name: '🌃 Néon City', text: 'Une ville cyberpunk sous la pluie, néons rose et cyan.' },
  { id: 'arcade', name: '👾 Rétro Arcade', text: 'Pixel art 8-bit, petits fantômes et couleurs de borne d\'arcade.' },
];
const ASKED = 'cc-theme-vote-asked';

export function openThemeVote() {
  let votes = new Map();   // uid -> choice
  const mine = () => votes.get(state.me?.id);
  const cards = CANDIDATES.map((c) => {
    const bar = h('i');
    const pct = h('small.tv-pct');
    const btn = h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => vote(c.id) }, 'Voter');
    const card = h('article.tv-card',
      h('video', { src: `media/themes/${c.id}.mp4`, poster: `media/themes/${c.id}.jpg`, muted: true, loop: true, autoplay: true, playsInline: true, preload: 'metadata', 'aria-label': `Démo du thème ${c.name}` }),
      h('div.tv-info', h('b', c.name), h('p', c.text), h('div.tv-bar', bar), h('div.tv-foot', pct, btn)));
    return { c, card, bar, pct, btn };
  });
  const total = h('p.muted.small');
  const unsub = onSnapshot(collection(db, 'theme_votes'), (snap) => {
    votes = new Map(snap.docs.map((d) => [d.id, d.get('choice')]));
    const n = votes.size;
    for (const x of cards) {
      const count = [...votes.values()].filter((v) => v === x.c.id).length;
      const p = n ? Math.round((count / n) * 100) : 0;
      x.bar.style.width = `${p}%`;
      x.pct.textContent = `${count} vote${count > 1 ? 's' : ''} · ${p} %`;
      const chosen = mine() === x.c.id;
      x.card.classList.toggle('chosen', chosen);
      x.btn.textContent = chosen ? '✔ Ton choix' : 'Voter';
      x.btn.disabled = chosen;
    }
    total.textContent = n ? `${n} personne${n > 1 ? 's ont' : ' a'} voté. Tu peux changer d'avis quand tu veux.` : 'Personne n\'a encore voté : à toi de commencer !';
  }, toastError);
  async function vote(id) {
    try {
      await setDoc(doc(db, 'theme_votes', state.me.id), { choice: id, at: serverTimestamp() });
      toast(`Vote enregistré : ${CANDIDATES.find((c) => c.id === id).name} 🗳️`, 'success');
    } catch (err) { toastError(err); }
  }
  modal({
    title: '🗳️ Choisis le prochain look de Class Connect',
    wide: true,
    body: h('div.tv-box', h('p', 'Regarde les démos et vote pour ton univers préféré. Celui qui gagne deviendra le thème de l\'appli.'),
      h('div.tv-grid', cards.map((x) => x.card)), total),
    onClose: unsub,
  });
}

/** Offered once per device, after the welcome video and any other window. */
function offer() {
  try { if (localStorage.getItem(ASKED) === '1') return; } catch { return; }
  let tries = 0;
  const attempt = () => {
    if (document.querySelector('.modal-backdrop, .bday-party')) { if (++tries < 40) setTimeout(attempt, 3000); return; }
    try { localStorage.setItem(ASKED, '1'); } catch { /* ignore */ }
    openThemeVote();
  };
  welcomeVideoDone().then(() => setTimeout(attempt, 6000));
}

export function initThemeVote() {
  $$('[data-action="theme-vote"]').forEach((b) => b.addEventListener('click', openThemeVote));
  on('app-ready', offer);
}
