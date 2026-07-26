import { api, loginUser } from "./api.js";
import { renderPage, toast } from "./render.js";

const state = {
  page: "home",
  activeTab: "home",
  tabsBound: false,
  user: null,
  home: {},
  products: [],
  exchangeProducts: [],
  taskTypes: [],
  tasks: [],
  submissions: [],
  orders: [],
  invite: null,
  pickupSites: [],
  deliveryTeams: [],
  addresses: [],
  signinStatus: null,
  pointLedger: [],
  payments: [],
  ranking: null,
  withdrawals: [],
  supportTickets: [],
  selectedProduct: null,
  selectedTask: null,
  selectedOrderId: null,
  selectedPaymentId: null,
  editingAddressId: null,
  categoryName: "全部",
  categoryMode: "all",
  cart: []
};

async function safeApi(path, fallback, options) {
  try {
    return await api(path, options);
  } catch (error) {
    toast(error.message);
    return fallback;
  }
}

async function loadInitialData() {
  const [home, config, exchangeProducts, taskTypes, tasks, submissions, orders, invite, pickupSites, deliveryTeams, addresses, signinStatus, pointLedger, payments, ranking, withdrawals, supportTickets] = await Promise.all([
    safeApi("/api/home", {}),
    safeApi("/api/config", {}),
    safeApi("/api/points-exchange", []),
    safeApi("/api/task-types", []),
    safeApi("/api/tasks", []),
    safeApi("/api/submissions", []),
    safeApi("/api/orders", []),
    safeApi("/api/invite/info", null),
    safeApi("/api/pickup-sites", []),
    safeApi("/api/delivery/teams", []),
    safeApi("/api/addresses", []),
    safeApi("/api/signin/status", null),
    safeApi("/api/points-ledger", []),
    safeApi("/api/payments", []),
    safeApi("/api/ranking", null),
    safeApi("/api/withdrawals", []),
    safeApi("/api/tickets", [])
  ]);

  state.home = home;
  state.config = config;
  state.user = home.user || (await safeApi("/api/me", null));
  state.products = home.recommendProducts || [];
  state.exchangeProducts = exchangeProducts;
  state.taskTypes = taskTypes;
  state.tasks = tasks;
  state.submissions = submissions;
  state.orders = orders;
  state.invite = invite;
  state.pickupSites = pickupSites;
  state.deliveryTeams = deliveryTeams;
  state.addresses = addresses;
  state.signinStatus = signinStatus;
  state.pointLedger = pointLedger;
  state.payments = payments;
  state.ranking = ranking;
  state.withdrawals = withdrawals;
  state.supportTickets = supportTickets;
  renderPage(state);
}

async function refreshUser() {
  state.user = await safeApi("/api/me", state.user);
  state.orders = await safeApi("/api/orders", state.orders);
  state.pointLedger = await safeApi("/api/points-ledger", state.pointLedger);
  state.payments = await safeApi("/api/payments", state.payments);
  state.ranking = await safeApi("/api/ranking", state.ranking);
}

function cartItemsForOrder(items = state.cart) {
  return items.map((item) => ({ productId: item.id, quantity: Math.max(1, Number(item.quantity || 1)) }));
}

function getDefaultPaymentMode(items) {
  if (items.every((item) => item.purePointsOnly)) return "pure_points";
  if (items.some((item) => item.purePointsOnly)) return null;
  return "cash";
}

function isMemberUser() {
  const user = state.user;
  if (!user) return false;
  if (typeof user.isMember === "boolean") return user.isMember;
  return Boolean(user.memberUntil && new Date(user.memberUntil).getTime() > Date.now());
}

function hasCashItems(items = []) {
  return items.some((item) => !item.purePointsOnly);
}

function ensureMemberForCash(items = [], message = "现金商品需要开通月会员后购买") {
  if (!hasCashItems(items) || isMemberUser()) return true;
  toast(message);
  state.page = "membership";
  renderPage(state);
  return false;
}

function getDeliveryAddressText() {
  const address = state.addresses.find((item) => item.isDefault) || state.addresses[0];
  if (!address) return "";
  return [address.province, address.city, address.district, address.detail].filter(Boolean).join(" ");
}

