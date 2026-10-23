// HTML HUD laid over the canvas. Layout follows the master screens: crew
// column left, clocks top centre, loot or noise top right, tool bar bottom
// centre, Go bottom right.

import type { GoCode } from '../sim/level.ts';
import type { Job } from '../sim/jobs.ts';
import { CREW, type Crew, type Outcome, type Sim, type Waypoint } from '../sim/sim.ts';
import { BURGESS, MAP_H, MAP_W, PARKS, RIVER, ROADS, mapXY } from './cityMap.ts';
import { ICONS, portrait } from './icons.ts';

export interface HudHandlers {
  selectCrew(slot: number): void;
  tool(name: 'kick' | 'undo' | 'clear' | 'sample'): void;
  code(code: GoCode): void;
  go(): void;
  pause(): void;
  speed(): void;
  driveOff(): void;
  start(sample: boolean): void;
  replan(fresh: boolean): void;
  pickJob(id: string): void;
  jobs(): void;
}

/** Where each job sits on the London map. */
const PINS: Record<string, [number, number]> = {
  estate: [51.5245, -0.2005],
  burgess: [51.4822, -0.088],
};

export interface PlanningInfo {
  plans: Waypoint[][];
  selected: number;
  selectedWp: number | null;
  kicks: number;
  picks: number;
}

const el = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

const money = (n: number) => '£' + n.toLocaleString('en-GB');

const CUT: Record<string, number> = { Muscle: 30, Creeper: 26, Lookout: 20, Talker: 24 };

export class Hud {
  private root: HTMLElement;
  private h: HudHandlers;
  private cards: HTMLElement[] = [];
  private topCentre: HTMLElement;
  private topRight: HTMLElement;
  private bar: HTMLElement;
  private goBtn: HTMLElement;
  private hint: HTMLElement;
  private banner: HTMLElement;
  private toasts: HTMLElement;
  private overlay: HTMLElement;
  private mode = '';
  private lastHp: number[] = CREW.map(() => -1);
  private jobTitle = '';

  constructor(root: HTMLElement, handlers: HudHandlers) {
    this.root = root;
    this.h = handlers;
    const col = el('<div class="crew-col"></div>');
    for (const def of CREW) {
      const card = el(`<div class="card panel" style="--col:${def.color}">
        <span class="num" style="color:${def.color}">${def.slot}</span>
        <div class="ring">${portrait(def.name)}</div>
        <div class="info">
          <span class="name">${def.name}</span>
          <span class="role">${def.role}</span>
          <span class="status"></span>
          <span class="badges"></span>
        </div>
        <div class="hp"><i style="width:100%"></i></div>
      </div>`);
      card.addEventListener('click', () => this.h.selectCrew(def.slot));
      col.appendChild(card);
      this.cards.push(card);
    }
    root.appendChild(col);
    this.topCentre = root.appendChild(el('<div class="top-centre"></div>'));
    this.topRight = root.appendChild(el('<div class="top-right panel"></div>'));
    this.bar = root.appendChild(el('<div class="bottom-bar panel"></div>'));
    this.goBtn = root.appendChild(el(`<button class="go">${ICONS.play}<span>GO</span></button>`));
    this.goBtn.addEventListener('click', () => this.h.go());
    this.hint = root.appendChild(el('<div class="hint"></div>'));
    this.banner = root.appendChild(el('<div class="banner panel hidden"></div>'));
    this.toasts = root.appendChild(el('<div class="toasts"></div>'));
    this.overlay = root.appendChild(el('<div class="overlay hidden"></div>'));
  }

  // ------------------------------------------------------------- modes

