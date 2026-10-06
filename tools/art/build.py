# Draws all of Viberquest's world art from code (no third-party art):
#   app/game/town_ground.png, app/game/obj/*.png, app/game/town.json   the town (same contract the TownScene reads)
#   app/game/dng/tiles.png, props.png                                   dungeon tiles (16x16) and props (16x16 frames)
#   app/game/mons/<Type>.png                                             monsters and bosses (4 frames in a row)
#   app/game/fx/slash.png, items/coin.png, items/potion.png              effects and pickups
# Run from the repo root: python tools/art/build.py   (heroes are drawn in the browser by app/game/chibi.js)
import json, math, os, random, shutil, sys
sys.path.insert(0, os.path.dirname(__file__))
from px import *
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "app", "game")
R = random.Random(11)
def save(im, *p):
    f = os.path.join(OUT, *p); os.makedirs(os.path.dirname(f), exist_ok=True); im.save(f, optimize=True)
for d in ("obj", "mons", "dng"): shutil.rmtree(os.path.join(OUT, d), ignore_errors=True)

T, W, H = 16, 48, 36

# =============================================================== town ground
road = [[False] * W for _ in range(H)]
def street(x0, y0, x1, y1):
    for y in range(y0, y1):
        for x in range(x0, x1):
            if 0 <= x < W and 0 <= y < H: road[y][x] = True
street(4, 12, 44, 16); street(4, 24, 44, 28); street(22, 3, 26, 36); street(19, 16, 29, 24)
def isroad(x, y): return 0 <= x < W and 0 <= y < H and road[y][x]

