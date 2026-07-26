export function money(value) {
  return `¥${Number(value || 0).toFixed(1)}`;
}

export const pageTitles = {
  home: "TGG Shop",
  earn: "赚积分",
  taskDetail: "任务详情",
  taskSubmit: "提交任务",
  submissions: "我的提交",
  signin: "每日签到",
  invite: "邀请有礼",
  category: "商品分类",
  product: "商品详情",
  cart: "购物车",
  checkoutPickup: "确认订单",
  checkoutDelivery: "送货上门",
  orders: "我的订单",
  orderDetail: "订单详情",
  payment: "扫码支付",
  pickupSite: "自提点",
  address: "收货地址",
  profile: "我的",
  membership: "会员开通",
  pointsLedger: "积分明细",
  payments: "支付记录",
  ranking: "积分排行榜",
  agentScan: "代理核销",
  withdraw: "提现",
  refund: "退款申请",
  customerService: "客服",
  feedback: "意见反馈",
  business: "商务合作",
  recruiting: "招聘岗位",
  pointsExchange: "纯积分兑换"
};

const categories = ["水果", "蔬菜", "兑换", "任务", "会员", "自提", "配送", "更多"];
let pendingRenderState = null;
let renderScheduled = false;
let lastRenderedPage = "";
let lastRenderedHtml = "";
let cachedHomeView = { signature: "", node: null };

export function renderPage(state) {
  pendingRenderState = state;
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderPageNow(pendingRenderState || state);
  });
}

function renderPageNow(state) {
  const screen = document.querySelector("#screen");
  const page = state.page || "home";
  document.querySelector("#pageTitle").textContent = pageTitles[page] || "TGG Shop";
  const currentHomeSignature = page === "home" ? homeSignature(state) : "";
  if (page === "home" && cachedHomeView.node && cachedHomeView.signature === currentHomeSignature) {
    if (screen.firstElementChild !== cachedHomeView.node || screen.childElementCount !== 1) {
      screen.replaceChildren(cachedHomeView.node);
    }
    lastRenderedPage = page;
    lastRenderedHtml = "";
    return;
  }
  const product = state.selectedProduct || state.products[0] || state.exchangeProducts[0];
  const views = {
    home: () => homeView(state),
    earn: () => earnView(state),
    taskDetail: () => taskDetailView(state),
    taskSubmit: () => taskSubmitView(state),
    submissions: () => submissionsView(state),
    signin: () => signinView(state),
    invite: () => inviteView(state),
    category: () => categoryView(state),
    product: () => productView(product, state),
    cart: () => cartView(state),
    checkoutPickup: () => checkoutView(state, "pickup"),
    checkoutDelivery: () => checkoutView(state, "delivery"),
    orders: () => ordersView(state),
    orderDetail: () => orderDetailView(state),
    payment: () => paymentView(state),
    pickupSite: () => pickupSiteView(state),
    address: () => addressView(state),
    profile: () => profileView(state),
    membership: () => membershipView(state),
    pointsLedger: () => pointsLedgerView(state),
    payments: () => paymentsView(state),
    ranking: () => rankingView(state),
    agentScan: () => agentScanView(),
    withdraw: () => withdrawView(state),
    refund: () => refundView(state),
    customerService: () => ticketActionView(state, "customer_service", "在线客服", "订单、退款、配送问题可联系人工客服处理。", "提交咨询"),
    feedback: () => ticketActionView(state, "feedback", "提交反馈", "问题建议、体验反馈和功能需求会进入运营跟进。", "提交反馈"),
    business: () => ticketActionView(state, "business", "合作申请", "校园商家、品牌活动、团购供货可联系平台运营。", "提交合作"),
    recruiting: () => ticketActionView(state, "recruiting", "招聘岗位", "校园代理和自建配送团队岗位申请。", "提交咨询"),
    pointsExchange: () => pointsExchangeView(state)
  };
  const html = (views[page] || views.home)();
  if (page !== "home" && lastRenderedPage === page && lastRenderedHtml === html) return;
  lastRenderedPage = page;
  lastRenderedHtml = page === "home" ? "" : html;
  screen.innerHTML = html;
  if (page === "home") {
    cachedHomeView = { signature: currentHomeSignature, node: screen.firstElementChild };
  }
}

export function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 2400);
}

function homeView(state) {
  const pickup = state.home?.pickupSite || state.pickupSites[0];
  const promise = state.home?.deliveryPromise || {};
  const badges = state.home?.serviceBadges || ["自建配送", "坏果包赔", "低价会员购"];
  const promotions = state.home?.promotionEntries || [
    { title: "新人礼包", text: "首单配送券", tone: "green", page: "membership" },
    { title: "会员专享", text: "现金购权益", tone: "orange", page: "membership" },
    { title: "纯积分兑", text: "无需现金", tone: "blue", page: "pointsExchange" }
  ];
  return `
    <div class="home-view">
    <div class="home-head">
      <button type="button" class="location location-button" data-page="pickupSite">
        <span class="pin">T</span>
        <span><strong>${pickup?.name || "师大自提站"}</strong><em>${promise.serviceAreaText || "师大周边 5km 可配送"}</em></span>
      </button>
      <button type="button" class="link" data-page="customerService">消息</button>
    </div>
    <div class="search">搜索水果、蔬菜、纯积分兑换</div>
    <section class="delivery-promise">
      <div class="promise-main"><strong>${promise.title || "最快 30 分钟送达"}</strong><span>${promise.subtitle || "TGG 自建配送队 · 师大周边 5km"}</span></div>
      <span class="promise-chip">${promise.cutoffText || "今日可送"}</span>
    </section>
    <section class="service-strip">${badges.map((item) => `<span>${item}</span>`).join("")}</section>
    <section class="banner">
      <div>
        <h1>时令鲜果季</h1>
        <p>新鲜到站，会员现金购物更优惠</p>
        <button type="button" class="mini-button" data-buy="p_strawberry" data-mode="cash">立即抢购</button>
      </div>
      <img src="/assets/strawberry.jpg" alt="丹东草莓" decoding="async" />
    </section>
    <section class="promo-rail">
      ${promotions.map((item) => `<button type="button" class="promo-card ${item.tone || "green"}" data-page="${item.page || "category"}"><strong>${item.title}</strong><span>${item.text}</span></button>`).join("")}
    </section>
    <section class="quick">
      <button type="button" data-page="signin">签到拿积分<span>连续签到奖励</span></button>
      <button type="button" data-page="earn">做任务拿积分<span>详情页展示奖励</span></button>
      <button type="button" data-page="invite">邀请好友<span>月卡奖励可配</span></button>
    </section>
    ${categoryRow()}
    <section class="section-title">
      <h2>热门推荐</h2>
      <button type="button" class="points-entry" data-page="pointsExchange">纯积分兑换</button>
      <button type="button" class="link" data-tab="category">更多 &gt;</button>
    </section>
    <div class="product-grid">${productCards(state.products)}</div>
    ${floatingCart(state)}
    </div>
  `;
}

