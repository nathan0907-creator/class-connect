// Relay 1420. What it relays is encrypted with the code of the transmission (see scripts/arg-build.mjs).
import DATA from './relais-data.js';

const enc = new TextEncoder();
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const norm = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const $ = (s) => document.querySelector(s);

async function open(key, box, aad) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: enc.encode(aad) }, key, unb64(box.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function unlock(code) {
  const a = norm(code);
  if (!a) return null;
  for (const w of DATA.wraps) {
    try {
      const base = await crypto.subtle.importKey('raw', enc.encode(a), 'PBKDF2', false, ['deriveKey']);
      const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(w.salt), iterations: DATA.iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const raw = await open(k, w, 'wrap|relais');
      const key = await crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['decrypt']);
      return await open(key, DATA.box, 'relais');
    } catch { /* not this one */ }
  }
  return null;
}

const line = (text, cls = '') => Object.assign(document.createElement('pre'), { textContent: text, className: cls });

/** « (comment rejoindre ?) » : how to add an unofficial server, device by device. */
function tutorial(secret) {
  const el = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
  const b = secret.bedrock;
  const steps = [
    ['💻 Ordinateur — Minecraft Java (Windows, Mac, Linux)', [
      'Lance Minecraft Java Edition, puis « Multijoueur ».',
      '« Ajouter un serveur » → nom : Station ÉCHO → adresse du serveur : ' + secret.address,
      '« Terminé », puis double-clic sur Station ÉCHO.',
      'Version trop récente ou trop ancienne ? Aucun souci, le serveur accepte les autres versions.',
    ]],
    ...(b ? [
      ['📱 Téléphone, tablette ou PC Windows — Minecraft Bedrock', [
        '« Jouer » → onglet « Serveurs ».',
        'Tout en bas de la liste : « Ajouter un serveur ».',
        `Nom : Station ÉCHO · Adresse : ${b.host} · Port : ${b.port}`,
        '« Enregistrer », puis touche le serveur pour le rejoindre.',
      ]],
      ['🎮 Xbox, PlayStation ou Switch', [
        'Les consoles n\'affichent que les serveurs officiels : il faut une petite astuce.',
        'Le plus simple : installe l\'appli gratuite « BedrockTogether » sur un téléphone connecté au même Wi-Fi que la console.',
        `Dans l'appli : adresse ${b.host}, port ${b.port}, puis « Run ».`,
        'Sur la console : Minecraft → « Jouer » → onglet « Amis » → la partie apparaît dans « Parties en réseau local ». Rejoins-la (l\'appli doit rester ouverte).',
        'Autre méthode (sans téléphone) : l\'outil « BedrockConnect », qui passe par un changement de DNS dans les réglages réseau de la console. Demande à un adulte, et remets le DNS automatique après.',
      ]],
    ] : []),
    ['❓ Ça ne marche pas ?', [
      'Vérifie l\'adresse lettre par lettre (sans espace).',
      'Sur Bedrock, le port est obligatoire.',
      'Le serveur tourne sur un vieux PC : s\'il ne répond pas, réessaie un peu plus tard.',
    ]],
  ];
  const box = Object.assign(document.createElement('details'), { className: 'tuto' });
  box.append(el('summary', '(comment rejoindre ? tuto par appareil)'));
  for (const [title, list] of steps) {
    const ol = document.createElement('ol');
    for (const s of list) ol.append(el('li', s));
    box.append(el('h3', title), ol);
  }
  return box;
}

$('[data-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const input = form.elements.code;
  const out = $('[data-out]');
  if (!input.value.trim() || input.disabled) return;
  input.disabled = true;
  out.replaceChildren(line('RELAIS 1420 > vérification…', 'dim'));
  const secret = await unlock(input.value);
  if (!secret) {
    await new Promise((r) => setTimeout(r, 1200));
    out.replaceChildren(line('RELAIS 1420 > code refusé.', 'dim'));
    input.disabled = false;
    input.select();
    return;
  }
  const addr = Object.assign(document.createElement('span'), { className: 'addr', textContent: secret.address });
  out.replaceChildren(
    line('RELAIS 1420 > accès accordé.\nRELAIS 1420 > coordonnées de la station ÉCHO :'),
    addr,
    line(`\nMinecraft Java · version ${secret.version} (ou plus récente)\nMultijoueur → Ajouter un serveur → colle l'adresse.`),
    ...(secret.bedrock ? [
      line('\nMinecraft Bedrock (téléphone, tablette, Windows, console) :'),
      Object.assign(document.createElement('span'), { className: 'addr', textContent: `${secret.bedrock.host}` }),
      line(`port : ${secret.bedrock.port}\nJouer → Serveurs → Ajouter un serveur → adresse + port.`),
    ] : []),
    tutorial(secret),
    line('\nÀ bord : mode aventure. Regarde, lis, ne casse rien.\nApproche-toi des personnages (ou clic droit) : ils t\'aident.\nChaque salle garde un mot pour VEGA.\nN\'oublie pas de donner à VEGA le code de la transmission.'),
  );
  form.remove();
});
