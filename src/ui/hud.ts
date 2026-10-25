// HTML HUD laid over the canvas, in the pitch deck's look: near-black, a
// hairline frame, small grey labels, Inter Light, and one accent (sodium
// orange) for selections, key numbers and heat. Crew colours stay on the
// routes, the rings and the line under each portrait.
//
// Planning: the crew down the right, the tools along the bottom, Go bottom
// right. Raid and replay: a timeline across the top, the crew bottom left,
// the controls bottom right.

import type { GoCode, JobMode, Level } from '../sim/level.ts';
import type { Job } from '../sim/jobs.ts';
import { CREW, type Crew, type Outcome, type Sim, type Waypoint } from '../sim/sim.ts';
import { BURGESS, MAP_H, MAP_W, PARKS, RIVER, ROADS, mapXY } from './cityMap.ts';
import { ICONS } from './icons.ts';
import { fit } from './viewport.ts';

export interface HudHandlers {
  selectCrew(slot: number): void;
  tool(name: 'kick' | 'undo' | 'clear' | 'sample' | 'hand'): void;
  code(code: GoCode): void;
  go(): void;
  pause(): void;
  speed(): void;
  driveOff(): void;
  start(sample: boolean): void;
  replan(fresh: boolean): void;
  pickJob(id: string): void;
  jobs(): void;
  replay(action: ReplayAction): void;
  /** The HUD has moved: keep the map clear of it by this much on each side, in CSS pixels. */
  layout(insets: Insets): void;
}

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type ReplayAction = 'watch' | 'play' | 'restart' | 'speed' | 'follow' | 'clip' | 'back';

export interface ReplayInfo {
  playing: boolean;
  speed: number;
  follow: boolean;
  /** Seconds played, of how many. */
  time: number;
  total: number;
  /** Clips can be recorded in this browser. */
  clips: boolean;
}

/** Menu art, made with ChatGPT (2560 by 1440 masters in /mnt/project-files/menu-art/), graded by art/grade_menu.py. */
const TITLE_ART = 'menu/title-hero.jpg';
/** The title montage: nineteen Kling 3.0 shots (Sunra) cut on the beat at 140 BPM in black and white with red and blue lights kept (art/title-loop/drill_montage.py). The poster is its first beat. */
const TITLE_MONTAGE = 'menu/title-montage';
/** MP4 for Safari, WebM for browsers built without H.264. */
const sources = (stem: string) => `<source src="${stem}.mp4" type="video/mp4"><source src="${stem}.webm" type="video/webm">`;
/** Specks that scuff the name like a film poster, as a mask (set inline so the path is relative to the page). */
const GRIT = 'menu/grit.png';
const JOB_ART: Record<string, string> = {
  estate: 'menu/job-harrow-road.jpg',
  burgess: 'menu/job-burgess-park.jpg',
  rideout: 'menu/job-burgess-park.jpg',
  slid: 'menu/job-harrow-road.jpg',
  aylesbury: 'menu/job-aylesbury.jpg',
  elephant: 'menu/job-elephant-arches.jpg',
  brixton: 'menu/job-brixton-market.jpg',
  peckham: 'menu/job-rye-lane.jpg',
  brockwell: 'menu/job-brockwell-park.jpg',
};
const artFor = (id: string) => JOB_ART[id] ?? TITLE_ART;
/** Behind the results: a wet estate at night, one for each kind of job. */
const RESULT_ART: Record<JobMode, string> = {
  stickup: 'menu/results.jpg',
  rideout: 'menu/results-rideout.jpg',
  slid: 'menu/results-slid.jpg',
};
/** Behind each motive on the mode screen: stills from the pitch deck and the title montage, shown in black and white. */
const MODE_ART: Record<JobMode | 'story', string> = {
  story: 'menu/mode-story.jpg',
  stickup: 'menu/mode-stickup.jpg',
  rideout: 'menu/mode-rideout.jpg',
  slid: 'menu/mode-slid.jpg',
};
const tileOf = (name: string) => `portraits/${name.toLowerCase()}-tile.jpg`;

/** Where each job sits on the London map. */
const PINS: Record<string, [number, number]> = {
  estate: [51.5245, -0.2005],
  burgess: [51.4822, -0.088],
  aylesbury: [51.4866, -0.0852],
  elephant: [51.4926, -0.0989],
  brixton: [51.4618, -0.1146],
  peckham: [51.4708, -0.0672],
  brockwell: [51.4530, -0.1063],
  rideout: [51.4818, -0.0815],
  slid: [51.4893, -0.0915],
};

/** What each kind of job is called on the board. */
const MODE_TAG: Record<JobMode, string> = { stickup: 'Stick-up', rideout: 'Ride out', slid: 'They slid' };

/** How a job ended, in a few words. */
export const REASON: Record<string, string> = {
  escaped: 'Clean getaway',
  droveOff: 'Drove off',
  police: 'Police arrived',
  wiped: 'Crew wiped out',
  heldIt: 'Held it down',
  robbed: 'They took the lot',
};

export interface PlanningInfo {
  plans: Waypoint[][];
  selected: number;
  selectedWp: number | null;
  kicks: number;
  picks: number;
  /** They Slid: doors braced, of how many. */
  barricades: number;
  maxBarricades: number;
}

const el = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

const money = (n: number) => '£' + n.toLocaleString('en-GB');
/** £18,400 as £18.4K, for the board. */
const short = (n: number) => (n >= 1000 ? `£${(Math.round(n / 100) / 10).toLocaleString('en-GB')}K` : money(n));

/** "Mid-terrace, Harrow Road": the place is the name, what is there is the line under it. */
function splitTitle(title: string): [what: string, where: string] {
  const i = title.indexOf(',');
  return i < 0 ? ['', title] : [title.slice(0, i).trim(), title.slice(i + 1).trim()];
}

const CUT: Record<string, number> = { Muscle: 30, Creeper: 26, Lookout: 20, Talker: 24 };

const CONTROLS = `
  <b>1 to 4</b><span>Pick a crew member (or click their picture)</span>
  <b>Click / drag</b><span>Add waypoints to their route. Click a point to select it</span>
  <b>Right click</b><span>Remove the selected point (Backspace also works)</span>
  <b>A, B, C</b><span>Hold the selected point for that go code. In the raid, with no point picked: call the code</span>
  <b>K</b><span>Kick locked doors after the selected point (loud but fast). Otherwise they get picked</span>
  <b>Enter</b><span>Go</span>
  <b>Space</b><span>Pause the raid. While paused, redraw a crew member's route, move points, add holds</span>
  <b>Crew, then map</b><span>In the raid without pausing: click a crew member, then where they should go</span>
  <b>F</b><span>Toggle speed</span>
  <b>Wheel, arrows</b><span>Zoom and pan the camera (middle-drag pans too)</span>`;

