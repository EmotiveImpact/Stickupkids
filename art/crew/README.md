# Crew character

A rigged, animated low-poly crew member, built entirely from a Blender script.

- `make_crew.py` builds the mesh, skeleton, IK and five looping clips (Idle, Walk, Run, CrouchIdle, CrouchWalk) and exports `crew.glb`.
- `viewer.template.html` and `build_viewer.py` make a standalone Babylon.js viewer with the .glb embedded.

```sh
pip install bpy                       # Blender as a Python module
python make_crew.py crew.glb
python build_viewer.py crew.glb viewer.template.html crew-viewer.html
```

Recolour at runtime by changing the material called `Slot` (crew colour, or enemy red). The rifle is its own mesh, `Weapon`, so it can be hidden or swapped. Clips play in place; the game moves the root.
