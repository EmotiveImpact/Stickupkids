// Plays a finished raid again from what it started with and the orders
// given during it. The simulation is seeded and steps at a fixed rate, so
// the replay matches the raid step for step, shots and all.

import type { Level } from './level.ts';
import { Sim, type SimInput, type Waypoint } from './sim.ts';

export interface Recording {
  seed: number;
  plans: Waypoint[][];
  inputs: SimInput[];
  /** The fixed step the raid ran at, and how many steps it took. */
  dt: number;
  ticks: number;
}

/** Everything needed to play a raid again. `dt` is the step it was run at. */
export function record(sim: Sim, dt: number): Recording {
  return {
    seed: sim.seed,
    plans: sim.startPlans.map((p) => p.map((w) => ({ ...w }))),
    inputs: sim.inputs.map((i) => (i.kind === 'orders' ? { ...i, orders: i.orders.map((w) => ({ ...w })) } : { ...i })),
    dt,
    ticks: sim.ticks,
  };
}

export class Replay {
  readonly level: Level;
  readonly rec: Recording;
  readonly sim: Sim;
  private next = 0;

  constructor(level: Level, rec: Recording) {
    this.level = level;
    this.rec = rec;
    this.sim = new Sim(level, rec.plans, rec.seed);
  }

  /** Played to the end: every step taken and every order given. */
  get done(): boolean {
    return this.sim.outcome !== null || (this.sim.ticks >= this.rec.ticks && this.next >= this.rec.inputs.length);
  }

  /** Share of the raid played so far. */
  get progress(): number {
    return Math.min(1, this.sim.ticks / Math.max(1, this.rec.ticks));
  }

  /** The orders given before the next step, then the step. */
  step(): void {
    const s = this.sim;
    const inputs = this.rec.inputs;
    while (this.next < inputs.length && inputs[this.next].tick <= s.ticks) {
      const i = inputs[this.next++];
      if (i.kind === 'code') s.callCode(i.code);
      else if (i.kind === 'orders') s.setOrders(i.slot, i.orders.map((w) => ({ ...w })));
      else s.driveOff();
    }
    if (!s.outcome && s.ticks < this.rec.ticks) s.step(this.rec.dt);
  }
}
