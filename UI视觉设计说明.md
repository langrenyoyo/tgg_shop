# TGG Shop 高保真视觉设计

> **版本**：v1.8 完整版  
> **日期**：2026-07-05  
> **说明**：对齐《需求文档.md》v1.8，补充用户端 28 屏与后台管理端 16 屏，覆盖状态机、账务流水、后台权限与异常补偿机制

---

## 交付物

| 类型 | 文件 | 说明 |
|------|------|------|
| **交互原型** | `ui/ui-prototype.html` | **28 屏完整版**，下拉菜单切换 |
| **可交互实现** | `app/earn-points.html` | 赚积分模块 API Mock |
| **新版静态视觉稿** | `ui/v17/UI/ui-v17-*.png` | **v1.8 用户端 28 屏 PNG** |
| **新版总览图** | `ui/v17/UI/ui-v17-overview.png` | 用户端 28 屏总览，便于一次性评审 |
| **生成脚本** | `generate_ui_v17_beautiful.py` | 基于最新 PRD 可重复生成 v1.8 用户端 PNG |
| **后台静态视觉稿** | `ui/v17/admin/admin-*.png` | 按后台管理需求生成的桌面端后台页面 |
| **后台总览图** | `ui/v17/admin/admin-overview.png` | 后台管理端 16 屏总览 |
| **后台生成脚本** | `generate_admin_ui_v17.py` | 可重复生成后台管理端 PNG |
| **商品网图缓存** | `ui/v17/assets/*.jpg` | 用于首页、分类、详情、购物车、纯积分兑换等商品图片区域 |
| **静态视觉稿** | `ui/ui-*-v15.png` | 赚积分核心页面 PNG |
| **流程原型** | `../流程原型.html` | 业务流程图 |

---

## ui-prototype.html 完整屏幕清单（28 屏）

| 分组 | 屏幕 | 需求 §6 |
|------|------|---------|
| 启动/首页 | 开屏广告、首页 | P1、P0 |
| 商城购物 | 商城分类、商品详情、购物车 | P0 |
| 赚积分-做任务 | 做任务列表、任务详情、提交任务、我的提交、我的邀请码 | P0 |
| 赚积分-签到 | 签到、广告进度、抽奖转盘 | P0 |
| 订单配送 | 确认订单(自提)、确认订单(送货上门)、自提点选择、收货地址、我的订单、核销码、退货申请 | P0/P1 |
| 我的/会员 | 我的、积分明细、积分排行榜、会员开通、提现 | P0/P1 |
| 代理/其他 | 代理扫一扫、客服、意见反馈、商务合作 | P1/P2 |

**使用方式**：打开 `ui/ui-prototype.html`，顶部下拉菜单按分组选择页面。

---

## 设计规范

### 品牌色

| 用途 | 色值 |
|------|------|
| 主色 | `#00B96B` |
| 辅色 | `#FF6B00` |
| 会员金 | `#FFB800` |
| 背景 | `#F5F6F8` |

### UI/UX 要求（需求 §9）

| 编号 | 要求 |
|------|------|
| UI-01 | 模块间距 12–16px，卡片分区，层次分明 |
| UI-02 | 自提点地址与后台配置完全一致 |
| UI-04 | 任务/拉新列表不前置积分；签到展示「签满30天送XXX」；抽奖奖励进转盘后可见 |

---

## 用户端视觉稿清单 v1.8

