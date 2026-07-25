from __future__ import annotations

import math
import shutil
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "ui" / "v17" / "UI"
ASSETS = ROOT / "ui" / "v17" / "assets"
OUT.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)

S = 3
W, H = 390 * S, 844 * S

GREEN = "#08B86F"
GREEN_DARK = "#087B4E"
MINT = "#EAFBF3"
ORANGE = "#FF7A1A"
GOLD = "#FFC247"
BLUE = "#2F80ED"
RED = "#FF4D3D"
INK = "#161A20"
TEXT = "#222833"
SUB = "#6B7280"
MUTED = "#AAB1BB"
LINE = "#E8EBEF"
BG = "#F4F6F8"
CARD = "#FFFFFF"

URLS = {
    "apple": "https://commons.wikimedia.org/wiki/Special:FilePath/Red%20Apple.jpg",
    "grapes": "https://commons.wikimedia.org/wiki/Special:FilePath/Table_grapes_on_white.jpg",
    "strawberry": "https://commons.wikimedia.org/wiki/Special:FilePath/Strawberry_on_white_background.jpg",
    "bokchoy": "https://commons.wikimedia.org/wiki/Special:FilePath/Baby_bok_choy.jpg",
    "banana": "https://commons.wikimedia.org/wiki/Special:FilePath/Bananas_white_background.jpg",
}


def sp(v: int | float) -> int:
    return int(round(v * S))


def font(size: int, bold: bool = False):
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf" if bold else r"C:\Windows\Fonts\simsun.ttc",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size * S)
    return ImageFont.load_default()


F9 = font(9)
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
F32 = font(32, True)


def ensure_assets():
    seed = ROOT / "ui" / "v17" / "assets_test"
    for name, url in URLS.items():
        target = ASSETS / f"{name}.jpg"
        if target.exists() and target.stat().st_size > 1024:
            continue
        seeded = seed / f"{name}.jpg"
        if seeded.exists() and seeded.stat().st_size > 1024:
            shutil.copyfile(seeded, target)
            continue
        try:
            req = Request(url, headers={"User-Agent": "Mozilla/5.0 TGG Shop UI mockup"})
            with urlopen(req, timeout=35) as res:
                target.write_bytes(res.read())
        except Exception as exc:
            print(f"asset download skipped: {name} ({exc})")


def asset(name: str):
    path = ASSETS / f"{name}.jpg"
    if not path.exists():
        return None
    try:
        return Image.open(path).convert("RGB")
    except Exception:
        return None


def gradient(size, c1, c2, vertical=False):
    w, h = size
    im = Image.new("RGBA", size, c1)
    d = ImageDraw.Draw(im)
    a = tuple(int(c1[i:i + 2], 16) for i in (1, 3, 5))
    b = tuple(int(c2[i:i + 2], 16) for i in (1, 3, 5))
    steps = h if vertical else w
    for i in range(steps):
        t = i / max(1, steps - 1)
        col = tuple(int(a[j] * (1 - t) + b[j] * t) for j in range(3)) + (255,)
        if vertical:
            d.line((0, i, w, i), fill=col)
        else:
            d.line((i, 0, i, h), fill=col)
    return im


