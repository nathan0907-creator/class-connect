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
export const isTeacher = () => state.me?.role === 'teacher' && state.me?.status === 'active';
/** Delegates, teachers and members marked as trusted may publish courses for the revision AI. */
export const canPublish = () => state.me?.status === 'active' && (['delegate', 'teacher'].includes(state.me.role) || state.me.trusted === true);

/** Chat channels. Students never see the staff room; teachers never see the students' channel. */
export const CHANNELS = {
  messages: { label: 'Classe', title: 'Canal de la classe', hint: 'Élèves uniquement' },
  mixed_messages: { label: 'Profs & élèves', title: 'Profs & élèves', hint: 'Élèves et professeurs' },
  staff_messages: { label: 'Salle des profs', title: 'Salle des profs', hint: 'Professeurs uniquement' },
};
export const channelsFor = () => (isTeacher() ? ['staff_messages', 'mixed_messages'] : ['messages', 'mixed_messages']);
export const memberName = (id) => state.members.get(id)?.display_name || 'Ancien membre';
