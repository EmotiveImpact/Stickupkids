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
  replay(action: ReplayAction): void;
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

/** Menu art, made with ChatGPT (2560 by 1440 masters in /mnt/project-files/menu-art/). */
const TITLE_ART = 'menu/title-hero.jpg';
/** The title screen's crew, from the pitch deck cover: the full frame, and the same frame with only the crew (for the layer in front of the name). */
const TITLE_CREW = 'menu/title-crew.webp';
const TITLE_CUT = 'menu/title-crew-cut.webp';
/** Specks that scuff the name like a film poster, as a mask (set inline so the path is relative to the page). */
const GRIT = 'menu/grit.png';
const JOB_ART: Record<string, string> = { estate: 'menu/job-harrow-road.jpg', burgess: 'menu/job-burgess-park.jpg' };
const artFor = (id: string) => JOB_ART[id] ?? TITLE_ART;

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
  /** The job picked on the board, and the art behind the board now. */
  private boardJob = '';
  private boardArt = '';
  /** A level too big for one screen: the hints say how to get about. */
  big = false;

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

  /** The title screen, in the pitch deck's look: the crew walk out in front of the name. A click or any key goes on to the job board. */
  showSplash(jobs: Job[], current: string) {
    this.overlay.className = 'overlay splash';
    this.overlay.innerHTML = `<div class="stage">
        <img class="crew-bg" src="${TITLE_CREW}" alt="">
        <div class="fade-top"></div><div class="fade-bottom"></div>
        <h1 class="title-word" style="-webkit-mask-image:url(${GRIT});mask-image:url(${GRIT})">STICKUPKIDS</h1>
        <img class="crew-cut" src="${TITLE_CUT}" alt="Four figures in balaclavas and puffer jackets walking towards you">
      </div>
      <div class="frame"></div>
      <span class="corner tl">Stickupkids</span><span class="corner tr">South London · Season One</span>
      <nav class="title-menu">
        <button disabled>Story<i>Soon</i></button>
        <button data-a="jobs" class="on">Jobs</button>
        <button disabled>Crew<i>Soon</i></button>
        <button disabled>Settings<i>Soon</i></button>
      </nav>
      <p class="strap">Plan it on the blueprint · Kick the door · <span>Pray nobody’s snitched</span></p>
      <span class="corner br press">Press any key</span>`;
    const go = () => {
      removeEventListener('keydown', key);
      if (this.overlay.classList.contains('splash')) this.showTitle(jobs, current);
    };
    const key = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      go();
    };
    addEventListener('keydown', key);
    this.overlay.querySelector('[data-a="jobs"]')!.addEventListener('click', go);
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

  /** The job board: London, the jobs on it, and the one picked, over that job's art. */
  showTitle(jobs: Job[], current: string) {
    this.overlay.className = 'overlay board-screen';
    this.boardArt = '';
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
    this.overlay.innerHTML = `<div class="art"></div><div class="art"></div>
    <div class="board">
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
          <b>A, B, C</b><span>Hold the selected point for that go code. In the raid, with no point picked: call the code</span>
          <b>K</b><span>Kick locked doors after the selected point (loud but fast). Otherwise they get picked</span>
          <b>Enter</b><span>Go</span>
          <b>Space</b><span>Pause the raid. While paused, redraw a crew member's route, move points, add holds</span>
          <b>Crew, then map</b><span>In the raid without pausing: click a crew member, then where they should go</span>
          <b>F</b><span>Toggle speed</span>
          <b>Wheel, arrows</b><span>Zoom and pan the camera (middle-drag pans too)</span>
        </div></details>
      </div>
    </div>`;
    this.overlay.querySelectorAll<HTMLElement>('.menu button').forEach((b) => b.addEventListener('click', () => this.h.start(b.dataset.a === 'sample')));
    this.overlay.querySelectorAll<HTMLElement | SVGElement>('[data-job]').forEach((b) => {
      const id = (b as HTMLElement).dataset.job!;
      b.addEventListener('click', () => this.h.pickJob(id));
      // Hovering a job shows its art; leaving goes back to the picked job's.
      b.addEventListener('pointerenter', () => this.showArt(artFor(id)));
      b.addEventListener('pointerleave', () => this.showArt(artFor(this.boardJob)));
    });
    this.selectJob(current);
  }

  /** Mark the picked job on the board. */
  selectJob(id: string) {
    this.boardJob = id;
    this.overlay.querySelectorAll<HTMLElement | SVGElement>('[data-job]').forEach((b) => b.classList.toggle('sel', (b as HTMLElement).dataset.job === id));
    this.showArt(artFor(id));
  }

  /** Crossfade the board's background to another picture. */
  private showArt(url: string) {
    const [a, b] = this.overlay.querySelectorAll<HTMLElement>('.board-screen > .art');
    if (!a || !b || url === this.boardArt) return;
    this.boardArt = url;
    const [front, back] = a.classList.contains('on') ? [b, a] : [a, b];
    front.style.backgroundImage = `url(${url})`;
    front.classList.add('on');
    back.classList.remove('on');
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

  setMode(mode: 'planning' | 'raid' | 'results' | 'replay') {
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
    } else if (mode === 'replay') {
      this.topCentre.innerHTML = `<div class="job-now panel"><div class="t">${this.jobTitle}</div><div class="s">Replay</div></div>`;
      this.topRight.innerHTML = '';
      this.bar.innerHTML = `
        <button class="tool" data-p="play" title="Play or pause (Space)">${ICONS.pause}</button>
        <button class="tool" data-p="restart" title="From the start">${ICONS.replay}</button>
        <button class="tool" data-p="speed" title="Speed (F)">${ICONS.fast}<span class="k">1x</span></button>
        <button class="tool on" data-p="follow" title="Camera follows the action">${ICONS.follow}<span class="cap">Follow</span></button>
        <span class="sep"></span>
        <div class="track"><i></i></div><span class="clock-txt">0:00 / 0:00</span>
        <span class="sep"></span>
        <button class="tool wide clip-btn" data-p="clip" title="Record a 9:16 clip for TikTok or Shorts">${ICONS.film}<span>Make a clip</span></button>
        <button class="tool" data-p="back" title="Back to the results">${ICONS.undo}<span class="cap">Back</span></button>`;
    } else {
      this.topCentre.innerHTML = '';
      this.topRight.innerHTML = '';
      this.bar.innerHTML = '';
    }
    this.topRight.classList.toggle('hidden', mode === 'results' || mode === 'replay');
    this.bar.querySelectorAll<HTMLElement>('[data-p]').forEach((b) => b.addEventListener('click', () => this.h.replay(b.dataset.p as ReplayAction)));
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
      (info.selectedWp !== null
        ? `Point ${info.selectedWp} of ${name}'s route selected. A, B or C to hold here for a go code, K to kick doors after it.`
        : `Click the map to add waypoints for ${name}. Drag to draw. Click a point to select it. Right click removes a point.`) +
        (this.big ? '\nTwo fingers or the arrow keys to look round, pinch to zoom, or click the map bottom left. Click a crew card twice to find them.' : ''),
    );
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
    const setRing = (k: string, v: number) => {
      const c = this.topCentre.querySelector(`[data-k="${k}"] circle.fg`) as SVGCircleElement | null;
      if (c) c.style.strokeDashoffset = String(201 * (1 - Math.max(0, Math.min(1, v))));
    };
    setRing('police', sim.police);
    setRing('backup', sim.backupProgress);
    const total = sim.loot.reduce((s, l) => s + l.def.value, 0);
    const got = sim.loot.filter((l) => l.state === 'carried' || l.state === 'secured').reduce((s, l) => s + l.def.value, 0);
    const segs = this.topRight.querySelectorAll('.segs i');
    segs.forEach((s, i) => s.classList.toggle('on', i < Math.round((got / total) * segs.length)));
    setText(this.topRight.querySelector('.amt')!, money(got));
    const pauseBtn = this.bar.querySelector('[data-r="pause"]');
    if (pauseBtn) setHtml(pauseBtn as HTMLElement, paused ? ICONS.play : ICONS.pause);
    const sp = this.bar.querySelector('[data-r="speed"] .k');
    if (sp) setText(sp as HTMLElement, `${speed}x`);
    this.bar.querySelectorAll<HTMLElement>('[data-c]').forEach((b) => {
      b.classList.toggle('fired', sim.codes.has(b.dataset.c as GoCode));
      b.classList.toggle('on', orders.hold === b.dataset.c);
    });
    this.bar.style.setProperty('--selcol', CREW[selected - 1].color);
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
          : 'Click a crew member, then where they should go. Space pauses to redraw routes and set go codes. A, B and C call the codes. Get everyone to the van.',
    );
  }

  /** The crew cards: state, badges and health. */
  private updateCards(sim: Sim, selected: number) {
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
    const fill = this.bar.querySelector('.track i') as HTMLElement | null;
    if (fill) fill.style.width = `${(100 * Math.min(1, info.time / Math.max(0.001, info.total))).toFixed(1)}%`;
    setText(this.bar.querySelector('.clock-txt')!, `${fmtTime(info.time)} / ${fmtTime(info.total)}`);
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
          <b>Your clip is ready</b>
          <span>${fmtTime(info.seconds)} of vertical video, ${info.mb.toFixed(1)} MB, ${info.ext.toUpperCase()}. Made for TikTok, Shorts and Reels.</span>
          <div class="menu"><button data-c="save">Save the clip</button><button data-c="close">Back to the replay</button></div>
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
          <div class="take">${money(o.payout.total)}</div>
          <div class="reason">${reason} · ${fmtTime(o.time)}</div>
          <div class="items">${items}</div>
          ${cuts}
        </div>
        <div class="res-right panel">
          <div class="payout">
            <span class="head">What Auntie Pat pays</span>
            <span>Loot carried out</span><span>${money(o.take)}</span>
            ${o.payout.lines.map((l) => `<span>${l.label}</span><span class="${l.pct >= 0 ? 'plus' : 'minus'}">${l.pct >= 0 ? '+' : '−'}${Math.round(Math.abs(l.pct) * 100)}%</span>`).join('')}
            <span class="sum">The crew banks</span><span class="total">${money(o.payout.total)}</span>
          </div>
          <div class="fall"><span>${ICONS.siren}</span>${bar(Math.round(o.policeHeat / 6), '#22E3FF')}<span class="lbl">Police heat +${o.policeHeat}</span></div>
          <div class="fall"><span style="color:var(--enemy)">${ICONS.mask}</span>${bar(Math.round(o.rivalHeat / 5), '#FF3B4E')}<span class="lbl">Rival crew heat +${o.rivalHeat} · Revenge risk ${o.revengeRisk}%</span></div>
          <div class="fall"><span>${ICONS.crew}</span><div class="stars">${Array.from({ length: 5 }, (_, i) => (i < stars ? ICONS.starFill : ICONS.star)).join('')}</div><span class="lbl">Reputation ${o.rep >= 0 ? '+' : ''}${o.rep}</span></div>
          <div class="fall" style="border:0"><span></span><div style="font:400 13px/1.5 var(--body);color:#b8c6e6">
            ${o.shots ? `${o.shots} shots fired. ` : 'No shots fired. '}${o.enemiesSubdued} held up, ${o.bodies} ${o.bodies === 1 ? 'body' : 'bodies'}${o.dogsDown ? `, ${o.dogsDown} ${o.dogsDown === 1 ? 'dog' : 'dogs'} down` : ''}.${o.civiliansHurt ? ` ${o.civiliansHurt} civilian${o.civiliansHurt === 1 ? '' : 's'} hurt.` : ''}${o.policeCalled ? ' A neighbour rang 999.' : ''}</div></div>
        </div>
      </div>
      <div class="res-buttons">
        <button data-a="replay">${ICONS.replay}Watch the replay</button>
        <button data-a="replan">${ICONS.redo}Replan this job</button>
        <button data-a="fresh">${ICONS.clear}Start over</button>
        <button data-a="jobs">${ICONS.home}Pick another job</button>
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
