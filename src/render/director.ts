// The replay camera: picks whoever the action is happening to, frames them
// with whoever is close by, and moves on when something bigger happens to
// someone else. Pans when the next subject is near, cuts when they are far.

import type { Sim, SimEvent } from '../sim/sim.ts';
import type { Vec } from '../sim/level.ts';

export interface Shot {
  x: number;
  y: number;
  /** Zoom, in CSS pixels a metre. */
  ppm: number;
}

/** How long a burst of action keeps the camera's interest, in seconds. */
const MEMORY = 2.5;
/** Stay on someone at least this long before moving on. */
const DWELL = 2.5;
/** Further than this and the camera cuts rather than pans. */
const CUT = 30;
/** People within this of the subject are in the shot. */
const GROUP = 12;

export class Director {
  private interest = [0, 0, 0, 0];
  private subject = -1;
  private dwell = 0;
  private shot: Shot | null = null;

  reset() {
    this.interest = [0, 0, 0, 0];
    this.subject = -1;
    this.dwell = 0;
    this.shot = null;
  }

  /** Where to look this frame, for a view `w` by `h` CSS pixels. */
  update(dt: number, sim: Sim, events: SimEvent[], w: number, h: number): Shot {
    const crew = sim.crew;
    const k = Math.exp(-dt / MEMORY);
    this.interest = this.interest.map((v) => v * k);
    const nearest = (p: Vec, within = 20) => {
      let best = -1;
      let bd = within;
      crew.forEach((c, i) => {
        if (c.state === 'escaped') return;
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return best;
    };
    const enemyAt = (id: string): Vec | null => sim.enemies.find((e) => e.id === id) ?? null;
    const add = (i: number, v: number) => {
      if (i >= 0) this.interest[i] += v;
    };
    for (const ev of events) {
      if (ev.type === 'shot') add(nearest(ev.byCrew ? ev.from : ev.to, 25), 3);
      else if (ev.type === 'say') add(ev.slot ? ev.slot - 1 : nearest(ev), 2.5);
      else if (ev.type === 'alert') add(nearest(ev), 2);
      else if (ev.type === 'loot') add(ev.slot - 1, 2.5);
      else if (ev.type === 'door') add(nearest(ev, 3), 1);
      else if (ev.type === 'down') {
        if (ev.crew) add(Number(ev.id) - 1, 4);
        else {
          const e = enemyAt(ev.id);
          if (e) add(nearest(e, 30), 3);
        }
      } else if ('id' in ev) {
        const e = enemyAt(ev.id);
        if (e) add(nearest(e), ev.type === 'surrender' ? 2 : 3);
      }
    }

    // Moving and busy hands hold a little interest of their own.
    const score = crew.map((c, i) => {
      if (c.state === 'escaped') return -1;
      const busy = c.state === 'pick' || c.state === 'loot' || c.state === 'fight' || c.aimId ? 0.6 : c.state === 'moving' || c.state === 'kick' || c.state === 'door' ? 0.3 : 0;
      return this.interest[i] + (c.state === 'down' ? 0 : busy);
    });
    this.dwell += dt;
    let best = 0;
    score.forEach((v, i) => {
      if (v > score[best]) best = i;
    });
    const cur = this.subject >= 0 ? score[this.subject] : -1;
    const gone = this.subject < 0 || crew[this.subject].state === 'escaped';
    if (best !== this.subject && score[best] >= 0 && (gone || (this.dwell > DWELL && score[best] > cur * 1.4 + 0.2))) {
      this.subject = best;
      this.dwell = 0;
    }

    // Everyone still about within reach of the subject, crew and threats both.
    const s = this.subject >= 0 ? crew[this.subject] : crew[0];
    const pts: Vec[] = [s];
    for (const c of crew) if (c !== s && c.state !== 'escaped' && Math.hypot(c.x - s.x, c.y - s.y) < GROUP) pts.push(c);
    for (const e of sim.enemies) {
      const live = e.state === 'hostile' || e.state === 'standoff' || e.state === 'fleeing' || e.state === 'calling' || e.state === 'suspicious';
      if (live && Math.hypot(e.x - s.x, e.y - s.y) < GROUP) pts.push(e);
    }
    const x0 = Math.min(...pts.map((p) => p.x));
    const x1 = Math.max(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y));
    const y1 = Math.max(...pts.map((p) => p.y));
    const short = Math.min(w, h);
    // From close enough to read a face to about 34 m across the short side.
    const close = short / 13;
    const wide = short / 34;
    const want = Math.min(w / (x1 - x0 + 9), h / ((y1 - y0 + 9) * 0.8));
    const target: Shot = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, ppm: Math.max(wide, Math.min(close, want)) };

    if (!this.shot || Math.hypot(target.x - this.shot.x, target.y - this.shot.y) > CUT) this.shot = target;
    else {
      const m = 1 - Math.exp(-dt * 2.2);
      const z = 1 - Math.exp(-dt * 1.2);
      this.shot = {
        x: this.shot.x + (target.x - this.shot.x) * m,
        y: this.shot.y + (target.y - this.shot.y) * m,
        ppm: this.shot.ppm + (target.ppm - this.shot.ppm) * z,
      };
    }
    return this.shot;
  }
}