class UI:
    def __init__(self, title="", back=False, tab=None, bg=BG):
        self.im = Image.new("RGBA", (W, H), bg)
        self.d = ImageDraw.Draw(self.im)
        self.title = title
        self.tab = tab
        self.status(title, back)
        if tab:
            self.bottom(tab)

    def rr(self, box, r, fill, outline=None, width=1):
        self.d.rounded_rectangle(tuple(sp(v) for v in box), radius=sp(r), fill=fill, outline=outline, width=sp(width))

    def text(self, xy, s, fill=TEXT, f=F14, anchor=None):
        self.d.text((sp(xy[0]), sp(xy[1])), s, fill=fill, font=f, anchor=anchor)

    def line(self, xy, fill=LINE, width=1):
        self.d.line(tuple(sp(v) for v in xy), fill=fill, width=sp(width))

    def shadow(self, box, r=18, blur=16, y=7, alpha=28):
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        b = tuple(sp(v) for v in box)
        d.rounded_rectangle((b[0], b[1] + sp(y), b[2], b[3] + sp(y)), radius=sp(r), fill=(30, 40, 55, alpha))
        layer = layer.filter(ImageFilter.GaussianBlur(sp(blur)))
        self.im.alpha_composite(layer)

    def card(self, box, r=18, fill=CARD, outline=None, shadow=True):
        if shadow:
            self.shadow(box, r, 12, 6, 22)
        self.rr(box, r, fill, outline)

    def status(self, title, back=False):
        self.rr((0, 0, 390, 50), 0, "#FFFFFF")
        self.text((24, 17), "9:41", INK, F13)
        self.text((330, 17), "5G", INK, F11)
        self.rr((352, 15, 376, 26), 3, None, INK, 1)
        self.rr((354, 17, 370, 24), 2, INK)
        if back:
            self.text((16, 34), "<", SUB, F18, "lm")
        self.text((195, 34), title, INK, F15, "mm")

    def bottom(self, active):
        self.rr((0, 782, 390, 844), 0, "#FFFFFF")
        self.line((0, 782, 390, 782))
        items = [("首页", "⌂"), ("赚积分", "☆"), ("分类", "▦"), ("购物车", "□"), ("我的", "○")]
        for i, (name, sym) in enumerate(items):
            x = 39 + i * 78
            c = GREEN if active == name else "#8A919D"
            self.text((x, 805), sym, c, F18, "mm")
            self.text((x, 829), name, c, F10, "mm")

    def pill(self, x, y, label, fill=MINT, color=GREEN, w=None):
        tw = (self.d.textbbox((0, 0), label, font=F11)[2]) / S
        w = w or max(44, tw + 20)
        self.rr((x, y, x + w, y + 25), 12.5, fill)
        self.text((x + w / 2, y + 12.5), label, color, F11, "mm")

    def img(self, name, box, r=14, fallback=None):
        src = asset(name)
        if src is None:
            self.rr(box, r, "#EEF3F0")
            if fallback:
                self.text(((box[0] + box[2]) / 2, (box[1] + box[3]) / 2), fallback, GREEN, F22, "mm")
            return
        b = tuple(sp(v) for v in box)
        w, h = b[2] - b[0], b[3] - b[1]
        fitted = ImageOps.fit(src, (w, h), Image.Resampling.LANCZOS, centering=(0.5, 0.5)).convert("RGBA")
        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), radius=sp(r), fill=255)
        self.im.paste(fitted, (b[0], b[1]), mask)

    def icon(self, x, y, label, bg=MINT, color=GREEN, size=42):
        self.rr((x, y, x + size, y + size), size / 2, bg)
        self.text((x + size / 2, y + size / 2), label, color, F16, "mm")

    def save(self, path):
        self.im.convert("RGB").save(path, optimize=True, quality=95)


def product_card(ui: UI, x, y, image, title, price, sub="会员价", tag="热卖"):
    ui.card((x, y, x + 170, y + 224), 18)
    ui.img(image, (x + 10, y + 10, x + 160, y + 126), 16, "品")
    ui.pill(x + 16, y + 18, tag, GREEN, "#FFFFFF", 52)
    ui.text((x + 14, y + 146), title, INK, F14)
    ui.pill(x + 14, y + 172, sub, "#FFF3EC", RED, 52)
    ui.text((x + 14, y + 204), price, RED, F20)
    ui.rr((x + 132, y + 188, x + 158, y + 214), 13, GREEN)
    ui.text((x + 145, y + 201), "+", "#FFFFFF", F18, "mm")


def home():
    ui = UI("TGG Shop", tab="首页", bg="#F7F8FA")
    ui.rr((0, 50, 390, 214), 0, "#FFFFFF")
    ui.icon(18, 58, "●", "#E8F8F0", GREEN, 26)
    ui.text((52, 72), "师大自提站", INK, F16, "lm")
    ui.text((346, 72), "消息", SUB, F11, "mm")
    ui.rr((18, 96, 372, 138), 21, "#F7FAF9", GREEN, 1)
    ui.text((38, 117), "搜索商品、积分兑换、配送服务", MUTED, F13, "lm")
    ui.card((18, 154, 372, 286), 22, "#0F8F55", shadow=False)
    grad = gradient((sp(354), sp(132)), "#10A765", "#08633E")
    mask = Image.new("L", (sp(354), sp(132)), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sp(354), sp(132)), radius=sp(22), fill=255)
    ui.im.paste(grad, (sp(18), sp(154)), mask)
    ui.text((38, 192), "时令鲜果季", "#FFFFFF", F28)
    ui.text((39, 224), "新鲜到站  低至 5 折", "#E7FFF2", F14)
    ui.rr((38, 246, 122, 274), 14, "#FFF15A")
    ui.text((80, 260), "立即抢购", GREEN_DARK, F12, "mm")
    ui.img("strawberry", (240, 168, 356, 270), 20)
    promos = [("签到拿积分", "每日领取", ORANGE), ("做任务拿积分", "审核入账", BLUE), ("邀请好友", "月卡奖励", GREEN)]
    for i, (t, s, c) in enumerate(promos):
        x = 18 + i * 122
        ui.card((x, 306, x + 110, 388), 17, c, shadow=True)
        ui.text((x + 14, 332), t, "#FFFFFF", F14)
        ui.text((x + 14, 358), s, "#FFFFFF", F11)
        ui.rr((x + 72, 337, x + 98, 363), 13, (255, 255, 255, 160))
    cats = [("水果", "果"), ("蔬菜", "菜"), ("肉禽", "肉"), ("乳品", "乳"), ("零食", "零"), ("日用", "日"), ("更多", "+")]
    for i, (name, ic) in enumerate(cats):
        x = 23 + i * 52
        ui.icon(x, 416, ic, "#F0F3F2", GREEN if i in [0, 1, 6] else BLUE if i in [3, 5] else ORANGE, 38)
        ui.text((x + 19, 466), name, TEXT, F11, "mm")
    ui.text((18, 506), "热门推荐", INK, F18)
    ui.rr((18, 512, 22, 532), 2, GREEN)
    ui.pill(122, 502, "纯积分兑换", "#E8F8F0", GREEN_DARK, 108)
    ui.text((352, 514), "更多 >", SUB, F12, "mm")
    product_card(ui, 18, 548, "apple", "山东京富士苹果", "¥12.8", "会员价", "今日特惠")
    product_card(ui, 202, 548, "grapes", "阳光玫瑰青提", "¥8.5", "会员价", "热销")
    return ui


