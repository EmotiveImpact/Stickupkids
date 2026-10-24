// The raid simulation. Engine-agnostic: no rendering, no DOM. A renderer reads
// the public state each frame and drains `events` for one-off effects.

import { Grid } from './grid.ts';
import {
  DEFAULT_PERSONA,
  inRect,
  type EnemyDef,
  type EnemyKind,
  type GoCode,
  type Level,
  type LootDef,
  type Persona,
  type Vec,
} from './level.ts';
import { LINES } from './lines.ts';
import { payoutFor, revengeRisk, type Payout } from './payout.ts';

export type Role = 'Muscle' | 'Creeper' | 'Lookout' | 'Talker';

export interface CrewDef {
  slot: number;
  name: string;
  role: Role;
  color: string;
}

export const CREW: CrewDef[] = [
  { slot: 1, name: 'Dex', role: 'Muscle', color: '#22E3FF' },
  { slot: 2, name: 'Kemi', role: 'Creeper', color: '#FF2D9B' },
  { slot: 3, name: 'Jojo', role: 'Lookout', color: '#A6FF2E' },
  { slot: 4, name: 'Taz', role: 'Talker', color: '#FFB020' },
];

export interface Waypoint {
  x: number;
  y: number;
  /** Wait here until this go code is called. */
  hold: GoCode | null;
  /** Kick (rather than pick) locked doors on the way to the next waypoint. */
  kick: boolean;
}

export type CrewState =
  | 'idle'
  | 'moving'
  | 'door'
  | 'pick'
  | 'kick'
  | 'loot'
  | 'hold'
  | 'fight'
  | 'down'
  | 'escaped';

export interface Action {
  kind: 'door' | 'pick' | 'kick' | 'loot';
  t: number;
  total: number;
  x: number;
  y: number;
  lootId?: string;
}

export interface Crew {
  def: CrewDef;
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  state: CrewState;
  action: Action | null;
  plan: Waypoint[];
  wp: number;
  route: Vec[];
  kickSeg: boolean;
  carrying: string[];
  fireCd: number;
  aimId: string | null;
  fov: number;
  range: number;
}

/**
 * standoff: the boss has clocked the crew and is talking, and his men wait on him.
 * calling: a civilian on the phone to the police.
 */
export type EnemyState = 'calm' | 'suspicious' | 'standoff' | 'calling' | 'hostile' | 'fleeing' | 'subdued' | 'down' | 'gone';

export interface Enemy {
  def: EnemyDef;
  id: string;
  kind: EnemyKind;
  persona: Persona;
  x: number;
  y: number;
  facing: number;
  baseFacing: number;
  home: Vec;
  hp: number;
  maxHp: number;
  state: EnemyState;
  alert: number;
  surrender: number;
  patrolIdx: number;
  waitT: number;
  scanT: number;
  route: Vec[];
  routeGoal: Vec | null;
  repathT: number;
  investigate: Vec | null;
  lastKnown: Vec | null;
  searchT: number;
  fireCd: number;
  doorT: number;
  /** Seen by at least one crew member this tick. */
  seen: boolean;
  /** Ever seen, or known from intel before the job. */
  known: boolean;
  fov: number;
  range: number;
  /** Boss: seconds of talking so far in a standoff. */
  talkT: number;
  /** Boss: the Talker has started talking him down. */
  talkedTo: boolean;
  /** In a standoff on this boss's say-so. */
  leader: string | null;
  /** Dog: seconds to the next bark. Runner: to the next shout. */
  barkT: number;
  /** Civilian: seconds on the phone so far, and whether the call got through. */
  callT: number;
  called: boolean;
  /** Nervous: the loot they are going for, and whether it is in their hands. */
  stash: string | null;
  stashSpot: Vec | null;
  holding: boolean;
}

export interface LootItem {
  def: LootDef;
  x: number;
  y: number;
  /** snatched: an enemy has it and is running. lost: they got away with it. */
  state: 'placed' | 'carried' | 'secured' | 'snatched' | 'lost';
  carrier: number | null;
  /** The enemy holding it, when snatched. */
  holder: string | null;
}

export type SimEvent =
  | { type: 'shot'; from: Vec; to: Vec; hit: boolean; byCrew: boolean }
  | { type: 'noise'; x: number; y: number; r: number; label: string }
  | { type: 'door'; x: number; y: number; state: string }
  | { type: 'alert'; id: string; x: number; y: number }
  | { type: 'surrender'; id: string }
  | { type: 'down'; id: string; crew: boolean }
  | { type: 'loot'; id: string; slot: number }
  | { type: 'backup' }
  | { type: 'reveal'; room: string }
  /** A line shouted over someone's head: an enemy or civilian id, or a crew slot. */
  | { type: 'say'; id: string; slot?: number; x: number; y: number; text: string }
  | { type: 'standoff'; id: string }
  | { type: 'calling'; id: string }
  | { type: 'police'; id: string }
  | { type: 'snatch'; id: string; loot: string }
  | { type: 'drop'; id: string; loot: string }
  | { type: 'lost'; id: string; loot: string };

export interface Outcome {
  reason: 'escaped' | 'wiped' | 'police' | 'droveOff';
  take: number;
  secured: string[];
  escaped: number[];
  left: number[];
  down: number[];
  policeHeat: number;
  rivalHeat: number;
  rep: number;
  time: number;
  shots: number;
  /** Enemies put down, dogs included. */
  enemiesDown: number;
  /** People put down. */
  bodies: number;
  dogsDown: number;
  enemiesSubdued: number;
  civiliansHurt: number;
  /** A civilian got through to 999. */
  policeCalled: boolean;
  /** What the take is worth once the fence has seen how clean it is. */
  payout: Payout;
  /** Chance, in per cent, that the firm comes for the crew. */
  revengeRisk: number;
}

interface EnemyStats {
  fov: number;
  range: number;
  speed: number;
  hp: number;
  damage: number;
  fireCd: number;
  accuracy: number;
  /** How readily they give up when a gun is on them. */
  nerve: number;
}

