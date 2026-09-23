// Checks every local href/src in the HTML pages and every file referenced by the manifest: `npm run check`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
let broken = 0;
let checked = 0;

function check(from, ref) {
  if (!ref || /^(https?:|mailto:|tel:|data:|blob:|#|javascript:)/.test(ref) || ref.includes('SITE_URL') || ref.includes('REPO_URL')) return;
  const clean = ref.split(/[?#]/)[0];
  if (!clean) return;
  const target = clean.startsWith('/') ? path.join(root, clean) : path.join(root, path.dirname(from), clean);
  checked++;
  const exists = fs.existsSync(target) && (fs.statSync(target).isFile() || fs.existsSync(path.join(target, 'index.html')));
  if (!exists) { broken++; console.log(`✗ ${from} → ${ref}`); }
}

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8').replace(/<base href="[^"]*">/, '');
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) check(page, m[1]);
  for (const m of html.matchAll(/from '(\.\/[^']+)'/g)) check(page, m[1]);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'site.webmanifest'), 'utf8'));
for (const icon of manifest.icons) check('site.webmanifest', icon.src);
for (const f of fs.readdirSync(path.join(root, 'js'))) {
  const js = fs.readFileSync(path.join(root, 'js', f), 'utf8');
  for (const m of js.matchAll(/from '(\.\/[^']+)'|import\('(\.\/[^']+)'\)/g)) check(`js/${f}`, m[1] || m[2]);
}
console.log(`\n${checked} liens vérifiés, ${broken} cassé(s).`);
process.exit(broken ? 1 : 0);
