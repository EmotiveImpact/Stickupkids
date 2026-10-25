"""Downloads Poly Haven models (CC0, no credit needed) into art/assets/polyhaven/<id>/.

Run:  python3 art/assets/polyhaven.py [id ...]     (no ids: everything in WANTED)

Each model comes as glTF with 1k textures. Files are cached, so a second run
only fetches what is missing. The dressing code in art/level/dress.py loads
them from here.
"""
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "polyhaven")
API = "https://api.polyhaven.com/files/"
UA = {"User-Agent": "StickupKids-level-builder/1.0"}

# What the levels use. Grouped by where they mostly end up.
WANTED = [
    # front room
    "sofa_02", "sofa_03", "modern_arm_chair_01", "modern_coffee_table_01", "television_02", "gaming_console",
    "boombox", "Ottoman_01", "side_table_01", "ceiling_fan",
    # kitchen
    "vintage_microwave", "vintage_electric_kettle", "electric_stove", "bleach_bottle", "multi_cleaner_bottle",
    "wooden_cutting_board", "plastic_crate_01", "long_life_food", "pot_enamel_01",
    # dining room / trap table
    "dining_table", "dining_chair_02", "plastic_monobloc_chair_01", "classic_laptop", "cigarette_pack",
    "wall_clock", "drawer_cabinet",
    # back bedroom / stash
    "old_bed_frame", "cardboard_box_01", "plastic_crate_02", "steel_frame_shelves_01", "metal_office_desk",
    "baseball_bat", "machete", "metal_toolbox",
    # garden, alley, street
    "metal_trash_can", "old_tyre", "compost_bags", "wooden_stool_01", "rusted_wheel_rim_01", "street_rat",
    "spray_paint_bottles_02", "plastic_crate_03", "barrel_03", "exterior_aircon_unit", "security_light",
]


def get(url, path):
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r, open(path + ".part", "wb") as f:
        f.write(r.read())
    os.replace(path + ".part", path)


def fetch(asset, res="1k"):
    """Download one model; returns the path to its .gltf."""
    folder = os.path.join(CACHE, asset)
    gltf = os.path.join(folder, f"{asset}.gltf")
    if os.path.exists(gltf):
        return gltf
    req = urllib.request.Request(API + asset, headers=UA)
    files = json.load(urllib.request.urlopen(req, timeout=60))["gltf"]
    g = files.get(res) or files[sorted(files)[0]]
    g = g["gltf"]
    for rel, inc in g.get("include", {}).items():
        get(inc["url"], os.path.join(folder, rel))
    get(g["url"], gltf)
    return gltf


if __name__ == "__main__":
    ids = sys.argv[1:] or WANTED
    with ThreadPoolExecutor(8) as ex:
        for a, p in zip(ids, ex.map(fetch, ids)):
            print(a, os.path.getsize(p))