function earnView(state) {
  const taskTypes = state.taskTypes || [];
  return `
    <div class="subtabs">
      <button type="button" class="active">做任务</button>
      <button type="button" data-page="signin">签到</button>
      <button type="button" data-page="submissions">提交记录</button>
    </div>
    <div class="search">搜索任务 / 平台 / 关键词</div>
    ${taskTypes.length ? `<div class="choice-row" style="margin-top:10px">${taskTypes.map((type) => `<button type="button" class="choice"><span>${type.name}</span></button>`).join("")}</div>` : ""}
    <button type="button" class="task-card" data-page="invite" style="margin-top:12px">
      <span class="dot">邀</span><span><h3>拉新任务 · 邀请好友</h3><p>奖励规则进入邀请页后查看。</p></span><span class="state">去完成</span>
    </button>
    <div class="task-list" style="margin-top:12px">
      ${(state.tasks || []).map((task) => `
        <button type="button" class="task-card" data-task="${task.id}" data-page="taskDetail">
          <span class="dot">任</span>
          <span><h3>${task.title}</h3><p>${task.category || ""} · 奖励进入详情页查看</p></span>
          <span class="state">${task.paused ? "暂停" : "去完成"}</span>
        </button>`).join("") || `<div class="empty">暂无任务</div>`}
    </div>
  `;
}

function taskDetailView(state) {
  const task = currentTask(state);
  const fields = taskFields(task);
  return `
    <article class="notice"><strong>${task.title}</strong><p>任务奖励在详情页展示，审核通过后积分入账。</p></article>
    <section class="field-card" style="margin-top:12px">
      <h3>${task.title}</h3>
      <p>预计奖励 ${task.rewardPoints || task.usersRatio || "待审核"} 积分 · 提交后进入人工审核。</p>
      ${fields.length ? `<p class="muted">需提交：${fields.map(fieldLabel).join("、")}</p>` : ""}
    </section>
    <section class="field-card"><h3>任务步骤</h3>${renderTaskContent(task)}</section>
    <button type="button" class="primary" style="width:100%;margin-top:18px" data-page="taskSubmit" ${task.paused ? "disabled" : ""}>${task.paused ? "任务已暂停" : "立即做任务"}</button>
  `;
}

function taskSubmitView(state) {
  const task = currentTask(state);
  const fields = taskFields(task);
  return `
    <section class="notice"><strong>${task.title}</strong><p>请按要求填写资料，审核通过后积分入账。</p></section>
    <form class="form" style="margin-top:12px" data-submit-task>
      ${(fields.length ? fields : ["mobile", "images", "text1"]).map(fieldInput).join("")}
      <section class="field-card"><h3>提交说明</h3><p>任务列表不提前展示具体奖励，详情页和提交页展示奖励，避免用户只按奖励筛选。</p></section>
      <button type="submit" class="primary">确认提交</button>
    </form>
  `;
}

function submissionsView(state) {
  return `
    <div class="subtabs"><button type="button" class="active">全部</button><button type="button">审核中</button><button type="button">已通过</button></div>
    <div class="stack">
      ${(state.submissions || []).length
        ? state.submissions.map((item) => `<article class="list-card"><h3>${item.taskTitle || item.taskId}</h3><p>${statusLabel(item.status)} · ${formatDate(item.createdAt)}</p>${item.remarks ? `<p class="muted">${item.remarks}</p>` : ""}</article>`).join("")
        : `<div class="empty">暂无任务提交记录</div>`}
    </div>
  `;
}

function signinView(state) {
  const status = state.signinStatus || {};
  const streakDays = status.streakDays ?? state.user?.signinStreak ?? 0;
  const targetDays = status.streakTargetDays || 30;
  const remainDays = Math.max(0, targetDays - streakDays);
  return `
    <section class="notice"><strong>${status.streakRewardText || "签满 30 天送 100 积分"}</strong><p>当前连续签到 ${streakDays} 天，距离满 ${targetDays} 天还差 ${remainDays} 天。</p></section>
    <section class="field-card" style="margin-top:12px">
      <h3>今日任务</h3>
      <p>观看 ${status.adGroups || `${status.groupMin || 3}-${status.groupMax || 5}`} 组广告；每组包含激励视频和插屏广告。</p>
    </section>
    <section class="field-card"><h3>广告进度</h3><p>已完成 ${status.completedAds || 0}/${status.totalAds || 0} 条广告，完成后获得抽奖机会。</p></section>
    <button type="button" class="primary" style="width:100%;margin-top:18px" data-action="signin">立即签到</button>
  `;
}

function inviteView(state) {
  return `
    <section class="soft-card" style="padding:22px;text-align:center;background:#e8fbf1">
      <p class="muted">我的邀请码</p>
      <h1 style="margin:8px 0;color:var(--green)">${state.invite?.inviteCode || state.user?.inviteCode || "TGG6688"}</h1>
      <button type="button" class="pill-button">复制</button>
    </section>
    <section class="field-card" style="margin-top:12px"><h3>奖励说明</h3><p>邀请成功奖励、任务佣金比例均由后台配置，按月卡和任务完成状态结算。</p></section>
    <section class="field-card"><h3>好友列表</h3><p>小陈 · 已绑定 · 可参与任务佣金</p></section>
  `;
}

function categoryView(state) {
  const selectedCategory = state.categoryName || "全部";
  const selectedMode = state.categoryMode || "all";
  const products = filterCategoryProducts((state.products || []).concat(state.exchangeProducts || []), selectedCategory, selectedMode);
  const categoryNames = ["全部", "水果", "蔬菜", "肉禽", "乳品", "零食", "纯积分"];
  const modeButtons = [
    ["all", "综合"],
    ["delivery", "30 分钟达"],
    ["cash", "会员现金购"],
    ["pure", "纯积分兑"]
  ];
  return `
    <div class="search">搜索水果、蔬菜、纯积分商品</div>
    <section class="category-filter-bar">
      ${modeButtons.map(([mode, label]) => `<button type="button" class="${selectedMode === mode ? "active" : ""}" data-category-mode="${mode}">${label}</button>`).join("")}
    </section>
    <div class="category-layout">
      <aside class="category-sidebar">${categoryNames.map((name) => `<button type="button" class="${selectedCategory === name ? "active" : ""}" data-category-name="${name}">${name}</button>`).join("")}</aside>
      <div class="category-products">
        <section class="category-promise"><strong>${selectedCategory} · ${categoryModeLabel(selectedMode)}</strong><span>TGG 自建配送队履约，可自提也可送货上门</span></section>
        ${products.map((item) => horizontalProduct(item)).join("") || `<div class="empty">暂无商品</div>`}
      </div>
    </div>
  `;
}

