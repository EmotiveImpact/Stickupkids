// Records a replay as a vertical 9:16 video for TikTok and Shorts: the game
// drawn into a tall frame, with the job's name, what happens as captions,
// the payout at the end and the STICKUPKIDS mark burned in.

export const CLIP_W = 1080;
export const CLIP_H = 1920;

export interface ClipInfo {
  title: string;
  place: string;
}

export interface ClipEnd {
  /** What the crew banked, as shown. */
  total: string;
  /** How it ended, for example "Clean getaway · 1:12". */
  line: string;
}

interface Caption {
  text: string;
  colour: string;
  t: number;
}

const CAPTION_LIFE = 2.8;
const INTRO = 1.6;
const C1 = '#22E3FF';
const C2 = '#FF2D9B';
const C4 = '#FFB020';
const LOOT = '#3DFFA2';

/**
 * The best video format this browser can record: H.264 MP4 where it can
 * (Safari, and Chrome on most machines), WebM otherwise. An MP4 holding
 * VP9 is skipped: QuickTime and some apps will not open it.
 */
function pickFormat(): { mime: string; ext: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const tries: [string, 'mp4' | 'webm'][] = [
    ['video/mp4;codecs=avc1.640028', 'mp4'],
    ['video/mp4;codecs=avc1.4D401F', 'mp4'],
    ['video/mp4;codecs=avc1.42E01E', 'mp4'],
    ['video/mp4;codecs=avc1', 'mp4'],
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm;codecs=vp8', 'webm'],
    ['video/webm', 'webm'],
  ];
  for (const [mime, ext] of tries) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return null;
}

