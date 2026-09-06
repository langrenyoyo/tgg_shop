from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "ui" / "v17" / "admin"
ASSETS = ROOT / "ui" / "v17" / "assets"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1440, 1024

GREEN = "#08B86F"
GREEN_DARK = "#067A4D"
MINT = "#EAFBF3"
BLUE = "#2F80ED"
ORANGE = "#FF8A1F"
RED = "#EF4444"
GOLD = "#F5B42A"
INK = "#111827"
TEXT = "#253042"
SUB = "#667085"
MUTED = "#98A2B3"
LINE = "#E6EAF0"
BG = "#F5F7FA"
CARD = "#FFFFFF"
SIDEBAR = "#111827"


def font(size: int, bold: bool = False):
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf" if bold else r"C:\Windows\Fonts\simsun.ttc",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
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
F24 = font(24, True)
F28 = font(28, True)
F32 = font(32, True)


def fit_text(value, max_chars=14):
    return value if len(value) <= max_chars else value[: max_chars - 1] + "…"


def load_asset(name):
    path = ASSETS / f"{name}.jpg"
    if not path.exists():
        return None
    try:
        return Image.open(path).convert("RGB")
    except Exception:
        return None


class Admin:
    def __init__(self, title, active):
        self.im = Image.new("RGBA", (W, H), BG)
        self.d = ImageDraw.Draw(self.im)
        self.title = title
        self.active = active
        self.sidebar()
        self.topbar()

    def rr(self, box, r, fill, outline=None, width=1):
        self.d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)

    def text(self, xy, value, fill=TEXT, f=F14, anchor=None):
        self.d.text(xy, str(value), fill=fill, font=f, anchor=anchor)

    def line(self, xy, fill=LINE, width=1):
        self.d.line(xy, fill=fill, width=width)

    def shadow(self, box, r=18, blur=18, y=8, alpha=22):
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        x1, y1, x2, y2 = box
        d.rounded_rectangle((x1, y1 + y, x2, y2 + y), radius=r, fill=(15, 23, 42, alpha))
        layer = layer.filter(ImageFilter.GaussianBlur(blur))
        self.im.alpha_composite(layer)

    def card(self, box, r=18, fill=CARD, shadow=True):
        if shadow:
            self.shadow(box, r)
        self.rr(box, r, fill)

    def pill(self, x, y, label, color=GREEN, fill=None, w=None):
        fill = fill or (MINT if color == GREEN else "#EAF3FF" if color == BLUE else "#FFF7E8" if color == ORANGE else "#FEECEC")
        tw = self.d.textbbox((0, 0), label, font=F12)[2]
        w = w or tw + 24
        self.rr((x, y, x + w, y + 28), 14, fill)
        self.text((x + w / 2, y + 14), label, color, F12, "mm")

    def button(self, x, y, label, w=96, color=GREEN, outline=False):
        if outline:
            self.rr((x, y, x + w, y + 36), 10, "#FFFFFF", color, 1)
            self.text((x + w / 2, y + 18), label, color, F13, "mm")
        else:
            self.rr((x, y, x + w, y + 36), 10, color)
            self.text((x + w / 2, y + 18), label, "#FFFFFF", F13, "mm")

    def sidebar(self):
        self.rr((0, 0, 236, H), 0, SIDEBAR)
        self.rr((24, 24, 54, 54), 10, GREEN)
        self.text((68, 38), "TGG Shop", "#FFFFFF", F18, "lm")
        self.text((68, 60), "运营后台", "#9CA3AF", F11, "lm")
        items = [
            ("dashboard", "仪表盘", "◇"),
            ("orders", "订单管理", "□"),
            ("states", "订单状态机", "⇄"),
            ("delivery", "配送团队", "↗"),
            ("products", "商品/分类", "▦"),
            ("points", "纯积分兑换", "★"),
            ("users", "用户/会员", "人"),
            ("agents", "代理与自提点", "⌖"),
            ("tasks", "任务审核", "✓"),
            ("signin", "签到广告", "◎"),
            ("finance", "提现/退款", "¥"),
            ("ledger", "账务流水", "≡"),
            ("ranking", "积分排行榜", "榜"),
            ("permissions", "后台权限", "钥"),
            ("exceptions", "异常补偿", "!"),
            ("settings", "系统配置", "⚙"),
        ]
        y = 100
        for key, label, icon in items:
            active = key == self.active
            if active:
                self.rr((16, y - 8, 220, y + 36), 12, "#1E293B")
                self.rr((16, y - 8, 20, y + 36), 2, GREEN)
            color = "#FFFFFF" if active else "#B7C0CE"
            self.text((38, y + 14), icon, color, F14, "mm")
            self.text((64, y + 14), label, color, F14, "lm")
            y += 44

    def topbar(self):
        self.rr((236, 0, W, 78), 0, "#FFFFFF")
        self.text((272, 30), self.title, INK, F24, "lm")
        self.rr((872, 20, 1110, 58), 19, "#F6F8FA", LINE)
        self.text((894, 39), "搜索订单 / 用户 / 商品", MUTED, F13, "lm")
        self.pill(1134, 25, "今日营业中", GREEN, MINT, 102)
        self.rr((1260, 19, 1412, 59), 20, "#F6F8FA")
        self.text((1282, 39), "管理员 Admin", TEXT, F13, "lm")

    def stat(self, x, y, title, value, sub, color=GREEN):
        self.card((x, y, x + 250, y + 128), 18)
        self.text((x + 22, y + 30), title, SUB, F13)
        self.text((x + 22, y + 70), value, INK, F28)
        self.pill(x + 22, y + 92, sub, color)

    def table(self, x, y, w, headers, rows, widths=None, row_h=56):
        self.card((x, y, x + w, y + 60 + row_h * len(rows)), 18)
        widths = widths or [w / len(headers)] * len(headers)
        cx = x + 24
        for h, cw in zip(headers, widths):
            self.text((cx, y + 36), h, SUB, F12, "lm")
            cx += cw
        self.line((x + 18, y + 58, x + w - 18, y + 58))
        for i, row in enumerate(rows):
            ry = y + 60 + i * row_h
            cx = x + 24
            for cell, cw in zip(row, widths):
                if isinstance(cell, tuple):
                    label, color = cell
                    self.pill(cx, ry + 14, label, color)
                else:
                    self.text((cx, ry + row_h / 2), fit_text(str(cell), 20), TEXT, F13, "lm")
                cx += cw
            if i < len(rows) - 1:
                self.line((x + 18, ry + row_h, x + w - 18, ry + row_h), "#F0F2F5")

    def product_img(self, name, box):
        src = load_asset(name)
        if src is None:
            self.rr(box, 12, "#F0F3F2")
            self.text(((box[0] + box[2]) / 2, (box[1] + box[3]) / 2), "图", GREEN, F16, "mm")
            return
        w, h = box[2] - box[0], box[3] - box[1]
        fitted = ImageOps.fit(src, (w, h), Image.Resampling.LANCZOS).convert("RGBA")
        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), radius=12, fill=255)
        self.im.paste(fitted, (box[0], box[1]), mask)

    def save(self, filename):
        path = OUT / filename
        self.im.convert("RGB").save(path, quality=95, optimize=True)
        return path


