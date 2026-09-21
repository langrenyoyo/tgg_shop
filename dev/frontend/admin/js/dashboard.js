export function renderDashboard(state, ui) {
  const { escapeHtml: e, can, gatedAction: gate, simpleTable: table, badge, paymentText, orderActionButtons } = ui;
  const summary = state.summary || {};
  const analytics = summary.analytics?.dashboard || {};
  const selected = analytics.selected;
  const filters = state.dashboardFilters || {};
  const rangeLabel = selected?.rangeLabel || "统计数据暂不可用";
  const orderIds = new Set(analytics.selectedOrderIds || []);
  const orders = (state.orders || []).filter(order => orderIds.has(order.id)).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const filterRow = (title, key, options) => `<div class="dashboard-control-row"><span class="dashboard-control-label">${title}</span>${options.map(([value, label]) => `<button class="chip ${(filters[key] || "all") === value ? "active" : ""}" data-dashboard-filter data-filter-key="${key}" data-filter-value="${value}">${label}</button>`).join("")}</div>`;
  const metric = (label, value, tone, note) => `<article class="dashboard-metric tone-${tone}"><span>${label}</span><strong>${e(value ?? "—")}</strong><small>${note}</small></article>`;
  const orderStatusLabels = { pending_payment: "待支付", paid: "已支付", completed: "已完成", refunding: "退款处理中", refunded: "已退款", cancelled: "已取消", closed: "已关闭" };
  const fulfillmentLabels = { pending_pickup: "待自提", pending_ship: "待配送", shipping: "配送中", delivered: "已送达", picked_up: "已核销", delivery_exception: "配送异常" };
  const breakdown = (title, counts, key, labels) => `<section class="panel dashboard-panel"><div class="panel-head"><h2>${title}</h2><span>点击筛选订单</span></div><div class="dashboard-breakdowns">${Object.entries(counts || {}).map(([value, count]) => `<button class="dashboard-breakdown-pill" data-dashboard-filter data-filter-key="${key}" data-filter-value="${e(value)}">${e(labels[value] || value)} · ${count}</button>`).join("") || '<p class="muted-text">当前时段暂无订单</p>'}</div></section>`;
  const queueLink = (label, count, permission, view) => `<div class="dashboard-stack-item"><strong>${label}</strong><span>${e(count ?? "—")}</span>${gate(permission, `<button class="action" data-dashboard-view="${view}">查看</button>`)}</div>`;
  return `<div class="dashboard-screen">
    <section class="dashboard-hero"><div><div class="dashboard-kicker">TGG SHOP · 运营总览</div><h1>运营数据中心</h1><p>查看经营表现、跟进履约待办，及时处理退款与异常。</p><div class="dashboard-hero-meta"><span data-dashboard-range-label>${e(rangeLabel)}</span><span>自建配送 · 到店自提</span><span>每 60 秒刷新</span></div>
      <div class="dashboard-hero-actions"><button class="action" data-dashboard-jump="dashboard-orders">查看订单</button><button class="action" data-dashboard-save-view>保存当前视图</button><button class="action" data-dashboard-export="csv">导出 CSV</button><button class="action" data-dashboard-export="json">导出快照</button></div></div>
      <div class="dashboard-hero-side"><div class="dashboard-hero-summary"><strong>当前待履约</strong><span>${analytics.current ? Number(analytics.current.pendingPickup || 0) + Number(analytics.current.pendingShip || 0) : "—"} 单</span></div><div class="dashboard-hero-summary"><strong>当前待退款 / 待补偿</strong><span>${summary.pendingRefundCount ?? "—"} / ${summary.pendingExceptionCount ?? "—"}</span></div></div>
    </section>
    ${state.summaryError ? `<section class="note" role="alert">${e(state.summaryError)}</section>` : ""}
    <section class="dashboard-controls" aria-label="仪表盘筛选">
      ${filterRow("时段", "range", [["today", "今日"], ["week", "近 7 天"], ["month", "近 30 天"]])}
      <form class="dashboard-range-form" data-dashboard-range-form><label>开始日期<input type="date" name="startDate" value="${e(filters.startDate || "")}" required></label><label>结束日期<input type="date" name="endDate" value="${e(filters.endDate || "")}" required></label><button class="action" type="submit">应用日期</button><button class="action ghost" type="button" data-dashboard-filters-reset>重置全部筛选</button></form>
      ${filterRow("订单", "orderStatus", [["all", "全部"], ...Object.entries(orderStatusLabels)])}
      ${filterRow("履约", "fulfillmentStatus", [["all", "全部"], ...Object.entries(fulfillmentLabels)])}
      ${filterRow("支付", "paymentMode", [["all", "全部"], ["cash", "现金支付"], ["pure_points", "纯积分兑换"], ["points_plus_cash", "积分+现金补差"]])}
      <p class="muted-text">订单指标和趋势按以上条件统计；积分与风险数量按时段统计；用户总数、待办队列为当前全量数据。成交额为退款前金额。</p>
    </section>
    ${dashboardViews(state, e)}
    <section class="dashboard-metrics">
      ${metric("订单数", selected?.orderCount, "cyan", e(rangeLabel))}
      ${metric("成交额", selected ? `¥${Number(selected.gmv || 0).toFixed(2)}` : "—", "green", "所选时段 · 退款前")}
      ${metric("用户总数", summary.userCount, "blue", "累计用户")}
      ${metric("积分净额", selected?.pointNet, "amber", "所选时段 · 收入减支出")}
      ${metric("退款申请", selected?.refundCount, "red", "所选时段")}
      ${metric("异常记录", selected?.exceptionCount, "amber", "所选时段")}
    </section>
    <section class="dashboard-alerts">${(analytics.alerts || []).map(alert => `<article class="dashboard-alert tone-${e(alert.tone)}"><strong>${e(alert.title)}</strong><span>${e(alert.text)}</span><div class="dashboard-alert-action">${alert.drill?.type === "refunds" ? gate("refund:approve", '<button class="action" data-dashboard-view="financeRefund">查看退款</button>') : alert.drill?.type === "exceptions" ? gate("exception:read", '<button class="action" data-dashboard-view="exceptions">查看异常</button>') : `<button class="action" data-dashboard-alert-drill="${e(JSON.stringify(alert.drill || {}))}">查看订单</button>`}</div></article>`).join("")}</section>
    <div class="dashboard-grid dashboard-grid-main"><section class="panel dashboard-panel-chart"><div class="panel-head"><h2>订单趋势</h2><span>${e(rangeLabel)}</span></div>${dashboardChart(analytics.series, "orderCount", "订单数", e)}</section>
      <section class="panel dashboard-panel-side"><div class="panel-head"><h2>待办事项</h2><span>当前全量</span></div><div class="dashboard-stack">
        <div class="dashboard-stack-item"><strong>待自提核销</strong><span>${analytics.current?.pendingPickup ?? "—"}</span>${gate("order:read", '<button class="action" data-dashboard-view="orders">查看</button>')}</div>
        <div class="dashboard-stack-item"><strong>待发货配送</strong><span>${analytics.current?.pendingShip ?? "—"}</span>${gate("order:read", '<button class="action" data-dashboard-view="orders">查看</button>')}</div>
        ${queueLink("待退款", summary.pendingRefundCount, "refund:approve", "financeRefund")}${queueLink("异常补偿", summary.pendingExceptionCount, "exception:read", "exceptions")}${queueLink("支付流水", summary.paymentLedgerCount, "ledger:read", "ledger")}</div></section></div>
    <div class="dashboard-grid dashboard-grid-bottom"><section class="panel"><div class="panel-head"><h2>成交额趋势</h2><span>人民币 · 退款前</span></div>${dashboardChart(analytics.series, "gmv", "成交额", e)}</section><section class="panel"><div class="panel-head"><h2>积分净额趋势</h2><span>收入减支出</span></div>${dashboardChart(analytics.series, "pointNet", "积分净额", e)}</section></div>
    <div class="dashboard-grid dashboard-grid-bottom">${breakdown("订单状态分布", selected?.orderStatusCounts, "orderStatus", orderStatusLabels)}${breakdown("履约状态分布", selected?.fulfillmentCounts, "fulfillmentStatus", fulfillmentLabels)}</div>
    <section class="table-panel dashboard-table" id="dashboard-orders">${table("最近订单", ["订单号", "用户", "商品", "支付", "履约", "状态", "金额/积分", "操作"], orders.slice(0, 20).map(order => [e(order.id), e(order.userId), (order.items || []).map(item => `${e(item.title || item.name || item.productId)} × ${item.quantity}`).join("<br>"), e(({ cash: "现金支付", pure_points: "纯积分兑换", points_plus_cash: "积分+现金补差" })[order.paymentMode] || order.paymentMode), badge(order.fulfillmentStatus, "orange"), badge(order.status), paymentText(order), orderActionButtons(order)]))}<p class="muted-text">符合筛选条件 ${orders.length} 笔，展示最新 20 笔。</p></section>
    ${dashboardQueues(state, ui)}
    ${can("config:read") && can("config:write") ? dashboardThresholds(analytics.alertThresholds || {}, e) : ""}
  </div>`;
}