| 页面 | 文件 | 说明 |
|------|------|------|
| 开屏广告 | `ui/v17/UI/ui-v17-01-splash.png` | 后台可配置素材、时长、跳过 |
| 首页 | `ui/v17/UI/ui-v17-02-home.png` | 搜索、轮播、快捷入口、商品分类、热门推荐、纯积分兑换入口 |
| 赚积分-做任务 | `ui/v17/UI/ui-v17-03-earn-tasks.png` | 分类、搜索、拉新入口、任务列表隐藏奖励 |
| 任务详情 | `ui/v17/UI/ui-v17-04-task-detail.png` | 任务步骤、奖励、会员接任务提示 |
| 提交任务 | `ui/v17/UI/ui-v17-05-task-submit.png` | option 动态表单、截图上传、TGG 后端中转 |
| 我的提交 | `ui/v17/UI/ui-v17-06-my-submissions.png` | 全部/审核中/通过/失败与驳回入口 |
| 赚积分-签到 | `ui/v17/UI/ui-v17-07-signin.png` | N 组广告（激+插）、30 天奖励 |
| 我的邀请码 | `ui/v17/UI/ui-v17-08-invite-code.png` | 邀请码、分享、奖励规则、好友列表 |
| 商城分类 | `ui/v17/UI/ui-v17-09-category.png` | 左侧分类、右侧商品列表 |
| 商品详情 | `ui/v17/UI/ui-v17-10-product-detail.png` | 会员现金价、普通用户积分兑换、配送方式 |
| 购物车 | `ui/v17/UI/ui-v17-11-cart.png` | 商品、积分/现金合计、结算入口 |
| 确认订单-自提 | `ui/v17/UI/ui-v17-12-checkout-pickup.png` | 自提点、截单配送日、会员校验、配送费 |
| 确认订单-送货 | `ui/v17/UI/ui-v17-13-checkout-delivery.png` | 收货地址、自建配送团队、配送时段 |
| 我的订单 | `ui/v17/UI/ui-v17-14-my-orders.png` | 自提/送货上门状态与履约信息 |
| 自提点选择 | `ui/v17/UI/ui-v17-15-pickup-site.png` | 后台地址同步、定位推荐 |
| 收货地址 | `ui/v17/UI/ui-v17-16-address.png` | 送货地址增删改与服务范围提示 |
| 我的 | `ui/v17/UI/ui-v17-17-profile.png` | 会员状态、积分、提现、功能菜单 |
| 会员开通 | `ui/v17/UI/ui-v17-18-membership.png` | 月会员升级条件、普通/会员权益对比 |
| 积分明细 | `ui/v17/UI/ui-v17-19-points-ledger.png` | 积分流水 |
| 积分排行榜 | `ui/v17/UI/ui-v17-20-ranking.png` | 月榜、每月 1 日结算重置 |
| 代理扫一扫 | `ui/v17/UI/ui-v17-21-agent-scan.png` | 代理扫码核销，自提点仅核销 |
| 提现 | `ui/v17/UI/ui-v17-22-withdraw.png` | 1 元起提、手续费 1%、微信提现 |
| 退货申请 | `ui/v17/UI/ui-v17-23-refund.png` | 售后先联系客服、后台人工审批 |
| 客服 | `ui/v17/UI/ui-v17-24-customer-service.png` | 代理申请、退款售后、配送问题入口 |
| 意见反馈 | `ui/v17/UI/ui-v17-25-feedback.png` | 问题描述、联系方式、截图凭证 |
| 商务合作 | `ui/v17/UI/ui-v17-26-business.png` | 合作申请 |
| XX 招聘 | `ui/v17/UI/ui-v17-27-recruiting.png` | 岗位说明与客服咨询 |
| 纯积分兑换 | `ui/v17/UI/ui-v17-28-points-exchange.png` | 无需会员，不展示现金补差入口 |
| 总览图 | `ui/v17/UI/ui-v17-overview.png` | 28 屏拼图总览 |

---

## 后台视觉稿清单 v1.8

