from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "ui" / "ui-home-similar-v17.png"
W, H = 1536, 1024

GREEN = "#12B96A"
GREEN_DARK = "#078A4E"
ORANGE = "#FF7A1A"
BLUE = "#258CFF"
RED = "#FF3B30"
TEXT = "#171A1F"
SUB = "#6D737C"
MUTED = "#A2A8B0"
BG = "#FFFFFF"
CARD = "#FFFFFF"
LINE = "#E9ECEF"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf" if bold else r"C:\Windows\Fonts\simsun.ttc",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


F12 = font(12)
F14 = font(14)
F15 = font(15)
F16 = font(16)
F18 = font(18)
F20 = font(20, True)
F22 = font(22, True)
F24 = font(24, True)
F26 = font(26, True)
F30 = font(30, True)
F34 = font(34, True)
F42 = font(42, True)


def rr(d: ImageDraw.ImageDraw, box, radius, fill, outline=None, width=1):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def txt(d: ImageDraw.ImageDraw, xy, s, fill=TEXT, f=F16, anchor=None):
    d.text(xy, s, font=f, fill=fill, anchor=anchor)


def shadow(canvas: Image.Image, box, radius=28, blur=18, offset=(0, 8), alpha=45):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x1, y1, x2, y2 = box
    ox, oy = offset
    d.rounded_rectangle((x1 + ox, y1 + oy, x2 + ox, y2 + oy), radius=radius, fill=(0, 0, 0, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(layer)


def gradient_rect(size, c1, c2, horizontal=True):
    im = Image.new("RGBA", size, c1)
    d = ImageDraw.Draw(im)
    w, h = size
    a = tuple(int(c1[i:i + 2], 16) for i in (1, 3, 5))
    b = tuple(int(c2[i:i + 2], 16) for i in (1, 3, 5))
    steps = w if horizontal else h
    for i in range(steps):
        t = i / max(1, steps - 1)
        col = tuple(int(a[j] * (1 - t) + b[j] * t) for j in range(3)) + (255,)
        if horizontal:
            d.line((i, 0, i, h), fill=col)
        else:
            d.line((0, i, w, i), fill=col)
    return im


def draw_phone_frame(canvas: Image.Image):
    d = ImageDraw.Draw(canvas)
    px, py, pw, ph = 387, 8, 762, 1004
    shadow(canvas, (px, py, px + pw, py + ph), radius=96, blur=28, offset=(0, 18), alpha=90)
    rr(d, (px, py, px + pw, py + ph), 94, "#0D0D0F")
    rr(d, (px + 8, py + 8, px + pw - 8, py + ph - 8), 86, "#2A2A2A")
    rr(d, (px + 22, py + 22, px + pw - 22, py + ph - 22), 72, "#FFFFFF")
    rr(d, (654, 30, 882, 78), 24, "#050505")
    rr(d, (803, 45, 822, 64), 9, "#101A28")
    d.ellipse((811, 52, 815, 56), fill="#1967D2")
    rr(d, (379, 184, 389, 224), 4, "#1C1C1E")
    rr(d, (379, 260, 389, 325), 4, "#1C1C1E")
    rr(d, (1148, 274, 1158, 392), 4, "#1C1C1E")
    return (411, 31, 713, 950)


def draw_status(d, x, y, w):
    txt(d, (x + 42, y + 20), "9:41", "#111111", F22)
    for i, h in enumerate([8, 12, 16, 21]):
        d.rounded_rectangle((x + w - 164 + i * 10, y + 30 - h, x + w - 158 + i * 10, y + 30), radius=2, fill="#111111")
    d.arc((x + w - 118, y + 12, x + w - 83, y + 38), 210, 330, fill="#111111", width=3)
    d.arc((x + w - 111, y + 18, x + w - 90, y + 38), 215, 325, fill="#111111", width=3)
    d.ellipse((x + w - 103, y + 32, x + w - 96, y + 39), fill="#111111")
    d.rounded_rectangle((x + w - 70, y + 16, x + w - 34, y + 31), radius=3, outline="#111111", width=2)
    d.rectangle((x + w - 67, y + 19, x + w - 38, y + 28), fill="#111111")
    d.rounded_rectangle((x + w - 31, y + 20, x + w - 27, y + 27), radius=2, fill="#111111")


def fruit_badge(d, cx, cy, label, color):
    d.ellipse((cx - 31, cy - 31, cx + 31, cy + 31), fill="#F2F3F5")
    d.ellipse((cx - 20, cy - 20, cx + 20, cy + 20), fill=color)
    txt(d, (cx, cy), label, "#FFFFFF", F20, "mm")


def draw_banner(canvas, d, x, y):
    rr(d, (x - 88, y, x - 12, y + 160), 12, "#DBF6D9")
    fruit_badge(d, x - 50, y + 76, "菜", "#51B85A")
    rr(d, (x + 8, y, x + 500, y + 160), 12, "#0A742F")
    grad = gradient_rect((492, 160), "#177D34", "#0D5E25")
    mask = Image.new("L", (492, 160), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 492, 160), radius=12, fill=255)
    canvas.paste(grad, (x + 8, y), mask)
    txt(d, (x + 32, y + 52), "时令鲜果季", "#FFFFFF", F42)
    txt(d, (x + 34, y + 88), "新鲜美味 低至5折", "#F3FFF5", F20)
    rr(d, (x + 34, y + 116, x + 136, y + 144), 15, "#FFF05A")
    txt(d, (x + 85, y + 130), "立即抢购 >", "#256015", F14, "mm")
    d.ellipse((x + 338, y + 38, x + 444, y + 144), fill="#F0A22B")
    d.ellipse((x + 404, y + 48, x + 488, y + 132), fill="#E13B2F")
    d.ellipse((x + 292, y + 94, x + 352, y + 154), fill="#F54942")
    d.rounded_rectangle((x + 354, y + 56, x + 464, y + 136), radius=8, fill="#C98938")
    d.ellipse((x + 374, y + 32, x + 434, y + 92), fill="#FFD33D")
    rr(d, (x + 518, y, x + 606, y + 160), 12, "#FFE2DD")
    txt(d, (x + 540, y + 50), "乳品钜惠", RED, F20)
    txt(d, (x + 540, y + 82), "营养美味", RED, F14)
    rr(d, (x + 548, y + 102, x + 606, y + 126), 12, RED)
    txt(d, (x + 577, y + 114), "立即抢", "#FFFFFF", F12, "mm")
    for i, col in enumerate([GREEN, "#D4D9DE", "#D4D9DE", "#D4D9DE"]):
        d.ellipse((x + 214 + i * 24, y + 174, x + 224 + i * 24, y + 184), fill=col)


def promo_card(canvas, d, box, c1, c2, title, sub, icon, icon_col="#FFFFFF"):
    x1, y1, x2, y2 = box
    grad = gradient_rect((x2 - x1, y2 - y1), c1, c2)
    mask = Image.new("L", (x2 - x1, y2 - y1), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, x2 - x1, y2 - y1), radius=12, fill=255)
    canvas.paste(grad, (x1, y1), mask)
    txt(d, (x1 + 16, y1 + 31), title, "#FFFFFF", F20)
    txt(d, (x1 + 16, y1 + 63), sub, "#FFFFFF", F15)
    d.ellipse((x2 - 78, y1 + 36, x2 - 24, y1 + 90), fill=(255, 255, 255, 145))
    txt(d, (x2 - 51, y1 + 63), icon, icon_col, F30, "mm")


