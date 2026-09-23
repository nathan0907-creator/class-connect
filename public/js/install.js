// Installable app: service worker registration + an install invitation shown at every start until the app is installed.
import { $$, h, icon, modal, toast } from './ui.js';

const INSTALLED = 'cc-installed';
let deferred = null;   // Chrome / Edge / Samsung "beforeinstallprompt" event
let banner = null;

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const remember = (v) => { try { localStorage.setItem(INSTALLED, v); } catch { /* ignore */ } };

export function initInstall() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker', err));
  }
  // "Installer l'application" button (Équipage tab): hidden once the app runs installed.
  $$('[data-action="install"]').forEach((b) => {
    b.hidden = standalone();
    b.addEventListener('click', installFromButton);
  });
  if (standalone()) { remember('1'); return; }
  // Uninstalled since last time: the browser offers the install again, so do we.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    remember('0');
    setTimeout(showBanner, 1500);
  });
  window.addEventListener('appinstalled', () => {
    remember('1');
    deferred = null;
    hideBanner();
    $$('[data-action="install"]').forEach((b) => { b.hidden = true; });
    toast('Class Connect est installé 🚀 Retrouve-le sur ton écran d\'accueil.', 'success', 6000);
  });
  // Safari (iPhone / iPad) has no install button: explain how to do it by hand.
  if (isIOS()) setTimeout(showBanner, 2500);
}

function showBanner() {
  if (banner || standalone()) return;
  const ios = !deferred && isIOS();
  if (!deferred && !ios) return;
  banner = h('aside.install-banner', { role: 'dialog', 'aria-label': 'Installer l\'application' },
    h('div.install-icon', h('img', { src: 'img/icon-192.png', alt: '', width: 44, height: 44 })),
    h('div.install-text',
      h('b', 'Installe Class Connect'),
      ios
        ? h('span', 'Dans Safari, touche Partager (le carré avec une flèche ↑) puis « Sur l\'écran d\'accueil » : appli plein écran, hors ligne et notifications même fermée.')
        : h('span', 'Ouvre la classe en un geste, même hors ligne, et reçois les messages même quand l\'appli est fermée.')),
    h('div.install-actions',
      ios ? null : h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: install }, icon('plus'), h('span', 'Installer')),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: hideBanner }, ios ? 'OK' : 'Plus tard')));
  document.body.append(banner);
  requestAnimationFrame(() => banner.classList.add('in'));
}

function hideBanner() {
  if (!banner) return;
  const b = banner;
  banner = null;
  b.classList.remove('in');
  setTimeout(() => b.remove(), 400);
}

/** The browser's own install prompt when available, otherwise step-by-step instructions for this device. */
function installFromButton() {
  if (standalone()) return toast('L\'application est déjà installée 🚀');
  if (deferred) return install();
  const ios = isIOS();
  const android = /android/i.test(navigator.userAgent);
  const steps = ios
    ? ['Ouvre ce site dans Safari (pas dans une autre appli).', 'Touche Partager : le carré avec une flèche ↑ en bas de l\'écran.', 'Choisis « Sur l\'écran d\'accueil », puis « Ajouter ».']
    : android
      ? ['Touche le menu ⋮ en haut à droite de Chrome.', 'Choisis « Installer l\'application » (ou « Ajouter à l\'écran d\'accueil »).', 'Confirme avec « Installer ».']
      : ['Dans Chrome ou Edge, clique sur l\'icône d\'installation ⊕ à droite de la barre d\'adresse.', 'Ou ouvre le menu ⋮ puis « Installer Class Connect… ».', 'Firefox ne sait pas installer d\'applis : utilise Chrome ou Edge.'];
  modal({
    title: '📲 Installer l\'application',
    body: h('div',
      h('p.muted', 'Une fois installée, Class Connect s\'ouvre en plein écran depuis ton écran d\'accueil, marche hors ligne et peut te notifier même fermée.'),
      h('ol.guide-steps', steps.map((s, i) => h('li.guide-step', h('span.guide-num', String(i + 1)), h('div', h('p', s)))))),
    actions: [{ label: 'Compris !', variant: 'btn-primary' }],
  });
}

async function install() {
  if (!deferred) return hideBanner();
  const e = deferred;
  deferred = null;
  hideBanner();
  e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome !== 'accepted') toast('Pas de souci : on te le reproposera au prochain démarrage.');
}
