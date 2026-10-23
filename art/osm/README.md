# OpenStreetMap data

Real London streets, paths and parks for the levels and the job board.

Map data © OpenStreetMap contributors, available under the Open Database
Licence (https://www.openstreetmap.org/copyright). The credit shows on the
job board under the map; keep it there if the map is used anywhere else.

## Files

| File | What it is |
| --- | --- |
| `extract.py` | Cuts a raw extract into level space: `burgess.json` here and `src/sim/burgessGround.ts` |
| `citymap.py` | Simplifies the London extract into `src/ui/cityMap.ts`, the job board's map |
| `burgess.json` | Paths, trees and the kiln's outline around the Burgess Park job, in level metres |
| `*-raw.json` | Raw Overpass answers. Not committed (large, and easy to fetch again) |

## Fetching the raw extracts

Overpass refuses requests without a user agent, and the cloud sandbox cannot
reach it at all; fetch from a normal machine:

```sh
curl -s -A "StickupKids-level-builder/1.0" -H "Accept: application/json" \
  --data-urlencode data@burgess.overpassql https://overpass-api.de/api/interpreter > art/osm/burgess-raw.json
```

`burgess.overpassql` (the park and its edges):

```
[out:json][timeout:120];
(
  way["highway"](51.4770,-0.1010,51.4880,-0.0670);
  way["building"](51.4770,-0.1010,51.4880,-0.0670);
  relation["building"](51.4770,-0.1010,51.4880,-0.0670);
  way["leisure"](51.4770,-0.1010,51.4880,-0.0670);
  relation["leisure"](51.4770,-0.1010,51.4880,-0.0670);
  way["landuse"](51.4770,-0.1010,51.4880,-0.0670);
  way["natural"](51.4770,-0.1010,51.4880,-0.0670);
  relation["natural"](51.4770,-0.1010,51.4880,-0.0670);
  way["waterway"](51.4770,-0.1010,51.4880,-0.0670);
  way["barrier"](51.4770,-0.1010,51.4880,-0.0670);
  way["amenity"](51.4770,-0.1010,51.4880,-0.0670);
  node["natural"="tree"](51.4770,-0.1010,51.4880,-0.0670);
  node["highway"="street_lamp"](51.4770,-0.1010,51.4880,-0.0670);
);
out geom;
```

`london.overpassql` (the Thames, main roads and named parks, for the job board), saved as `london-raw.json`:

```
[out:json][timeout:180];
(
  way["waterway"="river"]["name"="River Thames"](51.43,-0.30,51.56,0.05);
  way["highway"~"^(motorway|trunk)$"](51.43,-0.30,51.56,0.05);
  way["leisure"="park"]["name"](51.43,-0.30,51.56,0.05);
);
out geom;
```

Then:

```sh
python3 art/osm/extract.py burgess
python3 art/osm/citymap.py
```

Moving or resizing the Burgess slice (origin, turn, corner, size in
`extract.py`) moves every path under the level's hand-placed kiln, shrubs,
props and patrols in `src/sim/burgess.ts`; check the sample plan still runs
(`npm test`) and rebuild the park in Blender (`art/level/build_park.py`).