def earn_tasks():
    ui = UI("赚积分", tab="赚积分")
    ui.rr((0, 50, 390, 126), 0, "#FFFFFF")
    ui.pill(86, 66, "做任务", GREEN, "#FFFFFF", 82)
    ui.pill(222, 66, "签到", "#F2F4F6", SUB, 82)
    ui.rr((18, 140, 372, 180), 20, "#FFFFFF")
    ui.text((36, 160), "搜索任务名称 / 分类", MUTED, F12, "lm")
    ui.card((18, 198, 372, 288), 20, "#EAF5FF")
    ui.icon(34, 220, "邀", "#FFFFFF", BLUE, 48)
    ui.text((94, 226), "拉新任务 · 邀请好友", INK, F16)
    ui.text((94, 252), "详情页展示奖励规则，列表不前置积分", SUB, F12)
    ui.text((334, 244), "去完成", BLUE, F12, "mm")
    chips = ["全部", "简单注册", "证券金融", "福利任务"]
    x = 18
    for i, c in enumerate(chips):
        ui.pill(x, 306, c, GREEN if i == 0 else "#FFFFFF", "#FFFFFF" if i == 0 else SUB, 72 if i else 54)
        x += 80 if i else 62
    tasks = [("小红书高价版", "简单注册", "需连续签到两天后提交"), ("工行一拖15", "证券金融", "本人信息注册，审核回调"), ("方块兽", "福利任务", "截图+手机号提交")]
    y = 350
    for title, cat, desc in tasks:
        ui.card((18, y, 372, y + 104), 18)
        ui.icon(34, y + 25, "任", MINT, GREEN, 54)
        ui.text((102, y + 24), title, INK, F15)
        ui.text((102, y + 50), desc, SUB, F11)
        ui.pill(102, y + 72, cat, "#F0FBF6", GREEN, 74)
        ui.text((338, y + 52), "去完成", GREEN, F12, "mm")
        y += 118
    return ui


def task_detail():
    ui = UI("任务详情", back=True)
    ui.card((18, 66, 372, 174), 22)
    ui.icon(34, 88, "任", MINT, GREEN, 58)
    ui.text((108, 92), "小红书高价版", INK, F18)
    ui.text((108, 122), "简单注册 · 会员可接任务", SUB, F12)
    ui.text((108, 148), "奖励 ¥17.00  会员可得 ¥11.90", ORANGE, F13)
    ui.card((18, 194, 372, 418), 22)
    ui.text((34, 218), "任务步骤", INK, F16)
    steps = ["扫码填写手机号并下载", "登录后完成指定操作", "连续两天签到截图", "提交手机号+昵称+截图"]
    for i, s in enumerate(steps):
        y = 260 + i * 38
        ui.icon(34, y - 13, str(i + 1), "#F0FBF6", GREEN, 26)
        ui.text((72, y), s, TEXT, F13, "lm")
    ui.card((18, 438, 372, 558), 20, "#FFF8ED")
    ui.text((34, 466), "注意事项", ORANGE, F16)
    ui.text((34, 498), "必须本人自愿注册；任务暂停时不可接单。", SUB, F12)
    ui.text((34, 526), "非会员点击去完成时引导开通月会员。", SUB, F12)
    ui.rr((18, 742, 372, 792), 25, GREEN)
    ui.text((195, 767), "立即接任务", "#FFFFFF", F16, "mm")
    return ui