function dashboardChart(series = [], key, label, e) {
  if (!series.length) return '<p class="muted-text">暂无趋势数据</p>';
  const values = series.map(item => Number(item[key] || 0));
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => [48 + index * 644 / Math.max(1, values.length - 1), 210 - (value - min) / (max - min) * 174]);
  return `<div class="mini-chart"><svg viewBox="0 0 720 250" role="img" aria-label="${e(label)}趋势" data-dashboard-chart="${key}">
    ${[0, 1, 2, 3].map(index => `<line x1="48" x2="692" y1="${36 + index * 58}" y2="${36 + index * 58}"/><text x="40" y="${40 + index * 58}" text-anchor="end">${Number((max - (max - min) * index / 3).toFixed(1))}</text>`).join("")}
    <path d="${points.map(([x, y], index) => `${index ? "L" : "M"}${x},${y}`).join(" ")}"/>
    ${points.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="4"><title>${e(series[index].label)} · ${e(label)} ${values[index]}</title></circle>`).join("")}
    <text x="48" y="240">${e(series[0].label)}</text><text x="692" y="240" text-anchor="end">${e(series.at(-1).label)}</text></svg></div>`;
}

function dashboardViews(state, e) {
  const views = state.dashboardViews || [];
  return `<section class="dashboard-views"><div class="panel-head"><h2>常用视图</h2><span>保存筛选条件，按角色保留</span></div><div class="dashboard-view-row">${views.map(view => `<article class="dashboard-view-item"><strong>${view.pinned ? "置顶 · " : ""}${e(view.name)}</strong><span>${e(({ today: "今日", week: "近 7 天", month: "近 30 天", custom: `${view.filters.startDate} 至 ${view.filters.endDate}` })[view.filters.range] || "近 30 天")}</span><div class="dashboard-view-actions"><button class="action" data-dashboard-view-apply="${e(view.id)}">应用</button><button class="action" data-dashboard-view-pin="${e(view.id)}">${view.pinned ? "取消置顶" : "置顶"}</button><button class="action" data-dashboard-view-delete="${e(view.id)}">删除</button></div></article>`).join("") || '<p class="muted-text">暂无保存的视图，设置筛选后点击“保存当前视图”。</p>'}</div></section>`;
}

function dashboardQueues(state, ui) {
  const { escapeHtml: e, can, gatedAction: gate, simpleTable: table, badge } = ui;
  const approvals = state.approvalRequests || [];
  const queueFilters = state.dashboardQueueFilters || {};
  const refunds = (state.refunds || []).filter(item => item.status === "pending_review" && !approvals.some(request => request.action === "refund.approve" && request.targetId === item.id && request.status === "pending")
    && (queueFilters.refundType === "linked" ? Boolean(item.orderId) : queueFilters.refundType === "cash_only" ? Number(item.refundCashAmount) > 0 && !Number(item.refundPointAmount) : queueFilters.refundType === "points_involved" ? Number(item.refundPointAmount) > 0 : true));
  const exceptions = (state.exceptions || []).filter(item => item.status === "pending" && (!queueFilters.exceptionType || queueFilters.exceptionType === "all" || item.type === queueFilters.exceptionType));
  const filterButtons = (key, options) => `<div class="dashboard-controls dashboard-queue-filters"><div class="dashboard-control-row">${options.map(([value, label]) => `<button class="chip ${(queueFilters[key] || "all") === value ? "active" : ""}" data-dashboard-queue-key="${key}" data-dashboard-queue-filter="${e(value)}">${e(label)}</button>`).join("")}</div></div>`;
  const queue = (kind, title, items, permission, headers, row) => {
    const selected = new Set(state.dashboardBatchSelection?.[kind] || []);
    const count = items.filter(item => selected.has(item.id)).length;
    const controls = can(permission) ? `<div class="dashboard-batch-bar"><span class="dashboard-batch-summary">已选 ${count} 笔</span><button class="action" data-dashboard-batch-select-all="${kind}" data-dashboard-batch-ids="${e(JSON.stringify(items.map(item => item.id)))}">全选</button><button class="action" data-dashboard-batch-clear="${kind}">清空</button><button class="action danger-action" data-dashboard-batch-run="${kind}" ${count ? "" : "disabled"}>${kind === "refunds" ? "批量提交复核" : "批量标记补偿"}</button></div>` : "";
    const filters = kind === "refunds" ? filterButtons("refundType", [["all", "全部退款"], ["linked", "关联订单"], ["cash_only", "仅现金"], ["points_involved", "包含积分"]]) : filterButtons("exceptionType", [["all", "全部异常"], ...[...new Set((state.exceptions || []).map(item => item.type))].map(type => [type, type])]);
    return `<section class="table-panel">${filters}${controls}${table(title, ["选择", ...headers], items.map(item => [`<input type="checkbox" aria-label="选择 ${e(item.id)}" data-dashboard-batch-toggle="${e(item.id)}" data-dashboard-batch-kind="${kind}" ${selected.has(item.id) ? "checked" : ""} ${can(permission) ? "" : "disabled"}>`, ...row(item)]))}</section>`;
  };
  return `<div class="dashboard-grid dashboard-queue-grid">${state.dashboardBatchMessage ? `<p role="status">${e(state.dashboardBatchMessage)}</p>` : ""}
    ${can("refund:approve") ? queue("refunds", "待退款复核队列", refunds, "approval:request", ["退款单", "订单", "现金 / 积分", "状态", "操作"], item => [e(item.id), e(item.orderId), `¥${Number(item.refundCashAmount || 0).toFixed(2)} / ${item.refundPointAmount || 0}`, badge(item.status), gate("approval:request", `<button class="action" data-refund-approve="${e(item.id)}">提交复核</button>`)]) : ""}
    ${can("exception:read") ? queue("exceptions", "异常补偿队列", exceptions, "exception:write", ["异常单", "类型", "业务单号", "状态", "操作"], item => [e(item.id), e(item.type), e(item.bizNo || "—"), badge(item.status), gate("exception:write", `<button class="action" data-exception-resolve="${e(item.id)}" data-action="${e(item.action || "manual_compensation")}">标记补偿</button>`)]) : ""}
  </div>`;
}

function dashboardThresholds(thresholds, e) {
  const field = (label, name, value, max) => `<label>${label}<input name="${name}" type="number" min="0" ${max ? `max="${max}"` : ""} step="1" value="${e(value)}" required></label>`;
  return `<details class="panel dashboard-thresholds"><summary>预警阈值设置</summary><form class="admin-form" data-config-form="dashboard"><div class="editor-grid">${field("退款率阈值（%）", "refundRateThresholdPercent", Math.round((thresholds.refundRate ?? 0.1) * 100), 100)}${field("异常率阈值（%）", "exceptionRateThresholdPercent", Math.round((thresholds.exceptionRate ?? 0.08) * 100), 100)}${field("待配送阈值（单）", "pendingShipThreshold", thresholds.pendingShipCount ?? 10)}${field("待自提阈值（单）", "pendingPickupThreshold", thresholds.pendingPickupCount ?? 10)}</div><button class="action" type="submit">保存预警阈值</button></form></details>`;
}