const DEG = Math.PI / 180;
const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  dealer: { fov: 100 * DEG, range: 7, speed: 2.2, hp: 80, damage: 14, fireCd: 1.0, accuracy: 0.45, nerve: 1 },
  soldier: { fov: 100 * DEG, range: 8, speed: 2.4, hp: 110, damage: 20, fireCd: 0.85, accuracy: 0.55, nerve: 0.6 },
  runner: { fov: 110 * DEG, range: 7, speed: 3.4, hp: 60, damage: 0, fireCd: 1, accuracy: 0, nerve: 1.2 },
  dog: { fov: 150 * DEG, range: 5, speed: 4.2, hp: 60, damage: 14, fireCd: 0.8, accuracy: 0.8, nerve: 0 },
  civilian: { fov: 120 * DEG, range: 9, speed: 1.6, hp: 40, damage: 0, fireCd: 1, accuracy: 0, nerve: 1.5 },
};

const CREW_SPEED = 2.6;
const HEAVY_SPEED = 0.7;
const CREW_FOV = 110 * DEG;
const CREW_RANGE = 9;
const INTIMIDATE_RANGE = 6;
const POLICE_RATE = 1 / 150;
const BACKUP_TIME = 45;
/** How far a street lamp's pool reaches, in metres. */
const LAMP_REACH = 5.5;
/** How long the boss talks before he shoots, unless the Talker is talking to him. */
export const TALK_TIME = 5;
/** How long a civilian takes to get through to 999. */
export const CALL_TIME = 6;
/** How far a nervous dealer will go for the stash. */
const STASH_REACH = 8;
/** How far a boss's word carries. */
const BOSS_REACH = 10;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnTowards(cur: number, target: number, maxStep: number): number {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** Light from the level's street lamps and car lights at each cell centre. */
export function lampLight(level: Level): Float32Array {
  const out = new Float32Array(level.w * level.h);
  const lamps = level.lights.filter((l) => l.kind === 'street' || l.kind === 'car' || l.kind === 'van');
  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      let best = 0;
      for (const l of lamps) {
        const d = Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y) / LAMP_REACH;
        if (d < 1) best = Math.max(best, 1 - d * d);
      }
      out[y * level.w + x] = best;
    }
  }
  return out;
}

/** Default plan: every crew member starts on their spawn with nothing else. */
export function emptyPlans(level: Level): Waypoint[][] {
  return CREW.map((_, i) => [{ ...level.crewStarts[i], hold: null, kick: false }]);
}

/** The cell route of each plan segment, for drawing paths in planning. */
export function planSegments(grid: Grid, plan: Waypoint[]): Vec[][] {
  const out: Vec[][] = [];
  for (let i = 1; i < plan.length; i++) {
    const a = plan[i - 1];
    const b = plan[i];
    const p = grid.findPath(a.x, a.y, b.x, b.y, 'plan');
    out.push(p ? [{ x: Math.floor(a.x) + 0.5, y: Math.floor(a.y) + 0.5 }, ...p] : []);
  }
  return out;
}

/** Locked doors each plan has to get through, and whether they are kicked. */
export function planDoors(level: Level, grid: Grid, plans: Waypoint[][]): { kicks: number; picks: number } {
  let kicks = 0;
  let picks = 0;
  const locked = new Set(level.doors.filter((d) => d.locked).map((d) => grid.key(d.x, d.y)));
  const handled = new Set<number>();
  for (const plan of plans) {
    const segs = planSegments(grid, plan);
    segs.forEach((seg, i) => {
      for (const c of seg) {
        const k = grid.key(Math.floor(c.x), Math.floor(c.y));
        if (!locked.has(k) || handled.has(k)) continue;
        handled.add(k);
        if (plan[i].kick) kicks++;
        else picks++;
      }
    });
  }
  return { kicks, picks };
}

export class Sim {
  readonly level: Level;
  readonly grid: Grid;
  readonly crew: Crew[];
  readonly enemies: Enemy[];
  readonly loot: LootItem[];
  readonly codes = new Set<GoCode>();
  readonly revealed = new Set<string>();
  events: SimEvent[] = [];
  time = 0;
  police = 0;
  policeActive = false;
  backupT = -1;
  shots = 0;
  outcome: Outcome | null = null;
  /** A civilian got through to 999. */
  policeCalled = false;
  private rng: () => number;
  private everAlerted = false;
  /** Lamp light per cell, 0 to 1, when the level is dark enough to matter. */
  private light: Float32Array | null = null;

  constructor(level: Level, plans: Waypoint[][], seed = 7) {
    this.level = level;
    this.grid = new Grid(level);
    this.rng = mulberry32(seed);
    this.crew = CREW.map((def, i) => {
      const plan = plans[i]?.length ? plans[i] : [{ ...level.crewStarts[i], hold: null, kick: false }];
      return {
        def,
        x: plan[0].x,
        y: plan[0].y,
        facing: -Math.PI / 2,
        hp: def.role === 'Muscle' ? 130 : 100,
        maxHp: def.role === 'Muscle' ? 130 : 100,
        state: 'idle',
        action: null,
        plan: plan.map((w) => ({ ...w })),
        wp: 0,
        route: [],
        kickSeg: false,
        carrying: [],
        fireCd: 0,
        aimId: null,
        fov: def.role === 'Lookout' ? 130 * DEG : CREW_FOV,
        range: def.role === 'Lookout' ? 12 : CREW_RANGE,
      };
    });
    this.enemies = level.enemies.map((d) => this.makeEnemy(d, level.unscouted));
    this.loot = level.loot.map((def) => ({ def, x: def.x, y: def.y, state: 'placed', carrier: null, holder: null }));
    if (level.darkness > 0) this.light = lampLight(level);
  }

  /** Share of an enemy's sight range at which they can see this spot (1 in full light). */
  visibility(p: Vec): number {
    if (!this.light) return 1;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const l = x >= 0 && y >= 0 && x < this.level.w && y < this.level.h ? this.light[y * this.level.w + x] : 0;
    return 1 - this.level.darkness * (1 - l);
  }

  private makeEnemy(d: EnemyDef, unscouted: string[]): Enemy {
    const s = ENEMY_STATS[d.kind];
    const room = this.level.rooms.find(
      (r) => Math.floor(d.x) >= r.x0 && Math.floor(d.x) <= r.x1 && Math.floor(d.y) >= r.y0 && Math.floor(d.y) <= r.y1,
    );
    return {
      def: d,
      id: d.id,
      kind: d.kind,
      persona: d.persona ?? DEFAULT_PERSONA[d.kind],
      x: d.x,
      y: d.y,
      facing: d.facing,
      baseFacing: d.facing,
      home: { x: d.x, y: d.y },
      hp: s.hp,
      maxHp: s.hp,
      state: 'calm',
      alert: 0,
      surrender: 0,
      patrolIdx: 0,
      waitT: 0,
      scanT: 0,
      route: [],
      routeGoal: null,
      repathT: 0,
      investigate: null,
      lastKnown: null,
      searchT: 0,
      fireCd: 0,
      doorT: 0,
      seen: false,
      known: !(room && unscouted.includes(room.id)),
      fov: s.fov,
      range: s.range,
      talkT: 0,
      talkedTo: false,
      leader: null,
      barkT: 0,
      callT: 0,
      called: false,
      stash: null,
      stashSpot: null,
      holding: false,
    };
  }