function filterCategoryProducts(products, selectedCategory, selectedMode) {
  return products.filter((product) => {
    const isPure = Boolean(product.purePointsOnly || product.category === "纯积分");
    const categoryMatched = selectedCategory === "全部"
      || (selectedCategory === "纯积分" ? isPure : product.category === selectedCategory);
    const modeMatched = selectedMode === "all"
      || selectedMode === "delivery"
      || (selectedMode === "cash" && !isPure)
      || (selectedMode === "pure" && isPure);
    return categoryMatched && modeMatched;
  });
}

function categoryModeLabel(mode) {
  return ({ all: "综合", delivery: "30 分钟达", cash: "会员现金购", pure: "纯积分兑" })[mode] || "综合";
}

function productView(product, state = {}) {
  if (!product) return `<div class="empty">暂无商品</div>`;
  const isPure = product.purePointsOnly;
  const memberLocked = !isPure && !isMemberUser(state.user);
  const stock = Number(product.stock || 0);
  return `
    <article class="hero-product top-card product-detail-hero">
      <img src="${product.image}" alt="${product.name}" loading="eager" decoding="async" />
      <div class="body">
        <div class="detail-title-row"><span class="tag">${product.tag || (isPure ? "纯积分" : "会员价")}</span><span class="stock-state ${stock <= 10 ? "warn" : ""}">${stock > 0 ? `库存 ${stock}` : "已售罄"}</span></div>
        <h2>${product.name}</h2>
        <p class="muted">${productMetaLine(product, isPure)}</p>
        <div class="service-tags">${productServiceTags(product, isPure).map((tag) => `<span>${tag}</span>`).join("")}</div>
        <div class="price" style="margin-top:8px">${productPriceText(product, isPure)}</div>
      </div>
    </article>
    <section class="notice detail-rule"><strong>${isPure ? "纯积分兑换" : "会员现金购"}</strong><p>${isPure ? "无需开通会员，不展示现金补差入口；积分不足时直接提示积分不足。" : "普通用户需先开通月会员，会员可使用现金购物和积分不足现金补差。"}</p></section>
    ${memberLocked ? `<section class="member-lock"><strong>当前为普通用户</strong><span>开通月会员后可使用现金购买该商品；纯积分商品无需会员。</span><button type="button" data-page="membership">开通月会员</button></section>` : ""}
    <section class="field-card"><h3>履约服务</h3><div class="detail-service-grid"><span>最快 30 分钟送达</span><span>TGG 自建配送队</span><span>师大周边 5km</span><span>支持自提核销</span></div></section>
    <section class="field-card"><h3>商品保障</h3><p>商品由平台统一上架和库存管理；生鲜商品支持坏果包赔，售后进入退款/补偿流程。</p></section>
    <section class="total-bar">
      <button type="button" class="chip active" data-cart-product="${product.id}" ${stock <= 0 ? "disabled" : ""}>${isPure ? "加入兑换车" : "加入购物车"}</button>
      <button type="button" class="primary" data-buy="${product.id}" data-mode="${isPure ? "pure_points" : "cash"}" ${stock <= 0 ? "disabled" : ""}>${isPure ? "立即兑换" : memberLocked ? "开通会员购买" : "立即购买"}</button>
    </section>
  `;
}

function cartView(state) {
  const items = state.cart || [];
  const totalPoints = items.reduce((sum, item) => sum + (item.purePointsOnly ? (item.pointsPrice || 0) * (item.quantity || 1) : 0), 0);
  const totalCash = items.reduce((sum, item) => sum + (!item.purePointsOnly ? (item.cashPrice || 0) * (item.quantity || 1) : 0), 0);
  const mixed = items.some((item) => item.purePointsOnly) && items.some((item) => !item.purePointsOnly);
  const memberLocked = totalCash > 0 && !isMemberUser(state.user);
  return `
    <div class="stack cart-list">
      ${items.length ? items.map((item) => `<article class="cart-row"><img src="${item.image}" alt="${item.name}" loading="lazy" decoding="async" /><span><strong>${item.name}</strong><p class="muted">${item.purePointsOnly ? "纯积分兑换 · 无需会员" : "会员现金商品 · 自建配送"}</p><div class="qty"><button type="button" data-cart-qty="${item.id}" data-delta="-1">-</button><strong>${item.quantity || 1}</strong><button type="button" data-cart-qty="${item.id}" data-delta="1">+</button><button type="button" class="link" data-cart-remove="${item.id}">移除</button></div></span><strong>${lineTotalText(item)}</strong></article>`).join("") : `<div class="empty">购物车为空，请先选择商品</div>`}
    </div>
    ${mixed ? `<section class="notice" style="margin-top:10px"><strong>请分开结算</strong><p>纯积分兑换不提供现金补差入口，现金商品需会员购买。</p></section>` : ""}
    ${memberLocked ? `<section class="member-lock"><strong>现金商品需月会员</strong><span>普通用户可继续兑换纯积分商品；现金商品开通月会员后可结算。</span><button type="button" data-page="membership">开通月会员</button></section>` : ""}
    <section class="total-bar"><span>合计：${totalText(totalCash, totalPoints)}</span><button type="button" class="primary" data-page="checkoutPickup" ${!items.length || mixed ? "disabled" : ""}>去结算</button></section>
  `;
}

