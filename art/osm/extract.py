"""Cut a slice of OpenStreetMap data into level space.

Reads a raw Overpass extract (art/osm/burgess-raw.json, not committed; fetch it
with the query in art/osm/README.md), projects it to metres around an origin,
turns it so the level's main path runs west to east, and writes the features
the level and the Blender builder use.

Map data © OpenStreetMap contributors, available under the Open Database
Licence (https://www.openstreetmap.org/copyright).

Run: python3 art/osm/extract.py burgess
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = 6378137.0

SLICES = {
    # The old lime kiln in Burgess Park, Camberwell. Turned so the line of the
    # old Grand Surrey Canal (now a cycle path) runs straight across the map.
    "burgess": {
        "raw": "burgess-raw.json",
        "origin": (51.48217, -0.08795),
        "turn": math.degrees(math.atan2(6.7, 50.0)),
        # Level cell (0, 0) sits at this point of the turned frame, metres:
        # from Albany Road in the north-west to Wells Way in the east, the
        # kiln about a third of the way across.
        "corner": (-90.0, -115.0),
        "size": (250, 155),
        # Keep features this far past the map edge for the scenery.
        "margin": 60.0,
    },
}


def main(name):
    cfg = SLICES[name]
    raw = json.load(open(os.path.join(HERE, cfg["raw"])))
    lat0, lon0 = cfg["origin"]
    th = math.radians(cfg["turn"])
    c, s = math.cos(th), math.sin(th)
    cx, cy = cfg["corner"]
    w, h = cfg["size"]
    mg = cfg["margin"]

    def proj(lat, lon):
        x = math.radians(lon - lon0) * R * math.cos(math.radians(lat0))
        y = -math.radians(lat - lat0) * R
        xr, yr = x * c - y * s, x * s + y * c
        return (round(xr - cx, 2), round(yr - cy, 2))

    def near(pts):
        return any(-mg <= x <= w + mg and -mg <= y <= h + mg for x, y in pts)

    out = {"name": name, "size": [w, h], "credit": "Map data © OpenStreetMap contributors (ODbL)",
           "paths": [], "trees": [], "buildings": [], "barriers": [], "water": [], "areas": []}
    for e in raw["elements"]:
        t = e.get("tags", {})
        if e["type"] == "node":
            if t.get("natural") == "tree":
                p = proj(e["lat"], e["lon"])
                if near([p]):
                    out["trees"].append(p)
            continue
        geoms = []
        if e["type"] == "way":
            geoms = [e.get("geometry", [])]
        else:
            geoms = [m["geometry"] for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
        for g in geoms:
            pts = [proj(q["lat"], q["lon"]) for q in g]
            if len(pts) < 2 or not near(pts):
                continue
            if "highway" in t:
                hw = t["highway"]
                width = {"cycleway": 3.2, "footway": 2.2, "path": 1.6, "service": 3.5, "residential": 7.0,
                         "secondary": 9.0, "tertiary": 8.0, "primary": 10.0, "steps": 2.0}.get(hw, 2.5)
                out["paths"].append({"kind": hw, "width": width, "surface": t.get("surface", "asphalt"), "pts": pts})
            elif "building" in t:
                out["buildings"].append({"name": t.get("name"), "levels": t.get("building:levels"),
                                         "kind": t["building"], "historic": bool(t.get("historic")), "pts": pts})
            elif "barrier" in t:
                out["barriers"].append({"kind": t["barrier"], "pts": pts})
            elif t.get("natural") == "water":
                out["water"].append(pts)
            elif "leisure" in t or "landuse" in t or "natural" in t or t.get("amenity") == "parking":
                out["areas"].append({"kind": t.get("leisure") or t.get("landuse") or t.get("natural") or "parking", "pts": pts})
    path = os.path.join(HERE, f"{name}.json")
    json.dump(out, open(path, "w"), separators=(",", ":"))
    print(path, {k: len(v) for k, v in out.items() if isinstance(v, list)}, f"{os.path.getsize(path) / 1e3:.0f} kB")
    write_ground(name, out)


ROADS = ("tertiary", "secondary", "primary", "residential", "service", "unclassified")


def write_ground(name, d):
    """The map's cells from the slice: buildings (X), fences (=), roads (r)
    and paths (p) over grass (g), plus the trees inside the map, as a
    TypeScript module for the level. The kiln is left to the level."""
    import numpy as np
    w, h = d["size"]
    X, Y = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    grid = np.full((h, w), "g")

    def near_line(pts, half):
        hit = np.zeros((h, w), bool)
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            dx, dy = bx - ax, by - ay
            q = dx * dx + dy * dy or 1e-9
            t = np.clip(((X - ax) * dx + (Y - ay) * dy) / q, 0, 1)
            hit |= np.hypot(X - ax - t * dx, Y - ay - t * dy) < half
        return hit

    for p in d["paths"]:
        if p["kind"] not in ROADS:
            grid[near_line(p["pts"], p["width"] / 2)] = "p"
    for p in d["paths"]:
        if p["kind"] in ROADS:
            grid[near_line(p["pts"], p["width"] / 2)] = "r"

    def inside(pts):
        hit = np.zeros((h, w), bool)
        for (ax, ay), (bx, by) in zip(pts, pts[1:] + pts[:1]):
            if ay == by:
                continue
            crosses = (ay > Y) != (by > Y)
            xc = ax + (Y - ay) * (bx - ax) / (by - ay)
            hit ^= crosses & (X < xc)
        return hit

    for a in d["areas"]:
        if a["kind"] == "parking":
            grid[inside(a["pts"])] = "r"
    for b in d["buildings"]:
        if not b["historic"]:
            grid[inside(b["pts"])] = "X"
    # Fences: every cell the line passes through, so there is no gap to slip
    # through diagonally.
    for f in d["barriers"]:
        if f["kind"] not in ("fence", "wall"):
            continue
        for (ax, ay), (bx, by) in zip(f["pts"], f["pts"][1:]):
            n = max(1, int(math.hypot(bx - ax, by - ay) / 0.2))
            for i in range(n + 1):
                x, y = math.floor(ax + (bx - ax) * i / n), math.floor(ay + (by - ay) * i / n)
                if 0 <= x < w and 0 <= y < h and grid[y, x] != "X":
                    grid[y, x] = "="
    rows = ["".join(r) for r in grid]
    trees = [(math.floor(x), math.floor(y)) for x, y in d["trees"] if 0 <= x < w and 0 <= y < h]
    path = os.path.join(HERE, "..", "..", "src", "sim", f"{name}Ground.ts")
    with open(path, "w") as f:
        f.write("// Generated by art/osm/extract.py from OpenStreetMap data. Do not edit.\n")
        f.write("// Map data © OpenStreetMap contributors, available under the Open Database Licence.\n\n")
        f.write(f"/** Buildings (X), fences (=), roads (r) and paths (p) over grass (g), {w} by {h}, one cell a metre. */\n")
        f.write("export const GROUND = [\n" + "".join(f"  '{r}',\n" for r in rows) + "];\n\n")
        f.write("/** Mapped trees inside the map, by cell. */\n")
        f.write("export const TREES: [number, number][] = " + json.dumps(trees) + ";\n")
    print(path)


main(sys.argv[1] if len(sys.argv) > 1 else "burgess")