def dashboard():
    ui = Admin("运营仪表盘", "dashboard")
    ui.stat(272, 112, "今日订单", "1,284", "+18.2%", GREEN)
    ui.stat(546, 112, "今日销售额", "¥68,420", "+12.6%", BLUE)
    ui.stat(820, 112, "待处理售后", "23", "需审批", ORANGE)
    ui.stat(1094, 112, "配送中", "156", "自建团队", GREEN)
    ui.card((272, 270, 900, 604), 20)
    ui.text((296, 300), "订单趋势", INK, F18)
    pts = [(320, 530), (390, 470), (460, 498), (530, 430), (600, 448), (670, 374), (740, 390), (810, 330), (870, 350)]
    for i in range(5):
        y = 350 + i * 45
        ui.line((306, y, 866, y), "#EEF1F4")
    ui.d.line(pts, fill=GREEN, width=4)
    for p in pts:
        ui.d.ellipse((p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5), fill=GREEN)
    ui.card((930, 270, 1412, 604), 20)
    ui.text((954, 300), "待办事项", INK, F18)
    todos = [("退款审批", "12 单", ORANGE), ("任务审核回调异常", "3 条", RED), ("配送员待分配", "28 单", BLUE), ("库存预警", "6 个 SKU", ORANGE)]
    for i, (name, count, color) in enumerate(todos):
        y = 344 + i * 58
        ui.text((954, y), name, TEXT, F14)
        ui.pill(1280, y - 14, count, color)
    ui.table(272, 642, 1140, ["最新订单", "用户", "配送方式", "状态", "金额"], [
        ["TGG20260705001", "James", "送货上门", ("配送中", BLUE), "¥129.80"],
        ["TGG20260705002", "小陈", "站点自提", ("待核销", ORANGE), "299积分"],
        ["TGG20260705003", "Lina", "送货上门", ("待发货", GREEN), "¥88.50"],
    ], [230, 160, 190, 160, 130])
    return ui