export class ClipRecorder {
  static supported(): boolean {
    return pickFormat() !== null && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  readonly ext: 'mp4' | 'webm';
  private readonly source: HTMLCanvasElement;
  private readonly info: ClipInfo;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly rec: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private captions: Caption[] = [];
  private t = 0;
  private end: ClipEnd | null = null;
  private endT = 0;
  private started = 0;
  /** Length of the video so far, in seconds of real time. */
  get seconds(): number {
    return this.started ? (performance.now() - this.started) / 1000 : 0;
  }

  constructor(source: HTMLCanvasElement, info: ClipInfo) {
    const fmt = pickFormat()!;
    this.ext = fmt.ext;
    this.source = source;
    this.info = info;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CLIP_W;
    this.canvas.height = CLIP_H;
    this.g = this.canvas.getContext('2d')!;
    const stream = this.canvas.captureStream(30);
    this.rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: 10_000_000 });
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
  }

  start() {
    this.started = performance.now();
    this.rec.start(1000);
  }

  /** A line along the bottom, as the game's own notes say it. */
  caption(text: string, colour: string) {
    this.captions.push({ text, colour, t: 0 });
    if (this.captions.length > 2) this.captions.shift();
  }

  /** Hold on the last frame with what the crew banked. */
  finish(end: ClipEnd) {
    this.end = end;
    this.endT = 0;
  }

  /** Seconds the end card has been up. */
  get ending(): number {
    return this.end ? this.endT : 0;
  }

  /** Draw this frame: the game, then the words over it. */
  frame(dt: number) {
    this.t += dt;
    if (this.end) this.endT += dt;
    const g = this.g;
    // The game, cropped to fill the tall frame.
    const sw = this.source.width;
    const sh = this.source.height;
    const k = Math.max(CLIP_W / sw, CLIP_H / sh);
    const cw = CLIP_W / k;
    const ch = CLIP_H / k;
    g.fillStyle = '#05080f';
    g.fillRect(0, 0, CLIP_W, CLIP_H);
    g.drawImage(this.source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, CLIP_W, CLIP_H);

    // Top band: the mark, the job and where.
    const top = g.createLinearGradient(0, 0, 0, 420);
    top.addColorStop(0, 'rgba(5,8,16,0.88)');
    top.addColorStop(1, 'rgba(5,8,16,0)');
    g.fillStyle = top;
    g.fillRect(0, 0, CLIP_W, 420);
    this.mark(72, 150, 92);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    g.font = '700 54px Rajdhani, sans-serif';
    g.fillText(this.info.title.toUpperCase(), 72, 262, CLIP_W - 144);
    g.fillStyle = C4;
    g.font = '600 30px Inter, sans-serif';
    g.fillText(this.info.place.toUpperCase(), 72, 310, CLIP_W - 144);

    // Bottom band: what just happened.
    const bot = g.createLinearGradient(0, CLIP_H - 520, 0, CLIP_H);
    bot.addColorStop(0, 'rgba(5,8,16,0)');
    bot.addColorStop(1, 'rgba(5,8,16,0.85)');
    g.fillStyle = bot;
    g.fillRect(0, CLIP_H - 520, CLIP_W, 520);
    this.captions = this.captions.filter((c) => (c.t += dt) < CAPTION_LIFE);
    let y = CLIP_H - 250;
    for (const c of [...this.captions].reverse()) {
      const a = Math.min(1, c.t / 0.15, (CAPTION_LIFE - c.t) / 0.4);
      y -= this.captionBox(c, y, a) + 18;
    }

    // Opening: the job's name, large, for a moment.
    if (this.t < INTRO) {
      const a = Math.min(1, (INTRO - this.t) / 0.5);
      g.fillStyle = `rgba(5,8,16,${0.55 * a})`;
      g.fillRect(0, 0, CLIP_W, CLIP_H);
      g.globalAlpha = a;
      g.textAlign = 'center';
      g.fillStyle = '#ffffff';
      g.font = '700 96px Rajdhani, sans-serif';
      this.wrap(this.info.title.toUpperCase(), CLIP_W / 2, CLIP_H / 2 - 40, CLIP_W - 140, 96);
      g.globalAlpha = 1;
    }

    // Ending: what the crew banked.
    if (this.end) {
      const a = Math.min(1, this.endT / 0.5);
      g.fillStyle = `rgba(5,8,16,${0.72 * a})`;
      g.fillRect(0, 0, CLIP_W, CLIP_H);
      g.globalAlpha = a;
      g.textAlign = 'center';
      g.fillStyle = '#9fb0d4';
      g.font = '600 34px Inter, sans-serif';
      g.fillText('THE CREW BANKS', CLIP_W / 2, CLIP_H / 2 - 120);
      g.fillStyle = LOOT;
      g.font = '700 168px Rajdhani, sans-serif';
      g.shadowColor = 'rgba(61,255,162,0.55)';
      g.shadowBlur = 30;
      g.fillText(this.end.total, CLIP_W / 2, CLIP_H / 2 + 40);
      g.shadowBlur = 0;
      g.fillStyle = '#ffffff';
      g.font = '600 38px Inter, sans-serif';
      g.fillText(this.end.line, CLIP_W / 2, CLIP_H / 2 + 120);
      this.mark(CLIP_W / 2, CLIP_H - 300, 110, true);
      g.globalAlpha = 1;
    }
  }

  /** Stop and hand back the video. */
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      this.rec.onstop = () => resolve(new Blob(this.chunks, { type: this.rec.mimeType }));
      this.rec.stop();
    });
  }

  /** Abandon the recording. */
  cancel() {
    this.rec.onstop = null;
    if (this.rec.state !== 'inactive') this.rec.stop();
  }

  /** STICKUPKIDS with its underline, as on the title screen. */
  private mark(x: number, y: number, size: number, centre = false) {
    const g = this.g;
    g.font = `700 ${size}px Rajdhani, sans-serif`;
    g.textAlign = centre ? 'center' : 'left';
    const w = g.measureText('STICKUPKIDS').width;
    const left = centre ? x - w / 2 : x;
    const bar = g.createLinearGradient(left, 0, left + w * 0.82, 0);
    bar.addColorStop(0, C4);
    bar.addColorStop(1, C2);
    g.save();
    g.fillStyle = bar;
    g.translate(left + 4, y + size * 0.16);
    g.transform(1, 0, -0.35, 1, 0, 0);
    roundRect(g, 0, 0, w * 0.82, size * 0.1, size * 0.05);
    g.fill();
    g.restore();
    g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowOffsetX = 3;
    g.shadowOffsetY = 3;
    g.fillText('STICKUPKIDS', x, y);
    g.shadowColor = 'transparent';
    g.shadowOffsetX = 0;
    g.shadowOffsetY = 0;
  }

  /** A caption panel with its bottom at `bottom`; returns its height. */
  private captionBox(c: Caption, bottom: number, alpha: number): number {
    const g = this.g;
    g.font = '600 40px Inter, sans-serif';
    const lines = this.lines(c.text, CLIP_W - 220);
    const h = 36 + lines.length * 52;
    const top = bottom - h;
    g.globalAlpha = alpha;
    g.fillStyle = 'rgba(11,18,32,0.82)';
    roundRect(g, 72, top, CLIP_W - 144, h, 14);
    g.fill();
    g.fillStyle = c.colour;
    g.fillRect(72, top, 8, h);
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    lines.forEach((l, i) => g.fillText(l, 108, top + 62 + i * 52));
    g.globalAlpha = 1;
    return h;
  }

  private lines(text: string, width: number): string[] {
    const out: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (this.g.measureText(next).width > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  }

  private wrap(text: string, x: number, y: number, width: number, lh: number) {
    const lines = this.lines(text, width);
    lines.forEach((l, i) => this.g.fillText(l, x, y + (i - (lines.length - 1) / 2) * lh));
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Hand a file to the viewer: through the page's host when it offers saving, else as a plain download. */
export async function saveFile(filename: string, data: Blob): Promise<'saved' | 'declined' | 'failed'> {
  type Downloads = { save(r: { filename: string; data: Blob }): Promise<unknown> };
  const host = (window as unknown as { claude?: { use(name: string): Promise<Downloads | null> } }).claude;
  const downloads = host?.use ? await host.use('downloads').catch(() => null) : null;
  if (downloads) {
    try {
      await downloads.save({ filename, data });
      return 'saved';
    } catch (e) {
      return (e as { code?: string }).code === 'declined' ? 'declined' : 'failed';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  return 'saved';
}
