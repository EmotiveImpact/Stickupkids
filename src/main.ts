// Game controller: title, planning, raid, results. Wires input, the
// simulation, the Babylon view and the HTML HUD together.

import './ui/style.css';
import type { GoCode, Level, Vec } from './sim/level.ts';
import { JOBS, jobById, type Job } from './sim/jobs.ts';
import { CREW, Sim, emptyPlans, planDoors, type SimEvent, type Waypoint } from './sim/sim.ts';
import { View, createEngine, type PlanOverlay } from './render/view.ts';
import { Hud } from './ui/hud.ts';
import { Minimap } from './ui/minimap.ts';

type Phase = 'title' | 'planning' | 'raid' | 'results';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = createEngine(canvas);
let job: Job = jobById(q.get('job'));
let level: Level = job.build();
let view = new View(engine, level, `models/${job.id}/`);

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
/** Crew members whose route has been redrawn during this pause. */
let touched = new Set<number>();
/** The crew member who takes a live order on the next click on the map. */
let armed: number | null = null;
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
  pickJob: (id) => pickJob(id),
  jobs: () => showJobs(),
});

const minimap = new Minimap(document.getElementById('hud')!, (x, y) => view.focus(x, y));

/** A big level opens close in on the crew, with the overview map beside it. */
function frameLevel() {
  minimap.setLevel(view.big ? level : null);
  hud.big = view.big;
  if (!view.big) return;
  const s = level.crewStarts;
  view.focus(s.reduce((a, c) => a + c.x, 0) / s.length - 12, s.reduce((a, c) => a + c.y, 0) / s.length, 28);
}

/** Swap the level under the game for another job's. */
function pickJob(id: string) {
  const next = jobById(id);
  hud.selectJob(next.id);
  if (next === job) return;
  job = next;
  view.dispose();
  level = job.build();
  names = namesOf(level);
  view = new View(engine, level, `models/${job.id}/`);
  frameLevel();
  plans = emptyPlans(level);
  selected = 1;
  selectedWp = null;
  changed();
  sim = preview;
  view.setMode('planning');
  hud.setJob(job);
  watchLoading();
}

/** Back to the job board, keeping the current job picked. */
function showJobs() {
  phase = 'title';
  paused = false;
  sim = preview;
  view.setMode('planning');
  hud.showTitle(JOBS, job.id);
}

let firstLoad = true;
function watchLoading() {
  hud.loaded(false);
  const v = view;
  v.ready.then(
    () => {
      if (v !== view) return;
      if (firstLoad) {
        firstLoad = false;
        // ?zoom=2.5&at=0.3,0.6 zooms on a point given as a share of the screen (for close-up screenshots).
        if (q.get('zoom')) {
          const [fx, fy] = (q.get('at') ?? '0.5,0.5').split(',').map(Number);
          view.zoomAt(innerWidth * fx, innerHeight * fy, Number(q.get('zoom')));
        }
        // ?focus=90,115,30 centres on a map point at 30 pixels a metre (big levels).
        if (q.get('focus')) {
          const [fx, fy, ppm] = q.get('focus')!.split(',').map(Number);
          view.focus(fx, fy, ppm || undefined);
        }
      }
      hud.loaded();
      (window as unknown as { __ready: boolean }).__ready = true;
    },
    (err) => {
      // A level dropped half-way through loading does not matter.
      if (v === view) throw err;
    },
  );
}

function changed() {
  version++;
  preview = new Sim(level, plans);
  if (phase === 'planning') sim = preview;
}

function startPlanning(sample: boolean) {
  hud.hideOverlay();
  if (sample) plans = job.samplePlans();
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
  touched = new Set();
  armed = null;
  selectedWp = null;
}

function selectCrew(slot: number) {
  // Picking the one already picked brings the camera to them.
  if (slot === selected && view.big) {
    const c = phase === 'raid' || phase === 'results' ? sim.crew[slot - 1] : (currentWp() ?? plans[slot - 1][0]);
    view.focus(c.x, c.y);
  }
  selected = slot;
  selectedWp = null;
  // Mid-raid, picking someone readies an order: the next click on the map sends them there.
  armed = phase === 'raid' && !paused && alive(slot) ? slot : null;
  version++;
}

function currentWp(): Waypoint | null {
  const plan = plans[selected - 1];
  if (selectedWp !== null && plan[selectedWp]) return plan[selectedWp];
  return plan[plan.length - 1] ?? null;
}