g = Canvas(W * T, H * T, "#0f2621")
for _ in range(W * H * 6): g.px(R.randrange(W * T), R.randrange(H * T), R.choice(["#123029", "#163a30", "#0c201b", "#11302a"]))
for _ in range(W * H // 3):   # grass tufts
    x, y = R.randrange(W * T), R.randrange(H * T); c = R.choice(["#1f4a38", "#24573f"]); g.px(x, y, c); g.px(x + 1, y - 1, c); g.px(x - 1, y - 1, c)
for ty in range(H):
    for tx in range(W):
        if not road[ty][tx]: continue
        x0, y0 = tx * T, ty * T
        g.rect(x0, y0, T, T, "#2a2f40")
        for row in range(4):   # cobbles: 4 rows of stones with staggered joints
            y = y0 + row * 4; off = (row + ty) % 2 * 3; x = x0 - off
            while x < x0 + T:
                w = R.randint(4, 6); c = R.choice(["#363c51", "#3a4157", "#323848", "#3d445c"])
                g.rect(max(x, x0), y, min(w - 1, x0 + T - max(x, x0)), 3, c); g.hline(max(x, x0), y, min(w - 1, x0 + T - max(x, x0)), shade(c, 1.15))
                x += w
        # curbs where the road meets grass
        if not isroad(tx, ty - 1): g.hline(x0, y0, T, "#59607a"); g.hline(x0, y0 + 1, T, "#1c2030")
        if not isroad(tx, ty + 1): g.hline(x0, y0 + T - 1, T, "#1a1d29"); g.hline(x0, y0 + T - 2, T, "#4a5068")
        if not isroad(tx - 1, ty): g.vline(x0, y0, T, "#4a5068")
        if not isroad(tx + 1, ty): g.vline(x0 + T - 1, y0, T, "#1a1d29")
# lime road markings down the main road
for y in range(3 * T, H * T, 12):
    if not (16 * T <= y < 24 * T): g.rect(24 * T - 1, y, 2, 6, "#5d6a10")
save(g.final(), "town_ground.png")

# =============================================================== town objects
SPR, objects, occupied = {}, [], [[False] * W for _ in range(H)]
def put(key, im): SPR[key] = im; save(im, "obj", key + ".png")

def brick_wall(c, x, y, w, h, col, mortar):
    c.rect(x, y, w, h, col)
    for ry in range(y, y + h, 4):
        c.hline(x, ry, w, mortar)
        for bx in range(x + (0 if (ry // 4) % 2 else 4), x + w, 8): c.vline(bx, ry, 4, mortar)
    c.vline(x, y, h, shade(col, 1.18)); c.vline(x + w - 1, y, h, shade(col, .75))

def roof_slab(c, x, y, w, h, col):
    c.rect(x, y, w, h, col); c.rect(x + 1, y - 2, w - 2, 2, shade(col, 1.3)); c.hline(x + 2, y - 3, w - 4, shade(col, 1.55))
    for ry in range(y + 2, y + h - 2, 3):
        c.hline(x + 1, ry, w - 2, shade(col, .78))
        for sx in range(x + (ry % 2) * 3, x + w, 6): c.px(sx, ry - 1, shade(col, 1.15))
    c.rect(x - 1, y + h - 2, w + 2, 2, shade(col, .5))

def window(c, x, y, lit="#ffcf6e", w=10, h=8):
    c.rect(x - 1, y - 1, w + 2, h + 2, "#141822"); c.rect(x, y, w, h, lit); c.rect(x, y, w, 2, mix(lit, WHITE, .5))
    c.vline(x + w // 2, y, h, "#141822"); c.hline(x, y + h // 2, w, "#141822"); c.light(x - 4, y - 3, w + 8, h + 6, lit, 120)

def door(c, x, y, col, w=10, h=14):
    c.rect(x - 1, y - 1, w + 2, h + 1, col); c.rect(x, y, w, h, "#120f0c"); c.rect(x + 1, y + 1, w - 2, h - 1, "#3a2a1f")
    c.vline(x + w // 2, y + 1, h - 1, "#2a1e16"); c.px(x + w - 3, y + h // 2, GOLD); c.light(x - 5, y - 4, w + 10, h + 6, col, 80)

def sign(c, cx, y, label, col):
    w = text_w(label) + 6; x = cx - w // 2
    c.rect(x, y, w, 9, "#0b0d12"); c.rect(x, y, w, 1, col); c.rect(x, y + 8, w, 1, col); c.rect(x, y, 1, 9, col); c.rect(x + w - 1, y, 1, 9, col)
    c.text(label, x + 3, y + 2, mix(col, WHITE, .35), glow=col); c.light(x - 2, y - 2, w + 4, 13, col, 90, ellipse=False)

PAD, TOP = 14, 30   # every building canvas: PAD px on both sides, TOP px of headroom for signs, chimneys, trophies
def house(w, h, roof, wall, label=None, col=LIME, lit="#ffcf6e", rf=.46, windows=2):
    c = Canvas(w + PAD * 2, h + TOP); x, y = PAD, TOP; rh = int(h * rf)
    c.ellipse(x - 4, y + h - 6, w + 8, 10, "#0a0d14")
    brick_wall(c, x + 3, y + rh - 2, w - 6, h - rh + 2, wall, shade(wall, .78)); c.rect(x + 3, y + rh, w - 6, 3, shade(wall, .6))
    roof_slab(c, x, y, w, rh, roof)
    door(c, x + w // 2 - 5, y + h - 14, col)
    wins = [x + 8, x + w - 18] if windows == 2 else [x + 8, x + w // 2 - 5, x + w - 18] if windows == 3 else []
    for wx in wins:
        if abs(wx - (x + w // 2 - 5)) > 8: window(c, wx, y + rh + 4, lit)
    if label: sign(c, x + w // 2, y + rh - 6, label, col)
    return c, x, y, rh

def b_quests():
    c, x, y, rh = house(76, 66, "#1e5e5a", "#4a4f66", "QUESTS", LIME)
    bx, by = x + 6, y + 50   # notice board on the wall
    c.rect(bx, by, 16, 12, "#4a3424"); c.rect(bx + 1, by + 1, 14, 10, "#6b4c33")
    for (ox, oy, cc) in [(2, 2, WHITE), (6, 1, GOLD), (10, 2, WHITE), (3, 6, LIME), (8, 6, WHITE), (12, 6, PINK)]: c.rect(bx + ox, by + oy, 3, 3, cc)
    ex = x + 38 - 1; c.rect(ex, y - 22, 3, 8, LIME); c.rect(ex, y - 12, 3, 2, LIME); c.light(ex - 6, y - 26, 15, 20, LIME, 220)
    return c
def b_forge():
    c, x, y, rh = house(64, 60, "#6b2f22", "#4a4f66", "FORGE", ORANGE, lit="#ff8a3c")
    cx = x + 44; c.rect(cx, y - 14, 9, 14, "#3a3036"); c.rect(cx - 1, y - 15, 11, 2, "#4a3e44")
    c.rect(cx + 2, y - 19, 5, 4, ORANGE); c.px(cx + 4, y - 21, GOLD); c.light(cx - 6, y - 28, 22, 20, ORANGE, 220)
    ax = x + 65
    c.rect(ax, y + 52, 12, 3, "#5c6470"); c.rect(ax + 3, y + 55, 6, 5, "#454b55"); c.rect(ax + 1, y + 51, 10, 1, "#8a929c")
    c.px(ax + 4, y + 50, GOLD); c.px(ax + 8, y + 49, ORANGE); c.light(ax - 3, y + 44, 18, 12, ORANGE, 160)
    return c
def b_furnace():   # the furnace: a round brick tower with a roaring mouth, burns $VQUEST
    w, h = 56, 84; c = Canvas(w + PAD * 2, h + TOP); x, y = PAD, TOP
    c.ellipse(x - 4, y + h - 6, w + 8, 10, "#0a0d14")
    brick_wall(c, x + 4, y + 10, w - 8, h - 10, "#6a3a30", "#4a2620")
    for i in range(0, w - 8, 6): c.rect(x + 4 + i, y + 4, 4, 6, "#6a3a30"); c.hline(x + 4 + i, y + 4, 4, "#8a4e40")   # battlements
    c.rect(x + 4, y + 10, w - 8, 2, "#3a1e18")
    mx, my = x + w // 2 - 10, y + h - 26
    c.ellipse(mx, my, 20, 16, "#1a0c08"); c.rect(mx, my + 8, 20, 18, "#1a0c08")
    for i, col in enumerate([RED, ORANGE, GOLD, "#fff1a8"]): c.ellipse(mx + 2 + i * 2, my + 6 + i * 3, 16 - i * 4, 20 - i * 5, col)
    c.light(mx - 10, my - 6, 40, 34, ORANGE, 240)
    for i in range(3): c.rect(x + 20 + i * 6, y - 6 - i * 5, 5, 4, "#4a4458")   # smoke
    sign(c, x + w // 2, y + 20, "FURNACE", ORANGE)
    return c
def b_guild():
    c, x, y, rh = house(84, 80, "#3b357a", "#4a4f66", "GUILD", IRIS, rf=.4, windows=3)
    for bx in (x + 3, x + 84 - 9):
        c.rect(bx, y + rh, 6, 18, IRIS); c.rect(bx + 1, y + rh + 18, 4, 1, IRIS); c.px(bx, y + rh + 18, IRIS); c.px(bx + 5, y + rh + 18, IRIS)
        for i, (dx, dy) in enumerate([(1, 4), (2, 5), (3, 6), (4, 5), (5, 4)]): c.px(bx + dx - 0, y + rh + dy, LIME)
        c.rect(bx - 1, y + rh - 1, 8, 1, GOLD)
    fx = x + 42; c.vline(fx, y - 20, 18, "#8a929c"); c.rect(fx + 1, y - 20, 10, 6, IRIS); c.px(fx + 5, y - 18, LIME); c.px(fx + 6, y - 17, LIME)
    return c
def b_fame():   # hall of fame: a small temple with a glowing trophy
    w, h = 72, 70; c = Canvas(w + PAD * 2, h + TOP); x, y = PAD, TOP
    c.ellipse(x - 4, y + h - 6, w + 8, 10, "#0a0d14")
    stone, sd = "#d9d2c0", "#a59d88"
    for i in range(16): c.hline(x + 36 - i * 2 - 2, y + 4 + i, i * 4 + 4, stone if i < 15 else sd)   # pediment
    c.rect(x, y + 20, w, 4, stone); c.hline(x, y + 23, w, sd)
    c.rect(x + 4, y + 24, w - 8, h - 30, "#2a2d3c")
    for cx in range(x + 6, x + w - 4, 15): c.rect(cx, y + 24, 6, h - 30, stone); c.vline(cx + 5, y + 24, h - 30, sd); c.rect(cx - 1, y + 24, 8, 2, sd)
    for i in range(3): c.rect(x - 2 + i * 2, y + h - 6 + i * 2, w + 4 - i * 4, 2, shade(stone, .8 - i * .08))
    tx = x + 32   # trophy on the roof
    c.rect(tx, y - 10, 9, 6, GOLD); c.rect(tx + 2, y - 4, 5, 2, GOLD); c.rect(tx + 1, y - 2, 7, 2, shade(GOLD, .7)); c.px(tx - 1, y - 9, GOLD); c.px(tx + 9, y - 9, GOLD)
    c.light(tx - 8, y - 18, 25, 22, GOLD, 230)
    door(c, x + 31, y + h - 20, GOLD, 10, 14)
    sign(c, x + w // 2, y + 13, "FAME", GOLD)
    return c
def b_treasury():   # stone vault with a gold dome and a round vault door
    w, h = 66, 66; c = Canvas(w + PAD * 2, h + TOP); x, y = PAD, TOP
    c.ellipse(x - 4, y + h - 6, w + 8, 10, "#0a0d14")
    c.ellipse(x + 8, y - 6, w - 16, 30, "#b8901f"); c.ellipse(x + 12, y - 3, w - 26, 20, GOLD); c.rect(x + 30, y - 12, 6, 6, GOLD); c.light(x + 16, y - 10, 34, 24, GOLD, 120)
    brick_wall(c, x + 2, y + 8, w - 4, h - 8, "#5a6078", "#454a60"); c.rect(x, y + 6, w, 4, "#707892")
    vx, vy = x + w // 2 - 10, y + h - 26
    c.ellipse(vx - 1, vy - 1, 22, 22, INK); c.ellipse(vx, vy, 20, 20, "#c9a227"); c.ellipse(vx + 3, vy + 3, 14, 14, "#8a6d16")
    for a in range(0, 360, 60):
        r = math.radians(a); c.px(vx + 10 + round(math.cos(r) * 5), vy + 10 + round(math.sin(r) * 5), GOLD)
    c.rect(vx + 9, vy + 9, 3, 3, GOLD); c.light(vx - 4, vy - 4, 28, 28, GOLD, 120)
    for (sx, n) in [(x + 6, 4), (x + w - 14, 3)]:
        for i in range(n): c.rect(sx, y + h - 6 - i * 2, 8, 2, GOLD if i % 2 else shade(GOLD, .75))
    window(c, x + 7, y + 20, "#ffcf6e", 8, 7); window(c, x + w - 15, y + 20, "#ffcf6e", 8, 7)
    sign(c, x + w // 2, y + 10, "TREASURY", GOLD)
    return c
def b_arena():   # round arena wall with arches and crossed swords
    w, h = 88, 70; c = Canvas(w + PAD * 2, h + TOP); x, y = PAD, TOP
    c.ellipse(x - 4, y + h - 8, w + 8, 12, "#0a0d14")
    c.ellipse(x, y + 4, w, 30, "#7a3428"); c.ellipse(x + 8, y + 8, w - 16, 20, "#3a1a16")   # rim + inner pit
    c.rect(x, y + 19, w, h - 19, "#8a3e2e"); c.hline(x, y + 19, w, "#a65440")
    for ax in range(x + 4, x + w - 8, 14):
        c.rect(ax, y + 30, 8, 12, "#2a1210"); c.ellipse(ax, y + 27, 8, 6, "#2a1210"); c.rect(ax, y + 50, 8, h - 54, "#2a1210"); c.ellipse(ax, y + 47, 8, 6, "#2a1210")
        c.light(ax - 2, y + 30, 12, 12, ORANGE, 60)
    for f in (x + 6, x + w - 8): c.vline(f, y - 6, 14, "#8a929c"); c.rect(f + 1, y - 6, 7, 5, RED)
    sx, sy = x + w // 2, y + 6
    for i in range(12): c.px(sx - 6 + i, sy + i, "#c9d2d8"); c.px(sx + 6 - i, sy + i, "#c9d2d8")
    c.rect(sx - 8, sy + 9, 4, 2, GOLD); c.rect(sx + 5, sy + 9, 4, 2, GOLD)
    door(c, x + w // 2 - 6, y + h - 16, RED, 12, 16)
    sign(c, x + w // 2, y + 21, "ARENA", RED)
    return c
def b_tailor():
    c, x, y, rh = house(60, 58, "#7a2a5e", "#4a4f66", None, PINK)
    for i in range(0, 60, 6): c.rect(x + i, y + rh - 1, 6, 6, PINK if (i // 6) % 2 else WHITE)   # striped awning
    c.hline(x, y + rh + 5, 60, shade(PINK, .6))
    mx = x + 8; c.rect(mx - 1, y + rh + 8, 14, 18, "#141822"); c.rect(mx, y + rh + 9, 12, 16, "#2c3346")
    c.rect(mx + 3, y + rh + 11, 6, 5, SKINS[3]); c.rect(mx + 4, y + rh + 12, 4, 2, "#15171a"); c.px(mx + 5, y + rh + 12, LIME); c.rect(mx + 3, y + rh + 16, 6, 6, PINK)
    c.light(mx - 2, y + rh + 6, 18, 20, PINK, 90)
    sign(c, x + 30, y + rh - 10, "TAILOR", PINK)
    return c
def b_market():   # shop with a big screen on the roof showing a chart
    c, x, y, rh = house(70, 58, "#1e4a66", "#4a4f66", None, CYAN)
    sx, sy = x + 8, y - 24
    c.vline(sx + 8, sy + 22, 6, "#5c6470"); c.vline(sx + 46, sy + 22, 6, "#5c6470")
    c.rect(sx - 1, sy - 1, 56, 24, CYAN); c.rect(sx, sy, 54, 22, "#06121a")
    pts = [16, 14, 15, 11, 12, 8, 9, 5, 7, 3]
    for i, v in enumerate(pts):
        up = i == 0 or v <= pts[i - 1]; col = "#3ddc84" if up else RED; bx = sx + 3 + i * 5
        c.vline(bx + 1, sy + v - 1, 5, shade(col, .7)); c.rect(bx, sy + v, 3, 3, col)
    c.light(sx - 4, sy - 4, 62, 30, CYAN, 90, ellipse=False)
    sign(c, x + 35, y + rh - 6, "MARKET", CYAN)
    return c
def b_house(roof, wall):
    c, *_ = house(R.choice([52, 56, 60]), R.choice([50, 54]), roof, wall, None, "#5a6078", windows=2); return c

def gate():
    w, h = 48, 56; c = Canvas(w + PAD * 2, h + TOP); x, y = PAD, TOP
    st, sd = "#3a3350", "#2a2440"
    c.ellipse(x - 4, y + h - 6, w + 8, 10, "#0a0d14")
    c.rect(x, y + 10, w, h - 10, st)
    for ry in range(y + 10, y + h, 5):
        c.hline(x, ry, w, sd)
        for bx in range(x + (ry % 2) * 5, x + w, 10): c.vline(bx, ry, 5, sd)
    c.ellipse(x + 2, y, w - 4, 26, st); c.ellipse(x + 9, y + 12, w - 18, 26, "#120a1e"); c.rect(x + 9, y + 25, w - 18, h - 27, "#120a1e")
    for i, col in enumerate(["#5a1f7a", "#7a2fb0", "#b04fe0", "#ff7ad9"]): c.ellipse(x + 11 + i * 2, y + 16 + i * 3, w - 22 - i * 4, h - 22 - i * 6, col)
    c.light(x + 2, y + 6, w - 4, h - 6, "#b04fe0", 230); c.light(x + 14, y + 20, w - 28, h - 30, PINK, 200)
    for sx in (x + 1, x + w - 5): c.rect(sx, y + 30, 4, 6, "#22262e"); c.rect(sx, y + 27, 4, 3, LIME); c.light(sx - 6, y + 20, 16, 16, LIME, 180)
    sign(c, x + w // 2, y - 6, "DUNGEON", PINK)
    return c

def tree(kind):
    if kind == "pine":
        c = Canvas(20, 32); c.ellipse(4, 26, 12, 5, "#081a16"); c.rect(9, 22, 3, 7, "#3a2a24")
        for i, (yy, ww) in enumerate([(2, 6), (7, 10), (12, 14), (17, 18)]): c.rect(10 - ww // 2, yy, ww, 7, "#0f3b38"); c.rect(10 - ww // 2 + 1, yy, ww // 2, 2, "#15514a")
    else:
        c = Canvas(24, 30); c.ellipse(4, 24, 16, 5, "#081a16"); c.rect(10, 17, 4, 9, "#3a2a24"); c.rect(10, 17, 1, 9, "#4a362e")
        for (ox, oy, r) in [(1, 7, 11), (6, 1, 11), (10, 8, 11), (4, 10, 11)]: c.ellipse(ox, oy, r + 1, r, "#0f3b38")
        for (ox, oy, r) in [(3, 7, 7), (8, 3, 7), (12, 9, 6)]: c.ellipse(ox, oy, r, r - 1, "#15514a")
    for _ in range(2):
        fx, fy = R.randint(2, c.w - 3), R.randint(2, c.h - 12); c.px(fx, fy, LIME); c.light(fx - 1, fy - 1, 3, 3, LIME, 255)
    c.outline("#06120f"); return c
def lamp():
    c = Canvas(14, 30); x = 6
    c.rect(x, 10, 2, 18, "#22262e"); c.rect(x - 1, 27, 4, 2, "#22262e"); c.rect(x - 2, 6, 6, 4, "#2c313a"); c.rect(x - 1, 7, 4, 2, LIME)
    c.light(x - 6, 1, 14, 13, LIME, 200); return c
def bush():
    c = Canvas(14, 10); c.ellipse(0, 1, 14, 9, "#123a30"); c.ellipse(2, 0, 9, 7, "#185040")
    for _ in range(3): fx, fy = R.randint(2, 11), R.randint(2, 7); col = R.choice([PINK, CYAN, LIME]); c.px(fx, fy, col); c.light(fx - 1, fy - 1, 3, 3, col, 200)
    return c
def flowers():
    c = Canvas(8, 6)
    for _ in range(3): fx, fy = R.randint(1, 6), R.randint(1, 4); col = R.choice([PINK, CYAN, LIME, GOLD]); c.px(fx, fy, col); c.px(fx, fy + 1, "#1f4a38"); c.light(fx - 1, fy - 1, 3, 3, col, 160)
    return c
def bench():
    c = Canvas(22, 10); c.rect(1, 2, 20, 2, "#6b4c33"); c.rect(1, 5, 20, 2, "#7a5a3e"); c.rect(2, 7, 2, 3, "#2c313a"); c.rect(18, 7, 2, 3, "#2c313a"); c.outline(); return c
def fountain():
    c = Canvas(50, 40); c.ellipse(1, 14, 48, 24, "#0a0d14")
    c.ellipse(2, 12, 46, 24, "#5a6078"); c.ellipse(5, 14, 40, 18, "#1a5a5a"); c.ellipse(9, 16, 32, 13, "#2fb3a0")
    for _ in range(10): c.px(R.randint(11, 38), R.randint(18, 27), "#9ff5e8")
    c.rect(22, 4, 6, 18, "#707892"); c.rect(20, 2, 10, 3, "#8a92ac"); c.rect(23, 0, 4, 3, LIME)
    for (dx, dy) in [(-6, 4), (-8, 8), (6, 4), (8, 8)]: c.px(25 + dx, 4 + dy, "#9ff5e8")
    c.light(4, 6, 42, 28, CYAN, 160); c.light(18, -2, 14, 10, LIME, 220)
    return c

def place(key, im, px_x, bottom, door=None, label=None, foot=None):
    """sprite with its visual centre at px_x and its bottom edge at px y=bottom; foot = (w, h) collision box at the bottom"""
    w, h = im.width, im.height; x, y = px_x - w // 2, bottom - h
    o = {"key": key, "x": x, "y": y, "w": w, "h": h}
    if foot: o["body"] = [px_x - foot[0] // 2, bottom - foot[1], foot[0], foot[1]]
    if door: o["door"] = {"id": door, "x": px_x, "y": bottom + 6, "label": label or door.upper()}
    objects.append(o)
    for yy in range(max(0, (bottom - (foot or (0, h))[1] - 4) // T), min(H, bottom // T + 1)):
        for xx in range(max(0, (px_x - w // 2) // T), min(W, (px_x + w // 2) // T + 1)): occupied[yy][xx] = True
    return o

def building(key, im, cx, bottom, door, label, inner_w, depth=.42):
    put(key, sprite(im)); bh = im.h - TOP
    return place(key, SPR[key], cx, bottom, door=door, label=label, foot=(inner_w - 6, int(bh * depth)))

N, S = 12 * T, 24 * T   # bottoms of the north and south rows
building("gate", gate(), 24 * T, 4 * T + 8, "dungeon", "DUNGEON", 48, .3)
building("quests", b_quests(), 7 * T + 2, N, "quests", "QUEST HALL", 76)
building("forge", b_forge(), 12 * T + 4, N, "forge", "FORGE", 64)
building("furnace", b_furnace(), 17 * T + 4, N, "furnace", "FURNACE", 56, .3)
building("guild", b_guild(), 30 * T, N, "guild", "GUILD HALL", 84, .35)
building("fame", b_fame(), 35 * T + 8, N, "fame", "HALL OF FAME", 72, .4)
building("treasury", b_treasury(), 40 * T + 8, N, "treasury", "TREASURY", 66, .45)
building("arena", b_arena(), 8 * T + 8, S, "arena", "ARENA", 88, .45)
building("tailor", b_tailor(), 14 * T, S, "tailor", "TAILOR", 60)
building("market", b_market(), 18 * T + 8, S, "billboard", "MARKET", 70)
for i, (cx, roof, wall) in enumerate([(30 * T + 8, "#3a4a2a", "#4a4f66"), (35 * T + 4, "#4a2a3a", "#555a72"), (40 * T, "#2a3a4a", "#4a4f66")]):
    building(f"house{i}", b_house(roof, wall), cx, S, None, None, 52, .45)
put("fountain", sprite(fountain())); place("fountain", SPR["fountain"], 24 * T, 21 * T, foot=(44, 16))
put("lamp", sprite(lamp()))
for (lx, ly) in [(21 * T, 12 * T), (27 * T, 12 * T), (21 * T, 24 * T), (27 * T, 24 * T), (5 * T, 16 * T + 12), (43 * T, 16 * T + 12), (5 * T, 28 * T + 12), (43 * T, 28 * T + 12), (21 * T, 5 * T), (27 * T, 5 * T)]:
    place("lamp", SPR["lamp"], lx, ly, foot=(4, 3))
put("bench", sprite(bench(), 0)); place("bench", SPR["bench"], 21 * T, 20 * T, foot=(20, 4)); place("bench", SPR["bench"], 27 * T, 20 * T, foot=(20, 4))
for k in ("tree_a", "tree_b", "tree_c"): put(k, sprite(tree("round")))
for k in ("pine_a", "pine_b"): put(k, sprite(tree("pine")))
for k in ("bush_a", "bush_b"): put(k, sprite(bush()))
for k in ("flowers_a", "flowers_b", "flowers_c"): put(k, sprite(flowers(), 2))
def free(tx, ty, tw, th): return all(0 <= tx + i < W and 0 <= ty + j < H and not occupied[ty + j][tx + i] and not road[ty + j][tx + i] for i in range(tw) for j in range(th))
for x in range(0, W, 2):
    for y in (1, 2, H - 1):
        if free(x, y - 1, 2, 2) and R.random() < .85: k = R.choice(["tree_a", "tree_b", "tree_c", "pine_a", "pine_b"]); place(k, SPR[k], x * T + 8, y * T + 12, foot=(8, 5))
for y in range(3, H - 1, 2):
    for x in (0, 1, W - 2, W - 1):
        if free(x, y - 1, 1, 2) and R.random() < .8: k = R.choice(["tree_a", "pine_a", "tree_b", "pine_b"]); place(k, SPR[k], x * T + 8, y * T + 12, foot=(8, 5))
for _ in range(260):   # little groves in the open grass
    x, y = R.randrange(2, W - 3), R.randrange(2, H - 2)
    if free(x - 1, y - 2, 3, 3) and R.random() < .3: k = R.choice(["tree_a", "tree_b", "tree_c", "pine_a", "pine_b"]); place(k, SPR[k], x * T + 8, y * T + 12, foot=(8, 5))
for _ in range(160):
    x, y = R.randrange(2, W - 2), R.randrange(2, H - 2)
    if free(x, y, 1, 1):
        k = R.choice(["flowers_a", "flowers_b", "flowers_c", "bush_a", "bush_b", "flowers_a"]); place(k, SPR[k], x * T + 8, y * T + 12, foot=(10, 4) if k.startswith("bush") else None)
objects.sort(key=lambda o: o["y"] + o["h"])
town = {"w": W * T, "h": H * T, "tile": T, "ground": "town_ground.png", "spawn": [24 * T, 23 * T], "chest": [19 * T + 8, 14 * T + 8], "objects": objects}
json.dump(town, open(os.path.join(OUT, "town.json"), "w"), separators=(",", ":"))

# =============================================================== dungeon tiles + props
tiles = Canvas(16 * 8, 16 * 2)
def floor_tile(c, x, y, variant):
    c.rect(x, y, 16, 16, ["#221d2e", "#251f33", "#201b2b", "#231e31"][variant % 4])
    for (sx, sy) in [(0, 0), (8, 0), (4, 8), (12, 8)]:
        c.hline(x + sx, y + sy + 7, 8, "#18141f"); c.vline(x + (sx + 7) % 16, y + sy, 8, "#18141f")
    if variant == 1: c.px(x + 3, y + 4, "#221e30"); c.px(x + 4, y + 5, "#221e30")
    if variant == 2: c.hline(x + 9, y + 11, 3, "#1e1a2b")
    if variant == 3: c.px(x + 12, y + 3, "#2a2440")
for i in range(4): floor_tile(tiles, i * 16, 0, i)
for i, col in enumerate(["#1f4a2c", "#4a1f26"]):   # engraved candles (green / red)
    floor_tile(tiles, (4 + i) * 16, 0, 0)
    for j, (cx, cy, h) in enumerate([(3, 6, 5), (7, 3 + i * 4, 6), (11, 5 - i * 2, 7)]):
        tiles.vline((4 + i) * 16 + cx + 1, cy - 2, h + 4, shade(col, .8)); tiles.rect((4 + i) * 16 + cx, cy, 3, h, col)
floor_tile(tiles, 6 * 16, 0, 1); tiles.hline(6 * 16, 7, 16, "#1f1b2e"); tiles.vline(6 * 16 + 7, 0, 16, "#1f1b2e")
floor_tile(tiles, 7 * 16, 0, 2)
for (dx, dy) in [(7, 4), (6, 6), (8, 6), (7, 8), (5, 9), (9, 9), (7, 11)]: tiles.px(7 * 16 + dx, dy, "#2f3a14")   # faint rune
def wall_face(c, x, y, edge, upper, crystal=None):
    c.rect(x, y, 16, 16, "#2a2140")
    for ry in range(0, 16, 5):
        c.hline(x, y + ry, 16, "#1a1428")
        for bx in range((ry // 5 % 2) * 6, 16, 12): c.vline(x + bx, y + ry, 5, "#1a1428")
    if upper: c.hline(x, y, 16, "#3d3160"); c.hline(x, y + 1, 16, "#33284f")
    else: c.hline(x, y + 15, 16, "#110d1a")
    if edge == "l": c.vline(x, y, 16, "#3d3160")
    if edge == "r": c.vline(x + 15, y, 16, "#120e1c")
    if crystal:
        for (dx, dy, h) in [(5, 7, 7), (8, 4, 10), (11, 8, 6)]: c.rect(x + dx, y + dy, 2, h - 1, crystal); c.px(x + dx, y + dy - 1, WHITE)
        c.light(x - 2, y, 20, 16, crystal, 200)
for i, e in enumerate(["l", "m", "r"]): wall_face(tiles, i * 16, 16, e, False); wall_face(tiles, (3 + i) * 16, 16, e, True)
wall_face(tiles, 6 * 16, 16, "m", False, CYAN); wall_face(tiles, 7 * 16, 16, "m", False, LIME)
save(tiles.final(2.2, .5), "dng", "tiles.png")

props = Canvas(16 * 8, 16 * 2)
def P(i): return (i % 8) * 16, (i // 8) * 16
for i in (0, 1):   # brazier, two flame frames
    x, y = P(i); props.rect(x + 4, y + 10, 8, 4, "#3a3036"); props.rect(x + 5, y + 14, 6, 2, "#2a2228"); props.hline(x + 4, y + 10, 8, "#5a4a52")
    fl = [(6, 5, 4, 5), (7, 3, 2, 3)] if i == 0 else [(6, 6, 4, 4), (6, 3, 2, 4)]
    for (dx, dy, w, h) in fl: props.rect(x + dx, y + dy, w, h, LIME)
    props.px(x + 7, y + 4 + i, WHITE); props.light(x, y, 16, 14, LIME, 220)
x, y = P(2)
for (dx, dy, h, col) in [(4, 6, 8, CYAN), (7, 2, 12, CYAN), (10, 7, 7, "#7fe7ff")]: props.rect(x + dx, y + dy, 3, h, col); props.px(x + dx + 1, y + dy, WHITE)
props.rect(x + 3, y + 13, 11, 2, "#2a2440"); props.light(x, y, 16, 16, CYAN, 200)
x, y = P(3); props.rect(x + 3, y + 11, 10, 2, "#d9d2c0"); props.rect(x + 2, y + 10, 3, 4, "#e8e2d0"); props.rect(x + 11, y + 10, 3, 4, "#e8e2d0"); props.rect(x + 6, y + 6, 5, 4, "#e8e2d0"); props.px(x + 7, y + 7, INK); props.px(x + 9, y + 7, INK)
x, y = P(4); props.rect(x + 3, y + 3, 10, 12, "#5e3b2a"); props.hline(x + 3, y + 5, 10, "#8a929c"); props.hline(x + 3, y + 12, 10, "#8a929c"); props.vline(x + 3, y + 3, 12, "#7a4e37")
x, y = P(5); props.rect(x + 2, y + 5, 12, 10, "#6b4c33"); props.rect(x + 2, y + 5, 12, 1, "#8a6644"); props.d.line([x + 2, y + 5, x + 13, y + 14], fill=rgb("#4a3424")); props.d.line([x + 13, y + 5, x + 2, y + 14], fill=rgb("#4a3424"))
x, y = P(6); props.ellipse(x + 4, y + 6, 8, 9, "#3b6b8a"); props.rect(x + 6, y + 3, 4, 4, "#3b6b8a"); props.hline(x + 5, y + 3, 6, "#5a8aaa"); props.px(x + 6, y + 8, "#8fc4e0")
x, y = P(7); props.rect(x + 4, y + 9, 8, 6, "#e8e2d0"); props.px(x + 5, y + 11, INK); props.px(x + 9, y + 11, INK); props.rect(x + 7, y + 5, 2, 4, "#f2e6c0"); props.px(x + 7, y + 3, LIME); props.light(x + 3, y, 10, 9, LIME, 220)
x, y = P(8)   # stairs down
props.rect(x, y, 16, 16, "#05040a")
for i in range(4): props.rect(x + 1 + i, y + 1 + i * 4, 14 - i * 2, 3, shade("#4a4266", 1 - i * .2))
x, y = P(9)   # exit stairs up (lit)
props.rect(x, y, 16, 16, "#2a2440")
for i in range(4): props.rect(x + 4 - i, y + 1 + i * 4, 8 + i * 2, 3, shade("#7a72a0", .7 + i * .1)); props.hline(x + 4 - i, y + 1 + i * 4, 8 + i * 2, "#a59fd0")
props.rect(x + 7, y, 2, 2, LIME); props.light(x, y - 2, 16, 8, LIME, 160)
for i, opened in ((10, False), (11, True)):   # chest closed / open
    x, y = P(i); cy = y + 3
    props.rect(x, cy + 4, 16, 9, "#4a2f22")
    if opened:
        props.rect(x, cy - 1, 16, 4, "#5e3b2a"); props.rect(x + 1, cy + 3, 14, 3, "#140d08"); props.rect(x + 3, cy + 3, 10, 2, GOLD); props.light(x, y - 2, 16, 10, GOLD, 200)
    else:
        props.rect(x, cy, 16, 5, "#5e3b2a"); props.hline(x + 1, cy, 14, "#7a4e37"); props.hline(x, cy + 4, 16, "#2e1d15")
        props.rect(x + 6, cy + 3, 4, 4, LIME); props.px(x + 7, cy + 4, INK); props.px(x + 8, cy + 4, INK); props.light(x, y, 16, 16, LIME, 120)
    props.vline(x + 3, cy + (0 if not opened else 4), 13 - (0 if not opened else 4), LIME); props.vline(x + 12, cy + (0 if not opened else 4), 13 - (0 if not opened else 4), LIME)
save(sprite(props, 1.4, .5), "dng", "props.png")

# =============================================================== monsters (4 frames each)
def sheet(name, fw, fh, draw, glow=.6):
    frames = []
    for f in range(4):
        c = Canvas(fw, fh); draw(c, f); c.outline(); frames.append(sprite(c, 1.2, glow))
    im = Image.new("RGBA", (fw * 4, fh))
    for i, fr in enumerate(frames): im.alpha_composite(fr, (i * fw, 0))
    save(im, "mons", name + ".png"); MONS[name] = {"w": fw, "h": fh}
MONS = {}
def eyes(c, x, y, gap, col=WHITE, pupil=INK, size=2):
    for ex in (x, x + gap): c.rect(ex, y, size, size, col); c.px(ex + size - 1, y + size - 1, pupil)

def rug_slime(c, f, s=1):
    sq = [0, 1, 0, -1][f]; m, d = "#c23fa0", "#8a2272"; w, h = 18 * s, 13 * s; y0 = c.h - h - 1 + sq
    c.ellipse(1, y0 - sq, w - 2, h + sq, m); c.rect(2, c.h - 4, w - 4, 3, d)
    for i in range(1, w - 2, 4): c.px(i, y0 + h // 2 + 1, ORANGE); c.px(i + 1, y0 + h // 2 + 2, GOLD); c.px(i + 2, y0 + h // 2 + 1, ORANGE)
    eyes(c, 4 * s, y0 + 3 * s, 7 * s, size=2 * s); c.px(3 * s, y0 + 1, "#ff9ad8")
sheet("RugSlime", 20, 16, rug_slime)
def fud_bat(c, f):
    b, y = "#4a4458", [3, 1, 3, 5][f]
    c.rect(9, 5, 6, 6, b); c.px(10, 4, b); c.px(13, 4, b)
    wing = [(0, 2), (-3, 3), (0, 2), (3, 1)][f]
    for i in range(8):
        dy = (i * wing[0]) // 6
        c.vline(8 - i, 5 + dy + i // 3, 3, b); c.vline(15 + i, 5 + dy + i // 3, 3, b)
    c.px(11, 7, RED); c.px(13, 7, RED); c.light(10, 6, 5, 3, RED, 255)
sheet("FudBat", 24, 16, fud_bat)
def jeet(c, f):   # little goblin waving a SELL sign
    g, d = "#5aa04a", "#3a7030"; bob = f % 2
    c.rect(6, 16, 2, 4 - (f == 1), "#2a2e36"); c.rect(10, 16, 2, 4 - (f == 3), "#2a2e36")
    c.rect(5, 10 + bob, 8, 7, "#6a3a7a"); c.rect(4, 3 + bob, 10, 8, g); c.px(3, 5 + bob, g); c.px(14, 5 + bob, g); c.px(2, 4 + bob, g); c.px(15, 4 + bob, g)
    c.rect(6, 6 + bob, 2, 2, GOLD); c.rect(10, 6 + bob, 2, 2, GOLD); c.px(7, 7 + bob, INK); c.px(11, 7 + bob, INK); c.hline(7, 9 + bob, 4, d)
    sy = 1 + (f % 2); c.vline(16, sy + 4, 10, "#6b4c33"); c.rect(13, sy, 9, 7, RED); c.vline(17, sy + 1, 5, WHITE); c.px(16, sy + 4, WHITE); c.px(18, sy + 4, WHITE)
sheet("Jeet", 22, 20, jeet)
def paper_hands(c, f):   # crumpled paper ghost with shaky little hands
    y = [1, 0, 1, 2][f]; p = "#e8e6dc"
    c.rect(4, 3 + y, 10, 12, p); c.rect(5, 2 + y, 8, 1, p)
    for i in range(0, 10, 3): c.rect(4 + i, 15 + y, 2, 2 + (i + f) % 2, p)
    c.hline(5, 6 + y, 8, "#c9c6b8"); c.hline(5, 10 + y, 6, "#c9c6b8")
    c.rect(6, 7 + y, 2, 2, "#3b6bd8"); c.rect(10, 7 + y, 2, 2, "#3b6bd8"); c.hline(7, 12 + y, 4, "#8a8678")
    hx = [0, 1, 0, -1][f]; c.rect(1 + hx, 9 + y, 3, 3, p); c.rect(14 - hx, 8 + y, 3, 3, p)
sheet("PaperHands", 18, 20, paper_hands)
def bear_bot(c, f, s=1):
    r, d = "#b8333f", "#7c1f2a"; bob = f % 2
    c.rect(4, 18, 3, 2 - (f == 1), "#2a2e36"); c.rect(11, 18, 3, 2 - (f == 3), "#2a2e36")
    c.ellipse(1, 0 + bob, 5, 5, r); c.ellipse(12, 0 + bob, 5, 5, r); c.rect(2, 2 + bob, 14, 9, r); c.rect(3, 5 + bob, 12, 3, "#15171a"); c.rect(5, 6 + bob, 8, 1, RED); c.light(4, 4 + bob, 10, 4, RED, 255)
    c.rect(3, 11 + bob, 12, 7, d); c.rect(1, 12 + bob + (f == 1), 2, 5, r); c.rect(15, 12 + bob + (f == 3), 2, 5, r)
    for i in range(5): c.px(6 + i, 13 + bob + i // 2 + (i % 2), "#ff6b6b")
sheet("BearBot", 18, 20, bear_bot)
def gas_ghost(c, f):   # a gas-fee cloud, burning
    o, y = "#ff8a3c", [0, 1, 2, 1][f]
    for (x0, y0, r) in [(2, 6, 9), (7, 3, 10), (11, 7, 9), (5, 9, 10)]: c.ellipse(x0, y0 + y, r, r - 1, o)
    for (x0, y0, r) in [(5, 6, 6), (9, 5, 6)]: c.ellipse(x0, y0 + y, r, r - 2, GOLD)
    c.rect(7, 10 + y, 2, 2, INK); c.rect(12, 10 + y, 2, 2, INK); c.hline(8, 14 + y, 5, "#7a2a10")
    for i in range(3): c.px(4 + i * 6 + f % 2, 2 + y - i % 2, RED)
    c.light(2, 3 + y, 18, 14, ORANGE, 200)
sheet("GasGhost", 22, 20, gas_ghost)
def rugpuller(c, f):   # hooded thief with a rolled rug
    cl, d = "#3a2a5a", "#2a1e44"; bob = f % 2
    c.rect(5, 19, 2, 2, "#1b1e24"); c.rect(10, 19, 2, 2, "#1b1e24")
    c.rect(4, 8 + bob, 10, 11, cl); c.rect(3, 12 + bob, 12, 7, d); c.ellipse(4, 1 + bob, 10, 10, cl); c.rect(6, 5 + bob, 6, 4, "#0a0812")
    c.px(7, 6 + bob, PINK); c.px(10, 6 + bob, PINK); c.light(6, 5 + bob, 6, 3, PINK, 255)
    c.rect(12, 9 + bob, 7, 4, ORANGE); c.hline(12, 10 + bob, 7, GOLD); c.vline(18, 9 + bob, 4, "#b05a20")
sheet("Rugpuller", 20, 22, rugpuller)
def dumpster(c, f):   # trash-can golem with a red chart sticking out
    m, d = "#4a6a5a", "#344c40"; lid = [0, -2, 0, -1][f]
    c.rect(3, 7, 16, 13, m); c.rect(3, 7, 16, 1, shade(m, 1.2))
    for x in range(5, 18, 4): c.vline(x, 9, 10, d)
    c.rect(2, 4 + lid, 18, 3, "#5a7a6a"); c.rect(9, 3 + lid, 4, 1, "#5a7a6a")
    c.rect(6, 11, 3, 2, RED); c.rect(13, 11, 3, 2, RED); c.light(5, 10, 12, 4, RED, 255)
    for i in range(4): c.px(13 + i, 2 + lid + i, "#ff6b6b")
    c.rect(4, 20, 3, 2, "#1b1e24"); c.rect(15, 20, 3, 2, "#1b1e24")
sheet("Dumpster", 22, 22, dumpster)
# bosses
def the_rugger(c, f):
    sq = [0, 2, 0, -1][f]; m, d = "#c23fa0", "#8a2272"; y0 = 8 + sq
    c.ellipse(2, y0, 52, 38 - sq, m); c.rect(4, 40, 48, 6, d)
    for i in range(3, 52, 6): c.rect(i, y0 + 20, 3, 2, ORANGE); c.rect(i + 3, y0 + 22, 3, 2, GOLD)
    c.rect(14, y0 + 8, 8, 8, WHITE); c.rect(34, y0 + 8, 8, 8, WHITE); c.rect(17, y0 + 11, 4, 4, INK); c.rect(37, y0 + 11, 4, 4, INK)
    c.hline(20, y0 + 28, 16, "#5a1048")
    c.rect(18, y0 - 6, 20, 5, GOLD); c.px(18, y0 - 8, GOLD); c.px(27, y0 - 9, GOLD); c.px(37, y0 - 8, GOLD); c.px(23, y0 - 4, RED); c.px(32, y0 - 4, CYAN)
    c.light(16, y0 - 12, 24, 10, GOLD, 200)
sheet("TheRugger", 56, 48, the_rugger)
def bear_king(c, f):
    r, d = "#a82a36", "#6c1a24"; bob = f % 2
    c.rect(10, 44, 8, 4, "#2a2e36"); c.rect(30, 44, 8, 4, "#2a2e36")
    c.ellipse(2, 6 + bob, 12, 12, r); c.ellipse(34, 6 + bob, 12, 12, r); c.rect(5, 10 + bob, 38, 20, r)
    c.rect(8, 16 + bob, 32, 7, "#15171a"); c.rect(12, 18 + bob, 24, 3, RED); c.light(10, 15 + bob, 28, 9, RED, 255)
    c.rect(6, 30 + bob, 36, 15, d); c.rect(0, 30 + bob + (f == 1) * 2, 6, 12, r); c.rect(42, 30 + bob + (f == 3) * 2, 6, 12, r)
    for i in range(3): c.vline(1 + i * 2, 42 + bob, 3, WHITE); c.vline(43 + i * 2, 42 + bob, 3, WHITE)
    for i in range(12): c.px(16 + i * 1, 33 + bob + i // 2, "#ff6b6b")
    c.rect(14, 2 + bob, 20, 6, GOLD); c.px(14, 0 + bob, GOLD); c.px(23, 0 + bob, GOLD); c.px(33, 0 + bob, GOLD); c.light(12, 0, 24, 8, GOLD, 180)
sheet("BearKing", 48, 48, bear_king)
def gas_golem(c, f):
    o, y = "#ff7a2c", [0, 1, 2, 1][f]
    for (x0, y0, r) in [(4, 14, 20), (16, 6, 22), (26, 16, 20), (10, 22, 22), (22, 24, 20)]: c.ellipse(x0, y0 + y, r, r - 2, o)
    for (x0, y0, r) in [(12, 14, 12), (22, 12, 12)]: c.ellipse(x0, y0 + y, r, r - 3, GOLD)
    c.rect(15, 22 + y, 5, 4, INK); c.rect(28, 22 + y, 5, 4, INK); c.px(16, 23 + y, RED); c.px(29, 23 + y, RED); c.rect(18, 32 + y, 12, 2, "#7a2a10")
    for i in range(5): c.rect(6 + i * 9 + f % 2 * 2, 4 + y - (i % 2) * 2, 2, 3, RED)
    c.text("GWEI", 15, 38 + y, "#7a2a10")
    c.light(2, 4 + y, 44, 40, ORANGE, 210)
sheet("GasGolem", 48, 48, gas_golem)
def the_whale(c, f):
    b, d = "#2a4a8a", "#1a3060"; y = [0, 1, 2, 1][f]; tail = [0, -2, 0, 2][f]
    c.ellipse(4, 8 + y, 44, 30, b); c.ellipse(8, 22 + y, 36, 14, "#8ab0e0")
    c.rect(46, 14 + y + tail, 6, 6, b); c.rect(50, 10 + y + tail, 5, 5, b); c.rect(50, 19 + y + tail, 5, 5, b)
    c.rect(10, 14 + y, 16, 5, INK); c.rect(11, 15 + y, 6, 3, "#2a2e36"); c.rect(19, 15 + y, 6, 3, "#2a2e36"); c.px(12, 15 + y, WHITE); c.px(20, 15 + y, WHITE)
    for i in range(10): c.px(12 + i * 2, 30 + y + (i % 2), GOLD)
    c.rect(20, 32 + y, 4, 4, GOLD); c.light(10, 26 + y, 20, 12, GOLD, 150)
    for i, dx in enumerate([-2, 0, 2]): c.rect(26 + dx * 2, 2 + y - i % 2 * 2 - f % 2, 2, 4, "#8fe9ff")
sheet("TheWhale", 56, 44, the_whale)
print("MON_SIZE", json.dumps({k: [v["w"], v["h"]] for k, v in MONS.items()}, separators=(",", ":")))   # paste into dungeon.js when sizes change

# =============================================================== fx + items
fx = Canvas(32 * 4, 32)
for f in range(4):
    a0, a1 = -2.2 + f * .35, -2.2 + f * .35 + 2.0
    for i in range(24):
        a = a0 + (a1 - a0) * i / 23; r = 12 - abs(i - 12) / 4
        x, y = 16 + math.cos(a) * r + f * 32, 16 + math.sin(a) * r
        col = mix(LIME, WHITE, .6) if 8 < i < 16 else LIME
        if f == 3 and i % 2: continue
        fx.px(x, y, col); fx.px(x - math.cos(a), y - math.sin(a), shade(LIME, .7)); fx.light(int(x) - 2, int(y) - 2, 5, 5, LIME, 200)
im = sprite(fx, 1.5, .7); save(im, "fx", "slash.png")
coin = Canvas(8 * 4, 8)
for f, w in enumerate([6, 4, 2, 4]):
    x = f * 8 + 4 - w // 2; coin.rect(x, 1, w, 6, GOLD); coin.rect(x, 1, w, 1, mix(GOLD, WHITE, .5)); coin.rect(x, 6, w, 1, shade(GOLD, .7))
    if w >= 4: coin.px(f * 8 + 3, 3, "#8a6d16"); coin.px(f * 8 + 4, 4, "#8a6d16")
coin.outline(); save(sprite(coin, 0), "items", "coin.png")
pot = Canvas(9, 11); pot.rect(3, 0, 3, 2, "#8a929c"); pot.rect(2, 2, 5, 1, "#c9d2d8"); pot.ellipse(0, 3, 9, 8, "#ff4b6b"); pot.rect(2, 5, 2, 2, "#ffb0c0"); pot.outline(); save(sprite(pot, 0), "items", "potion.png")

kb = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs if f.endswith((".png", ".json"))) / 1024
print(f"town: {len(objects)} objects, doors {[o['door']['id'] for o in objects if 'door' in o]}; monsters {list(MONS)}; images+json {kb:.0f} KB")
