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
  permissions: "role:read",
  exceptions: "exception:read",
  settings: "config:read"
};

const titles = {
  dashboard: ["运营仪表盘", "订单、商品、积分、权限和异常补偿的开发版控制台"],
  orders: ["订单管理", "查询、筛选和跟踪自提/配送订单"],
  stateMachine: ["订单状态机", "支付、扣分、履约、退款、关闭的边界"],
  deliveryTeam: ["自建配送团队", "TGG 自建配送队，不接入第三方物流"],
  products: ["商品与分类管理", "现金商品、积分商品、库存和上下架"],
  pointsExchange: ["纯积分兑换管理", "无需会员，无现金补差入口"],
  homeOps: ["首页运营配置", "Banner、推荐入口、服务承诺和首页标签"],
  users: ["用户/会员管理", "普通用户与月会员权益边界"],
  addressBook: ["用户地址管理", "配送地址、默认地址和服务范围审计"],
  inviteAudit: ["邀请关系审计", "邀请绑定、提成积分和用户关系追踪"],
  customerTickets: ["客服工单", "客服、反馈、商务合作和招聘咨询处理"],
  agentsPickup: ["代理与自提点", "自提点启用/隐藏，核销码自提"],
  taskReview: ["悬赏任务审核", "任务提交审核与积分入账"],
  signinAds: ["签到广告配置", "连续签到奖励与广告组配置"],
  financeRefund: ["支付 / 积分 / 可提现流水", "财务审批退款和提现"],
  ledger: ["账务流水", "现金、积分、幂等键和业务单号"],
  ranking: ["积分排行榜配置", "排行榜刷新与展示配置"],
  permissions: ["后台角色权限", "财务、订单、商品、客服权限隔离"],
  exceptions: ["异常补偿中心", "支付、积分、回调、配送、退款异常处理"],
  settings: ["系统设置", "会员、配送、自提、积分和回调配置"]
};

const labelMaps = {
  status: {
    pending: "待处理",
    pending_payment: "待支付",
    pending_review: "待审核",
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
    pending_ship: "待发货",
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
    manual_adjust: "人工调整"
    ,
    lottery: "抽奖奖励"
  },
  direction: {
    in: "收入",
    out: "支出"
  },
  role: {
    super_admin: "超级管理员",
    product_admin: "商品管理员",
    order_admin: "订单管理员",
    finance_admin: "财务管理员",
    customer_service: "客服",
    delivery_dispatcher: "配送调度",
    agent_admin: "代理管理员",
    audit_ops: "审核运维"
  },
  permission: {
    all: "全部权限",
    product_read: "查看商品",
    product_write: "编辑商品",
    stock_write: "调整库存",
    points_product_write: "管理纯积分商品",
    order_read: "查看订单",
    order_fulfillment_write: "更新履约",
    finance_ledger_read: "查看财务流水",
    refund_approve: "审批退款",
    withdraw_approve: "审批提现",
    exception_read: "查看异常",
    exception_resolve: "处理异常",
    user_read: "查看用户",
    customer_note_write: "客服备注",
    "ticket:write": "处理客服工单",
    "customer:read": "查看用户",
    "delivery:dispatch": "配送调度",
    "pickup_site:write": "管理自提点",
    delivery_team_write: "管理配送团队",
    pickup_site_write: "管理自提点",
    task_review: "任务审核",
    config_write: "系统配置",
    operation_log_read: "查看操作日志",
    approval_request: "提交审批",
    approval_review: "复核审批"
  },
  exceptionType: {
    payment_callback_failed: "支付回调失败",
    payment_timeout_cancelled: "支付超时取消",
    point_deduct_failed: "积分扣减失败",
    point_rollback_failed: "积分回滚失败",
    refund_missing_linked_data: "退款关联数据缺失",
    task_callback_missing_submission: "任务回调缺少提交单",
    delivery_exception: "配送异常",
    delivery_timeout: "配送超时",
    delivery_staff_missing: "未指定配送员",
    delivery_staff_unavailable: "配送员不可用",
    delivery_team_unavailable: "配送团队不可用",
    inventory_shortage: "库存不足"
  },
  action: {
    retry_payment_callback: "重放支付回调",
    cancel_payment: "取消支付单",
    rollback_points: "回滚积分",
    manual_compensation: "人工补偿",
    review_refund_manually: "人工审核退款",
    retry_task_callback: "重试任务回调",
    contact_customer: "联系客服",
    approve: "通过",
    reject: "驳回",
    update_config: "更新配置",
    update_product: "更新商品",
    update_stock: "调整库存",
    "user.update": "更新用户",
    "ticket.update": "处理工单",
    "pickup_site.create": "新增自提点",
    "pickup_site.update": "更新自提点",
    "delivery_team.create": "新增配送团队",
    "delivery_team.update": "更新配送团队",
    approve_withdrawal: "提现通过",
    reject_withdrawal: "提现驳回",
    "config.update": "更新系统设置",
    "product.update": "更新商品",
    "withdraw.approve": "提现通过",
    "withdraw.reject": "提现驳回",
    "withdrawal.approve": "提现通过",
    "withdrawal.reject": "提现驳回",
    "refund.approve": "退款审批通过",
    "points.adjust": "手工积分调整",
    "order.pickup_verify": "核销自提码",
    "order.ship": "配送发货",
    "order.deliver": "确认送达",
    "exception.resolve": "异常补偿完成",
    "payment.cancel_timeouts": "取消超时支付"
    ,
    "approval.request": "提交复核申请",
    "approval.execute": "复核通过并执行",
    "approval.reject": "复核驳回",
    "approval.failed": "复核执行失败"
  },
  targetType: {
    config: "系统配置",
    product: "商品",
    order: "订单",
    refund: "退款单",
    withdrawal: "提现单",
    task_submission: "任务提交",
    exception: "异常单",
    payment: "支付单",
    approval: "审批单",
    withdrawal: "提现单"
    ,
    user: "用户",
    ticket: "工单",
    pickup_site: "自提点",
    delivery_team: "配送团队"
  }
};

function zh(value, type = "status") {
  if (value == null || value === "") return "-";
  const text = String(value);
  return labelMaps[type]?.[text] || labelMaps.status[text] || labelMaps.action[text] || text;
}

function zhReason(value) {
  if (!value) return "-";
  return String(value)
    .replaceAll("mock_pay", "模拟支付")
    .replaceAll("mock_refund", "模拟退款")
    .replaceAll("pending_payment", "待支付")
    .replaceAll("pending_pickup", "待自提")
    .replaceAll("pending_ship", "待发货")
    .replaceAll("not_started", "未开始")
    .replaceAll("goods_cash", "现金购物")
    .replaceAll("member_open", "会员开通")
    .replaceAll("cash_diff", "积分补差")
    .replaceAll("pure_points", "纯积分兑换")
    .replaceAll("points_plus_cash", "积分+现金补差");
}

function ticketTypeLabel(type) {
  return ({ customer_service: "在线客服", feedback: "意见反馈", business: "商务合作", recruiting: "招聘咨询" })[type] || type || "-";
}

function ticketStatusLabel(status) {
  return ({ open: "待处理", processing: "处理中", resolved: "已处理", closed: "已关闭" })[status] || status || "-";
}

function zhPermissions(permissions = []) {
  return permissions.map((permission) => zh(permission, "permission")).join(" / ");
}

function ticketPriorityLabel(priority) {
  return ({ low: "低", normal: "普通", high: "高", urgent: "紧急" })[priority] || priority || "普通";
}

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
  document.querySelector(selector).innerHTML = `<div class="empty">${message}</div>`;
}

function dashboard(state) {
  return `
    ${stats(state)}
    <section class="grid-2">
      <article class="panel">
        <div class="panel-head"><h2>订单趋势</h2><span>近 7 日</span></div>
        <div class="mini-chart">${lineChart([36, 58, 44, 72, 64, 88, 80])}</div>
      </article>
      <article class="panel">
        <div class="panel-head"><h2>待办事项</h2><span>实时</span></div>
        <div class="list">
          <div class="item"><strong>待自提核销</strong><span>${state.orders.filter((item) => item.fulfillmentStatus === "pending_pickup").length} 单</span></div>
          <div class="item"><strong>待发货配送</strong><span>${state.orders.filter((item) => item.fulfillmentStatus === "pending_ship").length} 单</span></div>
          <div class="item"><strong>异常补偿</strong><span>${state.exceptions.length} 条</span></div>
        </div>
      </article>
    </section>
    <section class="table-panel">${tableHead("最近订单")}${ordersRows(state.orders.slice(0, 6))}</section>
  `;
}

