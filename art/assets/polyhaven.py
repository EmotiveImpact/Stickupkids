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
    # grow, shop, café, car park
    "weed_plant_02", "CashRegister_01", "propane_tank", "metal_jerrycan", "plastic_jerrycan", "wooden_crate_02",
    "painted_wooden_chair_01", "plastic_bottle_gallon", "concrete_road_barrier_02", "WetFloorSign_01",
    "hand_truck", "plastic_broom", "korean_fire_extinguisher_01", "seeding_tray_01", "lightbulb_led",
    # second sweep (25 Oct): more lived-in clutter and street kit
    "trashbag", "throw_pillows_01", "rubber_boots", "wine_bottles_01", "plastic_container", "multi_cleaner_5_litre",
    "russian_food_cans_01", "can_rusted", "security_camera_01", "security_camera_02", "water_manhole_cover",
    "utility_box_01", "utility_box_02", "rollershutter_door", "rollershutter_window_01", "steel_frame_shelves_02",
    "steel_frame_shelves_03", "modern_coffee_table_02", "mounted_fluorescent_lights", "power_box_01", "plunger",
    "vintage_suitcase", "wicker_basket_01", "portable_generator", "office_notepads", "stationery_supplies", "gamepad",
    "sledgehammer_01", "ammo_box", "medical_box", "painted_wooden_nightstand", "modern_wooden_cabinet",
    "compost_bag_02", "cement_bag", "metal_jerrycan_green", "small_lpg_tank", "tool_cart",
    "worn_metal_rack", "fire_hydrant", "modular_electric_cables", "modular_street_seating", "metal_stool_02",
    "bar_chair_round_01", "hanging_industrial_lamp", "ceramic_pot", "planter_pot_clay",
    "wooden_ladder", "binder_notebook", "clipboard", "hamburger_buns", "bananas", "lemon", "desk_lamp_arm_01", "lightbulb_01", "garden_sprinkler_01", "watering_can_metal_01", "rusted_wheel_rim_02",
    "rusted_spade_01", "wooden_broom", "leather_cleaner_can", "cleaner_tin_01",
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
