// Sound: ambience beds, one-off effects from the simulation's events, crew
// footsteps and menu clicks. Plain Web Audio, so it knows nothing of Babylon.
// Files live in public/audio (made on Runway, see public/audio/README.md).

import type { Crew, Outcome, Sim, SimEvent } from '../sim/sim.ts';
import type { Vec } from '../sim/level.ts';

type Rect = { x0: number; y0: number; x1: number; y1: number };

/** One-off effects, by file name in public/audio. */
const SFX = [
  'gun-pistol', 'gun-rifle', 'gun-shotgun', 'gun-smg', 'reload',
  'door-kick', 'door-open', 'glass-smash', 'body-fall', 'bag-grab',
  'dog-bark', 'dog-growl', 'siren', 'phone-999', 'car-alarm', 'car-door', 'car-getaway',
  'step-concrete', 'step-grass', 'step-stairs',
  'ui-click', 'ui-hover', 'ui-go', 'results-sting',
] as const;
type Sfx = (typeof SFX)[number];

/** Looping beds. */
const BEDS = ['amb-estate-night', 'amb-park-night', 'amb-indoor', 'amb-rain', 'tension-drone'] as const;
type Bed = (typeof BEDS)[number];

/** How loud each bed sits in each part of the game (0 to 1). */
type Mix = Partial<Record<Bed, number>>;

/** Crew weapons by slot, matching the models (Dex carries the rifle). */
const CREW_GUNS: Sfx[] = ['gun-rifle', 'gun-pistol', 'gun-pistol', 'gun-pistol'];
const ENEMY_GUNS: Sfx[] = ['gun-pistol', 'gun-pistol', 'gun-smg', 'gun-shotgun'];

/** Seconds between footfalls at walking pace. */
const STRIDE = 0.42;

