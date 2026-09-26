// Encrypts the hidden story (arg/, private) into the site:
//  - public/js/arg-data.js: fragment n's clue and hook are encrypted with the key of fragment n-1, its log with its
//    own key, and its own key is wrapped once per accepted answer (PBKDF2). Nothing past the first clue is readable.
//  - public/js/relais-data.js + public/<relay page>: the hidden relay, opened with the code spelled in the video,
//    reveals the Minecraft server address.
// Run after editing arg/story.mjs or arg/config.mjs: node scripts/arg-build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto as crypto } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const enc = new TextEncoder();
const b64 = (buf) => Buffer.from(buf).toString('base64');
export const ITERATIONS = 150000;
/** Same normalisation as public/js/arg.js and relais.js. */
export const norm = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function passKey(answer, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(norm(answer)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
}
async function seal(key, value, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(value)));
  return { iv: b64(iv), ct: b64(ct) };
}
/** A fresh key, wrapped once per accepted answer (shuffled: the order says nothing). */
async function keyFor(answers, label) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const wraps = [];
  for (const a of answers) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    wraps.push({ salt: b64(salt), ...(await seal(await passKey(a, salt), b64(raw), `wrap|${label}`)) });
  }
  return { key, wraps: wraps.sort(() => Math.random() - 0.5) };
}

export async function build(chapters) {
  let prevKey = null;
  const out = [];
  for (const [i, c] of chapters.entries()) {
    const n = i + 1;
    const { key, wraps } = await keyFor(c.answers, n);
    out.push({
      n,
      // Fragment 1 is readable by anyone who finds the terminal; the rest needs the previous key.
      clue: prevKey ? await seal(prevKey, { title: c.title, clue: c.clue }, `clue|${n}`) : { title: c.title, clue: c.clue },
      hook: c.hook == null ? null : prevKey ? await seal(prevKey, c.hook, `hook|${n}`) : c.hook,
      wraps,
      log: await seal(key, c.log, `log|${n}`),
    });
    prevKey = key;
  }
  return { v: 2, iterations: ITERATIONS, chapters: out };
}

export async function buildRelay(answers, secret) {
  const { key, wraps } = await keyFor(answers, 'relais');
  return { v: 1, iterations: ITERATIONS, wraps, box: await seal(key, secret, 'relais') };
}

const RELAY_HTML = (script) => `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="">
  <script>if (location.protocol === 'http:' && !/^(localhost|127\\.|\\[::1\\])/.test(location.hostname)) location.replace('https:' + location.href.slice(5));
  /* Anti-clickjacking: never usable inside another site's frame. */ if (self !== top) { document.documentElement.style.display = 'none'; try { top.location.replace(location.href); } catch (e) {} }</script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="referrer" content="no-referrer">
  <title>relais</title>
  <style>
    :root { color-scheme: dark; }
    html, body { margin: 0; min-height: 100%; background: #010604; }
    body { display: grid; place-items: center; min-height: 100dvh; padding: 16px; box-sizing: border-box; color: #3dffa8;
      font: 15px/1.6 'Courier New', monospace; text-shadow: 0 0 6px rgba(61, 255, 168, .55);
      background-image: repeating-linear-gradient(0deg, rgba(255, 255, 255, .03) 0 1px, transparent 1px 3px); }
    main { width: min(560px, 100%); border: 1px solid #1f6b4a; border-radius: 10px; padding: 18px 20px; background: #020a06; box-shadow: 0 0 40px -8px rgba(61, 255, 168, .45); }
    pre { margin: 0 0 12px; white-space: pre-wrap; font: inherit; }
    form { display: flex; gap: 8px; border-top: 1px dashed #1f6b4a; padding-top: 12px; }
    input { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: inherit; font: inherit; caret-color: #3dffa8; text-shadow: inherit; }
    .dim { opacity: .7; }
    .addr { display: inline-block; margin: 6px 0; padding: 4px 10px; border: 1px solid #3dffa8; border-radius: 6px; user-select: all; }
  </style>
  <script type="module" src="${script}"></script>
</head>
<body>
  <main>
    <pre>RELAIS 1420 > liaison établie avec ÉCHO-7.
RELAIS 1420 > code d'accès requis.</pre>
    <div data-out></div>
    <form data-form autocomplete="off"><span>&gt;</span><input name="code" aria-label="Code d'accès" maxlength="60" spellcheck="false" autofocus></form>
  </main>
</body>
</html>
`;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { CHAPTERS } = await import(pathToFileURL(path.join(root, 'arg', 'story.mjs')).href);
  const config = await import(pathToFileURL(path.join(root, 'arg', 'config.mjs')).href);
  const data = await build(CHAPTERS);
  fs.writeFileSync(path.join(root, 'public', 'js', 'arg-data.js'), `// Generated by scripts/arg-build.mjs — do not edit.\nexport default ${JSON.stringify(data)};\n`);
  const relay = await buildRelay(CHAPTERS[3].answers, { address: config.MC_ADDRESS, version: config.MC_VERSION });
  fs.writeFileSync(path.join(root, 'public', 'js', 'relais-data.js'), `// Generated by scripts/arg-build.mjs — do not edit.\nexport default ${JSON.stringify(relay)};\n`);
  const { withCsp } = await import(pathToFileURL(path.join(root, 'scripts', 'csp.mjs')).href);
  fs.writeFileSync(path.join(root, 'public', config.RELAY_PAGE), withCsp(RELAY_HTML('js/relais.js')));
  console.log(`✔ ${data.chapters.length} fragments chiffrés → public/js/arg-data.js`);
  console.log(`✔ relais → public/${config.RELAY_PAGE} (serveur : ${config.MC_ADDRESS})`);
}
