// 📞 Appels audio / vidéo entre élèves (WebRTC). Firestore only carries the set-up (offer, answer, network candidates),
// encrypted with the key of the pair; the sound and the picture go straight from one browser to the other, encrypted
// by WebRTC itself (DTLS-SRTP). Free STUN servers only: no relay server, so a very locked-down network may block a call.
// 🤖 The picture received in a video call is checked on the device (same model as for photos): explicit content is
// hidden at once, and the call can be ended and reported.
import { doc, setDoc, updateDoc, addDoc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore';
import { sub, plain } from './fb.js';
import { state, memberName } from './state.js';
import { encryptJSON, decryptJSON } from './crypto.js';
import { h, icon, avatar, toast, toastError } from './ui.js';
import { notify } from './notify.js';
import { explicitFrame } from './modbot.js';
import { ensurePair, pairId, pairKeyFor, logCall } from './pm.js';

const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const RING_MS = 40000;
let s = null;                     // the current call
let unsubIncoming = null;
const handled = new Set();        // call ids already shown (or ignored)

export const inCall = () => !!s;
const supported = () => !!(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia);
const callRef = (id) => sub(state.cls.id, 'calls', id);
const iceCol = (id) => sub(state.cls.id, 'calls', id, 'ice');
const aad = (id, kind, from) => `call|${state.cls.id}|${id}|${kind}|${from}`;
const seal = async (sess, obj, kind) => { const e = await encryptJSON(sess.key, obj, aad(sess.id, kind, state.me.id)); return { iv: e.iv, ciphertext: e.ciphertext }; };
const unseal = (sess, blob, kind, from) => decryptJSON(sess.key, blob.iv, blob.ciphertext, aad(sess.id, kind, from));

// ------------------------------------------------------------ ringing (synthesised, no audio file)
let actx = null;
function tone(freq, start, dur, vol) {
  actx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  const t = actx.currentTime + start;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}
let ringTimer = null;
function ring(kind) {
  stopRing();
  const once = kind === 'in'
    ? () => { [[784, 0], [988, 0.18], [1175, 0.36], [988, 0.7], [1175, 0.88], [1568, 1.06]].forEach(([f, t]) => tone(f, t, 0.22, 0.12)); navigator.vibrate?.([300, 200, 300]); }
    : () => { tone(440, 0, 0.9, 0.05); tone(480, 0, 0.9, 0.04); };
  try { once(); } catch { /* no audio */ }
  ringTimer = setInterval(() => { try { once(); } catch { /* no audio */ } }, kind === 'in' ? 2200 : 3000);
}
function stopRing() { clearInterval(ringTimer); ringTimer = null; navigator.vibrate?.(0); }

// ------------------------------------------------------------ incoming calls (listened to as long as you're signed in)
export function startCalls() {
  unsubIncoming?.(); unsubIncoming = null;   // (re)started when rights change: an ongoing call keeps going
  if (!supported() || !state.me || state.me.role === 'teacher') return;
  const q = query(sub(state.cls.id, 'calls'), where('to', '==', state.me.id), where('state', '==', 'ringing'));
  unsubIncoming = onSnapshot(q, (snap) => {
    for (const ch of snap.docChanges()) {
      if (ch.type !== 'added') continue;
      const c = plain(ch.doc);
      if (handled.has(c.id)) continue;
      handled.add(c.id);
      const age = Date.now() - (c.created_at || 0);
      if (age > RING_MS) { updateDoc(callRef(c.id), { state: 'missed', updated_at: serverTimestamp() }).catch(() => {}); continue; }
      if (s) { updateDoc(callRef(c.id), { state: 'declined', updated_at: serverTimestamp() }).catch(() => {}); continue; }   // busy
      incoming(c, RING_MS - age);
    }
  }, () => {});
  window.addEventListener('pagehide', onLeave);
}
export function stopCalls() {
  unsubIncoming?.(); unsubIncoming = null;
  window.removeEventListener('pagehide', onLeave);
  if (s) hangup();
}
function onLeave() { if (s) hangup(); }

function incoming(c, msLeft) {
  const m = state.members.get(c.from);
  if (!m) return;
  const card = h('div.call-screen.incoming', { role: 'alertdialog', 'aria-label': `Appel de ${m.display_name}` },
    h('div.call-glow'),
    h('div.call-peer', h('div.call-rings', avatar(m, 132), h('i'), h('i'), h('i')),
      h('h3', m.display_name), h('p.call-status', c.video ? '🎥 Appel vidéo entrant…' : '📞 Appel audio entrant…')),
    h('div.call-controls',
      h('button.call-btn.decline', { type: 'button', onclick: () => answer(false) }, icon('phone-off'), h('span', 'Refuser')),
      c.video ? h('button.call-btn.accept.alt', { type: 'button', onclick: () => answer(true, false) }, icon('phone'), h('span', 'Sans caméra')) : null,
      h('button.call-btn.accept', { type: 'button', onclick: () => answer(true, c.video) }, icon(c.video ? 'video' : 'phone'), h('span', 'Accepter'))));
  document.body.append(card);
  requestAnimationFrame(() => card.classList.add('in'));
  ring('in');
  notify(`📞 ${m.display_name} t'appelle`, c.video ? 'Appel vidéo : ouvre Class Connect pour répondre' : 'Ouvre Class Connect pour répondre', `cc-call-${c.id}`);
  const timeout = setTimeout(() => done('missed'), msLeft);
  const unsub = onSnapshot(callRef(c.id), (d) => { if (d.get('state') !== 'ringing') done(); }, () => done());
  let over = false;
  function done(write) {
    if (over) return;
    over = true;
    clearTimeout(timeout);
    unsub();
    stopRing();
    card.remove();
    if (write) updateDoc(callRef(c.id), { state: write, updated_at: serverTimestamp() }).catch(() => {});
  }
  function answer(yes, video) {
    if (!yes) return done('declined');
    done();
    accept(c, video);
  }
  card.querySelector('.call-btn.accept')?.focus();
}

// ------------------------------------------------------------ one call
function session(other, video, role) {
  return { id: null, other, video, role, pc: null, local: null, key: null, ui: null, unsubs: [], outIce: [], inIce: [], created: false, answered: false, connectedAt: 0, over: false, timers: [] };
}

async function media(video) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } } : false,
    });
  } catch (err) {
    if (video && err.name !== 'NotAllowedError') return media(false);   // no camera: audio only
    throw new Error(err.name === 'NotAllowedError'
      ? `Autorise l'accès au ${video ? 'micro et à la caméra' : 'micro'} dans ton navigateur pour appeler`
      : 'Micro introuvable sur cet appareil');
  }
}

