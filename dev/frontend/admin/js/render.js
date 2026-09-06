let currentAdminState = {};

const viewPermissions = {
  dashboard: "order:read",
  orders: "order:read",
  stateMachine: "order:read",
  deliveryTeam: "delivery:dispatch",
  products: "product:read",
  pointsExchange: "product:read",
  homeOps: "config:read",
  users: "customer:read",
  addressBook: "customer:read",
  inviteAudit: "customer:read",
  customerTickets: "ticket:write",
  agentsPickup: "pickup_site:write",
  taskReview: "task:review",
  signinAds: "signin:config",
  financeRefund: "refund:approve",
  ledger: "ledger:read",
  ranking: "ranking:read",
  monthlyReward: "config:read",
  permissions: "role:read",
  exceptions: "exception:read",
  settings: "config:read"
};

const titles = {
  dashboard: ["运营仪表盘", "订单、商品、积分、权限和异常补偿的运营总览"],
  orders: ["订单管理", "查看自提、配送、支付和退款状态"],
  stateMachine: ["订单状态机", "支付、扣分、履约、退款、关闭的边界"],
  deliveryTeam: ["自建配送团队", "配送团队与履约能力配置"],
  products: ["商品与分类管理", "现金商品、积分商品、库存和上下架"],
  pointsExchange: ["纯积分兑换", "无需会员、无现金补差入口"],
  homeOps: ["首页运营配置", "Banner、服务承诺和活动入口"],
  users: ["用户/会员管理", "用户状态、积分与会员权益"],
  addressBook: ["用户地址管理", "配送地址、默认地址和服务范围"],
  inviteAudit: ["邀请关系审计", "邀请绑定、提成积分和关系追踪"],
  customerTickets: ["客服工单", "客服、反馈、商务合作和招聘咨询"],
  agentsPickup: ["代理与自提点", "自提点启用、隐藏和核销"],
  taskReview: ["悬赏任务审核", "任务提交审核与积分入账"],
  signinAds: ["签到广告配置", "连续签到奖励与广告组配置"],
  financeRefund: ["支付 / 积分 / 提现流水", "财务审批、退款和提现"],
  ledger: ["财务流水", "现金、积分、幂等键和业务单号"],
  ranking: ["积分排行榜", "排行榜刷新与展示配置"],
  monthlyReward: ["月度奖励", "月度阶梯积分奖励结算、筛选和追回"],
  permissions: ["后台角色权限", "角色权限矩阵"],
  exceptions: ["异常补偿中心", "支付、积分、回调、配送和退款异常处理"],
  settings: ["系统设置", "会员、配送、自提、积分和回调配置"]
};

const labelMaps = {
  status: {
    active: "启用",
    pending: "待处理",
    pending_payment: "待支付",
    pending_review: "审核中",
    reviewing: "审核中",
    approved: "已通过",
    rejected: "已拒绝",
    paid: "已支付",
    failed: "失败",
    cancelled: "已取消",
    closed: "已关闭",
    completed: "已完成",
    refunded: "已退款",
    resolved: "已处理",
    executed: "已执行",
    on: "上架",
    off: "下架",
    not_started: "未开始",
    pending_pickup: "待自提",
    picked_up: "已核销",
    pending_ship: "待配送",
    pending_delivery: "待配送",
    shipping: "配送中",
    delivered: "已送达",
    delivery_exception: "配送异常"
  },
  paymentMode: {
    cash: "现金支付",
    pure_points: "纯积分兑换",
    points_plus_cash: "积分+现金补差"
  },
  fulfillmentType: {
    pickup: "到店自提",
    delivery: "送货上门"
  },
  payScene: {
    goods_cash: "现金购物",
    member_open: "会员开通",
    cash_diff: "积分补差"
  },
  channel: {
    mock_pay: "模拟支付",
    mock_refund: "模拟退款",
    wechat: "微信",
    alipay: "支付宝",
    manual: "人工处理"
  },
  ledgerType: {
    order_deduct: "下单扣积分",
    order_refund: "订单退积分",
    task_reward: "任务奖励",
    invite_reward: "邀请奖励",
    invite_commission: "邀请提成",
    signin_reward: "签到奖励",
    lottery_reward: "抽奖奖励",
    lottery: "抽奖奖励",
    monthly_reward: "月度奖励",
    monthly_reward_reversal: "月度奖励追回",
    manual_adjust: "人工调整"
  },
  direction: {
    in: "收入",
    out: "支出"
  },
  action: {
    "monthly_reward.settle": "月度奖励结算",
    "monthly_reward.reverse": "月度奖励追回",
    "approval.request": "提交复核申请",
    "approval.execute": "复核通过并执行",
    "approval.reject": "复核驳回",
    "points.adjust": "手工积分调整",
    "config.update": "更新配置"
  }
};