def orders():
    ui = Admin("订单管理", "orders")
    ui.card((272, 112, 1412, 188), 18)
    ui.pill(296, 136, "全部订单", GREEN, MINT, 90)
    ui.pill(396, 136, "站点自提", BLUE, "#EAF3FF", 90)
    ui.pill(496, 136, "送货上门", ORANGE, "#FFF7E8", 96)
    ui.pill(604, 136, "退款售后", RED, "#FEECEC", 90)
    ui.button(1290, 132, "导出订单", 96, GREEN)
    ui.table(272, 220, 1140, ["订单号", "用户", "商品", "配送方式", "状态", "实付/积分", "操作"], [
        ["TGG20260705001", "James", "丹东草莓 x1", "送货上门", ("配送中", BLUE), "¥29.90", "更新状态"],
        ["TGG20260705002", "小陈", "阳光青提 x1", "站点自提", ("待核销", ORANGE), "188积分", "查看核销"],
        ["TGG20260705003", "Lina", "香蕉 x2", "送货上门", ("待发货", GREEN), "¥33.60", "分配配送"],
        ["TGG20260705004", "阿明", "草莓 x1", "站点自提", ("退款中", RED), "¥29.90", "审批"],
        ["TGG20260705005", "Wang", "青菜 x3", "送货上门", ("已送达", GREEN), "99积分", "详情"],
    ], [210, 120, 180, 150, 130, 140, 140])
    return ui


def order_states():
    ui = Admin("订单状态机", "states")
    ui.stat(272, 112, "主状态", "12", "含终态", GREEN)
    ui.stat(546, 112, "配送子状态", "9", "自提/送货", BLUE)
    ui.stat(820, 112, "异常状态", "4", "需人工", ORANGE)
    ui.card((272, 274, 1412, 790), 20)
    ui.text((296, 306), "主订单状态流转", INK, F18)
    nodes = [
        ("pending_pay", "待支付", 316, 382, ORANGE),
        ("paid", "已支付/已扣积分", 548, 382, GREEN),
        ("pending_pickup", "待自提", 780, 330, BLUE),
        ("pending_ship", "待发货", 780, 438, BLUE),
        ("picked_up", "已核销", 1010, 330, GREEN),
        ("shipping", "配送中", 1010, 438, BLUE),
        ("delivered", "已送达", 1190, 438, GREEN),
        ("completed", "已完成", 1190, 330, GREEN),
        ("refunding", "退款中", 780, 568, RED),
        ("refunded", "已退款", 1010, 568, RED),
        ("cancelled", "已取消", 548, 568, MUTED),
        ("closed", "已关闭", 1190, 568, MUTED),
    ]
    for _, label, x, y, color in nodes:
        ui.rr((x - 70, y - 22, x + 70, y + 22), 14, "#FFFFFF", color, 2)
        ui.text((x, y), label, color, F13, "mm")
    lines = [
        ((386, 382), (478, 382)), ((618, 382), (710, 330)), ((618, 382), (710, 438)),
        ((850, 330), (940, 330)), ((850, 438), (940, 438)), ((1080, 438), (1120, 438)),
        ((1080, 330), (1120, 330)), ((850, 568), (940, 568)), ((618, 382), (710, 568)),
        ((618, 568), (710, 568)), ((1260, 438), (1260, 360)), ((1260, 568), (1260, 360)),
    ]
    for a, b in lines:
        ui.line((*a, *b), "#CCD3DD", 2)
    ui.text((296, 682), "约束：所有状态变更写入 order_status_log；退款中按审批结果回到原状态或进入已退款。", SUB, F13)
    ui.text((296, 720), "自提订单未核销可退款，已核销需客服工单；送货订单配送中/已送达需人工审批。", SUB, F13)
    return ui


