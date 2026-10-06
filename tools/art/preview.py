# Composes the built town (ground + objects) and a monster/prop board into media/ for a quick look. python tools/art/preview.py
import json, os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
G, OUT = os.path.join(ROOT, "app", "game"), os.path.join(ROOT, "media")
t = json.load(open(os.path.join(G, "town.json")))
im = Image.open(os.path.join(G, t["ground"])).convert("RGBA")
for o in t["objects"]: im.alpha_composite(Image.open(os.path.join(G, "obj", o["key"] + ".png")).convert("RGBA"), (o["x"], o["y"]))
im.resize((im.width * 2, im.height * 2), Image.NEAREST).save(os.path.join(OUT, "town_full.png"))
board = Image.new("RGBA", (330, 330), (22, 19, 31, 255)); x = y = 6; rowh = 0
for k in sorted(os.listdir(os.path.join(G, "mons"))):
    s = Image.open(os.path.join(G, "mons", k)).convert("RGBA")
    if x + s.width > 324: x, y, rowh = 6, y + rowh + 6, 0
    board.alpha_composite(s, (x, y)); x += s.width + 8; rowh = max(rowh, s.height)
for i, f in enumerate(["dng/tiles.png", "dng/props.png", "fx/slash.png"]):
    s = Image.open(os.path.join(G, f)).convert("RGBA"); board.alpha_composite(s, (6 + (i % 2) * 140, 260 + (i // 2) * 36))
board.resize((board.width * 4, board.height * 4), Image.NEAREST).save(os.path.join(OUT, "mons_board.png"))
print("ok")
