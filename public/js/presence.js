// Online presence and typing indicators through Firebase Realtime Database (optional, free).
import { ref, onValue, set, remove, onDisconnect, onChildAdded, onChildChanged, serverTimestamp } from 'firebase/database';
import { rtdb } from './fb.js';
import { state, emit } from './state.js';

let offs = [];
let cid = null;
let lastTyping = 0;

export function startPresence(classId) {
  stopPresence();
  if (!rtdb) return;
  cid = classId;
  const uid = state.me.id;
  const mine = ref(rtdb, `presence/${cid}/${uid}`);
  const typingMine = ref(rtdb, `typing/${cid}/${uid}`);

  offs.push(onValue(ref(rtdb, '.info/connected'), async (snap) => {
    if (!snap.val()) return;
    await onDisconnect(mine).remove();
    await onDisconnect(typingMine).remove();
    await set(mine, true);
  }));
  offs.push(onValue(ref(rtdb, `presence/${cid}`), (snap) => {
    state.online = new Set(Object.keys(snap.val() || {}));
    emit('presence');
  }));
  const typing = (snap) => { if (snap.key !== uid) emit('typing', { id: snap.key }); };
  offs.push(onChildAdded(ref(rtdb, `typing/${cid}`), (snap) => {
    // Ignore stale entries replayed on subscribe.
    if (Date.now() - (snap.val() || 0) < 5000) typing(snap);
  }));
  offs.push(onChildChanged(ref(rtdb, `typing/${cid}`), typing));
}

export function stopPresence() {
  offs.forEach((off) => off());
  offs = [];
  if (rtdb && cid && state.me) {
    remove(ref(rtdb, `presence/${cid}/${state.me.id}`)).catch(() => {});
  }
  cid = null;
}

export function sendTyping() {
  if (!rtdb || !cid || Date.now() - lastTyping < 2500) return;
  lastTyping = Date.now();
  set(ref(rtdb, `typing/${cid}/${state.me.id}`), serverTimestamp()).catch(() => {});
}