def delivery():
    ui = Admin("自建配送团队", "delivery")
    ui.stat(272, 112, "配送中订单", "156", "实时跟踪", BLUE)
    ui.stat(546, 112, "在线配送员", "24", "自建团队", GREEN)
    ui.stat(820, 112, "待分配订单", "28", "需处理", ORANGE)
    ui.stat(1094, 112, "今日送达率", "96.8%", "+2.1%", GREEN)
    ui.table(272, 274, 620, ["配送员", "手机号", "当前订单", "状态"], [
        ["张师傅", "138****1122", "12", ("配送中", BLUE)],
        ["李师傅", "136****8811", "8", ("空闲", GREEN)],
        ["王师傅", "159****9032", "15", ("配送中", BLUE)],
        ["赵师傅", "177****0101", "0", ("休息", ORANGE)],
    ], [140, 170, 120, 120])
    ui.card((930, 274, 1412, 650), 20)
    ui.text((954, 304), "服务范围与时段", INK, F18)
    settings = [("送货服务范围", "师大周边 5km"), ("配送时间段", "09:00 - 21:00"), ("默认配送费", "按金额档位"), ("自动确认收货", "送达后 3 天")]
    y = 354
    for k, v in settings:
        ui.text((954, y), k, SUB, F13)
        ui.text((1240, y), v, TEXT, F14)
        y += 58
    ui.button(954, 590, "保存配置", 120, GREEN)
    return ui


def products():
    ui = Admin("商品与分类管理", "products")
    ui.button(1292, 116, "新增商品", 100, GREEN)
    ui.card((272, 112, 1412, 190), 18)
    ui.pill(296, 138, "水果", GREEN, MINT, 72)
    ui.pill(378, 138, "蔬菜", BLUE, "#EAF3FF", 72)
    ui.pill(460, 138, "乳品", ORANGE, "#FFF7E8", 72)
    products_data = [("apple", "山东京富士苹果", "水果", "¥12.8", "368", "上架"), ("grapes", "阳光玫瑰青提", "水果", "¥8.5", "126", "上架"), ("strawberry", "丹东草莓", "水果", "¥29.9", "42", "上架"), ("bokchoy", "有机青菜", "蔬菜", "99积分", "18", "预警"), ("banana", "精品香蕉", "水果", "¥16.8", "220", "上架")]
    ui.card((272, 220, 1412, 850), 20)
    headers = ["商品", "分类", "价格", "库存", "状态", "操作"]
    xs = [296, 640, 790, 920, 1040, 1210]
    for x, h in zip(xs, headers):
        ui.text((x, 256), h, SUB, F12)
    ui.line((292, 278, 1390, 278))
    for i, (img, name, cat, price, stock, status) in enumerate(products_data):
        y = 302 + i * 94
        ui.product_img(img, (296, y, 366, y + 70))
        ui.text((386, y + 24), name, INK, F14)
        ui.text((386, y + 50), "会员现金/积分兑换", SUB, F11)
        ui.text((640, y + 36), cat, TEXT, F13)
        ui.text((790, y + 36), price, GREEN if "积分" in price else RED, F14)
        ui.text((920, y + 36), stock, TEXT, F13)
        ui.pill(1040, y + 22, status, ORANGE if status == "预警" else GREEN)
        ui.text((1210, y + 36), "编辑 / 下架", BLUE, F13)
        ui.line((292, y + 84, 1390, y + 84), "#F0F2F5")
    return ui


