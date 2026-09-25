// Time helpers of the notification server: each device's own clock (quiet hours, 7 a.m. morning summary).
// Kept apart from push-server.mjs so they can be tested without Firebase (tests/server.test.mjs).

/** Date and time on the device's clock: { ymd: "2026-09-25", minutes: 0…1439, day: 0 = Monday … 6 = Sunday }. */
export function clockIn(tz, date = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
    }).formatToParts(date);
  } catch {
    if (tz === 'Europe/Paris') throw new Error('Fuseau horaire indisponible');
    return clockIn('Europe/Paris', date);
  }
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) };
}

/** True during the device's quiet hours (the range may cross midnight, e.g. 22:00 → 07:00). */
export function inQuiet(t, date = new Date()) {
  const q = t?.quiet;
  if (!q || !Number.isInteger(q.from) || !Number.isInteger(q.to) || q.from === q.to) return false;
  const m = clockIn(t.tz || 'Europe/Paris', date).minutes;
  return q.from < q.to ? m >= q.from && m < q.to : m >= q.from || m < q.to;
}

/** A or B for the week containing `ymd`, from the class's reference week-A date (null when unknown). */
export function weekLetter(refYmd, ymd) {
  if (!refYmd || !ymd) return null;
  const monday = (d) => {
    const [y, m, day] = d.split('-').map(Number);
    const t = Date.UTC(y, m - 1, day);
    return t - ((new Date(t).getUTCDay() + 6) % 7) * 864e5;
  };
  const weeks = Math.round((monday(ymd) - monday(refYmd)) / (7 * 864e5));
  return ((weeks % 2) + 2) % 2 === 0 ? 'A' : 'B';
}

const ALERT_LABEL = { absent: '🚫 Prof absent', room: '🔁 Changement de salle', cancel: '❌ Cours annulé' };

/** Text of the morning summary, or null when there is nothing (weekend, holidays). */
export function digestText({ slots, events, alerts, day, week }) {
  const today = slots.filter((s) => s.day === day && (!s.week || !week || s.week === week))
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const bySlot = new Map(slots.map((s) => [s.id, s]));
  const lines = [];
  if (today.length) lines.push(`📚 ${today.length} cours · début à ${today[0].start_at.replace(':', 'h')} (${today[0].subject})`);
  for (const a of alerts) lines.push(`${ALERT_LABEL[a.kind] || '📢 Info'} : ${bySlot.get(a.slot_id)?.subject || 'un cours'}`);
  for (const e of events) lines.push(`📅 ${e.title}`);
  return lines.length ? lines.join('\n').slice(0, 500) : null;
}
