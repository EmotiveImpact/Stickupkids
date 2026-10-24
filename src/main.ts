// Game controller: title, planning, raid, results. Wires input, the
// simulation, the Babylon view and the HTML HUD together.

import './ui/style.css';
import type { GoCode, Level, Vec } from './sim/level.ts';
import { JOBS, artOf, jobById, type Job } from './sim/jobs.ts';
import { CREW, Sim, emptyPlans, planDoors, type SimEvent, type Waypoint } from './sim/sim.ts';
import { Replay, record, type Recording } from './sim/replay.ts';
import { View, createEngine, type PlanOverlay } from './render/view.ts';
import { Director } from './render/director.ts';
import { ClipRecorder, saveFile } from './render/clip.ts';
import { Hud, type ReplayAction } from './ui/hud.ts';
import { Minimap } from './ui/minimap.ts';

type Phase = 'title' | 'planning' | 'raid' | 'results' | 'replay';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = createEngine(canvas);
let job: Job = jobById(q.get('job'));
let level: Level = job.build();
let view = new View(engine, level, artOf(job));

let phase: Phase = 'title';
let plans: Waypoint[][] = emptyPlans(level);
/** They Slid: the doors braced before they come. */
let barricades: Vec[] = [];
let version = 1;
let selected = 1;
let selectedWp: number | null = null;
let hover: Vec | null = null;
let preview = new Sim(level, plans, 7, barricades);
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
    if (fresh) {
      plans = emptyPlans(level);
      barricades = [];
    }
    enterPlanning();
  },
  pickJob: (id) => pickJob(id),
  jobs: () => showJobs(),
  replay: (a) => replayAction(a),
});

const minimap = new Minimap(document.getElementById('hud')!, (x, y) => view.focus(x, y));

/** A big level opens close in on the crew, with the overview map beside it. */
function frameLevel() {
  minimap.setLevel(view.big ? level : null);
  hud.big = view.big;
  if (!view.big) return;
  const s = level.crewStarts;
  const posts = level.enemies.flatMap((e) => (e.story ? [e.story] : []));
  if (posts.length) {
    // A ride out: take in the whip and every pin, so the plan starts from what Jojo has seen.
    const pts = [...s, ...posts];
    const x0 = Math.min(...pts.map((p) => p.x)) - 6;
    const x1 = Math.max(...pts.map((p) => p.x)) + 6;
    const y0 = Math.min(...pts.map((p) => p.y)) - 6;
    const y1 = Math.max(...pts.map((p) => p.y)) + 10;
    // The story panel takes the right-hand side.
    const panel = innerWidth < 900 ? 220 : 300;
    const ppm = Math.min(28, Math.max(8, Math.min((innerWidth - 280 - panel) / (x1 - x0), (innerHeight - 160) / ((y1 - y0) * 0.81))));
    view.focus((x0 + x1) / 2 + panel / 2 / ppm, (y0 + y1) / 2, ppm);
    return;
  }
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
  view = new View(engine, level, artOf(job));
  frameLevel();
  plans = emptyPlans(level);
  barricades = [];
  selected = 1;
  selectedWp = null;
  changed();
  sim = preview;
  view.setMode('planning');
  hud.setJob(job);
  watchLoading();
}

// ----------------------------------------------------------------- replay

/** The last raid, as it ended, and what it takes to play it again. */
let finished: Sim | null = null;
let recording: Recording | null = null;
let replay: Replay | null = null;
let replayPlaying = true;
let replaySpeed = 1;
/** The camera follows the action until the viewer moves it themselves. */
let follow = true;
const director = new Director();
let clip: ClipRecorder | null = null;
let clipT = 0;
let clipSpeed = 1;
let clipInsets: ReturnType<View['getInsets']> | null = null;
/** A clip runs the raid fast enough to fit in about this many seconds. */
const CLIP_RAID = 38;
/** Seconds on the job's name before the raid starts moving in a clip. */
const CLIP_LEAD = 1;
/** Seconds on the payout at the end of a clip. */
const CLIP_TAIL = 3.2;

function replayAction(a: ReplayAction) {
  if (a === 'watch') watchReplay();
  else if (phase !== 'replay' || !replay || clip) return;
  else if (a === 'play') {
    if (replay.done) restartReplay();
    else replayPlaying = !replayPlaying;
  } else if (a === 'restart') restartReplay();
  else if (a === 'speed') replaySpeed = replaySpeed === 1 ? 2 : replaySpeed === 2 ? 4 : 1;
  else if (a === 'follow') follow = !follow;
  else if (a === 'clip') void startClip();
  else if (a === 'back') leaveReplay();
}