def points_exchange():
    ui = Admin("纯积分兑换管理", "points")
    ui.stat(272, 112, "兑换商品", "36", "上架中", GREEN)
    ui.stat(546, 112, "今日兑换单", "128", "+12%", BLUE)
    ui.stat(820, 112, "积分消耗", "45,820", "今日", ORANGE)
    ui.card((272, 274, 1412, 760), 20)
    ui.text((296, 306), "兑换商品配置", INK, F18)
    rows = [("精品香蕉 2斤", "188积分", "220", "每人每日 1 次"), ("有机青菜 1份", "99积分", "18", "库存预警"), ("丹东草莓 500g", "299积分", "42", "热门推荐")]
    y = 354
    for i, (name, points, stock, rule) in enumerate(rows):
        ui.text((296, y), name, INK, F14)
        ui.text((560, y), points, GREEN, F14)
        ui.text((740, y), stock, TEXT, F13)
        ui.text((900, y), rule, SUB, F13)
        ui.text((1240, y), "编辑规则", BLUE, F13)
        y += 72
    return ui


def users():
    ui = Admin("用户 / 会员管理", "users")
    ui.stat(272, 112, "用户总数", "36,420", "+1,208", GREEN)
    ui.stat(546, 112, "有效会员", "12,864", "月会员", GOLD)
    ui.stat(820, 112, "普通用户", "23,556", "不可现金购物", BLUE)
    ui.stat(1094, 112, "代理用户", "248", "可核销", GREEN)
    ui.table(272, 274, 1140, ["用户", "身份", "会员到期", "积分", "可提现", "操作"], [
        ["James", ("会员", GOLD), "18 天", "2,580", "¥128.50", "调整积分"],
        ["小陈", ("普通", BLUE), "-", "860", "¥0.00", "开通会员"],
        ["Lina", ("代理", GREEN), "30 天", "7,850", "¥42.10", "查看下级"],
        ["阿明", ("会员", GOLD), "7 天", "5,980", "¥12.00", "设为代理"],
    ], [180, 130, 150, 130, 140, 160])
    return ui


def agents():
    ui = Admin("代理与自提点", "agents")
    ui.stat(272, 112, "自提点", "18", "运营中", GREEN)
    ui.stat(546, 112, "代理账号", "248", "可扫码核销", BLUE)
    ui.stat(820, 112, "待审核申请", "12", "跳转客服", ORANGE)
    ui.table(272, 274, 620, ["自提点", "详细地址", "代理", "状态"], [
        ["师大站点", "师大生活区南门 50 米", "Lina", ("开启", GREEN)],
        ["中心广场站", "中心广场 B 口旁", "小王", ("开启", GREEN)],
        ["东区站点", "东区超市旁", "赵姐", ("关闭", ORANGE)],
    ], [140, 230, 120, 100])
    ui.card((930, 274, 1412, 560), 20)
    ui.text((954, 306), "核销规则", INK, F18)
    ui.text((954, 350), "自提点仅承担核销功能，不承担其他线下业务。", SUB, F13)
    ui.text((954, 394), "代理用户进入扫一扫，扫描用户订单核销码。", SUB, F13)
    ui.button(954, 470, "新增自提点", 120, GREEN)
    return ui