function peer(sess) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  sess.pc = pc;
  sess.local.getTracks().forEach((t) => pc.addTrack(t, sess.local));
  pc.ontrack = (e) => {
    const stream = e.streams[0] || new MediaStream([e.track]);
    sess.ui.remote.srcObject = stream;
    sess.ui.audio.srcObject = stream;
    if (e.track.kind === 'video') { sess.remoteVideo = true; sess.ui.root.classList.add('has-remote-video'); }
  };
  pc.onicecandidate = async (e) => {
    if (!e.candidate) return;
    const blob = await seal(sess, e.candidate.toJSON(), 'ice');
    if (!sess.created) sess.outIce.push(blob);
    else addDoc(iceCol(sess.id), { from: state.me.id, ...blob, created_at: serverTimestamp() }).catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') {
      if (!sess.connectedAt) { sess.connectedAt = Date.now(); stopRing(); watchPicture(sess); }
      sess.ui.root.classList.add('live');
      status(sess, '');
    } else if (st === 'disconnected') status(sess, 'Reconnexion…');
    else if (st === 'failed') {
      toast('Connexion impossible : le réseau (wifi de l\'école ?) bloque peut-être les appels. Essaie en 4G ou à la maison.', 'error', 7000);
      hangup();
    }
  };
  // Little control channel: camera / micro on or off, shown on the other side.
  const wire = (ch) => {
    sess.ctl = ch;
    ch.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        sess.ui.root.classList.toggle('peer-cam-off', m.cam === false);
        sess.ui.root.classList.toggle('peer-muted', m.mic === false);
      } catch { /* ignore */ }
    };
    ch.onopen = () => sendCtl(sess);
  };
  if (sess.role === 'caller') wire(pc.createDataChannel('ctl'));
  else pc.ondatachannel = (e) => wire(e.channel);
}
/** Network candidates from the other side (only once the call document exists: the rules check it). */
function listenIce(sess) {
  const { pc } = sess;
  sess.unsubs.push(onSnapshot(query(iceCol(sess.id), where('from', '==', sess.other)), (snap) => {
    snap.docChanges().forEach(async (ch) => {
      if (ch.type !== 'added') return;
      try {
        const cand = await unseal(sess, ch.doc.data(), 'ice', sess.other);
        if (pc.remoteDescription) await pc.addIceCandidate(cand);
        else sess.inIce.push(cand);
      } catch { /* bad candidate */ }
    });
  }, () => {}));
}
const flushIce = async (sess) => { for (const c of sess.inIce.splice(0)) await sess.pc.addIceCandidate(c).catch(() => {}); };
const sendCtl = (sess) => {
  if (sess.ctl?.readyState !== 'open') return;
  const v = sess.local?.getVideoTracks()[0];
  const a = sess.local?.getAudioTracks()[0];
  sess.ctl.send(JSON.stringify({ cam: !!v && v.enabled, mic: !!a && a.enabled }));
};

