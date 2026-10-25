"""Cut the Kling clips into the black and white drill montage for the title screen.

42 beats at 140 BPM (about 18 s), every cut on a beat. Effects are added per frame:
black and white grade that keeps only red (tail lights) and blue (police lights) in colour, slight fisheye, (with --punch) a zoom thump on each beat and shake on the off beats,
stutter repeats, a white flash on the feds hit, a whip blur into the run, grain and vignette.

Usage: python3 drill_montage.py CLIPDIR OUT.mp4 [--caption] [--punch]
CLIPDIR holds the Kling clips named in SHOTS (.mp4).
"""
import subprocess, sys, numpy as np
from PIL import Image, ImageDraw, ImageFont

clipdir, out = sys.argv[1], sys.argv[2]
CAPTION = '--caption' in sys.argv
PUNCH = '--punch' in sys.argv  # the zoom thump and shake on the beat; off by default (Edem found it annoying)
W, H, FPS, BPM = 1280, 720, 30, 140
BEAT = 60 / BPM


def load(name, start, length):
    """The 24 fps RGB frames of one clip from start for length seconds (only what a shot uses, to save memory)."""
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-ss', f'{start:.3f}', '-i', f'{clipdir}/{name}.mp4', '-t', f'{length:.3f}',
                          '-vf', f'scale={W}:{H}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)


def accents(f):
    """How much of each pixel stays in colour: strong red and strong blue only, judged by hue ratio so orange sodium light goes grey."""
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    sat = (f.max(-1) - f.min(-1)) / (f.max(-1) + 1e-4)
    red = np.clip((0.38 - g / (r + 1e-4)) * 6, 0, 1) * np.clip((0.5 - b / (r + 1e-4)) * 4, 0, 1) * np.clip((r - 0.4) * 4, 0, 1) * np.clip((sat - 0.5) * 3, 0, 1)
    blue = np.clip((0.6 - r / (b + 1e-4)) * 4, 0, 1) * np.clip((0.85 - g / (b + 1e-4)) * 4, 0, 1) * np.clip((b - 0.12) * 5, 0, 1) * np.clip((sat - 0.35) * 3, 0, 1)
    return np.clip(red + blue, 0, 1)


# (clip, beats, source start s, speed, punch-ins on?)  speed may be a function of shot time t for ramps
SHOTS = [
    ('k-chill1', 2, 0.5, 1.0, True),
    ('k-eyes', 2, 0.6, 1.0, True),
    ('k-walk', 3, 0.2, lambda t: 0.45 * t if t < 2 * BEAT else 0.45 * 2 * BEAT + (t - 2 * BEAT), True),  # slow-mo, snaps to speed on beat 3
    ('k-chill2', 2, 0.8, 1.0, True),
    ('k-stair', 2, 0.8, 1.0, True),
    ('k-door', 2, 0.5, 1.0, True),
    ('k-hands', 2, 0.6, 1.0, True),
    ('k-feds', 1, 1.6, 1.0, True),
    ('k-policearrive', 2, 1.4, 1.0, True),
    ('k-policerun', 2, 0.6, 1.0, True),
    ('k-runcar', 2, 0.1, 1.0, True),  # ends before the number plate Kling invented comes into view
    ('k-driveoff', 2, 1.0, 1.0, True),
    ('k-incar', 2, 0.6, 1.0, True),
    ('k-lookback', 2, 0.8, 1.0, True),
    ('k-moped1', 2, 0.2, 1.0, True),
    ('k-moped2', 2, 0.6, 1.0, True),
    ('k-roof', 4, 0.4, 0.9, False),
    ('k-estate', 2, 0.6, 1.0, True),
    ('k-walk', 4, 0.85, 1.0, True),
]

def source_end(shot):
    _, beats, s0, speed, _ = shot
    d = beats * BEAT
    return s0 + (speed(d) if callable(speed) else speed * d)


clips = [load(sh[0], sh[2], source_end(sh) - sh[2] + 0.15) for sh in SHOTS]

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
nx, ny = (xx - W / 2) / (W / 2), (yy - H / 2) / (W / 2)
r2 = nx * nx + ny * ny
vignette = np.clip(1 - 0.38 * r2, 0, 1)


