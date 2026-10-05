// « Soutenir le projet » : a free, optional donation (nothing is unlocked by giving). No ads, ever.
// The buttons stay hidden until SUPPORT_URL is filled in config.js.
import { SUPPORT_URL } from './config.js';
import { $$, h, modal } from './ui.js';

/** Only https links to a known donation platform are accepted. */
const ALLOWED = /^https:\/\/(ko-fi\.com|liberapay\.com|(www\.)?paypal\.(me|com)|(www\.)?buymeacoffee\.com|(www\.)?helloasso\.com|(www\.)?tipeee\.com)\//i;
export const supportUrl = () => (ALLOWED.test(SUPPORT_URL || '') ? SUPPORT_URL : '');

export function openSupport() {
  const url = supportUrl();
  if (!url) return;
  modal({
    title: '💜 Soutenir Class Connect',
    body: h('div.slot-form',
      h('p', 'Class Connect est gratuit, sans publicité, et tes données ne sont jamais revendues. Ça ne changera pas.'),
      h('p', 'Le projet est développé bénévolement. Un don aide à payer ce qui fait tourner l\'appli (serveur, nom de domaine).'),
      h('ul',
        h('li', 'C\'est entièrement libre : donner ne débloque rien, ne pas donner n\'enlève rien.'),
        h('li', 'Tu es élève ? Ne paie rien toi-même : montre cette page à un parent si le projet lui plaît.'),
        h('li', 'Le paiement se fait sur un site spécialisé, pas ici : Class Connect ne voit jamais de carte bancaire.')),
      h('a.btn.btn-primary.btn-block', { href: url, target: '_blank', rel: 'noopener noreferrer' }, '💜 Faire un don (ouvre un autre site)')),
    actions: [{ label: 'Fermer' }],
  });
}

export function initSupport() {
  const on = !!supportUrl();
  $$('[data-action="support"]').forEach((b) => { b.hidden = !on; b.addEventListener('click', (e) => { e.preventDefault(); openSupport(); }); });
}