function watchReplay() {
  if (!recording || !finished) return;
  phase = 'replay';
  hud.hideOverlay();
  view.setReveal(true);
  view.setMode('raid');
  view.setPaused(false);
  follow = true;
  replaySpeed = 1;
  restartReplay();
}

function restartReplay() {
  replay = new Replay(level, recording!);
  sim = replay.sim;
  view.bind(sim);
  director.reset();
  replayPlaying = true;
  acc = 0;
}

function leaveReplay() {
  cancelClip();
  view.setReveal(false);
  replay = null;
  sim = finished!;
  view.bind(sim);
  phase = 'results';
  hud.showResults(finished!.outcome!, finished!);
}

/** Record the replay from the start as a 9:16 clip. */
let clipStarting = false;
async function startClip() {
  if (!recording || clipStarting || !ClipRecorder.supported()) return;
  clipStarting = true;
  // The clip draws its words in the game's fonts.
  await Promise.all([document.fonts.load('700 40px Rajdhani'), document.fonts.load('600 40px Inter')]).catch(() => null);
  clipStarting = false;
  if (phase !== 'replay') return;
  restartReplay();
  follow = true;
  clipInsets = view.getInsets();
  hud.showRecording(true, cancelClip);
  view.setInsets({ left: 0, right: 0, top: 0, bottom: 0 });
  clip = new ClipRecorder(canvas, { title: job.title, place: job.place });
  clipSpeed = Math.min(4, Math.max(1, (recording.ticks * recording.dt) / CLIP_RAID));
  clipT = 0;
  clip.start();
}

function clipFrame(dt: number) {
  if (!clip || !replay) return;
  clip.frame(dt);
  clipT += dt;
  hud.recordingTime(clip.seconds);
  const o = replay.sim.outcome;
  if (replay.done && !clip.ending && o) {
    const m = Math.floor(o.time / 60);
    const line = `${REASONS[o.reason]} · ${m}:${String(Math.floor(o.time % 60)).padStart(2, '0')}`;
    const money = (n: number) => '£' + n.toLocaleString('en-GB');
    if (o.mode === 'rideout') clip.finish({ head: 'CAUGHT', total: `${o.caught} OF ${o.targets}`, line });
    else if (o.mode === 'slid') clip.finish({ head: o.reason === 'robbed' ? 'THEY TOOK IT ALL' : 'HELD IT DOWN', total: money(o.kept), line });
    else clip.finish({ total: money(o.payout.total), line });
  }
  if (clip.ending > CLIP_TAIL) void finishClip();
}

async function finishClip() {
  const c = clip!;
  clip = null;
  const blob = await c.stop();
  endClipView();
  replayPlaying = false;
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  hud.showClip(
    url,
    { seconds: c.seconds, mb: blob.size / 1e6, ext: c.ext },
    () => saveFile(`stickupkids-${job.id}-${stamp}.${c.ext}`, blob),
    () => URL.revokeObjectURL(url),
  );
}

function cancelClip() {
  if (!clip) return;
  clip.cancel();
  clip = null;
  endClipView();
}

function endClipView() {
  hud.showRecording(false);
  if (clipInsets) view.setInsets(clipInsets);
  clipInsets = null;
}

/** Back to the job board, keeping the current job picked. */
function showJobs() {
  phase = 'title';
  paused = false;
  view.setReveal(false);
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
  preview = new Sim(level, plans, 7, barricades);
  if (phase === 'planning') sim = preview;
}

function startPlanning(sample: boolean) {
  hud.hideOverlay();
  if (sample) loadSample();
  enterPlanning();
}

