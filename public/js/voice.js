// Voice messages: recorded in the browser, then encrypted and uploaded like photos (see chat.js / media.js).
import { state } from './state.js';
import { downloadDecrypted } from './media.js';
import { safeMime } from './safe.js';
import { h, icon, toast } from './ui.js';

const MAX_SECONDS = 180;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pickMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  .find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';

export const voiceSupported = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

/**
 * Records a voice message over the composer. `send(blob, seconds)` uploads it.
 * Tap the mic to start, then "send" or the bin to cancel.
 */
export async function recordVoice(composer, send) {
  if (!voiceSupported()) return toast('Ton navigateur ne permet pas d\'enregistrer de message vocal', 'error');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    return toast('Micro refusé : autorise-le dans les réglages du navigateur (icône 🔒 de la barre d\'adresse)', 'error', 7000);
  }
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
  const parts = [];
  let cancelled = false;
  const started = Date.now();
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };

  // Live level meter + timer
  const timer = h('span.rec-time', '0:00');
  const bars = Array.from({ length: 24 }, () => h('i'));
  const meter = h('div.rec-meter', bars);
  let raf = 0;
  let ctx;
  try {
    ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      bars.forEach((b, i) => { b.style.transform = `scaleY(${0.15 + (data[i % data.length] / 255) * 0.85})`; });
      const s = (Date.now() - started) / 1000;
      timer.textContent = fmt(s);
      if (s >= MAX_SECONDS) stop(false);
      raf = requestAnimationFrame(tick);
    };
    tick();
  } catch { /* meter is optional */ }

  const panel = h('div.voice-rec', { role: 'status', 'aria-live': 'polite' },
    h('button.icon-btn.rec-cancel', { type: 'button', title: 'Annuler', 'aria-label': 'Annuler l\'enregistrement', onclick: () => stop(true) }, icon('trash')),
    h('span.rec-dot'), timer, meter,
    h('button.send-btn', { type: 'button', title: 'Envoyer', 'aria-label': 'Envoyer le message vocal', onclick: () => stop(false) }, icon('send')));
  composer.classList.add('recording');
  composer.append(panel);

  function stop(cancel) {
    if (rec.state === 'inactive') return;
    cancelled = cancel;
    rec.stop();
  }
  rec.onstop = () => {
    cancelAnimationFrame(raf);
    ctx?.close().catch(() => {});
    stream.getTracks().forEach((t) => t.stop());
    panel.remove();
    composer.classList.remove('recording');
    const seconds = Math.round((Date.now() - started) / 1000);
    if (cancelled) return;
    if (seconds < 1) return toast('Message trop court');
    const blob = new Blob(parts, { type: rec.mimeType || mime || 'audio/webm' });
    send(blob, seconds);
  };
  rec.start(250);
  navigator.vibrate?.(15);
}

/** Compact player: the audio is downloaded and decrypted only when played. */
export function voicePlayer(file, epoch) {
  let audio = null;
  const btn = h('button.voice-play', { type: 'button', 'aria-label': 'Écouter le message vocal' }, h('span.play-ico'));
  const fill = h('i');
  const track = h('div.voice-track', fill);
  const time = h('span.voice-time', fmt(file.duration || 0));
  const box = h('div.voice-msg', btn, track, time, h('span.voice-mic', '🎤'));

  async function load() {
    box.classList.add('loading');
    try {
      const bytes = await downloadDecrypted(file, state.classKeys.get(epoch));
      audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: safeMime(file.mime, ['audio']) })));
      audio.addEventListener('timeupdate', () => {
        const d = audio.duration && Number.isFinite(audio.duration) ? audio.duration : file.duration || 1;
        fill.style.width = `${Math.min(100, (audio.currentTime / d) * 100)}%`;
        time.textContent = fmt(audio.currentTime);
      });
      audio.addEventListener('ended', () => { box.classList.remove('playing'); fill.style.width = '0%'; time.textContent = fmt(file.duration || 0); });
      audio.addEventListener('pause', () => box.classList.remove('playing'));
      audio.addEventListener('play', () => {
        // Only one voice message plays at a time.
        document.querySelectorAll('.voice-msg.playing').forEach((b) => { if (b !== box) b._pause?.(); });
        box.classList.add('playing');
      });
    } finally { box.classList.remove('loading'); }
  }
  box._pause = () => audio?.pause();
  btn.addEventListener('click', async () => {
    try {
      if (!audio) await load();
      if (audio.paused) await audio.play(); else audio.pause();
    } catch (err) { console.warn(err); toast('Message vocal illisible', 'error'); }
  });
  track.addEventListener('click', (e) => {
    if (!audio?.duration || !Number.isFinite(audio.duration)) return;
    const r = track.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
  return box;
}