def warp(img, zoom, dx, dy):
    """Fisheye plus zoom and shake, sampled with nearest neighbour (grain hides the steps)."""
    k = 1 - 0.09 * r2
    sx = (nx * k / zoom) * (W / 2) / 1.06 + W / 2 + dx
    sy = (ny * k / zoom) * (W / 2) / 1.06 + H / 2 + dy
    return img[np.clip(sy, 0, H - 1).astype(np.int32), np.clip(sx, 0, W - 1).astype(np.int32)]


def grade(L):
    L = np.clip((L - 0.02) / 0.78, 0, 1) ** 0.62
    return L * L * (3 - 2 * L)


font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 64)
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
cap = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(cap)
d.text((60, 560), 'STICKUPKIDS', font=font, fill=255, stroke_width=4, stroke_fill=0)
d.text((64, 636), 'SEASON ONE  ·  SOUTH LONDON', font=small, fill=230, stroke_width=2, stroke_fill=0)
cap_mask = np.asarray(cap.point(lambda v: 255 if v > 0 else 0), np.float32) / 255

rng = np.random.default_rng(11)
total_beats = sum(s[1] for s in SHOTS)
N = round(total_beats * BEAT * FPS)
enc = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS),
                        '-i', '-', '-c:v', 'libx264', '-crf', '27', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
                       stdin=subprocess.PIPE)

starts = np.cumsum([0] + [s[1] for s in SHOTS]) * BEAT
for f in range(N):
    T = f / FPS
    i = int(np.searchsorted(starts, T, side='right') - 1)
    name, beats, s0, speed, punch = SHOTS[i]
    t = T - starts[i]
    beat_in_shot = t / BEAT
    # stutter: on the stairwell, hold two frames as the hand hits the door
    if name == 'k-stair' and 0.9 < beat_in_shot < 1.15:
        t = 0.9 * BEAT
    st = s0 + (speed(t) if callable(speed) else speed * t)
    frames = clips[i]
    img = frames[min(int((st - s0) * 24), len(frames) - 1)].astype(np.float32) / 255

    # whip blur into the run: smear sideways for the first few frames
    if name == 'k-runcar' and t < 0.12:
        amt = int(90 * (1 - t / 0.12))
        img = np.mean([np.roll(img, s, axis=1) for s in range(-amt, amt + 1, max(1, amt // 6))], axis=0)
    keep = accents(img)
    img = np.concatenate([img, keep[..., None], (0.3 * img[..., 0] + 0.59 * img[..., 1] + 0.11 * img[..., 2])[..., None]], -1)

    gb = T / BEAT  # global beat position
    ph = gb - np.floor(gb)
    zoom = 1.0
    if PUNCH and punch:
        zoom += 0.07 * np.exp(-ph * 9)
    dx = dy = 0.0
    if PUNCH and punch and int(gb) % 2 == 1:
        a = 14 * np.exp(-ph * 7)
        dx, dy = rng.normal(0, a), rng.normal(0, a * 0.6)
    img = warp(img, zoom, dx, dy)
    colour, keep, L = np.clip(img[..., :3] * 1.15, 0, 1), img[..., 3:4], grade(img[..., 4])

    if name == 'k-feds' and t < 2 / FPS:
        L, keep = np.full_like(L, 1.0), keep * 0  # white flash on the hit
    if name == 'k-roof' and beat_in_shot > beats - 0.25:
        L = L + (beat_in_shot - (beats - 0.25)) / 0.25 * 0.9  # burn out to white
    grain = rng.normal(0, 0.04, (H // 2, W // 2)).astype(np.float32)  # half-res grain: reads as film, keeps the file small
    out_ = (L[..., None] * (1 - keep) + colour * keep) * vignette[..., None] + np.repeat(np.repeat(grain, 2, 0), 2, 1)[..., None]
    if CAPTION and name == 'k-eyes' and beat_in_shot > 1:
        out_ = out_ * (1 - cap_mask[..., None]) + (np.asarray(cap, np.float32) / 255)[..., None] * cap_mask[..., None]
    enc.stdin.write((np.clip(out_, 0, 1) * 255).astype(np.uint8).tobytes())
enc.stdin.close()
enc.wait()
print('frames', N, 'seconds', round(N / FPS, 2))
