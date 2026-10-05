// Welcome video, shown once on each device when the app starts: the window can only be closed after a few seconds,
// then it never comes back. YouTube is only contacted when the viewer presses play (privacy-enhanced mode, no cookies
// before that); until then, the thumbnail stands in.
import { h, modal } from './ui.js';

const SEEN = 'cc-welcome-video';
const VIDEO = 'MoY4GiYLRb8';
const WAIT = 5;   // seconds before the window can be closed

const seen = () => { try { return localStorage.getItem(SEEN) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch { /* private mode: shown again next time */ } };

let done = Promise.resolve();
/** Resolves once the welcome video is closed (at once if it isn't shown), so other intros don't stack on top of it. */
export const welcomeVideoDone = () => done;

function player() {
  const box = h('div.welcome-video');
  const play = () => box.replaceChildren(h('iframe', {
    src: `https://www.youtube-nocookie.com/embed/${VIDEO}?autoplay=1&rel=0`,
    title: 'Vidéo de présentation de Class Connect',
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    allowFullscreen: true,
    referrerpolicy: 'strict-origin-when-cross-origin',
  }));
  box.append(h('button.welcome-video-play', { type: 'button', onclick: play, 'aria-label': 'Lancer la vidéo' },
    h('img', { src: `https://i.ytimg.com/vi/${VIDEO}/hqdefault.jpg`, alt: '' }),
    h('span.welcome-video-icon', { 'aria-hidden': 'true' }, '▶')));
  return box;
}

function show(onClosed) {
  const end = Date.now() + WAIT * 1000;
  const left = () => Math.max(0, Math.ceil((end - Date.now()) / 1000));
  const { card } = modal({
    title: '🎬 À regarder avant de décoller',
    wide: true,
    canClose: () => left() === 0,
    onClose: () => { markSeen(); onClosed(); },
    body: h('div.slot-form',
      h('p', 'On te conseille vivement de regarder cette courte vidéo de présentation. Elle ne s\'affichera qu\'une seule fois.'),
      player(),
      h('p.muted.small', 'La vidéo est hébergée par YouTube, qui n\'est contacté que si tu la lances.')),
    actions: [{ label: `Fermer (${WAIT})`, variant: 'btn-primary' }],
  });
  const buttons = [card.querySelector('.modal-actions .btn'), card.querySelector('.modal-head .icon-btn')];
  const tick = () => {
    const s = left();
    buttons.forEach((b) => { b.disabled = s > 0; });
    buttons[0].firstChild.textContent = s > 0 ? `Fermer (${s})` : 'Fermer';
    if (!s) clearInterval(timer);
  };
  const timer = setInterval(tick, 250);
  tick();
}

export function initWelcomeVideo() {
  if (seen()) return;
  done = new Promise((resolve) => setTimeout(() => show(resolve), 600));
}