/** Calls a classmate. */
export async function startCall(otherId, video) {
  if (s) return toast('Tu es déjà en appel');
  if (!supported()) return toast('Ton navigateur ne permet pas les appels', 'error');
  const sess = session(otherId, video, 'caller');
  s = sess;
  try {
    await ensurePair(otherId);
    sess.key = await pairKeyFor(otherId);
    sess.id = doc(sub(state.cls.id, 'calls')).id;
    screen(sess, 'Appel en cours…');
    sess.local = await media(video);
    if (sess.over) return stopMedia(sess);
    showLocal(sess);
    peer(sess);
    const offer = await sess.pc.createOffer();
    await sess.pc.setLocalDescription(offer);
    await setDoc(callRef(sess.id), {
      pair: pairId(otherId), from: state.me.id, to: otherId, video: !!sess.local.getVideoTracks().length, state: 'ringing',
      offer: await seal(sess, { type: offer.type, sdp: offer.sdp }, 'offer'), answer: null, created_at: serverTimestamp(), updated_at: serverTimestamp(),
    });
    sess.created = true;
    listenIce(sess);
    for (const blob of sess.outIce.splice(0)) addDoc(iceCol(sess.id), { from: state.me.id, ...blob, created_at: serverTimestamp() }).catch(() => {});
    ring('out');
    sess.timers.push(setTimeout(() => { if (!sess.answered) hangup('missed'); }, RING_MS));
    sess.unsubs.push(onSnapshot(callRef(sess.id), async (d) => {
      const c = d.data();
      if (!c) return;
      if (c.state === 'accepted' && !sess.answered && c.answer) {
        sess.answered = true;
        stopRing();
        status(sess, 'Connexion…');
        try {
          await sess.pc.setRemoteDescription(await unseal(sess, c.answer, 'answer', otherId));
          await flushIce(sess);
        } catch (err) { toastError(err); hangup(); }
      } else if (['declined', 'missed', 'cancelled', 'ended'].includes(c.state)) finish(c.state);
    }, () => {}));
  } catch (err) {
    toastError(err);
    finish('error');
  }
}

async function accept(c, video) {
  if (s) return;
  const sess = session(c.from, c.video, 'callee');
  sess.id = c.id;
  s = sess;
  try {
    sess.key = await pairKeyFor(c.from);
    screen(sess, 'Connexion…');
    sess.local = await media(video);
    showLocal(sess);
    peer(sess);
    listenIce(sess);
    await sess.pc.setRemoteDescription(await unseal(sess, c.offer, 'offer', c.from));
    const ans = await sess.pc.createAnswer();
    await sess.pc.setLocalDescription(ans);
    sess.created = true;
    await updateDoc(callRef(c.id), { state: 'accepted', answer: await seal(sess, { type: ans.type, sdp: ans.sdp }, 'answer'), updated_at: serverTimestamp() });
    for (const blob of sess.outIce.splice(0)) addDoc(iceCol(sess.id), { from: state.me.id, ...blob, created_at: serverTimestamp() }).catch(() => {});
    await flushIce(sess);
    sess.unsubs.push(onSnapshot(callRef(c.id), (d) => { if (['ended', 'cancelled', 'missed'].includes(d.get('state'))) finish('ended'); }, () => {}));
  } catch (err) {
    toastError(err);
    updateDoc(callRef(c.id), { state: 'ended', updated_at: serverTimestamp() }).catch(() => {});
    finish('error');
  }
}

/** Ends the call from this side. */
export function hangup(reason) {
  const sess = s;
  if (!sess || sess.over) return;
  const next = reason || (sess.role === 'caller' && !sess.answered ? 'cancelled' : 'ended');
  if (sess.created) updateDoc(callRef(sess.id), { state: next, updated_at: serverTimestamp() }).catch(() => {});
  finish(next);
}

function stopMedia(sess) { sess.local?.getTracks().forEach((t) => t.stop()); }