export function renderAdminPage(state) {
  currentAdminState = state || {};
  const [title, subtitle] = titles[state.view] || titles.dashboard;
  document.querySelector("#adminTitle").textContent = title;
  document.querySelector("#adminSubtitle").textContent = subtitle;
  document.querySelectorAll("#adminNav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
    const permission = viewPermissions[button.dataset.view];
    button.disabled = Boolean(permission && !can(permission));
    button.title = button.disabled ? `当前角色缺少权限：${permission}` : "";
  });

  const views = {
    dashboard,
    orders,
    stateMachine,
    deliveryTeam,
    products,
    pointsExchange,
    homeOps,
    users,
    addressBook,
    inviteAudit,
    customerTickets,
    agentsPickup,
    taskReview,
    signinAds,
    financeRefund,
    ledger,
    ranking,
    monthlyReward,
    permissions,
    exceptions,
    settings
  };
  const requiredPermission = viewPermissions[state.view];
  document.querySelector("#adminScreen").innerHTML = requiredPermission && !can(requiredPermission)
    ? permissionDenied(requiredPermission)
    : (views[state.view] || dashboard)(state);
}

export function renderPanelError(selector, error) {
  const message = error?.message || "当前角色无权限";
  document.querySelector(selector).innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
}

function dashboard(state) {
  const orders = state.orders || [];
  const refunds = state.refunds || [];
  const exceptions = state.exceptions || [];
  const users = state.users || [];
  const pointLedger = state.ledger?.pointLedger || [];
  const paymentLedger = state.ledger?.paymentLedger || [];
  const paidOrders = orders.filter((item) => ["paid", "completed", "refunded"].includes(item.status));
  const gmv = paidOrders.reduce((sum, item) => sum + Number(item.cashAmount || 0), 0);
  const pointNet = pointLedger.reduce((sum, item) => sum + (item.direction === "in" ? Number(item.points || 0) : -Number(item.points || 0)), 0);
  return `
    ${statCards([["订单数", orders.length], ["成交额", `¥${gmv.toFixed(1)}`], ["用户数", users.length], ["积分净额", pointNet]])}
    <section class="grid-2">
      <article class="table-panel">${simpleTable("最近订单", ["订单", "用户", "状态", "履约", "金额/积分"], orders.slice(0, 10).map((item) => [item.id, item.userId, badge(item.status), badge(item.fulfillmentStatus, "orange"), paymentText(item)]))}</article>
      <article class="table-panel">${simpleTable("运营队列", ["队列", "数量", "动作"], [
        ["待退款", refunds.filter((item) => item.status === "pending_review").length, `<button class="action" data-dashboard-jump="financeRefund">查看</button>`],
        ["异常补偿", exceptions.filter((item) => item.status === "pending").length, `<button class="action" data-dashboard-jump="exceptions">查看</button>`],
        ["支付流水", paymentLedger.length, `<button class="action" data-dashboard-jump="ledger">查看</button>`]
      ])}</article>
    </section>
  `;
}

function orders(state) {
  return `<section class="table-panel">${ordersRows(state.orders || [])}</section>`;
}

function ordersRows(orders) {
  return simpleTable("订单列表", ["订单号", "用户", "商品", "支付", "履约", "状态", "金额/积分", "操作"], orders.map((order) => [
    order.id,
    order.userId,
    (order.items || []).map((item) => `${escapeHtml(item.title || item.name || item.productId)} x${item.quantity}`).join("<br>"),
    zh(order.paymentMode, "paymentMode"),
    zh(order.fulfillmentType, "fulfillmentType"),
    `${badge(order.status)} ${badge(order.fulfillmentStatus, "orange")}`,
    paymentText(order),
    orderActionButtons(order)
  ]));
}

function stateMachine(state) {
  return `
    <section class="grid-2">
      <article class="table-panel">${stateMachineNodes(state)}</article>
      <article class="table-panel">${orderDiagnostics(state)}</article>
    </section>
    <section class="table-panel">${simpleTable("订单状态流转", ["时间", "订单", "原状态", "新状态", "原因"], (state.orderStatusLogs || []).slice(0, 20).map((item) => [formatDateTime(item.createdAt), item.orderId || item.id, zh(item.fromStatus), zh(item.toStatus), escapeHtml(item.reason || "-")]))}</section>
    <section class="table-panel">${exceptionLinkageRows(state)}</section>
  `;
}

