/**
 * Ambient sound (Phase 4): optional, off by default, and generated on the fly
 * with the Web Audio API (no audio files). This module is only fetched when the
 * visitor turns sound on; nothing audio-related exists before that.
 *
 *   Bed: wind across open ground (band-passed noise, slowly wandering) and a
 *        deep distant rumble (low-passed brown noise and a faint sub tone).
 *   Accents: a soft crackle when a story chapter is reached, a low swell as the
 *        Chapter 04 dive begins. Both are quiet, and both only echo what is
 *        already on screen: sound never carries information of its own.
 *
 * Fades in and out over about a second, and suspends while the tab is hidden.
 * A compressor at the end keeps the levels gentle and consistent.
 */
const BED_LEVEL = 0.5;
/** setTargetAtTime's time constant: ~95% of the way in about a second. */
const FADE_TC = 0.33;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let crackleBuffer: AudioBuffer | null = null;
let brown: AudioBuffer | null = null;
let on = false;
let suspendTimer = 0;

function noise(context: AudioContext, seconds: number, kind: 'white' | 'brown') {
  const buffer = context.createBuffer(
    1,
    Math.round(context.sampleRate * seconds),
    context.sampleRate,
  );
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'white') data[i] = white;
    else {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

/** Sparse, decaying clicks: a soft crackle, like cooling rock. */
function crackle(context: AudioContext) {
  const buffer = context.createBuffer(1, Math.round(context.sampleRate * 0.7), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const fade = 1 - i / data.length;
    if (Math.random() < 0.0016 * fade) {
      const size = 0.3 + Math.random() * 0.7;
      for (let k = 0; k < 90 && i + k < data.length; k++) {
        data[i + k]! += (Math.random() * 2 - 1) * size * Math.exp(-k / 14) * fade;
      }
    }
  }
  return buffer;
}

function lfo(context: AudioContext, rate: number, depth: number, target: AudioParam) {
  const osc = context.createOscillator();
  osc.frequency.value = rate;
  const amount = context.createGain();
  amount.gain.value = depth;
  osc.connect(amount).connect(target);
  osc.start();
}

function build() {
  const context = new AudioContext();
  const out = context.createDynamicsCompressor();
  out.threshold.value = -24;
  out.ratio.value = 4;
  out.connect(context.destination);
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(out);

  // Wind: band-passed noise whose centre and level drift slowly.
  const wind = context.createBufferSource();
  wind.buffer = noise(context, 4, 'white');
  wind.loop = true;
  const band = context.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 380;
  band.Q.value = 0.6;
  const windLevel = context.createGain();
  windLevel.gain.value = 0.035;
  wind.connect(band).connect(windLevel).connect(gain);
  lfo(context, 0.06, 160, band.frequency);
  lfo(context, 0.043, 0.014, windLevel.gain);
  wind.start();

  // Rumble: low-passed brown noise and a faint, slowly breathing sub tone.
  brown = noise(context, 5, 'brown');
  const rumble = context.createBufferSource();
  rumble.buffer = brown;
  rumble.loop = true;
  const low = context.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 110;
  const rumbleLevel = context.createGain();
  rumbleLevel.gain.value = 0.22;
  rumble.connect(low).connect(rumbleLevel).connect(gain);
  rumble.start();

  const sub = context.createOscillator();
  sub.frequency.value = 38;
  const subLevel = context.createGain();
  subLevel.gain.value = 0.02;
  sub.connect(subLevel).connect(gain);
  lfo(context, 0.031, 0.012, subLevel.gain);
  sub.start();

  crackleBuffer = crackle(context);
  ctx = context;
  master = gain;
}

function playCrackle() {
  if (!on || !ctx || !master || !crackleBuffer || ctx.state !== 'running') return;
  const source = ctx.createBufferSource();
  source.buffer = crackleBuffer;
  source.playbackRate.value = 0.85 + Math.random() * 0.3;
  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 1400;
  const level = ctx.createGain();
  level.gain.value = 0.07;
  source.connect(high).connect(level).connect(master);
  source.start();
}

function playSwell() {
  if (!on || !ctx || !master || !brown || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const level = ctx.createGain();
  level.gain.setValueAtTime(0, now);
  level.gain.linearRampToValueAtTime(0.09, now + 1.5);
  level.gain.linearRampToValueAtTime(0, now + 4);
  const tone = ctx.createOscillator();
  tone.frequency.setValueAtTime(52, now);
  tone.frequency.linearRampToValueAtTime(44, now + 4);
  const body = ctx.createBufferSource();
  body.buffer = brown;
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 180;
  tone.connect(level);
  body.connect(low).connect(level);
  level.connect(master);
  tone.start(now);
  body.start(now);
  tone.stop(now + 4.1);
  body.stop(now + 4.1);
}

function onVisibility() {
  if (!ctx) return;
  if (document.hidden) void ctx.suspend();
  else if (on) void ctx.resume();
}

let bound = false;

/** Turn the sound on or off, with a ~1 s fade either way. Must follow a user gesture. */
export function setSound(next: boolean) {
  on = next;
  if (next && !ctx) build();
  if (!ctx || !master) return;
  if (!bound) {
    bound = true;
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('monolith:chapter', playCrackle);
    document.addEventListener('monolith:dive', playSwell);
  }
  clearTimeout(suspendTimer);
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  if (next) {
    void ctx.resume();
    master.gain.setTargetAtTime(BED_LEVEL, now, FADE_TC);
  } else {
    master.gain.setTargetAtTime(0, now, FADE_TC);
    // Fully stop the audio thread once faded out.
    suspendTimer = window.setTimeout(() => {
      if (!on) void ctx?.suspend();
    }, 1400);
  }
}
