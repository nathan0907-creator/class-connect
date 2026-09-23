// Adds a version to every local CSS/JS URL so browsers never mix an old cached file with a new one.
// Run by the GitHub Pages workflow on the files about to be published: `node scripts/cache-bust.mjs <version>`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const version = (process.argv[2] || Date.now().toString(36)).replace(/[^a-z0-9]/gi, '');
let changed = 0;

function rewrite(file, transform) {
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) { fs.writeFileSync(file, after); changed++; }
}

// HTML pages: stylesheet, entry script and inline module imports.
for (const f of fs.readdirSync(root).filter((n) => n.endsWith('.html'))) {
  rewrite(path.join(root, f), (s) => s
    .replace(/(href|src)="((?:\.\/)?(?:css|js)\/[\w.-]+\.(?:css|js))"/g, `$1="$2?v=${version}"`)
    .replace(/from '(\.\/js\/[\w.-]+\.js)'/g, `from '$1?v=${version}'`));
}

// ES modules: static and dynamic relative imports (same version everywhere, so each module loads once).
for (const f of fs.readdirSync(path.join(root, 'js')).filter((n) => n.endsWith('.js'))) {
  rewrite(path.join(root, 'js', f), (s) => s
    .replace(/(from\s+')(\.\/[\w.-]+\.js)(')/g, `$1$2?v=${version}$3`)
    .replace(/(import\(\s*')(\.\/[\w.-]+\.js)('\s*\))/g, `$1$2?v=${version}$3`));
}

console.log(`cache-bust: version ${version}, ${changed} fichier(s) modifié(s)`);
