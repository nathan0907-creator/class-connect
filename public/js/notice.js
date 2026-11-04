// One-off message to everyone after they log in (e.g. « problème résolu »), set in status.json → "notice".
// Shown once per device and per notice id; never on top of the welcome video.
import { on } from './state.js';
import { h, modal } from './ui.js';
import { welcomeVideoDone } from './welcome-video.js';

const SEEN = 'cc-notice-seen';
let shown = false;

async function check() {
  if (shown) return;
  let st = null;
  try { st = await (await fetch(`status.json?t=${Date.now()}`, { cache: 'no-store' })).json(); } catch { return; }
  const n = st?.notice;
  if (!n?.id || !n.message) return;
  try { if (localStorage.getItem(SEEN) === String(n.id)) return; } catch { /* private mode: shown each visit */ }
  shown = true;
  await welcomeVideoDone();
  modal({
    title: String(n.title || 'Information').slice(0, 80),
    body: h('div.slot-form', String(n.message).slice(0, 600).split('\n').map((p) => h('p', p))),
    actions: [{ label: 'Compris 👍', variant: 'btn-primary' }],
    onClose: () => { try { localStorage.setItem(SEEN, String(n.id)); } catch { /* ignore */ } },
  });
}

export function initNotice() {
  on('app-ready', () => { setTimeout(check, 1200); });
}
