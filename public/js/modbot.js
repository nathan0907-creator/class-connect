// 🤖 Modération automatique. Messages are end-to-end encrypted, so no server can read them: the bot runs on each
// device. It blocks vulgar / sexual / hateful words when sending (even disguised: « pu7e », « p.u.t.e », « puuute »,
// « s4l0pe »…), masks them when displaying, and checks photos for nudity before they are sent (AI model running in
// the browser, downloaded only the first time a photo is sent).

// Entries are compared after normalisation (lowercase, no accents, digits → letters, repeated letters squashed).
// « mot* » = any word starting with it (conjugations, plurals). Whole words only, so « computer » never matches « pute ».
const WORDS = [
  // insults
  'pute*', 'putain*', 'salope*', 'salaud*', 'connard*', 'conasse*', 'connasse*', 'encul*', 'batard*', 'fdp', 'ntm',
  'tg', 'ftg', 'nique*', 'niquer*', 'emmerd*', 'merde*', 'chier', 'chiant*', 'debile*', 'abruti*', 'cretin*', 'grognasse*',
  'pouffiasse*', 'trouduc*', 'fils de pute', 'ta gueule', 'ferme ta gueule', 'va te faire', 'nique ta mere',
  // sexual / nudity
  'bite', 'bites', 'teub*', 'couille*', 'chatte*', 'nichon*', 'zgeg*', 'branle*', 'branlette*',
  'suce', 'suceuse*', 'sucer des', 'porno*', 'porn*', 'nude*', 'nudes', 'a poil', 'sexto*', 'sextape*', 'cul nu', 'seins nus',
  'fellation*', 'sodomi*', 'orgasm*', 'masturb*', 'ejacul*', 'hentai*', 'onlyfans',
  // hate / slurs
  'pd', 'pede', 'pedes', 'tapette*', 'gouine*', 'tarlouze*', 'negre*', 'negro*', 'bougnoul*', 'bicot*', 'youpin*',
  // english
  'fuck*', 'fck*', 'fuk*', 'shit', 'shits', 'shitty', 'bullshit', 'bitch*', 'dick*', 'pussy*', 'cunt*', 'whore*', 'slut*', 'nigga*', 'nigger*', 'faggot*', 'motherfuck*', 'wtf',
];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '€': 'e', '!': 'i', '|': 'i', '+': 't', '¥': 'y', '£': 'l' };
const squash = (s) => s.replace(/(.)\1+/g, '$1');

/** Text as the bot reads it: two readings, because « 1 » can stand for « i » or « l ». */
function readings(text) {
  const base = String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[​-‏⁠﻿]/g, '');
  return [LEET, { ...LEET, 1: 'l', '|': 'l' }].map((map) => {
    // Dots, stars, dashes… inside a word are dropped (« en.cu.lé », « f*ck »), other punctuation separates words.
    let s = [...base.replace(/(?<=\S)[.*_\-·•~^]+(?=\S)/g, '')].map((c) => map[c] ?? c).join('').replace(/[^a-z]+/g, ' ');
    // Letters spelled one by one (« p u t e », « p.u.t.e ») are glued back together.
    s = s.replace(/\b(?:[a-z] ){2,}[a-z]\b/g, (m) => m.replace(/ /g, ''));
    return ` ${squash(s).trim()} `;
  });
}

const PATTERNS = WORDS.map((w) => {
  const prefix = w.endsWith('*');
  const core = squash(w.replace(/\*$/, ''));
  return { word: w.replace(/\*$/, ''), re: new RegExp(` ${core.replace(/ /g, ' ')}${prefix ? '[a-z]*' : ''}(?= )`) };
});

/** The first forbidden word found (as written in the list), or ''. */
export function badWord(text) {
  if (!text) return '';
  for (const r of readings(text)) for (const p of PATTERNS) if (p.re.test(r)) return p.word;
  return '';
}

/** The text with every vulgar word replaced by ★★★ (words are tested one by one, so the rest stays readable). */
export function maskBad(text) {
  if (!text || !badWord(text)) return text;
  const masked = text.replace(/[^\s]+/g, (w) => (badWord(w) ? '★'.repeat(Math.min(6, Math.max(3, w.length))) : w));
  // Disguised across several words (« p u t e », « ta gueule ») : the whole message is hidden.
  return badWord(masked) ? '🤖 Message masqué par la modération automatique' : masked;
}

// ------------------------------------------------------------ nudity in photos (nsfwjs, MobileNetV2, runs locally)
// The model (weights) and the library, pinned and integrity-checked: a modified file would simply not run.
const NSFW = 'https://cdn.jsdelivr.net/npm/nsfwjs@4.2.1/dist/';
const NSFW_FILES = [
  ['models/mobilenet_v2/model.min.js', 'sha384-SDNCNeYT2W5Zmp1ErBnoIg1ZPnnU10prWvyrBBQ2UurkZNvKLHLPJfszwz9SHgr2'],
  ['models/mobilenet_v2/group1-shard1of1.min.js', 'sha384-wD1nPXVWFMmz83BpZ7oJs+RbcZu7B7IdM4sltSMKGXZWqopN+y62ohchPC2Logj8'],
  ['browser/nsfwjs.min.js', 'sha384-X0bAq0XJRwVKAYLtjgRmKfk0w1/l9A1KDqj5PkR5UUk60UzcUv05usH2uyL5oaJq'],
];
let modelPromise = null;

const script = ([file, integrity]) => new Promise((resolve, reject) => {
  const s = Object.assign(document.createElement('script'), { src: NSFW + file, crossOrigin: 'anonymous', integrity });
  s.onload = resolve;
  s.onerror = () => reject(new Error('Le contrôle des photos n\'a pas pu se charger'));
  document.head.append(s);
});

function loadModel() {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    if (!window.nsfwjs) for (const f of NSFW_FILES) await script(f);
    return window.nsfwjs.load('MobileNetV2');
  })().catch((err) => { modelPromise = null; throw err; });
  return modelPromise;
}

/**
 * Checks what a <video> shows right now (calls): true when it looks explicit. Never throws: false when it can't tell.
 * Used on the picture RECEIVED in a video call, so a modified app on the other side can't get around it.
 */
export async function explicitFrame(video) {
  try {
    if (!video || video.readyState < 2 || !video.videoWidth) return false;
    const model = await loadModel();
    const scores = Object.fromEntries((await model.classify(video)).map((p) => [p.className, p.probability]));
    return (scores.Porn || 0) + (scores.Hentai || 0) > 0.55 || (scores.Sexy || 0) > 0.85;
  } catch { return false; }
}

/**
 * Checks a photo before it is sent. Resolves { ok: true } or { ok: false, reason }.
 * Pornographic or « sexy » content above the thresholds is refused. If the check itself can't run (no network for
 * the model…), the photo is refused too, rather than letting it through unchecked.
 */
export async function checkImage(file) {
  if (!file?.type?.startsWith('image/')) return { ok: true };
  const url = URL.createObjectURL(file);
  try {
    const model = await loadModel();
    const img = new Image();
    img.src = url;
    await img.decode();
    const scores = Object.fromEntries((await model.classify(img)).map((p) => [p.className, p.probability]));
    const explicit = (scores.Porn || 0) + (scores.Hentai || 0);
    if (explicit > 0.5) return { ok: false, reason: 'contenu à caractère sexuel' };
    if ((scores.Sexy || 0) > 0.8) return { ok: false, reason: 'photo trop dénudée' };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'contrôle impossible' };
  } finally {
    URL.revokeObjectURL(url);
  }
}