function stateMachine(state) {
  return `
    <section class="panel">
      <div class="panel-head"><h2>订单状态流转</h2><span>开发版状态机</span></div>
      <div class="flow state-flow">${stateMachineNodes(state)}</div>
    </section>
    <section class="grid-2">
      <article class="table-panel">${orderDiagnostics(state)}</article>
      <article class="table-panel">${exceptionLinkageRows(state)}</article>
    </section>
    <section class="table-panel">${simpleTable("状态变更日志", ["订单", "前状态", "后状态", "履约前", "履约后", "原因"], state.orderStatusLogs.slice(0, 8).map((item) => [item.orderId, zh(item.fromStatus), zh(item.toStatus), zh(item.fromFulfillmentStatus), zh(item.toFulfillmentStatus), zhReason(item.reason)]))}</section>
    <section class="note">纯积分订单提交成功即扣减积分并进入履约；现金购物和积分不足现金补差均要求用户已开通月会员。</section>
  `;
}

function deliveryTeam(state) {
  const staffRows = state.deliveryTeams.flatMap((team) => (team.staff || []).map((staff) => [staff.name, staff.phone, badge(staff.enabled ? "启用" : "停用", staff.enabled ? "" : "orange"), team.name]));
  const teamRows = state.deliveryTeams.map((team) => [
    team.name,
    team.serviceArea || "-",
    badge(team.enabled ? "启用" : "停用", team.enabled ? "" : "orange"),
    `<button class="action" data-delivery-team-action="${team.id}" data-enabled="${team.enabled ? "false" : "true"}">${team.enabled ? "停用" : "启用"}</button>`
  ]);
  return `
    ${statCards([["配送团队", state.deliveryTeams.length], ["配送员", staffRows.length], ["覆盖区域", state.deliveryTeams[0]?.serviceArea || "5km"], ["准时率", "98.4%"]])}
    <section class="grid-2">
      <article class="table-panel">${simpleTable("配送员", ["姓名", "电话", "状态", "团队"], staffRows)}</article>
      <article class="table-panel">${simpleTable("团队维护", ["团队", "服务范围", "状态", "操作"], teamRows)}</article>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>新增配送团队</h2><span>自建团队</span></div>
      <form class="admin-form product-create-form" data-delivery-team-create-form>
        <div class="product-create-grid">
          <label>团队名称<input name="name" required placeholder="例如：南区配送队"></label>
          <label>服务范围<input name="serviceArea" value="师大周边 5km"></label>
          <label class="check"><input name="enabled" type="checkbox" checked> 启用</label>
        </div>
        <div class="settings-actions"><p>配送团队为平台自建，不接入第三方物流。</p><button class="action" type="submit">新增团队</button></div>
      </form>
    </section>
  `;
}

function products(state) {
  const products = state.products || [];
  const onCount = products.filter((item) => item.status === "on").length;
  const offCount = products.filter((item) => item.status === "off").length;
  const purePointsCount = products.filter((item) => item.purePointsOnly).length;
  const lowStockCount = products.filter((item) => Number(item.stock || 0) <= 20).length;
  return `
    ${statCards([["商品总数", products.length], ["已上架", onCount], ["已下架", offCount], ["低库存/纯积分", `${lowStockCount}/${purePointsCount}`]])}
    <section class="panel product-toolbar product-list-toolbar">
      <div class="panel-head"><h2>商品上架与销售设置</h2><span>商品/库存权限独立于财务权限</span></div>
      <div class="filters"><span class="chip active">全部商品</span><span class="chip blue">现金+积分商品</span><span class="chip orange">纯积分兑换</span><span class="chip red">低库存</span></div>
    </section>
    <section class="table-panel product-list-panel">${productsRows(products, "商品上下架与价格库存设置")}</section>
    <section class="table-panel">${inventoryRows(state.inventoryLedger || [])}</section>
    <section class="panel product-toolbar">
      <div class="panel-head"><h2>商品规则</h2><span>前后台销售边界</span></div>
      <div class="product-rules">
        <div class="item"><strong>上架/下架</strong><span>下架后前端不应展示购买入口，后台保留库存和价格配置。</span></div>
        <div class="item"><strong>会员现金购</strong><span>现金购买和积分不足现金补差仅限月会员；普通用户仅可走纯积分兑换。</span></div>
        <div class="item"><strong>纯积分商品</strong><span>现金价格强制为空，关闭现金补差入口，积分不足时只提示积分不足。</span></div>
      </div>
    </section>
    <section class="panel product-create-panel">
      <div class="panel-head"><h2>新增商品并上架</h2><span>创建后可直接在前端展示</span></div>
      <form class="admin-form product-create-form" data-product-create-form>
        <div class="product-create-grid">
          <label>商品名称<input name="name" required placeholder="例如：云南蓝莓 125g"></label>
          <label>分类<input name="category" value="水果" placeholder="水果 / 蔬菜 / 纯积分"></label>
          <label>现金价<input name="cashPrice" type="number" step="0.1" min="0" value="9.9"></label>
          <label>积分价<input name="pointsPrice" type="number" min="0" value="199"></label>
          <label>库存<input name="stock" type="number" min="0" value="100"></label>
          <label>标签<input name="tag" value="新品"></label>
          <label class="wide">商品图片<input name="image" value="/assets/apple.jpg" placeholder="/assets/apple.jpg 或网图 URL"></label>
          <label>初始状态<select name="status"><option value="on">创建后立即上架</option><option value="off">先保存为下架</option></select></label>
          <label class="check"><input name="supportsCash" type="checkbox" checked> 支持会员现金购</label>
          <label class="check"><input name="purePointsOnly" type="checkbox"> 纯积分商品</label>
        </div>
        <div class="settings-actions product-create-actions">
          <p>纯积分商品会自动关闭现金价和现金补差；普通用户不可现金购物。</p>
          <button class="action" type="submit">创建商品</button>
        </div>
      </form>
    </section>
  `;
}

function pointsExchange(state) {
  const products = state.products.filter((item) => item.purePointsOnly);
  return `
    ${statCards([["兑换商品", products.length], ["兑换订单", state.orders.filter((item) => item.paymentMode === "pure_points").length], ["现金入口", "关闭"], ["补差规则", "禁止"]])}
    <section class="panel product-toolbar">
      <div class="panel-head"><h2>纯积分兑换设置</h2><span>现金能力关闭</span></div>
      <div class="product-rules">
        <div class="item"><strong>兑换入口</strong><span>仅展示纯积分商品，普通用户和会员均可兑换。</span></div>
        <div class="item"><strong>补差规则</strong><span>纯积分商品不允许现金补差，不产生现金支付单。</span></div>
      </div>
    </section>
    <section class="table-panel">${productsRows(products, "纯积分商品设置")}</section>
  `;
}

function homeOps(state) {
  const config = state.config || {};
  const promise = config.homeDeliveryPromise || {};
  const promotions = config.homePromotionEntries || [];
  const badges = config.homeServiceBadges || [];
  return `
    ${statCards([["首页服务标签", badges.length], ["活动入口", promotions.length], ["推荐商品", state.products.filter((item) => item.status === "on").length], ["Banner 商品", config.homeBannerProductId || "p_strawberry"]])}
    <section class="grid-2">
      <article class="panel">
        <div class="panel-head"><h2>首页 Banner</h2><span>用户首页首屏</span></div>
        <div class="list">
          <div class="item"><strong>${config.homeBannerTitle || "时令鲜果季"}</strong><span>${config.homeBannerSubtitle || "新鲜到站，会员现金购物更优惠"}</span></div>
          <div class="item"><strong>关联商品</strong><span>${config.homeBannerProductId || "p_strawberry"}</span></div>
        </div>
      </article>
      <article class="panel">
        <div class="panel-head"><h2>履约承诺</h2><span>首页服务条</span></div>
        <div class="list">
          <div class="item"><strong>${promise.title || "最快 30 分钟送达"}</strong><span>${promise.subtitle || "TGG 自建配送队"}</span></div>
          <div class="item"><strong>${promise.cutoffText || "今日可送"}</strong><span>${promise.serviceAreaText || "服务范围内"}</span></div>
        </div>
      </article>
    </section>
    <section class="grid-2">
      <article class="table-panel">${simpleTable("服务标签", ["标签"], badges.map((item) => [item]))}</article>
      <article class="table-panel">${simpleTable("活动入口", ["标题", "文案", "页面", "颜色"], promotions.map((item) => [item.title, item.text, item.page, item.tone]))}</article>
    </section>
    <section class="note">编辑入口在系统设置底部“首页运营配置”，保存后用户端 /api/home 会实时读取。</section>
  `;
}