function finish(reason) {
  const sess = s;
  if (!sess || sess.over) return;
  sess.over = true;
  s = null;
  stopRing();
  sess.timers.forEach(clearTimeout);
  clearInterval(sess.clock);
  clearInterval(sess.watch);
  sess.unsubs.forEach((u) => u());
  stopMedia(sess);
  try { sess.pc?.close(); } catch { /* ignore */ }
  const seconds = sess.connectedAt ? Math.round((Date.now() - sess.connectedAt) / 1000) : 0;
  const name = memberName(sess.other);
  if (sess.ui) {
    status(sess, seconds ? `Appel terminé · ${fmt(seconds)}` : reason === 'declined' ? `${name} a refusé l'appel` : reason === 'missed' ? `${name} n'a pas répondu` : 'Appel terminé');
    sess.ui.root.classList.add('out');
    setTimeout(() => sess.ui.root.remove(), seconds || reason === 'error' ? 900 : 1800);
  }
  // The caller writes the call in the conversation (once).
  if (sess.role === 'caller' && sess.created) {
    logCall(sess.other, { video: !!sess.video, status: seconds ? 'done' : reason === 'declined' ? 'declined' : 'missed', seconds });
  }
}

// ------------------------------------------------------------ call screen
const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
function status(sess, text) {
  if (!sess.ui) return;
  sess.ui.status.textContent = text;
  if (!text && sess.connectedAt) {
    clearInterval(sess.clock);
    const tick = () => { sess.ui.status.textContent = fmt(Math.round((Date.now() - sess.connectedAt) / 1000)); };
    tick();
    sess.clock = setInterval(tick, 1000);
  }
}

function screen(sess, text) {
  const m = state.members.get(sess.other);
  const remote = h('video.call-remote', { autoplay: true, playsInline: true, muted: true });
  const audio = h('audio', { autoplay: true });
  const local = h('video.call-local', { autoplay: true, playsInline: true, muted: true });
  const st = h('p.call-status', { 'aria-live': 'polite' }, text);
  const toggle = (kind) => {
    const track = kind === 'mic' ? sess.local?.getAudioTracks()[0] : sess.local?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    root.classList.toggle(kind === 'mic' ? 'me-muted' : 'me-cam-off', !track.enabled);
    sendCtl(sess);
  };
  const shield = h('div.call-shield', { hidden: true },
    h('b', '🤖 Image masquée'), h('p', 'La modération automatique a détecté une image inappropriée.'),
    h('button.btn.btn-danger', { type: 'button', onclick: () => hangup() }, 'Raccrocher'));
  const root = h(`div.call-screen${sess.video ? '.video' : ''}`, { role: 'dialog', 'aria-label': `Appel avec ${memberName(sess.other)}` },
    h('div.call-glow'),
    h('div.call-stage',
      remote, audio, shield,
      h('div.call-peer', h('div.call-rings', avatar(m, 132), h('i'), h('i'), h('i')),
        h('h3', memberName(sess.other)), st,
        h('p.call-flags', h('span.flag-muted', '🔇 Micro coupé'), h('span.flag-cam', '📷 Caméra coupée'))),
      local,
      h('p.call-lock', '🔒 Chiffré de bout en bout')),
    h('div.call-controls',
      h('button.call-btn.round', { type: 'button', 'aria-label': 'Couper / activer le micro', onclick: () => toggle('mic') }, icon('mic')),
      h('button.call-btn.round.cam', { type: 'button', 'aria-label': 'Couper / activer la caméra', onclick: () => toggle('cam') }, icon('video')),
      h('button.call-btn.round.min', { type: 'button', 'aria-label': 'Réduire', onclick: () => root.classList.toggle('mini') }, icon('minimize')),
      h('button.call-btn.decline', { type: 'button', 'aria-label': 'Raccrocher', onclick: () => hangup() }, icon('phone-off'), h('span', 'Raccrocher'))));
  root.addEventListener('click', (e) => { if (root.classList.contains('mini') && !e.target.closest('button')) root.classList.remove('mini'); });
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('in'));
  sess.ui = { root, remote, audio, local, status: st, shield };
}
function showLocal(sess) {
  sess.ui.local.srcObject = sess.local;
  sess.ui.root.classList.toggle('has-local-video', sess.local.getVideoTracks().length > 0);
}

// 🤖 Every few seconds, the picture received (and the one sent) is checked on the device.
function watchPicture(sess) {
  if (!sess.video && !sess.remoteVideo) return;
  let busy = false;
  sess.watch = setInterval(async () => {
    if (busy || document.hidden || sess.over) return;
    busy = true;
    try {
      if (sess.remoteVideo && !sess.ui.root.classList.contains('shielded') && await explicitFrame(sess.ui.remote)) {
        sess.ui.root.classList.add('shielded');
        sess.ui.shield.hidden = false;
      }
      const cam = sess.local?.getVideoTracks()[0];
      if (cam?.enabled && await explicitFrame(sess.ui.local)) {
        cam.enabled = false;
        sess.ui.root.classList.add('me-cam-off');
        sendCtl(sess);
        toast('🤖 Caméra coupée par la modération automatique', 'error', 6000);
      }
    } finally { busy = false; }
  }, 3000);
}