  /** Call a go code: everyone holding on it moves off. */
  callCode(code: GoCode): void {
    this.codes.add(code);
  }

  /** A crew member's orders as they stand mid-raid: first where they are
   *  now (with any hold they are waiting on, and whether they kick on the
   *  leg they are walking), then the waypoints still ahead. A copy. */
  orders(slot: number): Waypoint[] {
    const c = this.crew[slot - 1];
    const rest = c.plan.slice(c.wp).map((w) => ({ ...w }));
    // Waiting at (or standing on) the waypoint they were walking to: that is "here".
    if (rest.length && (c.state === 'hold' || (!c.route.length && dist(c, rest[0]) < 0.05))) {
      return [{ ...rest[0], x: c.x, y: c.y }, ...rest.slice(1)];
    }
    return [{ x: c.x, y: c.y, hold: null, kick: c.kickSeg }, ...rest];
  }

  /** Give a crew member new orders (shaped as orders() returns them). If
   *  the leg they are on is unchanged they carry on along it, finishing a
   *  lock or a door; otherwise they drop it and head for the new point. */
  setOrders(slot: number, orders: Waypoint[]): void {
    const c = this.crew[slot - 1];
    if (!c || c.state === 'down' || c.state === 'escaped' || !orders.length) return;
    const here: Waypoint = { ...orders[0], x: c.x, y: c.y };
    const was = c.state !== 'hold' && c.route.length ? c.plan[c.wp] : null;
    const to = orders[1];
    const sameLeg = !!was && !!to && was.x === to.x && was.y === to.y && !here.hold && here.kick === c.kickSeg;
    c.plan = [here, ...orders.slice(1)];
    if (sameLeg) {
      c.wp = 1;
      return;
    }
    c.wp = 0;
    c.route = [];
    if (c.action && c.action.kind !== 'loot') c.action = null;
    if (c.state !== 'fight' && c.state !== 'loot') c.state = 'moving';
  }

  /** Leave now: whoever is at the van gets away, the rest are left behind. */
  driveOff(): void {
    if (this.outcome) return;
    for (const c of this.crew) {
      if (c.state !== 'down' && inRect(this.level.exit, c.x, c.y)) c.state = 'escaped';
    }
    this.finish('droveOff');
  }

  step(dt: number): void {
    if (this.outcome) return;
    this.time += dt;
    for (const e of this.enemies) e.seen = false;
    for (const c of this.crew) this.updateCrew(c, dt);
    for (const e of this.enemies) this.updateEnemy(e, dt);
    this.updateReveal();
    this.updateClocks(dt);
    this.checkEnd();
  }

  // ---------------------------------------------------------------- crew

  private updateCrew(c: Crew, dt: number): void {
    if (c.state === 'down' || c.state === 'escaped') return;

    // What can this crew member see?
    let hostile: Enemy | null = null;
    let hostileD = Infinity;
    let soft: Enemy | null = null;
    let softD = Infinity;
    for (const e of this.enemies) {
      if (e.state === 'down' || e.state === 'gone') continue;
      const d = dist(c, e);
      if (d > c.range) continue;
      const a = Math.atan2(e.y - c.y, e.x - c.x);
      // A boss who is talking is heard as well as seen.
      if (Math.abs(angleDiff(c.facing, a)) > c.fov / 2 && d > 1.5 && e.state !== 'standoff') continue;
      if (!this.grid.lineOfSight(c.x, c.y, e.x, e.y)) continue;
      e.seen = true;
      e.known = true;
      // Only someone shooting back gets shot at. Anyone running, talking or on
      // the phone gets a gun pointed at them and told to get down.
      if (e.state === 'hostile') {
        if (d < hostileD) {
          hostile = e;
          hostileD = d;
        }
      } else if (e.state !== 'subdued' && e.kind !== 'dog' && d <= INTIMIDATE_RANGE) {
        if (d < softD) {
          soft = e;
          softD = d;
        }
      }
    }

    c.fireCd = Math.max(0, c.fireCd - dt);
    if (hostile) {
      c.state = 'fight';
      c.aimId = hostile.id;
      const a = Math.atan2(hostile.y - c.y, hostile.x - c.x);
      c.facing = turnTowards(c.facing, a, 10 * dt);
      if (c.fireCd <= 0 && Math.abs(angleDiff(c.facing, a)) < 0.25) {
        c.fireCd = 0.55;
        const hit = this.rng() < Math.min(0.9, Math.max(0.3, 0.8 - 0.03 * hostileD));
        this.shots++;
        this.events.push({ type: 'shot', from: { x: c.x, y: c.y }, to: { x: hostile.x, y: hostile.y }, hit, byCrew: true });
        this.noise(c.x, c.y, 16, 'Gunshot', true);
        this.police += 0.03;
        if (hit) this.damageEnemy(hostile, c.def.role === 'Muscle' ? 45 : 30, c);
        else this.stray(c, hostile);
      }
      return;
    }
    if (c.state === 'fight') c.state = 'moving';

    // Hold up anyone who isn't shooting at us.
    c.aimId = null;
    if (soft) {
      c.aimId = soft.id;
      const rate = (c.def.role === 'Talker' ? 1.7 : 0.95) * (1.25 - softD / INTIMIDATE_RANGE);
      soft.surrender += rate * this.nerve(soft, c) * dt;
      if (soft.persona === 'boss' && soft.state === 'standoff' && c.def.role === 'Talker' && !soft.talkedTo) {
        soft.talkedTo = true;
        this.sayCrew(c, LINES.tazTalks);
      }
      if (soft.surrender >= 1) {
        this.giveUp(soft);
        c.aimId = null;
      }
    }

    // Timed actions: doors, locks, bagging.
    if (c.action) {
      const act = c.action;
      // Someone else got the door open first.
      const shared = this.grid.door(Math.floor(act.x), Math.floor(act.y));
      if ((act.kind === 'pick' || act.kind === 'door') && (shared === 'open' || shared === 'broken')) {
        c.action = null;
        c.state = 'moving';
        return;
      }
      act.t += dt;
      c.facing = turnTowards(c.facing, Math.atan2(act.y - c.y, act.x - c.x), 8 * dt);
      if (act.t >= act.total) this.completeAction(c, act);
      return;
    }

    // Pick up loot we are standing next to.
    for (const item of this.loot) {
      if (item.state !== 'placed') continue;
      if (dist(c, item) < 0.95) {
        const t = item.def.time * (c.def.role === 'Creeper' ? 0.7 : 1);
        c.action = { kind: 'loot', t: 0, total: t, x: item.x, y: item.y, lootId: item.def.id };
        c.state = 'loot';
        return;
      }
    }

    // Holding for a go code?
    if (c.state === 'hold') {
      const code = c.plan[c.wp].hold;
      if (code && !this.codes.has(code)) return;
      c.state = 'moving';
      this.advanceWaypoint(c);
    }

    if (!c.route.length) {
      if (c.wp < c.plan.length) {
        const w = c.plan[c.wp];
        if (w.hold && !this.codes.has(w.hold)) {
          c.state = 'hold';
          return;
        }
        this.advanceWaypoint(c);
      }
      if (!c.route.length) {
        c.state = 'idle';
        if (c.wp >= c.plan.length && inRect(this.level.exit, c.x, c.y)) c.state = 'escaped';
        return;
      }
    }

    // Walk the route; stop at closed doors.
    const next = c.route[0];
    const nx = Math.floor(next.x);
    const ny = Math.floor(next.y);
    const door = this.grid.door(nx, ny);
    if (door === 'closed') {
      c.action = { kind: 'door', t: 0, total: c.def.role === 'Creeper' ? 0.35 : 0.5, x: next.x, y: next.y };
      c.state = 'door';
      return;
    }
    if (door === 'locked') {
      if (c.kickSeg) c.action = { kind: 'kick', t: 0, total: 0.8, x: next.x, y: next.y };
      else c.action = { kind: 'pick', t: 0, total: c.def.role === 'Creeper' ? 3 : 7, x: next.x, y: next.y };
      c.state = c.action.kind;
      return;
    }
    c.state = 'moving';
    const heavy = c.carrying.some((id) => this.loot.find((l) => l.def.id === id)?.def.heavy);
    const speed = CREW_SPEED * (heavy ? HEAVY_SPEED : 1);
    this.moveTowards(c, next, speed * dt, c.aimId ? null : 12 * dt);
    if (c.aimId) {
      const t = this.enemies.find((e) => e.id === c.aimId);
      if (t) c.facing = turnTowards(c.facing, Math.atan2(t.y - c.y, t.x - c.x), 8 * dt);
    }
    if (c.x === next.x && c.y === next.y) c.route.shift();
  }

