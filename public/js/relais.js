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
    line('\nÀ bord : mode aventure. Regarde, lis, ne casse rien.\nApproche-toi des personnages (ou clic droit) : ils t\'aident.\nChaque salle garde un mot pour VEGA.\nN\'oublie pas de donner à VEGA le code de la transmission.'),
  );
  form.remove();
});