type Mode = 'planning' | 'raid' | 'results' | 'replay';

export class Hud {
  private root: HTMLElement;
  private h: HudHandlers;
  private frame: HTMLElement;
  private crewCol: HTMLElement;
  private tiles: HTMLElement[] = [];
  private topLeft: HTMLElement;
  private topBar: HTMLElement;
  private topRight: HTMLElement;
  private strip: HTMLElement;
  private bar: HTMLElement;
  private goBtn: HTMLElement;
  private hint: HTMLElement;
  private banner: HTMLElement;
  private toasts: HTMLElement;
  private overlay: HTMLElement;
  private mode: Mode | '' = '';
  private lastHp: number[] = CREW.map(() => -1);
  private jobId = '';
  private jobTitle = '';
  private jobMode: JobMode = 'stickup';
  /** Every job, for the mode screen and the board. */
  private allJobs: Job[] = [];
  /** The level being planned, for the numbers on the job board. */
  private level: Level | null = null;
  private cine: HTMLElement | null = null;
  private stories: HTMLElement;
  /** The jobs on the board. */
  private boardJobs: Job[] = [];
  /** A level too big for one screen: the hints say how to get about. */
  big = false;

  constructor(root: HTMLElement, handlers: HudHandlers) {
    this.root = root;
    this.h = handlers;
    this.frame = root.appendChild(el('<div class="hud-frame"></div>'));
    this.crewCol = root.appendChild(el('<div class="crew-col"></div>'));
    for (const def of CREW) {
      const tile = el(`<div class="tile" style="--col:${def.color}">
        <img class="ph" src="${tileOf(def.name)}" alt="${def.name}" draggable="false" />
        <span class="num">${def.slot}</span>
        <span class="badges"></span>
        <div class="cap"><span class="name">${def.name}</span><span class="role">${def.role}</span><span class="status"></span></div>
        <div class="hp"><i style="width:100%"></i></div>
      </div>`);
      tile.addEventListener('click', () => this.h.selectCrew(def.slot));
      this.crewCol.appendChild(tile);
      this.tiles.push(tile);
    }
    this.topLeft = root.appendChild(el('<div class="top-left"></div>'));
    this.topBar = root.appendChild(el('<div class="topbar"></div>'));
    this.topRight = root.appendChild(el('<div class="top-right"></div>'));
    this.strip = root.appendChild(el('<div class="strip"></div>'));
    this.bar = this.strip.appendChild(el('<div class="bar"></div>'));
    this.hint = this.strip.appendChild(el('<div class="hint"></div>'));
    this.goBtn = this.strip.appendChild(el(`<button class="go">${ICONS.play}<span>Go</span></button>`));
    this.goBtn.addEventListener('click', () => this.h.go());
    this.banner = root.appendChild(el('<div class="banner hidden"></div>'));
    this.stories = root.appendChild(el('<div class="stories panel hidden"></div>'));
    this.toasts = root.appendChild(el('<div class="toasts"></div>'));
    this.overlay = root.appendChild(el('<div class="overlay hidden"></div>'));
    addEventListener('resize', () => this.layout());
  }

  // ------------------------------------------------------------- modes

