# Tiny pixel-art toolkit for Viberquest's own art: palette, 3x5 pixel font, shapes, neon glow.
from PIL import Image, ImageDraw, ImageFilter, ImageChops

INK = "#0b0c0e"
LIME, IRIS, CYAN, PINK, ORANGE, RED, GOLD, WHITE = "#dff902", "#8b84ff", "#3ee6d0", "#ff7ad9", "#ff8a3c", "#ff4b5c", "#ffd23f", "#f2f4f3"
SKINS = ["#dff902", "#8b84ff", "#ff6b57", "#3ee6d0", "#ff7ad9", "#ffb13b", "#b7bdc0", "#7cf29a"]

def rgb(h, a=255):
    h = h.lstrip("#"); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)
def shade(h, f):
    r, g, b, _ = rgb(h); c = lambda v: max(0, min(255, round(v * f))); return "#%02x%02x%02x" % (c(r), c(g), c(b))
def mix(a, b, t):
    x, y = rgb(a), rgb(b); return "#%02x%02x%02x" % tuple(round(x[i] + (y[i] - x[i]) * t) for i in range(3))

FONT = {
 "A": [".#.", "#.#", "###", "#.#", "#.#"], "B": ["##.", "#.#", "##.", "#.#", "##."], "C": [".##", "#..", "#..", "#..", ".##"],
 "D": ["##.", "#.#", "#.#", "#.#", "##."], "E": ["###", "#..", "##.", "#..", "###"], "F": ["###", "#..", "##.", "#..", "#.."],
 "G": [".##", "#..", "#.#", "#.#", ".##"], "H": ["#.#", "#.#", "###", "#.#", "#.#"], "I": ["###", ".#.", ".#.", ".#.", "###"],
 "J": ["..#", "..#", "..#", "#.#", ".#."], "K": ["#.#", "#.#", "##.", "#.#", "#.#"], "L": ["#..", "#..", "#..", "#..", "###"],
 "M": ["#...#", "##.##", "#.#.#", "#...#", "#...#"], "N": ["#..#", "##.#", "#.##", "#..#", "#..#"], "O": [".#.", "#.#", "#.#", "#.#", ".#."],
 "P": ["##.", "#.#", "##.", "#..", "#.."], "Q": [".#.", "#.#", "#.#", "##.", ".##"], "R": ["##.", "#.#", "##.", "#.#", "#.#"],
 "S": [".##", "#..", ".#.", "..#", "##."], "T": ["###", ".#.", ".#.", ".#.", ".#."], "U": ["#.#", "#.#", "#.#", "#.#", "###"],
 "V": ["#.#", "#.#", "#.#", "#.#", ".#."], "W": ["#...#", "#...#", "#.#.#", "##.##", "#...#"], "X": ["#.#", "#.#", ".#.", "#.#", "#.#"],
 "Y": ["#.#", "#.#", ".#.", ".#.", ".#."], "Z": ["###", "..#", ".#.", "#..", "###"], " ": ["..", "..", "..", "..", ".."],
 "0": ["###", "#.#", "#.#", "#.#", "###"], "1": [".#.", "##.", ".#.", ".#.", "###"], "2": ["##.", "..#", ".#.", "#..", "###"],
 "3": ["##.", "..#", ".#.", "..#", "##."], "4": ["#.#", "#.#", "###", "..#", "..#"], "5": ["###", "#..", "##.", "..#", "##."],
 "6": [".##", "#..", "###", "#.#", "###"], "7": ["###", "..#", ".#.", ".#.", ".#."], "8": ["###", "#.#", "###", "#.#", "###"],
 "9": ["###", "#.#", "###", "..#", "##."], "$": [".##", "##.", ".#.", ".##", "##."], "!": ["#", "#", "#", ".", "#"],
 "@": [".##.", "#..#", "#.##", "#...", ".##."], ".": [".", ".", ".", ".", "#"], "-": ["...", "...", "###", "...", "..."], "+": ["...", ".#.", "###", ".#.", "..."], "?": ["##.", "..#", ".#.", "...", ".#."],
}
def text_w(s): return sum(len(FONT.get(c, FONT[" "])[0]) + 1 for c in s.upper()) - 1