function stateMachineNodes(state) {
  return simpleTable("状态机节点", ["节点", "含义"], [["pending_payment", "待支付"], ["paid", "已支付"], ["pending_pickup", "待自提"], ["pending_ship", "待发货"], ["shipping", "配送中"], ["delivered", "已送达"], ["refunded", "已退款"], ["closed", "已关闭"]]);
}

function orderDiagnostics(state) {
  const orders = state.orders || [];
  return `${statCards([["待支付", orders.filter((item) => item.status === "pending_payment").length], ["已支付", orders.filter((item) => item.status === "paid").length], ["已关闭", orders.filter((item) => item.status === "closed").length], ["订单总数", orders.length]])}<div class="note">订单诊断会展示支付、履约和关闭边界，方便检查状态机是否完整。</div>`;
}

function exceptionLinkageRows(state) {
  return simpleTable("异常关联", ["异常单", "业务单号", "类型", "状态"], (state.exceptions || []).slice(0, 12).map((item) => [item.id, item.bizNo || "-", item.type || "-", badge(item.status, item.status === "pending" ? "orange" : "")]));
}

function deliveryTeam(state) {
  return `
    <section class="table-panel">${simpleTable("配送员与配送团队", ["团队", "区域", "状态", "操作"], (state.deliveryTeams || []).map((item) => [
      item.name || item.id,
      item.serviceArea || "-",
      badge(item.enabled === false ? "停用" : "启用", item.enabled === false ? "orange" : ""),
      gatedAction("delivery:dispatch", `<button class="action" data-delivery-team-action="${item.id}" data-enabled="${item.enabled === false}">${item.enabled === false ? "启用" : "停用"}</button>`, "无配送权限")
    ]))}</section>
    <section class="panel">${createDeliveryTeamForm()}</section>
  `;
}

function products(state) {
  return `
    ${statCards([["商品数", (state.products || []).length], ["上架", (state.products || []).filter((item) => item.status === "on").length], ["低库存", (state.products || []).filter((item) => Number(item.stock || 0) <= 20).length], ["纯积分", (state.products || []).filter((item) => item.purePointsOnly).length]])}
    <section class="table-panel">${simpleTable("商品上架与销售设置", ["商品", "分类", "价格", "库存", "状态", "操作"], (state.products || []).map((item) => [
      `${escapeHtml(item.name || item.title || item.id)}<br><span class="muted-text">${item.id}</span>`,
      item.category || "-",
      item.purePointsOnly ? `${item.pointsPrice || 0} 积分` : `¥${Number(item.cashPrice || 0).toFixed(1)} / ${item.pointsPrice || 0} 积分`,
      item.stock ?? 0,
      badge(item.status === "on" ? "on" : "off", item.status === "on" ? "" : "orange"),
      productActionButtons(item)
    ]))}</section>
    <section class="panel">${createProductForm()}</section>
  `;
}

function pointsExchange(state) {
  const products = (state.products || []).filter((item) => item.purePointsOnly || Number(item.pointsPrice || 0) > 0);
  return `<section class="table-panel">${simpleTable("纯积分兑换设置", ["商品", "积分价", "库存", "现金入口"], products.map((item) => [item.name || item.id, item.pointsPrice || 0, item.stock ?? 0, item.purePointsOnly ? badge("已关闭现金", "orange") : badge(item.supportsCash ? "开启" : "关闭")]))}</section>`;
}

function homeOps(state) {
  const config = state.config || {};
  return `<section class="panel"><div class="panel-head"><h2>首页运营配置</h2><span>Banner、服务承诺和活动入口</span></div><div class="list">${infoItem("Banner", config.homeBannerTitle || "-")}${infoItem("副标题", config.homeBannerSubtitle || "-")}${infoItem("推荐商品", config.homeBannerProductId || "-")}${infoItem("服务标签", (config.homeServiceBadges || []).join(" / ") || "-")}</div></section>`;
}

function users(state) {
  return `<section class="table-panel">${simpleTable("用户列表", ["用户", "昵称", "积分", "会员", "状态", "操作"], (state.users || []).map((item) => [item.id, item.nickname || "-", item.points || 0, item.memberExpireAt ? `月会员<br>${formatDateTime(item.memberExpireAt)}` : "-", badge(item.status || "active"), userActionButtons(item)]))}</section><section class="note">月会员支持后台续期与权益状态巡检。</section>`;
}

