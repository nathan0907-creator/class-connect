// Notification server helpers: device clock, quiet hours, A/B weeks and the morning summary.
// Run: node --test tests/server.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockIn, inQuiet, weekLetter, digestText } from '../server/clock.mjs';

test('horloge de l\'appareil selon son fuseau', () => {
  const d = new Date('2026-09-25T05:30:00Z');   // vendredi, 7 h 30 à Paris (heure d'été)
  assert.deepEqual(clockIn('Europe/Paris', d), { ymd: '2026-09-25', minutes: 450, day: 4 });
  assert.equal(clockIn('America/Martinique', d).ymd, '2026-09-25');
  assert.equal(clockIn('America/Martinique', d).minutes, 90);
  assert.equal(clockIn('Pas/UnFuseau', d).minutes, 450);   // fuseau inconnu → Paris
});

test('heures calmes, y compris à cheval sur minuit', () => {
  const at = (h, m = 0) => new Date(Date.UTC(2026, 0, 15, h - 1, m));   // heure de Paris en hiver (UTC+1)
  const night = { quiet: { from: 22 * 60, to: 7 * 60 }, tz: 'Europe/Paris' };
  assert.equal(inQuiet(night, at(23)), true);
  assert.equal(inQuiet(night, at(3)), true);
  assert.equal(inQuiet(night, at(7)), false);
  assert.equal(inQuiet(night, at(12)), false);
  const lesson = { quiet: { from: 8 * 60, to: 12 * 60 }, tz: 'Europe/Paris' };
  assert.equal(inQuiet(lesson, at(9, 30)), true);
  assert.equal(inQuiet(lesson, at(12)), false);
  assert.equal(inQuiet({ quiet: null, tz: 'Europe/Paris' }, at(3)), false);
});

test('semaines A et B', () => {
  assert.equal(weekLetter('2026-09-07', '2026-09-07'), 'A');
  assert.equal(weekLetter('2026-09-07', '2026-09-11'), 'A');   // même semaine
  assert.equal(weekLetter('2026-09-07', '2026-09-14'), 'B');
  assert.equal(weekLetter('2026-09-09', '2026-09-21'), 'A');   // référence en milieu de semaine
  assert.equal(weekLetter('2026-09-07', '2026-08-31'), 'B');   // avant la référence
  assert.equal(weekLetter(null, '2026-09-07'), null);
});

test('résumé du matin', () => {
  const slots = [
    { id: 's1', day: 4, start_at: '10:00', subject: 'SVT' },
    { id: 's2', day: 4, start_at: '08:00', subject: 'Maths' },
    { id: 's3', day: 4, start_at: '14:00', subject: 'Anglais', week: 'B' },
    { id: 's4', day: 0, start_at: '08:00', subject: 'Histoire' },
  ];
  const text = digestText({ slots, events: [{ title: 'Contrôle de SVT' }], alerts: [{ kind: 'absent', slot_id: 's1' }], day: 4, week: 'A' });
  assert.equal(text, '📚 2 cours · début à 08h00 (Maths)\n🚫 Prof absent : SVT\n📅 Contrôle de SVT');
  assert.match(digestText({ slots, events: [], alerts: [], day: 4, week: 'B' }), /^📚 3 cours/);
  assert.equal(digestText({ slots, events: [], alerts: [], day: 5, week: 'A' }), null);   // samedi : rien
});
