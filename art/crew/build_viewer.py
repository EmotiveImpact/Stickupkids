import base64, sys
glb, tpl, out = sys.argv[1:4]
b64 = base64.b64encode(open(glb, "rb").read()).decode()
open(out, "w").write(open(tpl).read().replace("__GLB__", b64))
