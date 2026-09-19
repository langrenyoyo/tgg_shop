"""Build local navigation icons and resize the existing fresh-fruit photograph.

Run from any directory with Python + Pillow. No remote assets are downloaded.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
ICONS = ASSETS / 'icons'
ICONS.mkdir(parents=True, exist_ok=True)
SCALE = 4


def icon(name, color, filename):
    image = Image.new('RGBA', (72 * SCALE, 72 * SCALE))
    draw = ImageDraw.Draw(image)

    def line(points, width=4):
        points = [(int(x * SCALE), int(y * SCALE)) for x, y in points]
        draw.line(points, fill=color, width=width * SCALE, joint='curve')
        radius = width * SCALE / 2
        for x, y in (points[0], points[-1]):
            draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill=color)

    def box(bounds, radius=5):
        draw.rounded_rectangle(tuple(int(n * SCALE) for n in bounds), radius=radius*SCALE, outline=color, width=4*SCALE)

    def circle(bounds, fill=False):
        draw.ellipse(tuple(int(n*SCALE) for n in bounds), fill=color if fill else None, outline=color, width=4*SCALE)

    if name == 'home':
        line([(10, 32), (36, 12), (62, 32)])
        line([(17, 29), (17, 59), (29, 59), (29, 43), (43, 43), (43, 59), (55, 59), (55, 29)])
    elif name == 'tasks':
        box((15, 15, 57, 61), 7)
        box((27, 10, 45, 22), 4)
        line([(25, 40), (33, 48), (47, 33)])
    elif name == 'shop':
        for x, y in [(13, 13), (41, 13), (13, 41), (41, 41)]:
            box((x, y, x+19, y+19), 5)
    elif name == 'cart':
        line([(8, 15), (16, 15), (24, 47), (55, 47), (62, 24), (19, 24)])
        circle((24, 55, 31, 62), True)
        circle((49, 55, 56, 62), True)
    elif name == 'me':
        circle((25, 11, 47, 33))
        draw.arc((14*SCALE, 40*SCALE, 58*SCALE, 77*SCALE), 180, 360, fill=color, width=4*SCALE)
        line([(15, 58), (57, 58)])
    elif name == 'calendar':
        box((13, 17, 59, 61), 7)
        line([(13, 30), (59, 30)])
        line([(25, 11), (25, 23)])
        line([(47, 11), (47, 23)])
        line([(25, 45), (33, 52), (47, 39)])
    elif name == 'gift':
        box((12, 27, 60, 39), 3)
        line([(17, 40), (17, 61), (55, 61), (55, 40)])
        line([(36, 28), (36, 61)])
        line([(36, 27), (23, 24), (20, 17), (24, 12), (31, 14), (36, 27), (41, 14), (48, 12), (52, 17), (49, 24), (36, 27)])
    elif name == 'member':
        line([(13, 24), (25, 34), (36, 15), (47, 34), (59, 24), (53, 51), (19, 51), (13, 24)])
        line([(23, 59), (49, 59)])
    elif name == 'orders':
        box((17, 11, 55, 61), 5)
        line([(27, 26), (45, 26)])
        line([(27, 37), (45, 37)])
        line([(27, 48), (38, 48)])
    image.resize((72, 72), Image.Resampling.LANCZOS).save(ICONS / filename, optimize=True)


for name in ('home', 'tasks', 'shop', 'cart', 'me'):
    icon(name, '#91a08b', f'{name}.png')
    icon(name, '#009e60', f'{name}-active.png')
for name, color in [('calendar', '#bb8835'), ('gift', '#c58154'), ('member', '#a78b43'), ('orders', '#009e60')]:
    icon(name, color, f'{name}.png')
source = ROOT.parent / 'ui/v17/assets/strawberry.jpg'
with Image.open(source) as image:
    ImageOps.fit(image.convert('RGB'), (480, 480)).save(ASSETS / 'fresh-strawberry.jpg', quality=88, optimize=True)
print('Generated 14 icons and a local hero photograph.')