function users(state) {
  const users = state.users || [];
  const rows = users.map((user) => [
    `${user.nickname}<br><span class="muted-text">${user.id} / ${user.phone || "-"}</span>`,
    badge(user.isMember ? "月会员" : "普通", user.isMember ? "" : "orange"),
    user.memberUntil ? formatDateTime(user.memberUntil) : "-",
    `${user.points || 0}`,
    `¥${Number(user.withdrawableBalance || 0).toFixed(1)}`,
    badge(user.status === "disabled" ? "已禁用" : "正常", user.status === "disabled" ? "red" : ""),
    `${pendingApprovalFor(state, "points.adjust", user.id) ? badge("积分复核中", "orange") : gatedAction("approval:request", `<button class="action" data-user-points-adjust="${user.id}" data-user-points="${Number(user.points || 0)}">积分调整申请</button>`, "无提交权限")} <button class="action" data-user-action="${user.id}" data-action-type="extend">续 1 月</button> <button class="action" data-user-action="${user.id}" data-action-type="${user.status === "disabled" ? "enable" : "disable"}">${user.status === "disabled" ? "启用" : "禁用"}</button> <button class="action" data-user-action="${user.id}" data-action-type="clearMember">转普通</button>`
  ]);
  return `
    ${statCards([["用户数", users.length], ["会员用户", users.filter((item) => item.isMember).length], ["普通用户", users.filter((item) => !item.isMember).length], ["禁用用户", users.filter((item) => item.status === "disabled").length]])}
    <section class="table-panel">${simpleTable("用户列表", ["用户", "身份", "会员到期", "积分", "余额", "状态", "操作"], rows)}</section>
  `;
}

function addressBook(state) {
  const addresses = state.addresses || [];
  const rows = addresses.map((item) => [
    `${item.receiverName || "-"}<br><span class="muted-text">${item.userName || item.userId}</span>`,
    item.mobile || "-",
    [item.province, item.city, item.district, item.detail].filter(Boolean).join(" "),
    item.inServiceRange === false ? badge("超出范围", "orange") : badge("服务范围内"),
    item.isDefault ? badge("默认地址", "blue") : "-",
    formatDateTime(item.updatedAt || item.createdAt)
  ]);
  return `
    ${statCards([["地址总数", addresses.length], ["默认地址", addresses.filter((item) => item.isDefault).length], ["服务范围内", addresses.filter((item) => item.inServiceRange !== false).length], ["超出范围", addresses.filter((item) => item.inServiceRange === false).length]])}
    <section class="table-panel">${simpleTable("用户收货地址", ["收货人", "手机号", "地址", "范围", "默认", "更新时间"], rows)}</section>
    <section class="note">用户地址由用户端新增和维护；后台用于客服核对配送范围、订单异常和售后联系。</section>
  `;
}

function inviteAudit(state) {
  const invites = state.invites || [];
  const rows = invites.map((item) => [
    `${item.inviterName || item.inviterUserId}<br><span class="muted-text">${item.inviterUserId} / ${item.inviterCode || "-"}</span>`,
    `${item.inviteeName || item.inviteeUserId}<br><span class="muted-text">${item.inviteeUserId}</span>`,
    badge(item.inviteeStatus || "active", item.inviteeStatus === "disabled" ? "orange" : ""),
    `${item.commissionPoints || 0} 积分`,
    item.commissionCount || 0,
    formatDateTime(item.boundAt)
  ]);
  return `
    ${statCards([["邀请关系", invites.length], ["有提成关系", invites.filter((item) => Number(item.commissionPoints || 0) > 0).length], ["累计提成", invites.reduce((sum, item) => sum + Number(item.commissionPoints || 0), 0)], ["提成比例", `${Math.round(Number(state.config?.inviteCommissionRate || 0) * 100)}%`]])}
    <section class="table-panel">${simpleTable("邀请绑定审计", ["邀请人", "被邀请人", "用户状态", "累计提成", "提成次数", "绑定时间"], rows)}</section>
    <section class="note">邀请奖励和任务提成比例在系统设置中配置；此处用于运营核对关系绑定与提成积分流水。</section>
  `;
}

function customerTickets(state) {
  const rows = (state.tickets || []).map((item) => [
    `${ticketTypeLabel(item.type)}<br><span class="muted-text">${item.id}</span>`,
    `${item.userName || item.userId || "-"}<br><span class="muted-text">${item.contactName || "-"} / ${item.contactPhone || "-"}</span>`,
    `${item.linkedType ? zh(item.linkedType, "targetType") : "-"}<br><span class="muted-text">${item.linkedId || "-"}</span>`,
    `<strong>${item.subject}</strong><br><span class="muted-text">${escapeHtml(item.content)}</span>`,
    badge(ticketPriorityLabel(item.priority), ["high", "urgent"].includes(item.priority) ? "orange" : ""),
    badge(ticketStatusLabel(item.status), item.status === "open" ? "orange" : item.status === "resolved" ? "" : "blue"),
    item.adminReply || "-",
    item.status === "resolved"
      ? "已处理"
      : `<button class="action" data-ticket-action="${item.id}" data-action-type="processing">受理</button> <button class="action" data-ticket-action="${item.id}" data-action-type="resolved">处理完成</button>`
  ]);
  return `
    ${statCards([["工单总数", state.tickets.length], ["待处理", state.tickets.filter((item) => item.status === "open").length], ["处理中", state.tickets.filter((item) => item.status === "processing").length], ["已处理", state.tickets.filter((item) => item.status === "resolved").length]])}
    <section class="table-panel">${simpleTable("客服/反馈/合作/招聘工单", ["类型", "用户/联系", "关联", "内容", "优先级", "状态", "回复", "操作"], rows)}</section>
  `;
}

function agentsPickup(state) {
  const rows = state.pickupSites.map((site) => [
    site.contactName || "-",
    site.name,
    site.address,
    site.contactPhone || "-",
    badge(site.enabled ? "启用" : "隐藏", site.enabled ? "" : "orange"),
    `<button class="action" data-pickup-action="${site.id}" data-enabled="${site.enabled ? "false" : "true"}">${site.enabled ? "隐藏" : "启用"}</button>`
  ]);
  return `
    <section class="grid-2">
      <article class="table-panel">${simpleTable("自提点与代理", ["代理", "自提点", "地址", "电话", "状态", "操作"], rows)}</article>
      <article class="panel"><div class="panel-head"><h2>核销规则</h2><span>自提点</span></div><div class="item"><strong>只做核销码验证</strong><span>自提点可由后台启用或隐藏，不承担第三方物流能力。</span></div></article>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>新增自提点</h2><span>代理核销</span></div>
      <form class="admin-form product-create-form" data-pickup-create-form>
        <div class="product-create-grid">
          <label>自提点名称<input name="name" required placeholder="例如：南区自提站"></label>
          <label class="wide">地址<input name="address" required placeholder="详细地址"></label>
          <label>代理姓名<input name="contactName" value="站点代理"></label>
          <label>联系电话<input name="contactPhone" value="13800001111"></label>
          <label class="check"><input name="enabled" type="checkbox" checked> 启用</label>
        </div>
        <div class="settings-actions"><p>自提点仅用于核销码验证，可与配送团队同队运营。</p><button class="action" type="submit">新增自提点</button></div>
      </form>
    </section>
  `;
}