function checkoutView(state, type) {
  const delivery = type === "delivery";
  const items = state.cart || [];
  const defaultAddress = (state.addresses || []).find((item) => item.isDefault) || state.addresses?.[0];
  const pickupSite = state.pickupSites?.[0] || state.home?.pickupSite || {};
  const promise = state.home?.deliveryPromise || {};
  const slots = state.config?.deliveryTimeSlots || ["09:00-12:00", "14:00-18:00", "18:00-21:00"];
  const totalPoints = items.reduce((sum, item) => sum + (item.purePointsOnly ? (item.pointsPrice || 0) * (item.quantity || 1) : 0), 0);
  const totalCash = items.reduce((sum, item) => sum + (!item.purePointsOnly ? (item.cashPrice || 0) * (item.quantity || 1) : 0), 0);
  const mixed = items.some((item) => item.purePointsOnly) && items.some((item) => !item.purePointsOnly);
  const pureOnly = items.length > 0 && items.every((item) => item.purePointsOnly);
  const cashOnly = items.length > 0 && items.every((item) => !item.purePointsOnly);
  const memberLocked = cashOnly && !isMemberUser(state.user);
  const deliveryFee = state.config?.deliveryFeeEnabled && delivery && cashOnly ? Number(state.config.deliveryFee || 0) : 0;
  const disabled = !items.length || mixed || (delivery && !defaultAddress);
  return `
    <section class="checkout-head">
      <span>${delivery ? "送货上门" : "到店自提"}</span>
      <strong>${delivery ? promise.title || "最快 30 分钟送达" : "自提点核销取货"}</strong>
      <p>${delivery ? promise.subtitle || "TGG 自建配送队 · 师大周边 5km" : pickupSite.address || "师大东门生活服务中心 1 楼，凭核销码自提"}</p>
    </section>
    <section class="notice" style="margin-top:10px"><strong>${pureOnly ? "纯积分兑换订单" : "会员现金订单"}</strong><p>${pureOnly ? "提交后扣减积分，不展示现金补差入口；积分不足则下单失败。" : mixed ? "纯积分商品和现金商品需要分开结算。" : "现金支付仅会员可用，普通用户会被引导开通月会员。"}</p></section>
    <section class="choice-row checkout-choice" style="margin-top:10px">
      <button type="button" class="choice ${!delivery ? "active" : ""}" data-page="checkoutPickup"><span>到店自提</span></button>
      <button type="button" class="choice ${delivery ? "active" : ""}" data-page="checkoutDelivery"><span>送货上门</span></button>
    </section>
    <section class="field-card"><h3>${delivery ? "收货地址" : "自提点"}</h3><p>${delivery ? addressLine(defaultAddress) || "请先新增默认地址" : pickupSite.name || "师大自提站"} · ${delivery ? "" : pickupSite.address || "后台配置自提点地址"}</p>${delivery ? `<button type="button" class="link" data-page="address">管理地址</button>` : ""}</section>
    <section class="field-card"><h3>配送时间</h3><p>${delivery ? "按后台截单时间计算预计配送日" : "到站后凭核销码取货"}</p><div class="slot-row">${slots.map((slot) => `<span class="state">${slot}</span>`).join("")}</div></section>
    <section class="field-card">
      <h3>商品清单</h3>
      <div class="checkout-items">${items.map((item) => `<p><span>${item.name} x${item.quantity || 1}</span><strong>${lineTotalText(item)}</strong></p>`).join("") || `<p class="muted">暂无商品</p>`}</div>
      <div class="fee-lines" style="margin-top:10px"><p><span>配送费</span><strong>${deliveryFee ? money(deliveryFee) : "¥0.0"}</strong></p></div>
    </section>
    ${memberLocked ? `<section class="member-lock"><strong>现金商品需月会员</strong><span>开通后可现金购买和使用积分不足现金补差。</span><button type="button" data-page="membership">开通月会员</button></section>` : ""}
    <section class="total-bar"><span>合计：${totalText(totalCash + deliveryFee, totalPoints)}</span><button type="button" class="primary" data-checkout-submit="${delivery ? "delivery" : "pickup"}" ${disabled ? "disabled" : ""}>提交订单</button></section>
  `;
}

function ordersView(state) {
  const orders = [...(state.orders || [])].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const pendingCount = orders.filter((order) => ["pending_pickup", "pending_ship", "shipping"].includes(order.fulfillmentStatus)).length;
  const refundCount = orders.filter((order) => ["refunding", "refunded"].includes(order.status)).length;
  return `
    <div class="order-filter"><button type="button" class="active">全部 ${orders.length}</button><button type="button">待履约 ${pendingCount}</button><button type="button">退款 ${refundCount}</button></div>
    <div class="stack">${orders.map((order) => orderCard(order, state)).join("") || `<div class="empty">暂无订单</div>`}</div>
  `;
}

function orderDetailView(state) {
  const order = (state.orders || []).find((item) => item.id === state.selectedOrderId) || state.orders?.[0];
  if (!order) return `<div class="empty">暂无订单详情</div>`;
  const payment = findOrderPayment(state, order);
  return `
    <section class="order-detail-head"><span class="state ${orderStatusTone(order)}">${orderStatusLabel(order.status)}</span><h2>${order.id}</h2><p>${order.fulfillmentType === "pickup" ? "自提核销" : "TGG 自建配送"} · ${fulfillmentStatusLabel(order.fulfillmentStatus)}</p></section>
    <section class="order-summary"><span><strong>${orderAmountText(order)}</strong><em>订单金额</em></span><span><strong>${order.paymentMode === "pure_points" ? "纯积分" : "会员现金"}</strong><em>支付方式</em></span><span><strong>${order.fulfillmentType === "pickup" ? "自提" : "配送"}</strong><em>履约方式</em></span></section>
    ${orderRiskNotice(order)}
    <section class="field-card"><h3>订单进度</h3><div class="order-steps">${orderSteps(order, payment)}</div></section>
    <section class="field-card"><h3>商品清单</h3><div class="order-item-lines">${order.items.map((item) => `<p><span>${item.title || item.name || item.productId} x${item.quantity}</span></p>`).join("")}</div><p class="muted">${paymentHint(order)}</p></section>
    <section class="field-card"><h3>支付与账务</h3>${payment ? paymentDetail(payment) : `<p class="muted">${order.paymentMode === "pure_points" ? "纯积分订单无需现金支付单，积分已按订单状态扣减或退回。" : "暂无支付单，等待发起支付。"}</p>`}<p class="muted">退款时现金和积分将分别按原账务流水退回。</p></section>
    <section class="field-card"><h3>${order.fulfillmentType === "pickup" ? "自提信息" : "配送信息"}</h3>${fulfillmentDetail(order)}</section>
    ${refundStateNotice(order)}
    <section class="total-bar"><button type="button" class="chip active" data-page="orders">返回订单</button><button type="button" class="primary" data-refund="${order.id}" ${canRequestRefund(order) ? "" : "disabled"}>${canRequestRefund(order) ? "申请退款" : "不可退款"}</button></section>
  `;
}

