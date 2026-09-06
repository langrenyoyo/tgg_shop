from __future__ import annotations

import math
import shutil
from urllib.request import Request, urlopen
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "ui" / "v17" / "UI"
ASSET_DIR = ROOT / "ui" / "v17" / "assets"
OUT.mkdir(parents=True, exist_ok=True)
ASSET_DIR.mkdir(parents=True, exist_ok=True)

PRODUCT_IMAGE_URLS = {
    "apple": "https://commons.wikimedia.org/wiki/Special:FilePath/Red%20Apple.jpg",
    "grapes": "https://commons.wikimedia.org/wiki/Special:FilePath/Table_grapes_on_white.jpg",
    "strawberry": "https://commons.wikimedia.org/wiki/Special:FilePath/Strawberry_on_white_background.jpg",
    "bokchoy": "https://commons.wikimedia.org/wiki/Special:FilePath/Baby_bok_choy.jpg",
    "banana": "https://commons.wikimedia.org/wiki/Special:FilePath/Bananas_white_background.jpg",
}

SCALE = 3
W, H = 390 * SCALE, 844 * SCALE

GREEN = "#00B96B"
GREEN_DARK = "#078A55"
ORANGE = "#FF6B00"
GOLD = "#FFB800"
BLUE = "#1677FF"
RED = "#F5222D"
BG = "#F5F6F8"
CARD = "#FFFFFF"
TEXT = "#1F2329"
SUB = "#6B7280"
MUTED = "#A0A7B2"
BORDER = "#E6E8EB"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf" if bold else r"C:\Windows\Fonts\simsun.ttc",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size * SCALE)
    return ImageFont.load_default()


F10 = font(10)
F11 = font(11)
F12 = font(12)
F13 = font(13)
F14 = font(14)
F15 = font(15)
F16 = font(16, True)
F18 = font(18, True)
F20 = font(20, True)
F22 = font(22, True)
F24 = font(24, True)
F28 = font(28, True)
F30 = font(30, True)
F32 = font(32, True)


def sc(v: int | float) -> int:
    return int(round(v * SCALE))


def ensure_product_assets():
    seed_dir = ROOT / "ui" / "v17" / "assets_test"
    for name, url in PRODUCT_IMAGE_URLS.items():
        target = ASSET_DIR / f"{name}.jpg"
        if target.exists() and target.stat().st_size > 1024:
            continue
        seeded = seed_dir / f"{name}.jpg"
        if seeded.exists() and seeded.stat().st_size > 1024:
            shutil.copyfile(seeded, target)
            continue
        try:
            req = Request(url, headers={"User-Agent": "Mozilla/5.0 TGG Shop UI mockup"})
            with urlopen(req, timeout=35) as response:
                target.write_bytes(response.read())
        except Exception as exc:
            print(f"asset download skipped: {name} ({exc})")


def asset_image(name: str):
    path = ASSET_DIR / f"{name}.jpg"
    if not path.exists():
        return None
    try:
        return Image.open(path).convert("RGB")
    except Exception:
        return None


def paste_cover(base_img: Image.Image, name: str, box, radius=10):
    src = asset_image(name)
    if src is None:
        return False
    box = tuple(sc(v) for v in box)
    w, h = box[2] - box[0], box[3] - box[1]
    fitted = ImageOps.fit(src, (w, h), Image.Resampling.LANCZOS, centering=(0.5, 0.5)).convert("RGBA")
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), radius=sc(radius), fill=255)
    base_img.paste(fitted, (box[0], box[1]), mask)
    return True


def rect(draw, box, fill, radius=0, outline=None, width=1):
    box = tuple(sc(v) for v in box)
    draw.rounded_rectangle(box, radius=sc(radius), fill=fill, outline=outline, width=sc(width))


def line(draw, xy, fill=BORDER, width=1):
    draw.line(tuple(sc(v) for v in xy), fill=fill, width=sc(width))


def text(draw, xy, value, fill=TEXT, fnt=F14, anchor=None):
    draw.text((sc(xy[0]), sc(xy[1])), value, fill=fill, font=fnt, anchor=anchor)


def pill(draw, xy, label, fill="#E8F8F0", fg=GREEN, w=None):
    x, y = xy
    bbox = draw.textbbox((0, 0), label, font=F11)
    tw = (bbox[2] - bbox[0]) / SCALE
    width = w or tw + 18
    rect(draw, (x, y, x + width, y + 24), fill, 12)
    text(draw, (x + width / 2, y + 12), label, fg, F11, "mm")


def icon_circle(draw, x, y, label, fill="#E8F8F0", fg=GREEN, size=46):
    rect(draw, (x, y, x + size, y + size), fill, size / 2)
    text(draw, (x + size / 2, y + size / 2), label, fg, F18, "mm")