async function submitOrder(items, paymentMode, fulfillmentType = "pickup") {
  if (!items.length) return toast("请先选择商品");
  if (!paymentMode) return toast("纯积分商品请单独结算，避免出现现金补差入口");
  if (!ensureMemberForCash(items, "现金商品需要先开通月会员，纯积分兑换无需会员")) return;
  const payload = {
    paymentMode,
    fulfillmentType,
    pickupSiteId: fulfillmentType === "pickup" ? state.pickupSites[0]?.id || "site_001" : undefined,
    deliveryAddress: fulfillmentType === "delivery" ? getDeliveryAddressText() : undefined,
    deliveryTimeSlot: fulfillmentType === "delivery" ? state.config?.deliveryTimeSlots?.[0] : undefined,
    items: cartItemsForOrder(items)
  };
  const order = await api("/api/orders", { method: "POST", body: JSON.stringify(payload) });
  if (order.status === "pending_payment") {
    const payment = await api(`/api/orders/${order.id}/payments`, { method: "POST", body: JSON.stringify({ channel: "lfwin_wechat_qrcode" }) });
    const lfwin = await api(`/api/payments/${payment.payNo}/lfwin`, {
      method: "POST",
      body: JSON.stringify({ method: "wechat_qrcode", description: "TGG Shop 商品微信支付" })
    });
    toast("请扫码完成支付");
    await refreshUser();
    state.selectedOrderId = order.id;
    state.cart = state.cart.filter((cartItem) => !items.some((item) => item.id === cartItem.id));
    showPaymentPage(lfwin.payment || payment);
    return;
  } else {
    toast("纯积分兑换成功，已生成核销码");
  }
  await refreshUser();
  state.cart = state.cart.filter((cartItem) => !items.some((item) => item.id === cartItem.id));
  state.page = "orders";
  renderPage(state);
}

async function createOrder(productId, paymentMode, fulfillmentType = "pickup") {
  const product = findProduct(productId);
  if (!product) return toast("商品不存在");
  if (!ensureMemberForCash([product], "开通月会员后可使用现金购买该商品")) return;
  return submitOrder([{ ...product, quantity: 1 }], paymentMode, fulfillmentType);
}

async function startSignin() {
  const session = await api("/api/signin/start", { method: "POST", body: "{}" });
  let progress = session;
  const totalAds = session.adGroups * 2;
  for (let index = session.completedAds || 0; index < totalAds; index += 1) {
    progress = await api("/api/signin/ad_complete", { method: "POST", body: JSON.stringify({ sessionId: session.sessionId }) });
  }
  const prize = await api("/api/signin/lottery_spin", { method: "POST", body: JSON.stringify({ sessionId: session.sessionId }) });
  await refreshUser();
  toast(`已完成 ${progress.completedGroups} 组广告，抽奖结果：${prize.label}`);
  renderPage(state);
}

async function subscribeMember() {
  const result = await api("/api/member/subscribe", { method: "POST", body: JSON.stringify({ months: 1, channel: "lfwin_wechat_qrcode", autoPay: false }) });
  const lfwin = await api(`/api/payments/${result.payment.payNo}/lfwin`, {
    method: "POST",
    body: JSON.stringify({ method: "wechat_qrcode", description: "TGG Shop 月会员微信支付" })
  });
  await refreshUser();
  toast("请扫码完成会员支付");
  showPaymentPage(lfwin.payment || result.payment);
}

function showPaymentPage(payment = {}) {
  state.selectedPaymentId = payment.payNo || payment.id || state.selectedPaymentId;
  if (payment.orderId) state.selectedOrderId = payment.orderId;
  state.page = "payment";
  renderPage(state);
}

async function refreshPayment(payNo) {
  if (!payNo) return toast("暂无支付单");
  await api(`/api/payments/${payNo}/lfwin/query`, { method: "POST", body: "{}" });
  await refreshUser();
  const payment = state.payments.find((item) => item.payNo === payNo || item.id === payNo);
  toast(payment?.status === "paid" ? "支付已完成" : "支付状态已刷新");
  renderPage(state);
}

async function submitTask(form) {
  const task = state.selectedTask || state.tasks[0];
  if (!task) return toast("暂无可提交任务");
  const payload = Object.fromEntries(new FormData(form).entries());
  const submission = await api(`/api/tasks/${task.id}/submit`, { method: "POST", body: JSON.stringify(payload) });
  state.submissions = [submission, ...state.submissions];
  state.page = "submissions";
  toast("任务已提交，等待后台审核");
  renderPage(state);
}

async function openTask(taskId) {
  const fallback = state.tasks.find((task) => task.id === taskId);
  state.selectedTask = await safeApi(`/api/tasks/${taskId}`, fallback);
  setPage("taskDetail");
}

async function requestRefund(orderId) {
  if (!orderId) return toast("暂无可退款订单");
  await api(`/api/orders/${orderId}/refunds`, { method: "POST", body: JSON.stringify({ reason: "用户前端申请退款" }) });
  toast("退款申请已提交，等待财务审核");
  await refreshUser();
  renderPage(state);
}

