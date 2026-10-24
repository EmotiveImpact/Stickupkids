"""Grade menu art to the deck's look: neutral black night, sodium orange lights.

Blue and purple in the source art fall to grey; warm lamplight keeps its
colour and leans towards the accent orange (#FF7A1A). Shadows are pulled
down so the pictures sit on #070707.

    python3 art/grade_menu.py SRC OUT [--width 1920] [--dark 1.0]
"""
import argparse

import numpy as np
from PIL import Image


def grade(img: Image.Image, dark: float = 1.0) -> Image.Image:
    a = np.asarray(img.convert('RGB')).astype(np.float32) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    # How warm each pixel is: lamplight and fire stay coloured, the rest goes grey.
    warm = np.clip((r - b) * 3.5 - 0.05, 0, 1)
    keep = 0.08 + 0.92 * warm
    out = lum[..., None] + (a - lum[..., None]) * keep[..., None]
    # Push warm colour towards sodium orange.
    orange = np.array([1.0, 0.478, 0.102], np.float32)
    tint = orange * (lum[..., None] * 1.6)
    out = out * (1 - 0.35 * warm[..., None]) + np.minimum(tint, 1) * 0.35 * warm[..., None]
    # A faintly warm grey for the neutrals, and deeper shadows.
    out = out * np.array([1.0, 0.985, 0.96], np.float32)
    out = np.power(np.clip(out, 0, 1), 1.18 * dark)
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('src')
    p.add_argument('out')
    p.add_argument('--width', type=int, default=1920)
    p.add_argument('--dark', type=float, default=1.0)
    p.add_argument('--quality', type=int, default=82)
    o = p.parse_args()
    im = Image.open(o.src)
    if im.width > o.width:
        im = im.resize((o.width, round(im.height * o.width / im.width)), Image.LANCZOS)
    grade(im, o.dark).save(o.out, quality=o.quality, optimize=True, progressive=True)