function paymentView(state) {
  const payment = currentPayment(state);
  if (!payment) return `<div class="empty">暂无待支付单</div>`;
  const lfwin = payment.metadata?.lfwin || {};
  const qrUrl = lfwin.qrProxyUrl || "";
  const amount = payment.amount ? money(payment.amount) : `${payment.pointAmount || 0}积分`;
  const payNo = payment.payNo || payment.id;
  return `
    <section class="payment-head">
      <span class="state ${payment.status === "paid" ? "" : "warn"}">${paymentStatusLabel(payment.status)}</span>
      <h2>${amount}</h2>
      <p>${paySceneLabel(payment.payScene)} · ${payNo}</p>
    </section>
    <section class="payment-qr-panel">
      ${qrUrl ? `<img src="${escapeAttr(qrUrl)}" alt="支付二维码" loading="eager" decoding="async" />` : `<div class="empty">二维码生成失败，请返回支付记录重试</div>`}
    </section>
    <section class="field-card">
      <h3>支付信息</h3>
      <p>${channelLabel(payment.channel)} · ${lfwin.providerOrderNo || "待提交"}</p>
      <p class="muted">支付完成后刷新状态，回调成功后订单会自动进入履约。</p>
    </section>
    <section class="total-bar"><button type="button" class="chip active" data-page="${payment.orderId ? "orderDetail" : "payments"}">返回</button><button type="button" class="primary" data-payment-refresh="${escapeAttr(payNo)}">刷新状态</button></section>
  `;
}

function pickupSiteView(state) {
  return `<div class="stack">${(state.pickupSites || []).map((site) => `<article class="field-card"><h3>${site.name}</h3><p>${site.address}</p><p class="muted">${site.contactName || "站点代理"} · ${site.contactPhone || ""}</p></article>`).join("") || `<div class="empty">暂无自提点</div>`}</div>`;
}

function addressView(state) {
  const editing = (state.addresses || []).find((item) => item.id === state.editingAddressId) || {};
  return `
    <form class="form" data-address-form>
      <input name="receiverName" placeholder="收货人" value="${editing.receiverName || ""}" required />
      <input name="mobile" placeholder="手机号" value="${editing.mobile || ""}" required />
      <input name="province" placeholder="省份" value="${editing.province || ""}" />
      <input name="city" placeholder="城市" value="${editing.city || ""}" />
      <input name="district" placeholder="区域" value="${editing.district || ""}" />
      <textarea name="detail" placeholder="详细地址" required>${editing.detail || ""}</textarea>
      <label class="check-row"><input name="isDefault" type="checkbox" ${editing.isDefault ? "checked" : ""}> 设为默认地址</label>
      <button type="submit" class="primary">${editing.id ? "保存地址" : "新增地址"}</button>
    </form>
    <div class="stack" style="margin-top:12px">${(state.addresses || []).map((item) => `<article class="list-card"><h3>${item.receiverName} ${item.mobile || ""}</h3><p>${addressLine(item)}</p><p>${item.isDefault ? `<span class="state">默认</span>` : ""}</p><button type="button" class="link" data-edit-address="${item.id}">编辑</button> <button type="button" class="link" data-default-address="${item.id}">设默认</button> <button type="button" class="link" data-delete-address="${item.id}">删除</button></article>`).join("") || `<div class="empty">暂无地址</div>`}</div>
  `;
}

function profileView(state) {
  const user = state.user || {};
  const memberActive = isMemberUser(user);
  const memberDaysLeft = getMemberDaysLeft(user);
  return `
    <section class="profile-head">
      <div class="name-row"><span class="avatar">${(user.nickname || "T").slice(0, 1)}</span><div><strong>${user.nickname || "TGG 用户"}</strong><p>${memberActive ? "月会员" : "普通用户"}</p></div><button type="button" class="pill-button" data-page="membership">会员</button></div>
      <div class="metrics"><span><strong>${user.points || 0}</strong>积分</span><span><strong>${money(user.withdrawableBalance || 0)}</strong>可提现</span><span><strong>${memberActive ? `${memberDaysLeft}天` : "未开通"}</strong>会员</span></div>
    </section>
    <section class="menu-list" style="margin-top:12px">
      ${profileButton("orders", "我的订单")}
      ${profileButton("pointsLedger", "积分明细")}
      ${profileButton("payments", "支付记录")}
      ${profileButton("withdraw", "提现")}
      ${profileButton("address", "收货地址")}
      ${profileButton("agentScan", "代理核销")}
      ${profileButton("ranking", "积分排行榜")}
      ${profileButton("refund", "退款申请")}
      ${profileButton("customerService", "联系客服")}
      ${profileButton("feedback", "意见反馈")}
      ${profileButton("business", "商务合作")}
      ${profileButton("recruiting", "招聘岗位")}
    </section>
  `;
}

function membershipView(state) {
  const user = state.user || {};
  const memberActive = isMemberUser(user);
  const memberDaysLeft = getMemberDaysLeft(user);
  return `
    <section class="soft-card" style="padding:22px;background:#e8fbf1"><h2 style="margin:0;color:var(--green-dark)">月会员</h2><p class="muted">普通用户升级为会员需开通月会员；会员可现金购物，也可在积分不足时现金补差。</p></section>
    <section class="field-card"><h3>当前状态</h3><p>${memberActive ? `会员剩余 ${memberDaysLeft} 天，有效期至 ${formatDate(user.memberUntil)}` : "当前为普通用户，可使用纯积分兑换，不可现金购物。"}</p></section>
    <section class="field-card"><h3>会员权益</h3><p>现金购物、积分不足现金补差、会员价商品。纯积分兑换无需会员。</p></section>
    <button type="button" class="primary" style="width:100%;margin-top:18px" data-action="member">${memberActive ? "续费 1 个月会员" : "开通 1 个月会员"}</button>
  `;
}

function pointsLedgerView(state) {
  return `<div class="stack">${(state.pointLedger || []).map((item) => `<article class="ledger-row"><span class="state ${item.direction === "out" ? "warn" : ""}">${item.direction === "out" ? "支出" : "收入"}</span><span><strong>${ledgerTypeLabel(item.changeType)}</strong><p class="muted">${item.bizNo || "-"} · ${formatDate(item.createdAt)}</p></span><strong>${item.direction === "out" ? "-" : "+"}${item.points}</strong></article>`).join("") || `<div class="empty">暂无积分流水</div>`}</div>`;
}

function paymentsView(state) {
  return `<div class="stack">${(state.payments || []).map(paymentCard).join("") || `<div class="empty">暂无支付记录</div>`}</div>`;
}

function rankingView(state) {
  const rows = state.ranking?.rows || [];
  return `<section class="notice"><strong>积分排行榜</strong><p>榜单默认统计签到、抽奖、任务奖励、邀请奖励、邀请提成等入账类型。</p></section><div class="stack" style="margin-top:12px">${rows.map((item) => `<article class="rank-row"><span class="state">#${item.rank}</span><span><strong>${item.nickname}</strong><p class="muted">${item.userId}</p></span><strong>${item.score}</strong></article>`).join("") || `<div class="empty">暂无排行</div>`}</div>`;
}