def tasks():
    ui = Admin("悬赏任务审核对接", "tasks")
    ui.stat(272, 112, "今日提交", "842", "+9.6%", GREEN)
    ui.stat(546, 112, "审核中", "186", "等待平台", ORANGE)
    ui.stat(820, 112, "回调成功率", "99.2%", "今日", GREEN)
    ui.stat(1094, 112, "异常回调", "3", "需排查", RED)
    ui.table(272, 274, 1140, ["任务订单ID", "用户ID", "任务", "状态", "奖励", "回调备注"], [
        ["11767", "James", "小红书高价版", ("审核中", ORANGE), "¥17.00", "-"],
        ["11768", "Lina", "方块兽", ("通过", GREEN), "¥4.50", "已发积分"],
        ["11769", "小陈", "证券金融", ("驳回", RED), "¥8.00", "资料不完整"],
        ["11770", "阿明", "工行一拖15", ("通过", GREEN), "¥8.00", "已计算提成"],
    ], [170, 130, 220, 130, 120, 260])
    return ui


def signin():
    ui = Admin("签到广告配置", "signin")
    ui.card((272, 112, 800, 430), 20)
    ui.text((296, 146), "广告组规则", INK, F18)
    settings = [("每日广告组数", "随机 3 - 5 组"), ("每组内容", "1 激励视频 + 1 插屏广告"), ("30 天奖励", "后台配置奖品"), ("抽奖次数", "每日 1 次")]
    y = 200
    for k, v in settings:
        ui.text((296, y), k, SUB, F13)
        ui.text((520, y), v, TEXT, F14)
        y += 54
    ui.button(296, 366, "保存配置", 120, GREEN)
    ui.card((840, 112, 1412, 430), 20)
    ui.text((864, 146), "转盘奖品与权重", INK, F18)
    prizes = [("5积分", "30%"), ("20积分", "12%"), ("100积分", "1%"), ("谢谢参与", "40%")]
    y = 200
    for p, w in prizes:
        ui.text((864, y), p, TEXT, F14)
        ui.text((1200, y), w, GREEN, F14)
        y += 54
    return ui


def finance():
    ui = Admin("提现 / 退款审批", "finance")
    ui.stat(272, 112, "待提现", "58", "人工/自动", ORANGE)
    ui.stat(546, 112, "待退款", "23", "人工审批", RED)
    ui.stat(820, 112, "今日到账", "¥12,840", "微信提现", GREEN)
    ui.table(272, 274, 1140, ["类型", "用户", "金额/积分", "来源订单", "状态", "操作"], [
        ["提现", "James", "¥100.00", "-", ("待审核", ORANGE), "通过 / 拒绝"],
        ["退款", "小陈", "¥29.90", "TGG20260705004", ("待审批", RED), "审批"],
        ["全退", "Lina", "299积分", "TGG20260705008", ("待审批", RED), "审批"],
        ["提现", "阿明", "¥50.00", "-", ("已通过", GREEN), "详情"],
    ], [130, 140, 160, 220, 130, 180])
    return ui


def ledger():
    ui = Admin("支付 / 积分 / 可提现流水", "ledger")
    ui.stat(272, 112, "今日支付单", "1,036", "含会员/商品", GREEN)
    ui.stat(546, 112, "积分流水", "8,420", "入账/扣减", BLUE)
    ui.stat(820, 112, "可提现流水", "428", "冻结/解冻", ORANGE)
    ui.stat(1094, 112, "幂等异常", "2", "需处理", RED)
    ui.table(272, 274, 1140, ["流水类型", "业务单号", "用户", "方向", "金额/积分", "状态", "幂等键"], [
        ["支付单", "PAY20260705001", "James", "in", "¥29.90", ("成功", GREEN), "pay_no"],
        ["积分流水", "PT20260705088", "小陈", "out", "188积分", ("已扣减", ORANGE), "order_id"],
        ["退款单", "RF20260705012", "Lina", "in", "¥29.90 + 299积分", ("退款中", RED), "refund_no"],
        ["可提现冻结", "WD20260705009", "阿明", "freeze", "¥100.00", ("冻结", BLUE), "withdraw_no"],
        ["任务奖励", "TK11768", "Lina", "in", "119积分", ("已入账", GREEN), "task_order_id"],
    ], [150, 210, 120, 100, 190, 130, 170])
    ui.card((272, 690, 1412, 850), 20)
    ui.text((296, 724), "账务规则摘要", INK, F18)
    ui.text((296, 766), "现金、积分、可提现余额分别记账；退款时现金与积分原路退回；提现失败需解冻返还。", SUB, F13)
    ui.text((296, 800), "所有财务动作必须有唯一业务单号和幂等键，禁止人工直接改库。", SUB, F13)
    return ui


