// Optimises the site just before it is published (GitHub Pages workflow), without touching the sources:
//  - the ~60 JavaScript modules become one minified bundle (js/app.js), plus a separate chunk for the code loaded
//    later on (3D space…), so the first visit downloads one file instead of dozens;
//  - the hidden relay page gets its own tiny bundle;
//  - the stylesheet is minified.
// Libraries (Firebase, three.js, KaTeX) stay on their CDN through the import map. Run: node scripts/optimize.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pub = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public'));
const js = path.join(pub, 'js');
const out = path.join(pub, 'js-build');
const sizeOf = (dir) => fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
const before = { files: fs.readdirSync(js).length, bytes: sizeOf(js), css: fs.statSync(path.join(pub, 'css', 'style.css')).size };

const common = {
  bundle: true, format: 'esm', minify: true, target: 'es2022', legalComments: 'none', charset: 'utf8', logLevel: 'warning',
  external: ['firebase/*', 'three', 'three/*', 'katex', 'katex/*', 'https://*'],
};
fs.rmSync(out, { recursive: true, force: true });
await build({ ...common, entryPoints: { app: path.join(js, 'main.js') }, outdir: out, splitting: true, chunkNames: 'chunk-[hash]' });
await build({ ...common, entryPoints: { relais: path.join(js, 'relais.js') }, outdir: out });

// Swap the sources for the bundles in the files about to be published.
fs.rmSync(js, { recursive: true, force: true });
fs.renameSync(out, js);
const index = path.join(pub, 'index.html');
const html = fs.readFileSync(index, 'utf8');
if (!html.includes('src="js/main.js"')) throw new Error('index.html : script js/main.js introuvable');
fs.writeFileSync(index, html.replace('src="js/main.js"', 'src="js/app.js"'));

await build({ entryPoints: [path.join(pub, 'css', 'style.css')], outfile: path.join(pub, 'css', 'style.css'), allowOverwrite: true,
  minify: true, loader: { '.css': 'css' }, logLevel: 'warning', charset: 'utf8' });

const after = { files: fs.readdirSync(js).length, bytes: sizeOf(js), css: fs.statSync(path.join(pub, 'css', 'style.css')).size };
const kb = (n) => `${Math.round(n / 1024)} Ko`;
console.log(`JavaScript : ${before.files} fichiers, ${kb(before.bytes)} → ${after.files} fichier(s), ${kb(after.bytes)}`);
console.log(`CSS : ${kb(before.css)} → ${kb(after.css)}`);
