// Browser notifications for new messages while the tab is in the background. Opt-in, remembered per device.
import { $$, toast } from './ui.js';

const KEY = 'cc-notify';
const supported = () => 'Notification' in window;
export const notifyOn = () => { try { return supported() && Notification.permission === 'granted' && localStorage.getItem(KEY) === '1'; } catch { return false; } };

function renderToggles() {
  $$('[data-action="notify"]').forEach((b) => {
    const on = notifyOn();
    b.classList.toggle('on', on);
    b.title = on ? 'Notifications activées (cliquer pour couper)' : 'Activer les notifications';
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', String(on));
  });
}

export function initNotify() {
  $$('[data-action="notify"]').forEach((b) => {
    b.hidden = !supported();
    b.addEventListener('click', toggle);
  });
  renderToggles();
}

async function toggle() {
  if (notifyOn()) {
    try { localStorage.setItem(KEY, '0'); } catch { /* ignore */ }
    toast('Notifications coupées 🔕');
    return renderToggles();
  }
  if (Notification.permission === 'denied') {
    return toast('Notifications bloquées par le navigateur : autorise-les dans les réglages du site (icône 🔒 de la barre d\'adresse).', 'error', 7000);
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    toast('Notifications activées 🔔 Tu seras prévenu des nouveaux messages quand le site est en arrière-plan.', 'success', 6000);
  }
  renderToggles();
}

/** Shows a notification only when the page is not being looked at. */
export function notify(title, body, tag) {
  if (!notifyOn() || !document.hidden) return;
  try {
    const n = new Notification(title, { body, tag, icon: 'img/icon-192.png', badge: 'img/icon-192.png', renotify: true });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* some mobile browsers only allow notifications from a service worker */ }
}