def ranking():
    ui = Admin("积分排行榜配置", "ranking")
    ui.card((272, 112, 760, 420), 20)
    ui.text((296, 146), "月度榜单规则", INK, F18)
    settings = [("榜单开关", "开启"), ("结算时间", "每月 1 日 00:00"), ("展示刷新间隔", "5 分钟"), ("并列规则", "按先到先得")]
    y = 200
    for k, v in settings:
        ui.text((296, y), k, SUB, F13)
        ui.text((520, y), v, TEXT, F14)
        y += 54
    ui.card((800, 112, 1412, 520), 20)
    ui.text((824, 146), "奖励配置", INK, F18)
    rewards = [("第 1 名", "500 积分 + 实物"), ("第 2-10 名", "100 积分"), ("第 11-50 名", "20 积分")]
    y = 204
    for rank, reward in rewards:
        ui.text((824, y), rank, TEXT, F14)
        ui.text((1080, y), reward, GREEN, F14)
        y += 64
    ui.button(824, 444, "保存规则", 120, GREEN)
    return ui


def permissions():
    ui = Admin("后台角色与权限", "permissions")
    ui.card((272, 112, 1412, 850), 20)
    ui.text((296, 146), "角色权限矩阵", INK, F18)
    headers = ["角色", "订单", "商品", "财务", "配送", "任务", "系统配置", "关键限制"]
    xs = [296, 480, 570, 660, 750, 840, 930, 1060]
    for x, h in zip(xs, headers):
        ui.text((x, 190), h, SUB, F12)
    ui.line((292, 214, 1390, 214))
    rows = [
        ("超级管理员", "✓", "✓", "✓", "✓", "✓", "✓", "少数账号"),
        ("运营管理员", "查看", "✓", "-", "-", "查看", "✓", "不可改财务"),
        ("商品管理员", "-", "✓", "-", "-", "-", "-", "不可退款"),
        ("订单管理员", "✓", "-", "-", "状态", "-", "-", "不可改金额"),
        ("配送调度", "送货", "-", "-", "✓", "-", "-", "仅送货单"),
        ("客服", "查看", "-", "-", "查看", "-", "-", "只建工单"),
        ("财务", "查看", "-", "✓", "-", "-", "-", "二次确认"),
        ("审核运维", "-", "-", "-", "-", "✓", "-", "任务相关"),
    ]
    y = 246
    for row in rows:
        for x, cell in zip(xs, row):
            color = GREEN if cell == "✓" else SUB if cell in ["-", "查看", "状态", "送货"] else TEXT
            ui.text((x, y), cell, color, F13)
        ui.line((292, y + 28, 1390, y + 28), "#F0F2F5")
        y += 58
    ui.card((296, 750, 1388, 824), 16, "#FFF8ED", shadow=False)
    ui.text((320, 778), "所有写操作记录 admin_operation_log；提现通过、退款通过、手动积分调整建议二次确认。", ORANGE, F13)
    return ui