function tool(t: 'kick' | 'undo' | 'clear' | 'sample') {
  if (phase === 'raid' && paused) {
    if (t === 'kick') {
      order((o) => {
        const k = selectedWp ?? o.length - 1;
        o[k].kick = !o[k].kick;
        return true;
      });
    } else if (t === 'undo') removeOrderPoint();
    return;
  }
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
    plans = job.samplePlans();
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
    // Paused with one of their points picked: hold there for the code.
    if (paused && selectedWp !== null) {
      order((o) => {
        const w = o[selectedWp!];
        if (!w) return false;
        w.hold = w.hold === c ? null : c;
        return true;
      });
      return;
    }
    sim.callCode(c);
    hud.toast(`Go code ${c} called`, CREW[0].color);
  }
}

function togglePause() {
  if (phase !== 'raid') return;
  paused = !paused;
  touched = new Set();
  armed = null;
  selectedWp = null;
  // Rewrite everyone's plan as orders from where they stand, so the points
  // drawn and the points picked share their numbering. It changes nothing
  // about where they go.
  if (paused) for (const c of sim.crew) if (alive(c.def.slot)) sim.setOrders(c.def.slot, sim.orders(c.def.slot));
  version++;
  view.setPaused(paused);
}

// ------------------------------------------------------- orders mid-raid

function alive(slot: number) {
  const c = sim.crew[slot - 1];
  return !!c && c.state !== 'down' && c.state !== 'escaped';
}

/** Change the selected crew member's orders mid-raid. Orders start where
 *  they stand (index 0), so a picked point keeps its index while paused. */
function order(fn: (o: Waypoint[]) => boolean): boolean {
  if (!alive(selected)) return false;
  const o = sim.orders(selected);
  if (!fn(o)) return false;
  sim.setOrders(selected, o);
  version++;
  return true;
}

/** Add a point to the selected crew member's orders: after the picked point,
 *  or at the end. A fresh order drops the rest of the route and starts from
 *  where they stand. */
function orderPoint(p: Vec, fresh: boolean): boolean {
  return order((o) => {
    if (fresh) {
      o.splice(1);
      o[0].hold = null;
      o[0].kick = false;
    }
    const c = cellCentre(p);
    const at = !fresh && selectedWp !== null ? selectedWp + 1 : o.length;
    const prev = o[at - 1];
    if (near(prev, c, 0.1) || !sim.grid.findPath(prev.x, prev.y, c.x, c.y, 'crew')) return false;
    o.splice(at, 0, { ...c, hold: null, kick: false });
    selectedWp = paused && at < o.length - 1 ? at : null;
    return true;
  });
}

function removeOrderPoint() {
  order((o) => {
    const k = selectedWp ?? o.length - 1;
    if (k < 1) return false;
    o.splice(k, 1);
    selectedWp = null;
    return true;
  });
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
  } else if (phase === 'raid' && !sim.outcome) {
    if (e.button === 2) {
      if (paused) removeOrderPoint();
      return;
    }
    // Clicking a crew member picks them (and, while the raid runs, readies an order).
    for (const c of sim.crew) {
      if (c.state !== 'down' && c.state !== 'escaped' && near(c, p, 0.6)) {
        selectCrew(c.def.slot);
        return;
      }
    }
    if (!alive(selected)) return;
    if (paused) {
      // One of their points: pick it, and drag to move it.
      const o = sim.orders(selected);
      for (let k = o.length - 1; k >= 1; k--) {
        if (near(o[k], p, 0.45)) {
          selectedWp = k;
          dragging = { kind: 'move', idx: k };
          version++;
          return;
        }
      }
      // The first click in a pause redraws their route from where they stand.
      if (orderPoint(p, !touched.has(selected) && selectedWp === null)) {
        touched.add(selected);
        dragging = { kind: 'draw' };
      }
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (armed !== selected) {
      hud.toast('Click a crew member, then where they should go. Space pauses to redraw routes.');
      return;
    }
    // A live order: off they go from where they stand. Drag to draw a route.
    armed = null;
    if (orderPoint(p, true)) {
      dragging = { kind: 'draw' };
      canvas.setPointerCapture(e.pointerId);
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = view.pick(e.clientX, e.clientY);
  hover = p;
  if (!p || !dragging) return;
  if (phase === 'raid') {
    if (dragging.kind === 'draw') {
      const o = sim.orders(selected);
      const last = o[selectedWp ?? o.length - 1];
      if (last && Math.hypot(last.x - p.x, last.y - p.y) >= 2.2) orderPoint(p, false);
    } else if (paused) {
      const idx = dragging.idx;
      const c = cellCentre(p);
      order((o) => {
        const w = o[idx];
        if (!w || near(w, c, 0.1) || !sim.grid.passable(Math.floor(c.x), Math.floor(c.y), 'crew')) return false;
        w.x = c.x;
        w.y = c.y;
        return true;
      });
    }
    return;
  }
  if (phase !== 'planning') return;
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
    armed = null;
    version++;
  } else if (k === 'enter') go();
  else if (k === ' ') {
    togglePause();
    e.preventDefault();
  } else if (k === 'f') toggleSpeed();
  else if (k === 'v' && phase === 'raid') sim.driveOff();
});