def task_submit():
    ui = UI("提交任务", back=True)
    ui.card((18, 70, 372, 154), 22, "#F0FBF6")
    ui.text((34, 98), "动态交单表单", GREEN_DARK, F18)
    ui.text((34, 126), "根据 option 自动生成字段", SUB, F12)
    fields = [("手机号", "请输入任务手机号"), ("备注", "手机号前三后四 + 昵称"), ("上传截图", "最多 6 张，上传后自动拼接")]
    y = 180
    for name, hint in fields:
        ui.text((22, y), name, INK, F13)
        ui.card((18, y + 24, 372, y + 76), 15, "#FFFFFF", shadow=False)
        ui.text((36, y + 50), hint, MUTED, F12, "lm")
        y += 100
    ui.card((18, 508, 372, 610), 18)
    ui.text((34, 535), "提交说明", INK, F16)
    ui.text((34, 566), "TGG 后端中转，统一生成 appid + sign。", SUB, F12)
    ui.text((34, 590), "成功后进入我的提交等待审核。", SUB, F12)
    ui.rr((18, 742, 372, 792), 25, GREEN)
    ui.text((195, 767), "确认提交", "#FFFFFF", F16, "mm")
    return ui


def submissions():
    ui = UI("我的提交", back=True)
    tabs = ["全部", "审核中", "已通过", "已失败"]
    x = 18
    for i, t in enumerate(tabs):
        ui.pill(x, 66, t, GREEN if i == 0 else "#FFFFFF", "#FFFFFF" if i == 0 else SUB, 78)
        x += 88
    rows = [("小红书高价版", "审核中", ORANGE, "2026-07-05 11:20"), ("方块兽", "已通过", GREEN, "积分已入账"), ("证券开户任务", "已失败", RED, "资料不完整，请重提")]
    y = 118
    for title, status, color, desc in rows:
        ui.card((18, y, 372, y + 116), 18)
        ui.text((34, y + 28), title, INK, F15)
        ui.pill(292, y + 20, status, "#FFF7ED" if color == ORANGE else "#F0FBF6" if color == GREEN else "#FFF1F0", color, 64)
        ui.text((34, y + 62), desc, SUB, F12)
        ui.text((34, y + 92), "查看详情 >", color, F12)
        y += 132
    return ui


def signin():
    ui = UI("赚积分", tab="赚积分")
    ui.rr((0, 50, 390, 126), 0, "#FFFFFF")
    ui.pill(86, 66, "做任务", "#F2F4F6", SUB, 82)
    ui.pill(222, 66, "签到", GREEN, "#FFFFFF", 82)
    ui.card((18, 150, 372, 278), 24, "#FFF6E6")
    ui.text((36, 188), "签满 30 天送 XXX", ORANGE, F22)
    ui.text((36, 226), "今日任务：观看 4 组广告", SUB, F13)
    ui.card((18, 300, 372, 442), 22)
    ui.text((34, 326), "广告组", INK, F16)
    for i in range(4):
        ui.icon(44 + i * 78, 358, str(i + 1), MINT, GREEN, 44)
        ui.text((66 + i * 78, 418), "激+插", SUB, F10, "mm")
    ui.card((18, 462, 372, 574), 22)
    ui.text((34, 490), "连续签到 12 天", GREEN_DARK, F18)
    ui.rr((34, 526, 336, 538), 6, "#E8EBEF")
    ui.rr((34, 526, 162, 538), 6, GREEN)
    ui.rr((18, 742, 372, 792), 25, GREEN)
    ui.text((195, 767), "立即签到", "#FFFFFF", F16, "mm")
    return ui


def invite():
    ui = UI("我的邀请码", back=True)
    ui.card((18, 72, 372, 234), 24, MINT)
    ui.text((195, 112), "我的邀请码", GREEN_DARK, F16, "mm")
    ui.text((195, 158), "TGG8K2", GREEN, F32, "mm")
    ui.pill(108, 190, "复制", "#FFFFFF", GREEN, 76)
    ui.pill(210, 190, "分享", GREEN, "#FFFFFF", 76)
    ui.card((18, 258, 372, 358), 20)
    ui.text((34, 286), "奖励规则", INK, F16)
    ui.text((34, 318), "邀请成功赠送 1 个月会员，并按任务审核结果计算提成。", SUB, F12)
    ui.card((18, 382, 372, 596), 20)
    ui.text((34, 410), "好友列表", INK, F16)
    friends = [("小陈", "累计贡献 32 积分"), ("Lina", "累计贡献 18 积分"), ("阿明", "新用户会员已赠送")]
    for i, (n, desc) in enumerate(friends):
        y = 452 + i * 52
        ui.icon(34, y - 16, n[0], "#EAF5FF", BLUE, 34)
        ui.text((82, y), n, INK, F13, "lm")
        ui.text((82, y + 22), desc, SUB, F11, "lm")
    return ui