const MUTE_KEY = 'sk.muted';

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private bedBus!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  /** Where each footfall starts in the footstep recordings. */
  private onsets = new Map<string, number[]>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private beds = new Map<Bed, GainNode>();
  private mix: Mix = {};
  private muted = false;
  private steps: { prev: Vec | null; t: number }[] = [];
  /** Throttles so a burst of the same event does not stack into a wall of noise. */
  private lastPlayed = new Map<string, number>();
  private outdoors: 'estate' | 'park' = 'estate';

  private base: string;

  constructor(base = 'audio/') {
    this.base = base;
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      // No storage (private window): start unmuted.
    }
    // Browsers only let sound start from a click or key press.
    const unlock = () => {
      this.start();
      if (this.ctx?.state === 'running') {
        removeEventListener('pointerdown', unlock, true);
        removeEventListener('keydown', unlock, true);
      }
    };
    addEventListener('pointerdown', unlock, true);
    addEventListener('keydown', unlock, true);
    this.wireButtons();
  }

  get isMuted() {
    return this.muted;
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      // Not remembered, which is fine.
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** Park levels get wind in the trees and grass underfoot; the rest get the estate. */
  setLevel(kind: 'estate' | 'park') {
    this.outdoors = kind;
    this.applyMix();
  }

  /** The beds for each part of the game. */
  setPhase(phase: 'title' | 'planning' | 'raid' | 'results' | 'replay') {
    const out: Bed = this.outdoors === 'park' ? 'amb-park-night' : 'amb-estate-night';
    if (phase === 'title') this.mix = { [out]: 0.35, 'amb-rain': 0.5 };
    else if (phase === 'planning') this.mix = { [out]: 0.3, 'amb-rain': 0.25, 'tension-drone': 0.12 };
    else if (phase === 'raid' || phase === 'replay') this.mix = { [out]: 0.5, 'amb-rain': 0.4, 'amb-indoor': this.outdoors === 'park' ? 0 : 0.12, 'tension-drone': 0.3 };
    else this.mix = { [out]: 0.25, 'amb-rain': 0.45 };
    this.applyMix();
  }

  /** The plan goes live. */
  go() {
    this.play('ui-go', { vol: 0.7 });
  }

  /** The job is over: the getaway, then the sting under the results. */
  finish(outcome: Outcome) {
    if (outcome.reason === 'escaped' || outcome.reason === 'droveOff') {
      this.play('car-door', { vol: 0.7 });
      this.play('car-getaway', { vol: 0.8, delay: 0.35 });
    }
    this.play('results-sting', { vol: 0.6, delay: 0.9 });
  }

  /** One-off effects for what just happened, placed by where it happened on screen. */
  handleEvents(events: SimEvent[], sim: Sim, view: Rect | null) {
    const crew = sim.crew;
    for (const ev of events) {
      if (ev.type === 'shot') {
        const gun = ev.byCrew ? CREW_GUNS[nearestCrew(crew, ev.from)] : ENEMY_GUNS[hash(ev.from) % ENEMY_GUNS.length];
        this.at('gun', gun, ev.from, view, { vol: 0.9, rate: [0.94, 1.06], gap: 0.05 });
      } else if (ev.type === 'door') {
        if (ev.state === 'broken') this.at('kick', 'door-kick', ev, view, { vol: 1 });
        else this.at('door', 'door-open', ev, view, { vol: 0.8, gap: 0.2 });
      } else if (ev.type === 'ramming') this.at('ram', 'door-kick', ev, view, { vol: 0.6, rate: [0.8, 0.9], gap: 0.8 });
      else if (ev.type === 'down') this.at('down', 'body-fall', posOf(ev, sim) ?? centre(view), view, { vol: 0.8, delay: 0.1 });
      else if (ev.type === 'loot' || ev.type === 'snatch') this.play('bag-grab', { vol: 0.6, gap: 0.3 });
      else if (ev.type === 'noise' && ev.label === 'Barking') {
        this.at('dog', Math.random() < 0.75 ? 'dog-bark' : 'dog-growl', ev, view, { vol: 0.85, gap: 1.2 });
      } else if (ev.type === 'calling') this.play('phone-999', { vol: 0.45 });
      else if (ev.type === 'police') this.play('siren', { vol: 0.55 });
      else if (ev.type === 'backup') this.play('car-door', { vol: 0.6 });
      else if (ev.type === 'alert') this.at('alarm', 'car-alarm', ev, view, { vol: 0.25, gap: 20, chance: 0.25 });
    }
  }

  /** Footfalls for crew on the move, softer the further off screen they are. */
  footsteps(dt: number, crew: Crew[], view: Rect | null) {
    if (!this.ctx || this.muted) return;
    crew.forEach((c, i) => {
      const s = (this.steps[i] ??= { prev: null, t: Math.random() * STRIDE });
      const moved = s.prev ? Math.hypot(c.x - s.prev.x, c.y - s.prev.y) / Math.max(dt, 1e-3) : 0;
      s.prev = { x: c.x, y: c.y };
      if (c.hp <= 0 || moved < 0.6) return;
      // Running feet land faster than walking ones.
      s.t -= dt * Math.min(2, moved / 2.2);
      if (s.t > 0) return;
      s.t = STRIDE;
      const file: Sfx = this.outdoors === 'park' ? 'step-grass' : 'step-concrete';
      this.at(`step${i}`, file, c, view, { vol: 0.22, rate: [0.9, 1.1], slice: 0.32 });
    });
  }

  /** Clicks and hovers on every menu button, wherever the HUD draws it. */
  private wireButtons() {
    addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest?.('button:not(:disabled)')) this.play('ui-click', { vol: 0.5 });
    }, true);
    addEventListener('pointerover', (e) => {
      const b = (e.target as HTMLElement).closest?.('button:not(:disabled)');
      if (b && !b.contains(e.relatedTarget as Node)) this.play('ui-hover', { vol: 0.18, gap: 0.06 });
    }, true);
  }

  private start() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);
      this.bedBus = this.ctx.createGain();
      this.bedBus.gain.value = 0.7;
      this.bedBus.connect(this.master);
      for (const name of SFX) void this.load(name);
      this.applyMix();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private load(name: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return Promise.resolve(null);
    let p = this.loading.get(name);
    if (!p) {
      const ctx = this.ctx;
      p = fetch(`${this.base}${name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${name}: ${r.status}`))))
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => {
          if (name.startsWith('step-')) this.onsets.set(name, onsets(buf));
          this.buffers.set(name, buf);
          return buf;
        })
        .catch((err) => {
          console.warn('sound', err);
          return null;
        });
      this.loading.set(name, p);
    }
    return p;
  }

  /** Fade every bed towards the current mix, starting any that are not running yet. */
  private applyMix() {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const name of BEDS) {
      const target = this.mix[name] ?? 0;
      let g = this.beds.get(name);
      if (!g && target > 0) {
        g = ctx.createGain();
        g.gain.value = 0;
        g.connect(this.bedBus);
        this.beds.set(name, g);
        const gain = g;
        void this.load(name).then((buf) => {
          if (!buf) return;
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          // Skip the encoder's silence at each end, or the loop ticks as it wraps.
          src.loopStart = Math.min(0.06, buf.duration / 4);
          src.loopEnd = buf.duration - Math.min(0.06, buf.duration / 4);
          src.connect(gain);
          // Start each bed somewhere different so the loop points never line up.
          src.start(0, src.loopStart + Math.random() * (src.loopEnd - src.loopStart));
        });
      }
      g?.gain.setTargetAtTime(target, ctx.currentTime, 1.2);
    }
  }

  /** An effect at a map point: quieter and panned when it is off to one side. */
  private at(key: string, name: Sfx, p: Vec, view: Rect | null, o: PlayOpts) {
    if (o.chance !== undefined && Math.random() > o.chance) return;
    let vol = o.vol ?? 1;
    let pan = 0;
    if (view) {
      const cx = (view.x0 + view.x1) / 2;
      const cy = (view.y0 + view.y1) / 2;
      const half = Math.max(4, Math.abs(view.x1 - view.x0) / 2);
      pan = clamp((p.x - cx) / half, -1, 1) * 0.7;
      const d = Math.hypot(p.x - cx, p.y - cy) / half;
      // Full volume on screen, fading over the next screen's width.
      vol *= d <= 1 ? 1 : Math.max(0.12, 1 - (d - 1) * 0.8);
    }
    this.play(name, { ...o, vol, pan, key });
  }

  private play(name: Sfx, o: PlayOpts & { pan?: number; key?: string } = {}) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const key = o.key ?? name;
    const now = ctx.currentTime;
    if (o.gap && now - (this.lastPlayed.get(key) ?? -1e9) < o.gap) return;
    this.lastPlayed.set(key, now);
    const buf = this.buffers.get(name);
    if (!buf) {
      void this.load(name);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (o.rate) src.playbackRate.value = o.rate[0] + Math.random() * (o.rate[1] - o.rate[0]);
    const g = ctx.createGain();
    g.gain.value = o.vol ?? 1;
    let out: AudioNode = g;
    if (o.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      g.connect(p);
      out = p;
    }
    src.connect(g);
    out.connect(this.sfxBus);
    const t = now + (o.delay ?? 0);
    if (o.slice) {
      // A single footfall out of a recording of several.
      const starts = this.onsets.get(name);
      const at = starts?.length ? starts[(Math.random() * starts.length) | 0] : Math.random() * Math.max(0, buf.duration - o.slice);
      g.gain.setValueAtTime(o.vol ?? 1, t + o.slice * 0.7);
      g.gain.linearRampToValueAtTime(0, t + o.slice);
      src.start(t, at, o.slice);
    } else src.start(t);
  }
}

