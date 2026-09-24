// NIVEAU 3 (côté appli) — injection de code (XSS) et falsification des messages chiffrés.
// Le vrai code de l'appli est exécuté dans une page simulée (linkedom). Lancer : npm run test:client
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { window, document } = parseHTML('<!doctype html><html><head></head><body><div class="toasts"></div><div class="modal-root"></div></body></html>');
Object.assign(globalThis, {
  window, document, Node: window.Node, HTMLElement: window.HTMLElement, matchMedia: () => ({ matches: true }),
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} }, location: new URL('http://localhost:5173/'),
});
window.matchMedia = globalThis.matchMedia;

const c = await import('../public/js/crypto.js');
const { h, linkify, avatar } = await import('../public/js/ui.js');
const { renderMarkdown } = await import('../public/js/md.js');
const { state } = await import('../public/js/state.js');
const { safeMime, cleanFile, cleanPayload, safeColor, BINARY } = await import('../public/js/safe.js');

const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '<script>alert(1)</script>',
  '"><svg onload=alert(1)>',
  '<a href="javascript:alert(1)">clic</a>',
  '<iframe src="https://evil.example"></iframe>',
  '{{constructor.constructor(\'alert(1)\')()}}',
];
const dangerous = (el) => el.querySelectorAll('script, img, svg, iframe, [onerror], [onload], [onclick]').length
  + [...el.querySelectorAll('a')].filter((a) => !/^https?:\/\//.test(a.getAttribute('href') || '')).length;

describe('injection de code (XSS)', () => {
  test('un pseudo / une bio / un message piégé est affiché comme du texte, jamais exécuté', () => {
    for (const p of PAYLOADS) {
      const el = h('div', h('b', p), h('p', p));
      assert.equal(dangerous(el), 0, p);
      assert.ok(el.textContent.includes(p));
    }
  });
  test('les liens des messages : seulement http(s), jamais javascript: ni data:', () => {
    for (const p of [...PAYLOADS, 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'JaVaScRiPt:alert(1)']) {
      const el = h('div', linkify(p));
      assert.equal(dangerous(el), 0, p);
    }
    const ok = h('div', linkify('va voir https://exemple.fr/page?a=1'));
    const a = ok.querySelector('a');
    assert.equal(a.getAttribute('href'), 'https://exemple.fr/page?a=1');
    assert.match(a.getAttribute('rel'), /noopener/);
  });
  test('un lien piégé ne peut pas sortir de son attribut href', () => {
    const el = h('div', linkify('https://x.fr/"onmouseover="alert(1)'));
    assert.equal(el.querySelectorAll('[onmouseover]').length, 0);
  });
  test('les fiches de révision de l\'IA (Markdown) ne peuvent pas injecter de HTML', () => {
    for (const p of PAYLOADS) {
      const el = renderMarkdown(`# ${p}\n\n**${p}**\n\n- ${p}\n\n| ${p} | x |\n|---|---|\n| ${p} | y |\n\n\`\`\`\n${p}\n\`\`\``);
      assert.equal(dangerous(el), 0, p);
    }
    const md = renderMarkdown('[clic](javascript:alert(1))');
    assert.equal(md.querySelectorAll('a').length, 0);
  });
  test('une "photo de profil" piégée (injection CSS) est ignorée', () => {
    state.profiles = new Map([['u1', { photo: 'x"); background:url("https://evil.example/track' }]]);
    const el = avatar({ id: 'u1', display_name: 'Pirate' }, 40);
    assert.ok(!el.classList.contains('has-photo'));
    assert.ok(!String(el.getAttribute('style')).includes('evil'));
    const ok = avatar({ id: 'u2', display_name: 'Léa' }, 40, 'data:image/png;base64,iVBORw0KGgo=');
    assert.ok(ok.classList.contains('has-photo'));
  });
  test('un avatar GIF : seuls les vrais liens GIPHY passent, jamais un lien piégé', () => {
    const bad = [
      'https://evil.example/cat.gif',
      'https://media.giphy.com.evil.example/media/x/giphy.gif',
      'https://media.giphy.com/media/abc/giphy.gif"); background:url("https://evil.example',
      'https://media.giphy.com/media/abc/giphy.gif)',
      'javascript:alert(1)',
      'http://media.giphy.com/media/abc/giphy.gif',
    ];
    for (const gif of bad) {
      state.profiles = new Map([['u3', { gif }]]);
      const el = avatar({ id: 'u3', display_name: 'Pirate' }, 40);
      assert.ok(!el.classList.contains('has-photo'), gif);
    }
    state.profiles = new Map([['u4', { gif: 'https://media2.giphy.com/media/v1.Y2lk/3o7TKSjRrfIPjeiVyM/100w.gif?cid=abc&rid=100w.gif' }]]);
    assert.ok(avatar({ id: 'u4', display_name: 'Tom' }, 40).classList.contains('has-photo'));
  });
});

describe('messages piégés par un membre de la classe (contenu chiffré mais malveillant)', () => {
  const FILE = { id: 'A'.repeat(20), chunks: 2, iv: 'I'.repeat(16), mime: 'image/png', name: 'photo.png', size: 1000 };

  test('un fichier déguisé (SVG, HTML, XML…) ne s\'ouvre jamais comme une page du site', () => {
    for (const mime of ['image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml', 'application/javascript', 'IMAGE/SVG+XML', 'text/html;charset=utf-8', '', null, 42]) {
      assert.equal(safeMime(mime), BINARY, String(mime));
      assert.equal(safeMime(mime, ['image', 'doc']), BINARY, String(mime));
      assert.equal(cleanPayload({ t: 'image', file: { ...FILE, mime } }).file.mime, BINARY, String(mime));
    }
    // témoins : les vrais médias gardent leur type
    assert.equal(safeMime('image/jpeg'), 'image/jpeg');
    assert.equal(safeMime('audio/webm;codecs=opus', ['audio']), 'audio/webm');
    assert.equal(safeMime('application/pdf', ['image', 'doc']), 'application/pdf');
    assert.equal(safeMime('video/mp4', ['audio']), BINARY);
  });
  test('un descripteur de fichier truqué est refusé (chemin, nombre de morceaux géant, types)', () => {
    for (const bad of [
      { ...FILE, id: '../../users/alice' }, { ...FILE, id: 'x/dm/y'.padEnd(20, 'z') }, { ...FILE, chunks: 1e9 },
      { ...FILE, chunks: 0 }, { ...FILE, chunks: '3' }, { ...FILE, iv: { toString: null } }, null, 'fichier', [],
    ]) assert.equal(cleanFile(bad, ['image']), null, JSON.stringify(bad));
    const f = cleanFile({ ...FILE, w: 'NaN', size: -5, name: { x: 1 }, extra: '<script>' }, ['image']);
    assert.deepEqual(f, { ...FILE, w: 0, h: 0, size: 0, duration: 0, name: 'fichier' });
  });
  test('champs de mauvais type → message affichable sans planter', () => {
    for (const p of [{ t: 'text', text: { evil: true } }, { t: 'image' }, { t: 'gif', gif: { url: 'javascript:alert(1)' } },
      { t: 'gif', gif: { url: 'https://evil.example/x.gif' } }, { t: '<img>', text: 'ok' }, { reply: { id: 42 } }, { text: 7 }]) {
      const out = cleanPayload(p);
      assert.equal(typeof out.text, 'string');
      assert.ok(['text', 'gif', 'image', 'video', 'audio'].includes(out.t));
      if (out.t === 'gif') assert.match(out.gif.url, /^https:\/\/[a-z0-9]+\.giphy\.com\//);
      assert.equal(out.reply, undefined);
      assert.doesNotThrow(() => h('div', linkify(out.text)));
    }
    for (const p of [null, 'texte', 42, [], true]) assert.equal(cleanPayload(p), null);
    // __proto__ reçu en JSON ne pollue rien
    const polluted = cleanPayload(JSON.parse('{"t":"text","text":"x","__proto__":{"admin":true}}'));
    assert.equal(polluted.admin, undefined);
    assert.equal({}.admin, undefined);
  });
  test('une couleur de membre piégée ne peut pas injecter de CSS', () => {
    for (const bad of ['url(https://evil.example/pixel)', 'red;background:url(x)', 'var(--x)', '#12345', '#1234567', 42, null]) {
      assert.equal(safeColor(bad), '#7c5cff', String(bad));
      const el = avatar({ id: 'u9', display_name: 'X', color: bad }, 40);
      assert.ok(!String(el.getAttribute('style')).includes('url('), String(bad));
    }
    assert.equal(safeColor('#00d4ff'), '#00d4ff');
  });
});

describe('emploi du temps importé par l\'IA (photo / PDF)', async () => {
  const { cleanImported, weekOf, mondayOf, ymd } = await import('../public/js/timetable.js');

  test('seuls des cours valides sont gardés, aux tailles acceptées par le serveur', () => {
    const out = cleanImported([
      { day: 0, start_at: '8h30', end_at: '10:00', subject: 'Mathématiques', teacher: 'Mme Curie', room: 'B204', week: 'a' },
      { day: 7, start_at: '08:00', end_at: '09:00', subject: 'Samedi+1' },
      { day: 1, start_at: '10:00', end_at: '09:00', subject: 'À l\'envers' },
      { day: 2, start_at: '25:00', end_at: '26:00', subject: 'Heure impossible' },
      { day: 3, start_at: '09:00', end_at: '10:00', subject: '' },
      { day: '1', start_at: '09:00', end_at: '10:00', subject: 'Jour en texte' },
      { day: 4, start_at: '14:00', end_at: '15:00', subject: 'X'.repeat(80), teacher: 'Y'.repeat(80), room: 'Z'.repeat(80), week: 'C' },
      null, 'cours', 42,
    ]);
    assert.equal(out.length, 2);
    assert.deepEqual({ ...out[0], color: undefined }, { day: 0, start_at: '08:30', end_at: '10:00', subject: 'Mathématiques', teacher: 'Mme Curie', room: 'B204', week: 'A', color: undefined });
    assert.equal(out[1].subject.length, 40);
    assert.equal(out[1].teacher.length, 40);
    assert.equal(out[1].room.length, 20);
    assert.equal(out[1].week, '');
    for (const s of out) assert.match(s.color, /^#[0-9a-fA-F]{6}$/);
    assert.deepEqual(cleanImported('pas une liste'), []);
  });
  test('les noms en MAJUSCULES de Pronote sont remis au propre', () => {
    const out = cleanImported([
      { day: 0, start_at: '08:00', end_at: '09:00', subject: 'MATHEMATIQUES', teacher: 'M. DUPONT', room: 'B204' },
      { day: 0, start_at: '09:00', end_at: '10:00', subject: 'ED.PHYSIQUE & SPORT.', teacher: 'MME MARTIN', room: 'GYMNASE' },
      { day: 1, start_at: '09:00', end_at: '10:00', subject: 'ANGLAIS LV1', teacher: 'MS SMITH', room: 'C08' },
      { day: 2, start_at: '09:00', end_at: '10:00', subject: 'HISTOIRE-GEOGRAPHIE', teacher: 'M. LE GOFF', room: 'A1' },
      { day: 3, start_at: '09:00', end_at: '10:00', subject: 'Physique-chimie (gr. 1)', teacher: 'Mme de la Tour', room: 'LABO 3' },
    ]);
    assert.deepEqual(out.map((s) => [s.subject, s.teacher, s.room]), [
      ['Mathématiques', 'M. Dupont', 'B204'], ['EPS', 'Mme Martin', 'GYMNASE'], ['Anglais LV1', 'Ms Smith', 'C08'],
      ['Histoire-Géographie', 'M. Le Goff', 'A1'], ['Physique-chimie (gr. 1)', 'Mme de la Tour', 'LABO 3'],
    ]);
    assert.notEqual(out[1].color, '#00d4ff');   // l'EPS n'a pas la couleur de la physique
  });
  test('une même matière garde la même couleur', () => {
    const out = cleanImported([
      { day: 0, start_at: '08:00', end_at: '09:00', subject: 'Anglais' },
      { day: 2, start_at: '08:00', end_at: '09:00', subject: 'anglais' },
    ]);
    assert.equal(out[0].color, out[1].color);
  });
  test('semaines A / B : alternance calculée à partir de la semaine A choisie par le délégué', () => {
    state.cls = { id: 'c1', week_a: '2030-01-14' };   // un lundi
    assert.equal(weekOf(new Date(2030, 0, 16)), 'A');
    assert.equal(weekOf(new Date(2030, 0, 21)), 'B');
    assert.equal(weekOf(new Date(2030, 0, 27)), 'B');  // dimanche de la même semaine
    assert.equal(weekOf(new Date(2030, 0, 28)), 'A');
    assert.equal(weekOf(new Date(2030, 0, 7)), 'B');   // avant la référence
    assert.equal(weekOf(new Date(2030, 3, 8)), 'A');   // 12 semaines plus tard, après le changement d'heure
    state.cls = { id: 'c1' };
    assert.equal(weekOf(new Date(2030, 0, 16)), null);
    assert.equal(ymd(mondayOf(new Date(2030, 0, 19))), '2030-01-14');
  });
  test('une alerte « prof absent » truquée devient un simple texte', () => {
    assert.equal(cleanPayload({ t: 'alert', alert: { kind: 'absent', date: '2030-01-15', subject: 'Maths' } }).alert.kind, 'absent');
    assert.equal(cleanPayload({ t: 'alert', alert: { kind: '<b>', date: '2030-01-15' } }).t, 'text');
    assert.equal(cleanPayload({ t: 'alert', alert: { kind: 'room', date: 'demain' } }).t, 'text');
    assert.equal(cleanPayload({ t: 'alert', alert: { kind: 'room', date: '2030-01-15', subject: 'M'.repeat(500) } }).alert.subject.length, 40);
  });
});

describe('chiffrement de bout en bout', async () => {
  const aad = (ch, epoch, uid) => `msg|classe1|${ch}|${epoch}|${uid}`;
  const key = await c.generateClassKey();
  const msg = await c.encryptJSON(key, { v: 1, t: 'text', text: 'Rendez-vous à 14h' }, aad('mixed_messages', 1, 'alice'));

  test('le message se déchiffre avec la bonne clé', async () => {
    assert.equal((await c.decryptJSON(key, msg.iv, msg.ciphertext, aad('mixed_messages', 1, 'alice'))).text, 'Rendez-vous à 14h');
  });
  test('le texte chiffré ne contient rien de lisible', () => {
    assert.ok(!Buffer.from(msg.ciphertext, 'base64').toString('latin1').includes('Rendez-vous'));
  });
  test('un seul bit modifié par le serveur → message rejeté (intégrité)', async () => {
    const bytes = Buffer.from(msg.ciphertext, 'base64');
    bytes[5] ^= 1;
    await assert.rejects(c.decryptJSON(key, msg.iv, bytes.toString('base64'), aad('mixed_messages', 1, 'alice')));
  });
  test('attribuer le message à quelqu\'un d\'autre → rejeté', async () => {
    await assert.rejects(c.decryptJSON(key, msg.iv, msg.ciphertext, aad('mixed_messages', 1, 'bob')));
  });
  test('déplacer le message dans un autre canal (ex. salle des profs) → rejeté', async () => {
    await assert.rejects(c.decryptJSON(key, msg.iv, msg.ciphertext, aad('staff_messages', 1, 'alice')));
  });
  test('rejouer le message dans une autre classe → rejeté', async () => {
    await assert.rejects(c.decryptJSON(key, msg.iv, msg.ciphertext, 'msg|classe2|mixed_messages|1|alice'));
  });
  test('une autre clé (ex. ancien membre exclu après renouvellement) ne lit rien', async () => {
    const newKey = await c.generateClassKey();
    await assert.rejects(c.decryptJSON(newKey, msg.iv, msg.ciphertext, aad('mixed_messages', 1, 'alice')));
  });
  test('deux chiffrements du même texte sont différents (IV aléatoire)', async () => {
    const again = await c.encryptJSON(key, { v: 1, t: 'text', text: 'Rendez-vous à 14h' }, aad('mixed_messages', 1, 'alice'));
    assert.notEqual(again.ciphertext, msg.ciphertext);
    assert.notEqual(again.iv, msg.iv);
  });
});

describe('mots de passe et clés personnelles', () => {
  test('le serveur ne reçoit jamais le mot de passe, seulement une empreinte PBKDF2', async () => {
    const a = await c.deriveAuthKey('lea@mail.fr', 'MonSuperMotDePasse!');
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.ok(!a.includes('MonSuperMotDePasse'));
    assert.equal(a, await c.deriveAuthKey('LEA@mail.fr', 'MonSuperMotDePasse!'));   // stable
    assert.notEqual(a, await c.deriveAuthKey('tom@mail.fr', 'MonSuperMotDePasse!')); // salée par compte
  });
  test('la clé privée stockée sur le serveur est inutilisable sans le mot de passe', async () => {
    const id = await c.createIdentity('mot-de-passe-correct');
    const stored = { enc_salt: id.encSalt, enc_private_key: id.encPrivateKey, priv_iv: id.privIv };
    await assert.rejects(c.unlockIdentity('mauvais-mot-de-passe', stored));
    const priv = await c.unlockIdentity('mot-de-passe-correct', stored);
    assert.equal(priv.extractable, false);   // ne peut pas être exportée, même par un script
  });
  test('une clé de classe emballée pour Alice ne peut pas être déballée par Bob', async () => {
    const dele = await c.createIdentity('d'), alice = await c.createIdentity('a'), bob = await c.createIdentity('b');
    const k = await c.generateClassKey();
    const w = await c.wrapClassKey(k, dele.privateKey, alice.publicKey, { classId: 'C', epoch: 1, userId: 'alice' });
    const share = { ...w, epoch: 1, from_public_key: dele.publicKey };
    await assert.doesNotReject(c.unwrapClassKey(share, alice.privateKey, { classId: 'C', userId: 'alice' }));
    await assert.rejects(c.unwrapClassKey(share, bob.privateKey, { classId: 'C', userId: 'alice' }));
    // …ni réutilisée pour un autre compte ou une autre classe
    await assert.rejects(c.unwrapClassKey(share, alice.privateKey, { classId: 'C', userId: 'bob' }));
    await assert.rejects(c.unwrapClassKey(share, alice.privateKey, { classId: 'AUTRE', userId: 'alice' }));
  });
  test('les empreintes de sécurité de deux comptes différents sont différentes', async () => {
    const a = await c.createIdentity('x'), b = await c.createIdentity('y');
    assert.notEqual(await c.fingerprint(a.publicKey), await c.fingerprint(b.publicKey));
    assert.match(await c.fingerprint(a.publicKey), /^\d{5}( \d{5}){5}$/);
  });
});

// Firebase (importé par ui.js) garde des connexions ouvertes : on termine proprement.
after(() => setTimeout(() => process.exit(process.exitCode || 0), 100));
