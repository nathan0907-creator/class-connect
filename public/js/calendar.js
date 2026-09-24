// Month view of the class calendar: countdowns (tests, trips, holidays), birthdays and timetable alerts.
import { state } from './state.js';
import { h, modal } from './ui.js';
import { allEvents, KINDS, openEventForm, canEditEvents } from './events.js';
import { ALERTS, fmtDate } from './chat.js';
import { ymd, alertsOn, slotsOn } from './timetable.js';

const MONTH_FMT = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
let shown = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

/** Everything happening on one day. */
function itemsOn(date) {
  const key = ymd(date);
  const md = key.slice(5);
  const out = [];
  for (const e of allEvents()) if (e.date === key) out.push({ kind: e.kind, emoji: KINDS[e.kind]?.emoji || '📌', text: e.title });
  for (const a of alertsOn(key)) out.push({ kind: 'alert', emoji: ALERTS[a.kind].split(' ')[0], text: `${a.subject}${a.kind === 'room' && a.room ? ` → ${a.room}` : ''}` });
  for (const m of state.members.values()) {
    if (m.status === 'active' && state.profiles?.get(m.id)?.birthday === md) out.push({ kind: 'bday', emoji: '🎂', text: m.display_name });
  }
  return out;
}

export function renderCalendar() {
  const first = shown;
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));   // Monday of the first row
  const today = ymd(new Date());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (i >= 35 && d.getMonth() !== first.getMonth()) break;
    const items = itemsOn(d);
    const key = ymd(d);
    cells.push(h(`button.cal-day${d.getMonth() !== first.getMonth() ? '.out' : ''}${key === today ? '.today' : ''}${items.length ? '.busy' : ''}`, {
      type: 'button', onclick: () => openDay(d), 'aria-label': `${fmtDate(key)} : ${items.length ? items.map((x) => x.text).join(', ') : 'rien de prévu'}`,
    },
    h('span.cal-num', d.getDate()),
    h('span.cal-items', items.slice(0, 3).map((x) => h(`span.cal-item.k-${x.kind}`, `${x.emoji} ${x.text}`))),
    items.length > 3 ? h('small.cal-more', `+${items.length - 3}`) : null));
  }
  const nav = (n) => () => { shown = new Date(shown.getFullYear(), shown.getMonth() + n, 1); rerender(); };
  const root = h('div.calendar',
    h('div.cal-head',
      h('button.icon-btn', { type: 'button', 'aria-label': 'Mois précédent', onclick: nav(-1) }, '‹'),
      h('b', MONTH_FMT.format(first)),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Mois suivant', onclick: nav(1) }, '›')),
    h('div.cal-grid',
      ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((d) => h('span.cal-dow', d)),
      cells),
    h('p.hint.small', '🎂 anniversaires · 📝 contrôles · 🚌 sorties · 🏖️ vacances · 🚫 profs absents'));
  const rerender = () => root.replaceWith(renderCalendar());
  return root;
}

function openDay(date) {
  const key = ymd(date);
  const items = itemsOn(date);
  const lessons = slotsOn(date).sort((a, b) => a.start_at.localeCompare(b.start_at));
  modal({
    title: fmtDate(key).replace(/^./, (c) => c.toUpperCase()),
    body: h('div.cal-detail',
      items.length ? h('ul.cal-list', items.map((x) => h('li', `${x.emoji} ${x.text}${x.kind === 'bday' ? ' — anniversaire' : ''}`))) : h('p.muted', 'Rien de prévu ce jour-là.'),
      lessons.length ? [h('h4', 'Cours'), h('ul.cal-list', lessons.map((s) => h('li', `${s.start_at} – ${s.end_at} · ${s.subject}${s.room ? ` · ${s.room}` : ''}`)))] : null),
    actions: [
      canEditEvents() && key >= ymd(new Date()) ? { label: '＋ Compte à rebours ce jour', onClick: () => { openEventForm(key); } } : null,
      { label: 'Fermer' },
    ].filter(Boolean),
  });
}