window.addEventListener('resize', () => view.resize());

// Camera: a mouse wheel or a pinch zooms, two fingers on a trackpad pan,
// as do middle-drag and the arrow keys.
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (!e.ctrlKey && isTrackpad(e)) view.panBy(-e.deltaX, -e.deltaY);
    else view.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  },
  { passive: false },
);

/** Trackpad scrolls come in pixels and, in Chrome and Safari, with no
 *  mouse-wheel notch behind them (wheelDeltaY is a multiple of 120 for a
 *  mouse). Sideways movement only ever comes from a trackpad. */
function isTrackpad(e: WheelEvent): boolean {
  if (e.deltaMode !== 0) return false;
  if (e.deltaX !== 0) return true;
  const wd = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  if (wd === undefined) return Math.abs(e.deltaY) < 50 && !Number.isInteger(e.deltaY);
  return wd !== 0 && wd % 120 !== 0;
}
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

const namesOf = (lv: Level): Record<string, string> => Object.fromEntries(lv.enemies.map((e) => [e.id, e.name]));
let names = namesOf(level);

function narrate(events: SimEvent[]) {
  for (const ev of events) {
    if (ev.type === 'alert') hud.toast(`${names[ev.id] ?? 'Backup'} has clocked you`, '#FF3B4E');
    else if (ev.type === 'surrender') hud.toast(`${names[ev.id] ?? 'Backup'} gives up`, '#ffffff');
    else if (ev.type === 'loot') {
      const l = level.loot.find((x) => x.id === ev.id)!;
      hud.toast(`${CREW[ev.slot - 1].name} bagged ${lower(l.name)}`, '#3DFFA2');
    } else if (ev.type === 'backup') hud.toast(`Their backup has turned up at ${level.backup.place}`, '#FF3B4E');
    else if (ev.type === 'reveal') hud.toast(`${level.rooms.find((r) => r.id === ev.room)?.name ?? 'Room'} scouted`, '#ffffff');
    else if (ev.type === 'down') hud.toast(ev.crew ? `${CREW[Number(ev.id) - 1].name} is down` : `${names[ev.id] ?? 'Backup'} is down`, ev.crew ? '#FF3B4E' : '#ffffff');
  }
}

/** Lower-case the first letter only, so place names keep their capitals. */
const lower = (s: string) => s[0].toLowerCase() + s.slice(1);

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
  const aiming = phase === 'planning' || phase === 'title' || (phase === 'raid' && (paused || armed !== null));
  view.frame(dt, sim, aiming ? overlay : { ...overlay, hover: null });
  hudT -= dt;
  if (hudT <= 0) {
    hudT = 0.1;
    minimap.show(phase === 'planning' || phase === 'raid');
    minimap.draw(sim, view.visibleRect(), CREW.map((c) => c.color));
    if (phase === 'planning' || phase === 'title') {
      const d = planDoors(level, preview.grid, plans);
      hud.updatePlanning({ plans, selected, selectedWp, kicks: d.kicks, picks: d.picks });
    } else if (phase === 'raid') {
      const wp = paused && selectedWp !== null ? (sim.orders(selected)[selectedWp] ?? null) : null;
      hud.updateRaid(sim, paused, speed, selected, { point: wp ? selectedWp : null, hold: wp?.hold ?? null, armed: armed !== null });
    }
  }
  if (phase === 'raid' && sim.outcome) {
    phase = 'results';
    setTimeout(() => hud.showResults(sim.outcome!, sim), 900);
  }
}

engine.runRenderLoop(() => {
  const now = performance.now();
  tick(Math.min(0.1, (now - last) / 1000));
  last = now;
});

hud.setJob(job);
hud.showTitle(JOBS, job.id);
view.setMode('planning');
frameLevel();
watchLoading();

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
  pickJob,
  get job() {
    return job.id;
  },
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

if (q.get('auto')) {
  startPlanning(true);
  const auto = q.get('auto')!;
  if (auto !== 'planning') {
    go();
    api.advance(Number(q.get('t') ?? 12), job.sampleCodes);
    if (q.get('pause')) togglePause();
  }
}