  /** The job board: London, the jobs on it, and the one picked. */
  showTitle(jobs: Job[], current: string) {
    this.overlay.className = 'overlay board-screen';
    const pins = jobs
      .map((j) => {
        const [x, y] = mapXY(...PINS[j.id]);
        return `<g class="pin" data-job="${j.id}" transform="translate(${x.toFixed(0)} ${y.toFixed(0)})">
          <circle class="pulse" r="16"/><circle class="halo" r="9"/>
          <path class="drop" d="M0 0 C-7 -10 -10 -14 -10 -20 A10 10 0 1 1 10 -20 C10 -14 7 -10 0 0Z"/>
          <path class="house" d="M-5 -19 L0 -24 L5 -19 V-14 H-5Z"/>
          <text y="-34">${j.title.split(',')[0]}</text>
        </g>`;
      })
      .join('');
    const cards = jobs
      .map(
        (j) => `<button class="job panel" data-job="${j.id}">
          <span class="jt">${j.title}</span>
          <span class="jp">${j.place}</span>
          <span class="jb">${j.brief}</span>
          <span class="ji">${j.intel.map((t) => `<i>${t}</i>`).join('')}</span>
          <span class="jh"><b>Heat</b><span class="segs">${Array.from({ length: 5 }, (_, i) => `<i class="${i < j.heat ? 'on' : ''}"></i>`).join('')}</span></span>
        </button>`,
      )
      .join('');
    this.overlay.innerHTML = `<div class="board">
      <div class="board-left">
        <div class="logo">STICKUPKIDS</div>
        <div class="citymap panel">
          <svg viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid slice">
            <defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
            <rect width="${MAP_W}" height="${MAP_H}" class="sea"/>
            <path class="parks" d="${PARKS}"/>
            <path class="roads" d="${ROADS}"/>
            <path class="river" d="${RIVER}"/>
            <path class="river-in" d="${RIVER}"/>
            <path class="burgess" d="${BURGESS}"/>
            ${pins}
          </svg>
          <span class="credit">Map data © OpenStreetMap contributors</span>
        </div>
      </div>
      <div class="board-right">
        <div class="pick">Pick a job</div>
        <div class="jobs">${cards}</div>
        <div class="loading">Loading the job…</div>
        <div class="menu">
          <button data-a="plan">Plan the job</button>
          <button data-a="sample">Load a sample plan</button>
        </div>
        <details class="controls-box"><summary>Controls</summary>
        <div class="controls panel">
          <b>1 to 4</b><span>Pick a crew member (or click their card)</span>
          <b>Click / drag</b><span>Add waypoints to their route. Click a point to select it</span>
          <b>Right click</b><span>Remove the selected point (Backspace also works)</span>
          <b>A, B, C</b><span>Planning: hold the selected point for that go code. Raid: call the code</span>
          <b>K</b><span>Kick locked doors after the selected point (loud but fast). Otherwise they get picked</span>
          <b>Enter</b><span>Go</span>
          <b>Space</b><span>Pause the raid. While paused, click to redraw the selected crew member's route</span>
          <b>F</b><span>Toggle speed</span>
          <b>Wheel, arrows</b><span>Zoom and pan the camera (middle-drag pans too)</span>
        </div></details>
      </div>
    </div>`;
    this.overlay.querySelectorAll<HTMLElement>('.menu button').forEach((b) => b.addEventListener('click', () => this.h.start(b.dataset.a === 'sample')));
    this.overlay.querySelectorAll<HTMLElement | SVGElement>('[data-job]').forEach((b) =>
      b.addEventListener('click', () => this.h.pickJob((b as HTMLElement).dataset.job!)),
    );
    this.selectJob(current);
  }

  /** Mark the picked job on the board. */
  selectJob(id: string) {
    this.overlay.querySelectorAll<HTMLElement | SVGElement>('[data-job]').forEach((b) => b.classList.toggle('sel', (b as HTMLElement).dataset.job === id));
  }

  /** The job being planned, for the top of the screen. */
  setJob(job: Job) {
    this.jobTitle = job.title;
    this.mode = '';
  }

  /** The level has loaded: drop the loading note. */
  loaded(on = true) {
    document.body.classList.toggle('loaded', on);
  }

  hideOverlay() {
    this.overlay.className = 'overlay hidden';
    this.overlay.innerHTML = '';
  }

