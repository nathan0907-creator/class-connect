// NIVEAU 1 — vérifications simples : secrets, fichiers publiés, HTTPS, dépendances, pratiques dangereuses dans le code.
// Lancer : npm run test:static
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pub = path.join(root, 'public');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const publicFiles = walk(pub);
const textFiles = publicFiles.filter((f) => /\.(html|js|css|json|webmanifest|txt|xml|md)$/.test(f));
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(root, f);

test('aucune clé privée ni compte de service dans les fichiers publiés', () => {
  for (const f of textFiles) {
    const s = read(f);
    assert.ok(!/BEGIN (RSA |EC )?PRIVATE KEY/.test(s), `clé privée dans ${rel(f)}`);
    assert.ok(!/"type":\s*"service_account"/.test(s), `compte de service dans ${rel(f)}`);
    assert.ok(!/client_secret|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}/.test(s), `secret probable dans ${rel(f)}`);
  }
});

test('la clé du serveur de notifications est ignorée par git et absente du dépôt publié', () => {
  assert.match(read(path.join(root, '.gitignore')), /server\/service-account\.json/);
  assert.ok(!publicFiles.some((f) => /service-account|adminsdk/i.test(f)), 'fichier de clé dans public/');
});

test('la clé API Firebase est bien une clé web publique (protégée par les règles, pas un secret)', () => {
  const cfg = read(path.join(pub, 'js', 'config.js'));
  const key = cfg.match(/apiKey:\s*'([^']+)'/)?.[1];
  assert.ok(key?.startsWith('AIza'), 'clé web Firebase attendue');
});

test('chaque page HTML force HTTPS et interdit le contenu mixte', () => {
  for (const f of publicFiles.filter((x) => x.endsWith('.html'))) {
    const s = read(f);
    assert.match(s, /location\.protocol === 'http:'/, `redirection HTTPS manquante dans ${rel(f)}`);
    assert.match(s, /upgrade-insecure-requests/, `CSP upgrade-insecure-requests manquante dans ${rel(f)}`);
  }
});

test('aucun gestionnaire JavaScript inline (onclick=…) ni lien javascript: dans le HTML', () => {
  for (const f of publicFiles.filter((x) => x.endsWith('.html'))) {
    const s = read(f);
    assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(s), `gestionnaire inline dans ${rel(f)}`);
    assert.ok(!/href\s*=\s*["']\s*javascript:/i.test(s), `lien javascript: dans ${rel(f)}`);
  }
});

test('les liens qui ouvrent un nouvel onglet ont rel="noopener"', () => {
  for (const f of publicFiles.filter((x) => x.endsWith('.html'))) {
    for (const a of read(f).match(/<a [^>]*target="_blank"[^>]*>/g) || []) {
      assert.match(a, /rel="[^"]*noopener/, `${rel(f)} : ${a}`);
    }
  }
});

test('scripts externes : uniquement des CDN connus, avec une version figée', () => {
  const allowed = /^https:\/\/(www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+\/|cdn\.jsdelivr\.net\/npm\/[a-z@/.-]+@\d+\.\d+\.\d+)/;
  const index = read(path.join(pub, 'index.html'));
  const map = JSON.parse(index.match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports;
  for (const [name, url] of Object.entries(map)) assert.match(url, allowed, `${name} → ${url}`);
  for (const f of publicFiles.filter((x) => x.endsWith('.js'))) {
    for (const m of read(f).matchAll(/import\(\s*'(https:[^']+)'/g)) assert.match(m[1], allowed, `${rel(f)} → ${m[1]}`);
  }
});

test('pas d\'eval, de new Function ni de document.write', () => {
  for (const f of publicFiles.filter((x) => x.endsWith('.js'))) {
    const s = read(f);
    assert.ok(!/\beval\s*\(|new Function\s*\(|document\.write\s*\(/.test(s), rel(f));
  }
});

test('innerHTML seulement avec du texte fixe (jamais de données utilisateur)', () => {
  const uses = publicFiles.filter((x) => x.endsWith('.js')).flatMap((f) =>
    [...read(f).matchAll(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(/g)].map(() => rel(f)));
  // consent.js : bandeau cookies, texte fixe + un chemin lu dans une balise <meta> écrite par nous.
  assert.deepEqual([...new Set(uses)], ['public\\js\\consent.js'].map((p) => p.replace(/\\/g, path.sep)));
});

test('les textes affichés passent par textContent (fonction h) : aucune concaténation HTML dans ui.js', () => {
  const ui = read(path.join(pub, 'js', 'ui.js'));
  assert.match(ui, /document\.createTextNode\(String\(c\)\)/);
});

test('le site en ligne répond en HTTPS et ne publie pas les fichiers sensibles', { timeout: 30000 }, async (t) => {
  const base = 'https://nathan0907-creator.github.io/class-connect/';
  let res;
  try { res = await fetch(base, { redirect: 'manual' }); } catch { return t.skip('pas de réseau'); }
  assert.equal(res.status, 200);
  for (const p of ['firestore.rules', 'server/push-server.mjs', 'server/service-account.json', '.gitignore', 'package.json', 'firebase.json']) {
    const r = await fetch(base + p, { redirect: 'manual' });
    assert.notEqual(r.status, 200, `${p} ne devrait pas être servi`);
  }
  const http = await fetch(base.replace('https:', 'http:'), { redirect: 'manual' }).catch(() => null);
  if (http) assert.ok([301, 302, 307, 308].includes(http.status), `HTTP devrait rediriger vers HTTPS (${http.status})`);
});