function agentScanView() {
  return `<section class="agent-code"><div class="qr"></div></section><section class="notice"><strong>代理核销</strong><p>自提点仅承担核销码验证，不接入第三方物流。请输入用户订单核销码后由后台完成校验。</p></section>`;
}

function withdrawView(state) {
  const balance = Number(state.user?.withdrawableBalance || 0);
  return `
    <section class="field-card"><h3>可提现余额</h3><p style="font-size:22px;color:var(--green);font-weight:900">${money(balance)}</p><p class="muted">最低提现金额 ${money(state.config?.withdrawMinAmount || 1)}，手续费率 ${Number(state.config?.withdrawFeeRate || 0.01) * 100}%。</p></section>
    <button type="button" class="primary" style="width:100%;margin-top:12px" data-action="withdraw" ${balance < Number(state.config?.withdrawMinAmount || 1) ? "disabled" : ""}>申请提现 1 元</button>
    <div class="stack" style="margin-top:12px">${(state.withdrawals || []).map((item) => `<article class="list-card"><h3>${money(item.amount)} · ${withdrawStatusLabel(item.status)}</h3><p>${item.channel || "wechat"} · 手续费 ${money(item.fee || 0)}</p></article>`).join("") || `<div class="empty">暂无提现记录</div>`}</div>
  `;
}

function refundView(state) {
  const order = state.orders?.[0];
  return `<section class="field-card"><h3>订单：${order?.id || "暂无订单"}</h3><p>${order ? order.items.map((item) => item.title || item.name).join("、") : "请先创建订单"}</p></section><section class="field-card"><h3>退款规则</h3><p>现金和积分分别原路退回，纯积分订单只退积分；后台财务复核后执行。</p></section><form class="form"><textarea placeholder="请填写退款原因"></textarea><button type="button" class="primary" data-refund="${order?.id || ""}">提交申请</button></form>`;
}

function pointsExchangeView(state) {
  return `<section class="notice"><strong>纯积分兑换专区</strong><p>无需会员，不展示现金补差入口；积分不足直接提示。</p></section><div class="product-grid" style="margin-top:12px">${productCards(state.exchangeProducts || [], "points")}</div>`;
}

function ticketActionView(state, type, title, text, button) {
  const tickets = (state.supportTickets || []).filter((item) => item.type === type);
  return `
    <section class="soft-card" style="padding:28px 20px;text-align:center;background:#e8fbf1"><h2 style="color:var(--green);margin:0 0 8px">${title}</h2><p class="muted">${text}</p></section>
    <form class="form" style="margin-top:12px" data-ticket-form>
      <input type="hidden" name="type" value="${type}" />
      <input name="subject" placeholder="${title}" value="${title}" />
      <input name="contactName" placeholder="联系人" value="${state.user?.nickname || ""}" />
      <input name="contactPhone" placeholder="联系电话" value="${state.user?.phone || ""}" />
      <textarea name="content" placeholder="请描述具体问题或合作需求" required></textarea>
      <button type="submit" class="primary">${button}</button>
    </form>
    <div class="stack" style="margin-top:12px">${tickets.map((item) => `<article class="list-card"><h3>${item.subject} · ${ticketStatusLabel(item.status)}</h3><p>${item.content}</p>${item.adminReply ? `<p class="muted">回复：${item.adminReply}</p>` : ""}</article>`).join("") || `<div class="empty">暂无提交记录</div>`}</div>
  `;
}

function productCards(products = [], mode = "cash") {
  return products.map((product) => {
    const isPure = product.purePointsOnly || mode === "points";
    return `<article class="product-card"><img src="${product.image}" alt="${product.name}" data-product-open="${product.id}" loading="lazy" decoding="async"><span class="tag">${product.tag || (isPure ? "兑换" : "会员价")}</span><h3 data-product-open="${product.id}">${product.name}</h3><p class="product-meta">${productMetaLine(product, isPure)}</p><div class="service-tags">${productServiceTags(product, isPure).slice(0, 2).map((tag) => `<span>${tag}</span>`).join("")}</div><div class="price-row"><strong class="price ${isPure ? "exchange-price" : ""}">${productPriceText(product, isPure)}</strong><button type="button" class="add" data-cart-product="${product.id}">${isPure ? "兑" : "+"}</button></div><p class="stock-hint">库存 ${product.stock ?? 0}</p></article>`;
  }).join("") || `<div class="empty">暂无商品</div>`;
}

function horizontalProduct(product) {
  const isPure = product.purePointsOnly;
  return `<article class="horizontal-product"><img src="${product.image}" alt="${product.name}" data-product-open="${product.id}" loading="lazy" decoding="async" /><div class="horizontal-product-body"><div><span class="tag">${product.tag || (isPure ? "兑换" : "会员价")}</span><span class="stock-state ${Number(product.stock || 0) <= 10 ? "warn" : ""}">库存 ${product.stock ?? 0}</span></div><strong data-product-open="${product.id}">${product.name}</strong><p>${productMetaLine(product, isPure)}</p><div class="service-tags">${productServiceTags(product, isPure).slice(0, 2).map((tag) => `<span>${tag}</span>`).join("")}</div><div class="price-row"><strong class="price ${isPure ? "exchange-price" : ""}">${productPriceText(product, isPure)}</strong><button type="button" class="add" data-cart-product="${product.id}">${isPure ? "兑" : "+"}</button></div></div></article>`;
}

function floatingCart(state) {
  const items = state.cart || [];
  if (!items.length) return "";
  const count = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
  const totalPoints = items.reduce((sum, item) => sum + (item.purePointsOnly ? (item.pointsPrice || 0) * (item.quantity || 1) : 0), 0);
  const totalCash = items.reduce((sum, item) => sum + (!item.purePointsOnly ? (item.cashPrice || 0) * (item.quantity || 1) : 0), 0);
  return `<button type="button" class="floating-cart" data-page="cart"><span><i>${count}</i> 件商品</span><strong>${totalText(totalCash, totalPoints)}</strong><em>去结算</em></button>`;
}

function homeSignature(state) {
  const home = state.home || {};
  const pickup = home.pickupSite || state.pickupSites?.[0] || {};
  const promise = home.deliveryPromise || {};
  const products = (state.products || []).map((item) => [
    item.id,
    item.name,
    item.image,
    item.cashPrice,
    item.pointsPrice,
    item.stock,
    item.purePointsOnly,
    item.tag
  ]);
  const cart = (state.cart || []).map((item) => [
    item.id,
    item.quantity,
    item.cashPrice,
    item.pointsPrice,
    item.purePointsOnly
  ]);
  return JSON.stringify({
    pickup: [pickup.id, pickup.name],
    promise: [promise.title, promise.subtitle, promise.cutoffText, promise.serviceAreaText],
    badges: home.serviceBadges || [],
    promotions: home.promotionEntries || [],
    products,
    cart
  });
}