function loadSample() {
  plans = job.samplePlans();
  barricades = (job.sampleBarricades ?? []).map((b) => ({ ...b }));
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
  view.setReveal(false);
  sim = new Sim(level, plans, (Math.random() * 1e9) | 0, barricades);
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
    loadSample();
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

function toggleBarricade(x: number, y: number, name: string) {
  const i = barricades.findIndex((b) => b.x === x && b.y === y);
  const max = level.barricades ?? 0;
  if (i >= 0) barricades.splice(i, 1);
  else if (barricades.length >= max) {
    hud.toast(`Only ${max} barricades. Click a braced door to take its barricade off.`);
    return;
  } else {
    // Nobody can be standing in a doorway that is being braced.
    const blocked = plans.some((plan) => plan.some((w) => Math.floor(w.x) === x && Math.floor(w.y) === y));
    if (blocked) {
      hud.toast('Someone is routed through that door. Move them first.');
      return;
    }
    barricades.push({ x, y });
    hud.toast(`${name} barricaded`, CREW[0].color);
  }
  changed();
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
    // They Slid: clicking a door braces it, or takes the brace off.
    if (level.mode === 'slid') {
      const d = level.doors.find((dd) => near({ x: dd.x + 0.5, y: dd.y + 0.5 }, p, 0.75));
      if (d) {
        toggleBarricade(d.x, d.y, d.name);
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
  const k = e.key.toLowerCase();
  if (phase === 'replay') {
    if (k === ' ') {
      replayAction('play');
      e.preventDefault();
    } else if (k === 'f') replayAction('speed');
    else if (k === 'escape') replayAction('back');
    return;
  }
  if (phase === 'title' || phase === 'results') return;
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
    if (phase === 'replay') follow = false;
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
  // Middle-drag pans; in a replay, so does an ordinary drag.
  if (e.button !== 1 && !(phase === 'replay' && e.button === 0)) return;
  panning = { x: e.clientX, y: e.clientY };
  e.preventDefault();
});
window.addEventListener('pointermove', (e) => {
  if (!panning) return;
  if (phase === 'replay' && !clip) follow = false;
  view.panBy(e.clientX - panning.x, e.clientY - panning.y);
  panning = { x: e.clientX, y: e.clientY };
});
window.addEventListener('pointerup', (e) => {
  if (e.button === 1 || phase === 'replay') panning = null;
});
const PAN_KEYS: Record<string, [number, number]> = { arrowleft: [1, 0], arrowright: [-1, 0], arrowup: [0, 1], arrowdown: [0, -1] };
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (PAN_KEYS[k]) {
    if (phase === 'replay') follow = false;
    view.panBy(PAN_KEYS[k][0] * 60, PAN_KEYS[k][1] * 60);
    e.preventDefault();
  } else if (k === '=' || k === '+') view.zoomAt(innerWidth / 2, innerHeight / 2, 1.2);
  else if (k === '-') view.zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.2);
});

// -------------------------------------------------------------- main loop

const namesOf = (lv: Level): Record<string, string> => Object.fromEntries(lv.enemies.map((e) => [e.id, e.name]));
let names = namesOf(level);

/** A note on what just happened: a toast, and a caption when a clip is recording. */
function note(text: string, colour = '#ffffff') {
  hud.toast(text, colour);
  clip?.caption(text, colour);
}

function narrate(events: SimEvent[]) {
  for (const ev of events) {
    if (ev.type === 'alert') note(`${names[ev.id] ?? 'Backup'} has clocked you`, '#FF3B4E');
    else if (ev.type === 'surrender') note(`${names[ev.id] ?? 'Backup'} gives up`, '#ffffff');
    else if (ev.type === 'loot') {
      const l = level.loot.find((x) => x.id === ev.id)!;
      note(`${CREW[ev.slot - 1].name} bagged ${lower(l.name)}`, '#3DFFA2');
    } else if (ev.type === 'backup') {
      if (level.mode === 'rideout') note(`The park has woken up. Their side are coming from ${level.backup.place}`, '#FF3B4E');
      else note(`Their backup has turned up at ${level.backup.place}`, '#FF3B4E');
    } else if (ev.type === 'caught') note(`Caught the ${lower(names[ev.id])}`, CREW[0].color);
    else if (ev.type === 'post') note(`The ${lower(names[ev.id])} just posted. Jojo's dropped a pin`, CREW[2].color);
    else if (ev.type === 'wave') note(ev.n === 1 ? `They're here: ${ev.place}` : `More of them: ${ev.place}`, '#FF3B4E');
    else if (ev.type === 'ramming') note(`They're on the ${lower(level.doors.find((d) => d.x === ev.x && d.y === ev.y)?.name ?? 'door')}`, '#FF3B4E');
    else if (ev.type === 'backOff') note("They've had enough. They're backing off", CREW[0].color);
    else if (ev.type === 'reveal') note(`${level.rooms.find((r) => r.id === ev.room)?.name ?? 'Room'} scouted`, '#ffffff');
    else if (ev.type === 'down') {
      const civvy = !ev.crew && level.enemies.find((e) => e.id === ev.id)?.kind === 'civilian';
      if (civvy) note(`The ${lower(names[ev.id])} has been hit. Nobody touches normal people`, '#ffffff');
      else note(ev.crew ? `${CREW[Number(ev.id) - 1].name} is down` : `${names[ev.id] ?? 'Backup'} is down`, ev.crew ? '#FF3B4E' : '#ffffff');
    } else if (ev.type === 'standoff') note(`${names[ev.id]} wants to talk. Get Taz on him before he runs out of patience`, CREW[3].color);
    else if (ev.type === 'calling') note(`The ${lower(names[ev.id])} has seen you and is ringing 999. Hold them up`, '#ffffff');
    else if (ev.type === 'police') note('They got through to 999. The police clock jumps', '#ffffff');
    else if (ev.type === 'snatch') note(`${names[ev.id]} has grabbed ${lootName(ev.loot)} and is running`, '#FF3B4E');
    else if (ev.type === 'drop') note(`${names[ev.id]} dropped ${lootName(ev.loot)}`, '#3DFFA2');
    else if (ev.type === 'lost') note(`${names[ev.id]} got away with ${lootName(ev.loot)}`, '#FF3B4E');
  }
}