  private advanceWaypoint(c: Crew): void {
    const from = c.plan[c.wp];
    c.wp++;
    if (c.wp >= c.plan.length) return;
    c.kickSeg = from.kick;
    const to = c.plan[c.wp];
    c.route = this.grid.findPath(c.x, c.y, to.x, to.y, 'crew') ?? [];
  }

  private completeAction(c: Crew, act: Action): void {
    c.action = null;
    c.state = 'moving';
    const x = Math.floor(act.x);
    const y = Math.floor(act.y);
    if (act.kind === 'door' || act.kind === 'pick') {
      this.grid.setDoor(x, y, 'open');
      this.events.push({ type: 'door', x, y, state: 'open' });
      if (act.kind === 'door') this.noise(x + 0.5, y + 0.5, 2.5, 'Door', false);
    } else if (act.kind === 'kick') {
      this.grid.setDoor(x, y, 'broken');
      this.events.push({ type: 'door', x, y, state: 'broken' });
      this.noise(x + 0.5, y + 0.5, 12, 'Door kicked', false);
      this.police += 0.1;
    } else if (act.kind === 'loot') {
      const item = this.loot.find((l) => l.def.id === act.lootId);
      if (item && item.state === 'placed') {
        item.state = 'carried';
        item.carrier = c.def.slot;
        c.carrying.push(item.def.id);
        this.events.push({ type: 'loot', id: item.def.id, slot: c.def.slot });
      }
    }
  }

