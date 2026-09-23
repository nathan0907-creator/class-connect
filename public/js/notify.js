// Notifications for new messages: shown by the page while it is open in the background, and by push messages
// (service worker) when the app is closed. Opt-in, remembered per device.
import { $$, toast } from './ui.js';
import { enablePush, disablePush } from './push.js';

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

/** Called once signed in: refreshes this device's push registration (tokens change over time). */
export function syncPush() {
  if (notifyOn()) enablePush().catch((err) => console.warn('Push', err));
}
/** Never blocks a logout for long when offline (the deletion then happens on the next connection). */
export const stopPush = () => Promise.race([disablePush().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);

async function toggle() {
  if (notifyOn()) {
    try { localStorage.setItem(KEY, '0'); } catch { /* ignore */ }
    stopPush();
    toast('Notifications coupées 🔕');
    return renderToggles();
  }
  if (Notification.permission === 'denied') {
    return toast('Notifications bloquées par le navigateur : autorise-les dans les réglages du site (icône 🔒 de la barre d\'adresse).', 'error', 7000);
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    const push = await enablePush().catch((err) => { console.warn('Push', err); return false; });
    toast(push
      ? 'Notifications activées 🔔 Tu seras prévenu des nouveaux messages, même appli fermée.'
      : 'Notifications activées 🔔 (quand le site est ouvert en arrière-plan : ce navigateur ne reçoit pas les notifications appli fermée)', 'success', 7000);
  }
  renderToggles();
}

/** Shows a notification only when the page is not being looked at. */
export async function notify(title, body, tag) {
  if (!notifyOn() || !document.hidden) return;
  const options = { body, tag, renotify: true, icon: 'img/icon-192.png', badge: 'img/icon-192.png', data: { url: location.href } };
  try {
    // Android only allows notifications through the service worker.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return await reg.showNotification(title, options);
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* unsupported */ }
}
