// Everything decrypted from another member (messages, files, profiles) is untrusted: a classmate can put anything in
// an encrypted payload. These helpers keep only the expected shapes before anything is displayed.

const MEDIA_MIME = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'],
  audio: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a'],
  // Course files may also be PDFs or plain text.
  doc: ['application/pdf', 'text/plain', 'text/markdown'],
};
// Anything else (HTML, SVG, XML…) becomes a plain download: opened as a page of the site, it could run code here.
export const BINARY = 'application/octet-stream';

const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : 0);
const FILE_ID = /^[A-Za-z0-9]{20}$/;
const CHAT_GIF = /^https:\/\/[a-z0-9]+\.giphy\.com\/[^\s"'<>\\]*$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** A MIME type safe for a blob: URL of this site, or the neutral "binary file" type. */
export function safeMime(mime, kinds = ['image', 'video', 'audio']) {
  const m = typeof mime === 'string' ? mime.toLowerCase().split(';')[0].trim() : '';
  return kinds.some((k) => MEDIA_MIME[k]?.includes(m)) ? m : BINARY;
}

/** Encrypted file descriptor (chunks in Firestore), or null if it doesn't look like one of ours. */
export function cleanFile(f, kinds) {
  if (!f || typeof f !== 'object') return null;
  if (!FILE_ID.test(f.id) || !Number.isInteger(f.chunks) || f.chunks < 1 || f.chunks > 20 || !isStr(f.iv, 64)) return null;
  return {
    id: f.id, chunks: f.chunks, iv: f.iv, mime: safeMime(f.mime, kinds),
    name: isStr(f.name, 200) && f.name ? f.name : 'fichier',
    size: num(f.size, 1e9), w: num(f.w, 1e5), h: num(f.h, 1e5), duration: num(f.duration, 3600),
  };
}

const KINDS = ['text', 'gif', 'image', 'video', 'audio', 'alert', 'poll', 'sticker'];
const STICKER = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const DATE = /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Chat message payload: only known fields, with the right types. Null if it isn't an object at all. */
export function cleanPayload(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const out = { v: 1, t: KINDS.includes(p.t) ? p.t : 'text', text: isStr(p.text, 20000) ? p.text : '' };
  if (out.t === 'poll') {
    const q = p.poll && typeof p.poll === 'object' ? p.poll : {};
    const options = Array.isArray(q.options) ? q.options.filter((o) => isStr(o, 100) && o.trim()).slice(0, 6) : [];
    if (isStr(q.q, 200) && q.q.trim() && options.length >= 2) out.poll = { q: q.q, options, wyr: q.wyr === true };
    else out.t = 'text';
  } else if (out.t === 'sticker') {
    if (isStr(p.img, 60000) && STICKER.test(p.img)) out.img = p.img;
    else out.t = 'text';
  } else if (out.t === 'alert') {
    // "Prof absent / salle changée / cours annulé" posted in the announcements channel.
    const a = p.alert && typeof p.alert === 'object' ? p.alert : {};
    if (['absent', 'room', 'cancel'].includes(a.kind) && DATE.test(a.date)) {
      out.alert = { kind: a.kind, date: a.date, subject: str(a.subject, 40), room: str(a.room, 20), note: str(a.note, 300) };
    } else out.t = 'text';
  } else if (out.t === 'gif') {
    const g = p.gif;
    if (g && typeof g === 'object' && isStr(g.url, 2000) && CHAT_GIF.test(g.url)) {
      out.gif = { url: g.url, title: isStr(g.title, 200) && g.title ? g.title : 'GIF', w: num(g.w, 1e5), h: num(g.h, 1e5) };
    } else out.t = 'text';
  } else if (out.t !== 'text') {
    out.file = cleanFile(p.file, [out.t]);
    if (!out.file) out.t = 'text';
  }
  const r = p.reply;
  if (r && typeof r === 'object' && isStr(r.id, 64) && r.id) {
    out.reply = { id: r.id, user_id: isStr(r.user_id, 128) ? r.user_id : '', text: isStr(r.text, 400) ? r.text : '' };
  }
  // Forwarded from another member; photo / video hidden behind a blur until tapped.
  if (p.fwd && typeof p.fwd === 'object' && isStr(p.fwd.user_id, 128)) out.fwd = { user_id: p.fwd.user_id };
  if (p.blur === true && (out.t === 'image' || out.t === 'video')) out.blur = true;
  return out;
}

/** Member colour: only "#rrggbb" (anything else could inject CSS, e.g. load an outside image). */
export const safeColor = (c, fallback = '#7c5cff') => (typeof c === 'string' && COLOR.test(c) ? c : fallback);