async function requestWithdrawal() {
  const withdrawal = await api("/api/withdrawals", { method: "POST", body: JSON.stringify({ amount: 1, channel: "wechat" }) });
  state.withdrawals = [withdrawal, ...state.withdrawals];
  await refreshUser();
  toast("提现申请已提交，等待财务审核");
  renderPage(state);
}

async function submitTicket(form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  const ticket = await api("/api/tickets", { method: "POST", body: JSON.stringify(payload) });
  state.supportTickets = [ticket, ...state.supportTickets];
  toast("已提交，后台客服会跟进处理");
  renderPage(state);
}

async function saveAddress(form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.isDefault = form.querySelector("[name=isDefault]")?.checked || state.addresses.length === 0;
  const addressId = state.editingAddressId;
  const saved = await api(addressId ? `/api/addresses/${addressId}` : "/api/addresses", {
    method: addressId ? "PATCH" : "POST",
    body: JSON.stringify(payload)
  });
  state.addresses = addressId ? state.addresses.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...state.addresses];
  if (saved.isDefault) state.addresses = state.addresses.map((item) => ({ ...item, isDefault: item.id === saved.id }));
  state.editingAddressId = null;
  toast(addressId ? "地址已更新" : "地址已新增");
  renderPage(state);
}

async function setDefaultAddress(addressId) {
  const saved = await api(`/api/addresses/${addressId}`, { method: "PATCH", body: JSON.stringify({ isDefault: true }) });
  state.addresses = state.addresses.map((item) => ({ ...item, isDefault: item.id === saved.id }));
  toast("默认地址已更新");
  renderPage(state);
}

async function deleteAddress(addressId) {
  await api(`/api/addresses/${addressId}`, { method: "DELETE" });
  state.addresses = await safeApi("/api/addresses", state.addresses.filter((item) => item.id !== addressId));
  state.editingAddressId = null;
  toast("地址已删除");
  renderPage(state);
}

function setPage(page) {
  if (state.page === page) return;
  state.page = page;
  renderPage(state);
}

async function switchTab(tab) {
  if (!tab) return;
  if (state.activeTab === tab && state.page === tab) return;
  state.activeTab = tab;
  document.querySelectorAll(".tabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  setPage(tab);
}

function findProduct(productId) {
  return state.products.concat(state.exchangeProducts).find((item) => item.id === productId);
}

function addToCart(product) {
  const existing = state.cart.find((item) => item.id === product.id);
  if (existing) existing.quantity = Math.min(99, Number(existing.quantity || 1) + 1);
  else state.cart.push({ ...product, quantity: 1 });
}

function changeCartQuantity(productId, delta) {
  const item = state.cart.find((candidate) => candidate.id === productId);
  if (!item) return;
  item.quantity = Math.max(1, Math.min(99, Number(item.quantity || 1) + delta));
  renderPage(state);
}

function setCategoryName(name) {
  if (state.categoryName === (name || "全部") && state.page === "category") return;
  state.categoryName = name || "全部";
  state.page = "category";
  state.activeTab = "category";
  renderPage(state);
}

function setCategoryMode(mode) {
  if (state.categoryMode === (mode || "all") && state.page === "category") return;
  state.categoryMode = mode || "all";
  state.page = "category";
  state.activeTab = "category";
  renderPage(state);
}

function bindTabs() {
  if (state.tabsBound) return;
  state.tabsBound = true;

  document.querySelector(".tabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    switchTab(button.dataset.tab).catch((error) => toast(error.message));
  });
}