def category():
    ui = UI("商城分类", tab="分类")
    ui.rr((0, 50, 86, 782), 0, "#FFFFFF")
    cats = ["水果", "蔬菜", "粮油", "日用", "饮品", "零食", "纯积分"]
    for i, c in enumerate(cats):
        y = 76 + i * 58
        if i == 0:
            ui.rr((0, y - 18, 86, y + 30), 0, "#F0FBF6")
            ui.rr((0, y - 18, 4, y + 30), 2, GREEN)
            color = GREEN
        else:
            color = SUB
        ui.text((43, y + 4), c, color, F12, "mm")
    ui.card((104, 70, 372, 138), 18, MINT)
    ui.text((122, 98), "师大站点今日供应", GREEN_DARK, F16)
    ui.text((122, 122), "库存、价格、分类后台配置", SUB, F11)
    products = [("strawberry", "丹东草莓 500g", "¥29.9", "会员现金购买"), ("grapes", "阳光青提 500g", "299积分", "纯积分兑换"), ("banana", "精品香蕉 2斤", "¥16.8", "送货上门可选时段")]
    y = 160
    for img, name, price, desc in products:
        ui.card((104, y, 372, y + 112), 18)
        ui.img(img, (118, y + 16, 194, y + 96), 14)
        ui.text((208, y + 22), name, INK, F13)
        ui.text((208, y + 50), desc, SUB, F11)
        ui.text((208, y + 82), price, GREEN, F16)
        y += 126
    return ui


def product_detail():
    ui = UI("商品详情", back=True, tab="首页")
    ui.img("strawberry", (0, 50, 390, 286), 0)
    ui.card((18, 304, 372, 460), 24)
    ui.text((34, 334), "丹东草莓 500g", INK, F22)
    ui.text((34, 368), "会员现金价 ¥29.9", GREEN, F18)
    ui.text((34, 398), "普通用户可用 299 积分兑换", ORANGE, F13)
    ui.text((34, 430), "会员可现金购物，普通用户不可现金补差。", SUB, F12)
    ui.card((18, 480, 372, 584), 20)
    ui.text((34, 510), "配送方式", INK, F16)
    ui.pill(34, 538, "站点自提", MINT, GREEN, 88)
    ui.pill(134, 538, "送货上门", "#EAF5FF", BLUE, 88)
    ui.rr((18, 742, 186, 792), 25, MINT)
    ui.text((102, 767), "加入购物车", GREEN, F15, "mm")
    ui.rr((204, 742, 372, 792), 25, GREEN)
    ui.text((288, 767), "立即购买", "#FFFFFF", F15, "mm")
    return ui


def cart():
    ui = UI("购物车", tab="购物车")
    products = [("strawberry", "丹东草莓 500g", "师大站点 · 今日配送", "¥29.9"), ("grapes", "阳光青提 500g", "自提免配送费", "188积分")]
    y = 76
    for img, name, desc, price in products:
        ui.card((18, y, 372, y + 126), 20)
        ui.icon(32, y + 48, "✓", MINT, GREEN, 28)
        ui.img(img, (72, y + 22, 150, y + 104), 14)
        ui.text((166, y + 28), name, INK, F14)
        ui.text((166, y + 58), desc, SUB, F11)
        ui.text((166, y + 92), price, GREEN, F16)
        y += 142
    ui.rr((0, 710, 390, 782), 0, "#FFFFFF")
    ui.text((18, 746), "合计：¥29.9 + 188积分", INK, F14, "lm")
    ui.rr((266, 728, 372, 772), 22, GREEN)
    ui.text((319, 750), "去结算", "#FFFFFF", F14, "mm")
    return ui


def checkout_pickup():
    ui = UI("确认订单", back=True)
    ui.card((18, 72, 372, 160), 20)
    ui.text((34, 100), "配送方式", INK, F16)
    ui.pill(34, 126, "站点自提", GREEN, "#FFFFFF", 92)
    ui.pill(136, 126, "送货上门", "#F2F4F6", SUB, 92)
    ui.card((18, 182, 372, 276), 20, "#FFF8ED")
    ui.text((34, 212), "预计 14 号配送", ORANGE, F18)
    ui.text((34, 244), "每日 05:00 截单，自提与送货共用规则", SUB, F12)
    ui.card((18, 298, 372, 396), 20)
    ui.text((34, 328), "师大自提站", INK, F16)
    ui.text((34, 360), "后台配置地址实时同步", SUB, F12)
    ui.card((18, 418, 372, 558), 20)
    for i, (k, v) in enumerate([("商品金额", "¥29.90"), ("积分抵扣", "188积分"), ("自提配送费", "¥0.00"), ("会员校验", "现金支付需月会员")]):
        y = 450 + i * 26
        ui.text((34, y), k, SUB, F12)
        ui.text((350, y), v, INK, F12, "ra")
    ui.rr((18, 742, 372, 792), 25, GREEN)
    ui.text((195, 767), "提交订单", "#FFFFFF", F16, "mm")
    return ui


