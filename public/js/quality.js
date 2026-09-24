// Performance levels, shared by the 3D backdrop (space.js) and the interface (body.eco lightens the CSS).
// "eco" is chosen automatically on phones and modest devices; the choice can be changed in « 🎨 Thème ».
export const QUALITY = {
  eco: { label: 'Économie', hint: 'Fluide sur tous les téléphones, économise la batterie', ratio: 0.85, bloom: false, fps: { auth: 30, app: 12 } },
  normal: { label: 'Normale', hint: 'Joli et léger', ratio: 1.25, bloom: true, fps: { auth: 45, app: 24 } },
  max: { label: 'Maximum', hint: 'Pour les ordinateurs puissants', ratio: 1.75, bloom: true, fps: { auth: 60, app: 60 } },
};
const KEY = 'cc-quality';

export function autoQuality() {
  const phone = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  return phone || cores <= 4 || memory <= 4 ? 'eco' : 'normal';
}
/** 'auto' (default) or a level chosen by the person. */
export function savedQuality() {
  try { const q = localStorage.getItem(KEY); return QUALITY[q] ? q : 'auto'; } catch { return 'auto'; }
}
export const chosenQuality = () => (savedQuality() === 'auto' ? autoQuality() : savedQuality());
export function saveQuality(q) {
  try { if (q === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, q); } catch { /* ignore */ }
}
export const applyQualityClass = (q = chosenQuality()) => document.body.classList.toggle('eco', q === 'eco');