function addressBook(state) {
  return `<section class="table-panel">${simpleTable("用户地址管理", ["用户", "收货人", "电话", "地址", "默认"], (state.addresses || []).map((item) => [item.userId, item.name || item.contactName || "-", item.phone || item.contactPhone || "-", item.address || "-", item.isDefault ? "是" : "否"]))}</section>`;
}

function inviteAudit(state) {
  return `<section class="table-panel">${simpleTable("邀请关系审计", ["邀请人", "被邀请人", "奖励", "时间"], (state.invites || []).map((item) => [item.inviterId || item.fromUserId || "-", item.inviteeId || item.toUserId || "-", item.points || item.rewardPoints || 0, formatDateTime(item.createdAt)]))}</section>`;
}

function customerTickets(state) {
  return `<section class="table-panel">${simpleTable("客服/反馈/合作/招聘工单", ["工单", "用户", "类型", "状态", "内容", "操作"], (state.tickets || []).map((item) => [item.id, item.userId || "-", item.type || "-", badge(item.status || "open", item.status === "open" ? "orange" : ""), item.status === "resolved" ? "已处理完成" : escapeHtml(item.content || item.title || "-"), gatedAction("ticket:write", `<button class="action" data-ticket-action="${item.id}" data-action-type="${item.status === "resolved" ? "closed" : "resolved"}">${item.status === "resolved" ? "关闭" : "标记处理"}</button>`, "无工单权限")]))}</section>`;
}

function agentsPickup(state) {
  return `
    <section class="table-panel">${simpleTable("自提点与代理", ["名称", "地址", "联系人", "状态", "操作"], (state.pickupSites || []).map((item) => [
      item.name || item.id,
      item.address || "-",
      `${item.contactName || "-"}<br>${item.contactPhone || ""}`,
      badge(item.enabled === false ? "停用" : "启用", item.enabled === false ? "orange" : ""),
      gatedAction("pickup_site:write", `<button class="action" data-pickup-action="${item.id}" data-enabled="${item.enabled === false}">${item.enabled === false ? "启用" : "停用"}</button>`, "无自提点权限")
    ]))}</section>
    <section class="panel">${createPickupSiteForm()}</section>
  `;
}

function taskReview(state) {
  return `<section class="table-panel">${simpleTable("任务提交审核", ["提交单", "用户", "任务", "状态", "奖励", "操作"], (state.taskSubmissions || []).map((item) => [item.id, item.userId, item.taskId || item.title || "-", badge(item.status, item.status === "pending_review" ? "orange" : ""), item.rewardPoints || item.points || 0, item.status === "pending_review" ? `${gatedAction("task:review", `<button class="action" data-task-review="${item.id}" data-review-action="approve">通过</button>`, "无审核权限")} ${gatedAction("task:review", `<button class="action danger-action" data-task-review="${item.id}" data-review-action="reject">拒绝</button>`, "无审核权限")}` : "-"]))}</section>`;
}

function signinAds(state) {
  const ads = state.config?.signinAdMaterials || [];
  return `<section class="table-panel">${simpleTable("广告组规则", ["名称", "类型", "位置", "状态"], ads.map((item) => [item.name, item.type, item.position || "-", badge(item.enabled === false ? "停用" : "启用", item.enabled === false ? "orange" : "")]))}</section>`;
}

function financeRefund(state) {
  return `
    ${statCards([["退款申请", (state.refunds || []).length], ["提现申请", (state.withdrawals || []).length], ["待复核", (state.approvalRequests || []).filter((item) => item.status === "pending").length], ["支付流水", (state.ledger?.paymentLedger || []).length]])}
    <section class="grid-2">
      <article class="table-panel">${refundApprovalRows(state)}</article>
      <article class="table-panel">${withdrawalApprovalRows(state)}</article>
    </section>
    <section class="table-panel">${approvalRequestsRows(state)}</section>
  `;
}

function ledger(state) {
  const pointRows = state.ledger?.pointLedger || [];
  const paymentRowsData = state.ledger?.paymentLedger || [];
  return `
    ${paymentToolbar(state)}
    <section class="table-panel">${paymentRows(paymentRowsData)}</section>
    <section class="table-panel">${simpleTable("积分流水", ["流水号", "用户", "类型", "方向", "积分", "余额", "业务单号", "幂等键"], pointRows.map((item) => [
      item.id,
      item.userId,
      zh(item.changeType, "ledgerType"),
      zh(item.direction, "direction"),
      item.points || 0,
      item.balanceAfter ?? "-",
      item.bizNo || "-",
      item.idempotencyKey || "-"
    ]))}</section>
  `;
}

