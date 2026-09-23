// Invitation links (…/#rejoindre=ABCD-EFGH) and QR codes. The code travels in the URL fragment,
// which browsers never send to the server.
import { h, icon, modal, toast } from './ui.js';

const KEY = 'cc-pending-invite';
const CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function inviteLink(code) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  return `${base}#rejoindre=${encodeURIComponent(code)}`;
}

/** Reads an invitation from the address bar (once) and keeps it for after sign-in. */
export function captureInvite() {
  const m = location.hash.match(/rejoindre=([A-Za-z0-9-]+)/);
  if (m) {
    const code = decodeURIComponent(m[1]).toUpperCase();
    history.replaceState(null, '', location.pathname + location.search);
    if (CODE_RE.test(code)) {
      try { sessionStorage.setItem(KEY, code); } catch { /* private mode: handled below */ }
      return code;
    }
  }
  return pendingInvite();
}
export const pendingInvite = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
export const clearInvite = () => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copié 📋`, 'success'); }
  catch { toast('Copie impossible : sélectionne le texte manuellement', 'error'); }
}

export function shareInvite(code, className, role) {
  const url = inviteLink(code);
  const text = role === 'teacher'
    ? `Rejoignez la classe « ${className} » sur Class Connect en tant que professeur :`
    : `Rejoins la classe « ${className} » sur Class Connect :`;
  if (navigator.share) return navigator.share({ title: 'Class Connect', text, url }).catch(() => {});
  return copy(`${text} ${url}`, 'Lien');
}

/** Modal with the link, share/copy buttons and a QR code to project in class. */
export async function showInvite(code, className, role) {
  const url = inviteLink(code);
  const canvas = h('canvas.qr-canvas', { width: 280, height: 280, role: 'img', 'aria-label': `QR code d'invitation pour ${className}` });
  const body = h('div.invite-modal',
    h('p.muted', role === 'teacher'
      ? 'Lien réservé aux professeurs : ne le partage pas avec les élèves.'
      : 'Envoie ce lien ou projette le QR code : tes camarades arrivent directement sur la classe après s\'être connectés.'),
    h('div.qr-wrap', canvas),
    h('div.invite-link', h('code', url)),
    h('div.btn-row',
      h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => shareInvite(code, className, role) }, icon('send'), h('span', navigator.share ? 'Partager' : 'Copier le message')),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => copy(url, 'Lien') }, 'Copier le lien'),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => {
        const a = h('a', { href: canvas.toDataURL('image/png'), download: `invitation-${className.replace(/\W+/g, '-')}${role === 'teacher' ? '-profs' : ''}.png` });
        document.body.append(a); a.click(); a.remove();
      } }, 'Télécharger le QR')));
  modal({ title: role === 'teacher' ? 'Invitation professeurs' : `Invitation — ${className}`, body });

  try {
    const { default: qrcode } = await import('https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/+esm');
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    const margin = 2;
    const cell = Math.floor(canvas.width / (n + margin * 2));
    const size = cell * (n + margin * 2);
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = role === 'teacher' ? '#4a2c00' : '#1b0f4d';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    }
  } catch {
    canvas.replaceWith(h('p.muted.small', 'QR code indisponible (hors ligne ?) : utilise le lien.'));
  }
}