interface PlayOpts {
  vol?: number;
  /** Random playback rate range, so repeats do not sound copied. */
  rate?: [number, number];
  delay?: number;
  /** Minimum seconds between two of these. */
  gap?: number;
  /** Seconds to cut from a random point of the file. */
  slice?: number;
  /** Odds of playing at all. */
  chance?: number;
}

/** Footfall starts: 10 ms windows that jump well above the ones before them. */
function onsets(buf: AudioBuffer): number[] {
  const d = buf.getChannelData(0);
  const w = Math.round(buf.sampleRate / 100);
  const rms: number[] = [];
  for (let i = 0; i + w <= d.length; i += w) {
    let sum = 0;
    for (let j = i; j < i + w; j++) sum += d[j] * d[j];
    rms.push(Math.sqrt(sum / w));
  }
  const top = Math.max(...rms);
  const out: number[] = [];
  let last = -1e9;
  for (let i = 3; i < rms.length; i++) {
    const before = (rms[i - 1] + rms[i - 2] + rms[i - 3]) / 3;
    if (rms[i] > top * 0.15 && rms[i] > before * 3 && i - last > 15) {
      out.push(Math.max(0, (i - 1) / 100));
      last = i;
    }
  }
  return out;
}

function nearestCrew(crew: Crew[], p: Vec): number {
  let best = 0;
  let bd = Infinity;
  crew.forEach((c, i) => {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bd) [best, bd] = [i, d];
  });
  return best;
}

function posOf(ev: { id: string; crew: boolean }, sim: Sim): Vec | null {
  return (ev.crew ? sim.crew[Number(ev.id) - 1] : sim.enemies.find((e) => e.id === ev.id)) ?? null;
}

function centre(view: Rect | null): Vec {
  return view ? { x: (view.x0 + view.x1) / 2, y: (view.y0 + view.y1) / 2 } : { x: 0, y: 0 };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const hash = (p: Vec) => Math.abs(Math.floor(p.x * 7 + p.y * 13));