function ranking(state) {
  const ranking = state.ranking || {};
  const rows = ranking.rows || [];
  return `<section class="grid-2"><article class="panel"><div class="panel-head"><h2>月榜规则</h2><span>${ranking.period || "-"}</span></div><div class="list">${infoItem("刷新频率", `每 ${ranking.refreshMinutes || state.config?.rankingRefreshMinutes || 5} 分钟`)}${infoItem("展示范围", `前 ${rows.length || 50} 名`)}</div></article><article class="table-panel">${simpleTable("排行榜", ["排名", "用户", "用户ID", "积分"], rows.map((item) => [item.rank, item.nickname, item.userId, item.score]))}</article></section>`;
}

function monthlyReward(state) {
  const config = state.config || {};
  const overview = state.monthlyPointRewardOverview || {};
  const rows = Array.isArray(overview.rows) ? overview.rows : [];
  const settlements = Array.isArray(overview.settlements) ? overview.settlements : [];
  const rules = Array.isArray(config.monthlyPointRewardRules) ? config.monthlyPointRewardRules : [];
  const approvalRequests = state.approvalRequests || [];
  const filters = state.monthlyRewardFilters || {};
  const monthValue = filters.monthKey || overview.monthKey || "";
  const thresholdOptions = [["all", "全部档位"], ...rules.map((item) => [String(item.threshold), `${item.threshold} 分档`])];
  return `
    ${statCards([["启用状态", config.monthlyPointRewardEnabled !== false ? "开启" : "关闭"], ["规则档位", `${rules.length} 档`], ["达标预览", `${overview.eligibleCount || 0} 人`], ["结算记录", `${settlements.length || overview.settledCount || 0} 条`]])}
    <section class="panel">
      <div class="panel-head"><h2>月度奖励筛选</h2><span>${overview.monthKey || "默认上月"}</span></div>
      <div class="filters">
        <input class="filter-input" type="month" value="${monthValue}" data-monthly-reward-filter data-filter-key="monthKey" data-filter-value="${monthValue}">
        ${thresholdOptions.map(([value, label]) => `<button class="chip ${String(filters.threshold || "all") === value ? "active blue" : ""}" data-monthly-reward-filter data-filter-key="threshold" data-filter-value="${value}">${label}</button>`).join("")}
      </div>
      <div class="filters">
        ${[["all", "全部状态"], ["settled", "已结算"], ["unsettled", "未结算"], ["reversed", "已追回"]].map(([value, label]) => `<button class="chip ${String(filters.settled || "all") === value ? "active orange" : ""}" data-monthly-reward-filter data-filter-key="settled" data-filter-value="${value}">${label}</button>`).join("")}
        ${gatedAction("config:write", `<button class="action" data-monthly-point-reward-settle>手动补跑结算</button>`, "无配置权限")}
      </div>
    </section>
    <section class="grid-2">
      <article class="table-panel">${simpleTable("阶梯规则", ["达标积分", "奖励积分"], rules.map((item) => [item.threshold, item.rewardPoints]))}</article>
      <article class="table-panel">${simpleTable("达标预览", ["用户", "当月入账", "达标档位", "奖励积分", "已结算"], rows.map((item) => [item.nickname || item.userId, item.totalPoints || 0, item.threshold || "-", item.rewardPoints || "-", item.settled ? "是" : "否"]))}</article>
    </section>
    <section class="table-panel">${simpleTable("结算日志", ["结算ID", "用户", "月份", "档位", "奖励", "状态", "结算时间", "操作"], settlements.map((item) => [
      item.id,
      `${item.nickname || item.userId}<br><span class="muted-text">${item.userId}</span>`,
      item.monthKey || "-",
      item.threshold || "-",
      item.rewardPoints || 0,
      item.status === "reversed" ? badge("已追回", "orange") : badge("已结算"),
      formatDateTime(item.createdAt),
      item.status === "reversed"
        ? `<span class="muted-text">${escapeHtml(item.reversalReason || "已追回")}</span>`
        : (approvalRequests.find((request) => request.action === "monthly_reward.reverse" && request.targetId === item.id && request.status === "pending")
          ? badge("复核中", "orange")
          : gatedAction("approval:request", `<button class="action danger-action" data-monthly-point-reward-reverse-request="${item.id}">提交复核</button>`, "无复核权限"))
    ]))}</section>
    <section class="note">月度奖励默认按上月自动结算，追回需要先提交复核，复核通过后执行冲正。</section>
  `;
}

function permissions(state) {
  return `<section class="table-panel">${simpleTable("角色权限矩阵", ["角色", "权限"], (state.roles || []).map((role) => [role.name || role.id, (role.permissions || []).join(" / ")]))}</section>`;
}