def checkout_delivery():
    ui = UI("送货上门", back=True)
    ui.card((18, 72, 372, 162), 20)
    ui.text((34, 102), "王先生 138****8888", INK, F15)
    ui.text((34, 134), "师大生活区 3 栋 1201", SUB, F12)
    ui.card((18, 184, 372, 302), 20, "#EAF5FF")
    ui.text((34, 216), "平台自建配送团队", BLUE, F18)
    ui.text((34, 248), "不对接第三方物流，由自建配送员履约", SUB, F12)
    ui.text((34, 276), "可选配送时段：09:00 - 21:00", SUB, F12)
    ui.card((18, 326, 372, 432), 20)
    ui.text((34, 356), "配送时间", INK, F16)
    ui.pill(34, 386, "14:00-16:00", GREEN, "#FFFFFF", 110)
    ui.pill(154, 386, "16:00-18:00", "#F2F4F6", SUB, 110)
    ui.rr((18, 742, 372, 792), 25, GREEN)
    ui.text((195, 767), "确认送货上门", "#FFFFFF", F16, "mm")
    return ui


def orders():
    ui = UI("我的订单", back=True)
    for i, t in enumerate(["待收货", "已收货", "退款/售后"]):
        ui.text((68 + i * 122, 78), t, GREEN if i == 0 else SUB, F14, "mm")
    ui.rr((40, 94, 96, 97), 2, GREEN)
    rows = [("站点自提", "待核销", "师大站点 · 出示核销码"), ("送货上门", "配送中", "自建配送团队 · 预计 16:00"), ("送货上门", "已送达", "可确认收货或等待自动确认")]
    y = 124
    for method, status, desc in rows:
        ui.card((18, y, 372, y + 126), 20)
        ui.pill(34, y + 20, method, MINT if method == "站点自提" else "#EAF5FF", GREEN if method == "站点自提" else BLUE, 88)
        ui.text((338, y + 32), status, ORANGE if status != "已送达" else GREEN, F13, "mm")
        ui.text((34, y + 62), "丹东草莓 x1", INK, F15)
        ui.text((34, y + 94), desc, SUB, F12)
        y += 142
    return ui


def pickup_site():
    ui = UI("自提点选择", back=True)
    ui.card((18, 72, 372, 124), 18)
    ui.text((34, 98), "按定位推荐附近自提点", SUB, F13, "lm")
    sites = [("师大站点", "师大生活区南门 50 米", "推荐"), ("中心广场站点", "中心广场 B 口旁", ""), ("东区站点", "东区超市旁", "")]
    y = 148
    for name, addr, tag in sites:
        ui.card((18, y, 372, y + 108), 20)
        ui.text((34, y + 30), name, INK, F16)
        ui.text((34, y + 62), addr, SUB, F12)
        ui.text((34, y + 88), "后台地址实时同步", MUTED, F11)
        if tag:
            ui.pill(304, y + 24, tag, "#FFF8ED", ORANGE, 52)
        y += 124
    return ui


def address():
    ui = UI("收货地址", back=True)
    ui.card((18, 72, 372, 184), 20)
    ui.text((34, 104), "王先生 138****8888", INK, F16)
    ui.text((34, 136), "师大生活区 3 栋 1201", SUB, F12)
    ui.pill(34, 154, "默认地址", MINT, GREEN, 76)
    ui.card((18, 210, 372, 330), 20)
    ui.text((34, 240), "地址字段", INK, F16)
    ui.text((34, 272), "姓名、手机号、省市区、详细地址、地图定位", SUB, F12)
    ui.text((34, 302), "超出送货服务范围不可下单", ORANGE, F12)
    ui.rr((18, 742, 372, 792), 25, GREEN)
    ui.text((195, 767), "新增收货地址", "#FFFFFF", F16, "mm")
    return ui


def profile():
    ui = UI("我的", tab="我的")
    ui.rr((0, 50, 390, 190), 0, GREEN)
    ui.icon(26, 86, "J", "#FFFFFF", GREEN, 64)
    ui.text((108, 98), "James", "#FFFFFF", F20)
    ui.text((108, 130), "月会员剩余 18 天", "#EFFFF7", F13)
    ui.pill(278, 104, "续费", "#FFFFFF", GREEN, 68)
    ui.card((18, 160, 372, 250), 22)
    for i, (k, v) in enumerate([("积分", "2,580"), ("可提现", "¥128.50"), ("订单", "12")]):
        x = 66 + i * 126
        ui.text((x, 188), v, INK, F18, "mm")
        ui.text((x, 222), k, SUB, F11, "mm")
    y = 278
    for item in ["我的订单", "积分明细", "积分排行榜", "会员开通", "提现", "客服与反馈"]:
        ui.card((18, y, 372, y + 48), 14, shadow=False)
        ui.text((34, y + 24), item, INK, F13, "lm")
        ui.text((350, y + 24), ">", MUTED, F16, "mm")
        y += 58
    return ui


