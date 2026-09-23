export const state = {
  session: null,        // Supabase session
  me: null,             // profiles row
  privateKey: null,     // non-extractable ECDH CryptoKey
  cls: null,            // classes row
  members: new Map(),   // id -> profile
  classKeys: new Map(), // epoch -> AES CryptoKey
  online: new Set(),
  channel: null,        // realtime channel
  space: null,          // 3D scene
};

const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, (e) => fn(e.detail));

export const isDelegate = () => state.me?.role === 'delegate' && state.me?.status === 'active';
/** Delegates and members marked as trusted may publish courses for the revision AI. */
export const canPublish = () => state.me?.status === 'active' && (state.me.role === 'delegate' || state.me.trusted === true);
export const memberName = (id) => state.members.get(id)?.display_name || 'Ancien membre';
