// NIVEAU 3 (côté appli) — injection de code (XSS) et falsification des messages chiffrés.
// Le vrai code de l'appli est exécuté dans une page simulée (linkedom). Lancer : npm run test:client
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { window, document } = parseHTML('<!doctype html><html><head></head><body><div class="toasts"></div><div class="modal-root"></div></body></html>');
Object.assign(globalThis, { window, document, Node: window.Node, HTMLElement: window.HTMLElement, matchMedia: () => ({ matches: true }), location: new URL('http://localhost:5173/') });
window.matchMedia = globalThis.matchMedia;

const c = await import('../public/js/crypto.js');
const { h, linkify, avatar } = await import('../public/js/ui.js');
const { renderMarkdown } = await import('../public/js/md.js');
const { state } = await import('../public/js/state.js');

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