def membership():
    ui = UI("会员开通", back=True)
    ui.card((18, 72, 372, 232), 24, "#232A36")
    ui.text((36, 110), "月会员", GOLD, F24)
    ui.text((36, 150), "普通用户升级条件：开通月会员", "#FFFFFF", F15)
    ui.text((36, 184), "会员可现金购物 / 现金补差", "#D8DCE4", F12)
    ui.card((18, 260, 372, 402), 20)
    ui.text((34, 288), "权益对比", INK, F16)
    ui.text((34, 324), "普通用户：积分兑换，不可现金购物", SUB, F13)
    ui.text((34, 356), "会员用户：现金购买、现金补差、会员价", GREEN, F13)
    ui.card((18, 428, 372, 536), 20)
    ui.text((34, 456), "开通方式", INK, F16)
    ui.pill(34, 492, "微信支付", MINT, GREEN, 86)
    ui.pill(132, 492, "支付宝", "#EAF5FF", BLUE, 76)
    ui.pill(220, 492, "积分开通", "#FFF8ED", ORANGE, 86)
    ui.rr((18, 742, 372, 792), 25, GOLD)
    ui.text((195, 767), "立即开通月会员", "#231F20", F16, "mm")
    return ui


def points():
    ui = UI("积分明细", back=True)
    ui.card((18, 72, 372, 166), 24, GREEN)
    ui.text((36, 106), "当前积分", "#EFFFF7", F13)
    ui.text((36, 142), "2,580", "#FFFFFF", F28)
    rows = [("任务审核通过", "+119", "2026-07-05"), ("积分兑换商品", "-188", "2026-07-04"), ("签到奖励", "+5", "2026-07-04")]
    y = 192
    for name, val, date in rows:
        ui.card((18, y, 372, y + 76), 18)
        ui.text((34, y + 26), name, INK, F14)
        ui.text((34, y + 52), date, SUB, F11)
        ui.text((340, y + 38), val, GREEN if val.startswith("+") else ORANGE, F18, "mm")
        y += 92
    return ui


def ranking():
    ui = UI("积分排行榜", back=True)
    ui.card((18, 72, 372, 166), 24, "#FFF8ED")
    ui.text((36, 106), "7 月积分榜", ORANGE, F20)
    ui.text((36, 138), "每月 1 日 00:00 自动结算并重置", SUB, F12)
    rows = [("1", "小陈", "8,920"), ("2", "Lina", "7,850"), ("3", "James", "6,420"), ("4", "阿明", "5,980")]
    y = 192
    for r, name, score in rows:
        ui.card((18, y, 372, y + 66), 18)
        ui.text((44, y + 33), r, ORANGE if r in "123" else SUB, F18, "mm")
        ui.text((86, y + 33), name, INK, F14, "lm")
        ui.text((342, y + 33), score, GREEN, F14, "rm")
        y += 82
    return ui


def agent_scan():
    ui = UI("代理扫一扫", back=True)
    ui.card((54, 130, 336, 412), 26, "#101820")
    ui.rr((98, 176, 292, 370), 12, "#FFFFFF")
    for i in range(5):
        ui.line((120, 206 + i * 32, 270, 206 + i * 32), "#111827", 4)
        ui.line((130 + i * 32, 194, 130 + i * 32, 350), "#111827", 4)
    ui.text((195, 466), "仅代理可见，用于扫描用户核销码", INK, F15, "mm")
    ui.text((195, 498), "自提点仅承担核销功能", SUB, F12, "mm")
    return ui


def withdraw():
    ui = UI("提现", back=True)
    ui.card((18, 72, 372, 184), 24, GREEN)
    ui.text((36, 106), "可提现余额", "#EFFFF7", F13)
    ui.text((36, 146), "¥128.50", "#FFFFFF", F28)
    ui.card((18, 212, 372, 328), 20)
    ui.text((34, 242), "提现金额", INK, F16)
    ui.text((34, 288), "¥ 100.00", INK, F24)
    ui.card((18, 354, 372, 452), 20)
    ui.text((34, 382), "规则", INK, F16)
    ui.text((34, 414), "1 元起提，手续费 1%，提现至微信。", SUB, F13)
    ui.rr((18, 742, 372, 792), 25, GREEN)
    ui.text((195, 767), "申请提现", "#FFFFFF", F16, "mm")
    return ui


def refund():
    ui = UI("退货申请", back=True)
    ui.card((18, 72, 372, 166), 20)
    ui.text((34, 102), "订单：丹东草莓 x1", INK, F15)
    ui.text((34, 132), "送货上门订单需先联系客服，再后台人工审批。", SUB, F12)
    ui.card((18, 196, 372, 306), 20)
    ui.text((34, 226), "退款类型", INK, F16)
    ui.pill(34, 260, "退款", GREEN, "#FFFFFF", 78)
    ui.pill(126, 260, "全退", "#F2F4F6", SUB, 78)
    ui.card((18, 336, 372, 456), 20)
    ui.text((34, 366), "申请说明", INK, F16)
    ui.text((34, 404), "请输入退款原因，必要时上传凭证。", MUTED, F13)
    ui.rr((18, 742, 372, 792), 25, GREEN)
    ui.text((195, 767), "提交申请", "#FFFFFF", F16, "mm")
    return ui