def category(d, x, y, label, symbol, color):
    d.ellipse((x, y, x + 62, y + 62), fill="#F1F3F5")
    d.ellipse((x + 12, y + 10, x + 50, y + 48), fill=color)
    txt(d, (x + 31, y + 30), symbol, "#FFFFFF", F18, "mm")
    txt(d, (x + 31, y + 84), label, TEXT, F18, "mm")


def product(canvas, d, box, title, price, old_price, points, tag, color, fruit):
    x1, y1, x2, y2 = box
    shadow(canvas, box, radius=14, blur=12, offset=(0, 5), alpha=20)
    rr(d, box, 14, CARD, "#E8E8E8", 1)
    rr(d, (x1 + 12, y1 + 10, x2 - 12, y1 + 154), 10, "#F2F4F2")
    d.ellipse((x1 + 76, y1 + 34, x1 + 220, y1 + 146), fill=color)
    d.ellipse((x1 + 170, y1 + 48, x1 + 268, y1 + 128), fill=color)
    d.ellipse((x1 + 126, y1 + 64, x1 + 202, y1 + 140), fill="#FFF4DD")
    txt(d, (x1 + 164, y1 + 102), fruit, "#FFFFFF", F34, "mm")
    rr(d, (x1 + 12, y1 + 12, x1 + 82, y1 + 38), 4, GREEN)
    txt(d, (x1 + 47, y1 + 25), tag, "#FFFFFF", F14, "mm")
    rr(d, (x2 - 64, y1 + 120, x2 - 10, y1 + 154), 6, "#F4FFF8", GREEN, 1)
    txt(d, (x2 - 37, y1 + 134), f"+{points}", GREEN, F18, "mm")
    txt(d, (x2 - 37, y1 + 151), "积分", GREEN, F12, "mm")
    txt(d, (x1 + 14, y1 + 158), title, TEXT, F20)
    rr(d, (x1 + 14, y1 + 186, x1 + 70, y1 + 208), 4, "#FFF4EF", RED, 1)
    txt(d, (x1 + 42, y1 + 197), "会员价", RED, F12, "mm")
    txt(d, (x1 + 14, y1 + 205), f"¥{price}", RED, F30)
    txt(d, (x1 + 108, y1 + 206), f"¥{old_price}", MUTED, F16)
    d.line((x1 + 106, y1 + 217, x1 + 164, y1 + 217), fill=MUTED, width=2)
    d.ellipse((x2 - 60, y1 + 190, x2 - 22, y1 + 228), fill=GREEN)
    txt(d, (x2 - 41, y1 + 209), "+", "#FFFFFF", F30, "mm")