  private moveTowards(a: { x: number; y: number; facing: number }, to: Vec, step: number, turn: number | null): void {
    const dx = to.x - a.x;
    const dy = to.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) {
      a.x = to.x;
      a.y = to.y;
      return;
    }
    if (turn !== null) a.facing = turnTowards(a.facing, Math.atan2(dy, dx), turn);
    if (d <= step) {
      a.x = to.x;
      a.y = to.y;
    } else {
      a.x += (dx / d) * step;
      a.y += (dy / d) * step;
    }
  }

  private damageCrew(c: Crew, dmg: number, from: Enemy): void {
    c.hp -= dmg;
    // Turn to face whoever is hurting us.
    c.facing = Math.atan2(from.y - c.y, from.x - c.x);
    if (c.hp <= 0) {
      c.hp = 0;
      c.state = 'down';
      c.action = null;
      c.route = [];
      this.events.push({ type: 'down', id: String(c.def.slot), crew: true });
      // Dropped loot can be picked up by someone else.
      for (const id of c.carrying) {
        const item = this.loot.find((l) => l.def.id === id);
        if (item) {
          item.state = 'placed';
          item.carrier = null;
          item.x = c.x;
          item.y = c.y;
        }
      }
      c.carrying = [];
    }
  }

  private damageEnemy(e: Enemy, dmg: number, by: Crew): void {
    e.hp -= dmg;
    if (e.state === 'calm' || e.state === 'suspicious' || e.state === 'standoff') this.becomeHostile(e, by);
    if (e.hp <= 0) {
      e.hp = 0;
      e.state = 'down';
      e.route = [];
      this.events.push({ type: 'down', id: e.id, crew: false });
      this.dropStash(e);
    }
  }

  /** How readily someone gives up with this crew member's gun on them. */
  private nerve(e: Enemy, c: Crew): number {
    switch (e.persona) {
      // A gun alone barely moves him, and once he is talking only talk will.
      case 'boss':
        return c.def.role === 'Talker' ? 1.2 : e.state === 'standoff' ? 0 : 0.35;
      case 'muscle':
        return 0.4;
      case 'nervous':
        return 1.8;
      default:
        return ENEMY_STATS[e.kind].nerve;
    }
  }

  /** Hands up. A boss takes his men with him; a neighbour puts the phone down. */
  private giveUp(e: Enemy): void {
    const was = e.state;
    e.state = 'subdued';
    e.route = [];
    e.leader = null;
    this.events.push({ type: 'surrender', id: e.id });
    this.dropStash(e);
    if (e.persona === 'nosy') {
      if (was === 'calling') this.say(e, LINES.neighbourFolds);
      return;
    }
    if (e.persona !== 'boss') return;
    this.say(e, LINES.bossFolds);
    let men = 0;
    for (const o of this.enemies) {
      if (o === e || o.persona === 'nosy' || o.kind === 'dog') continue;
      if (o.state === 'hostile' || o.state === 'subdued' || o.state === 'down' || o.state === 'gone') continue;
      if (o.leader !== e.id && dist(o, e) > BOSS_REACH) continue;
      o.state = 'subdued';
      o.route = [];
      o.leader = null;
      this.events.push({ type: 'surrender', id: o.id });
      this.dropStash(o);
      men++;
    }
    if (men) this.say(e, LINES.standDown);
  }

  private say(e: Enemy, text: string): void {
    this.events.push({ type: 'say', id: e.id, x: e.x, y: e.y, text });
  }

  private sayCrew(c: Crew, text: string): void {
    this.events.push({ type: 'say', id: String(c.def.slot), slot: c.def.slot, x: c.x, y: c.y, text });
  }

  /** A nervous dealer goes for the nearest stash he can reach. */
  private grabStash(e: Enemy): boolean {
    let best: LootItem | null = null;
    let spot: Vec | null = null;
    let bd = STASH_REACH;
    for (const item of this.loot) {
      if (item.state !== 'placed') continue;
      const d = dist(e, item);
      if (d >= bd) continue;
      // Loot can sit on a table: stand on the nearest open cell beside it.
      const cx = Math.floor(item.x);
      const cy = Math.floor(item.y);
      let s: Vec | null = null;
      let sd = Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const p = { x: cx + dx + 0.5, y: cy + dy + 0.5 };
          const pd = dist(p, e);
          if (pd < sd && this.grid.findPath(e.x, e.y, p.x, p.y, 'guard')) {
            s = p;
            sd = pd;
          }
        }
      }
      if (!s) continue;
      best = item;
      spot = s;
      bd = d;
    }
    if (!best || !spot) return false;
    e.state = 'fleeing';
    e.stash = best.def.id;
    e.stashSpot = spot;
    e.holding = false;
    e.route = [];
    e.routeGoal = null;
    return true;
  }

  /** Whatever they were carrying falls where they stand. */
  private dropStash(e: Enemy): void {
    if (!e.holding || !e.stash) return;
    const item = this.loot.find((l) => l.def.id === e.stash);
    e.holding = false;
    e.stash = null;
    if (!item || item.state !== 'snatched') return;
    item.state = 'placed';
    item.holder = null;
    item.x = e.x;
    item.y = e.y;
    this.events.push({ type: 'drop', id: e.id, loot: item.def.id });
  }

  /** A shot that missed may hit someone who has nothing to do with it. */
  private stray(from: Vec, to: Vec): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    for (const o of this.enemies) {
      if (o.persona !== 'nosy' || o.state === 'down' || o.state === 'gone') continue;
      const along = (o.x - from.x) * ux + (o.y - from.y) * uy;
      if (along < 0.5 || along > len + 4) continue;
      if (Math.abs((o.x - from.x) * uy - (o.y - from.y) * ux) > 0.6) continue;
      if (!this.grid.lineOfSight(from.x, from.y, o.x, o.y)) continue;
      if (this.rng() < 0.5) {
        o.hp = 0;
        o.state = 'down';
        o.route = [];
        this.events.push({ type: 'down', id: o.id, crew: false });
      }
      return;
    }
  }

  // ------------------------------------------------------------- enemies

  private visibleCrew(e: Enemy): { c: Crew; d: number } | null {
    let best: Crew | null = null;
    let bd = Infinity;
    for (const c of this.crew) {
      if (c.state === 'down' || c.state === 'escaped') continue;
      const d = dist(c, e);
      if (d > e.range * this.visibility(c)) continue;
      const a = Math.atan2(c.y - e.y, c.x - e.x);
      if (Math.abs(angleDiff(e.facing, a)) > e.fov / 2 && d > 1.3) continue;
      if (!this.grid.lineOfSight(e.x, e.y, c.x, c.y)) continue;
      if (d < bd) {
        best = c;
        bd = d;
      }
    }
    return best ? { c: best, d: bd } : null;
  }

  /**
   * They know the crew are here. `sight`: they saw them themselves (a boss
   * then talks first). `heard`: a shout, a gunshot or a bark.
   */
  private becomeHostile(e: Enemy, target: Vec, how: 'sight' | 'heard' = 'heard'): void {
    if (e.persona === 'nosy') {
      // Neighbours only ring for what they see, or for gunfire (handled in noise).
      if (how === 'sight') this.startCall(e, 0);
      return;
    }
    if (e.state === 'hostile' || e.state === 'fleeing' || e.state === 'down' || e.state === 'subdued' || e.state === 'gone') return;
    if (e.persona === 'boss' && how === 'sight' && e.state !== 'standoff') {
      this.startStandoff(e, target);
      return;
    }
    e.leader = null;
    e.alert = 1;
    e.lastKnown = { x: target.x, y: target.y };
    e.route = [];
    e.routeGoal = null;
    this.events.push({ type: 'alert', id: e.id, x: e.x, y: e.y });
    if (!this.everAlerted) {
      this.everAlerted = true;
      this.police += 0.08;
    }
    this.policeActive = true;
    if (this.backupT < 0 && this.backupT > -1.5) this.backupT = BACKUP_TIME;
    if (e.persona === 'runner') {
      // Off for help, shouting the place up on the way.
      e.state = 'fleeing';
      this.say(e, LINES.runnerFlees);
      this.shout(e, target);
      e.barkT = 1.5;
      return;
    }
    if (e.persona === 'nervous' && this.grabStash(e)) {
      // He panics loudly enough for everyone to hear.
      this.say(e, LINES.nervousGrabs);
      this.shout(e, target);
      return;
    }
    e.state = 'hostile';
    if (e.persona === 'dog') {
      this.bark(e, target);
      e.barkT = 1.5;
      return;
    }
    if (e.persona === 'muscle') this.say(e, LINES.muscleHolds);
    this.shout(e, target);
  }

  /** The boss wants to know who sent them. His men wait on his word. */
  private startStandoff(e: Enemy, target: Vec): void {
    e.state = 'standoff';
    e.talkT = 0;
    e.alert = 1;
    e.lastKnown = { x: target.x, y: target.y };
    e.route = [];
    e.routeGoal = null;
    this.say(e, LINES.bossTalks);
    this.events.push({ type: 'standoff', id: e.id });
    for (const o of this.enemies) {
      if (o === e || o.persona === 'nosy' || o.persona === 'dog' || dist(o, e) > BOSS_REACH) continue;
      if (o.state !== 'calm' && o.state !== 'suspicious') continue;
      o.state = 'standoff';
      o.leader = e.id;
      o.lastKnown = { x: target.x, y: target.y };
      o.route = [];
      o.routeGoal = null;
    }
  }

  /** A civilian gets their phone out. `head`: seconds already done (gunfire makes them quick). */
  private startCall(e: Enemy, head: number): void {
    if (e.called || e.state === 'calling' || e.state === 'subdued' || e.state === 'down' || e.state === 'gone') return;
    e.state = 'calling';
    e.callT = head;
    e.alert = 1;
    this.say(e, LINES.neighbourSees);
    this.events.push({ type: 'calling', id: e.id });
  }

  /** "They're here!" Nearby enemies go hostile and head for the spot. */
  private shout(from: Enemy, target: Vec): void {
    this.events.push({ type: 'noise', x: from.x, y: from.y, r: 10, label: 'Shouting' });
    for (const o of this.enemies) {
      if (o === from || o.persona === 'nosy' || dist(o, from) > 10) continue;
      if (o.state === 'calm' || o.state === 'suspicious' || o.state === 'standoff') this.becomeHostile(o, target);
    }
  }

  /** A dog's bark brings everyone near. */
  private bark(e: Enemy, target: Vec): void {
    this.events.push({ type: 'noise', x: e.x, y: e.y, r: 12, label: 'Barking' });
    for (const o of this.enemies) {
      if (o === e || o.persona === 'nosy' || dist(o, e) > 12) continue;
      if (o.state === 'calm' || o.state === 'suspicious' || o.state === 'standoff') this.becomeHostile(o, target);
    }
  }

  private noise(x: number, y: number, r: number, label: string, loud: boolean): void {
    this.events.push({ type: 'noise', x, y, r, label });
    if (r >= 5) this.policeActive = true;
    for (const e of this.enemies) {
      if (Math.hypot(e.x - x, e.y - y) > r) continue;
      if (e.persona === 'nosy') {
        if (loud) this.startCall(e, 2);
        continue;
      }
      if (e.state === 'standoff' && loud) this.becomeHostile(e, { x, y });
      if (e.state !== 'calm' && e.state !== 'suspicious') continue;
      if (loud) {
        this.becomeHostile(e, { x, y });
      } else {
        e.state = 'suspicious';
        e.alert = Math.max(e.alert, 0.55);
        e.investigate = { x, y };
        e.route = [];
        e.routeGoal = null;
        if (e.kind === 'dog') this.events.push({ type: 'noise', x: e.x, y: e.y, r: 6, label: 'Barking' });
      }
    }
  }

  private updateEnemy(e: Enemy, dt: number): void {
    if (e.state === 'down' || e.state === 'gone' || e.state === 'subdued') return;
    const s = ENEMY_STATS[e.kind];
    const v = this.visibleCrew(e);
    e.fireCd = Math.max(0, e.fireCd - dt);
    e.repathT -= dt;
    e.barkT -= dt;

    if (e.persona === 'nosy') return this.updateCivilian(e, v, dt);
    if (e.state === 'fleeing') return this.updateFleeing(e, dt);
    if (e.state === 'standoff') return this.updateStandoff(e, v, dt);

    if (e.state === 'hostile') {
      if (e.persona === 'dog' && e.barkT <= 0) {
        e.barkT = 1.5;
        this.bark(e, v ? v.c : (e.lastKnown ?? e));
      }
      if (v) {
        e.lastKnown = { x: v.c.x, y: v.c.y };
        e.searchT = 0;
        const a = Math.atan2(v.c.y - e.y, v.c.x - e.x);
        e.facing = turnTowards(e.facing, a, 7 * dt);
        if (e.kind === 'dog') {
          if (v.d > 1.0) this.walkTo(e, v.c, s.speed * 1.1, dt);
          else if (e.fireCd <= 0) {
            e.fireCd = s.fireCd;
            this.damageCrew(v.c, s.damage, e);
          }
        } else if (e.fireCd <= 0 && Math.abs(angleDiff(e.facing, a)) < 0.3) {
          e.fireCd = s.fireCd;
          const hit = this.rng() < Math.max(0.15, s.accuracy - 0.02 * v.d);
          this.events.push({ type: 'shot', from: { x: e.x, y: e.y }, to: { x: v.c.x, y: v.c.y }, hit, byCrew: false });
          this.noise(e.x, e.y, 16, 'Gunshot', true);
          this.police += 0.03;
          if (hit) this.damageCrew(v.c, s.damage, e);
          else this.stray(e, v.c);
        }
        return;
      }
      // Muscle holds his post and watches the way they came.
      if (e.persona === 'muscle') {
        if (dist(e, e.home) > 0.3) this.walkTo(e, e.home, s.speed, dt);
        else if (e.lastKnown) e.facing = turnTowards(e.facing, Math.atan2(e.lastKnown.y - e.y, e.lastKnown.x - e.x), 4 * dt);
        return;
      }
      if (e.lastKnown) {
        if (dist(e, e.lastKnown) > 0.3) {
          if (!this.walkTo(e, e.lastKnown, s.speed, dt)) e.lastKnown = null;
        } else {
          e.searchT += dt;
          e.facing += dt * 2.5;
          if (e.searchT > 6) e.lastKnown = null;
        }
        return;
      }
      // Lost them: stay hostile but drift back home.
      this.walkTo(e, e.home, s.speed * 0.6, dt);
      return;
    }

    // Calm or suspicious.
    if (v) {
      const rate = 2.2 * (1 - v.d / e.range) + 0.45;
      const sneaky = v.c.def.role === 'Creeper' && v.c.state !== 'fight' ? 0.65 : 1;
      e.alert += rate * sneaky * dt;
      e.facing = turnTowards(e.facing, Math.atan2(v.c.y - e.y, v.c.x - e.x), 2.5 * dt);
      if (e.alert > 0.25) {
        e.state = 'suspicious';
        e.investigate = { x: v.c.x, y: v.c.y };
      }
      if (e.alert >= 1) this.becomeHostile(e, v.c, 'sight');
      return;
    }
    e.alert = Math.max(0, e.alert - 0.12 * dt);

    if (e.state === 'suspicious') {
      // A dog on edge growls and barks, and the others come to see.
      if (e.persona === 'dog' && e.barkT <= 0) {
        e.barkT = 2;
        this.events.push({ type: 'noise', x: e.x, y: e.y, r: 8, label: 'Barking' });
        for (const o of this.enemies) {
          if (o === e || o.persona === 'nosy' || o.state !== 'calm' || dist(o, e) > 8) continue;
          o.state = 'suspicious';
          o.alert = Math.max(o.alert, 0.4);
          o.investigate = { x: e.x, y: e.y };
        }
      }
      if (e.investigate && dist(e, e.investigate) > 0.6 && e.persona !== 'muscle') {
        if (!this.walkTo(e, e.investigate, s.speed * 0.7, dt)) e.investigate = null;
      } else if (e.investigate && e.persona === 'muscle') {
        // Muscle turns to look, but does not leave his post.
        e.facing = turnTowards(e.facing, Math.atan2(e.investigate.y - e.y, e.investigate.x - e.x), 3 * dt);
      } else {
        e.facing += dt * 1.5;
      }
      if (e.alert <= 0.05) {
        e.state = 'calm';
        e.investigate = null;
      }
      return;
    }

    // Calm: patrol or stand watch.
    const patrol = e.def.patrol;
    if (patrol.length > 1) {
      if (e.waitT > 0) {
        e.waitT -= dt;
        return;
      }
      const target = patrol[e.patrolIdx];
      if (dist(e, target) < 0.15) {
        e.patrolIdx = (e.patrolIdx + 1) % patrol.length;
        e.waitT = 1.4;
        return;
      }
      this.walkTo(e, target, s.speed * 0.55, dt);
      return;
    }
    if (dist(e, e.home) > 0.15) {
      this.walkTo(e, e.home, s.speed * 0.55, dt);
      return;
    }
    e.scanT += dt;
    e.facing = e.baseFacing + Math.sin(e.scanT * 0.7) * 0.6;
  }

  /** Running: a runner for help, a nervous dealer for the stash and then away. */
  private updateFleeing(e: Enemy, dt: number): void {
    const s = ENEMY_STATS[e.kind];
    const item = e.stash ? this.loot.find((l) => l.def.id === e.stash) : undefined;
    if (item && !e.holding) {
      if (item.state !== 'placed' || !e.stashSpot) {
        // Someone beat him to it.
        e.stash = null;
      } else if (dist(e, item) > 1 && dist(e, e.stashSpot) > 0.2) {
        if (!this.walkTo(e, e.stashSpot, s.speed, dt)) e.stash = null;
        return;
      } else {
        item.state = 'snatched';
        item.holder = e.id;
        e.holding = true;
        this.events.push({ type: 'snatch', id: e.id, loot: item.def.id });
        return;
      }
    }
    if (e.persona === 'runner' && e.barkT <= 0) {
      e.barkT = 1.5;
      this.shout(e, e.lastKnown ?? e);
    }
    const gate = this.level.gate;
    this.walkTo(e, gate, s.speed * (e.holding ? 0.85 : 1), dt);
    if (dist(e, gate) < 0.3) {
      e.state = 'gone';
      if (e.persona === 'runner') {
        this.police += 0.12;
        if (this.backupT > 15) this.backupT = 15;
      }
      if (e.holding && item) {
        item.state = 'lost';
        e.holding = false;
        this.events.push({ type: 'lost', id: e.id, loot: item.def.id });
      }
    }
  }

  /** The boss talks; unless the Talker keeps him talking, he runs out of patience. */
  private updateStandoff(e: Enemy, v: { c: Crew; d: number } | null, dt: number): void {
    if (v) e.lastKnown = { x: v.c.x, y: v.c.y };
    const look = e.lastKnown;
    if (look) e.facing = turnTowards(e.facing, Math.atan2(look.y - e.y, look.x - e.x), 4 * dt);
    if (e.leader) {
      // Waiting on the boss's word.
      const boss = this.enemies.find((o) => o.id === e.leader);
      if (boss?.state === 'standoff') return;
      if (boss?.state === 'subdued') return this.giveUp(e);
      e.leader = null;
      e.state = 'suspicious';
      this.becomeHostile(e, look ?? e);
      return;
    }
    // The Talker keeps him talking for as long as he is working on him.
    const talking = this.crew.some((c) => c.def.role === 'Talker' && c.aimId === e.id);
    if (!talking) e.talkT += dt;
    if (e.talkT >= TALK_TIME) {
      this.say(e, LINES.bossDone);
      e.state = 'suspicious';
      this.becomeHostile(e, look ?? e);
    }
  }

  /** A civilian watches, and rings 999 if they see the crew. */
  private updateCivilian(e: Enemy, v: { c: Crew; d: number } | null, dt: number): void {
    if (v) e.facing = turnTowards(e.facing, Math.atan2(v.c.y - e.y, v.c.x - e.x), 3 * dt);
    if (e.state === 'calling') {
      e.callT += dt;
      if (e.callT >= CALL_TIME) {
        e.state = 'calm';
        e.called = true;
        e.alert = 0;
        // The clock starts if it hasn't, and jumps; a call alone never ends the job.
        this.police = Math.max(this.police, Math.min(0.9, this.police + 0.25));
        this.policeActive = true;
        this.policeCalled = true;
        this.say(e, LINES.neighbourRang);
        this.events.push({ type: 'police', id: e.id });
      }
      return;
    }
    if (v && !e.called) {
      e.alert += (2.2 * (1 - v.d / e.range) + 0.45) * (v.c.def.role === 'Creeper' ? 0.65 : 1) * dt;
      if (e.alert > 0.25) e.state = 'suspicious';
      if (e.alert >= 1) this.startCall(e, 0);
      return;
    }
    e.alert = Math.max(0, e.alert - 0.12 * dt);
    if (e.state === 'suspicious' && e.alert <= 0.05) e.state = 'calm';
    if (!v) {
      e.scanT += dt;
      e.facing = e.baseFacing + Math.sin(e.scanT * 0.5) * 0.5;
    }
  }

  /** Path towards a goal, opening doors on the way. False when unreachable. */
  private walkTo(e: Enemy, goal: Vec, speed: number, dt: number): boolean {
    if (e.doorT > 0) {
      e.doorT -= dt;
      return true;
    }
    const mover = e.kind === 'dog' ? 'dog' : 'guard';
    if (!e.routeGoal || dist(e.routeGoal, goal) > 0.5 || (e.repathT <= 0 && !e.route.length)) {
      const p = this.grid.findPath(e.x, e.y, goal.x, goal.y, mover);
      e.repathT = 0.5;
      e.routeGoal = { x: goal.x, y: goal.y };
      if (!p) {
        e.route = [];
        return false;
      }
      e.route = p;
      if (p.length) e.route[e.route.length - 1] = { x: goal.x, y: goal.y };
    }
    if (!e.route.length) {
      this.moveTowards(e, goal, speed * dt, 8 * dt);
      return true;
    }
    const next = e.route[0];
    const nx = Math.floor(next.x);
    const ny = Math.floor(next.y);
    const door = this.grid.door(nx, ny);
    if (door === 'closed' || door === 'locked') {
      // Guards have keys; dogs never path through shut doors.
      this.grid.setDoor(nx, ny, 'open');
      this.events.push({ type: 'door', x: nx, y: ny, state: 'open' });
      e.doorT = door === 'locked' ? 0.8 : 0.4;
      return true;
    }
    this.moveTowards(e, next, speed * dt, 8 * dt);
    if (e.x === next.x && e.y === next.y) e.route.shift();
    return true;
  }

  // -------------------------------------------------------------- world

  private updateReveal(): void {
    for (const id of this.level.unscouted) {
      if (this.revealed.has(id)) continue;
      const r = this.level.rooms.find((rr) => rr.id === id);
      if (!r) continue;
      for (const c of this.crew) {
        if (c.state === 'down' || c.state === 'escaped') continue;
        const cx = Math.floor(c.x);
        const cy = Math.floor(c.y);
        // Inside the room, or looking into it through an open door or window.
        let sees = cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1;
        if (!sees) {
          const tx = (r.x0 + r.x1 + 1) / 2;
          const ty = (r.y0 + r.y1 + 1) / 2;
          if (dist(c, { x: tx, y: ty }) < c.range && this.grid.lineOfSight(c.x, c.y, tx, ty)) sees = true;
        }
        if (sees) {
          this.revealed.add(id);
          this.events.push({ type: 'reveal', room: id });
          break;
        }
      }
    }
  }

  private updateClocks(dt: number): void {
    if (this.policeActive) this.police += POLICE_RATE * dt;
    if (this.backupT > 0) {
      this.backupT -= dt;
      if (this.backupT <= 0) {
        this.backupT = -2;
        this.events.push({ type: 'backup' });
        const { spawn, target } = this.level.backup;
        spawn.forEach((p, i) => {
          const e = this.makeEnemy({ id: `backup${i}`, kind: 'soldier', name: 'Backup', x: p.x, y: p.y, facing: Math.PI / 2, patrol: [] }, []);
          e.known = false;
          e.state = 'hostile';
          e.lastKnown = { ...target };
          this.enemies.push(e);
        });
      }
    }
    if (this.police >= 1) {
      this.police = 1;
      for (const c of this.crew) {
        if (c.state !== 'down' && c.state !== 'escaped' && inRect(this.level.exit, c.x, c.y)) c.state = 'escaped';
      }
      this.finish('police');
    }
  }

  /** 0..1 progress of the backup clock (0 when not started). */
  get backupProgress(): number {
    if (this.backupT === -2) return 1;
    if (this.backupT < 0) return 0;
    return 1 - this.backupT / BACKUP_TIME;
  }

  private checkEnd(): void {
    if (this.outcome) return;
    const alive = this.crew.filter((c) => c.state !== 'down');
    if (!alive.length) return this.finish('wiped');
    if (alive.every((c) => c.state === 'escaped')) this.finish('escaped');
  }

  private finish(reason: Outcome['reason']): void {
    const escaped = this.crew.filter((c) => c.state === 'escaped').map((c) => c.def.slot);
    const down = this.crew.filter((c) => c.state === 'down').map((c) => c.def.slot);
    const left = this.crew.filter((c) => c.state !== 'escaped' && c.state !== 'down').map((c) => c.def.slot);
    const secured: string[] = [];
    let take = 0;
    for (const item of this.loot) {
      if (item.state === 'carried' && item.carrier !== null && escaped.includes(item.carrier)) {
        item.state = 'secured';
        secured.push(item.def.id);
        take += item.def.value;
      }
    }
    const people = this.enemies.filter((e) => e.persona !== 'nosy');
    const bodies = people.filter((e) => e.state === 'down' && e.kind !== 'dog').length;
    const dogsDown = people.filter((e) => e.state === 'down' && e.kind === 'dog').length;
    const enemiesSubdued = people.filter((e) => e.state === 'subdued').length;
    const civiliansHurt = this.enemies.filter((e) => e.persona === 'nosy' && e.state === 'down').length;
    const quiet = !this.everAlerted && this.shots === 0;
    const rivalHeat = Math.round(10 + bodies * 8 + dogsDown * 3 + enemiesSubdued * 2 + (this.everAlerted ? 8 : 0));
    this.outcome = {
      reason,
      take,
      secured,
      escaped,
      left,
      down,
      policeHeat: Math.round(
        (quiet ? 2 + this.police * 10 : 8 + this.police * 30 + bodies * 6 + left.length * 6) + civiliansHurt * 15 + (this.policeCalled ? 8 : 0),
      ),
      rivalHeat,
      rep: Math.round(take / 1000 + (quiet ? 10 : 0) + (bodies === 0 && take > 0 ? 3 : 0) - left.length * 3 - down.length * 4 - civiliansHurt * 10),
      time: this.time,
      shots: this.shots,
      enemiesDown: bodies + dogsDown,
      bodies,
      dogsDown,
      civiliansHurt,
      policeCalled: this.policeCalled,
      payout: payoutFor(take, bodies, enemiesSubdued, civiliansHurt),
      revengeRisk: revengeRisk(bodies, rivalHeat),
      enemiesSubdued,
    };
  }
}