function exceptions(state) {
  return `<section class="table-panel">${simpleTable("异常补偿队列", ["异常单", "类型", "业务单号", "状态", "动作", "操作"], (state.exceptions || []).map((item) => [
    item.id,
    item.type || "-",
    item.bizNo || "-",
    badge(item.status === "pending" ? "复核中" : item.status, item.status === "pending" ? "orange" : ""),
    zh(item.action, "action"),
    item.status === "resolved" ? "-" : gatedAction("exception:write", `<button class="action danger-action" data-exception-resolve="${item.id}" data-action="${item.action || "manual_compensation"}">标记补偿</button>`, "无补偿权限")
  ]))}</section>`;
}

function settings(state) {
  const config = state.config || {};
  const rulesJson = JSON.stringify(config.monthlyPointRewardRules || [
    { threshold: 500, rewardPoints: 100 },
    { threshold: 1000, rewardPoints: 300 },
    { threshold: 2000, rewardPoints: 800 },
    { threshold: 3000, rewardPoints: 1500 },
    { threshold: 5000, rewardPoints: 3000 }
  ], null, 2);
  return `
    <section class="panel">
      <div class="panel-head"><h2>会员与支付设置</h2><span>纯积分兑换不允许现金补差</span></div>
      <form class="config-form" data-config-form="points">
        <label class="check"><input name="monthlyPointRewardEnabled" type="checkbox" ${config.monthlyPointRewardEnabled !== false ? "checked" : ""}> 启用月度阶梯奖励</label>
        <label>月结小时<input name="monthlyPointRewardSettlementHour" type="number" min="0" max="23" value="${config.monthlyPointRewardSettlementHour ?? 0}"></label>
        <label>月结分钟<input name="monthlyPointRewardSettlementMinute" type="number" min="0" max="59" value="${config.monthlyPointRewardSettlementMinute ?? 10}"></label>
        <label>邀请奖励<input name="inviteRewardPoints" type="number" value="${config.inviteRewardPoints ?? 0}"></label>
        <label>邀请提成%<input name="inviteCommissionRatePercent" type="number" value="${Math.round(Number(config.inviteCommissionRate || 0) * 100)}"></label>
        <label>签到广告最少<input name="signinAdGroupMin" type="number" value="${config.signinAdGroupMin ?? 0}"></label>
        <label>签到广告最多<input name="signinAdGroupMax" type="number" value="${config.signinAdGroupMax ?? 0}"></label>
        <label>连续签到天数<input name="signinStreakDays" type="number" value="${config.signinStreakDays ?? 7}"></label>
        <label>抽奖每日上限<input name="lotteryDailyLimit" type="number" value="${config.lotteryDailyLimit ?? 1}"></label>
        <label>榜单刷新分钟<input name="rankingRefreshMinutes" type="number" value="${config.rankingRefreshMinutes ?? 5}"></label>
        <label class="wide">连续签到文案<input name="signinStreakRewardText" value="${escapeAttr(config.signinStreakRewardText || "")}"></label>
        <label class="wide">月度奖励规则 JSON<textarea name="monthlyPointRewardRulesJson" rows="7">${escapeHtml(rulesJson)}</textarea></label>
        <button class="action" type="submit">保存积分配置</button>
      </form>
    </section>
  `;
}

function refundApprovalRows(state) {
  return simpleTable("退款审批", ["退款单", "订单", "用户", "现金", "积分", "状态", "操作"], (state.refunds || []).map((item) => [
    item.id,
    item.orderId,
    item.userId,
    `¥${Number(item.refundCashAmount || 0).toFixed(1)}`,
    item.refundPointAmount || 0,
    badge(item.status, item.status === "pending_review" ? "orange" : ""),
    item.status === "pending_review" ? gatedAction("approval:request", `<button class="action danger-action" data-refund-approve="${item.id}">提交复核</button>`, "无提交权限") : "-"
  ]));
}

function withdrawalApprovalRows(state) {
  return simpleTable("提现审批", ["提现单", "用户", "金额", "手续费", "状态", "操作"], (state.withdrawals || []).map((item) => [
    item.id,
    item.userId,
    `¥${Number(item.amount || 0).toFixed(1)}`,
    `¥${Number(item.fee || 0).toFixed(1)}`,
    badge(item.status, item.status === "pending_review" ? "orange" : ""),
    item.status === "pending_review" ? `${gatedAction("approval:request", `<button class="action" data-withdraw-action="${item.id}" data-action-type="approve">提交通过复核</button>`, "无提交权限")} ${gatedAction("approval:request", `<button class="action danger-action" data-withdraw-action="${item.id}" data-action-type="reject">提交驳回复核</button>`, "无提交权限")}` : "-"
  ]));
}