const REASONS: Record<string, string> = {
  escaped: 'Clean getaway',
  droveOff: 'Drove off',
  police: 'Police arrived',
  wiped: 'Crew wiped out',
  heldIt: 'Held it down',
  robbed: 'They took the lot',
};

const lootName = (id: string) => lower(level.loot.find((l) => l.id === id)?.name ?? 'the loot');

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
  } else if (phase === 'replay' && replay && replayPlaying && !replay.done && (!clip || clipT >= CLIP_LEAD)) {
    acc += dt * (clip ? clipSpeed : replaySpeed);
    while (acc >= STEP && !replay.done) {
      replay.step();
      acc -= STEP;
    }
  }
  const events = sim.events;
  sim.events = [];
  if (phase === 'raid' || phase === 'replay') {
    view.handleEvents(events);
    narrate(events);
  }
  if (phase === 'replay') {
    const r = canvas.getBoundingClientRect();
    const shot = director.update(dt, sim, events, r.width, r.height);
    if (follow) view.frameShot(shot.x, shot.y, shot.ppm);
  }
  const overlay: PlanOverlay = { plans, version, selected, selectedWp, hover };
  view.bind(sim);
  const aiming = phase === 'planning' || phase === 'title' || (phase === 'raid' && (paused || armed !== null));
  view.frame(dt, sim, aiming ? overlay : { ...overlay, hover: null });
  if (phase === 'replay') clipFrame(dt);
  hudT -= dt;
  if (hudT <= 0) {
    hudT = 0.1;
    minimap.show(phase === 'planning' || phase === 'raid');
    minimap.draw(sim, view.visibleRect(), CREW.map((c) => c.color));
    if (phase === 'planning' || phase === 'title') {
      const d = planDoors(level, preview.grid, plans);
      hud.updatePlanning({ plans, selected, selectedWp, kicks: d.kicks, picks: d.picks, barricades: barricades.length, maxBarricades: level.barricades ?? 0 }, preview);
    } else if (phase === 'replay' && replay) {
      hud.updateReplay(sim, {
        playing: replayPlaying && !replay.done,
        speed: clip ? clipSpeed : replaySpeed,
        follow,
        time: sim.time,
        total: recording!.ticks * recording!.dt,
        clips: ClipRecorder.supported(),
      });
    } else if (phase === 'raid') {
      const wp = paused && selectedWp !== null ? (sim.orders(selected)[selectedWp] ?? null) : null;
      hud.updateRaid(sim, paused, speed, selected, { point: wp ? selectedWp : null, hold: wp?.hold ?? null, armed: armed !== null });
    }
  }
  if (phase === 'raid' && sim.outcome) {
    phase = 'results';
    finished = sim;
    recording = record(sim, STEP);
    // Only if nothing has moved on in the meantime (another job picked, or a replan).
    const done = sim;
    setTimeout(() => {
      if (finished === done && phase === 'results') hud.showResults(done.outcome!, done);
    }, 900);
  }
}

engine.runRenderLoop(() => {
  const now = performance.now();
  tick(Math.min(0.1, (now - last) / 1000));
  last = now;
});

hud.setJob(job);
// The title screen first, unless a job was asked for by name.
if (q.has('job')) hud.showTitle(JOBS, job.id);
else hud.showSplash(JOBS, job.id);
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
  get barricades() {
    return barricades;
  },
  barricade: (x: number, y: number) => toggleBarricade(x, y, level.doors.find((d) => d.x === x && d.y === y)?.name ?? 'Door'),
  get paused() {
    return paused;
  },
  replay: replayAction,
  /** Play the replay to its end at once, and say how it ended. */
  finishReplay() {
    while (replay && !replay.done) replay.step();
    return replay?.sim.outcome ?? null;
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