function taskReview(state) {
  const rows = state.taskSubmissions.map((item) => [
    item.id,
    item.userName || item.userId,
    `${item.taskTitle || item.taskId} / ${item.rewardPoints || 0}积分`,
    badge(item.status, item.status === "reviewing" ? "orange" : ""),
    item.status === "reviewing"
      ? `<button class="action" data-task-review="${item.id}" data-review-action="approve">通过</button> <button class="action" data-task-review="${item.id}" data-review-action="reject">拒绝</button>`
      : "已处理"
  ]);
  return `
    ${statCards([["待审核", state.taskSubmissions.filter((item) => item.status === "reviewing").length], ["已通过", state.taskSubmissions.filter((item) => item.status === "approved").length], ["已拒绝", state.taskSubmissions.filter((item) => item.status === "rejected").length], ["异常", state.exceptions.length]])}
    <section class="table-panel">${simpleTable("任务提交审核", ["提交单", "用户", "任务", "状态", "操作"], rows)}</section>
  `;
}

function signinAds(state) {
  const config = state.config || {};
  const materials = config.signinAdMaterials || [];
  return `
    <section class="grid-2">
      <article class="panel"><div class="panel-head"><h2>广告组规则</h2><span>签到</span></div><div class="list"><div class="item"><strong>每日广告组数</strong><span>${config.signinAdGroupMin ?? 1} - ${config.signinAdGroupMax ?? 3} 组</span></div><div class="item"><strong>连续奖励</strong><span>${config.signinStreakRewardText || "签满 30 天送 100 积分"}</span></div><div class="item"><strong>每日抽奖上限</strong><span>${config.lotteryDailyLimit ?? 1} 次</span></div></div></article>
      <article class="panel"><div class="panel-head"><h2>奖品概率</h2><span>抽奖</span></div><div class="list">${(config.lotteryPrizes || []).map((item) => `<div class="item"><strong>${item.label}</strong><span>权重 ${item.weight}</span></div>`).join("")}</div></article>
    </section>
    <section class="table-panel">${simpleTable("签到广告素材", ["素材", "类型", "位置", "状态"], materials.map((item) => [item.name, item.type, item.position || "-", item.enabled ? badge("启用") : badge("停用", "orange")]))}</section>
    <section class="note">签到和排行榜参数在系统设置中统一保存，前端签到页实时读取这些配置。</section>
  `;
}

function ledger(state) {
  const rows = state.ledger.pointLedger.map((item) => [item.id, item.userId, zh(item.changeType, "ledgerType"), `${zh(item.direction, "direction")} ${item.points}`, item.bizNo, item.idempotencyKey]);
  return `${paymentToolbar(state)}<section class="table-panel">${paymentRows(state.ledger.paymentLedger || [])}</section><section class="table-panel">${simpleTable("积分流水", ["流水号", "用户", "类型", "变动", "业务单号", "幂等键"], rows)}</section><section class="note">支付、退款、积分、提现、任务回调和异常补偿都需要保留幂等键。</section>`;
}

function ranking(state) {
  const ranking = state.ranking || {};
  const rows = (ranking.rows || []).map((item) => [item.rank, item.nickname, item.userId, item.score]);
  return `<section class="grid-2"><article class="panel"><div class="panel-head"><h2>月榜规则</h2><span>${ranking.period || "-"}</span></div><div class="list"><div class="item"><strong>刷新频率</strong><span>每 ${ranking.refreshMinutes || state.config?.rankingRefreshMinutes || 5} 分钟</span></div><div class="item"><strong>展示范围</strong><span>前 ${rows.length || 50} 名</span></div></div></article><article class="table-panel">${simpleTable("排行榜", ["排名", "用户", "用户ID", "积分"], rows)}</article></section>`;
}

function permissions(state) {
  return `<section class="table-panel">${simpleTable("角色权限矩阵", ["角色", "权限"], state.roles.map((role) => [zh(role.id || role.name, "role"), zhPermissions(role.permissions)]))}</section><section class="note">客服不可直接退款、提现或手动改积分；订单管理员不可直接修改支付金额和用户余额。</section>`;
}