def base(title: str, back: bool = False, tab: str | None = None):
    im = Image.new("RGB", (W, H), "#EEF1F4")
    d = ImageDraw.Draw(im)
    rect(d, (0, 0, 390, 844), BG, 0)
    rect(d, (0, 0, 390, 44), CARD, 0)
    text(d, (195, 24), title, TEXT, F16, "mm")
    if back:
        text(d, (18, 24), "‹", SUB, F28, "lm")
    text(d, (34, 15), "9:41", TEXT, F12)
    text(d, (312, 15), "5G  ▮▮", TEXT, F12)
    if tab:
        tabbar(d, tab)
    return im, d


def tabbar(d, active: str):
    labels = [("首页", "⌂"), ("分类", "▦"), ("赚积分", "✦"), ("购物车", "●"), ("我的", "人")]
    rect(d, (0, 788, 390, 844), CARD, 0)
    line(d, (0, 788, 390, 788))
    for i, (name, ic) in enumerate(labels):
        x = 39 + i * 78
        color = GREEN if name == active else SUB
        text(d, (x, 807), ic, color, F16, "mm")
        text(d, (x, 830), name, color, F10, "mm")


def section_title(d, y, title, right=None):
    text(d, (16, y), title, TEXT, F16)
    if right:
        text(d, (374, y + 8), right, SUB, F12, "rm")


def product_card(im, d, x, y, name, price, tag=None, image="apple"):
    rect(d, (x, y, x + 172, y + 208), CARD, 14)
    rect(d, (x + 10, y + 10, x + 162, y + 118), "#E9F8F1", 12)
    if not paste_cover(im, image, (x + 10, y + 10, x + 162, y + 118), 12):
        icon_circle(d, x + 62, y + 38, "果", "#D9F7E8", GREEN, 58)
    text(d, (x + 12, y + 133), name, TEXT, F13)
    text(d, (x + 12, y + 155), "会员价 / 积分兑换", SUB, F11)
    text(d, (x + 12, y + 184), price, GREEN, F16)
    if tag:
        pill(d, (x + 104, y + 181), tag, "#FFF7E6", ORANGE, 52)


