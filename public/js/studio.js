// Little creative tools of the chat: freehand drawing, meme maker and the wheel of fortune.
// Drawings and memes become ordinary (encrypted) images; the wheel posts its result as a message.
import { state } from './state.js';
import { h, modal, toast } from './ui.js';

const PALETTE = ['#ffffff', '#000000', '#ff5f7a', '#ffb547', '#ffe14d', '#3dffa8', '#00d4ff', '#7c5cff', '#ff4fd8'];
const toBlob = (canvas, type = 'image/png', q) => new Promise((r) => canvas.toBlob(r, type, q));

/** Freehand drawing → resolves with a PNG File (or null if cancelled). */
export function openDrawing() {
  return new Promise((resolve) => {
    const W = 720, H = 540;
    const canvas = h('canvas.draw-canvas', { width: W, height: H, 'aria-label': 'Zone de dessin' });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let color = '#000000';
    let size = 6;
    let drawing = false;
    const history = [];
    const save = () => { history.push(ctx.getImageData(0, 0, W, H)); if (history.length > 30) history.shift(); };
    const at = (e) => {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      save();
      drawing = true;
      const [x, y] = at(e);
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 0.01, y);
      ctx.stroke();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const [x, y] = at(e);
      ctx.lineTo(x, y);
      ctx.stroke();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => canvas.addEventListener(t, () => { drawing = false; }));

    const colors = h('div.draw-colors', PALETTE.map((c) => h(`button.swatch${c === color ? '.active' : ''}`, {
      type: 'button', style: { '--c': c }, 'aria-label': `Couleur ${c}`,
      onclick: (e) => { color = c; colors.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', b === e.currentTarget)); },
    })));
    const sizes = h('div.seg.seg-sm', [[3, 'Fin'], [6, 'Moyen'], [14, 'Épais'], [30, 'Gomme']].map(([s, l]) => h(`button${s === size ? '.active' : ''}`, {
      type: 'button', onclick: (e) => {
        size = s;
        if (l === 'Gomme') color = '#ffffff';
        sizes.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget));
      },
    }, l)));
    let done = false;
    modal({
      title: '✏️ Dessin', wide: true,
      body: h('div.draw-box', canvas, h('div.draw-tools', colors, sizes,
        h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { const last = history.pop(); if (last) ctx.putImageData(last, 0, 0); } }, '↶ Annuler'),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { save(); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); } }, 'Tout effacer'))),
      onClose: () => { if (!done) resolve(null); },
      actions: [
        { label: 'Annuler' },
        { label: 'Envoyer le dessin', variant: 'btn-primary', onClick: async () => {
          done = true;
          const blob = await toBlob(canvas);
          resolve(new File([blob], 'dessin.png', { type: 'image/png' }));
        } },
      ],
    });
  });
}

