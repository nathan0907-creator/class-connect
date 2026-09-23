// Small DOM toolkit: element builder, toasts, modals, 3D tilt, formatting.
import { friendly } from './fb.js';
import { state } from './state.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * h('div.card#id', { onclick, dataset, style, ...attrs }, ...children)
 * Children may be strings (inserted as text, never HTML), nodes, arrays or falsy.
 */
export function h(tag, props, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const icon = (name) => h(`i.ico.ico-${name}`);

const PHOTO_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;
/** Round avatar: the member's (decrypted) profile photo, or their initials. `photo` overrides it (profile editor preview). */
export function avatar(profile, size = 36, photo = undefined) {
  const name = profile?.display_name || '?';
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const src = photo !== undefined ? photo : state.profiles?.get(profile?.id)?.photo;
  const style = { '--c': profile?.color || '#7c5cff', width: size + 'px', height: size + 'px', fontSize: size * 0.38 + 'px' };
  if (src && PHOTO_RE.test(src)) {
    return h('div.avatar.has-photo', { style: { ...style, backgroundImage: `url("${src}")` }, role: 'img', 'aria-label': name });
  }
  return h('div.avatar', { style }, initials);
}

// ---- toasts
export function toast(message, type = 'info', ms = 3800) {
  const el = h(`div.toast.toast-${type}`, h('span', message));
  $('.toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
}
export const toastError = (err) => { console.warn(err); toast(friendly(err), 'error'); };

// ---- modals
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const root = $('.modal-root');
  const close = () => {
    card.classList.add('out');
    backdrop.classList.add('out');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { backdrop.remove(); onClose?.(); }, 280);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const footer = actions.length
    ? h('div.modal-actions', actions.map((a) => h(`button.btn.${a.variant || 'btn-ghost'}`, {
        type: a.submit ? 'submit' : 'button',
        onclick: a.submit ? null : async (e) => {
          if (!a.onClick) return close();
          const btn = e.currentTarget;
          btn.disabled = true;
          try { if ((await a.onClick()) !== false) close(); } catch (err) { toastError(err); } finally { btn.disabled = false; }
        },
      }, h('span', a.label))))
    : null;
  const card = h(`div.modal.card${wide ? '.wide' : ''}`, { role: 'dialog', 'aria-modal': 'true' },
    h('header.modal-head', h('h3', title), h('button.icon-btn', { onclick: close, title: 'Fermer', type: 'button' }, '✕')),
    h('div.modal-body', body),
    footer);
  const backdrop = h('div.modal-backdrop', { onmousedown: (e) => { if (e.target === backdrop) close(); } }, card);
  root.append(backdrop);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => card.querySelector('input, select, textarea')?.focus());
  return { close, card };
}

export function confirmDialog(title, text, { danger = true, label = 'Confirmer' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title,
      body: h('p', text),
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        { label: 'Annuler' },
        { label, variant: danger ? 'btn-danger' : 'btn-primary', onClick: () => { answered = true; resolve(true); } },
      ],
    });
  });
}

// ---- 3D tilt for cards
export function enableTilt(root = document) {
  if (matchMedia('(pointer: coarse), (prefers-reduced-motion: reduce)').matches) return;
  for (const el of root.querySelectorAll('.tilt:not([data-tilt-on])')) {
    el.dataset.tiltOn = '1';
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--rx', (-y * 8).toFixed(2) + 'deg');
      el.style.setProperty('--ry', (x * 10).toFixed(2) + 'deg');
      el.style.setProperty('--mx', ((x + 0.5) * 100).toFixed(1) + '%');
      el.style.setProperty('--my', ((y + 0.5) * 100).toFixed(1) + '%');
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    });
  }
}

// ---- formatting
export const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtTime = (d) => timeFmt.format(new Date(d));
export function fmtDay(d) {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (date.toDateString() === today.toDateString()) return 'Aujourd\'hui';
  if (date.toDateString() === yesterday.toDateString()) return 'Hier';
  return dayFmt.format(date);
}
export function fmtRemaining(ms) {
  if (ms <= 0) return 'terminé';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min`;
  const hrs = Math.floor(m / 60);
  if (hrs < 48) return `${hrs} h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.floor(hrs / 24)} j ${hrs % 24} h`;
}
export const fmtSize = (n) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`);

/** Renders text with clickable http(s) links, safely. */
export function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    frag.append(text.slice(last, m.index));
    frag.append(h('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer' }, m[0]));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

export function busy(button, on) {
  button.disabled = on;
  button.classList.toggle('loading', on);
}
