// Content Security Policy of every page (GitHub Pages can't send headers, so it goes in a <meta> tag).
// Only scripts from this site, from the pinned library versions and from Google (Firebase, reCAPTCHA, Analytics)
// can run; inline scripts only if their exact content is listed below by hash. It also applies to files opened from
// the site (blob: pages), so a disguised image can't run code here.
// Run after editing an inline <script>: `node scripts/csp.mjs` (the site build runs it too, see cache-bust.mjs).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = [
  'https://www.gstatic.com/firebasejs/12.19.0/',
  'https://cdn.jsdelivr.net/npm/three@0.170.0/',
  'https://cdn.jsdelivr.net/npm/katex@0.18.7/',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/',
  'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/',   // App Check
  'https://apis.google.com',                                                     // Firebase Auth helper
  'https://www.googletagmanager.com',                                            // Analytics, after consent only
  'https://*.europe-west1.firebasedatabase.app',                                 // live presence (fallback transport)
];
const CONNECT = [
  'https://*.googleapis.com', 'https://*.firebaseio.com', 'wss://*.firebaseio.com',
  'https://*.firebasedatabase.app', 'wss://*.firebasedatabase.app',
  'https://api.giphy.com', 'https://www.google.com', 'https://www.gstatic.com', 'https://cdn.jsdelivr.net',
  'https://fonts.googleapis.com', 'https://fonts.gstatic.com',
  'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com',
];

const inlineScripts = (html) => [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
export const hashOf = (code) => `'sha256-${crypto.createHash('sha256').update(code, 'utf8').digest('base64')}'`;

export function policy(html) {
  return [
    "default-src 'self'",
    `script-src 'self' ${[...new Set(inlineScripts(html).map(hashOf))].join(' ')} ${SCRIPTS.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net/npm/katex@0.18.7/",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net/npm/katex@0.18.7/",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    `connect-src 'self' ${CONNECT.join(' ')}`,
    'frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/ https://class-connectv3.firebaseapp.com',
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

const META = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/;
/** The page with its CSP <meta> filled in for its current inline scripts. */
export function withCsp(html) {
  if (!META.test(html)) throw new Error('balise <meta http-equiv="Content-Security-Policy"> manquante');
  return html.replace(META, () => `<meta http-equiv="Content-Security-Policy" content="${policy(html)}">`);
}

export const PAGES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
export function updatePages(dir = PAGES_DIR) {
  const pages = fs.readdirSync(dir).filter((n) => n.endsWith('.html'));
  for (const f of pages) {
    const file = path.join(dir, f);
    fs.writeFileSync(file, withCsp(fs.readFileSync(file, 'utf8')));
  }
  return pages.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`csp: ${updatePages()} page(s) à jour`);
}