function approvalRequestsRows(state) {
  return simpleTable("二级审批队列", ["审批单", "动作", "目标", "状态", "原因", "操作"], (state.approvalRequests || []).map((item) => [
    item.id,
    zh(item.action, "action"),
    `${item.targetType || "-"}<br><span class="muted-text">${item.targetId || "-"}</span>`,
    badge(item.status === "pending" ? "复核中" : item.status, item.status === "pending" ? "orange" : ""),
    escapeHtml(item.requestReason || item.reason || "-"),
    item.status === "pending" ? `${gatedAction("approval:review", `<button class="action danger-action" data-approval-id="${item.id}" data-approval-action="approve">通过</button>`, "无复核权限")} ${gatedAction("approval:review", `<button class="action" data-approval-id="${item.id}" data-approval-action="reject">驳回</button>`, "无复核权限")}` : "-"
  ]));
}

function paymentToolbar(state) {
  const filters = state.paymentFilters || {};
  return `<section class="panel"><div class="panel-head"><h2>支付筛选与补偿</h2>${gatedAction("exception:write", `<button class="action" data-cancel-payment-timeouts data-timeout-minutes="30">取消超时支付单</button>`, "无异常权限")}</div><div class="filters">${[["pending", "待回调"], ["paid", "已支付"], ["failed", "失败"], ["cancelled", "已取消"]].map(([value, label]) => `<button class="chip ${filters.paymentStatus === value ? "active blue" : ""}" data-payment-filter data-filter-key="paymentStatus" data-filter-value="${value}">${label}</button>`).join("")}${[["goods_cash", "现金购物"], ["member_open", "会员开通"], ["cash_diff", "积分补差"]].map(([value, label]) => `<button class="chip ${filters.payScene === value ? "active orange" : ""}" data-payment-filter data-filter-key="payScene" data-filter-value="${value}">${label}</button>`).join("")}</div>${state.paymentActionMessage ? `<div class="note">${escapeHtml(state.paymentActionMessage)}</div>` : ""}</section>`;
}

function paymentRows(payments) {
  return simpleTable("支付单流水", ["支付单", "用户", "场景", "渠道", "现金", "积分", "状态", "三方单号", "幂等键"], payments.map((item) => [item.payNo || item.id, item.userId || "-", zh(item.payScene, "payScene"), zh(item.channel, "channel"), `¥${Number(item.amount || 0).toFixed(1)}`, item.pointAmount || 0, badge(item.status, item.status === "paid" ? "" : "orange"), item.thirdTradeNo || "-", item.idempotencyKey || "-"]));
}

function simpleTable(title, heads, rows) {
  return `${title ? tableHead(title) : ""}<div class="table-wrap"><table><thead><tr>${heads.map((head) => `<th>${head}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell ?? ""}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${heads.length}">暂无数据</td></tr>`}</tbody></table></div>`;
}

function tableHead(title, action = "") {
  return `<div class="panel-head"><h2>${title}</h2>${action ? `<span>${action}</span>` : ""}</div>`;
}