function settings(state) {
  const config = state.config || {};
  const homeServiceBadges = Array.isArray(config.homeServiceBadges) ? config.homeServiceBadges.join("，") : "自建配送，坏果包赔，低价会员购";
  const promotions = config.homePromotionEntries || [];
  const adMaterials = config.signinAdMaterials || [];
  const promise = config.homeDeliveryPromise || {};
  const deliveryTimeSlots = Array.isArray(config.deliveryTimeSlots) ? config.deliveryTimeSlots.join("，") : "09:00-12:00，14:00-18:00，18:00-21:00";
  const commissionPercent = Math.round(Number(config.inviteCommissionRate ?? 0.1) * 100);
  const withdrawFeePercent = Math.round(Number(config.withdrawFeeRate ?? 0.01) * 1000) / 10;
  return `
    ${statCards([
      ["月会员价格", `¥${Number(config.membershipMonthlyPrice || 19.9).toFixed(1)}`],
      ["配送费", config.deliveryFeeEnabled ? `¥${Number(config.deliveryFee || 0).toFixed(1)}` : "关闭"],
      ["支付超时", `${Number(config.paymentTimeoutMinutes || 30)} 分钟`],
      ["纯积分补差", "禁止"]
    ])}
    <section class="grid-2 settings-overview">
      <article class="panel">
        <div class="panel-head"><h2>基础配置</h2><span>下单与权益</span></div>
        <div class="setting-lines">
          <div><span>站点自提开关</span><strong>${config.pickupEnabled ? "开启" : "关闭"}</strong></div>
          <div><span>送货上门服务</span><strong>${config.deliveryEnabled ? "开启" : "关闭"}</strong></div>
          <div><span>截单时间</span><strong>每日 ${String(config.deliveryCutoffHour ?? 5).padStart(2, "0")}:00</strong></div>
          <div><span>每日购买上限</span><strong>500 元/账号</strong></div>
          <div><span>会员价格</span><strong>月卡费用后台配置</strong></div>
          <div><span>提现手续费</span><strong>${Number(config.withdrawFeeRate ?? 0.01) * 100}%</strong></div>
        </div>
      </article>
      <article class="panel">
        <div class="panel-head"><h2>接口与日志</h2><span>审计与回调</span></div>
        <div class="setting-lines">
          <div><span>悬赏平台 appid/sign</span><strong class="ok-text">已配置</strong></div>
          <div><span>回调接收地址</span><strong class="ok-text">/api/task/callback</strong></div>
          <div><span>接口请求日志</span><strong>保留 90 天</strong></div>
          <div><span>积分发放日志</span><strong>幂等校验</strong></div>
        </div>
      </article>
    </section>
    <section class="settings-form">
      <section class="grid-2 settings-edit-grid">
        <article class="panel settings-card">
          <div class="panel-head"><h2>会员与支付设置</h2><span>现金能力边界</span></div>
          <form class="admin-form" data-config-form="member">
            <div class="settings-grid">
            <label>月会员价格（元）<input name="membershipMonthlyPrice" type="number" step="0.1" min="0" value="${config.membershipMonthlyPrice ?? 19.9}"></label>
            <label>待支付保留时间（分钟）<input name="paymentTimeoutMinutes" type="number" min="1" value="${config.paymentTimeoutMinutes ?? 30}"></label>
            <label class="check"><input type="checkbox" checked disabled> 现金购物必须开通月会员</label>
            <label class="check"><input type="checkbox" checked disabled> 纯积分兑换不允许现金补差</label>
            </div>
            <div class="settings-actions compact"><p>影响会员开通、现金订单和支付超时关闭。</p><button class="action" type="submit">保存会员支付</button></div>
          </form>
        </article>
        <article class="panel settings-card">
          <div class="panel-head"><h2>自提与配送设置</h2><span>自建履约团队</span></div>
          <form class="admin-form" data-config-form="delivery">
            <div class="settings-grid">
            <label class="check"><input name="pickupEnabled" type="checkbox" ${config.pickupEnabled ? "checked" : ""}> 开启自提点</label>
            <label class="check"><input name="deliveryEnabled" type="checkbox" ${config.deliveryEnabled ? "checked" : ""}> 开启送货上门</label>
            <label class="check"><input name="deliveryFeeEnabled" type="checkbox" ${config.deliveryFeeEnabled ? "checked" : ""}> 启用配送费</label>
            <label>配送费（元）<input name="deliveryFee" type="number" step="0.1" min="0" value="${config.deliveryFee ?? 0}"></label>
            <label>每日截单时间（0-23点）<input name="deliveryCutoffHour" type="number" min="0" max="23" value="${config.deliveryCutoffHour ?? 5}"></label>
            <label>可选配送时段<input name="deliveryTimeSlots" value="${deliveryTimeSlots}"></label>
            </div>
            <div class="settings-actions compact"><p>配送由自建团队承接，不对接第三方物流。</p><button class="action" type="submit">保存履约配送</button></div>
          </form>
        </article>
      </section>
      <section class="grid-2 settings-edit-grid">
        <article class="panel settings-card">
          <div class="panel-head"><h2>积分与任务设置</h2><span>签到、邀请、排行榜</span></div>
          <form class="admin-form" data-config-form="points">
            <div class="settings-grid">
            <label>邀请成功奖励（积分）<input name="inviteRewardPoints" type="number" min="0" value="${config.inviteRewardPoints ?? 3}"></label>
            <label>任务提成比例（%）<input name="inviteCommissionRatePercent" type="number" step="0.1" min="0" max="100" value="${commissionPercent}"></label>
            <label>签到广告组下限<input name="signinAdGroupMin" type="number" min="0" value="${config.signinAdGroupMin ?? 1}"></label>
            <label>签到广告组上限<input name="signinAdGroupMax" type="number" min="0" value="${config.signinAdGroupMax ?? 3}"></label>
            <label>连续签到天数<input name="signinStreakDays" type="number" min="1" value="${config.signinStreakDays ?? 30}"></label>
            <label>抽奖每日上限<input name="lotteryDailyLimit" type="number" min="0" value="${config.lotteryDailyLimit ?? 1}"></label>
            <label>排行榜刷新分钟<input name="rankingRefreshMinutes" type="number" min="1" value="${config.rankingRefreshMinutes ?? 5}"></label>
            <label>连续签到奖励文案<input name="signinStreakRewardText" value="${config.signinStreakRewardText || "签满 30 天送 100 积分"}"></label>
            </div>
            <div class="settings-actions compact"><p>列表页仍不提前展示精确任务奖励，审核通过后才入账。</p><button class="action" type="submit">保存积分任务</button></div>
          </form>
        </article>
        <article class="panel settings-card">
          <div class="panel-head"><h2>财务与展示设置</h2><span>提现、广告、审计</span></div>
          <form class="admin-form" data-config-form="finance">
            <div class="settings-grid">
            <label>最低提现金额（元）<input name="withdrawMinAmount" type="number" step="0.1" min="0" value="${config.withdrawMinAmount ?? 1}"></label>
            <label>提现手续费（%）<input name="withdrawFeeRatePercent" type="number" step="0.1" min="0" max="100" value="${withdrawFeePercent}"></label>
            <label class="check"><input name="splashAdEnabled" type="checkbox" ${config.splashAdEnabled ? "checked" : ""}> 开屏广告启用</label>
            <label class="check"><input type="checkbox" checked disabled> 退款/提现保留幂等键</label>
            <label class="check"><input type="checkbox" checked disabled> 财务敏感操作进入操作日志</label>
            <label class="check"><input type="checkbox" checked disabled> 自建配送不接第三方物流</label>
            </div>
            <div class="settings-actions compact"><p>财务审批和账务流水保留独立权限边界。</p><button class="action" type="submit">保存财务展示</button></div>
          </form>
        </article>
      </section>
      <section class="grid-2 settings-edit-grid">
        <article class="panel settings-card">
          <div class="panel-head"><h2>首页运营配置</h2><span>Banner / 服务承诺 / 活动入口</span></div>
          <form class="admin-form" data-config-form="home">
            <div class="settings-grid">
            <label>Banner 标题<input name="homeBannerTitle" value="${config.homeBannerTitle || "时令鲜果季"}"></label>
            <label>Banner 文案<input name="homeBannerSubtitle" value="${config.homeBannerSubtitle || "新鲜到站，会员现金购物更优惠"}"></label>
            <label>Banner 关联商品编号<input name="homeBannerProductId" value="${config.homeBannerProductId || "p_strawberry"}"></label>
            <label>服务标签<input name="homeServiceBadges" value="${homeServiceBadges}"></label>
            <label>承诺标题<input name="homePromiseTitle" value="${promise.title || "最快 30 分钟送达"}"></label>
            <label>承诺副标题<input name="homePromiseSubtitle" value="${promise.subtitle || "TGG 自建配送队 · 师大周边 5km"}"></label>
            <label>截单文案<input name="homePromiseCutoffText" value="${promise.cutoffText || "今日 18:00 前可送"}"></label>
            <label>配送费文案<input name="homePromiseDeliveryFeeText" value="${promise.deliveryFeeText || "满 39 元免配送费"}"></label>
            <label class="wide">服务范围文案<input name="homePromiseServiceAreaText" value="${promise.serviceAreaText || "当前地址在服务范围内"}"></label>
            </div>
            <div class="settings-repeat-list">
              ${[0, 1, 2].map((index) => {
                const item = promotions[index] || {};
                return `<div class="settings-repeat-row">
                  <label>入口标题<input name="promotionTitle" value="${item.title || ""}" placeholder="例如 今日秒杀"></label>
                  <label>入口文案<input name="promotionText" value="${item.text || ""}" placeholder="例如 会员低至 5 折"></label>
                  <label>跳转页面<select name="promotionPage">
                    ${optionTags(["category", "points", "tasks", "mine"], item.page || "category", { category: "商品分类", points: "纯积分兑换", tasks: "做任务", mine: "我的" })}
                  </select></label>
                  <label>颜色<select name="promotionTone">
                    ${optionTags(["green", "orange", "blue", "purple"], item.tone || "green", { green: "绿色", orange: "橙色", blue: "蓝色", purple: "紫色" })}
                  </select></label>
                </div>`;
              }).join("")}
            </div>
            <div class="settings-actions compact"><p>保存后用户首页 /api/home 实时读取。</p><button class="action" type="submit">保存首页运营</button></div>
          </form>
        </article>
        <article class="panel settings-card">
          <div class="panel-head"><h2>签到广告素材</h2><span>素材启停与展示位置</span></div>
          <form class="admin-form" data-config-form="ads">
            <div class="settings-repeat-list">
              ${[0, 1, 2, 3].map((index) => {
                const item = adMaterials[index] || {};
                return `<div class="settings-repeat-row ad-row">
                  <label>素材名称<input name="adName" value="${item.name || ""}" placeholder="例如 签到激励视频"></label>
                  <label>广告类型<select name="adType">${optionTags(["reward_video", "interstitial", "banner"], item.type || "reward_video", { reward_video: "激励视频", interstitial: "插屏广告", banner: "横幅广告" })}</select></label>
                  <label>展示位置<input name="adPosition" value="${item.position || ""}" placeholder="例如 签到第 1 步"></label>
                  <label class="check"><input name="adEnabled${index}" type="checkbox" ${item.enabled !== false ? "checked" : ""}> 启用</label>
                </div>`;
              }).join("")}
            </div>
            <div class="settings-actions compact"><p>不需要编辑 JSON，空白素材行会自动忽略。</p><button class="action" type="submit">保存广告素材</button></div>
          </form>
        </article>
      </section>
    </section>
    ${operationLogsPanel(state)}
  `;
}

function optionTags(values, current, labels = {}) {
  return values.map((value) => `<option value="${value}" ${value === current ? "selected" : ""}>${labels[value] || value}</option>`).join("");
}