def simple_page(title, headline, body, action="联系客服"):
    ui = UI(title, back=True)
    ui.card((36, 116, 354, 300), 26, MINT)
    ui.text((195, 170), headline, GREEN_DARK, F24, "mm")
    ui.text((195, 216), body, SUB, F13, "mm")
    ui.rr((70, 350, 320, 402), 26, GREEN)
    ui.text((195, 376), action, "#FFFFFF", F16, "mm")
    return ui


def exchange():
    ui = UI("纯积分兑换", back=True)
    ui.card((18, 72, 372, 144), 20, MINT)
    ui.text((34, 102), "纯积分兑换无需会员", GREEN_DARK, F18)
    ui.text((34, 128), "不展示现金补差入口，积分不足时提示不足", SUB, F12)
    product_card(ui, 18, 170, "banana", "精品香蕉 2斤", "188积分", "兑换", "推荐")
    product_card(ui, 202, 170, "bokchoy", "有机青菜 1份", "99积分", "兑换", "新鲜")
    product_card(ui, 18, 414, "strawberry", "草莓 500g", "299积分", "兑换", "热门")
    return ui


def splash():
    ui = UI("", bg="#101723")
    ui.rr((24, 54, 92, 82), 14, "#253041")
    ui.text((58, 68), "跳过 3s", "#D8DEE8", F11, "mm")
    ui.card((40, 150, 350, 648), 34, GREEN, shadow=True)
    ui.text((195, 282), "TGG Shop", "#FFFFFF", F32, "mm")
    ui.text((195, 336), "开屏广告", "#EFFFF7", F20, "mm")
    ui.text((195, 382), "素材、时长、跳过均后台配置", "#E2FFF0", F13, "mm")
    ui.rr((92, 548, 298, 602), 27, "#FFFFFF")
    ui.text((195, 575), "进入商城", GREEN, F16, "mm")
    return ui


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
    ("ui-v17-12-checkout-pickup.png", checkout_pickup),
    ("ui-v17-13-checkout-delivery.png", checkout_delivery),
    ("ui-v17-14-my-orders.png", orders),
    ("ui-v17-15-pickup-site.png", pickup_site),
    ("ui-v17-16-address.png", address),
    ("ui-v17-17-profile.png", profile),
    ("ui-v17-18-membership.png", membership),
    ("ui-v17-19-points-ledger.png", points),
    ("ui-v17-20-ranking.png", ranking),
    ("ui-v17-21-agent-scan.png", agent_scan),
    ("ui-v17-22-withdraw.png", withdraw),
    ("ui-v17-23-refund.png", refund),
    ("ui-v17-24-customer-service.png", lambda: simple_page("客服", "在线客服", "代理申请、退款售后、配送问题统一入口")),
    ("ui-v17-25-feedback.png", lambda: simple_page("意见反馈", "提交反馈", "问题描述、联系方式、截图凭证", "提交反馈")),
    ("ui-v17-26-business.png", lambda: simple_page("商务合作", "合作申请", "填写姓名、电话、合作内容", "联系合作")),
    ("ui-v17-27-recruiting.png", lambda: simple_page("XX 招聘", "招聘岗位", "展示职位说明与客服联系方式", "咨询岗位")),
    ("ui-v17-28-points-exchange.png", exchange),
]


def overview(paths):
    thumb_w, thumb_h = sp(130), sp(281)
    cols = 4
    pad = sp(28)
    rows = math.ceil(len(paths) / cols)
    canvas = Image.new("RGB", (cols * thumb_w + (cols + 1) * pad, rows * (thumb_h + sp(42)) + pad), "#E6E9ED")
    d = ImageDraw.Draw(canvas)
    for idx, path in enumerate(paths):
        im = Image.open(path).resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        col, row = idx % cols, idx // cols
        x = pad + col * (thumb_w + pad)
        y = pad + row * (thumb_h + sp(42))
        canvas.paste(im, (x, y))
        d.text((x, y + thumb_h + sp(10)), path.name.replace("ui-v17-", "").replace(".png", ""), fill=TEXT, font=F10)
    out = OUT / "ui-v17-overview.png"
    canvas.save(out, optimize=True, quality=95)
    return out


def main():
    ensure_assets()
    paths = []
    for filename, maker in SCREENS:
        path = OUT / filename
        maker().save(path)
        paths.append(path)
    over = overview(paths)
    print(f"Generated {len(paths)} polished screens")
    print(over)


if __name__ == "__main__":
    main()