function statCards(items) {
  return `<section class="stats-grid">${items.map(([label, value]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`).join("")}</section>`;
}

function badge(text, tone = "") {
  return `<span class="status ${tone}">${zh(text)}</span>`;
}

function zh(value, type = "status") {
  if (value == null || value === "") return "-";
  const text = String(value);
  return labelMaps[type]?.[text] || labelMaps.status[text] || labelMaps.action[text] || text;
}

function gatedAction(permission, html, label = "无权限") {
  if (can(permission)) return html;
  return `<button class="action muted-action" disabled title="缺少权限：${permission}">${label}</button>`;
}

function can(permission) {
  const permissions = currentAdminState.identity?.permissions || [];
  if (!permissions.length && currentAdminState.role === "super_admin") return true;
  return permissions.includes("*") || permissions.includes(permission);
}

function permissionDenied(permission) {
  return `<section class="permission-denied"><strong>无权访问当前后台模块</strong><p>当前角色缺少权限：${permission}</p></section>`;
}

function productActionButtons(item) {
  const nextStatus = item.status === "on" ? "off" : "on";
  const stock = Number(item.stock || 0);
  const pointsPrice = Number(item.pointsPrice || 0);
  return `<div class="table-actions">
    ${gatedAction("product:write", `<button class="action" data-product-action="${item.id}" data-status="${nextStatus}">${item.status === "on" ? "下架" : "上架"}</button>`, "无商品权限")}
    ${gatedAction("stock:write", `<button class="action" data-product-action="${item.id}" data-stock="${stock + 10}">补货 +10</button>`, "无库存权限")}
    ${gatedAction("stock:write", `<button class="action" data-product-action="${item.id}" data-stock="0">库存清零</button>`, "无库存权限")}
    ${gatedAction(item.purePointsOnly ? "points_product:write" : "product:write", `<button class="action" data-product-action="${item.id}" data-points-price="${pointsPrice + 10}">积分价 +10</button>`, "无价格权限")}
  </div>`;
}

function orderActionButtons(order) {
  const actions = [];
  if (order.fulfillmentStatus === "pending_pickup") actions.push(gatedAction("order:fulfillment", `<button class="action" data-order-pickup-verify="${order.id}" data-pickup-code="${order.pickupCode || ""}">核销自提</button>`, "无履约权限"));
  if (order.fulfillmentStatus === "pending_ship") actions.push(gatedAction("order:fulfillment", `<button class="action" data-order-ship="${order.id}" data-staff-id="staff_001">分配配送</button>`, "无履约权限"));
  if (order.fulfillmentStatus === "shipping") actions.push(gatedAction("order:fulfillment", `<button class="action" data-order-deliver="${order.id}">确认送达</button>`, "无履约权限"));
  return `<div class="table-actions">${actions.join("") || `<button class="action muted-action" disabled>暂无操作</button>`}</div>`;
}

function userActionButtons(item) {
  return `<div class="table-actions">
    ${gatedAction("approval:request", `<button class="action" data-user-points-adjust="${item.id}" data-user-points="${item.points || 0}">调积分</button>`, "无审批权限")}
    ${gatedAction("customer:read", `<button class="action" data-user-action="${item.id}" data-action-type="extend">续 1 月</button>`, "无用户权限")}
    ${gatedAction("customer:read", `<button class="action" data-user-action="${item.id}" data-action-type="${item.status === "disabled" ? "enable" : "disable"}">${item.status === "disabled" ? "启用" : "禁用"}</button>`, "无用户权限")}
  </div>`;
}

function createProductForm() {
  return `<div class="panel-head"><h2>新增商品</h2><span>商品上架与销售设置</span></div><form class="config-form" data-product-create-form>
    <label>名称<input name="name" required></label>
    <label>分类<input name="category"></label>
    <label>现金价<input name="cashPrice" type="number" step="0.1" value="0"></label>
    <label>积分价<input name="pointsPrice" type="number" value="0"></label>
    <label>库存<input name="stock" type="number" value="0"></label>
    <label>标签<input name="tag"></label>
    <label class="wide">图片<input name="image"></label>
    <label>状态<select name="status"><option value="on">上架</option><option value="off">下架</option></select></label>
    <label class="check"><input name="supportsCash" type="checkbox" checked> 支持现金</label>
    <label class="check"><input name="purePointsOnly" type="checkbox"> 纯积分</label>
    <button class="action" type="submit">新增商品</button>
  </form>`;
}

function createPickupSiteForm() {
  return `<div class="panel-head"><h2>新增自提点</h2></div><form class="config-form" data-pickup-create-form>
    <label>名称<input name="name" required></label>
    <label>地址<input name="address"></label>
    <label>联系人<input name="contactName"></label>
    <label>电话<input name="contactPhone"></label>
    <label class="check"><input name="enabled" type="checkbox" checked> 启用</label>
    <button class="action" type="submit">新增自提点</button>
  </form>`;
}

function createDeliveryTeamForm() {
  return `<div class="panel-head"><h2>新增配送团队</h2></div><form class="config-form" data-delivery-team-create-form>
    <label>名称<input name="name" required></label>
    <label>服务区域<input name="serviceArea"></label>
    <label class="check"><input name="enabled" type="checkbox" checked> 启用</label>
    <button class="action" type="submit">新增团队</button>
  </form>`;
}

function infoItem(label, value) {
  return `<div class="item"><strong>${label}</strong><span>${escapeHtml(value)}</span></div>`;
}

function paymentText(order) {
  if (order.paymentMode === "pure_points") return `${order.pointAmount || 0}积分`;
  if (order.paymentMode === "points_plus_cash") return `¥${Number(order.cashAmount || 0).toFixed(1)} + ${order.pointAmount || 0}积分`;
  return `¥${Number(order.cashAmount || 0).toFixed(1)}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