  setMode(mode: 'planning' | 'raid' | 'results') {
    if (mode === this.mode) return;
    this.mode = mode;
    this.goBtn.classList.toggle('hidden', mode !== 'planning');
    this.banner.classList.add('hidden');
    if (mode === 'planning') {
      this.topCentre.innerHTML = `<div class="job-now panel"><div class="t">${this.jobTitle}</div><div class="s">Planning. Time is frozen.</div></div>`;
      this.topRight.innerHTML = `<span title="Noise estimate">${ICONS.noise}</span><div class="segs" style="--seg:var(--c1)">${'<i></i>'.repeat(8)}</div><span class="noise-lbl">Quiet</span><span class="sep"></span><span title="Getaway van parked">${ICONS.car}</span>`;
      this.bar.innerHTML = `
        <button class="tool" data-t="kick" title="Kick locked doors after this point (K)">${ICONS.boot}<span class="k">K</span></button>
        <span class="sep"></span>
        ${(['A', 'B', 'C'] as const).map((c) => `<button class="tool code diamond" data-c="${c}" title="Hold here until go code ${c}"><span><b>${c}</b></span></button>`).join('')}
        <span class="sep"></span>
        <button class="tool" data-t="undo" title="Remove point (Backspace)">${ICONS.undo}</button>
        <button class="tool" data-t="clear" title="Clear this route">${ICONS.clear}</button>
        <span class="sep"></span>
        <button class="tool wide" data-t="sample" title="Load a sample plan">Sample plan</button>
        <span class="sep"></span>
        <button class="tool" data-j="jobs" title="Back to the job board">${ICONS.home}<span class="cap">Jobs</span></button>`;
    } else if (mode === 'raid') {
      this.topCentre.innerHTML = `
        <div class="clock panel" data-k="police">${ringSvg('#FF3B4E')}<span class="ico">${ICONS.siren}</span><span class="lbl">Police</span></div>
        <div class="clock panel" data-k="backup">${ringSvg('#ffffff')}<span class="ico">${ICONS.phone}</span><span class="lbl">Backup</span></div>`;
      this.topRight.innerHTML = `<span style="color:var(--loot)">${ICONS.cash}</span><div class="segs">${'<i></i>'.repeat(10)}</div><span class="amt">£0</span>`;
      this.bar.innerHTML = `
        <button class="tool" data-r="pause" title="Pause (Space)">${ICONS.pause}</button>
        <button class="tool" data-r="speed" title="Speed (F)">${ICONS.fast}<span class="k">1x</span></button>
        <span class="sep"></span>
        ${(['A', 'B', 'C'] as const).map((c) => `<button class="tool code round" data-c="${c}" title="Call go code ${c}"><span>${c}</span></button>`).join('')}
        <span class="sep"></span>
        <button class="tool" data-r="drive" title="Drive off with whoever is at the van">${ICONS.car}<span class="cap">Leave</span></button>`;
    } else {
      this.topCentre.innerHTML = '';
      this.topRight.innerHTML = '';
      this.bar.innerHTML = '';
    }
    this.topRight.classList.toggle('hidden', mode === 'results');
    this.bar.classList.toggle('hidden', mode === 'results');
    this.bar.querySelectorAll<HTMLElement>('[data-t]').forEach((b) =>
      b.addEventListener('click', () => this.h.tool(b.dataset.t as 'kick')),
    );
    this.bar.querySelectorAll<HTMLElement>('[data-c]').forEach((b) =>
      b.addEventListener('click', () => this.h.code(b.dataset.c as GoCode)),
    );
    this.bar.querySelector('[data-j]')?.addEventListener('click', () => this.h.jobs());
    this.bar.querySelectorAll<HTMLElement>('[data-r]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = b.dataset.r;
        if (r === 'pause') this.h.pause();
        else if (r === 'speed') this.h.speed();
        else this.h.driveOff();
      }),
    );
  }

  // ----------------------------------------------------------- updates

  updatePlanning(info: PlanningInfo) {
    this.setMode('planning');
    this.cards.forEach((card, i) => {
      const plan = info.plans[i];
      card.classList.toggle('sel', info.selected === i + 1);
      card.classList.remove('down');
      const holds = [...new Set(plan.filter((w) => w.hold).map((w) => w.hold))];
      const status = plan.length <= 1 ? 'No route yet' : `${plan.length - 1} point${plan.length > 2 ? 's' : ''}${holds.length ? ' · holds ' + holds.join(', ') : ''}`;
      setText(card.querySelector('.status')!, status);
      setHtml(card.querySelector('.badges')!, plan.some((w) => w.kick) ? `<span title="Kicks doors">${ICONS.boot}</span>` : '');
      (card.querySelector('.hp i') as HTMLElement).style.width = '100%';
    });
    const sel = info.plans[info.selected - 1];
    const wpIdx = info.selectedWp ?? sel.length - 1;
    const wp = sel[wpIdx];
    const col = CREW[info.selected - 1].color;
    this.bar.style.setProperty('--selcol', col);
    this.bar.querySelector('[data-t="kick"]')?.classList.toggle('on', !!wp?.kick);
    this.bar.querySelectorAll<HTMLElement>('[data-c]').forEach((b) => b.classList.toggle('on', wp?.hold === b.dataset.c));
    const loud = info.kicks;
    const segs = this.topRight.querySelectorAll('.segs i');
    const lit = Math.min(segs.length, 1 + info.picks + loud * 3);
    segs.forEach((s, i) => s.classList.toggle('on', i < lit));
    (this.topRight.querySelector('.segs') as HTMLElement).style.setProperty('--seg', loud ? 'var(--c4)' : 'var(--c1)');
    setText(this.topRight.querySelector('.noise-lbl')!, loud ? (loud > 1 ? 'Very loud' : 'Loud') : 'Quiet');
    const name = CREW[info.selected - 1].name;
    setText(
      this.hint,
      info.selectedWp !== null
        ? `Point ${info.selectedWp} of ${name}'s route selected. A, B or C to hold here for a go code, K to kick doors after it.`
        : `Click the map to add waypoints for ${name}. Drag to draw. Click a point to select it. Right click removes a point.`,
    );
  }

  updateRaid(sim: Sim, paused: boolean, speed: number, selected: number) {
    this.setMode('raid');
    sim.crew.forEach((c, i) => {
      const card = this.cards[i];
      card.classList.toggle('sel', selected === i + 1);
      card.classList.toggle('down', c.state === 'down');
      setText(card.querySelector('.status')!, crewStatus(c, sim));
      const badges = [];
      if (c.carrying.length) badges.push(`<span class="bag" title="Carrying loot">${ICONS.bag}</span>`);
      if (c.action?.kind === 'pick') badges.push(`<span title="Picking a lock">${ICONS.lock}</span>`);
      setHtml(card.querySelector('.badges')!, badges.join(''));
      (card.querySelector('.hp i') as HTMLElement).style.width = `${(100 * c.hp) / c.maxHp}%`;
      if (this.lastHp[i] >= 0 && c.hp < this.lastHp[i]) {
        card.classList.remove('hit');
        void card.offsetWidth;
        card.classList.add('hit');
      }
      this.lastHp[i] = c.hp;
    });
    const setRing = (k: string, v: number) => {
      const c = this.topCentre.querySelector(`[data-k="${k}"] circle.fg`) as SVGCircleElement | null;
      if (c) c.style.strokeDashoffset = String(201 * (1 - Math.max(0, Math.min(1, v))));
    };
    setRing('police', sim.police);
    setRing('backup', sim.backupProgress);
    const total = sim.loot.reduce((s, l) => s + l.def.value, 0);
    const got = sim.loot.filter((l) => l.state !== 'placed').reduce((s, l) => s + l.def.value, 0);
    const segs = this.topRight.querySelectorAll('.segs i');
    segs.forEach((s, i) => s.classList.toggle('on', i < Math.round((got / total) * segs.length)));
    setText(this.topRight.querySelector('.amt')!, money(got));
    const pauseBtn = this.bar.querySelector('[data-r="pause"]');
    if (pauseBtn) setHtml(pauseBtn as HTMLElement, paused ? ICONS.play : ICONS.pause);
    const sp = this.bar.querySelector('[data-r="speed"] .k');
    if (sp) setText(sp as HTMLElement, `${speed}x`);
    this.bar.querySelectorAll<HTMLElement>('[data-c]').forEach((b) => b.classList.toggle('fired', sim.codes.has(b.dataset.c as GoCode)));
    this.banner.classList.toggle('hidden', !paused);
    setText(this.banner, 'Paused');
    const name = CREW[selected - 1].name;
    setText(
      this.hint,
      paused
        ? `Paused. Click the map to give ${name} a new route from where they stand. Space to carry on.`
        : 'Space to pause and redraw routes. Call go codes with A, B and C. Get everyone to the van.',
    );
  }

  toast(text: string, color = '#ffffff') {
    const t = el(`<div class="toast panel" style="--tc:${color}"></div>`);
    t.textContent = text;
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 3300);
    while (this.toasts.children.length > 5) this.toasts.firstElementChild?.remove();
  }

  showResults(o: Outcome, sim: Sim) {
    this.setMode('results');
    this.hint.textContent = '';
    const reason = {
      escaped: 'Clean getaway',
      droveOff: 'Drove off',
      police: 'Police arrived',
      wiped: 'Crew wiped out',
    }[o.reason];
    const items = sim.loot
      .map((l) => {
        const got = o.secured.includes(l.def.id);
        const icon = l.def.id === 'bag' ? ICONS.bag : l.def.id === 'product' ? productIcon() : ICONS.cash;
        return `<div class="item ${got ? '' : 'lost'}">${icon}<span>${l.def.value.toLocaleString('en-GB')}</span><small>${l.def.id === 'bag' ? 'Stash bag' : l.def.id === 'product' ? 'Product' : 'Cash'}</small></div>`;
      })
      .join('');
    const shares = sim.crew.map((c) => (o.escaped.includes(c.def.slot) ? CUT[c.def.role] : 0));
    const sum = shares.reduce((a, b) => a + b, 0) || 1;
    const cuts = sim.crew
      .map((c, i) => {
        const pct = Math.round((shares[i] / sum) * 100);
        const tag = o.down.includes(c.def.slot) ? 'Down' : o.left.includes(c.def.slot) ? 'Left behind' : '';
        return `<div class="cut" style="--col:${c.def.color}"><div class="ring">${portrait(c.def.name)}</div>
          <div><div class="bar"><i style="width:${pct}%"></i></div>${tag ? `<span class="tag">${tag}</span>` : ''}</div>
          <span class="pct">${o.take ? pct : 0}%</span></div>`;
      })
      .join('');
    const bar = (v: number, col: string) =>
      `<div class="segs">${Array.from({ length: 10 }, (_, i) => `<i class="${i < v ? 'on' : ''}" style="--seg:${col}"></i>`).join('')}</div>`;
    const stars = Math.max(0, Math.min(5, Math.round(o.rep / 6)));
    this.overlay.className = 'overlay';
    this.overlay.innerHTML = `
      <div class="results">
        <div class="res-left panel">
          <div class="take">${money(o.take)}</div>
          <div class="reason">${reason} · ${fmtTime(o.time)}</div>
          <div class="items">${items}</div>
          ${cuts}
        </div>
        <div class="res-right panel">
          <div class="fall"><span>${ICONS.siren}</span>${bar(Math.round(o.policeHeat / 6), '#22E3FF')}<span class="lbl">Police heat +${o.policeHeat}</span></div>
          <div class="fall"><span style="color:var(--enemy)">${ICONS.mask}</span>${bar(Math.round(o.rivalHeat / 5), '#FF3B4E')}<span class="lbl">Rival crew heat +${o.rivalHeat}</span></div>
          <div class="fall"><span>${ICONS.crew}</span><div class="stars">${Array.from({ length: 5 }, (_, i) => (i < stars ? ICONS.starFill : ICONS.star)).join('')}</div><span class="lbl">Reputation ${o.rep >= 0 ? '+' : ''}${o.rep}</span></div>
          <div class="fall" style="border:0"><span></span><div style="font:400 13px/1.5 var(--body);color:#b8c6e6">
            ${o.shots ? `${o.shots} shots fired. ` : 'No shots fired. '}${o.enemiesSubdued} held up, ${o.enemiesDown} put down.</div></div>
        </div>
      </div>
      <div class="res-buttons">
        <button data-a="replan">${ICONS.redo}Replan this job</button>
        <button data-a="fresh">${ICONS.clear}Start over</button>
        <button data-a="jobs">${ICONS.home}Pick another job</button>
      </div>`;
    this.overlay.querySelectorAll<HTMLElement>('[data-a]').forEach((b) =>
      b.addEventListener('click', () => (b.dataset.a === 'jobs' ? this.h.jobs() : this.h.replan(b.dataset.a === 'fresh'))),
    );
  }
}

