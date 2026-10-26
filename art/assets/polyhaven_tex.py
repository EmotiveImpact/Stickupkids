"""Downloads Poly Haven surfaces (CC0, no credit needed) into art/assets/polyhaven_tex/<id>/.

Run:  python3 art/assets/polyhaven_tex.py [id ...]     (no ids: everything in WANTED)

Each surface comes as 2k colour, normal (OpenGL) and roughness JPEGs, plus
size.txt with the metres one repeat covers. Only the pre-rendered stills use
them (build_site.py --still): the game's own surfaces stay art/textures.
"""
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "polyhaven_tex")
API = "https://api.polyhaven.com/"
UA = {"User-Agent": "StickupKids-level-builder/1.0"}
MAPS = {"diff": "Diffuse", "nor": "nor_gl", "rough": "Rough"}

WANTED = [
    "brick_wall_001",          # railway arches: dark, sooty mixed red
    "brick_wall_10",           # coping along the top of the arches
    "cobblestone_square",      # granite setts in the lane
    "concrete_floor_worn_001", # inside the arches
    "concrete_floor_02",       # yards and decks
    "asphalt_03",              # roads
]


def fetch_json(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))


def get(url, path):
    if os.path.exists(path):
        return
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()
    with open(path, "wb") as f:
        f.write(data)


def path(asset, kind):
    return os.path.join(CACHE, asset, f"{kind}.jpg")


def size(asset):
    """Metres one repeat covers."""
    with open(os.path.join(CACHE, asset, "size.txt")) as f:
        return float(f.read())


def fetch(asset):
    os.makedirs(os.path.join(CACHE, asset), exist_ok=True)
    sz = os.path.join(CACHE, asset, "size.txt")
    if not os.path.exists(sz):
        dims = fetch_json(API + "info/" + asset).get("dimensions") or [2000, 2000]
        with open(sz, "w") as f:
            f.write(str(max(dims) / 1000))
    files = fetch_json(API + "files/" + asset)
    for kind, key in MAPS.items():
        get(files[key]["2k"]["jpg"]["url"], path(asset, kind))
    return asset


if __name__ == "__main__":
    ids = sys.argv[1:] or WANTED
    with ThreadPoolExecutor(6) as ex:
        for a in ex.map(fetch, ids):
            print("ok", a)