def main():
    canvas = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(canvas)
    screen = draw_phone_frame(canvas)
    sx, sy, sw, sh = screen
    draw_status(d, sx, sy, sw)
    content_x, content_y = sx + 26, sy + 50
    d.ellipse((content_x + 2, content_y + 2, content_x + 24, content_y + 24), fill=GREEN)
    txt(d, (content_x + 13, content_y + 14), "●", "#FFFFFF", F12, "mm")
    txt(d, (content_x + 38, content_y + 15), "师大自提站⌄", TEXT, F22, "lm")
    txt(d, (sx + sw - 56, content_y + 14), "☏", "#111111", F24, "mm")
    d.ellipse((sx + sw - 35, content_y + 2, sx + sw - 24, content_y + 13), fill=GREEN)

    rr(d, (content_x - 12, content_y + 44, sx + sw - 25, content_y + 90), 24, "#FFFFFF", GREEN, 2)
    d.ellipse((content_x + 12, content_y + 60, content_x + 31, content_y + 79), outline=MUTED, width=2)
    d.line((content_x + 28, content_y + 76, content_x + 40, content_y + 87), fill=MUTED, width=2)
    txt(d, (content_x + 56, content_y + 68), "搜索商品", MUTED, F18, "lm")

    draw_banner(canvas, d, content_x - 36, content_y + 108)

    y = content_y + 300
    promo_card(canvas, d, (content_x - 6, y, content_x + 196, y + 98), "#FF8A24", "#FFB23A", "签到拿积分", "每日签到领积分", "★")
    promo_card(canvas, d, (content_x + 216, y, content_x + 418, y + 98), "#248BFF", "#58B8FF", "做任务拿积分", "完成任务赚积分", "✓")
    promo_card(canvas, d, (content_x + 438, y, content_x + 640, y + 98), "#23B76C", "#38CF88", "邀请好友拿积分", "邀请好友得积分", "人")

    y += 122
    cats = [
        ("水果", "果", "#D33A2C"),
        ("蔬菜", "菜", "#52B04E"),
        ("肉禽", "肉", "#E8685D"),
        ("乳品", "乳", "#59A9EF"),
        ("零食", "零", "#DFAE2B"),
        ("日用", "日", "#427AEF"),
        ("更多", "＋", GREEN),
    ]
    for i, item in enumerate(cats):
        category(d, content_x - 4 + i * 94, y, *item)

    y += 118
    rr(d, (content_x - 6, y + 6, content_x - 1, y + 28), 2, GREEN)
    txt(d, (content_x + 14, y + 20), "热门推荐", TEXT, F24, "lm")
    txt(d, (sx + sw - 65, y + 20), "更多 ›", SUB, F16, "lm")

    y += 42
    product(canvas, d, (content_x - 6, y, content_x + 306, y + 236), "山东京富士苹果 1.5kg/袋", "12.8", "15.8", 50, "今日特惠", "#E8463C", "苹")
    product(canvas, d, (content_x + 330, y, content_x + 642, y + 236), "阳光玫瑰青提 500g/盒", "8.5", "11.8", 40, "热销", "#96C93D", "萄")

    rr(d, (sx + 24, sy + sh - 70, sx + sw - 24, sy + sh - 10), 0, "#FFFFFF")
    d.line((sx + 24, sy + sh - 70, sx + sw - 24, sy + sh - 70), fill=LINE, width=1)
    tabs = [("首页", "⌂", GREEN), ("赚积分", "☆", SUB), ("商城分类", "▦", SUB), ("购物车", "🛒", SUB), ("我的", "○", SUB)]
    for i, (name, ic, col) in enumerate(tabs):
        cx = sx + 74 + i * 137
        txt(d, (cx, sy + sh - 45), ic, col, F24, "mm")
        txt(d, (cx, sy + sh - 20), name, col, F14, "mm")
    d.ellipse((sx + 488, sy + sh - 66, sx + 516, sy + sh - 38), fill=RED)
    txt(d, (sx + 502, sy + sh - 52), "2", "#FFFFFF", F14, "mm")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT, quality=95)
    print(OUT)


if __name__ == "__main__":
    main()