function ringSvg(color: string) {
  return `<svg class="ringsvg" viewBox="0 0 74 74"><circle cx="37" cy="37" r="32" stroke="rgba(255,255,255,0.12)" stroke-width="5" fill="none"/><circle class="fg" cx="37" cy="37" r="32" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="201" stroke-dashoffset="201" style="transition:stroke-dashoffset .2s;filter:drop-shadow(0 0 4px ${color})"/></svg>`;
}

function productIcon() {
  return `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 8l9-4 9 4-9 4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/></svg>`;
}

function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setText(e: Element, s: string) {
  if (e.textContent !== s) e.textContent = s;
}

function setHtml(e: Element, s: string) {
  if (e.innerHTML !== s) e.innerHTML = s;
}

function crewStatus(c: Crew, sim: Sim): string {
  const pct = c.action ? ` ${Math.round((100 * c.action.t) / c.action.total)}%` : '';
  switch (c.state) {
    case 'down':
      return 'Down';
    case 'escaped':
      return 'In the van';
    case 'hold':
      return `Holding for ${c.plan[c.wp]?.hold}`;
    case 'fight':
      return 'Engaging';
    case 'door':
      return 'Opening door';
    case 'pick':
      return 'Picking lock' + pct;
    case 'kick':
      return 'Kicking door';
    case 'loot':
      return 'Bagging' + pct;
    case 'idle':
      return 'Waiting';
    default: {
      if (c.aimId) {
        const e = sim.enemies.find((x) => x.id === c.aimId);
        return `Holding up ${e?.def.name.toLowerCase() ?? 'someone'}`;
      }
      return c.carrying.length ? 'Moving with loot' : 'Moving';
    }
  }
}
