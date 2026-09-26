// Keyboard shortcuts (computer): « ? » shows them all.
import { emit } from './state.js';
import { $, $$, h, modal } from './ui.js';
import { openDisplay } from './display.js';

const SHORTCUTS = [
  ['?', 'Afficher cette aide'],
  ['/', 'Écrire un message dans le chat'],
  ['Ctrl + K', 'Rechercher dans le canal'],
  ['Alt + 1 … 9', 'Aller à l\'onglet n° 1 à 9 (Chat, Emploi du temps…)'],
  ['Alt + A', 'Réglages d\'affichage'],
  ['Échap', 'Fermer la fenêtre ouverte'],
  ['Entrée', 'Envoyer le message · Maj + Entrée : nouvelle ligne'],
];

const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const inApp = () => document.body.dataset.view === 'app';
const modalOpen = () => !!$('.modal-root .modal-backdrop');

function goChat() {
  emit('goto', 'chat');
  requestAnimationFrame(() => $('#panel-chat .composer textarea')?.focus());
}

export function openShortcuts() {
  modal({
    title: '⌨️ Raccourcis clavier',
    body: h('dl.shortcut-list', SHORTCUTS.map(([k, v]) => [h('dt', k.split(' ').map((p) => (p === '+' || p === '…' || p === ':' ? ` ${p} ` : h('kbd', p)))), h('dd', v)])),
  });
}

export function initShortcuts() {
  $$('[data-action="shortcuts"]').forEach((b) => b.addEventListener('click', openShortcuts));
  document.addEventListener('keydown', (e) => {
    if (!inApp() || e.defaultPrevented) return;
    // Ctrl/Cmd + K works everywhere, even while typing.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      emit('goto', 'chat');
      requestAnimationFrame(() => $('[data-chat-tool="search"]')?.click());
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const n = Number(e.code.replace(/^(Digit|Numpad)/, ''));
      if (n >= 1 && n <= 9) {
        const tabs = $$('.nav-item').filter((b) => b.offsetParent !== null);
        if (tabs[n - 1]) { e.preventDefault(); tabs[n - 1].click(); }
        return;
      }
      if (e.code === 'KeyA') { e.preventDefault(); openDisplay(); }
      return;
    }
    if (typing(e.target) || modalOpen() || e.ctrlKey || e.metaKey) return;
    if (e.key === '?') { e.preventDefault(); openShortcuts(); }
    else if (e.key === '/') { e.preventDefault(); goChat(); }
  });
}