  /** The title screen, in the pitch deck's look: the drill montage runs behind the name. A click or any key goes on to Choose your motive. */
  showSplash(jobs: Job[], current: string) {
    this.overlay.className = 'overlay splash';
    this.overlay.innerHTML = `<div class="stage">
        <video class="crew-bg" poster="${TITLE_MONTAGE}.webp" autoplay muted loop playsinline>${sources(TITLE_MONTAGE)}</video>
        <div class="fade-top"></div><div class="fade-bottom"></div>
        <h1 class="title-word" style="-webkit-mask-image:url(${GRIT});mask-image:url(${GRIT})">STICKUPKIDS</h1>
      </div>
      <div class="frame"></div>
      <span class="corner tl">Stickupkids</span><span class="corner tr">South London · Season One</span>
      <p class="strap">Plan the move · Kick off the door · Rob the ting · <span>Pray nobody snitched</span></p>
      <span class="press">Press any key to continue</span>`;
    const go = () => {
      removeEventListener('keydown', key);
      if (this.overlay.classList.contains('splash')) this.showModes(jobs, current);
    };
    const key = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      go();
    };
    addEventListener('keydown', key);
    // A click anywhere counts as a key.
    this.overlay.addEventListener('click', go, { once: true });
    // Hold the reveal until the pictures are in and the level has loaded, so the page is not too busy to play it.
    const overlay = this.overlay;
    const pictures = Promise.all([...overlay.querySelectorAll('img')].map((i) => i.decode().catch(() => undefined)));
    const level = new Promise<void>((done) => {
      if (document.body.classList.contains('loaded')) return done();
      const watch = new MutationObserver(() => document.body.classList.contains('loaded') && (watch.disconnect(), done()));
      watch.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      setTimeout(() => (watch.disconnect(), done()), 8000);
    });
    Promise.all([pictures, level, document.fonts.ready]).then(() => requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('reveal'))));
  }

  /** Choose your motive: four slanted photo strips, the picked one slid open with its name outlined big behind it. A motive opens its jobs on the board. */
  showModes(jobs: Job[], current: string) {
    this.overlay.className = 'overlay modes';
    this.allJobs = jobs;
    const of = (m: JobMode) => jobs.filter((j) => (j.mode ?? 'stickup') === m);
    const one = (m: JobMode) => of(m)[0];
    const motives: { id: JobMode | 'story'; name: string; k: string; line: string; meta: [string, string][]; cta: string }[] = [
      { id: 'story', name: 'Story', k: 'Season One', line: 'Two of you and a borrowed flat. Build the crew from nothing.', meta: [['Starts with', '2 of you'], ['Status', 'In the works']], cta: 'Coming soon' },
      { id: 'stickup', name: 'Stickup', k: `Jobs · ${of('stickup').length} on the board`, line: 'Plan it, kick the door, get the bag and get out.', meta: [['On the board', String(of('stickup').length)], ['Across', 'South London']], cta: 'Open the board' },
      { id: 'rideout', name: 'Ride Out', k: 'Hit back', line: 'They moved on yours. Find them before they find you.', meta: [['Where', one('rideout')?.place.split(',').pop()?.trim() ?? ''], ['Heat', `${one('rideout')?.heat ?? 0} of 5`]], cta: 'Ride' },
      { id: 'slid', name: 'They Slid', k: 'Defend', line: "They're at your door. Hold the trap till it's done.", meta: [['Where', 'The trap, East Street'], ['Waves', '3']], cta: 'Hold it down' },
    ];
    const strips = motives
      .map(
        (m, i) => `<div class="mstrip${m.id === 'story' ? ' soon' : ''}" data-m="${m.id}">
          <img src="${MODE_ART[m.id]}" alt="" draggable="false"><div class="dim"></div><div class="tint"></div>
          <div class="side"><span>${String(i + 1).padStart(2, '0')}</span><b>${m.name}</b></div>
          <div class="ghost">${m.name}</div>
          <div class="open"><span class="k">${m.k}</span><h2>${m.name}</h2><p>${m.line}</p>
            <div class="meta">${m.meta.map(([a, b]) => `<div><em>${a}</em><span>${b}</span></div>`).join('')}</div>
            <button class="mgo"${m.id === 'story' ? ' disabled' : ''}>${m.cta}${m.id === 'story' ? '' : ' ▸'}</button></div>
        </div>`,
      )
      .join('');
    this.overlay.innerHTML = `<div class="mstrips">${strips}</div><div class="scan"></div>
      <div class="mtab">Choose your motive</div>
      <div class="mhead"><button class="back">◂ Back</button><span class="wm">Stickup<i>kids</i></span><span class="lab">South London · 4 crew</span></div>`;
    const list = [...this.overlay.querySelectorAll<HTMLElement>('.mstrip')];
    const start = list.findIndex((x) => x.dataset.m === (jobs.find((j) => j.id === current)?.mode ?? 'stickup'));
    let at = -1;
    const pick = (i: number) => {
      i = (i + list.length) % list.length;
      if (i === at) return;
      at = i;
      list.forEach((x, j) => x.classList.toggle('on', j === i));
      this.overlay.classList.remove('glitch');
      void this.overlay.offsetWidth;
      this.overlay.classList.add('glitch');
    };
    const open = (m: string | undefined) => {
      if (!m || m === 'story') return;
      removeEventListener('keydown', key);
      this.openBoard(m as JobMode, current);
    };
    const key = (e: KeyboardEvent) => {
      if (!this.overlay.classList.contains('modes')) return removeEventListener('keydown', key);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') pick(at + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') pick(at - 1);
      else if (e.key === 'Enter' || e.key === ' ') open(list[at].dataset.m);
      else if (e.key === 'Escape') (removeEventListener('keydown', key), this.showSplash(jobs, current));
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', key);
    list.forEach((x, i) => {
      x.addEventListener('pointerenter', () => pick(i));
      x.addEventListener('click', () => (at === i ? open(x.dataset.m) : pick(i)));
    });
    this.overlay.querySelector('.back')!.addEventListener('click', () => (removeEventListener('keydown', key), this.showSplash(jobs, current)));
    pick(start < 0 ? 1 : start);
  }

  /** A motive's jobs on the board, the first of them picked unless the current job is one. */
  private openBoard(mode: JobMode, current: string) {
    const jobs = this.allJobs.filter((j) => (j.mode ?? 'stickup') === mode);
    if (!jobs.length) return;
    const keep = jobs.some((j) => j.id === current);
    const id = keep ? current : jobs[0].id;
    this.showTitle(this.allJobs, id);
    if (!keep) this.h.pickJob(id);
  }

  /** The job board: London in greys with the jobs as orange pins and a list over its foot, the picked job on the right. */
  showTitle(jobs: Job[], current: string) {
    this.overlay.className = 'overlay board-screen';
    // The board shows the jobs of one motive: the current job's.
    this.allJobs = jobs;
    const mode = jobs.find((j) => j.id === current)?.mode ?? 'stickup';
    jobs = jobs.filter((j) => (j.mode ?? 'stickup') === mode);
    this.boardJobs = jobs;
    // Frame the pins, with the bottom two fifths left for the list.
    const pts = jobs.map((j) => mapXY(...PINS[j.id]));
    const x0 = Math.min(...pts.map((p) => p[0])) - 36;
    const x1 = Math.max(...pts.map((p) => p[0])) + 36;
    const y0 = Math.min(...pts.map((p) => p[1])) - 58;
    const y1 = Math.max(...pts.map((p) => p[1])) + 24;
    const vh = (y1 - y0) / 0.6;
    const pins = jobs
      .map((j, i) => {
        const [x, y] = pts[i];
        return `<g class="pin" data-job="${j.id}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
          <circle class="pulse" r="4"/><circle class="halo" r="6.5"/><circle class="dot" r="2.4"/>
          <text x="8" y="2.2">${splitTitle(j.title)[1]}</text>
        </g>`;
      })
      .join('');
    const rows = jobs
      .map(
        (j, i) => `<button class="jrow" data-job="${j.id}">
          <span class="n">${String(i + 1).padStart(2, '0')}</span>
          <span class="t">${j.title}</span>
          <span class="m">${MODE_TAG[j.mode ?? 'stickup']}</span>
        </button>`,
      )
      .join('');
    this.overlay.innerHTML = `
    <div class="board">
      <div class="board-map">
        <svg class="citymap" viewBox="${x0.toFixed(0)} ${y0.toFixed(0)} ${(x1 - x0).toFixed(0)} ${vh.toFixed(0)}" preserveAspectRatio="xMidYMid meet">
          <defs><linearGradient id="mapfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070707" stop-opacity="0"/><stop offset="1" stop-color="#070707"/></linearGradient></defs>
          <rect class="land" width="${MAP_W}" height="${MAP_H}"/>
          <path class="parks" d="${PARKS}"/>
          <path class="river" d="${RIVER}"/>
          <path class="roads" d="${ROADS}"/>
          <path class="burgess" d="${BURGESS}"/>
          <rect x="-40" y="${MAP_H - 60}" width="${MAP_W + 80}" height="61" fill="url(#mapfade)"/>
          ${pins}
        </svg>
        <span class="lab corner"><button class="to-modes">◂ Motives</button> ${MODE_TAG[mode]} · Pick a job</span>
        <div class="joblist">${rows}</div>
        <span class="credit">Map data © OpenStreetMap contributors</span>
      </div>
      <div class="jdetail"></div>
    </div>`;
    this.overlay.querySelectorAll<HTMLElement | SVGElement>('[data-job]').forEach((b) => {
      const id = (b as HTMLElement).dataset.job!;
      b.addEventListener('click', () => this.h.pickJob(id));
      // Pointing at a row lights its pin.
      if (b.classList.contains('jrow')) {
        const pin = () => this.overlay.querySelector(`.pin[data-job="${id}"]`);
        b.addEventListener('pointerenter', () => pin()?.classList.add('hot'));
        b.addEventListener('pointerleave', () => pin()?.classList.remove('hot'));
      }
    });
    this.overlay.querySelector('.to-modes')!.addEventListener('click', () => this.showModes(this.allJobs, this.jobId || current));
    this.selectJob(current);
  }

  /** Mark the picked job on the board and show it on the right. */
  selectJob(id: string) {
    this.overlay.querySelectorAll<HTMLElement | SVGElement>('[data-job]').forEach((b) => b.classList.toggle('sel', (b as HTMLElement).dataset.job === id));
    // Pins close together overlap, so the picked one is drawn last, on top.
    const pin = this.overlay.querySelector(`.pin[data-job="${id}"]`);
    pin?.parentNode?.appendChild(pin);
    const d = this.overlay.querySelector('.jdetail');
    const j = this.boardJobs.find((x) => x.id === id);
    if (!d || !j) return;
    const [what, where] = splitTitle(j.title);
    d.innerHTML = `
      <div class="photo" style="background-image:url(${artFor(id)})"></div>
      <span class="lab">${MODE_TAG[j.mode ?? 'stickup']} · ${j.place}</span>
      <div class="names"><div class="jt">${where}</div><div class="js">${what}</div></div>
      <div class="stats">${this.statsOf(j)}</div>
      <p class="brief">${j.brief}</p>
      <div class="intel">${j.intel.map((t) => `<i>${t}</i>`).join('')}</div>
      <div class="acts"><button class="btn main" data-a="plan">Plan the job</button><button class="btn alt" data-a="sample">Sample plan</button></div>
      <div class="foot"><span class="loading lab">Loading the job…</span>
        <details class="controls-box"><summary class="lab">Controls</summary><div class="controls panel">${CONTROLS}</div></details></div>`;
    d.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', () => this.h.start(b.dataset.a === 'sample')));
  }

  /** The numbers under a job's name: what is in it for the crew (in orange), who is about, and the heat. */
  private statsOf(j: Job): string {
    const heat = `<span class="heat"><span class="lab">Heat</span><span class="segs">${Array.from({ length: 5 }, (_, i) => `<i class="${i < j.heat ? 'on' : ''}"></i>`).join('')}</span></span>`;
    const lv = j.id === this.jobId ? this.level : null;
    if (!lv) return heat;
    const people = lv.enemies.filter((e) => e.kind !== 'dog' && e.kind !== 'civilian').length;
    const loot = lv.loot.reduce((s, l) => s + l.value, 0);
    if (j.mode === 'rideout') {
      const targets = lv.enemies.filter((e) => e.target).length;
      const more = people - targets;
      return `<span>${targets} targets</span>${more > 0 ? `<span>${more} more about</span>` : ''}${heat}`;
    }
    if (j.mode === 'slid') {
      const waves = lv.waves?.length ?? 0;
      return `<span>${short(loot)} to hold</span><span>${waves} ${waves === 1 ? 'wave' : 'waves'}</span>${heat}`;
    }
    return `<span>${short(loot)}</span><span>${people} ${people === 1 ? 'person' : 'people'}</span>${heat}`;
  }

  /** The job being planned, and its level. Lays the planning HUD out at once, so the game can frame the level round it. */
  setJob(job: Job, level: Level) {
    this.jobId = job.id;
    this.jobTitle = job.title;
    this.jobMode = job.mode ?? 'stickup';
    this.level = level;
    this.mode = '';
    this.setMode('planning');
  }

  /** The level has loaded: drop the loading note. */
  loaded(on = true) {
    document.body.classList.toggle('loaded', on);
  }

  hideOverlay() {
    this.overlay.className = 'overlay hidden';
    this.overlay.innerHTML = '';
  }

  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    for (const m of ['planning', 'raid', 'results', 'replay']) this.root.classList.toggle(`m-${m}`, m === mode);
    this.goBtn.classList.toggle('hidden', mode !== 'planning');
    this.banner.classList.add('hidden');
    const [what, where] = splitTitle(this.jobTitle);
    const codes = (title: string) =>
      (['A', 'B', 'C'] as const).map((c) => `<button class="tool code" data-c="${c}" title="${title} ${c}"><span>${c}</span></button>`).join('');
    const handBtn = `<button class="tool${this.handOn ? ' on' : ''}" data-t="hand" title="Hand: drag to move round the map (H)">${ICONS.hand}<span class="k">H</span></button>`;
    if (mode === 'planning') {
      this.topLeft.innerHTML = `<span class="lab">Planning · time is frozen</span><span class="t">${where}${what ? ` <span>${what}</span>` : ''}</span>`;
      this.topBar.innerHTML = '';
      this.topRight.innerHTML =
        this.jobMode === 'slid'
          ? `<span class="lab">Barricades</span><div class="segs bars"></div><span class="val"></span>`
          : `<span class="lab">Noise</span><div class="segs">${'<i></i>'.repeat(8)}</div><span class="val">Quiet</span>`;
      this.bar.innerHTML = `
        ${handBtn}
        <span class="sep"></span>
        <button class="tool" data-t="kick" title="Kick locked doors after this point (K)">${ICONS.boot}<span class="k">K</span></button>
        <span class="sep"></span>
        ${codes('Hold here until go code')}
        <span class="sep"></span>
        <button class="tool" data-t="undo" title="Remove point (Backspace)">${ICONS.undo}</button>
        <button class="tool" data-t="clear" title="Clear this route">${ICONS.clear}</button>
        <span class="sep"></span>
        <button class="tool wide" data-t="sample" title="Load a sample plan">Sample plan</button>
        <button class="tool" data-j="jobs" title="Back to the job board">${ICONS.home}</button>`;
    } else if (mode === 'raid') {
      const second = this.jobMode === 'slid' ? 'Next wave' : this.jobMode === 'rideout' ? 'Park wakes' : 'Backup';
      const take = this.jobMode === 'rideout' ? 'Caught' : this.jobMode === 'slid' ? 'Kept' : 'Take';
      this.topLeft.innerHTML = '';
      this.topBar.innerHTML = `
        <div class="l"><span class="lab job">${where}</span><span class="lab" data-k="second">${second}</span><div class="track" data-k="backup"><i></i></div></div>
        <div class="clock">00:00</div>
        <div class="r"><span class="lab">Heat</span><div class="track heat" data-k="police"><i></i></div>
          <div class="take"><span class="lab">${take}</span><b>${this.jobMode === 'rideout' ? '0 of 0' : '£0'}</b></div></div>`;
      this.topRight.innerHTML = '';
      this.bar.innerHTML = `
        ${handBtn}
        <span class="sep"></span>
        <button class="tool" data-r="pause" title="Pause (Space)">${ICONS.pause}</button>
        <button class="tool" data-r="speed" title="Speed (F)">${ICONS.fast}<span class="k">1x</span></button>
        <span class="sep"></span>
        ${codes('Call go code')}
        ${this.jobMode === 'slid' ? '' : `<span class="sep"></span><button class="tool wide" data-r="drive" title="Drive off with whoever is at the van">Leave</button>`}`;
    } else if (mode === 'replay') {
      this.topLeft.innerHTML = '';
      this.topBar.innerHTML = `<div class="l"><span class="lab job">${where}</span><span class="lab">Replay</span></div><div class="clock">00:00</div><div class="r"></div>`;
      this.topRight.innerHTML = '';
      this.bar.innerHTML = `
        <button class="tool" data-p="play" title="Play or pause (Space)">${ICONS.pause}</button>
        <button class="tool" data-p="restart" title="From the start">${ICONS.replay}</button>
        <button class="tool" data-p="speed" title="Speed (F)">${ICONS.fast}<span class="k">1x</span></button>
        <button class="tool on" data-p="follow" title="Camera follows the action">${ICONS.follow}</button>
        <span class="sep"></span>
        <div class="progress"><i></i></div><span class="clock-txt">0:00 / 0:00</span>
        <span class="sep"></span>
        <button class="tool wide clip-btn" data-p="clip" title="Record a 9:16 clip for TikTok or Shorts">Make a clip</button>
        <button class="tool" data-p="back" title="Back to the results">${ICONS.undo}</button>`;
    } else {
      this.topLeft.innerHTML = '';
      this.topBar.innerHTML = '';
      this.topRight.innerHTML = '';
      this.bar.innerHTML = '';
    }
    this.stories.classList.toggle('hidden', this.jobMode !== 'rideout' || (mode !== 'planning' && mode !== 'raid'));
    this.bar.querySelectorAll<HTMLElement>('[data-p]').forEach((b) => b.addEventListener('click', () => this.h.replay(b.dataset.p as ReplayAction)));
    this.bar.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => b.addEventListener('click', () => this.h.tool(b.dataset.t as 'kick')));
    this.bar.querySelectorAll<HTMLElement>('[data-c]').forEach((b) => b.addEventListener('click', () => this.h.code(b.dataset.c as GoCode)));
    this.bar.querySelector('[data-j]')?.addEventListener('click', () => this.h.jobs());
    this.bar.querySelectorAll<HTMLElement>('[data-r]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = b.dataset.r;
        if (r === 'pause') this.h.pause();
        else if (r === 'speed') this.h.speed();
        else this.h.driveOff();
      }),
    );
    this.layout();
  }

  private handOn = false;
  /** Light the hand button while dragging moves the map. */
  setHand(on: boolean) {
    this.handOn = on;
    this.bar.querySelector('[data-t="hand"]')?.classList.toggle('on', on);
  }

  /** Tell the game how much of each edge the HUD takes, so the map is framed in what is left. */
  layout() {
    if (!this.mode || this.mode === 'results') return;
    const W = fit.w;
    const H = fit.h;
    const box = (e: Element) => e.getBoundingClientRect();
    const f = box(this.frame);
    const i: Insets = { left: f.left + 6, right: W - f.right + 6, top: f.top + 6, bottom: H - f.bottom + 6 };
    if (this.mode === 'planning') {
      i.top = box(this.topLeft).bottom + 10;
      i.bottom = H - box(this.strip).top + 8;
      if (!this.stories.classList.contains('hidden')) i.left = box(this.stories).right + 10;
    } else {
      i.top = box(this.topBar).bottom + 6;
      i.bottom = H - box(this.crewCol).top + 6;
    }
    this.h.layout(i);
  }

  // ----------------------------------------------------------- updates

  updatePlanning(info: PlanningInfo, sim?: Sim) {
    this.setMode('planning');
    if (sim) this.updateStories(sim);
    this.tiles.forEach((tile, i) => {
      const plan = info.plans[i];
      tile.classList.toggle('sel', info.selected === i + 1);
      tile.classList.remove('down');
      const holds = [...new Set(plan.filter((w) => w.hold).map((w) => w.hold))];
      const status = plan.length <= 1 ? 'No route yet' : `${plan.length - 1} point${plan.length > 2 ? 's' : ''}${holds.length ? ' · holds ' + holds.join(', ') : ''}`;
      setText(tile.querySelector('.status')!, status);
      setHtml(tile.querySelector('.badges')!, plan.some((w) => w.kick) ? `<span title="Kicks doors">${ICONS.boot}</span>` : '');
      (tile.querySelector('.hp i') as HTMLElement).style.width = '100%';
    });
    const sel = info.plans[info.selected - 1];
    const wpIdx = info.selectedWp ?? sel.length - 1;
    const wp = sel[wpIdx];
    this.bar.querySelector('[data-t="kick"]')?.classList.toggle('on', !!wp?.kick);
    this.bar.querySelectorAll<HTMLElement>('[data-c]').forEach((b) => b.classList.toggle('on', wp?.hold === b.dataset.c));
    const name = CREW[info.selected - 1].name;
    if (this.jobMode === 'slid') {
      const bars = this.topRight.querySelector('.segs.bars') as HTMLElement;
      setHtml(bars, Array.from({ length: info.maxBarricades }, (_, i) => `<i class="${i < info.barricades ? 'on' : ''}"></i>`).join(''));
      setText(this.topRight.querySelector('.val')!, `${info.barricades} of ${info.maxBarricades}`);
      setText(
        this.hint,
        info.selectedWp !== null
          ? `Point ${info.selectedWp} of ${name}'s route selected. Where they stop is where they hold: standing still, they are in cover.`
          : `Click a door to barricade it (${info.maxBarricades - info.barricades} left). Click the map to move ${name}: where they stop is where they hold, facing the way they walked.`,
      );
      return;
    }
    const loud = info.kicks;
    const segs = this.topRight.querySelectorAll('.segs i');
    const lit = Math.min(segs.length, 1 + info.picks + loud * 3);
    segs.forEach((s, i) => s.classList.toggle('on', i < lit));
    this.topRight.classList.toggle('loud', loud > 0);
    setText(this.topRight.querySelector('.val')!, loud ? (loud > 1 ? 'Very loud' : 'Loud') : 'Quiet');
    const lead =
      this.jobMode === 'rideout' && info.selectedWp === null
        ? `The red pins are where they last posted from, and they move about. Click the map to add waypoints for ${name}.`
        : null;
    setText(
      this.hint,
      (lead ??
        (info.selectedWp !== null
          ? `Point ${info.selectedWp} of ${name}'s route selected. A, B or C to hold here for a go code, K to kick doors after it.`
          : `Click the map to add waypoints for ${name}. Drag to draw. Click a point to select it. Right click removes a point.`)) +
        '\nThe hand (H) drags you round the map; scroll or pinch to zoom, or click the overview map.' +
        (this.big ? ' Click a crew picture twice to find them.' : ''),
    );
  }

  /** Ride Out: what each of them last posted, and whether they have been caught. */
  private updateStories(sim: Sim) {
    if (this.jobMode !== 'rideout') return;
    const rows = sim.enemies
      .filter((e) => e.def.target)
      .map((e) => {
        const age = e.post ? sim.time - e.post.t : 0;
        const status =
          e.state === 'down' ? 'Down' : e.caught ? 'Caught' : e.state === 'gone' ? 'Got away' : e.seen ? 'In sight' : e.post ? postAge(age) : '';
        const cls = e.caught || e.state === 'down' ? 'got' : e.seen ? 'seen' : '';
        const caption = e.post && e.post.t > 0 ? 'Posted again from where they are now' : (e.def.story?.caption ?? '');
        return `<div class="story ${cls}"><b>${e.def.name}</b><span class="st">${status}</span><span class="cap">${caption}</span></div>`;
      })
      .join('');
    const jojo = sim.crew.find((c) => c.def.role === 'Lookout');
    const head = jojo?.state === 'down' ? "Jojo's down. No more pins" : "Jojo's watching their story";
    setHtml(this.stories, `<div class="sh">${head}</div>${rows}`);
  }

  updateRaid(
    sim: Sim,
    paused: boolean,
    speed: number,
    selected: number,
    orders: { point: number | null; hold: GoCode | null; armed: boolean } = { point: null, hold: null, armed: false },
  ) {
    this.setMode('raid');
    this.updateCards(sim, selected);
    const setTrack = (k: string, v: number) => {
      const i = this.topBar.querySelector(`[data-k="${k}"] i`) as HTMLElement | null;
      if (i) i.style.width = `${(100 * Math.max(0, Math.min(1, v))).toFixed(1)}%`;
    };
    setTrack('police', sim.police);
    setTrack('backup', this.jobMode === 'slid' ? sim.waveProgress : sim.backupProgress);
    setText(this.topBar.querySelector('.clock')!, fmtClock(sim.time));
    if (this.jobMode === 'slid') {
      const waves = sim.level.waves?.length ?? 0;
      setText(this.topBar.querySelector('[data-k="second"]')!, sim.waves >= waves ? (sim.backingOff ? 'Backing off' : 'Last wave') : `Wave ${sim.waves + 1} of ${waves}`);
    }
    this.updateStories(sim);
    const take = this.topBar.querySelector('.take b')!;
    if (this.jobMode === 'rideout') {
      const targets = sim.enemies.filter((e) => e.def.target);
      setText(take, `${targets.filter((e) => e.caught).length} of ${targets.length}`);
    } else {
      const got =
        this.jobMode === 'slid'
          ? sim.stashKept.kept
          : sim.loot.filter((l) => l.state === 'carried' || l.state === 'secured').reduce((s, l) => s + l.def.value, 0);
      setText(take, money(got));
    }
    const pauseBtn = this.bar.querySelector('[data-r="pause"]');
    if (pauseBtn) setHtml(pauseBtn as HTMLElement, paused ? ICONS.play : ICONS.pause);
    pauseBtn?.classList.toggle('on', paused);
    const sp = this.bar.querySelector('[data-r="speed"] .k');
    if (sp) setText(sp as HTMLElement, `${speed}x`);
    this.bar.querySelectorAll<HTMLElement>('[data-c]').forEach((b) => {
      b.classList.toggle('fired', sim.codes.has(b.dataset.c as GoCode));
      b.classList.toggle('on', orders.hold === b.dataset.c);
    });
    this.banner.classList.toggle('hidden', !paused);
    setText(this.banner, 'Paused');
    const name = CREW[selected - 1].name;
    setText(
      this.hint,
      paused
        ? orders.point !== null
          ? `Point ${orders.point} of ${name}'s route picked. A, B or C to hold there for a go code, K to kick doors after it, Delete to remove it. Space to carry on.`
          : `Paused. Click the map to redraw ${name}'s route from where they stand, or drag to draw it. Click one of their points to move it or give it a go code. Space to carry on.`
        : orders.armed
          ? `Click where ${name} should go. Drag to draw a route.`
          : this.jobMode === 'slid'
            ? 'Hold the place. Click a crew member, then where they should go. Space pauses to redraw routes. Standing still, the crew are in cover.'
            : this.jobMode === 'rideout'
              ? 'Catch who you can and get everyone back to the whip before the park wakes up. Click a crew member, then where they should go. Space pauses.'
              : 'Click a crew member, then where they should go. Space pauses to redraw routes and set go codes. A, B and C call the codes. Get everyone to the van.',
    );
  }

  /** The crew pictures: state, badges and health. */
  private updateCards(sim: Sim, selected: number) {
    sim.crew.forEach((c, i) => {
      const tile = this.tiles[i];
      tile.classList.toggle('sel', selected === i + 1);
      tile.classList.toggle('down', c.state === 'down');
      setText(tile.querySelector('.status')!, crewStatus(c, sim));
      const badges = [];
      if (c.carrying.length) badges.push(`<span class="bag" title="Carrying loot">${ICONS.bag}</span>`);
      if (c.action?.kind === 'pick') badges.push(`<span title="Picking a lock">${ICONS.lock}</span>`);
      setHtml(tile.querySelector('.badges')!, badges.join(''));
      (tile.querySelector('.hp i') as HTMLElement).style.width = `${(100 * c.hp) / c.maxHp}%`;
      if (this.lastHp[i] >= 0 && c.hp < this.lastHp[i]) {
        tile.classList.remove('hit');
        void tile.offsetWidth;
        tile.classList.add('hit');
      }
      this.lastHp[i] = c.hp;
    });
  }

  /** The replay bar: play state, speed, follow, and how far through. */
  updateReplay(sim: Sim, info: ReplayInfo) {
    this.setMode('replay');
    this.updateCards(sim, 0);
    const play = this.bar.querySelector('[data-p="play"]');
    if (play) setHtml(play as HTMLElement, info.playing ? ICONS.pause : ICONS.play);
    const sp = this.bar.querySelector('[data-p="speed"] .k');
    if (sp) setText(sp as HTMLElement, `${info.speed}x`);
    this.bar.querySelector('[data-p="follow"]')?.classList.toggle('on', info.follow);
    const fill = this.bar.querySelector('.progress i') as HTMLElement | null;
    if (fill) fill.style.width = `${(100 * Math.min(1, info.time / Math.max(0.001, info.total))).toFixed(1)}%`;
    setText(this.bar.querySelector('.clock-txt')!, `${fmtTime(info.time)} / ${fmtTime(info.total)}`);
    setText(this.topBar.querySelector('.clock')!, fmtClock(info.time));
    (this.bar.querySelector('[data-p="clip"]') as HTMLButtonElement | null)?.toggleAttribute('disabled', !info.clips);
    setText(
      this.hint,
      info.clips
        ? 'The camera follows the action; drag or zoom to look round yourself. Make a clip records a 9:16 video of the job for TikTok or Shorts.'
        : 'The camera follows the action; drag or zoom to look round yourself. This browser cannot record video, so clips are off here.',
    );
  }

  /** While a clip records: a note beside the frame, with a way to stop. */
  showRecording(on: boolean, onCancel?: () => void) {
    document.body.classList.toggle('clip-rec', on);
    this.root.querySelector('.rec-note')?.remove();
    if (!on) return;
    const note = this.root.appendChild(
      el(`<div class="rec-note panel"><span class="dot"></span><div><b>Recording a clip</b><span class="secs">0:00</span></div><button>Cancel</button></div>`),
    );
    note.querySelector('button')!.addEventListener('click', () => onCancel?.());
  }

  /** Seconds recorded so far, on the recording note. */
  recordingTime(t: number) {
    const s = this.root.querySelector('.rec-note .secs');
    if (s) setText(s, fmtTime(t));
  }

  /** The finished clip, to watch and save. */
  showClip(url: string, info: { seconds: number; mb: number; ext: string }, onSave: () => Promise<string>, onClose: () => void) {
    const box = this.root.appendChild(
      el(`<div class="clip-ready"><div class="clip-card panel">
        <video src="${url}" autoplay loop muted playsinline></video>
        <div class="clip-side">
          <span class="lab">Clip</span>
          <b>Your clip is ready</b>
          <span>${fmtTime(info.seconds)} of vertical video, ${info.mb.toFixed(1)} MB, ${info.ext.toUpperCase()}. Made for TikTok, Shorts and Reels.</span>
          <div class="acts"><button class="btn" data-c="save">Save the clip</button><button class="btn" data-c="close">Back to the replay</button></div>
          <span class="clip-msg"></span>
        </div></div></div>`),
    );
    const msg = box.querySelector('.clip-msg')!;
    box.querySelector('[data-c="save"]')!.addEventListener('click', async () => {
      const r = await onSave();
      msg.textContent = r === 'saved' ? 'Saved.' : r === 'declined' ? 'Not saved.' : 'It could not be saved here.';
    });
    box.querySelector('[data-c="close"]')!.addEventListener('click', () => {
      box.remove();
      onClose();
    });
  }

  /**
   * The Go shot's readout: bars top and bottom, and the job typed out in
   * green capitals as if from an old terminal, while the rest of the HUD
   * steps aside. `crew`: how many are going in.
   */
  showBriefing(crew: number) {
    this.hideBriefing();
    const lv = this.level;
    if (!lv) return;
    const loot = lv.loot.map((l) => l.name[0].toLowerCase() + l.name.slice(1));
    const list = loot.length > 3 ? `${loot.slice(0, 2).join(', ')} and ${loot.length - 2} more` : loot.length > 1 ? `${loot.slice(0, -1).join(', ')} and ${loot[loot.length - 1]}` : (loot[0] ?? 'the lot');
    const people = lv.enemies.filter((e) => e.kind !== 'dog' && e.kind !== 'civilian').length;
    const dogs = lv.enemies.filter((e) => e.kind === 'dog').length;
    const unseen = lv.unscouted.length;
    let task: string;
    let rules: string;
    if (this.jobMode === 'rideout') {
      const targets = lv.enemies.filter((e) => e.target).length;
      task = `Catch ${targets} ${targets === 1 ? 'target' : 'targets'}. Back to the van.`;
      rules = 'Targets only. Leave everyone else.';
    } else if (this.jobMode === 'slid') {
      const waves = lv.waves?.length ?? 0;
      task = `Hold ${list} through ${waves} ${waves === 1 ? 'wave' : 'waves'}.`;
      rules = 'Nobody gets past the doors.';
    } else {
      task = `Take ${list}. Back to the van.`;
      rules = 'No civilians hurt. Gone before the police.';
    }
    const odds = [`${crew} crew`, `${people} ${people === 1 ? 'opp' : 'opps'}`];
    if (dogs) odds.push(`${dogs} ${dogs === 1 ? 'dog' : 'dogs'}`);
    if (unseen) odds.push(`${unseen} ${unseen === 1 ? 'room' : 'rooms'} unscouted`);
    // A small hour of the night, the same every time for the same job.
    let h = 7;
    for (const ch of this.jobTitle) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const clock = `0${1 + (h % 3)}:${String((h >>> 4) % 60).padStart(2, '0')}`;
    const lines: [string, string][] = [
      ['Mission', this.jobTitle],
      ['Task', task],
      ['Rules', rules],
      ['Status', odds.join(' · ')],
    ];
    const box = el(`<div class="cine">
      <i class="bar top"></i><i class="bar bot"></i>
      <div class="readout"><div class="rh">// ${this.jobMode === 'stickup' ? 'stick-up' : this.jobMode === 'rideout' ? 'ride out' : 'they slid'} · ${clock}</div></div>
      <div class="skip">click to skip</div>
    </div>`);
    const out = box.querySelector('.readout')!;
    const rows = lines.map(([k]) => {
      const r = out.appendChild(el(`<div class="rl"><span class="rk">${k}</span><span class="rv"></span></div>`));
      return r.querySelector('.rv') as HTMLElement;
    });
    this.root.appendChild(box);
    this.root.classList.add('intro');
    this.cine = box;
    requestAnimationFrame(() => box.classList.add('on'));
    // Type it out a character at a time, a line after the one before.
    let li = 0;
    let ci = 0;
    const t0 = performance.now();
    let typed = 0;
    const type = () => {
      if (this.cine !== box) return;
      const want = Math.floor((performance.now() - t0 - 350) / 16);
      while (typed < want && li < lines.length) {
        const text = lines[li][1];
        ci++;
        typed++;
        rows[li].textContent = text.slice(0, ci);
        if (ci >= text.length) {
          rows[li].classList.add('done');
          li++;
          ci = 0;
          typed += 8;
        }
      }
      for (let i = 0; i < rows.length; i++) rows[i].classList.toggle('cur', i === Math.min(li, rows.length - 1));
      if (li < lines.length) requestAnimationFrame(type);
    };
    requestAnimationFrame(type);
  }

  hideBriefing() {
    this.root.classList.remove('intro');
    const box = this.cine;
    this.cine = null;
    if (!box) return;
    box.classList.remove('on');
    setTimeout(() => box.remove(), 500);
  }

  toast(text: string, color = '#f2f1ee') {
    const t = el(`<div class="toast" style="--tc:${color}"></div>`);
    t.textContent = text;
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 3300);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
  }

  /**
   * The results, as the deck has them: the number that matters huge in
   * orange with what it means stacked under it, fading, the small print
   * below that, and the crew on the right with their cut.
   */
  showResults(o: Outcome, sim: Sim) {
    this.setMode('results');
    this.hint.textContent = '';
    const where = splitTitle(this.jobTitle)[1];
    const bodies = `${o.bodies} ${o.bodies === 1 ? 'body' : 'bodies'}`;
    const heat = [
      ['Police heat', `+${o.policeHeat}`],
      ['Rival heat', `+${o.rivalHeat}`],
      ['Revenge risk', `${o.revengeRisk}%`],
      ['Reputation', `${o.rep >= 0 ? '+' : '−'}${Math.abs(o.rep)}`],
    ];
    const shots = `${o.shots ? `${o.shots} shots fired.` : 'No shots fired.'}${o.civiliansHurt ? ` ${o.civiliansHurt} civilian${o.civiliansHurt === 1 ? '' : 's'} hurt.` : ''}${o.policeCalled ? ' Someone rang 999.' : ''}`;
    let big: string;
    let mid: string;
    let low: string;
    let lines: string[][];
    let note: string;
    let value: (c: Crew) => string;
    let replan = 'Replan this job';
    if (o.mode === 'rideout') {
      big = `${o.caught} of ${o.targets}`;
      mid = 'caught';
      low = bodies;
      lines = [['Revenge risk', `${o.revengeRisk}%`, 'acc'], ...heat.filter((l) => l[0] !== 'Revenge risk')];
      note = `${REASON[o.reason]} in ${fmtTime(o.time)}. ${shots}${o.caught ? ' Every one you touched, their side will remember.' : ''}`;
      value = (c) => `${Math.round((100 * c.hp) / c.maxHp)}%`;
      replan = 'Replan the ride out';
    } else if (o.mode === 'slid') {
      big = money(o.kept);
      mid = o.reason === 'robbed' ? 'they took the lot' : o.reason === 'police' ? 'the boydem came' : 'held it down';
      low = `${o.raidersDown} of ${o.raiders} put down`;
      lines = [
        ['Stash', money(o.stash)],
        ['Kept', money(o.kept), 'acc'],
        ['Taken', String(sim.loot.filter((l) => l.state === 'lost').length)],
        ...heat,
      ];
      note = `${REASON[o.reason]} in ${fmtTime(o.time)}. ${shots}`;
      value = (c) => `${Math.round((100 * c.hp) / c.maxHp)}%`;
      replan = 'Replan the defence';
    } else {
      big = money(o.payout.total);
      if (o.take > 0) {
        const pct = Math.round((o.payout.total / o.take - 1) * 100);
        mid = `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}% ${o.bodies ? 'hot' : 'clean'}`;
      } else mid = REASON[o.reason].toLowerCase();
      low = bodies;
      lines = [
        ['Loot carried out', money(o.take)],
        ...o.payout.lines.map((l) => [l.label, `${l.pct >= 0 ? '+' : '−'}${Math.round(Math.abs(l.pct) * 100)}%`]),
        ['The crew banks', money(o.payout.total), 'acc'],
        ...heat,
      ];
      note = `${REASON[o.reason]} in ${fmtTime(o.time)}. ${shots} ${o.enemiesSubdued} held up${o.dogsDown ? `, ${o.dogsDown} ${o.dogsDown === 1 ? 'dog' : 'dogs'} down` : ''}.`;
      // What Auntie Pat pays, split by role between those who got out.
      const shares = sim.crew.map((c) => (o.escaped.includes(c.def.slot) ? CUT[c.def.role] : 0));
      const sum = shares.reduce((a, b) => a + b, 0) || 1;
      value = (c) => money(Math.round((o.payout.total * shares[c.def.slot - 1]) / sum / 10) * 10);
    }
    const crew = sim.crew
      .map((c) => {
        const out = o.down.includes(c.def.slot) || o.left.includes(c.def.slot);
        const tag = o.down.includes(c.def.slot) ? 'Down' : o.left.includes(c.def.slot) ? 'Left behind' : c.def.role;
        return `<div class="crow ${out ? 'out' : ''}" style="--col:${c.def.color}">
          <div class="ph"><img src="${tileOf(c.def.name)}" alt="${c.def.name}" draggable="false" /></div>
          <div class="v"><span class="lab">${c.def.name} · ${tag}</span><b>${value(c)}</b></div></div>`;
      })
      .join('');
    this.overlay.className = `overlay results-screen mode-${o.mode}`;
    this.overlay.innerHTML = `
      <div class="art on" style="background-image:url(${RESULT_ART[o.mode]})"></div>
      <div class="res">
        <div class="res-l">
          <div class="head"><span class="lab">Job results · ${where}</span></div>
          <div class="big">${big}</div>
          <div class="mid">${mid}</div>
          <div class="low">${low}</div>
          <div class="details">${lines.map(([k, v, c]) => `<span>${k}</span><span class="${c ?? ''}">${v}</span>`).join('')}</div>
          <p class="note">${note}</p>
        </div>
        <div class="res-r">
          ${crew}
          <div class="res-buttons">
            <button class="btn" data-a="replay">Watch the replay</button>
            <button class="btn" data-a="replan">${replan}</button>
            <button class="btn" data-a="fresh">Start over</button>
            <button class="btn" data-a="jobs">Pick another job</button>
          </div>
        </div>
      </div>`;
    this.overlay.querySelectorAll<HTMLElement>('[data-a]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.a;
        if (a === 'jobs') this.h.jobs();
        else if (a === 'replay') this.h.replay('watch');
        else this.h.replan(a === 'fresh');
      }),
    );
  }
}

function postAge(s: number): string {
  if (s < 10) return 'Just now';
  if (s < 60) return `${Math.floor(s / 10) * 10}s ago`;
  return `${Math.floor(s / 60)} min ago`;
}

function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The raid clock: 02:14. */
function fmtClock(t: number) {
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
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
      return sim.inCover(c) ? `In cover, holding for ${c.plan[c.wp]?.hold}` : `Holding for ${c.plan[c.wp]?.hold}`;
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
      return sim.inCover(c) ? 'In cover' : 'Waiting';
    default: {
      if (c.aimId) {
        const e = sim.enemies.find((x) => x.id === c.aimId);
        return `Holding up ${e?.def.name.toLowerCase() ?? 'someone'}`;
      }
      return c.carrying.length ? 'Moving with loot' : 'Moving';
    }
  }
}
