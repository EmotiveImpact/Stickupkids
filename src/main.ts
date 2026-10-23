// Game controller: title, planning, raid, results. Wires input, the
// simulation, the Babylon view and the HTML HUD together.

import './ui/style.css';
import { buildEstateHouse, type GoCode, type Vec } from './sim/level.ts';
import { CREW, Sim, emptyPlans, planDoors, type SimEvent, type Waypoint } from './sim/sim.ts';
import { samplePlans } from './sim/samplePlan.ts';
import { View, type PlanOverlay } from './render/view.ts';
import { Hud } from './ui/hud.ts';

type Phase = 'title' | 'planning' | 'raid' | 'results';

const level = buildEstateHouse();
const canvas = document.getElementById('game') as HTMLCanvasElement;
const view = new View(canvas, level);

let phase: Phase = 'title';
let plans: Waypoint[][] = emptyPlans(level);
let version = 1;
let selected = 1;
let selectedWp: number | null = null;
let hover: Vec | null = null;
let preview = new Sim(level, plans);
let sim = preview;
let paused = false;
let speed = 1;
let replanBuf = new Map<number, Waypoint[]>();
let dragging: { kind: 'draw' } | { kind: 'move'; idx: number } | null = null;

const hud = new Hud(document.getElementById('hud')!, {
  selectCrew: (slot) => selectCrew(slot),
  tool: (t) => tool(t),
  code: (c) => code(c),
  go: () => go(),
  pause: () => togglePause(),
  speed: () => toggleSpeed(),
  driveOff: () => sim.driveOff(),
  start: (sample) => startPlanning(sample),
  replan: (fresh) => {
    hud.hideOverlay();
    if (fresh) plans = emptyPlans(level);
    enterPlanning();
  },
});

function changed() {
  version++;
  preview = new Sim(level, plans);
  if (phase === 'planning') sim = preview;
}

function startPlanning(sample: boolean) {
  hud.hideOverlay();
  if (sample) plans = samplePlans();
  enterPlanning();
}

function enterPlanning() {
  phase = 'planning';
  paused = false;
  selectedWp = null;
  changed();
  sim = preview;
  view.setMode('planning');
}

function go() {
  if (phase !== 'planning') return;
  phase = 'raid';
  sim = new Sim(level, plans, (Math.random() * 1e9) | 0);
  view.bind(sim);
  view.setMode('raid');
  paused = false;
  replanBuf = new Map();
  selectedWp = null;
}

function selectCrew(slot: number) {
  selected = slot;
  selectedWp = null;
  version++;
}

function currentWp(): Waypoint | null {
  const plan = plans[selected - 1];
  if (selectedWp !== null && plan[selectedWp]) return plan[selectedWp];
  return plan[plan.length - 1] ?? null;
}

function tool(t: 'kick' | 'undo' | 'clear' | 'sample') {
  if (phase !== 'planning') return;
  const plan = plans[selected - 1];
  if (t === 'kick') {
    const w = currentWp();
    if (w) w.kick = !w.kick;
  } else if (t === 'undo') {
    const idx = selectedWp ?? plan.length - 1;
    if (idx > 0) plan.splice(idx, 1);
    selectedWp = null;
  } else if (t === 'clear') {
    plan.splice(1);
    selectedWp = null;
  } else if (t === 'sample') {
    plans = samplePlans();
    selectedWp = null;
  }
  changed();
}

function code(c: GoCode) {
  if (phase === 'planning') {
    const w = currentWp();
    if (w) w.hold = w.hold === c ? null : c;
    changed();
  } else if (phase === 'raid') {
    sim.callCode(c);
    hud.toast(`Go code ${c} called`, CREW[0].color);
  }
}

function togglePause() {
  if (phase !== 'raid') return;
  paused = !paused;
  if (!paused) replanBuf = new Map();
  view.setPaused(paused);
}

function toggleSpeed() {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
}

// ------------------------------------------------------------------ input

const near = (a: Vec, b: Vec, r: number) => Math.hypot(a.x - b.x, a.y - b.y) < r;
const cellCentre = (p: Vec): Vec => ({ x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 });

function reachable(from: Vec, to: Vec) {
  return !!preview.grid.findPath(from.x, from.y, to.x, to.y, 'plan');
}

