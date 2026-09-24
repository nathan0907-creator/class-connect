// Adds a version to every local CSS/JS URL so browsers never mix an old cached file with a new one.
// Run by the GitHub Pages workflow on the files about to be published: `node scripts/cache-bust.mjs <version>`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCsp } from './csp.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const version = (process.argv[2] || Date.now().toString(36)).replace(/[^a-z0-9]/gi, '');
let changed = 0;

function rewrite(file, transform) {
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) { fs.writeFileSync(file, after); changed++; }
}

// HTML pages: stylesheet, entry script and inline module imports, then the CSP hashes of the changed inline scripts.
for (const f of fs.readdirSync(root).filter((n) => n.endsWith('.html'))) {
  rewrite(path.join(root, f), (s) => withCsp(s
    .replace(/(href|src)="((?:\.\/)?(?:css|js)\/[\w.-]+\.(?:css|js))"/g, `$1="$2?v=${version}"`)
    .replace(/from '(\.\/js\/[\w.-]+\.js)'/g, `from '$1?v=${version}'`)));
}

// ES modules: static and dynamic relative imports (same version everywhere, so each module loads once).
for (const f of fs.readdirSync(path.join(root, 'js')).filter((n) => n.endsWith('.js'))) {
  rewrite(path.join(root, 'js', f), (s) => s
    .replace(/(from\s+')(\.\/[\w.-]+\.js)(')/g, `$1$2?v=${version}$3`)
    .replace(/(import\(\s*')(\.\/[\w.-]+\.js)('\s*\))/g, `$1$2?v=${version}$3`));
}

// Service worker: new version (so browsers update it) + the files to keep for offline use.
const swFile = path.join(root, 'sw.js');
if (fs.existsSync(swFile)) {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const cdn = [...new Set([...index.matchAll(/"(https:\/\/(?:www\.gstatic\.com|cdn\.jsdelivr\.net)\/[^"]+)"/g)].map((m) => m[1]))]
    .filter((u) => !u.endsWith('/'));
  const local = [
    './', 'index.html', 'cgu.html', 'confidentialite.html', 'site.webmanifest', 'favicon.ico',
    `css/style.css?v=${version}`,
    ...fs.readdirSync(path.join(root, 'js')).filter((n) => n.endsWith('.js')).map((n) => `js/${n}?v=${version}`),
    ...fs.readdirSync(path.join(root, 'img')).map((n) => `img/${n}`),
  ];
  rewrite(swFile, (s) => s
    .replace("const VERSION = 'dev';", `const VERSION = '${version}';`)
    .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify([...local, ...cdn])};`));
}

console.log(`cache-bust: version ${version}, ${changed} fichier(s) modifié(s)`);