function operationLogsPanel(state) {
  const logs = (state.operationLogs || []).slice(0, 12);
  const rows = logs.map((item) => [
    formatDateTime(item.createdAt),
    zh(item.roleId || item.actorRole, "role"),
    zh(item.action, "action"),
    `${zh(item.targetType, "targetType")}<br><span class="muted-text">${escapeHtml(item.targetId || "-")}</span>`,
    `<span class="log-reason">${escapeHtml(logReason(item))}</span>`,
    `<span class="muted-text">${escapeHtml(logDetailText(item))}</span>`
  ]);
  return `
    <section class="panel operation-log-panel">
      <div class="panel-head"><h2>操作日志</h2><span>敏感操作追踪</span></div>
      ${simpleTable("最近后台写操作", ["时间", "角色", "动作", "对象", "操作原因", "关键明细"], rows)}
    </section>
  `;
}

function logReason(item) {
  return item.reason || item.detail?.reason || item.after?.reason || item.after?.remarks || "-";
}

function logDetailText(item) {
  const detail = item.detail || item.after || {};
  const parts = [];
  if (detail.orderId) parts.push(`订单 ${detail.orderId}`);
  if (detail.staffName || detail.staffId) parts.push(`配送 ${detail.staffName || detail.staffId}`);
  if (detail.refundCashAmount) parts.push(`现金 ¥${Number(detail.refundCashAmount || 0).toFixed(1)}`);
  if (detail.refundPointAmount) parts.push(`积分 ${detail.refundPointAmount}`);
  if (detail.cancelledCount != null) parts.push(`取消 ${detail.cancelledCount} 笔`);
  if (detail.timeoutMinutes) parts.push(`超时 ${detail.timeoutMinutes} 分钟`);
  if (detail.idempotent) parts.push("幂等命中");
  if (item.idempotencyKey) parts.push(`幂等键 ${item.idempotencyKey}`);
  return parts.join(" / ") || "-";
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
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

function stats(state) {
  const paidOrders = state.orders.filter((item) => ["paid", "completed"].includes(item.status));
  const salesAmount = paidOrders.reduce((total, order) => total + Number(order.cashAmount || 0), 0);
  return statCards([
    ["今日订单", state.summary.orderCount || state.orders.length],
    ["今日销售额", `¥${salesAmount.toFixed(2)}`],
    ["待处理售后", state.refunds.filter((item) => item.status === "pending_review").length],
    ["配送中", state.orders.filter((item) => item.fulfillmentStatus === "shipping" || item.fulfillmentStatus === "pending_ship").length]
  ]);
}

function statCards(rows) {
  return `<section class="stats">${rows.map(([label, value]) => `<article class="stat"><span>${label}</span><strong>${value}</strong><small>较昨日稳定</small></article>`).join("")}</section>`;
}

function lineChart(values) {
  const width = 620;
  const height = 220;
  const padding = 30;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values.map((value, index) => {
    const x = padding + (index * (width - padding * 2)) / (values.length - 1);
    const y = height - padding - ((value - min) / Math.max(1, max - min)) * (height - padding * 2);
    return [x, y];
  });
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="近 7 日订单趋势">
      ${[0, 1, 2, 3, 4].map((line) => `<line x1="${padding}" y1="${padding + line * 40}" x2="${width - padding}" y2="${padding + line * 40}" />`).join("")}
      <path d="${path}" />
      ${points.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" />`).join("")}
    </svg>
  `;
}

function tableHead(title, action) {
  return `<div class="panel-head"><h2>${title}</h2>${action ? `<button class="action">${action}</button>` : `<span>实时数据</span>`}</div>`;
}

function stateMachineNodes(state) {
  const payments = state.ledger.paymentLedger || [];
  const nodes = [
    ["pending_payment", "待支付", state.orders.filter((item) => item.status === "pending_payment").length],
    ["paid", "已支付/已扣分", state.orders.filter((item) => item.status === "paid").length],
    ["pending_pickup", "待自提", state.orders.filter((item) => item.fulfillmentStatus === "pending_pickup").length],
    ["shipping", "配送中", state.orders.filter((item) => item.fulfillmentStatus === "shipping").length],
    ["completed", "已完成", state.orders.filter((item) => item.status === "completed").length],
    ["refunding", "退款中", state.refunds.filter((item) => item.status === "pending_review").length],
    ["refunded", "已退款", state.refunds.filter((item) => item.status === "refunded").length],
    ["cancelled", "已取消", payments.filter((item) => item.status === "cancelled").length],
    ["closed", "已关闭", state.orders.filter((item) => item.status === "closed").length],
    ["exception", "异常补偿", state.exceptions.filter((item) => item.status === "pending").length]
  ];
  return nodes.map(([key, label, count]) => `<span class="status-node" data-state-node="${key}"><strong>${label}</strong><small>${count}</small></span>`).join("");
}

function orderDiagnostics(state) {
  const payments = state.ledger.paymentLedger || [];
  const rows = state.orders.slice(0, 10).map((order) => {
    const payment = payments.find((item) => item.orderId === order.id);
    const refund = state.refunds.find((item) => item.orderId === order.id);
    const exception = state.exceptions.find((item) => item.payload?.orderId === order.id || item.bizNo === order.id || item.bizNo === payment?.payNo);
    return [
      order.id,
      `${badge(order.status)} ${badge(order.fulfillmentStatus, "orange")}`,
      payment ? `${zh(payment.payScene, "payScene")} / ${badge(payment.status, payment.status === "paid" ? "" : "orange")}` : order.paymentMode === "pure_points" ? "纯积分已扣减" : "未生成支付单",
      refund ? badge(refund.status, "orange") : "-",
      exception ? badge(exception.status, exception.status === "resolved" ? "" : "red") : "-",
      nextActionHint(order, payment, refund, exception)
    ];
  });
  return simpleTable("订单排查面板", ["订单", "订单/履约", "支付单", "退款", "异常", "建议动作"], rows);
}

function exceptionLinkageRows(state) {
  const rows = state.exceptions.slice(0, 10).map((item) => [
    zh(item.type, "exceptionType"),
    item.bizNo,
    item.payload?.orderId || "-",
    item.payload?.payNo || "-",
    badge(item.status, item.status === "resolved" ? "" : "orange"),
    zh(item.action, "action")
  ]);
  return simpleTable("异常联动", ["类型", "业务单号", "订单", "支付单", "状态", "动作"], rows);
}

function nextActionHint(order, payment, refund, exception) {
  if (exception && exception.status !== "resolved") return "进入异常补偿中心处理";
  if (payment?.status === "failed") return "核对三方单号后重试或关单";
  if (payment?.status === "cancelled") return "确认超时原因，必要时重新发起支付";
  if (order.status === "pending_payment") return "等待支付回调或取消超时支付";
  if (refund?.status === "pending_review") return "财务审核退款";
  if (order.fulfillmentStatus === "pending_pickup") return "等待自提核销";
  if (order.fulfillmentStatus === "pending_ship") return "配送调度发货";
  if (order.fulfillmentStatus === "shipping") return "确认送达";
  return "无需处理";
}

function productsRows(products, title = "商品列表") {
  return simpleTable(
    title,
    ["商品", "类型/销售方式", "现金价", "积分价", "库存", "上架状态", "权益规则", "快捷操作"],
    products.map((item) => [
      `<img src="${item.image}" alt="">${item.name}`,
      `${item.category}<br><span class="muted-text">${item.purePointsOnly ? "纯积分兑换" : "现金+积分商品"}</span>`,
      item.cashPrice == null ? "不支持现金" : `¥${item.cashPrice}`,
      `${item.pointsPrice} 积分`,
      `${item.stock}${Number(item.stock || 0) <= 20 ? `<br>${badge("低库存", "red")}` : ""}`,
      badge(item.status === "on" ? "已上架" : "已下架", item.status === "on" ? "" : "orange"),
      productRuleSummary(item),
      productActionButtons(item)
    ])
  );
}

function inventoryRows(rows = []) {
  const displayRows = rows.slice(0, 12).map((item) => [
    formatDateTime(item.createdAt),
    `${item.productName || item.productId}<br><span class="muted-text">${item.productId}</span>`,
    inventoryTypeLabel(item.changeType),
    Number(item.quantityDelta || 0) > 0 ? `+${item.quantityDelta}` : item.quantityDelta,
    `${item.stockBefore} → ${item.stockAfter}`,
    item.batchNo || "-",
    item.reason || "-"
  ]);
  return simpleTable("库存出入库流水", ["时间", "商品", "类型", "变动", "库存", "批次", "原因"], displayRows);
}

function inventoryTypeLabel(type) {
  return ({
    initial_stock: "初始入库",
    purchase_in: "采购入库",
    stocktake: "盘点调整",
    order_deduct: "下单扣减",
    order_restore: "取消回补",
    refund_restore: "退款回补",
    loss: "损耗出库",
    adjust: "手工调整"
  })[type] || type || "-";
}

function productRuleSummary(item) {
  if (item.purePointsOnly) return `${badge("纯积分", "orange")}<br><span class="muted-text">禁止现金补差 / 现金入口关闭</span>`;
  const cashRule = item.supportsCash ? "会员现金购" : "关闭现金购";
  const pointRule = item.supportsPoints ? "可积分抵扣" : "不支持积分";
  return `${badge(cashRule, item.supportsCash ? "blue" : "orange")}<br><span class="muted-text">${pointRule} / 普通用户不可现金购</span>`;
}

function paymentRows(payments) {
  return simpleTable(
    "支付单流水",
    ["支付单号", "用户", "场景", "渠道", "现金", "积分", "状态", "三方单号", "幂等键"],
    payments.map((item) => [
      item.payNo || item.id,
      item.userId || "-",
      zh(item.payScene, "payScene"),
      zh(item.channel, "channel"),
      `¥${Number(item.amount || 0).toFixed(1)}`,
      item.pointAmount || 0,
      badge(item.status, item.status === "paid" ? "" : "orange"),
      item.thirdTradeNo || "-",
      item.idempotencyKey || "-"
    ])
  );
}

function simpleTable(title, heads, rows) {
  return `${title ? tableHead(title) : ""}<div class="table-wrap"><table><thead><tr>${heads.map((head) => `<th>${head}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${heads.length}">暂无数据</td></tr>`}</tbody></table></div>`;
}

function badge(text, tone = "") {
  return `<span class="status ${tone}">${zh(text)}</span>`;
}

function orders(state) {
  const pendingPickup = state.orders.filter((item) => item.fulfillmentStatus === "pending_pickup");
  const pendingShip = state.orders.filter((item) => item.fulfillmentStatus === "pending_ship");
  const shipping = state.orders.filter((item) => item.fulfillmentStatus === "shipping");
  const pendingRefunds = state.refunds.filter((item) => item.status === "pending_review");
  return `
    ${statCards([["待自提核销", pendingPickup.length], ["待配送调度", pendingShip.length], ["配送中", shipping.length], ["待退款审核", pendingRefunds.length]])}
    <section class="panel">
      <div class="panel-head"><h2>履约待办</h2><span>订单管理员 / 配送调度</span></div>
      <div class="ops-lanes">
        <div>${opsLane("待自提核销", pendingPickup, orderOpsCard)}</div>
        <div>${opsLane("待配送发货", pendingShip, orderOpsCard)}</div>
        <div>${opsLane("配送中", shipping, orderOpsCard)}</div>
      </div>
    </section>
    <section class="table-panel">${tableHead("订单列表", "导出订单")}${ordersRows(state.orders)}</section>
    <section class="grid-2">
      <article class="table-panel">${orderDiagnostics(state)}</article>
      <article class="table-panel">${exceptionLinkageRows(state)}</article>
    </section>
  `;
}

function ordersRows(orders) {
  return simpleTable(
    "",
    ["订单号", "用户", "商品", "支付", "履约", "状态", "金额/积分", "后台操作"],
    orders.map((order) => [
      order.id,
      order.userId,
      order.items.map((item) => `${item.title || item.name || item.productId} x${item.quantity}`).join("、"),
      zh(order.paymentMode, "paymentMode"),
      zh(order.fulfillmentType, "fulfillmentType"),
      `${badge(order.status)} ${badge(order.fulfillmentStatus, "orange")}`,
      paymentText(order),
      orderActionButtons(order)
    ])
  );
}

function financeRefund(state) {
  const payments = state.ledger.paymentLedger || [];
  const pendingRefunds = state.refunds.filter((item) => item.status === "pending_review");
  const pendingWithdrawals = state.withdrawals.filter((item) => item.status === "pending_review");
  const pendingApprovals = (state.approvalRequests || []).filter((item) => item.status === "pending");
  return `
    ${statCards([["退款申请", state.refunds.length], ["提现申请", state.withdrawals.length], ["待复核", pendingApprovals.length], ["支付单", payments.length]])}
    <section class="panel finance-boundary">
      <div class="panel-head"><h2>财务边界</h2><span>退款 / 提现 / 账务</span></div>
      <div class="finance-rules">
        <div class="item"><strong>退款待审</strong><span>${pendingRefunds.length} 单，提交复核后才执行原路退回。</span></div>
        <div class="item"><strong>提现待审</strong><span>${pendingWithdrawals.length} 单，复核通过后写入可提现流水。</span></div>
        <div class="item"><strong>审批闭环</strong><span>提交人和复核人分离；原因、目标和结果进入日志。</span></div>
      </div>
    </section>
    <section class="finance-stack">
      <article class="table-panel">${refundApprovalRows(state)}</article>
      <article class="table-panel">${withdrawalApprovalRows(state)}</article>
      <article class="table-panel">${approvalRequestsRows(state)}</article>
    </section>
    ${paymentToolbar(state)}
    <section class="table-panel">${paymentRows(payments)}</section>
  `;
}

function exceptions(state) {
  const pending = state.exceptions.filter((item) => item.status === "pending");
  return `
    ${statCards([["待处理", pending.length], ["已处理", state.exceptions.filter((item) => item.status === "resolved").length], ["退款异常", state.exceptions.filter((item) => String(item.type || "").includes("refund")).length], ["配送异常", state.exceptions.filter((item) => String(item.type || "").includes("delivery")).length]])}
    <section class="panel">
      <div class="panel-head"><h2>异常补偿队列</h2><span>支付 / 积分 / 配送 / 退款</span></div>
      <div class="exception-grid">${state.exceptions.map(exceptionCard).join("") || `<div class="empty">暂无异常</div>`}</div>
    </section>
    <section class="table-panel">${exceptionLinkageRows(state)}</section>
    <section class="note">下单扣分失败回滚、退款缺失订单/用户、配送异常、任务回调缺失提交单等，统一进入异常补偿中心；处理动作需要异常权限。</section>
  `;
}

function opsLane(title, orders, cardRenderer) {
  return `
    <h3 class="ops-title">${title}</h3>
    <div class="ops-lane">${orders.map(cardRenderer).join("") || `<div class="empty small-empty">暂无待办</div>`}</div>
  `;
}

function orderOpsCard(order) {
  return `
    <article class="ops-card">
      <strong>${order.id}</strong>
      <p>${order.items.map((item) => `${item.title || item.name || item.productId} x${item.quantity}`).join("、")}</p>
      <span>${zh(order.fulfillmentType, "fulfillmentType")} / ${zh(order.fulfillmentStatus)}</span>
      <div class="ops-actions">${orderActionButtons(order)}</div>
    </article>
  `;
}

function can(permission) {
  const permissions = currentAdminState.identity?.permissions || [];
  if (!permissions.length && currentAdminState.role === "super_admin") return true;
  return permissions.includes("*") || permissions.includes(permission);
}

function permissionDenied(permission) {
  return `<section class="permission-denied"><strong>无权访问当前后台模块</strong><p>当前角色：${zh(currentAdminState.identity?.id || currentAdminState.role, "role")}，缺少权限：${permission}</p></section>`;
}

function gatedAction(permission, html, label = "无权限") {
  if (can(permission)) return html;
  return `<button class="action muted-action" disabled title="缺少权限：${permission}">${label}</button>`;
}

function productActionButtons(item) {
  const nextStatus = item.status === "on" ? "off" : "on";
  const statusText = item.status === "on" ? "立即下架" : "立即上架";
  const stock = Number(item.stock || 0);
  const pointsPrice = Number(item.pointsPrice || 0);
  const cashPrice = Number(item.cashPrice || 0);
  const cashButton = item.purePointsOnly
    ? `<button class="action muted-action" disabled>现金已关闭</button>`
    : gatedAction("product:write", `<button class="action" data-product-action="${item.id}" data-supports-cash="${item.supportsCash ? "false" : "true"}">${item.supportsCash ? "关闭现金购" : "开启现金购"}</button>`, "无商品权限");
  const cashPriceButton = item.purePointsOnly || !item.supportsCash
    ? ""
    : gatedAction("product:write", `<button class="action" data-product-action="${item.id}" data-cash-price="${Math.max(0, Number((cashPrice + 1).toFixed(1)))}">现金价+1</button>`, "无商品权限");
  return `
    <div class="product-actions">
      ${gatedAction("product:write", `<button class="action" data-product-action="${item.id}" data-status="${nextStatus}">${statusText}</button>`, "无上下架权限")}
      ${gatedAction("stock:write", `<button class="action" data-product-action="${item.id}" data-stock="${stock + 10}">补货 +10</button>`, "无库存权限")}
      ${gatedAction("stock:write", `<button class="action" data-product-action="${item.id}" data-stock="0">库存清零</button>`, "无库存权限")}
      ${gatedAction(item.purePointsOnly ? "points_product:write" : "product:write", `<button class="action" data-product-action="${item.id}" data-points-price="${pointsPrice + 10}">积分价+10</button>`, "无价格权限")}
      ${cashPriceButton}
      ${cashButton}
    </div>
  `;
}

function orderActionButtons(order) {
  const actions = [];
  if (order.fulfillmentStatus === "pending_pickup") {
    actions.push(gatedAction("order:fulfillment", `<button class="action" data-order-pickup-verify="${order.id}" data-pickup-code="${order.pickupCode || ""}">核销自提码</button>`, "无履约权限"));
  }
  if (order.fulfillmentStatus === "pending_ship") {
    actions.push(gatedAction("order:fulfillment", `<button class="action" data-order-ship="${order.id}" data-staff-id="staff_001">分配配送并发货</button>`, "无履约权限"));
  }
  if (order.fulfillmentStatus === "shipping") {
    actions.push(gatedAction("order:fulfillment", `<button class="action" data-order-deliver="${order.id}">确认送达</button>`, "无履约权限"));
  }
  if (order.status === "refunding") {
    actions.push(`<button class="action muted-action" disabled>等待财务退款</button>`);
  }
  if (!actions.length) actions.push(`<button class="action muted-action" disabled>暂无操作</button>`);
  return `<div class="table-actions">${actions.join("")}</div>`;
}

function refundApprovalRows(state) {
  return simpleTable(
    "退款审批",
    ["退款单", "订单", "用户", "现金", "积分", "状态", "审批操作"],
    state.refunds.map((item) => [
      item.id,
      item.orderId,
      item.userId,
      `¥${Number(item.refundCashAmount || 0).toFixed(1)}`,
      item.refundPointAmount || 0,
      badge(item.status, item.status === "pending_review" ? "orange" : ""),
      pendingApprovalFor(state, "refund.approve", item.id)
        ? badge("复核中", "orange")
        : item.status === "pending_review"
        ? gatedAction("approval:request", `<button class="action danger-action" data-refund-approve="${item.id}">提交退款复核</button>`, "无提交权限")
        : "已处理"
    ])
  );
}

function withdrawalApprovalRows(state) {
  return simpleTable(
    "提现审批",
    ["提现单", "用户", "金额", "手续费", "状态", "审批操作"],
    state.withdrawals.map((item) => [
      item.id,
      item.userId,
      `¥${Number(item.amount || 0).toFixed(1)}`,
      `¥${Number(item.fee || 0).toFixed(1)}`,
      badge(item.status, item.status === "pending_review" ? "orange" : ""),
      pendingApprovalFor(state, "withdrawal.approve", item.id) || pendingApprovalFor(state, "withdrawal.reject", item.id)
        ? badge("复核中", "orange")
        : item.status === "pending_review"
        ? `${gatedAction("approval:request", `<button class="action" data-withdraw-action="${item.id}" data-action-type="approve">提交通过复核</button>`, "无提交权限")} ${gatedAction("approval:request", `<button class="action danger-action" data-withdraw-action="${item.id}" data-action-type="reject">提交驳回复核</button>`, "无提交权限")}`
        : "已处理"
    ])
  );
}

function approvalRequestsRows(state) {
  return simpleTable(
    "二级审批队列",
    ["审批单", "动作", "目标", "提交角色", "状态", "原因", "复核操作"],
    (state.approvalRequests || []).slice(0, 12).map((item) => [
      item.id,
      zh(item.action, "action"),
      `${zh(item.targetType, "targetType")}<br><span class="muted-text">${item.targetId}</span>`,
      zh(item.requestedByRoleId, "role"),
      badge(item.status, item.status === "pending" ? "orange" : ""),
      `<span class="log-reason">${escapeHtml(item.requestReason || "-")}</span>`,
      item.status === "pending"
        ? `${gatedAction("approval:review", `<button class="action danger-action" data-approval-id="${item.id}" data-approval-action="approve">复核通过</button>`, "无复核权限")} ${gatedAction("approval:review", `<button class="action" data-approval-id="${item.id}" data-approval-action="reject">驳回</button>`, "无复核权限")}`
        : `<span class="muted-text">${escapeHtml(item.reviewReason || item.result?.error || "已处理")}</span>`
    ])
  );
}

function pendingApprovalFor(state, action, targetId) {
  return (state.approvalRequests || []).find((item) => item.action === action && item.targetId === targetId && item.status === "pending");
}

function exceptionCard(item) {
  return `
    <article class="exception-card ${item.status === "resolved" ? "resolved" : ""}">
      <div>
        <strong>${zh(item.type, "exceptionType")}</strong>
        <span>${item.bizNo || "-"}</span>
      </div>
      <p>${zh(item.action, "action")} / ${badge(item.status, item.status === "resolved" ? "" : "orange")}</p>
      <small>订单：${item.payload?.orderId || "-"} / 支付：${item.payload?.paymentId || item.payload?.payNo || "-"}</small>
      ${item.status === "resolved" ? `<button class="action muted-action" disabled>已处理</button>` : gatedAction("exception:write", `<button class="action danger-action" data-exception-resolve="${item.id}" data-action="${item.action || "manual_compensation"}">标记已补偿</button>`, "无补偿权限")}
    </article>
  `;
}

function paymentToolbar(state) {
  const filters = state.paymentFilters || {};
  const statusOptions = [
    ["pending", "待回调"],
    ["paid", "已支付"],
    ["failed", "失败"],
    ["cancelled", "已取消"]
  ];
  const sceneOptions = [
    ["goods_cash", "现金购物"],
    ["member_open", "会员开通"],
    ["cash_diff", "积分补差"]
  ];
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>支付筛选与补偿</h2>
        ${gatedAction("exception:write", `<button class="action" data-cancel-payment-timeouts data-timeout-minutes="30">取消超时支付单</button>`, "无异常处理权限")}
      </div>
      <div class="filters">
        ${statusOptions.map(([value, label]) => `<button class="chip ${filters.paymentStatus === value ? "active blue" : ""}" data-payment-filter data-filter-key="paymentStatus" data-filter-value="${value}" aria-pressed="${filters.paymentStatus === value ? "true" : "false"}">${label}</button>`).join("")}
      </div>
      <div class="filters">
        ${sceneOptions.map(([value, label]) => `<button class="chip ${filters.payScene === value ? "active orange" : ""}" data-payment-filter data-filter-key="payScene" data-filter-value="${value}" aria-pressed="${filters.payScene === value ? "true" : "false"}">${label}</button>`).join("")}
        <button class="chip ${filters.channel === "mock_pay" ? "active blue" : ""}" data-payment-filter data-filter-key="channel" data-filter-value="mock_pay" aria-pressed="${filters.channel === "mock_pay" ? "true" : "false"}">模拟支付</button>
      </div>
      ${state.paymentActionMessage ? `<div class="note">${state.paymentActionMessage}</div>` : ""}
    </section>
  `;
}

function paymentText(order) {
  if (order.paymentMode === "pure_points") return `${order.pointAmount}积分`;
  if (order.paymentMode === "points_plus_cash") return `¥${order.cashAmount} + ${order.pointAmount}积分`;
  return `¥${order.cashAmount}`;
}
