import { onSnapshot, query, orderBy, limit, doc, getDoc, deleteDoc, writeBatch, increment, serverTimestamp } from 'firebase/firestore';
import { db, sub, plain } from './fb.js';
import { state, on, isDelegate, memberName } from './state.js';
import { slots, openSlotForm } from './timetable.js';
import { $, $$, h, icon, avatar, toast, toastError, confirmDialog, fmtRemaining, fmtDay, DAYS, enableTilt } from './ui.js';

let proposals = [];
const myVotes = new Map(); // proposal id -> -1 | 0 | 1
let filter = 'open';
let unsub = null;

const ACTIONS = { poll: ['Question', 'vote'], add: ['Ajout de cours', 'plus'], modify: ['Modification', 'edit'], delete: ['Suppression', 'trash'] };
const FIELD = { 1: 'yes', '-1': 'no', 0: 'abstain' };
const isLive = (p) => p.status === 'open' && p.deadline > Date.now();
const proposalRef = (id) => sub(state.cls.id, 'proposals', id);

export function initVotes() {
  $('#panel-votes [data-action="new-proposal"]').addEventListener('click', () => {
    if (isDelegate()) openSlotForm({ mode: 'propose', action: 'poll' });
  });
  $$('#panel-votes [data-filter]').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    $$('#panel-votes [data-filter]').forEach((x) => x.classList.toggle('active', x === b));
    render();
  }));
  on('slots:loaded', render);
  on('members', render);
  setInterval(render, 30_000);
}

export function startProposals() {
  stopProposals();
  myVotes.clear();
  unsub = onSnapshot(query(sub(state.cls.id, 'proposals'), orderBy('created_at', 'desc'), limit(100)), async (snap) => {
    proposals = snap.docs.map(plain);
    // Secret ballot: we can only read our own vote, one document per proposal.
    const unknown = proposals.filter((p) => p.status === 'open' && !myVotes.has(p.id));
    await Promise.all(unknown.map(async (p) => {
      const v = await getDoc(doc(proposalRef(p.id), 'votes', state.me.id)).catch(() => null);
      myVotes.set(p.id, v?.exists() ? v.get('value') : undefined);
    }));
    render();
  }, toastError);
}
export function stopProposals() { unsub?.(); unsub = null; }

function render() {
  const root = $('#panel-votes .proposals');
  if (!root || !state.me) return;
  const shown = proposals.filter((p) => (filter === 'open' ? p.status === 'open' : p.status !== 'open'));
  shown.sort((a, b) => (filter === 'open' ? a.deadline - b.deadline : b.created_at - a.created_at));
  root.replaceChildren(...shown.map(card));
  if (!shown.length) {
    root.append(h('div.empty', icon('vote'), h('p', filter === 'open'
      ? (isDelegate() ? 'Aucun vote en cours. Lance-en un avec « Nouveau vote » !' : 'Aucun vote en cours. Les délégués lanceront les prochains.')
      : 'Aucun vote terminé pour l\'instant.')));
  }
  enableTilt(root);

  const pending = proposals.filter((p) => isLive(p) && myVotes.get(p.id) === undefined).length
    + (isDelegate() ? proposals.filter((p) => p.status === 'open' && !isLive(p)).length : 0);
  $('[data-badge="votes"]').textContent = pending || '';
}

function miniSlot(s, cls = '') {
  if (!s) return h('div.mini-slot.gone', 'Cours supprimé entre-temps');
  return h(`div.mini-slot${cls}`, { style: { '--c': s.color || '#7c5cff' } },
    h('b', s.subject),
    h('small', `${DAYS[s.day]} · ${s.start_at}–${s.end_at}`),
    s.room || s.teacher ? h('small', [s.room, s.teacher].filter(Boolean).join(' · ')) : null);
}