/** Meme maker: an image + top / bottom captions → resolves with a JPEG File (or null). */
export function openMeme() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*' });
    const top = h('input', { maxLength: 80, placeholder: 'Texte du haut' });
    const bottom = h('input', { maxLength: 80, placeholder: 'Texte du bas' });
    const canvas = h('canvas.meme-canvas', { width: 600, height: 600, 'aria-label': 'Aperçu du mème' });
    const ctx = canvas.getContext('2d');
    let img = null;
    const draw = () => {
      if (!img) {
        ctx.fillStyle = '#1b1450';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#b3afdc';
        ctx.font = '600 24px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Choisis une image 👆', canvas.width / 2, canvas.height / 2);
        return;
      }
      const scale = Math.min(1, 900 / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const fs = Math.max(22, Math.round(canvas.width / 11));
      ctx.font = `900 ${fs}px Impact, 'Arial Black', sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(3, fs / 9);
      ctx.lineJoin = 'round';
      const line = (text, y, base) => {
        if (!text) return;
        const t = text.toUpperCase();
        ctx.textBaseline = base;
        ctx.strokeText(t, canvas.width / 2, y, canvas.width * 0.94);
        ctx.fillText(t, canvas.width / 2, y, canvas.width * 0.94);
      };
      line(top.value, fs * 0.25, 'top');
      line(bottom.value, canvas.height - fs * 0.25, 'bottom');
    };
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f || !f.type.startsWith('image/') || /svg/i.test(f.type)) return toast('Choisis une photo (JPG, PNG…)', 'error');
      try { img = await createImageBitmap(f); draw(); } catch { toast('Image illisible', 'error'); }
    });
    [top, bottom].forEach((i) => i.addEventListener('input', draw));
    draw();
    let done = false;
    modal({
      title: '😂 Créer un mème', wide: true,
      body: h('div.meme-box', h('label.field', h('span', 'Image'), input), h('div.row', h('label.field', h('span', 'Haut'), top), h('label.field', h('span', 'Bas'), bottom)), canvas),
      onClose: () => { if (!done) resolve(null); },
      actions: [
        { label: 'Annuler' },
        { label: 'Envoyer le mème', variant: 'btn-primary', onClick: async () => {
          if (!img) throw new Error('Choisis d\'abord une image');
          done = true;
          const blob = await toBlob(canvas, 'image/jpeg', 0.9);
          resolve(new File([blob], 'meme.jpg', { type: 'image/jpeg' }));
        } },
      ],
    });
  });
}

/** Wheel of fortune: picks someone (or something) at random → resolves with the winning label (or null). */
export function openWheel() {
  return new Promise((resolve) => {
    const members = [...state.members.values()].filter((m) => m.status === 'active' && m.role !== 'teacher')
      .sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr'));
    const custom = h('textarea', { rows: 3, maxLength: 1000, placeholder: 'Ou écris tes propres choix, un par ligne (ex. sujets d\'exposé)' });
    const checks = h('div.wheel-members', members.map((m) => h('label.check', h('input', { type: 'checkbox', checked: true, value: m.display_name }), h('span', m.display_name))));
    const canvas = h('canvas.wheel-canvas', { width: 360, height: 360, 'aria-hidden': 'true' });
    const result = h('p.wheel-result', { role: 'status' });
    const entries = () => {
      const lines = custom.value.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 40);
      return lines.length ? lines : [...checks.querySelectorAll('input:checked')].map((i) => i.value);
    };
    const COLORS = ['#7c5cff', '#00d4ff', '#ff4fd8', '#ffb547', '#3dffa8', '#ff6b6b', '#5b8cff', '#c77dff'];
    const draw = (angle = 0) => {
      const list = entries();
      const ctx = canvas.getContext('2d');
      const r = canvas.width / 2;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!list.length) return;
      const step = (Math.PI * 2) / list.length;
      list.forEach((label, i) => {
        ctx.beginPath();
        ctx.moveTo(r, r);
        ctx.arc(r, r, r - 4, angle + i * step, angle + (i + 1) * step);
        ctx.fillStyle = COLORS[i % COLORS.length];
        ctx.fill();
        ctx.save();
        ctx.translate(r, r);
        ctx.rotate(angle + (i + 0.5) * step);
        ctx.fillStyle = '#0b0820';
        ctx.font = `600 ${list.length > 16 ? 10 : 13}px Inter, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(label.slice(0, 18), r - 14, 4);
        ctx.restore();
      });
      ctx.beginPath();
      ctx.moveTo(canvas.width - 2, r);
      ctx.lineTo(canvas.width - 24, r - 10);
      ctx.lineTo(canvas.width - 24, r + 10);
      ctx.fillStyle = '#fff';
      ctx.fill();
    };
    [custom, checks].forEach((el) => el.addEventListener('input', () => draw()));
    checks.addEventListener('change', () => draw());
    draw();
    let winner = null;
    let spinning = false;
    const spin = () => {
      const list = entries();
      if (list.length < 2) return toast('Il faut au moins 2 choix', 'error');
      if (spinning) return;
      spinning = true;
      const pick = crypto.getRandomValues(new Uint32Array(1))[0] % list.length;
      const step = (Math.PI * 2) / list.length;
      // The pointer is on the right (angle 0): bring the middle of the chosen slice there.
      const target = -(pick + 0.5) * step + Math.PI * 2 * (5 + Math.random());
      const start = performance.now();
      const dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 3600;
      const frame = (now) => {
        const t = Math.min(1, (now - start) / dur);
        draw(target * (1 - (1 - t) ** 4));
        if (t < 1) requestAnimationFrame(frame);
        else { spinning = false; winner = list[pick]; result.textContent = `🎉 ${winner} !`; navigator.vibrate?.(30); }
      };
      requestAnimationFrame(frame);
    };
    let done = false;
    modal({
      title: '🎡 La roue de la chance', wide: true,
      body: h('div.wheel-box', h('div.wheel-stage', canvas, h('button.btn.btn-primary', { type: 'button', onclick: spin }, 'Lancer la roue'), result),
        h('div.wheel-setup', h('p.hint', 'Qui participe ?'), checks, custom)),
      onClose: () => { if (!done) resolve(null); },
      actions: [
        { label: 'Fermer' },
        { label: 'Partager le résultat', variant: 'btn-primary', onClick: () => {
          if (!winner) throw new Error('Lance d\'abord la roue');
          done = true;
          resolve(winner);
        } },
      ],
    });
  });
}
