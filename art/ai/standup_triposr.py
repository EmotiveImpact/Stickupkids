"""Stands a TripoSR mesh up for rig_humanoid.py: python standup_triposr.py IN.glb OUT.glb 1 1

TripoSR (MIT) runs on CPU in a few minutes per image: clone VAST-AI-Research/TripoSR,
swap torchmcubes for skimage.measure.marching_cubes, and run run.py --device cpu
--mc-resolution 256 --model-save-format glb (no --bake-texture headless; vertex colours).
"""
import sys, trimesh, numpy as np
src, out, sx, sz = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
s = trimesh.load(src); g = list(s.geometry.values())[0]
# TripoSR: Z up, Y across the shoulders, X depth. glTF wants Y up, X across, Z depth.
M = np.array([[0, sx, 0, 0], [0, 0, 1, 0], [sz, 0, 0, 0], [0, 0, 0, 1]], float)
if np.linalg.det(M[:3, :3]) < 0: M[0] *= -1
g.apply_transform(M); g.export(out); print(g.extents)