function bindGlobalActions() {
  document.querySelector("#enterApp")?.addEventListener("click", () => {
    hideSplash();
  });

  document.body.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]")?.dataset.tab;
    if (tab) {
      event.preventDefault();
      switchTab(tab).catch((error) => toast(error.message));
      return;
    }

    const productOpen = event.target.closest("[data-product-open]")?.dataset.productOpen;
    if (productOpen) {
      state.selectedProduct = findProduct(productOpen);
      setPage("product");
      return;
    }

    const cartProduct = event.target.closest("[data-cart-product]")?.dataset.cartProduct;
    if (cartProduct) {
      const product = findProduct(cartProduct);
      if (!product) return toast("商品不存在");
      if (!ensureMemberForCash([product], "开通月会员后可将现金商品加入购物车")) return;
      addToCart(product);
      toast("已加入购物车");
      renderPage(state);
      return;
    }

    const orderOpen = event.target.closest("[data-order-open]")?.dataset.orderOpen;
    if (orderOpen) {
      state.selectedOrderId = orderOpen;
      setPage("orderDetail");
      return;
    }

    const paymentOpen = event.target.closest("[data-payment-open]")?.dataset.paymentOpen;
    if (paymentOpen) {
      state.selectedPaymentId = paymentOpen;
      const payment = state.payments.find((item) => item.payNo === paymentOpen || item.id === paymentOpen);
      if (payment?.orderId) state.selectedOrderId = payment.orderId;
      setPage("payment");
      return;
    }

    const paymentRefresh = event.target.closest("[data-payment-refresh]")?.dataset.paymentRefresh;
    if (paymentRefresh) {
      refreshPayment(paymentRefresh).catch((error) => toast(error.message));
      return;
    }

    const cartQty = event.target.closest("[data-cart-qty]");
    if (cartQty) {
      changeCartQuantity(cartQty.dataset.cartQty, Number(cartQty.dataset.delta || 0));
      return;
    }

    const cartRemove = event.target.closest("[data-cart-remove]")?.dataset.cartRemove;
    if (cartRemove) {
      state.cart = state.cart.filter((item) => item.id !== cartRemove);
      renderPage(state);
      return;
    }

    const categoryName = event.target.closest("[data-category-name]")?.dataset.categoryName;
    if (categoryName) {
      setCategoryName(categoryName);
      return;
    }

    const categoryMode = event.target.closest("[data-category-mode]")?.dataset.categoryMode;
    if (categoryMode) {
      setCategoryMode(categoryMode);
      return;
    }

    const buy = event.target.closest("[data-buy]");
    if (buy) {
      const fulfillmentType = state.page === "checkoutDelivery" ? "delivery" : "pickup";
      createOrder(buy.dataset.buy, buy.dataset.mode, fulfillmentType).catch((error) => toast(error.message));
      return;
    }

    const checkoutSubmit = event.target.closest("[data-checkout-submit]")?.dataset.checkoutSubmit;
    if (checkoutSubmit) {
      const paymentMode = getDefaultPaymentMode(state.cart);
      if (!ensureMemberForCash(state.cart, "现金商品需要先开通月会员后结算")) return;
      submitOrder(state.cart, paymentMode, checkoutSubmit).catch((error) => toast(error.message));
      return;
    }

    const editAddress = event.target.closest("[data-edit-address]")?.dataset.editAddress;
    if (editAddress) {
      state.editingAddressId = editAddress;
      renderPage(state);
      return;
    }

    const defaultAddress = event.target.closest("[data-default-address]")?.dataset.defaultAddress;
    if (defaultAddress) {
      setDefaultAddress(defaultAddress).catch((error) => toast(error.message));
      return;
    }

    const removeAddress = event.target.closest("[data-delete-address]")?.dataset.deleteAddress;
    if (removeAddress) {
      deleteAddress(removeAddress).catch((error) => toast(error.message));
      return;
    }

    const taskButton = event.target.closest("[data-task]");
    if (taskButton) {
      openTask(taskButton.dataset.task).catch((error) => toast(error.message));
      return;
    }

    const page = event.target.closest("[data-page]")?.dataset.page;
    if (page) {
      event.preventDefault();
      setPage(page);
      return;
    }

    const refundButton = event.target.closest("[data-refund]");
    if (refundButton) requestRefund(refundButton.dataset.refund).catch((error) => toast(error.message));

    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "signin") startSignin().catch((error) => toast(error.message));
    if (action === "member") subscribeMember().catch((error) => toast(error.message));
    if (action === "withdraw") requestWithdrawal().catch((error) => toast(error.message));
  });

  document.body.addEventListener("submit", (event) => {
    event.preventDefault();
    const taskForm = event.target.closest("[data-submit-task]");
    if (taskForm) {
      submitTask(taskForm).catch((error) => toast(error.message));
      return;
    }
    const addressForm = event.target.closest("[data-address-form]");
    if (addressForm) saveAddress(addressForm).catch((error) => toast(error.message));
    const ticketForm = event.target.closest("[data-ticket-form]");
    if (ticketForm) submitTicket(ticketForm).catch((error) => toast(error.message));
  });
}

function hideSplash() {
  const splash = document.querySelector("#splash");
  if (splash) splash.hidden = true;
}

async function init() {
  bindTabs();
  bindGlobalActions();
  const params = new URLSearchParams(window.location.search);
  if (params.get("skipSplash") === "1") hideSplash();
  const loginAs = params.get("loginAs");
  if (loginAs) {
    await loginUser(loginAs);
    params.delete("loginAs");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }
  renderPage(state);
  await loadInitialData();
}

init().catch((error) => toast(error.message));
