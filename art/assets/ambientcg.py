"""Downloads ambientCG surfaces (CC0, no credit needed) into art/assets/ambientcg/<id>/.

Run:  python3 art/assets/ambientcg.py [id ...]     (no ids: everything in WANTED)

Only the 1K colour map is kept (the bake does the shading). Files are cached.
"""
import io
import os
import sys
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "ambientcg")
UA = {"User-Agent": "StickupKids-level-builder/1.0"}

WANTED = [
    # carpets and rugs
    "Carpet001", "Carpet002", "Carpet003", "Carpet004", "Carpet005", "Carpet006", "Carpet008", "Carpet011",
    "Carpet012", "Carpet013", "Carpet014", "Carpet015", "Carpet016", "Fabric045",
    # hard floors
    "Tiles101", "Tiles074", "Tiles093", "Tiles107", "Tiles012", "Tiles046", "Tiles084", "Tiles132",
    "WoodFloor041", "WoodFloor051", "WoodFloor043", "WoodFloor062",
    "Concrete034", "Concrete044", "Asphalt026",
    # mess on the ground
    "Cardboard004", "Paper005", "ScatteredLeaves009",
]


def colour_path(asset):
    return os.path.join(CACHE, asset, f"{asset}_Color.jpg")


def fetch(asset):
    out = colour_path(asset)
    if os.path.exists(out):
        return out
    url = f"https://ambientcg.com/get?file={asset}_1K-JPG.zip"
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        name = next(n for n in z.namelist() if n.endswith("_Color.jpg"))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "wb") as f:
            f.write(z.read(name))
    return out


if __name__ == "__main__":
    ids = sys.argv[1:] or WANTED
    def safe(a):
        try:
            return fetch(a)
        except Exception as e:  # a few ids get renamed upstream; carry on
            return f"skipped ({e})"
    with ThreadPoolExecutor(6) as ex:
        for a, p in zip(ids, ex.map(safe, ids)):
            print(a, os.path.getsize(p) if os.path.exists(p) else p)
