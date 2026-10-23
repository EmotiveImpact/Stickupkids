"""Generates Stickupkids reference images and 3D meshes on Hugging Face Spaces.

    pip install gradio_client
    python generate_hf.py OUTDIR [name ...]        # all assets, or just the named ones

For each asset it paints a clean reference image with Qwen-Image (Apache 2.0)
and lifts it to a textured mesh with TRELLIS (MIT), saving OUTDIR/NAME.png
and OUTDIR/NAME.glb. Assets that already have a .glb are skipped, so the
script can be re-run after a ZeroGPU quota pause. Set HF_TOKEN to use your
own quota (free accounts get a few minutes of GPU a day).
"""
import os, sys, shutil, time
from gradio_client import Client, handle_file

IMAGE_SPACE = "mcp-tools/Qwen-Image"
MESH_SPACE = "trellis-community/TRELLIS"

STYLE = ("Stylised realistic AAA game character asset, clean readable shapes, matte fabric materials, "
         "soft even studio lighting, no shadows, plain pure white background, whole body visible head to toe, centred, ")
POSE = ("front view, standing in a relaxed A-pose with straight arms angled 35 degrees away from the body, "
        "open empty hands, feet shoulder width apart, looking straight ahead, ")
PROP = "Single game prop, three-quarter view from slightly above, isolated, plain pure white background, soft even lighting, "

ASSETS = {
    # humans: one crew body; its cyan trim is split into a recolourable Slot material
    "crew": POSE + "young London street robber in a black knitted balaclava with eye slit, black quilted puffer jacket "
            "with one bright cyan stripe down each sleeve, black tracksuit bottoms with a cyan side stripe, black trainers, "
            "slim black tactical chest rig and small backpack, no weapon, " + STYLE,
    "dealer": POSE + "flashy south London drug dealer, mid twenties, short fade haircut, grey velour tracksuit, "
              "thick gold chain, white trainers, no weapon, " + STYLE,
    "soldier": POSE + "London gang enforcer, black puffer jacket zipped up, black baseball cap, dark grey joggers, "
               "black trainers, black neck gaiter over chin, no weapon, " + STYLE,
    "runner": POSE + "skinny teenage lookout, oversized dark navy hoodie with hood up, black joggers, "
              "white trainers, crossbody bag, no weapon, " + STYLE,
    "dog": "Side view of a muscular grey pit bull terrier dog standing on all four legs, head facing left, "
           "studded black collar, tail straight, " + STYLE.replace("character ", "creature "),
    "rifle": PROP + "compact black assault carbine with short barrel and folding stock, side view, long axis horizontal",
    "pistol": PROP + "black semi-automatic handgun, side view, barrel pointing left",
    "sofa": PROP + "worn dark charcoal leather three-seat sofa with a crumpled grey throw",
    "stash_table": PROP + "low glass coffee table covered in bundled cash stacks, scales, small clear bags and a phone",
    "safe": PROP + "heavy black steel floor safe with brass dial and handle, closed",
    "cash_bag": PROP + "black duffel bag unzipped and stuffed with banknote bundles",
    "crate": PROP + "black plastic hard flight case with metal latches, closed",
}

def image(cli, prompt, path):
    tall = not any(k in prompt for k in ("Single game prop", "Side view of a"))
    res = cli.predict(prompt=prompt, seed=7, randomize_seed=False,
                      aspect_ratio="3:4" if tall else "4:3",
                      api_name="/generate_image")
    src = res[0] if isinstance(res, (list, tuple)) else res
    src = src.get("path", src) if isinstance(src, dict) else src
    shutil.copy(src, path)

def mesh(cli, img, path):
    try:
        cli.predict(api_name="/start_session")
    except Exception:
        pass
    res = cli.predict(
        image=handle_file(img), multiimages=[], seed=0,
        ss_guidance_strength=7.5, ss_sampling_steps=12,
        slat_guidance_strength=3, slat_sampling_steps=12,
        multiimage_algo="stochastic", mesh_simplify=0.95, texture_size=1024,
        api_name="/generate_and_extract_glb")
    glb = next(r for r in res if isinstance(r, str) and r.endswith(".glb"))
    shutil.copy(glb, path)

def main():
    out = sys.argv[1]
    names = sys.argv[2:] or list(ASSETS)
    os.makedirs(out, exist_ok=True)
    tok = os.environ.get("HF_TOKEN")
    icli = Client(IMAGE_SPACE, token=tok)
    mcli = Client(MESH_SPACE, token=tok)
    for n in names:
        png, glb = os.path.join(out, n + ".png"), os.path.join(out, n + ".glb")
        if os.path.exists(glb):
            print("skip", n); continue
        t = time.time()
        if not os.path.exists(png):
            image(icli, ASSETS[n], png)
        mesh(mcli, png, glb)
        print("done", n, "%.0fs" % (time.time() - t), flush=True)

if __name__ == "__main__":
    main()