class Canvas:
    def __init__(self, w, h, bg=None):
        self.im = Image.new("RGBA", (w, h), rgb(bg) if bg else (0, 0, 0, 0)); self.d = ImageDraw.Draw(self.im); self.w, self.h = w, h
        self.glow = Image.new("RGBA", (w, h), (0, 0, 0, 0)); self.gd = ImageDraw.Draw(self.glow)
    def px(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h and c: self.im.putpixel((int(x), int(y)), rgb(c) if isinstance(c, str) else c)
    def rect(self, x, y, w, h, c):
        if w > 0 and h > 0 and c: self.d.rectangle([x, y, x + w - 1, y + h - 1], fill=rgb(c) if isinstance(c, str) else c)
    def hline(self, x, y, w, c): self.rect(x, y, w, 1, c)
    def vline(self, x, y, h, c): self.rect(x, y, 1, h, c)
    def ellipse(self, x, y, w, h, c): self.d.ellipse([x, y, x + w - 1, y + h - 1], fill=rgb(c) if isinstance(c, str) else c)
    def light(self, x, y, w, h, c, a=255, ellipse=True):   # paints into the glow layer (blurred + added at the end)
        f = self.gd.ellipse if ellipse else self.gd.rectangle; f([x, y, x + w - 1, y + h - 1], fill=rgb(c, a))
    def text(self, s, x, y, c, glow=None):
        cx = x
        for ch in s.upper():
            g = FONT.get(ch, FONT[" "])
            for j, row in enumerate(g):
                for i, v in enumerate(row):
                    if v == "#":
                        self.px(cx + i, y + j, c)
                        if glow: self.gd.point((cx + i, y + j), fill=rgb(glow))
            cx += len(g[0]) + 1
        return cx - x - 1
    def paste(self, other, x, y):
        self.im.alpha_composite(other.im, (int(x), int(y)))
        self.glow.alpha_composite(other.glow, (int(x), int(y)))
    def outline(self, c=INK):   # 1px outline around every opaque pixel
        a = self.im.split()[3]; grown = a.filter(ImageFilter.MaxFilter(3))
        edge = ImageChops.subtract(grown, a); ink = Image.new("RGBA", self.im.size, rgb(c)); ink.putalpha(edge)
        out = ink.copy(); out.alpha_composite(self.im); self.im = out; self.d = ImageDraw.Draw(self.im)
    def final(self, blur=2.2, strength=1.0):
        g = self.glow.filter(ImageFilter.GaussianBlur(blur))
        if strength != 1: g = Image.eval(g, lambda v: min(255, int(v * strength)))
        base = self.im.convert("RGB"); add = Image.new("RGB", base.size); add.paste(g.convert("RGB"), mask=g.split()[3])
        out = ImageChops.add(base, add).convert("RGBA"); out.putalpha(self.im.split()[3]); return out

def sprite(c, blur=3.0, strength=.6):
    """transparent sprite with its neon glow baked in: a soft halo behind, light added on top"""
    g = c.glow.filter(ImageFilter.GaussianBlur(blur)) if blur else c.glow
    g = Image.eval(g, lambda v: min(255, int(v * strength)))
    halo = g.copy(); out = Image.new("RGBA", c.im.size); out.alpha_composite(halo); out.alpha_composite(c.im)
    a = out.split()[3]; base = out.convert("RGB"); add = Image.new("RGB", base.size); add.paste(g.convert("RGB"), mask=g.split()[3])
    res = ImageChops.add(base, add).convert("RGBA"); res.putalpha(a); return res

def scale(im, k): return im.resize((im.width * k, im.height * k), Image.NEAREST)