def exceptions():
    ui = Admin("异常补偿中心", "exceptions")
    ui.stat(272, 112, "待人工处理", "37", "超过重试", ORANGE)
    ui.stat(546, 112, "支付异常", "6", "需查询", RED)
    ui.stat(820, 112, "回调异常", "3", "可重试", BLUE)
    ui.stat(1094, 112, "配送异常", "12", "客服介入", ORANGE)
    ui.table(272, 274, 1140, ["异常场景", "关联单号", "当前处理", "处理入口", "状态", "操作"], [
        ["支付成功订单未更新", "PAY20260705001", "查询支付结果", "支付异常日志", ("待处理", ORANGE), "补写订单"],
        ["积分扣减订单失败", "PT20260705088", "自动回滚积分", "积分异常日志", ("处理中", BLUE), "查看"],
        ["悬赏平台重复回调", "TK11768", "幂等拦截", "回调日志", ("已处理", GREEN), "详情"],
        ["配送员误点送达", "TGG20260705013", "回退配送中", "配送异常", ("待确认", ORANGE), "回退"],
        ["退款失败", "RF20260705012", "财务重试", "退款审批", ("失败", RED), "重试"],
    ], [230, 190, 180, 160, 130, 160])
    ui.card((272, 710, 1412, 850), 20)
    ui.text((296, 744), "补偿原则", INK, F18)
    ui.text((296, 786), "自动重试设置次数上限，超过上限进入人工队列；补偿必须产生业务单据和日志。", SUB, F13)
    ui.text((296, 820), "用户侧需通过消息通知反馈退款、提现、配送异常、任务驳回等关键结果。", SUB, F13)
    return ui


def settings():
    ui = Admin("系统配置", "settings")
    ui.card((272, 112, 860, 720), 20)
    ui.text((296, 146), "基础配置", INK, F18)
    configs = [
        ("站点自提开关", "开启"),
        ("送货上门服务", "开启"),
        ("截单时间", "每日 05:00"),
        ("每日购买上限", "500 元/账号"),
        ("会员价格", "月卡费用后台配置"),
        ("提现手续费", "1%"),
        ("开屏广告", "可配置素材与时长"),
        ("招聘入口", "展示/隐藏"),
    ]
    y = 198
    for k, v in configs:
        ui.text((296, y), k, SUB, F13)
        ui.text((560, y), v, TEXT, F14)
        y += 56
    ui.card((900, 112, 1412, 480), 20)
    ui.text((924, 146), "接口与日志", INK, F18)
    logs = [("悬赏平台 appid/sign", "已配置"), ("回调接收地址", "/api/task/callback"), ("接口请求日志", "保留 90 天"), ("积分发放日志", "幂等校验")]
    y = 200
    for k, v in logs:
        ui.text((924, y), k, SUB, F13)
        ui.text((1200, y), v, GREEN if "已" in v or "/" in v else TEXT, F14)
        y += 58
    ui.button(924, 410, "保存配置", 120, GREEN)
    return ui


SCREENS = [
    ("admin-01-dashboard.png", dashboard),
    ("admin-02-orders.png", orders),
    ("admin-03-order-state-machine.png", order_states),
    ("admin-04-delivery-team.png", delivery),
    ("admin-05-products.png", products),
    ("admin-06-points-exchange.png", points_exchange),
    ("admin-07-users.png", users),
    ("admin-08-agents-pickup.png", agents),
    ("admin-09-task-review.png", tasks),
    ("admin-10-signin-ads.png", signin),
    ("admin-11-finance-refund.png", finance),
    ("admin-12-ledger.png", ledger),
    ("admin-13-ranking.png", ranking),
    ("admin-14-permissions.png", permissions),
    ("admin-15-exceptions.png", exceptions),
    ("admin-16-settings.png", settings),
]


def make_overview(paths):
    tw, th = 360, 256
    cols = 3
    pad = 28
    rows = math.ceil(len(paths) / cols)
    canvas = Image.new("RGB", (cols * tw + (cols + 1) * pad, rows * (th + 44) + pad), "#E5E7EB")
    d = ImageDraw.Draw(canvas)
    for i, path in enumerate(paths):
        im = Image.open(path).resize((tw, th), Image.Resampling.LANCZOS)
        col, row = i % cols, i // cols
        x = pad + col * (tw + pad)
        y = pad + row * (th + 44)
        canvas.paste(im, (x, y))
        d.text((x, y + th + 12), path.name.replace(".png", ""), fill=INK, font=F13)
    out = OUT / "admin-overview.png"
    canvas.save(out, quality=95, optimize=True)
    return out


def main():
    paths = []
    for name, maker in SCREENS:
        paths.append(maker().save(name))
    overview = make_overview(paths)
    print(f"Generated {len(paths)} admin screens")
    print(overview)


if __name__ == "__main__":
    main()