def home():
    im, d = base("TGG Shop", tab="首页")
    text(d, (16, 58), "师大站点 · 今日 05:00 前下单今日配送", SUB, F12)
    rect(d, (16, 82, 374, 120), CARD, 20)
    text(d, (34, 101), "搜索水果、日用、积分兑换商品", MUTED, F13, "lm")
    rect(d, (16, 136, 374, 244), "#0CCB80", 18)
    paste_cover(im, "strawberry", (248, 148, 356, 232), 14)
    text(d, (36, 164), "新鲜到站 · 自提/送货上门", "#FFFFFF", F20)
    text(d, (36, 198), "会员可现金购物，普通用户积分兑换", "#EFFFF7", F13)
    rect(d, (260, 166, 346, 222), "#FFFFFF", 18)
    text(d, (303, 194), "会员月卡", GREEN, F14, "mm")
    quicks = [("签到", "签"), ("做任务", "任"), ("拉新", "邀"), ("纯积分", "兑")]
    for i, (name, ic) in enumerate(quicks):
        x = 16 + i * 91
        rect(d, (x, 260, x + 82, 338), CARD, 14)
        icon_circle(d, x + 18, 272, ic, "#E8F8F0", GREEN, 38)
        text(d, (x + 41, 322), name, TEXT, F12, "mm")
    section_title(d, 358, "商品分类", "后台可配置")
    cats = ["水果", "蔬菜", "粮油", "日用", "饮品", "零食", "会员", "积分"]
    for i, name in enumerate(cats):
        x = 18 + (i % 4) * 92
        y = 392 + (i // 4) * 70
        icon_circle(d, x + 20, y, name[0], "#EEF9F3", GREEN, 42)
        text(d, (x + 41, y + 56), name, SUB, F11, "mm")
    section_title(d, 544, "热门推荐", "更多")
    product_card(im, d, 16, 578, "丹东草莓 500g", "¥29.9 / 299积分", "热卖", "strawberry")
    product_card(im, d, 202, 578, "阳光青提 500g", "¥18.8 / 188积分", "会员", "grapes")
    return im


def splash():
    im = Image.new("RGB", (W, H), "#111827")
    d = ImageDraw.Draw(im)
    rect(d, (0, 0, 390, 844), "#111827", 0)
    rect(d, (18, 46, 92, 74), "#303846", 14)
    text(d, (55, 60), "跳过 3s", "#D1D5DB", F11, "mm")
    rect(d, (28, 134, 362, 668), "#0BBF73", 28)
    text(d, (195, 236), "TGG Shop", "#FFFFFF", F32, "mm")
    text(d, (195, 292), "开屏广告位", "#EFFFF7", F20, "mm")
    text(d, (195, 334), "素材、时长、跳过均后台配置", "#D8FFE9", F13, "mm")
    rect(d, (82, 536, 308, 590), "#FFFFFF", 27)
    text(d, (195, 563), "进入商城", GREEN, F16, "mm")
    text(d, (195, 718), "启动初始化并行加载，不阻塞登录态", "#AAB2C0", F12, "mm")
    return im


def earn_tasks():
    im, d = base("赚积分", tab="赚积分")
    rect(d, (0, 44, 390, 88), CARD, 0)
    text(d, (98, 66), "做任务", GREEN, F15, "mm")
    text(d, (292, 66), "签到", SUB, F15, "mm")
    line(d, (68, 87, 128, 87), GREEN, 3)
    rect(d, (16, 104, 374, 142), CARD, 20)
    text(d, (34, 123), "搜索任务名称 / 分类", MUTED, F13, "lm")
    chips = ["全部", "简单注册", "证券金融", "福利任务", "试玩"]
    x = 16
    for i, c in enumerate(chips):
        w = 58 if i == 0 else 78
        pill(d, (x, 154), c, GREEN if i == 0 else CARD, "#FFFFFF" if i == 0 else SUB, w)
        x += w + 8
    rect(d, (16, 194, 374, 274), "#EAF5FF", 16, "#B9DCFF")
    icon_circle(d, 30, 212, "邀", "#FFFFFF", BLUE, 46)
    text(d, (88, 216), "拉新任务 · 邀请好友", TEXT, F16)
    text(d, (88, 242), "列表不前置积分，详情页展示奖励规则", SUB, F12)
    text(d, (342, 235), "去完成 ›", BLUE, F12, "mm")
    tasks = [
        ("小红书高价版", "简单注册", "需按步骤连续签到两天", "去完成"),
        ("立返-工行一拖15", "证券金融", "本人自愿注册，拒绝虚假信息", "去完成"),
        ("方块兽", "福利任务", "截图+手机号提交审核", "去完成"),
    ]
    y = 292
    for title, cat, tip, action in tasks:
        rect(d, (16, y, 374, y + 96), CARD, 14)
        rect(d, (30, y + 18, 84, y + 72), "#F0F6F3", 12)
        text(d, (57, y + 45), "任", GREEN, F18, "mm")
        text(d, (98, y + 18), title, TEXT, F15)
        pill(d, (98, y + 43), cat, "#E8F8F0", GREEN, 72)
        text(d, (98, y + 74), tip, SUB, F11)
        text(d, (338, y + 48), action, GREEN, F12, "mm")
        y += 108
    return im


def task_detail():
    im, d = base("任务详情", back=True)
    rect(d, (16, 60, 374, 156), CARD, 16)
    rect(d, (32, 78, 96, 138), "#E8F8F0", 12)
    text(d, (64, 108), "任", GREEN, F22, "mm")
    text(d, (112, 78), "小红书高价版", TEXT, F18)
    text(d, (112, 108), "简单注册 · 会员可接", SUB, F12)
    text(d, (112, 134), "奖励 ¥17.00 · 会员可得 ¥11.90", ORANGE, F13)
    rect(d, (16, 172, 374, 426), CARD, 16)
    text(d, (32, 192), "任务步骤", TEXT, F16)
    steps = ["扫码填写手机号并下载 App", "登录后完成指定操作", "连续两天签到后截图", "提交手机号前三后四 + 昵称 + 签到图"]
    y = 226
    for i, s in enumerate(steps, 1):
        icon_circle(d, 32, y - 6, str(i), "#E8F8F0", GREEN, 28)
        text(d, (72, y + 8), s, TEXT, F13, "lm")
        y += 48
    rect(d, (16, 442, 374, 548), CARD, 16)
    text(d, (32, 462), "注意事项", TEXT, F16)
    text(d, (32, 494), "必须本人自愿注册，新老用户规则以任务说明为准。", SUB, F12)
    text(d, (32, 522), "任务暂停时不可接单，提交后等待平台审核。", SUB, F12)
    rect(d, (16, 566, 374, 632), "#FFF7E6", 16)
    text(d, (32, 588), "非会员点击去完成时，先引导开通月会员。", ORANGE, F13)
    rect(d, (16, 748, 374, 796), GREEN, 24)
    text(d, (195, 772), "立即接任务", "#FFFFFF", F16, "mm")
    return im


def task_submit():
    im, d = base("提交任务", back=True)
    rect(d, (16, 60, 374, 122), "#E8F8F0", 16)
    text(d, (32, 82), "动态交单表单", GREEN_DARK, F16)
    text(d, (32, 106), "根据 option 自动展示姓名、手机号、备注、截图", SUB, F12)
    fields = [("手机号", "请输入任务手机号"), ("备注1", "手机号前三后四 + 昵称"), ("上传截图", "最多 6 张，上传后逗号拼接")]
    y = 144
    for label, ph in fields:
        text(d, (16, y), label, TEXT, F13)
        rect(d, (16, y + 24, 374, y + 74), CARD, 12, BORDER)
        text(d, (34, y + 49), ph, MUTED, F13, "lm")
        y += 94
    rect(d, (16, 442, 374, 548), CARD, 16)
    text(d, (32, 464), "提交规则", TEXT, F16)
    text(d, (32, 496), "TGG 后端生成 appid + sign，中转提交到悬赏平台。", SUB, F12)
    text(d, (32, 524), "提交成功后进入我的提交，等待审核回调。", SUB, F12)
    rect(d, (16, 748, 374, 796), GREEN, 24)
    text(d, (195, 772), "确认提交", "#FFFFFF", F16, "mm")
    return im


def submissions():
    im, d = base("我的提交", back=True)
    tabs = [("全部", True), ("审核中", False), ("已通过", False), ("已失败", False)]
    x = 16
    for name, on in tabs:
        pill(d, (x, 62), name, GREEN if on else CARD, "#FFFFFF" if on else SUB, 78)
        x += 86
    rows = [
        ("小红书高价版", "审核中", "#FFF7E6", ORANGE, "2026-07-05 11:20"),
        ("方块兽", "已通过", "#E8F8F0", GREEN, "积分已入账"),
        ("证券开户任务", "已失败", "#FFF1F0", RED, "资料不完整，请重提"),
    ]
    y = 110
    for title, status, bg, color, desc in rows:
        rect(d, (16, y, 374, y + 112), CARD, 14)
        text(d, (32, y + 22), title, TEXT, F15)
        pill(d, (286, y + 18), status, bg, color, 68)
        text(d, (32, y + 54), desc, SUB, F12)
        text(d, (32, y + 82), "奖励 ¥17.00 · 查看详情 ›", ORANGE if status == "已通过" else SUB, F12)
        y += 126
    return im


def signin():
    im, d = base("赚积分", tab="赚积分")
    rect(d, (0, 44, 390, 88), CARD, 0)
    text(d, (98, 66), "做任务", SUB, F15, "mm")
    text(d, (292, 66), "签到", GREEN, F15, "mm")
    line(d, (262, 87, 322, 87), GREEN, 3)
    rect(d, (16, 110, 374, 218), "#FFF7E6", 18, "#FFE0A3")
    text(d, (36, 138), "签满 30 天送 XXX", ORANGE, F22)
    text(d, (36, 176), "今日任务：观看 4 组广告", SUB, F13)
    rect(d, (16, 236, 374, 382), CARD, 16)
    text(d, (32, 260), "广告组规则", TEXT, F16)
    for i in range(4):
        x = 34 + i * 82
        icon_circle(d, x, 294, f"{i+1}", "#E8F8F0", GREEN, 42)
        text(d, (x + 21, 350), "激+插", SUB, F11, "mm")
    rect(d, (16, 400, 374, 514), CARD, 16)
    text(d, (32, 426), "连续签到", TEXT, F16)
    text(d, (32, 458), "已连续签到 12 天", GREEN, F20)
    rect(d, (32, 490, 342, 502), "#E6E8EB", 6)
    rect(d, (32, 490, 156, 502), GREEN, 6)
    rect(d, (16, 748, 374, 796), GREEN, 24)
    text(d, (195, 772), "立即签到", "#FFFFFF", F16, "mm")
    return im


def invite():
    im, d = base("我的邀请码", back=True)
    rect(d, (16, 62, 374, 226), "#E8F8F0", 18)
    text(d, (195, 94), "我的邀请码", GREEN_DARK, F16, "mm")
    text(d, (195, 142), "TGG8K2", GREEN, F32, "mm")
    rect(d, (96, 174, 180, 210), CARD, 18)
    text(d, (138, 192), "复制", GREEN, F13, "mm")
    rect(d, (210, 174, 294, 210), GREEN, 18)
    text(d, (252, 192), "分享", "#FFFFFF", F13, "mm")
    rect(d, (16, 246, 374, 340), CARD, 16)
    text(d, (32, 268), "奖励规则", TEXT, F16)
    text(d, (32, 300), "邀请成功赠送 1 个月会员，被邀请人任务通过后计算提成。", SUB, F12)
    rect(d, (16, 360, 374, 582), CARD, 16)
    text(d, (32, 382), "好友列表", TEXT, F16)
    friends = [("小陈", "累计贡献 32 积分"), ("Lina", "累计贡献 18 积分"), ("阿明", "新用户会员已赠送")]
    y = 420
    for name, desc in friends:
        icon_circle(d, 32, y - 10, name[0], "#EAF5FF", BLUE, 38)
        text(d, (84, y), name, TEXT, F14, "lm")
        text(d, (84, y + 24), desc, SUB, F11, "lm")
        y += 58
    return im


def category():
    im, d = base("商城分类", tab="分类")
    rect(d, (0, 44, 92, 788), CARD, 0)
    cats = ["水果", "蔬菜", "粮油", "日用", "饮品", "零食", "纯积分"]
    for i, c in enumerate(cats):
        y = 58 + i * 58
        if i == 0:
            rect(d, (0, y - 10, 92, y + 42), BG, 0)
            line(d, (0, y - 8, 0, y + 42), GREEN, 4)
            color = GREEN
        else:
            color = SUB
        text(d, (46, y + 16), c, color, F13, "mm")
    rect(d, (108, 62, 374, 122), "#E8F8F0", 14)
    text(d, (126, 84), "师大站点今日供应", GREEN_DARK, F16)
    text(d, (126, 108), "分类、商品、库存均后台配置", SUB, F11)
    y = 142
    for name, desc, price, image in [
        ("丹东草莓 500g", "会员可现金购买", "¥29.9", "strawberry"),
        ("阳光青提 500g", "普通用户可积分兑换", "299积分", "grapes"),
        ("精品香蕉 2斤", "送货上门可选时段", "¥16.8", "banana"),
    ]:
        rect(d, (108, y, 374, y + 96), CARD, 14)
        rect(d, (122, y + 16, 178, y + 72), "#F0F8F4", 12)
        if not paste_cover(im, image, (122, y + 16, 178, y + 72), 12):
            text(d, (150, y + 44), "果", GREEN, F18, "mm")
        text(d, (192, y + 18), name, TEXT, F14)
        text(d, (192, y + 44), desc, SUB, F11)
        text(d, (192, y + 70), price, GREEN, F15)
        y += 108
    return im


def product_detail():
    im, d = base("商品详情", back=True, tab="首页")
    rect(d, (0, 44, 390, 274), "#E8F8F0", 0)
    paste_cover(im, "strawberry", (88, 64, 302, 250), 18)
    rect(d, (16, 290, 374, 438), CARD, 16)
    text(d, (32, 316), "丹东草莓 500g", TEXT, F20)
    text(d, (32, 352), "会员现金价 ¥29.9", GREEN, F18)
    text(d, (32, 382), "普通用户可用 299 积分兑换", ORANGE, F13)
    text(d, (32, 414), "权益差异：会员可现金购物，普通用户不可现金购物", SUB, F12)
    rect(d, (16, 454, 374, 552), CARD, 16)
    text(d, (32, 478), "配送方式", TEXT, F16)
    pill(d, (32, 512), "站点自提", "#E8F8F0", GREEN, 92)
    pill(d, (136, 512), "送货上门", "#EAF5FF", BLUE, 92)
    rect(d, (16, 748, 185, 796), "#E8F8F0", 24)
    text(d, (100, 772), "加入购物车", GREEN, F15, "mm")
    rect(d, (205, 748, 374, 796), GREEN, 24)
    text(d, (290, 772), "立即购买", "#FFFFFF", F15, "mm")
    return im


def cart():
    im, d = base("购物车", tab="购物车")
    y = 64
    for name, sub, price, image in [
        ("丹东草莓 500g", "师大站点 · 今日配送", "¥29.9", "strawberry"),
        ("阳光青提 500g", "站点自提 · 0 元配送费", "188积分", "grapes"),
    ]:
        rect(d, (16, y, 374, y + 112), CARD, 16)
        icon_circle(d, 28, y + 38, "✓", "#E8F8F0", GREEN, 30)
        rect(d, (72, y + 24, 136, y + 88), "#F0F8F4", 12)
        if not paste_cover(im, image, (72, y + 24, 136, y + 88), 12):
            text(d, (104, y + 56), "品", GREEN, F18, "mm")
        text(d, (152, y + 24), name, TEXT, F14)
        text(d, (152, y + 52), sub, SUB, F11)
        text(d, (152, y + 82), price, GREEN, F15)
        text(d, (336, y + 82), "×1", SUB, F13, "mm")
        y += 126
    rect(d, (0, 724, 390, 788), CARD, 0)
    text(d, (16, 756), "合计：¥29.9 + 188积分", TEXT, F15, "lm")
    rect(d, (268, 736, 374, 780), GREEN, 22)
    text(d, (321, 758), "去结算", "#FFFFFF", F15, "mm")
    return im


def checkout():
    im, d = base("确认订单", back=True)
    rect(d, (16, 62, 374, 142), CARD, 16)
    text(d, (32, 84), "配送方式", TEXT, F16)
    pill(d, (32, 110), "站点自提", GREEN, "#FFFFFF", 96)
    pill(d, (140, 110), "送货上门", CARD, SUB, 96)
    rect(d, (16, 160, 374, 246), "#FFF7E6", 16)
    text(d, (32, 184), "预计 14 号配送", ORANGE, F18)
    text(d, (32, 214), "每日 05:00 截单，自提与送货共用规则", SUB, F12)
    rect(d, (16, 264, 374, 360), CARD, 16)
    text(d, (32, 288), "自提点", TEXT, F16)
    text(d, (32, 320), "师大站点 · 后台配置地址实时同步", SUB, F12)
    text(d, (342, 320), "更换 ›", GREEN, F12, "mm")
    rect(d, (16, 378, 374, 522), CARD, 16)
    text(d, (32, 402), "费用明细", TEXT, F16)
    rows = [("商品金额", "¥29.90"), ("积分抵扣", "188积分"), ("自提配送费", "¥0.00"), ("会员校验", "现金支付需月会员")]
    y = 434
    for k, v in rows:
        text(d, (32, y), k, SUB, F12)
        text(d, (356, y), v, TEXT, F12, "ra")
        y += 24
    rect(d, (16, 748, 374, 796), GREEN, 24)
    text(d, (195, 772), "提交订单", "#FFFFFF", F16, "mm")
    return im


def checkout_delivery():
    im, d = base("送货上门", back=True)
    rect(d, (16, 62, 374, 150), CARD, 16)
    text(d, (32, 86), "收货地址", TEXT, F16)
    text(d, (32, 118), "王先生 138****8888", TEXT, F13)
    text(d, (32, 140), "师大生活区 3 栋 1201", SUB, F12)
    rect(d, (16, 168, 374, 272), "#EAF5FF", 16)
    text(d, (32, 192), "平台自建配送团队", BLUE, F18)
    text(d, (32, 222), "不对接第三方物流，由自建配送员履约", SUB, F12)
    text(d, (32, 248), "可选配送时段：09:00 - 21:00", SUB, F12)
    rect(d, (16, 292, 374, 404), CARD, 16)
    text(d, (32, 316), "配送时间", TEXT, F16)
    pill(d, (32, 350), "14:00-16:00", "#E8F8F0", GREEN, 104)
    pill(d, (148, 350), "16:00-18:00", CARD, SUB, 104)
    rect(d, (16, 748, 374, 796), GREEN, 24)
    text(d, (195, 772), "确认送货上门", "#FFFFFF", F16, "mm")
    return im


def orders():
    im, d = base("我的订单", back=True)
    tabs = ["待收货", "已收货", "退款/售后"]
    x = 28
    for i, t in enumerate(tabs):
        text(d, (x + i * 112, 66), t, GREEN if i == 0 else SUB, F14, "mm")
    line(d, (28, 87, 82, 87), GREEN, 3)
    rows = [
        ("站点自提", "待核销", "师大站点 · 出示核销码"),
        ("送货上门", "配送中", "自建配送团队 · 预计 16:00 送达"),
        ("送货上门", "已送达", "可确认收货或等待自动确认"),
    ]
    y = 112
    for method, status, desc in rows:
        rect(d, (16, y, 374, y + 126), CARD, 16)
        pill(d, (32, y + 18), method, "#E8F8F0" if method == "站点自提" else "#EAF5FF", GREEN if method == "站点自提" else BLUE, 86)
        text(d, (334, y + 30), status, ORANGE if status != "已送达" else GREEN, F13, "mm")
        text(d, (32, y + 58), "丹东草莓 x1", TEXT, F15)
        text(d, (32, y + 88), desc, SUB, F12)
        y += 140
    return im


def pickup():
    im, d = base("自提点选择", back=True)
    rect(d, (16, 62, 374, 112), CARD, 16)
    text(d, (32, 87), "按定位推荐附近自提点", SUB, F13, "lm")
    sites = [
        ("师大站点", "师大生活区南门 50 米", "推荐"),
        ("中心广场站点", "中心广场 B 口旁", ""),
        ("东区站点", "东区超市旁", ""),
    ]
    y = 132
    for name, addr, tag in sites:
        rect(d, (16, y, 374, y + 104), CARD, 16)
        text(d, (32, y + 24), name, TEXT, F16)
        text(d, (32, y + 56), addr, SUB, F12)
        text(d, (32, y + 82), "地址由后台配置，与用户端实时同步", MUTED, F11)
        if tag:
            pill(d, (302, y + 20), tag, "#FFF7E6", ORANGE, 54)
        y += 118
    return im


def address():
    im, d = base("收货地址", back=True)
    rect(d, (16, 62, 374, 168), CARD, 16)
    text(d, (32, 86), "王先生 138****8888", TEXT, F16)
    text(d, (32, 118), "师大生活区 3 栋 1201", SUB, F12)
    pill(d, (32, 140), "默认地址", "#E8F8F0", GREEN, 76)
    rect(d, (16, 188, 374, 294), CARD, 16)
    text(d, (32, 212), "新增 / 编辑字段", TEXT, F16)
    text(d, (32, 244), "姓名、手机号、省市区、详细地址、地图定位", SUB, F12)
    text(d, (32, 270), "地址需在送货服务范围内，否则不可下单", ORANGE, F12)
    rect(d, (16, 748, 374, 796), GREEN, 24)
    text(d, (195, 772), "新增收货地址", "#FFFFFF", F16, "mm")
    return im


def profile():
    im, d = base("我的", tab="我的")
    rect(d, (0, 44, 390, 196), GREEN, 0)
    icon_circle(d, 28, 82, "J", "#FFFFFF", GREEN, 62)
    text(d, (106, 92), "James", "#FFFFFF", F20)
    text(d, (106, 126), "月会员剩余 18 天", "#EFFFF7", F13)
    rect(d, (254, 92, 356, 128), "#FFFFFF", 18)
    text(d, (305, 110), "续费会员", GREEN, F13, "mm")
    rect(d, (16, 162, 374, 252), CARD, 18)
    stats = [("积分", "2,580"), ("可提现", "¥128.50"), ("订单", "12")]
    for i, (k, v) in enumerate(stats):
        x = 65 + i * 130
        text(d, (x, 188), v, TEXT, F18, "mm")
        text(d, (x, 222), k, SUB, F12, "mm")
    items = ["我的订单", "积分明细", "积分排行榜", "会员开通", "提现", "客服与反馈"]
    y = 276
    for item in items:
        rect(d, (16, y, 374, y + 48), CARD, 12)
        text(d, (34, y + 24), item, TEXT, F14, "lm")
        text(d, (354, y + 24), "›", SUB, F20, "mm")
        y += 58
    return im


def membership():
    im, d = base("会员开通", back=True)
    rect(d, (16, 62, 374, 222), "#252A35", 18)
    text(d, (36, 94), "月会员", GOLD, F24)
    text(d, (36, 136), "普通用户升级条件：开通月会员", "#FFFFFF", F15)
    text(d, (36, 168), "会员可现金购物 / 积分不足可现金补差", "#D8DCE4", F12)
    rect(d, (16, 244, 374, 386), CARD, 16)
    text(d, (32, 268), "权益对比", TEXT, F16)
    text(d, (32, 304), "普通用户：积分兑换/消费，不可现金购物", SUB, F13)
    text(d, (32, 334), "会员用户：现金购买、现金补差、会员价", GREEN, F13)
    rect(d, (16, 410, 374, 520), CARD, 16)
    text(d, (32, 434), "开通方式", TEXT, F16)
    pill(d, (32, 470), "微信支付", "#E8F8F0", GREEN, 88)
    pill(d, (134, 470), "支付宝", "#EAF5FF", BLUE, 78)
    pill(d, (226, 470), "积分开通", "#FFF7E6", ORANGE, 88)
    rect(d, (16, 748, 374, 796), GOLD, 24)
    text(d, (195, 772), "立即开通月会员", "#231F20", F16, "mm")
    return im


def points():
    im, d = base("积分明细", back=True)
    rect(d, (16, 62, 374, 144), GREEN, 18)
    text(d, (32, 90), "当前积分", "#EFFFF7", F13)
    text(d, (32, 124), "2,580", "#FFFFFF", F28)
    rows = [("任务审核通过", "+119", "2026-07-05"), ("积分兑换商品", "-188", "2026-07-04"), ("签到奖励", "+5", "2026-07-04")]
    y = 166
    for name, val, date in rows:
        rect(d, (16, y, 374, y + 72), CARD, 14)
        text(d, (32, y + 22), name, TEXT, F14)
        text(d, (32, y + 48), date, SUB, F11)
        text(d, (342, y + 36), val, GREEN if val.startswith("+") else ORANGE, F18, "mm")
        y += 86
    return im


def ranking():
    im, d = base("积分排行榜", back=True)
    rect(d, (16, 62, 374, 154), "#FFF7E6", 18)
    text(d, (32, 90), "7 月积分榜", ORANGE, F20)
    text(d, (32, 124), "每月 1 日 00:00 自动结算并重置", SUB, F12)
    names = [("1", "小陈", "8,920"), ("2", "Lina", "7,850"), ("3", "James", "6,420"), ("4", "阿明", "5,980")]
    y = 176
    for rank, name, score in names:
        rect(d, (16, y, 374, y + 68), CARD, 14)
        text(d, (42, y + 34), rank, ORANGE if rank in ["1", "2", "3"] else SUB, F18, "mm")
        text(d, (86, y + 34), name, TEXT, F15, "lm")
        text(d, (348, y + 34), score, GREEN, F15, "rm")
        y += 82
    return im


def agent_scan():
    im, d = base("代理扫一扫", back=True)
    rect(d, (54, 118, 336, 400), "#101820", 18)
    rect(d, (96, 160, 294, 358), "#FFFFFF", 10)
    for i in range(5):
        line(d, (116, 188 + i * 34, 274, 188 + i * 34), "#111827", 4)
        line(d, (124 + i * 34, 176, 124 + i * 34, 342), "#111827", 4)
    text(d, (195, 446), "仅代理可见，用于扫描用户核销码", TEXT, F15, "mm")
    text(d, (195, 480), "自提点仅承担核销功能", SUB, F12, "mm")
    return im


def withdraw():
    im, d = base("提现", back=True)
    rect(d, (16, 62, 374, 174), GREEN, 18)
    text(d, (32, 94), "可提现余额", "#EFFFF7", F13)
    text(d, (32, 132), "¥128.50", "#FFFFFF", F30)
    rect(d, (16, 198, 374, 320), CARD, 16)
    text(d, (32, 224), "提现金额", TEXT, F16)
    text(d, (32, 272), "¥ 100.00", TEXT, F28)
    line(d, (32, 304, 342, 304))
    rect(d, (16, 342, 374, 440), CARD, 16)
    text(d, (32, 368), "规则", TEXT, F16)
    text(d, (32, 400), "1 元起提，手续费 1%，提现至微信。", SUB, F13)
    rect(d, (16, 748, 374, 796), GREEN, 24)
    text(d, (195, 772), "申请提现", "#FFFFFF", F16, "mm")
    return im


def refund():
    im, d = base("退货申请", back=True)
    rect(d, (16, 62, 374, 154), CARD, 16)
    text(d, (32, 88), "订单：丹东草莓 x1", TEXT, F15)
    text(d, (32, 118), "送货上门订单需先联系客服，再后台人工审批。", SUB, F12)
    rect(d, (16, 176, 374, 286), CARD, 16)
    text(d, (32, 202), "退款类型", TEXT, F16)
    pill(d, (32, 236), "退款", GREEN, "#FFFFFF", 80)
    pill(d, (126, 236), "全退", CARD, SUB, 80)
    rect(d, (16, 308, 374, 430), CARD, 16)
    text(d, (32, 334), "申请说明", TEXT, F16)
    text(d, (32, 372), "请输入退款原因，必要时上传凭证。", MUTED, F13)
    rect(d, (16, 748, 374, 796), GREEN, 24)
    text(d, (195, 772), "提交申请", "#FFFFFF", F16, "mm")
    return im


def service_page(title, headline, body, action="联系客服"):
    im, d = base(title, back=True)
    rect(d, (16, 84, 374, 260), "#E8F8F0", 22)
    text(d, (195, 136), headline, GREEN_DARK, F24, "mm")
    text(d, (195, 184), body, SUB, F13, "mm")
    rect(d, (70, 308, 320, 360), GREEN, 26)
    text(d, (195, 334), action, "#FFFFFF", F16, "mm")
    return im


def points_exchange():
    im, d = base("纯积分兑换", back=True)
    rect(d, (16, 62, 374, 132), "#E8F8F0", 16)
    text(d, (32, 88), "纯积分兑换无需会员", GREEN_DARK, F18)
    text(d, (32, 114), "不展示现金补差入口，积分不足时提示不足", SUB, F12)
    product_card(im, d, 16, 154, "精品香蕉 2斤", "188积分", "兑换", "banana")
    product_card(im, d, 202, 154, "有机青菜 1份", "99积分", "兑换", "bokchoy")
    product_card(im, d, 16, 382, "草莓 500g", "299积分", "热门", "strawberry")
    return im


SCREENS = [
    ("ui-v17-01-splash.png", splash),
    ("ui-v17-02-home.png", home),
    ("ui-v17-03-earn-tasks.png", earn_tasks),
    ("ui-v17-04-task-detail.png", task_detail),
    ("ui-v17-05-task-submit.png", task_submit),
    ("ui-v17-06-my-submissions.png", submissions),
    ("ui-v17-07-signin.png", signin),
    ("ui-v17-08-invite-code.png", invite),
    ("ui-v17-09-category.png", category),
    ("ui-v17-10-product-detail.png", product_detail),
    ("ui-v17-11-cart.png", cart),
    ("ui-v17-12-checkout-pickup.png", checkout),
    ("ui-v17-13-checkout-delivery.png", checkout_delivery),
    ("ui-v17-14-my-orders.png", orders),
    ("ui-v17-15-pickup-site.png", pickup),
    ("ui-v17-16-address.png", address),
    ("ui-v17-17-profile.png", profile),
    ("ui-v17-18-membership.png", membership),
    ("ui-v17-19-points-ledger.png", points),
    ("ui-v17-20-ranking.png", ranking),
    ("ui-v17-21-agent-scan.png", agent_scan),
    ("ui-v17-22-withdraw.png", withdraw),
    ("ui-v17-23-refund.png", refund),
    ("ui-v17-24-customer-service.png", lambda: service_page("客服", "在线客服", "代理申请、退款售后、配送问题统一入口")),
    ("ui-v17-25-feedback.png", lambda: service_page("意见反馈", "提交反馈", "问题描述、联系方式、截图凭证")),
    ("ui-v17-26-business.png", lambda: service_page("商务合作", "合作申请", "填写姓名、电话、合作内容")),
    ("ui-v17-27-recruiting.png", lambda: service_page("XX 招聘", "招聘岗位", "展示职位说明与客服联系方式", "咨询岗位")),
    ("ui-v17-28-points-exchange.png", points_exchange),
]


def make_overview(paths):
    thumb_w, thumb_h = sc(130), sc(281)
    cols = 4
    rows = math.ceil(len(paths) / cols)
    pad = sc(28)
    canvas = Image.new("RGB", (cols * thumb_w + (cols + 1) * pad, rows * (thumb_h + sc(42)) + pad), "#E8EAED")
    d = ImageDraw.Draw(canvas)
    for idx, path in enumerate(paths):
        img = Image.open(path).resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        col = idx % cols
        row = idx // cols
        x = pad + col * (thumb_w + pad)
        y = pad + row * (thumb_h + sc(42))
        canvas.paste(img, (x, y))
        d.text((x, y + thumb_h + sc(10)), path.name.replace("ui-v17-", "").replace(".png", ""), fill=TEXT, font=F10)
    out = OUT / "ui-v17-overview.png"
    canvas.save(out, optimize=True)
    return out


def main():
    ensure_product_assets()
    paths = []
    for filename, maker in SCREENS:
        out = OUT / filename
        maker().save(out, optimize=True)
        paths.append(out)
    overview = make_overview(paths)
    print(f"Generated {len(paths)} screens")
    for p in paths:
        print(p)
    print(overview)


if __name__ == "__main__":
    main()