function card(p) {
  const live = isLive(p);
  const voters = [...state.members.values()].filter((m) => m.status === 'active' && m.role !== 'teacher').length || 1;
  const total = p.yes + p.no + p.abstain;
  const pct = (n) => Math.min(100, (n / voters) * 100);
  const mine = myVotes.get(p.id);
  const slot = slots.find((s) => s.id === p.slot_id);
  const [actionLabel, actionIcon] = ACTIONS[p.action];
  const author = state.members.get(p.author_id);

  let change = null;
  if (p.action === 'poll') change = null;
  else if (p.action === 'add') change = h('div.change', h('span.change-tag', '+'), miniSlot(p.data, '.new'));
  else if (p.action === 'modify') change = h('div.change', miniSlot(slot, '.old'), h('span.arrow', '→'), miniSlot(p.data, '.new'));
  else change = h('div.change', miniSlot(slot, '.strike'));

  const voteBtn = (value, label, cls) => h(`button.vote-btn.${cls}${mine === value ? '.active' : ''}`, {
    disabled: !live,
    onclick: (e) => { e.currentTarget.classList.add('boom'); castVote(p, value); },
  }, label);

  const statusEl = p.status === 'accepted' ? h('div.stamp.ok', 'Adoptée')
    : p.status === 'rejected' ? h('div.stamp.ko', 'Rejetée')
    : live ? h('span.countdown', icon('clock'), ` ${fmtRemaining(p.deadline - Date.now())}`)
    : h('span.countdown.ended', 'Vote clos · en attente du délégué');

  const leading = p.yes > p.no ? 'yes' : p.no > p.yes ? 'no' : 'tie';

  return h(`article.proposal.card.tilt.status-${p.status}${live ? '.live' : ''}`, { dataset: { id: p.id } },
    h('header.proposal-head',
      h(`span.action-badge.a-${p.action}`, icon(actionIcon), ' ', actionLabel),
      statusEl),
    h('h3', p.title),
    h('div.proposal-author', avatar(author, 22), h('span', `${memberName(p.author_id)} · ${fmtDay(p.created_at).toLowerCase()}`)),
    change,
    p.reason ? h('blockquote', p.reason) : null,
    h('div.results',
      h('div.bar',
        h('i.yes', { style: { width: pct(p.yes) + '%' } }),
        h('i.no', { style: { width: pct(p.no) + '%' } }),
        h('i.abs', { style: { width: pct(p.abstain) + '%' } })),
      h('div.legend',
        h('span.l-yes', `${p.yes} pour`), h('span.l-no', `${p.no} contre`), h('span.l-abs', `${p.abstain} abst.`),
        h('span.participation', `participation ${total}/${voters}`))),
    p.status === 'open' ? h('div.vote-row',
      voteBtn(1, '✓ Pour', 'v-yes'), voteBtn(-1, '✗ Contre', 'v-no'), voteBtn(0, 'Abstention', 'v-abs')) : null,
    h('div.proposal-foot',
      isDelegate() && p.status === 'open' ? [
        h('span.delegate-hint', icon('star'), leading === 'yes' ? ' La majorité est pour' : leading === 'no' ? ' La majorité est contre' : ' Égalité'),
        h('button.btn.btn-sm.btn-ghost', { onclick: () => decide(p, false) }, 'Refuser'),
        h('button.btn.btn-sm.btn-primary', { onclick: () => decide(p, true) }, h('span', 'Adopter & appliquer')),
      ] : null,
      isDelegate()
        ? h('button.icon-btn', { title: 'Supprimer la proposition', onclick: () => remove(p) }, icon('trash')) : null));
}

async function castVote(p, value) {
  const old = myVotes.get(p.id);
  if (old === value) return;
  try {
    // The vote and the public tally change together; the security rules check they match.
    const batch = writeBatch(db);
    batch.set(doc(proposalRef(p.id), 'votes', state.me.id), { value });
    const counts = { [FIELD[value]]: increment(1) };
    if (old !== undefined) counts[FIELD[old]] = increment(-1);
    batch.update(proposalRef(p.id), counts);
    await batch.commit();
    myVotes.set(p.id, value);
    render();
  } catch (err) {
    myVotes.delete(p.id);
    toastError(err);
  }
}

async function decide(p, accept) {
  const text = accept
    ? (p.action === 'poll'
      ? `« ${p.title} » sera marqué comme adopté (${p.yes} pour, ${p.no} contre).`
      : `« ${p.title} » sera appliqué immédiatement à l'emploi du temps (${p.yes} pour, ${p.no} contre).`)
    : `« ${p.title} » sera marqué comme rejeté.`;
  if (!(await confirmDialog(accept ? 'Adopter la proposition ?' : 'Rejeter la proposition ?', text, { danger: !accept, label: accept ? 'Adopter' : 'Rejeter' }))) return;
  try {
    const batch = writeBatch(db);
    if (accept && p.action !== 'poll') {
      const slotsCol = sub(state.cls.id, 'slots');
      if (p.action === 'add') batch.set(doc(slotsCol), p.data);
      else {
        if (!p.slot_id || !slots.some((s) => s.id === p.slot_id)) throw new Error('Le cours concerné n\'existe plus');
        if (p.action === 'modify') batch.set(doc(slotsCol, p.slot_id), p.data);
        else batch.delete(doc(slotsCol, p.slot_id));
      }
    }
    batch.update(proposalRef(p.id), { status: accept ? 'accepted' : 'rejected', closed_at: serverTimestamp() });
    await batch.commit();
    toast(accept ? (p.action === 'poll' ? 'Vote adopté ✨' : 'Adopté, emploi du temps mis à jour ✨') : 'Proposition rejetée', accept ? 'success' : 'info');
  } catch (err) { toastError(err); }
}

async function remove(p) {
  if (!(await confirmDialog('Supprimer la proposition ?', p.title))) return;
  try { await deleteDoc(proposalRef(p.id)); } catch (err) { toastError(err); }
}
