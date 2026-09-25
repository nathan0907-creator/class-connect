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
/** Listens to an app event; returns the function that stops listening. */
export const on = (type, fn) => {
  const listener = (e) => fn(e.detail);
  bus.addEventListener(type, listener);
  return () => bus.removeEventListener(type, listener);
};

export const isDelegate = () => state.me?.role === 'delegate' && state.me?.status === 'active';
export const isTeacher = () => state.me?.role === 'teacher' && state.me?.status === 'active';
/** "Prof principal": receives every harassment report of the class. */
export const isPrincipal = () => isTeacher() && state.me.principal === true;
/** "Suppléant": stands in for the delegates (moderation of the students' channels, course publishing). */
export const isDeputy = () => state.me?.role === 'deputy' && state.me?.status === 'active';
export const MAX_DELEGATES = 2;
/** Delegates, deputies, teachers and members marked as trusted may publish courses for the revision AI. */
export const canPublish = () => state.me?.status === 'active' && (['delegate', 'deputy', 'teacher'].includes(state.me.role) || state.me.trusted === true);

/** Chat channels. Students never see the staff room; teachers never see the students' channel. */
export const CHANNELS = {
  messages: { label: 'Classe', title: 'Canal de la classe', hint: 'Élèves uniquement' },
  mixed_messages: { label: 'Profs & élèves', title: 'Profs & élèves', hint: 'Élèves et professeurs' },
  staff_messages: { label: 'Salle des profs', title: 'Salle des profs', hint: 'Professeurs uniquement' },
  announcements: { label: '📢 Annonces', title: 'Annonces', hint: 'Délégués et profs publient, tout le monde lit' },
};
export const channelsFor = () => (isTeacher() ? ['staff_messages', 'mixed_messages', 'announcements'] : ['messages', 'mixed_messages', 'announcements']);
/** Who may write announcements (everyone else can only post a "prof absent / salle changée" alert there). */
export const canAnnounce = () => isDelegate() || isDeputy() || isTeacher();
export const memberName = (id) => state.members.get(id)?.display_name || 'Ancien membre';
