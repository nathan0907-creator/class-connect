// Cookie banner (CNIL/RGPD): analytics only after explicit consent; refusing is as easy as accepting.
const KEY = 'cc-consent-v1';

function read() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function write(value) {
  try { localStorage.setItem(KEY, value); } catch { /* private mode */ }
}
function clearAnalyticsCookies() {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (/^_ga/.test(name)) {
      document.cookie = `${name}=; Max-Age=0; path=/`;
      document.cookie = `${name}=; Max-Age=0; path=/; domain=${location.hostname}`;
    }
  }
}

export function initConsent({ onGranted } = {}) {
  const choice = read();
  if (choice === 'granted') onGranted?.();
  if (!choice) showBanner(onGranted);
  document.querySelectorAll('[data-action="cookies"]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    showBanner(onGranted);
  }));
}

function showBanner(onGranted) {
  document.querySelector('.cookie-banner')?.remove();
  const banner = document.createElement('div');
  banner.className = 'cookie-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-live', 'polite');
  banner.setAttribute('aria-label', 'Gestion des cookies');
  const base = document.querySelector('meta[name="cc-base"]')?.content || '';
  // Built node by node (no innerHTML): nothing here can ever be read as HTML.
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const choice = (value, label) => { const b = el('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: label }); b.dataset.choice = value; return b; };
  banner.append(
    el('p', {}, el('b', { textContent: '🍪 Cookies' }),
      ' — Class Connect n\'utilise que le stockage indispensable à la connexion. Avec ton accord, nous mesurons aussi l\'audience de façon anonyme (Google Analytics) pour améliorer le site. ',
      el('a', { href: `${base}confidentialite.html`, textContent: 'En savoir plus' })),
    el('div', { className: 'cookie-actions' }, choice('denied', 'Refuser'), choice('granted', 'Accepter')));
  banner.addEventListener('click', (e) => {
    const value = e.target.closest('[data-choice]')?.dataset.choice;
    if (!value) return;
    const before = read();
    write(value);
    banner.classList.add('out');
    setTimeout(() => banner.remove(), 350);
    if (value === 'granted') onGranted?.();
    if (value === 'denied') {
      clearAnalyticsCookies();
      if (before === 'granted') location.reload();
    }
  });
  document.body.append(banner);
}