function addPoint(p: Vec): boolean {
  const plan = plans[selected - 1];
  const c = cellCentre(p);
  const insertAt = selectedWp !== null ? selectedWp + 1 : plan.length;
  const prev = plan[insertAt - 1];
  if (near(prev, c, 0.1) || !reachable(prev, c)) return false;
  plan.splice(insertAt, 0, { ...c, hold: null, kick: false });
  selectedWp = insertAt === plan.length - 1 ? null : insertAt;
  changed();
  return true;
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 1) return;
  const p = view.pick(e.clientX, e.clientY);
  if (!p) return;
  if (phase === 'planning') {
    if (e.button === 2) {
      tool('undo');
      return;
    }
    // Clicking a crew member selects them.
    for (let i = 0; i < plans.length; i++) {
      if (near(plans[i][0], p, 0.55) && i + 1 !== selected) {
        selectCrew(i + 1);
        return;
      }
    }
    // Clicking an existing waypoint selects it (and lets you drag it).
    const plan = plans[selected - 1];
    for (let k = plan.length - 1; k >= 1; k--) {
      if (near(plan[k], p, 0.45)) {
        selectedWp = k;
        dragging = { kind: 'move', idx: k };
        version++;
        return;
      }
    }
    if (addPoint(p)) dragging = { kind: 'draw' };
    canvas.setPointerCapture(e.pointerId);
  } else if (phase === 'raid') {
    for (const c of sim.crew) {
      if (near(c, p, 0.6)) {
        selectCrew(c.def.slot);
        return;
      }
    }
    if (!paused) {
      hud.toast('Pause (Space) to redraw a route');
      return;
    }
    const c = sim.crew[selected - 1];
    if (c.state === 'down' || c.state === 'escaped') return;
    const buf = replanBuf.get(selected) ?? [];
    const from = buf.length ? buf[buf.length - 1] : c;
    const cc = cellCentre(p);
    if (!sim.grid.findPath(from.x, from.y, cc.x, cc.y, 'crew')) return;
    buf.push({ ...cc, hold: null, kick: false });
    replanBuf.set(selected, buf);
    sim.replan(selected, buf);
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = view.pick(e.clientX, e.clientY);
  hover = p;
  if (!p || !dragging || phase !== 'planning') return;
  const plan = plans[selected - 1];
  if (dragging.kind === 'draw') {
    const last = plan[selectedWp ?? plan.length - 1];
    if (Math.hypot(last.x - p.x, last.y - p.y) >= 2.2) addPoint(p);
  } else {
    const c = cellCentre(p);
    const w = plan[dragging.idx];
    if (!near(w, c, 0.1) && preview.grid.passable(Math.floor(c.x), Math.floor(c.y), 'plan')) {
      w.x = c.x;
      w.y = c.y;
      changed();
    }
  }
});

window.addEventListener('pointerup', () => (dragging = null));

window.addEventListener('keydown', (e) => {
  if (phase === 'title' || phase === 'results') return;
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '4') selectCrew(Number(k));
  else if (k === 'a' || k === 'b' || k === 'c') code(k.toUpperCase() as GoCode);
  else if (k === 'k') tool('kick');
  else if (k === 'backspace' || k === 'delete') tool('undo');
  else if (k === 'escape') {
    selectedWp = null;
    version++;
  } else if (k === 'enter') go();
  else if (k === ' ') {
    togglePause();
    e.preventDefault();
  } else if (k === 'f') toggleSpeed();
  else if (k === 'v' && phase === 'raid') sim.driveOff();
});

window.addEventListener('resize', () => view.resize());

// Camera: wheel or pinch to zoom, middle-drag or arrow keys to pan.
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    view.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  },
  { passive: false },
);
let panning: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 1) return;
  panning = { x: e.clientX, y: e.clientY };
  e.preventDefault();
});
window.addEventListener('pointermove', (e) => {
  if (!panning) return;
  view.panBy(e.clientX - panning.x, e.clientY - panning.y);
  panning = { x: e.clientX, y: e.clientY };
});
window.addEventListener('pointerup', (e) => {
  if (e.button === 1) panning = null;
});
const PAN_KEYS: Record<string, [number, number]> = { arrowleft: [1, 0], arrowright: [-1, 0], arrowup: [0, 1], arrowdown: [0, -1] };
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (PAN_KEYS[k]) {
    view.panBy(PAN_KEYS[k][0] * 60, PAN_KEYS[k][1] * 60);
    e.preventDefault();
  } else if (k === '=' || k === '+') view.zoomAt(innerWidth / 2, innerHeight / 2, 1.2);
  else if (k === '-') view.zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.2);
});

// -------------------------------------------------------------- main loop