function categoryRow() {
  return `<section class="category-row">${categories.slice(0, 5).map((name) => `<button type="button" class="link" data-tab="${name === "任务" ? "earn" : "category"}"><span class="cat-icon">${name[0]}</span><span class="cat-name">${name}</span></button>`).join("")}</section>`;
}

function orderCard(order, state = {}) {
  const payment = findOrderPayment(state, order);
  return `<article class="order-card rich-order-card" data-order-open="${order.id}"><div class="order-card-head"><strong>${order.id}</strong><span class="state ${orderStatusTone(order)}">${orderStatusLabel(order.status)}</span></div><p class="order-card-items">${order.items.map((item) => `${item.title || item.name || item.productId} x${item.quantity}`).join("、")}</p><div class="order-card-meta"><span>${order.fulfillmentType === "pickup" ? "自提" : "自建配送"}</span><span>${fulfillmentStatusLabel(order.fulfillmentStatus)}</span><span>${orderAmountText(order)}</span></div><p class="muted">${paymentHint(order)}</p>${payment ? `<p class="muted">支付单：${payment.payNo || payment.id} · ${payment.status}</p>` : ""}${order.pickupCode ? `<div class="order-code"><span>核销码</span><strong>${order.pickupCode}</strong></div>` : ""}</article>`;
}

function paymentCard(payment) {
  return `<article class="ledger-row"><span class="state ${payment.status === "paid" ? "" : "warn"}">${paymentStatusLabel(payment.status)}</span><span><strong>${payment.payNo || payment.id}</strong><p class="muted">${paySceneLabel(payment.payScene)} / ${channelLabel(payment.channel)} / ${payment.thirdTradeNo || "待回调"}</p>${paymentAction(payment)}</span><strong>${payment.amount ? money(payment.amount) : `${payment.pointAmount || 0}积分`}</strong></article>`;
}

function paymentDetail(payment) {
  return `<p><strong>${payment.payNo || payment.id}</strong></p><p class="muted">${paySceneLabel(payment.payScene)} · ${channelLabel(payment.channel)} · ${paymentStatusLabel(payment.status)}</p><p class="muted">三方单号：${payment.thirdTradeNo || "待回调"}</p><p class="muted">幂等键：${payment.idempotencyKey || "-"}</p>${paymentAction(payment)}`;
}

function paymentAction(payment = {}) {
  const hasQr = Boolean(payment.metadata?.lfwin?.qrProxyUrl || payment.metadata?.lfwin?.codeUrl || payment.metadata?.lfwin?.paymentUrl);
  if (payment.status !== "pending" || !hasQr) return "";
  return `<p style="margin-top:8px"><button type="button" class="primary payment-open-button" data-payment-open="${escapeAttr(payment.payNo || payment.id)}">打开支付页面</button></p>`;
}

function fulfillmentDetail(order) {
  if (order.fulfillmentType === "pickup") {
    return `<div class="fulfillment-panel"><div class="order-code large"><span>自提核销码</span><strong>${order.pickupCode || "支付后生成"}</strong></div><p>到达自提点后由代理核销；自提点由后台统一配置。</p><p class="muted">核销失败或订单异常时进入客服工单/异常补偿队列。</p></div>`;
  }
  return `<div class="fulfillment-panel"><p><strong>${fulfillmentStatusLabel(order.fulfillmentStatus)}</strong></p><p>TGG 自建配送团队送货上门，不对接第三方物流。</p>${deliveryTimeline(order)}${order.deliveryDate ? `<p class="muted">预计配送：${order.deliveryDate}</p>` : ""}</div>`;
}

function deliveryTimeline(order) {
  const status = order.fulfillmentStatus;
  const steps = [
    ["待分配配送员", ["pending_ship", "shipping", "delivered", "completed"].includes(status)],
    ["配送中", ["shipping", "delivered", "completed"].includes(status)],
    ["已送达", ["delivered", "completed"].includes(status)]
  ];
  return `<div class="timeline">${steps.map(([label, active]) => `<span class="timeline-step ${active ? "active" : ""}"><i></i>${label}</span>`).join("")}</div>`;
}

function orderSteps(order, payment) {
  const paid = order.paymentMode === "pure_points" || payment?.status === "paid" || ["paid", "completed", "refunding", "refunded"].includes(order.status);
  const fulfilled = order.status === "completed" || ["delivered", "picked_up", "completed"].includes(order.fulfillmentStatus);
  const inFulfillment = ["pending_pickup", "pending_ship", "shipping", "delivered", "picked_up", "completed"].includes(order.fulfillmentStatus);
  const steps = [
    ["提交订单", true],
    [order.paymentMode === "pure_points" ? "扣减积分" : "完成支付", paid],
    [order.fulfillmentType === "pickup" ? "待自提" : "配送履约", inFulfillment],
    [order.fulfillmentType === "pickup" ? "已核销" : "已送达", fulfilled]
  ];
  return steps.map(([label, active], index) => `<span class="order-step ${active ? "active" : ""}"><i>${index + 1}</i>${label}</span>`).join("");
}

function currentTask(state) {
  return state.selectedTask || state.tasks?.[0] || { id: "task_001", title: "任务详情", rewardPoints: 0 };
}

function taskFields(task = {}) {
  const fields = task.submitFields || task.option || [];
  return Array.isArray(fields) ? fields.map(String) : String(fields || "").split(",").filter(Boolean);
}

function fieldInput(field) {
  const label = fieldLabel(field);
  if (["name", "mobile", "phone"].includes(field)) return `<input name="${field === "phone" ? "mobile" : field}" placeholder="${label}" />`;
  if (["imgea", "images", "screenshot"].includes(field)) return `<input name="images" placeholder="截图链接，多个图片用逗号隔开" />`;
  return `<textarea name="${field}" placeholder="${label}"></textarea>`;
}

function renderTaskContent(task = {}) {
  if (Array.isArray(task.content) && task.content.length) {
    return task.content.map((block) => `<p>${stripHtml(block.txt || "")}</p>${(block.img_list || []).slice(0, 3).map((src) => `<img src="${src}" alt="任务步骤" style="width:100%;border-radius:8px;margin-top:8px">`).join("")}`).join("");
  }
  return `<p>1. 按要求完成注册、浏览或发布。</p><p>2. 保留手机号、账号或截图凭证。</p><p>3. 提交后等待后台审核。</p>`;
}

