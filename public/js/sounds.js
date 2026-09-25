// Small space sounds, synthesised on the fly (no audio file to download). Off by default, see « ✨ Affichage ».
let ctx = null;
let enabled = false;

export const setSounds = (on) => { enabled = !!on; };
export const soundsOn = () => enabled;

const SOUNDS = {
  // [frequency start, frequency end, duration (s), wave, volume]
  send: [[520, 1040, 0.16, 'sine', 0.08]],
  receive: [[880, 660, 0.12, 'triangle', 0.07], [1320, 990, 0.1, 'triangle', 0.04, 0.07]],
  level: [[523, 523, 0.12, 'square', 0.04], [659, 659, 0.12, 'square', 0.04, 0.12], [784, 784, 0.12, 'square', 0.04, 0.24], [1047, 1047, 0.3, 'square', 0.05, 0.36]],
  warp: [[80, 1600, 0.9, 'sawtooth', 0.04]],
  pop: [[300, 900, 0.07, 'sine', 0.08]],
};

/** Plays one of the sounds above (does nothing when sounds are off or the browser has no Web Audio). */
export function play(name, force = false) {
  if ((!enabled && !force) || !SOUNDS[name]) return;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    for (const [f0, f1, dur, type, vol, delay = 0] of SOUNDS[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, now + delay);
      osc.frequency.exponentialRampToValueAtTime(f1, now + delay + dur);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(vol, now + delay + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.02);
    }
  } catch { /* no audio */ }
}