const NAMES: Record<string, string> = Object.fromEntries(level.enemies.map((e) => [e.id, e.name]));

function narrate(events: SimEvent[]) {
  for (const ev of events) {
    if (ev.type === 'alert') hud.toast(`${NAMES[ev.id] ?? 'Backup'} has clocked you`, '#FF3B4E');
    else if (ev.type === 'surrender') hud.toast(`${NAMES[ev.id] ?? 'Backup'} gives up`, '#ffffff');
    else if (ev.type === 'loot') {
      const l = level.loot.find((x) => x.id === ev.id)!;
      hud.toast(`${CREW[ev.slot - 1].name} bagged ${l.name.toLowerCase()}`, '#3DFFA2');
    } else if (ev.type === 'backup') hud.toast('Their backup has turned up at the back gate', '#FF3B4E');
    else if (ev.type === 'reveal') hud.toast('Back bedroom scouted', '#ffffff');
    else if (ev.type === 'down') hud.toast(ev.crew ? `${CREW[Number(ev.id) - 1].name} is down` : `${NAMES[ev.id] ?? 'Backup'} is down`, ev.crew ? '#FF3B4E' : '#ffffff');
  }
}

let last = performance.now();
let hudT = 0;
const STEP = 1 / 60;
let acc = 0;

function tick(dt: number) {
  if (phase === 'raid' && !paused && !sim.outcome) {
    acc += dt * speed;
    while (acc >= STEP) {
      sim.step(STEP);
      acc -= STEP;
    }
  }
  const events = sim.events;
  sim.events = [];
  if (phase === 'raid') {
    view.handleEvents(events);
    narrate(events);
  }
  const overlay: PlanOverlay = { plans, version, selected, selectedWp, hover };
  view.bind(sim);
  view.frame(dt, sim, phase === 'planning' || phase === 'title' ? overlay : { ...overlay, hover: null });
  hudT -= dt;
  if (hudT <= 0) {
    hudT = 0.1;
    if (phase === 'planning' || phase === 'title') {
      const d = planDoors(level, preview.grid, plans);
      hud.updatePlanning({ plans, selected, selectedWp, kicks: d.kicks, picks: d.picks });
    } else if (phase === 'raid') hud.updateRaid(sim, paused, speed, selected);
  }
  if (phase === 'raid' && sim.outcome) {
    phase = 'results';
    setTimeout(() => hud.showResults(sim.outcome!, sim), 900);
  }
}

view.engine.runRenderLoop(() => {
  const now = performance.now();
  tick(Math.min(0.1, (now - last) / 1000));
  last = now;
});

hud.showTitle();
view.setMode('planning');

// Hooks for headless tests and screenshots.
const api = {
  get phase() {
    return phase;
  },
  get sim() {
    return sim;
  },
  get plans() {
    return plans;
  },
  get paused() {
    return paused;
  },
  /** Screen position of a map point, for driving the mouse in tests. */
  toScreen(x: number, y: number) {
    return view.toScreen(x, y);
  },
  start: startPlanning,
  go,
  code,
  pause: togglePause,
  select: selectCrew,
  selectWp(k: number | null) {
    selectedWp = k;
    version++;
  },
  hover(p: Vec | null) {
    hover = p;
  },
  /** Fast-forward the raid by simulated seconds, calling codes on the way. */
  advance(seconds: number, codes: [number, GoCode][] = []) {
    const end = sim.time + seconds;
    while (sim.time < end && !sim.outcome) {
      for (const [t, c] of codes) if (sim.time < t && sim.time + STEP >= t) sim.callCode(c);
      sim.step(STEP);
    }
  },
};
(window as unknown as { __game: typeof api; __ready: boolean }).__game = api;

const q = new URLSearchParams(location.search);
if (q.get('auto')) {
  startPlanning(true);
  const auto = q.get('auto')!;
  if (auto !== 'planning') {
    go();
    api.advance(Number(q.get('t') ?? 12), [[5, 'A'], [20, 'B']]);
    if (q.get('pause')) togglePause();
  }
}
view.ready.then(() => {
  // ?zoom=2.5&at=0.3,0.6 zooms on a point given as a share of the screen (for close-up screenshots).
  if (q.get('zoom')) {
    const [fx, fy] = (q.get('at') ?? '0.5,0.5').split(',').map(Number);
    view.zoomAt(innerWidth * fx, innerHeight * fy, Number(q.get('zoom')));
  }
  hud.loaded();
  (window as unknown as { __ready: boolean }).__ready = true;
});