function productPriceText(product, isPure = product.purePointsOnly) {
  return isPure ? `${product.pointsPrice}积分` : money(product.cashPrice);
}

function isMemberUser(user = {}) {
  if (typeof user?.isMember === "boolean") return user.isMember;
  return Boolean(user?.memberUntil && new Date(user.memberUntil).getTime() > Date.now());
}

function getMemberDaysLeft(user = {}) {
  if (!isMemberUser(user)) return 0;
  if (Number.isFinite(Number(user.memberDaysLeft))) return Math.max(0, Number(user.memberDaysLeft));
  return Math.max(0, Math.ceil((new Date(user.memberUntil).getTime() - Date.now()) / 86400000));
}

function productMetaLine(product, isPure = product.purePointsOnly) {
  const spec = product.spec || product.origin || product.category || (isPure ? "纯积分兑换" : "会员现金购");
  const sales = product.monthlySales || product.salesText || "月售 100+";
  return `${spec} · ${sales}`;
}

function productServiceTags(product, isPure = product.purePointsOnly) {
  return product.serviceTags || (isPure ? ["无需会员", "不支持现金补差"] : ["会员现金购", "自建配送"]);
}

function lineTotalText(item) {
  const quantity = item.quantity || 1;
  return item.purePointsOnly ? `${(item.pointsPrice || 0) * quantity}积分` : money((item.cashPrice || 0) * quantity);
}

function totalText(totalCash, totalPoints) {
  if (totalCash && totalPoints) return `${money(totalCash)} + ${totalPoints}积分`;
  if (totalCash) return money(totalCash);
  if (totalPoints) return `${totalPoints}积分`;
  return money(0);
}

function findOrderPayment(state = {}, order = {}) {
  return (state.payments || []).find((payment) => payment.orderId === order.id);
}

function currentPayment(state = {}) {
  const selected = state.selectedPaymentId;
  const payments = state.payments || [];
  return payments.find((payment) => payment.payNo === selected || payment.id === selected)
    || payments.find((payment) => payment.status === "pending" && payment.metadata?.lfwin)
    || payments[0];
}

function canRequestRefund(order) {
  return ["paid", "completed"].includes(order.status) && !["refunding", "refunded", "cancelled", "closed"].includes(order.status);
}

function paymentHint(order) {
  if (order.paymentMode === "pure_points") return `积分已扣减：${order.pointAmount || 0}`;
  if (order.status === "pending_payment") return `待支付：${money(order.cashAmount || 0)}`;
  if (order.paymentMode === "points_plus_cash") return `支付完成：${money(order.cashAmount || 0)} + ${order.pointAmount || 0}积分`;
  return `支付完成：${money(order.cashAmount || 0)}`;
}

function orderStatusLabel(status) {
  return ({ pending_payment: "待支付", paid: "已支付", completed: "已完成", refunding: "退款中", refunded: "已退款", cancelled: "已取消", closed: "已关闭" })[status] || status || "-";
}

function fulfillmentStatusLabel(status) {
  return ({ not_started: "待支付", pending_pickup: "待自提", pending_ship: "待配送", shipping: "配送中", delivered: "已送达", picked_up: "已核销", completed: "已完成" })[status] || status || "待履约";
}

function orderStatusTone(order) {
  if (["refunding", "pending_payment"].includes(order.status)) return "warn";
  if (["refunded", "cancelled", "closed"].includes(order.status)) return "muted-state";
  return "";
}

function orderAmountText(order) {
  const cash = Number(order.cashAmount || 0);
  const points = Number(order.pointAmount || 0);
  if (cash && points) return `${money(cash)} + ${points}积分`;
  if (cash) return money(cash);
  if (points) return `${points}积分`;
  return money(0);
}

function refundStateNotice(order) {
  if (order.status === "refunding") return `<section class="exception-note"><strong>退款处理中</strong><p>退款将由财务审核，现金和积分分别原路退回；失败会进入异常补偿队列。</p></section>`;
  if (order.status === "refunded") return `<section class="exception-note resolved"><strong>退款已完成</strong><p>相关账务流水已完成回退，可在支付记录/积分明细中核对。</p></section>`;
  return "";
}

function orderRiskNotice(order) {
  if (["cancelled", "closed"].includes(order.status)) return `<section class="exception-note"><strong>订单已${orderStatusLabel(order.status)}</strong><p>如已扣减积分或现金但订单未履约，请联系客服进入异常补偿处理。</p></section>`;
  return "";
}

function addressLine(address = {}) {
  return [address.province, address.city, address.district, address.detail].filter(Boolean).join(" ");
}

function profileButton(page, label) {
  return `<button type="button" data-page="${page}"><span>${label}</span><span>&gt;</span></button>`;
}

function fieldLabel(field) {
  return ({ name: "姓名", mobile: "手机号", phone: "手机号", text1: "备注1", text2: "备注2", imgea: "截图", images: "截图", screenshot: "截图" })[field] || field;
}

function statusLabel(status) {
  return ({ reviewing: "审核中", approved: "已通过", rejected: "已拒绝" })[status] || status || "-";
}

function ledgerTypeLabel(type) {
  return ({ exchange_deduct: "兑换扣积分", shopping_deduct: "购物扣积分", refund_return: "退款返积分", task_reward: "任务奖励", invite_reward: "邀请奖励", invite_commission: "邀请提成", signin_reward: "签到奖励", lottery_reward: "抽奖奖励" })[type] || type || "-";
}

function paymentStatusLabel(status) {
  return ({ pending: "待回调", paid: "已支付", failed: "失败", refunded: "已退款", cancelled: "已取消" })[status] || status || "-";
}

function paySceneLabel(scene) {
  return ({ goods_cash: "现金购物", member_open: "会员开通", cash_diff: "积分补差" })[scene] || scene || "-";
}

function channelLabel(channel) {
  return ({
    mock_pay: "模拟支付",
    mock_refund: "模拟退款",
    wechat: "微信",
    alipay: "支付宝",
    lfwin_qrcode: "LFWin扫码",
    lfwin_wechat_qrcode: "微信扫码",
    lfwin_alipay_qrcode: "支付宝扫码"
  })[channel] || channel || "-";
}

function escapeAttr(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function withdrawStatusLabel(status) {
  return ({ pending_review: "待审核", success: "已打款", rejected: "已驳回", failed: "失败" })[status] || status || "-";
}

function ticketStatusLabel(status) {
  return ({ open: "待处理", processing: "处理中", resolved: "已处理", closed: "已关闭" })[status] || status || "-";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, "").slice(0, 260);
}
