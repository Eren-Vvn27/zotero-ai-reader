"""Generate the plugin PNG icons (48/96) for AI 论文助手."""
from PIL import Image, ImageDraw
import math, os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "chrome", "content", "icons")
S = 4  # supersampling factor


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def sparkle(draw, cx, cy, R, r, color, rot=0.0):
    pts = []
    for i in range(8):
        ang = rot + i * math.pi / 4
        rad = R if i % 2 == 0 else r
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    draw.polygon(pts, fill=color)


def make(size):
    W = size * S
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    grad = Image.new("RGBA", (W, W))
    gd = ImageDraw.Draw(grad)
    top = (91, 124, 250)
    bottom = (138, 92, 246)
    for y in range(W):
        gd.line([(0, y), (W, y)], fill=lerp(top, bottom, y / max(1, W - 1)) + (255,))

    mask = Image.new("L", (W, W), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.23), fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    # main sparkle
    sparkle(d, W * 0.44, W * 0.42, W * 0.30, W * 0.085, (255, 255, 255, 255))
    # small sparkle, lower right
    sparkle(d, W * 0.72, W * 0.71, W * 0.135, W * 0.038, (255, 255, 255, 235), rot=math.pi / 4)
    # soft top highlight
    hi = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    hd.ellipse([-W * 0.25, -W * 0.55, W * 1.25, W * 0.42], fill=(255, 255, 255, 26))
    img = Image.alpha_composite(img, hi)

    return img.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
for size in (48, 96):
    make(size).save(os.path.join(OUT, f"icon-{size}.png"))
    print("wrote", os.path.join(OUT, f"icon-{size}.png"))
