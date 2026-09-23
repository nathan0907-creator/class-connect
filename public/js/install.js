// Installable app: service worker registration + an install invitation shown at every start until the app is installed.
import { h, icon, toast } from './ui.js';

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

async function install() {
  if (!deferred) return hideBanner();
  const e = deferred;
  deferred = null;
  hideBanner();
  e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome !== 'accepted') toast('Pas de souci : on te le reproposera au prochain démarrage.');
}
