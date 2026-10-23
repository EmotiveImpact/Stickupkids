// The raid simulation. Engine-agnostic: no rendering, no DOM. A renderer reads
// the public state each frame and drains `events` for one-off effects.

import { Grid } from './grid.ts';
import {
  inRect,
  type EnemyDef,
  type EnemyKind,
  type GoCode,
  type Level,
  type LootDef,
  type Vec,
} from './level.ts';

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

export type EnemyState = 'calm' | 'suspicious' | 'hostile' | 'fleeing' | 'subdued' | 'down' | 'gone';

export interface Enemy {
  def: EnemyDef;
  id: string;
  kind: EnemyKind;
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
}

export interface LootItem {
  def: LootDef;
  x: number;
  y: number;
  state: 'placed' | 'carried' | 'secured';
  carrier: number | null;
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
  | { type: 'reveal'; room: string };

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
  enemiesDown: number;
  enemiesSubdued: number;
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
};

const CREW_SPEED = 2.6;
const HEAVY_SPEED = 0.7;
const CREW_FOV = 110 * DEG;
const CREW_RANGE = 9;
const INTIMIDATE_RANGE = 6;
const POLICE_RATE = 1 / 150;
const BACKUP_TIME = 45;
const GATE: Vec = { x: 14.5, y: 0.5 };

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
  private rng: () => number;
  private everAlerted = false;

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
    this.loot = level.loot.map((def) => ({ def, x: def.x, y: def.y, state: 'placed', carrier: null }));
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
    };
  }

  /** Call a go code: everyone holding on it moves off. */
  callCode(code: GoCode): void {
    this.codes.add(code);
  }

  /** Replace a crew member's remaining plan (used when paused mid-raid). */
  replan(slot: number, waypoints: Waypoint[]): void {
    const c = this.crew[slot - 1];
    if (!c || c.state === 'down' || c.state === 'escaped') return;
    c.plan = [{ x: c.x, y: c.y, hold: null, kick: waypoints[0]?.kick ?? false }, ...waypoints];
    c.wp = 0;
    c.route = [];
    if (c.action && c.action.kind !== 'loot') c.action = null;
    c.state = 'moving';
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
      if (Math.abs(angleDiff(c.facing, a)) > c.fov / 2 && d > 1.5) continue;
      if (!this.grid.lineOfSight(c.x, c.y, e.x, e.y)) continue;
      e.seen = true;
      e.known = true;
      if (e.state === 'hostile' || e.state === 'fleeing') {
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
      }
      return;
    }
    if (c.state === 'fight') c.state = 'moving';

    // Intimidate anyone who hasn't clocked us yet.
    c.aimId = null;
    if (soft && soft.state !== 'hostile') {
      c.aimId = soft.id;
      const rate = (c.def.role === 'Talker' ? 1.7 : 0.95) * (1.25 - softD / INTIMIDATE_RANGE);
      soft.surrender += rate * ENEMY_STATS[soft.kind].nerve * dt;
      if (soft.surrender >= 1) {
        soft.state = 'subdued';
        soft.route = [];
        this.events.push({ type: 'surrender', id: soft.id });
        c.aimId = null;
      }
    }

    // Timed actions: doors, locks, bagging.
    if (c.action) {
      const act = c.action;
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
    if (e.state === 'calm' || e.state === 'suspicious') this.becomeHostile(e, by);
    if (e.hp <= 0) {
      e.hp = 0;
      e.state = 'down';
      e.route = [];
      this.events.push({ type: 'down', id: e.id, crew: false });
    }
  }

  // ------------------------------------------------------------- enemies

  private visibleCrew(e: Enemy): { c: Crew; d: number } | null {
    let best: Crew | null = null;
    let bd = Infinity;
    for (const c of this.crew) {
      if (c.state === 'down' || c.state === 'escaped') continue;
      const d = dist(c, e);
      if (d > e.range) continue;
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

  private becomeHostile(e: Enemy, target: Vec): void {
    if (e.state === 'hostile' || e.state === 'fleeing' || e.state === 'down' || e.state === 'subdued' || e.state === 'gone') return;
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
    if (e.kind === 'runner') {
      e.state = 'fleeing';
      this.noise(e.x, e.y, 9, 'Shouting', false);
      return;
    }
    e.state = 'hostile';
    if (e.kind === 'dog') this.noise(e.x, e.y, 14, 'Barking', false);
    else this.shout(e, target);
  }

  /** "They're here!" Nearby enemies go hostile and head for the spot. */
  private shout(from: Enemy, target: Vec): void {
    this.events.push({ type: 'noise', x: from.x, y: from.y, r: 10, label: 'Shouting' });
    for (const o of this.enemies) {
      if (o === from || dist(o, from) > 10) continue;
      if (o.state === 'calm' || o.state === 'suspicious') this.becomeHostile(o, target);
    }
  }

  private noise(x: number, y: number, r: number, label: string, loud: boolean): void {
    this.events.push({ type: 'noise', x, y, r, label });
    if (r >= 5) this.policeActive = true;
    for (const e of this.enemies) {
      if (e.state !== 'calm' && e.state !== 'suspicious') continue;
      if (Math.hypot(e.x - x, e.y - y) > r) continue;
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

    if (e.state === 'fleeing') {
      this.walkTo(e, GATE, s.speed, dt);
      if (dist(e, GATE) < 0.3) {
        e.state = 'gone';
        this.police += 0.12;
        if (this.backupT > 15) this.backupT = 15;
      }
      return;
    }

    if (e.state === 'hostile') {
      if (v) {
        e.lastKnown = { x: v.c.x, y: v.c.y };
        e.searchT = 0;
        const a = Math.atan2(v.c.y - e.y, v.c.x - e.x);
        e.facing = turnTowards(e.facing, a, 7 * dt);
        if (e.kind === 'dog') {
          if (v.d > 1.0) this.walkTo(e, v.c, s.speed, dt);
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
        }
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
      if (e.alert >= 1) this.becomeHostile(e, v.c);
      return;
    }
    e.alert = Math.max(0, e.alert - 0.12 * dt);

    if (e.state === 'suspicious') {
      if (e.investigate && dist(e, e.investigate) > 0.6) {
        if (!this.walkTo(e, e.investigate, s.speed * 0.7, dt)) e.investigate = null;
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
        for (let i = 0; i < 2; i++) {
          const e = this.makeEnemy(
            { id: `backup${i}`, kind: 'soldier', name: 'Backup', x: 14.5 + i, y: 0.5, facing: Math.PI / 2, patrol: [] },
            [],
          );
          e.known = false;
          e.state = 'hostile';
          e.lastKnown = { x: 12.5, y: 14.5 };
          this.enemies.push(e);
        }
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
    const enemiesDown = this.enemies.filter((e) => e.state === 'down').length;
    const enemiesSubdued = this.enemies.filter((e) => e.state === 'subdued').length;
    const quiet = !this.everAlerted && this.shots === 0;
    this.outcome = {
      reason,
      take,
      secured,
      escaped,
      left,
      down,
      policeHeat: Math.round(quiet ? 2 + this.police * 10 : 8 + this.police * 30 + enemiesDown * 4 + left.length * 6),
      rivalHeat: Math.round(10 + enemiesDown * 6 + enemiesSubdued * 2 + (this.everAlerted ? 8 : 0)),
      rep: Math.round(take / 1000 + (quiet ? 10 : 0) - left.length * 3 - down.length * 4),
      time: this.time,
      shots: this.shots,
      enemiesDown,
      enemiesSubdued,
    };
  }
}
