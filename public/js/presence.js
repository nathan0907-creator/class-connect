// Online presence and per-channel typing indicators through Firebase Realtime Database (optional, free).
import { ref, onValue, set, remove, onDisconnect, onChildAdded, onChildChanged, serverTimestamp } from 'firebase/database';
import { rtdb } from './fb.js';
import { state, emit } from './state.js';

let offs = [];
let typingOffs = [];
let cid = null;
let typingChannel = null;
let wantedChannel = null;   // channel opened before presence was started
let lastTyping = 0;

export function startPresence(classId) {
  stopPresence();
  if (!rtdb) return;
  cid = classId;
  const mine = ref(rtdb, `presence/${cid}/${state.me.id}`);

  offs.push(onValue(ref(rtdb, '.info/connected'), async (snap) => {
    if (!snap.val()) return;
    await onDisconnect(mine).remove();
    await set(mine, true);
  }));
  offs.push(onValue(ref(rtdb, `presence/${cid}`), (snap) => {
    state.online = new Set(Object.keys(snap.val() || {}));
    emit('presence');
  }));
  // The chat opens its channel before presence starts: begin watching typing now.
  if (wantedChannel) watchTyping(wantedChannel);
}

/** Follows "X is typing…" for one chat channel only. */
export function watchTyping(channel) {
  typingOffs.forEach((off) => off());
  typingOffs = [];
  wantedChannel = channel;
  if (!rtdb || !cid) return;
  typingChannel = channel;
  const uid = state.me.id;
  const path = `typing/${cid}/${channel}`;
  onDisconnect(ref(rtdb, `${path}/${uid}`)).remove().catch(() => {});
  const typing = (snap) => { if (snap.key !== uid) emit('typing', { id: snap.key, channel }); };
  typingOffs.push(onChildAdded(ref(rtdb, path), (snap) => {
    // Ignore stale entries replayed on subscribe.
    if (Date.now() - (snap.val() || 0) < 5000) typing(snap);
  }));
  typingOffs.push(onChildChanged(ref(rtdb, path), typing));
}

export function stopPresence() {
  offs.forEach((off) => off());
  typingOffs.forEach((off) => off());
  offs = [];
  typingOffs = [];
  if (rtdb && cid && state.me) {
    remove(ref(rtdb, `presence/${cid}/${state.me.id}`)).catch(() => {});
  }
  cid = null;
  typingChannel = null;
}

export function sendTyping() {
  if (!rtdb || !cid || !typingChannel || Date.now() - lastTyping < 2500) return;
  lastTyping = Date.now();
  set(ref(rtdb, `typing/${cid}/${typingChannel}/${state.me.id}`), serverTimestamp()).catch(() => {});
}
