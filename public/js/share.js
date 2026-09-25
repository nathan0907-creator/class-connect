// "Share to Class Connect" from another app (photos, PDF, a link…): the service worker keeps what was shared
// (sw.js, share target in site.webmanifest), then this page asks where to send it.
import { state, on, emit, isDelegate, CHANNELS, channelsFor } from './state.js';
import { h, modal, toast, toastError, fmtSize } from './ui.js';
import { openChatChannel, sendFile, insertInComposer } from './chat.js';
import { openImport } from './timetable.js';

const CACHE = 'cc-share';
let pending = null;

async function readShared() {
  if (!('caches' in window)) return null;
  const cache = await caches.open(CACHE);
  const metaRes = await cache.match('share/meta');
  if (!metaRes) return null;
  const meta = await metaRes.json().catch(() => null);
  const files = [];
  for (const f of meta?.files || []) {
    const res = await cache.match(f.key);
    if (res) files.push(new File([await res.blob()], f.name, { type: f.type }));
  }
  await caches.delete(CACHE);
  return { text: String(meta?.text || '').slice(0, 4000), files };
}

export function initShare() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared')) return;
  params.delete('shared');
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
  pending = readShared().catch(() => null);
  on('app-ready', offer);
}

async function offer() {
  const shared = await pending;
  pending = null;
  if (!shared || (!shared.text && !shared.files.length)) return;
  if (!state.cls) return toast('Rejoins une classe pour partager', 'info');
  const { text, files } = shared;
  const canImport = isDelegate() && files.length === 1 && /^(image\/|application\/pdf)/.test(files[0].type) && !/svg/i.test(files[0].type);

  const send = async (ch) => {
    emit('goto', 'chat');
    openChatChannel(ch);
    try {
      for (const f of files) {
        if (f.type === 'application/pdf') { toast(`« ${f.name} » : les PDF ne s'envoient pas dans le chat`, 'info'); continue; }
        await sendFile(f);
      }
      if (text) setTimeout(() => insertInComposer(text), 200);
    } catch (err) { toastError(err); }
  };
  modal({
    title: '📤 Partager dans Class Connect',
    body: h('div.share-box',
      files.length ? h('ul.share-files', files.map((f) => h('li', `${f.type.startsWith('image/') ? '🖼️' : f.type.startsWith('video/') ? '🎬' : f.type.startsWith('audio/') ? '🎧' : '📄'} ${f.name} · ${fmtSize(f.size)}`))) : null,
      text ? h('blockquote.share-text', text.slice(0, 300)) : null,
      h('p.muted', 'Où veux-tu l\'envoyer ?')),
    actions: [
      ...channelsFor().map((ch) => ({ label: `💬 ${CHANNELS[ch].label}`, onClick: () => { send(ch); } })),
      canImport ? { label: '📅 Importer comme emploi du temps', variant: 'btn-primary', onClick: () => { emit('goto', 'timetable'); openImport(files[0]); } } : null,
      { label: 'Annuler' },
    ].filter(Boolean),
  });
}
