// "Besoin d'aide ?": step-by-step guide to create an account, sign in, join a class and recover access.
import { $$, h, modal } from './ui.js';

const step = (n, title, ...text) => h('li.guide-step', h('span.guide-num', String(n)), h('div', h('b', title), h('p', ...text)));
const tip = (...text) => h('p.guide-tip', ...text);

const TOPICS = {
  create: {
    label: 'Créer un compte',
    body: () => [
      h('ol.guide-steps',
        step(1, 'Invente un pseudo', 'Dans « Pseudo ou adresse e-mail », tape le pseudo que tu veux (3 à 24 caractères : lettres, chiffres, _ . -), puis touche ', h('b', 'Décoller'), '. S\'il est libre, la fusée décolle et on crée ton compte.'),
        step(2, 'Choisis un mot de passe', 'Au moins 8 caractères. La barre de couleur t\'indique s\'il est assez solide. Retape-le dans « Confirmer ».'),
        step(3, 'Ajoute ton e-mail (conseillé)', 'C\'est facultatif, mais c\'est le ', h('b', 'seul moyen'), ' de récupérer ton compte si tu oublies ton mot de passe. Tu pourras aussi te connecter avec.'),
        step(4, 'Accepte les CGU puis « Créer mon compte »', 'La fusée atterrit sur Mars : ton compte est prêt ! Il ne reste qu\'à rejoindre ta classe.')),
      tip('💡 Tu as commencé par ton e-mail ? Pas de souci : on te demandera juste de choisir un pseudo à l\'étape suivante.'),
      tip('🔐 Ton mot de passe sert à chiffrer tes messages sur ton appareil : il n\'est jamais envoyé en clair, même à nous. Note-le quelque part de sûr.'),
    ],
  },
  login: {
    label: 'Me connecter',
    body: () => [
      h('ol.guide-steps',
        step(1, 'Pseudo ou e-mail', 'Tape ton pseudo ', h('em', 'ou'), ' l\'adresse e-mail liée à ton compte, puis touche ', h('b', 'Décoller'), '.'),
        step(2, 'Mot de passe', 'On te reconnaît (« Content de te revoir ! ») : entre ton mot de passe puis ', h('b', 'Se connecter'), '.'),
        step(3, 'Nouvel appareil ?', 'Tes clés de chiffrement sont déverrouillées automatiquement avec ton mot de passe. Si on te demande « Déverrouiller tes clés », entre simplement le même mot de passe.')),
      tip('❓ « Nouveau ? On crée ton compte » alors que tu es déjà inscrit ? Vérifie l\'orthographe de ton pseudo, ou essaie avec ton e-mail.'),
      tip('📲 Installe l\'appli (bandeau en haut, ou menu du navigateur → « Installer ») pour rester connecté et recevoir les notifications.'),
    ],
  },
  join: {
    label: 'Rejoindre ma classe',
    body: () => [
      h('ol.guide-steps',
        step(1, 'Avec un lien ou un QR code', 'Ouvre simplement le lien envoyé par ton délégué (ou scanne le QR code), puis connecte-toi ou crée ton compte : ta demande part toute seule.'),
        step(2, 'Avec un code', 'Sinon, dans « Rejoindre une classe », tape le code du type ', h('b', 'ABCD-EFGH'), ' donné par ton délégué. Professeurs : utilisez le code professeur.'),
        step(3, 'Attends la validation', 'Un délégué doit accepter ta demande (écran « En attente d\'amarrage »). Dès qu\'il valide, tu entres dans la classe automatiquement.'),
        step(4, 'Tu es délégué ?', 'Si ta classe n\'existe pas encore, choisis « Créer une classe ». Tu pourras ensuite partager le lien d\'invitation depuis l\'onglet Délégué.')),
      tip('🔑 « En attente de la clé… » après la validation ? Un membre déjà dans la classe doit être en ligne pour te transmettre la clé de chiffrement : ça se fait tout seul.'),
    ],
  },
  forgot: {
    label: 'Mot de passe oublié',
    body: () => [
      h('ol.guide-steps',
        step(1, 'Entre ton adresse e-mail', 'puis touche « Décoller » comme pour te connecter.'),
        step(2, 'Touche « Mot de passe oublié ? »', 'Un e-mail t\'est envoyé (regarde aussi dans les spams). Ouvre le lien et choisis un nouveau mot de passe.'),
        step(3, 'Reviens te connecter', 'avec le nouveau mot de passe. Pour ta sécurité, de nouvelles clés sont créées : un délégué doit revalider ton accès à la classe (comme à ta première arrivée).')),
      tip('⚠️ Sans e-mail lié au compte, le mot de passe ne peut pas être réinitialisé : il faudra créer un nouveau compte et redemander l\'accès à ton délégué.'),
    ],
  },
};

export function openGuide(topic = 'create') {
  const tabs = h('div.seg.seg-sm.seg-wrap.guide-tabs', { role: 'tablist' });
  const content = h('div.guide-content', { role: 'tabpanel' });
  const select = (key) => {
    tabs.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.topic === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    content.replaceChildren(...TOPICS[key].body());
  };
  tabs.append(...Object.entries(TOPICS).map(([key, t]) => h('button', { type: 'button', role: 'tab', dataset: { topic: key }, onclick: () => select(key) }, t.label)));
  select(TOPICS[topic] ? topic : 'create');
  modal({ title: 'Guide de bord 🚀', body: h('div.guide', tabs, content), wide: true, actions: [{ label: 'Compris !', variant: 'btn-primary' }] });
}

export function initGuide() {
  $$('[data-guide]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); openGuide(b.dataset.guide); }));
}