| 页面 | 文件 | 说明 |
|------|------|------|
| 运营仪表盘 | `ui/v17/admin/admin-01-dashboard.png` | 订单、销售额、待办、趋势、最新订单 |
| 订单管理 | `ui/v17/admin/admin-02-orders.png` | 自提/送货/退款筛选、订单状态流转 |
| 订单状态机 | `ui/v17/admin/admin-03-order-state-machine.png` | 主订单状态、配送子状态、退款状态流转 |
| 自建配送团队 | `ui/v17/admin/admin-04-delivery-team.png` | 配送员、待分配订单、服务范围、配送时段 |
| 商品与分类管理 | `ui/v17/admin/admin-05-products.png` | 商品图片、分类、价格、库存、上下架 |
| 纯积分兑换管理 | `ui/v17/admin/admin-06-points-exchange.png` | 兑换商品、所需积分、库存、兑换限制 |
| 用户/会员管理 | `ui/v17/admin/admin-07-users.png` | 用户身份、会员状态、积分、可提现余额 |
| 代理与自提点 | `ui/v17/admin/admin-08-agents-pickup.png` | 自提点地址、代理账号、核销规则 |
| 悬赏任务审核对接 | `ui/v17/admin/admin-09-task-review.png` | 任务提交、审核回调、积分发放日志 |
| 签到广告配置 | `ui/v17/admin/admin-10-signin-ads.png` | 广告组、30 天奖励、转盘奖品权重 |
| 提现/退款审批 | `ui/v17/admin/admin-11-finance-refund.png` | 提现申请、退款/全退人工审批 |
| 支付/积分/可提现流水 | `ui/v17/admin/admin-12-ledger.png` | 支付单、积分流水、可提现流水、幂等键 |
| 积分排行榜配置 | `ui/v17/admin/admin-13-ranking.png` | 月度结算、名次段奖励、刷新间隔 |
| 后台角色与权限 | `ui/v17/admin/admin-14-permissions.png` | 角色权限矩阵、写操作日志、财务二次确认 |
| 异常补偿中心 | `ui/v17/admin/admin-15-exceptions.png` | 支付、积分、回调、配送、退款异常处理 |
| 系统配置 | `ui/v17/admin/admin-16-settings.png` | 配送开关、截单时间、会员价格、接口日志 |
| 后台总览图 | `ui/v17/admin/admin-overview.png` | 16 屏拼图总览 |

---

## 视觉稿清单 v1.5（历史版本）

| 页面 | 文件 | 说明 |
|------|------|------|
| 赚积分-做任务 | `ui-04-earn-points-tasks-v15.png` | 双 Tab、拉新入口、任务列表隐藏积分 |
| 赚积分-签到 | `ui-04-earn-points-signin-v15.png` | N 组广告（激+插）、30 天奖励横幅 |
| 赚积分-广告进度 | `ui-04-earn-points-ad-progress-v15.png` | 第 X/N 组、激/插进度 |
| 赚积分-抽奖 | `ui-04-earn-points-lottery-v15.png` | 抽奖券 + 转盘 |
| 我的邀请码 | `ui-07-invite-code-v15.png` | 邀请码、规则、好友列表 |
| 我的 | `ui-02-profile-v12.png` | v1.2（提现规则） |
| 确认订单 | `ui-05-checkout-v12.png` | v1.2（双配送+截单） |

---

## ui-prototype.html 屏幕清单（已合并至上方完整清单）

---

## 各页面要点（v1.5）

### 赚积分 · 做任务
- 顶部 Tab：**做任务 | 签到**
- 固定 **拉新任务** 蓝色卡片（列表不展示 +3 积分）
- 悬赏任务卡片：仅标题/分类/tishi，**不展示 reward**

### 赚积分 · 签到
- 横幅：**签满 30 天送 XXX**
- **今日 N 组广告**（每组 1 激 + 1 插）
- 看完 → **抽奖券** → **转盘**（奖品后台配置）

### 我的邀请码
- 大字号邀请码 + 复制/分享
- 详情页才展示 +3 积分、10% 提成规则
- 邀请好友列表及贡献积分

---

## 使用说明

1. **完整评审**：打开 `ui/ui-prototype.html`，顶部下拉菜单切换 **28 屏**
2. **赚积分交互**：打开 `app/earn-points.html`（Mock 模式）
3. **静态展示**：使用 `ui/ui-*-v15.png`
4. 业务规则以《需求文档.md》为准

