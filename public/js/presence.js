// Online presence and per-channel typing indicators through Firebase Realtime Database (optional, free).
// The database SDK is only downloaded when a class is opened (it isn't needed for the login screen).
import { loadRtdb } from './fb.js';
import { state, emit } from './state.js';

let R = null;               // loaded SDK + database
let offs = [];
let typingOffs = [];
let cid = null;
let typingChannel = null;
let wantedChannel = null;   // channel opened before presence was started
let lastTyping = 0;
let session = 0;            // a newer start/stop cancels a start still loading

export async function startPresence(classId) {
  stopPresence();
  const mySession = ++session;
  R = await loadRtdb().catch(() => null);
  if (!R || mySession !== session) return;
  const { rtdb, ref, onValue, onDisconnect, set } = R;
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
  if (!R || !cid) return;
  const { rtdb, ref, onDisconnect, onChildAdded, onChildChanged } = R;
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
  session++;
  offs.forEach((off) => off());
  typingOffs.forEach((off) => off());
  offs = [];
  typingOffs = [];
  if (R && cid && state.me) {
    R.remove(R.ref(R.rtdb, `presence/${cid}/${state.me.id}`)).catch(() => {});
  }
  cid = null;
  typingChannel = null;
}

export function sendTyping() {
  if (!R || !cid || !typingChannel || Date.now() - lastTyping < 2500) return;
  lastTyping = Date.now();
  R.set(R.ref(R.rtdb, `typing/${cid}/${typingChannel}/${state.me.id}`), R.serverTimestamp()).catch(() => {});
}
