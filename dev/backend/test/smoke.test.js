const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;
const DRIVER = process.argv[2] || "json";
const STORE_FILE = path.join(os.tmpdir(), `tgg-shop-smoke-${process.pid}.${DRIVER === "sqlite" ? "sqlite" : "json"}`);
const userTokens = new Map();
const adminTokens = new Map();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  await attachAuth(path, headers);
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...headers },
  });
  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await res.json() : await res.text();
  return { res, body };
}

async function attachAuth(path, headers) {
  if (!path.startsWith("/api/") || path === "/api/health" || path === "/api/auth/login" || path === "/api/admin/auth/login") return;
  if (headers.Authorization || headers.authorization) return;
  const userId = headers["x-user-id"];
  const roleId = headers["x-admin-role"];
  delete headers["x-user-id"];
  delete headers["x-admin-role"];

  if (path.startsWith("/api/admin/")) {
    headers.Authorization = `Bearer ${await getAdminToken(roleId || "super_admin")}`;
    return;
  }
  headers.Authorization = `Bearer ${await getUserToken(userId || "u_1001")}`;
}

async function getUserToken(userId) {
  if (userTokens.has(userId)) return userTokens.get(userId);
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, password: "123456" })
  });
  const body = await res.json();
  assert(res.ok && body.token, `user login failed for ${userId}`);
  userTokens.set(userId, body.token);
  return body.token;
}

async function getAdminToken(roleId) {
  if (adminTokens.has(roleId)) return adminTokens.get(roleId);
  const res = await fetch(`${BASE}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roleId, password: "123456" })
  });
  const body = await res.json();
  assert(res.ok && body.token, `admin login failed for ${roleId}`);
  adminTokens.set(roleId, body.token);
  return body.token;
}

async function waitForServer() {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      const { res } = await request("/api/health");
      if (res.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("Server did not become ready");
}

async function run() {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
      PORT: String(PORT),
      TGG_STORE_DRIVER: DRIVER,
      TGG_STORE_FILE: STORE_FILE,
      TGG_SQLITE_FILE: STORE_FILE
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer();

    const health = await request("/api/health");
    assert(health.res.status === 200 && health.body.ok, "health check failed");

    const userPage = await request("/user");
    assert(userPage.res.status === 200 && userPage.body.includes("TGG Shop Dev"), "user page did not render");
    assert(userPage.body.includes('/user/js/app.js'), "user page missing module entry");
    assert(userPage.body.includes('type="button"') && userPage.body.includes('data-tab="home"') && userPage.body.includes('data-tab="profile"'), "user tabs are not interactive buttons");

    const userModule = await request("/user/js/app.js");
    assert(userModule.res.status === 200 && userModule.body.includes('from "./api.js"'), "user module did not render");
    assert(userModule.body.includes("switchTab") && userModule.body.includes("bindTabs"), "user module missing tab switch handler");
    assert(userModule.body.includes("/api/payments") && userModule.body.includes("/lfwin"), "user module missing LFWin payment flow");

    const userRenderModule = await request("/user/js/render.js");
    assert(userRenderModule.res.status === 200 && userRenderModule.body.includes("orderDetailView") && userRenderModule.body.includes("orderSteps"), "user render missing order detail view");

    const adminPage = await request("/admin");
    assert(adminPage.res.status === 200 && adminPage.body.includes("TGG Shop Admin Dev"), "admin page did not render");
    assert(adminPage.body.includes('/admin/js/app.js'), "admin page missing module entry");

    const adminModule = await request("/admin/js/app.js");
    assert(adminModule.res.status === 200 && adminModule.body.includes('from "./api.js"'), "admin module did not render");
    assert(adminModule.body.includes("paymentLedgerPath") && adminModule.body.includes("cancel-timeouts"), "admin module missing payment filter actions");

    const adminRenderModule = await request("/admin/js/render.js");
    assert(adminRenderModule.res.status === 200 && adminRenderModule.body.includes("paymentLedger") && adminRenderModule.body.includes("paymentRows"), "admin render missing payment ledger view");
    assert(adminRenderModule.body.includes("data-payment-filter") && adminRenderModule.body.includes("data-cancel-payment-timeouts"), "admin render missing payment operation controls");
    assert(adminRenderModule.body.includes("stateMachineNodes") && adminRenderModule.body.includes("orderDiagnostics") && adminRenderModule.body.includes("exceptionLinkageRows"), "admin render missing state machine diagnostics");

    const home = await request("/api/home");
    assert(home.res.status === 200, "home API failed");
    assert(home.body.pickupSite.name === "师大自提站", "home API missing pickup site");
    assert(home.body.pointsExchangeEntry.title === "纯积分兑换", "home API missing points exchange entry");

    const pointsProducts = await request("/api/points-exchange");
    assert(pointsProducts.res.status === 200 && pointsProducts.body.length >= 2, "points exchange products missing");
    assert(pointsProducts.body.every((item) => item.purePointsOnly), "points exchange API returned non-pure product");

    const authMe = await request("/api/auth/me");
    assert(authMe.res.status === 200 && authMe.body.id === "u_1001", "auth me API failed");

    const normalUser = await request("/api/me", { headers: { "x-user-id": "u_1002" } });
    assert(normalUser.body.id === "u_1002" && !normalUser.body.isMember, "user token did not switch user context");

    const taskPlatformStatus = await request("/api/task-platform/status");
    assert(taskPlatformStatus.res.status === 200 && ["local_mock", "platform_proxy"].includes(taskPlatformStatus.body.mode), "task platform status failed");

    const taskTypes = await request("/api/task-types");
    assert(taskTypes.res.status === 200 && taskTypes.body.length > 0, "task type list missing");

    const taskList = await request("/api/tasks");
    assert(taskList.res.status === 200 && taskList.body.length > 0, "task list missing");
    assert(!("rewardPoints" in taskList.body[0]), "task list must hide reward points");

    const filteredTaskList = await request(`/api/tasks?search=${encodeURIComponent(taskList.body[0].title.slice(0, 2))}&page=1&count=1`);
    assert(filteredTaskList.res.status === 200 && filteredTaskList.body.length <= 1, "task list query filters failed");

    const taskDetail = await request(`/api/tasks/${taskList.body[0].id}`);
    assert(taskDetail.res.status === 200 && taskDetail.body.rewardPoints > 0, "task detail must show reward points");
    assert(Array.isArray(taskDetail.body.submitFields), "task detail must expose dynamic submit fields");

    const normalTaskSubmission = await request(`/api/tasks/${taskList.body[0].id}/submit`, {
      method: "POST",
      headers: { "x-user-id": "u_1002" },
      body: JSON.stringify({ mobile: "13900000002", images: "normal.png" })
    });
    assert(normalTaskSubmission.res.status === 403, "normal user should not submit bounty task");

    const taskSubmission = await request(`/api/tasks/${taskList.body[0].id}/submit`, {
      method: "POST",
      body: JSON.stringify({ phone: "13900000000", screenshot: "mock.png" })
    });
    assert(taskSubmission.res.status === 201 && taskSubmission.body.status === "reviewing", "task submission failed");

    const taskSubmissionDetail = await request(`/api/submissions/${taskSubmission.body.id}`);
    assert(taskSubmissionDetail.res.status === 200 && taskSubmissionDetail.body.id === taskSubmission.body.id, "task submission detail failed");

    const taskCallback = await request("/api/task/callback", {
      method: "POST",
      body: JSON.stringify({ id: taskSubmission.body.id, status: 1, remarks: "审核通过" })
    });
    assert(taskCallback.res.status === 200 && taskCallback.body.submission.status === "approved", "task callback approve failed");

    const duplicateTaskCallback = await request("/api/task/callback", {
      method: "POST",
      body: JSON.stringify({ id: taskSubmission.body.id, status: 1, remarks: "重复回调" })
    });
    assert(duplicateTaskCallback.body.idempotent === true, "duplicate task callback should be idempotent");

    const manualReviewSubmission = await request(`/api/tasks/${taskList.body[1]?.id || taskList.body[0].id}/submit`, {
      method: "POST",
      body: JSON.stringify({ phone: "13900000001", screenshot: "admin-review.png" })
    });
    assert(manualReviewSubmission.res.status === 201, "manual review task submission failed");

    const adminTaskSubmissions = await request("/api/admin/task-submissions", { headers: { "x-admin-role": "audit_ops" } });
    assert(adminTaskSubmissions.res.status === 200 && adminTaskSubmissions.body.some((item) => item.id === manualReviewSubmission.body.id), "admin task submissions list failed");

    const adminTaskApproved = await request(`/api/admin/task-submissions/${manualReviewSubmission.body.id}/approve`, {
      method: "POST",
      headers: { "x-admin-role": "audit_ops" },
      body: JSON.stringify({ remarks: "admin approve" })
    });
    assert(adminTaskApproved.res.status === 200 && adminTaskApproved.body.status === "approved", "admin task approval failed");

    const inviteInfo = await request("/api/invite/info", { method: "POST", body: "{}" });
    assert(inviteInfo.res.status === 200 && inviteInfo.body.inviteCode, "invite info POST API failed");

    const inviteList = await request("/api/invite/list");
    assert(inviteList.res.status === 200 && inviteList.body.some((item) => item.uid === "u_1002"), "invite list API failed");

    const inviteStats = await request("/api/invite/stats");
    assert(inviteStats.res.status === 200 && inviteStats.body.totalInvited >= 1, "invite stats API failed");

    const signinStatus = await request("/api/signin/status");
    assert(signinStatus.res.status === 200 && signinStatus.body.streakRewardText.includes("30"), "signin status API failed");

    const signinStart = await request("/api/signin/start", { method: "POST", body: "{}" });
    let adComplete;
    for (let index = 0; index < signinStart.body.adGroups * 2; index += 1) {
      adComplete = await request("/api/signin/ad_complete", {
        method: "POST",
        body: JSON.stringify({ sessionId: signinStart.body.sessionId })
      });
    }
    assert(adComplete.res.status === 200 && adComplete.body.lotteryAvailable, "signin ad_complete API failed");

    const lotterySpin = await request("/api/signin/lottery_spin", { method: "POST", body: JSON.stringify({ sessionId: signinStart.body.sessionId }) });
    assert(lotterySpin.res.status === 200 && lotterySpin.body.label, "signin lottery API failed");

    const pickupSites = await request("/api/pickup-sites");
    assert(pickupSites.res.status === 200 && pickupSites.body[0].address.includes("师大"), "pickup site API failed");

    const deliveryTeams = await request("/api/delivery/teams");
    assert(deliveryTeams.res.status === 200 && deliveryTeams.body[0].staff.length >= 1, "delivery team API failed");

    const addresses = await request("/api/addresses");
    assert(addresses.res.status === 200, "address list API failed");

    const createdAddress = await request("/api/addresses", {
      method: "POST",
      body: JSON.stringify({
        receiverName: "测试收货人",
        mobile: "13800009999",
        province: "江苏省",
        city: "南京市",
        district: "栖霞区",
        detail: "师大测试地址",
        isDefault: true
      })
    });
    assert(createdAddress.res.status === 201 && createdAddress.body.id, "address create API failed");

    const updatedAddress = await request(`/api/addresses/${createdAddress.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ detail: "师大测试地址 2 号楼", isDefault: true })
    });
    assert(updatedAddress.res.status === 200 && updatedAddress.body.detail.includes("2"), "address update API failed");

    const deletedAddress = await request(`/api/addresses/${createdAddress.body.id}`, { method: "DELETE" });
    assert(deletedAddress.res.status === 200 && deletedAddress.body.id === createdAddress.body.id, "address delete API failed");

    const recreatedAddress = await request("/api/addresses", {
      method: "POST",
      body: JSON.stringify({
        receiverName: "测试收货人",
        mobile: "13800009999",
        province: "江苏省",
        city: "南京市",
        district: "栖霞区",
        detail: "师大测试地址",
        isDefault: true
      })
    });
    assert(recreatedAddress.res.status === 201, "address recreate API failed");

    const ranking = await request("/api/ranking");
    assert(ranking.res.status === 200 && Array.isArray(ranking.body.rows), "ranking API failed");

    const pointsLedger = await request("/api/points-ledger");
    assert(pointsLedger.res.status === 200 && Array.isArray(pointsLedger.body), "points ledger API failed");

    const withdrawal = await request("/api/withdrawals", {
      method: "POST",
      body: JSON.stringify({ amount: 1, channel: "wechat" })
    });
    assert(withdrawal.res.status === 201 && withdrawal.body.status === "pending_review", "withdrawal request API failed");

    const meBefore = await request("/api/me");
    const pureOrder = await request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        paymentMode: "pure_points",
        fulfillmentType: "pickup",
        pickupSiteId: "site_001",
        items: [{ productId: "p_banana", quantity: 1 }]
      })
    });
    assert(pureOrder.res.status === 201, `pure points order failed: ${JSON.stringify(pureOrder.body)}`);
    assert(pureOrder.body.status === "paid", "pure points order should be paid immediately");
    assert(pureOrder.body.fulfillmentStatus === "pending_pickup", "pure points pickup order should wait for pickup");
    assert(Boolean(pureOrder.body.pickupCode), "pure points pickup order should have pickup code");

    const pickupVerified = await request(`/api/admin/orders/${pureOrder.body.id}/pickup-verify`, {
      method: "POST",
      headers: { "x-admin-role": "order_admin" },
      body: JSON.stringify({ pickupCode: pureOrder.body.pickupCode })
    });
    assert(pickupVerified.res.status === 200 && pickupVerified.body.status === "completed", "pickup verify failed");

    const meAfter = await request("/api/me");
    assert(meAfter.body.points === meBefore.body.points - pureOrder.body.pointAmount, "pure points order did not deduct points");

    const pureDeliveryOrder = await request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        paymentMode: "pure_points",
        fulfillmentType: "delivery",
        deliveryAddress: "师大东门宿舍 3 栋",
        items: [{ productId: "p_bokchoy", quantity: 1 }]
      })
    });
    assert(pureDeliveryOrder.res.status === 201, `pure points delivery order failed: ${JSON.stringify(pureDeliveryOrder.body)}`);
    assert(pureDeliveryOrder.body.cashAmount === 0, "pure points delivery order must not create cash amount");
    assert(pureDeliveryOrder.body.fulfillmentStatus === "pending_ship", "pure points delivery order should wait for shipping");
    assert(Boolean(pureDeliveryOrder.body.deliveryDate), "pure points delivery order should have delivery date");

    const shippedOrder = await request(`/api/admin/orders/${pureDeliveryOrder.body.id}/ship`, {
      method: "POST",
      headers: { "x-admin-role": "order_admin" },
      body: JSON.stringify({ staffId: "staff_001" })
    });
    assert(shippedOrder.res.status === 200 && shippedOrder.body.fulfillmentStatus === "shipping", "delivery ship failed");

    const deliveredOrder = await request(`/api/admin/orders/${pureDeliveryOrder.body.id}/deliver`, {
      method: "POST",
      headers: { "x-admin-role": "order_admin" },
      body: "{}"
    });
    assert(deliveredOrder.res.status === 200 && deliveredOrder.body.status === "completed", "delivery complete failed");

    const delayedDeliveryOrder = await request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        paymentMode: "pure_points",
        fulfillmentType: "delivery",
        deliveryAddress: "师大东门宿舍 5 栋",
        items: [{ productId: "p_bokchoy", quantity: 1 }]
      })
    });
    assert(delayedDeliveryOrder.res.status === 201 && delayedDeliveryOrder.body.fulfillmentStatus === "pending_ship", "delayed delivery order failed");

    const delayedShipped = await request(`/api/admin/orders/${delayedDeliveryOrder.body.id}/ship`, {
      method: "POST",
      headers: { "x-admin-role": "order_admin" },
      body: JSON.stringify({ staffId: "staff_001" })
    });
    assert(delayedShipped.res.status === 200 && delayedShipped.body.fulfillmentStatus === "shipping", "delayed delivery ship failed");

    const deliveryScan = await request("/api/admin/delivery/scan-exceptions", {
      method: "POST",
      headers: { "x-admin-role": "delivery_dispatcher" },
      body: JSON.stringify({ timeoutMinutes: 1, now: "2999-01-01T00:00:00.000Z" })
    });
    assert(
      deliveryScan.res.status === 200
        && deliveryScan.body.exceptions.some((item) => item.type === "delivery_timeout" && item.payload?.orderId === delayedDeliveryOrder.body.id),
      "delivery timeout scan failed"
    );

    const normalCashOrder = await request("/api/orders", {
      method: "POST",
      headers: { "x-user-id": "u_1002" },
      body: JSON.stringify({
        paymentMode: "cash",
        fulfillmentType: "pickup",
        pickupSiteId: "site_001",
        items: [{ productId: "p_apple", quantity: 1 }]
      })
    });
    assert(normalCashOrder.res.status === 400, "normal user cash order should be rejected");

    const cashOrder = await request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        paymentMode: "cash",
        fulfillmentType: "pickup",
        pickupSiteId: "site_001",
        items: [{ productId: "p_apple", quantity: 1 }]
      })
    });
    assert(cashOrder.res.status === 201 && cashOrder.body.status === "pending_payment", "cash order should be pending payment");

    const pendingPayment = await request(`/api/orders/${cashOrder.body.id}/payments`, { method: "POST", body: JSON.stringify({ channel: "mock_pay" }) });
    assert(pendingPayment.res.status === 201 && pendingPayment.body.status === "pending", "cash payment order create failed");
    assert(pendingPayment.body.payScene === "goods_cash" && pendingPayment.body.payNo, "payment order missing goods_cash payNo");

    const duplicatePayment = await request(`/api/orders/${cashOrder.body.id}/payments`, { method: "POST", body: "{}" });
    assert(duplicatePayment.res.status === 201 && duplicatePayment.body.id === pendingPayment.body.id, "payment order create should be idempotent");

    const paymentCallback = await request(`/api/payments/${pendingPayment.body.payNo}/mock-callback`, {
      method: "POST",
      body: JSON.stringify({ status: "paid", thirdTradeNo: "SMOKE_PAY_001" })
    });
    assert(paymentCallback.res.status === 200 && paymentCallback.body.payment.status === "paid", "mock payment callback failed");
    assert(paymentCallback.body.result.order.status === "paid", "payment callback did not pay order");

    const duplicateCallback = await request(`/api/payments/${pendingPayment.body.payNo}/mock-callback`, {
      method: "POST",
      body: JSON.stringify({ status: "paid", thirdTradeNo: "SMOKE_PAY_001" })
    });
    assert(duplicateCallback.res.status === 200 && duplicateCallback.body.idempotent === true, "duplicate payment callback should be idempotent");

    const userPayments = await request("/api/payments");
    assert(userPayments.res.status === 200 && userPayments.body.some((item) => item.payNo === pendingPayment.body.payNo), "user payments list missing payment order");

    const shortcutCashOrder = await request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        paymentMode: "cash",
        fulfillmentType: "pickup",
        pickupSiteId: "site_001",
        items: [{ productId: "p_apple", quantity: 1 }]
      })
    });
    assert(shortcutCashOrder.res.status === 201 && shortcutCashOrder.body.status === "pending_payment", "shortcut cash order should be pending payment");

    const paidOrder = await request(`/api/orders/${shortcutCashOrder.body.id}/pay`, { method: "POST", body: "{}" });
    assert(paidOrder.res.status === 200 && paidOrder.body.status === "paid", "mock cash payment shortcut failed");

    const memberSubscribe = await request("/api/member/subscribe", {
      method: "POST",
      headers: { "x-user-id": "u_1002" },
      body: JSON.stringify({ months: 1, channel: "mock_pay" })
    });
    assert(memberSubscribe.res.status === 200 && memberSubscribe.body.isMember, "member subscription payment failed");

    const failedCashOrder = await request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        paymentMode: "cash",
        fulfillmentType: "pickup",
        pickupSiteId: "site_001",
        items: [{ productId: "p_apple", quantity: 1 }]
      })
    });
    assert(failedCashOrder.res.status === 201 && failedCashOrder.body.status === "pending_payment", "failed cash order should start pending");

    const failedPayment = await request(`/api/orders/${failedCashOrder.body.id}/payments`, {
      method: "POST",
      body: JSON.stringify({ channel: "mock_pay", idempotencyKey: "smoke_failed_payment" })
    });
    const failedCallback = await request(`/api/payments/${failedPayment.body.payNo}/mock-callback`, {
      method: "POST",
      body: JSON.stringify({ status: "failed", thirdTradeNo: "SMOKE_FAIL_001" })
    });
    assert(failedCallback.res.status === 200 && failedCallback.body.payment.status === "failed", "failed callback should mark payment failed");

    const timeoutCashOrder = await request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        paymentMode: "cash",
        fulfillmentType: "pickup",
        pickupSiteId: "site_001",
        items: [{ productId: "p_apple", quantity: 1 }]
      })
    });
    const timeoutPayment = await request(`/api/orders/${timeoutCashOrder.body.id}/payments`, {
      method: "POST",
      body: JSON.stringify({ channel: "mock_pay", idempotencyKey: "smoke_timeout_payment" })
    });
    assert(timeoutPayment.res.status === 201 && timeoutPayment.body.status === "pending", "timeout payment should start pending");

    const timeoutScan = await request("/api/admin/payments/cancel-timeouts", {
      method: "POST",
      headers: { "x-admin-role": "finance_admin" },
      body: JSON.stringify({ timeoutMinutes: 1, now: "2999-01-01T00:00:00.000Z" })
    });
    assert(timeoutScan.res.status === 200 && timeoutScan.body.cancelled.some((item) => item.payNo === timeoutPayment.body.payNo), "timeout scan should cancel stale pending payment");

    const failedPaymentLedger = await request("/api/admin/ledger?paymentStatus=failed", { headers: { "x-admin-role": "finance_admin" } });
    assert(failedPaymentLedger.res.status === 200 && failedPaymentLedger.body.paymentLedger.every((item) => item.status === "failed"), "payment ledger status filter failed");

    const goodsCashLedger = await request("/api/admin/ledger?payScene=goods_cash", { headers: { "x-admin-role": "finance_admin" } });
    assert(goodsCashLedger.res.status === 200 && goodsCashLedger.body.paymentLedger.every((item) => item.payScene === "goods_cash"), "payment ledger scene filter failed");

    const adminSummary = await request("/api/admin/summary");
    assert(adminSummary.res.status === 200 && adminSummary.body.orderCount >= 3, "admin summary did not reflect orders");

    const adminConfig = await request("/api/admin/config");
    assert(adminConfig.res.status === 200 && adminConfig.body.pickupEnabled === true, "admin config API failed");

    const adminAddresses = await request("/api/admin/addresses");
    assert(adminAddresses.res.status === 200 && adminAddresses.body.some((item) => item.id === recreatedAddress.body.id), "admin addresses API failed");

    const adminInvites = await request("/api/admin/invites");
    assert(adminInvites.res.status === 200 && adminInvites.body.some((item) => item.inviteeUserId === "u_1002"), "admin invite audit API failed");

    const patchedConfig = await request("/api/admin/config", {
      method: "PATCH",
      headers: { "x-admin-role": "operation_admin" },
      body: JSON.stringify({
        deliveryFee: 4.5,
        purePointsNoCashTopup: false,
        homeBannerTitle: "巡检首页标题",
        homeServiceBadges: ["自建配送", "巡检服务"],
        homePromotionEntries: [{ title: "巡检入口", text: "首页可配", tone: "green", page: "category" }],
        signinAdMaterials: [{ id: "ad_smoke", name: "巡检激励视频", type: "reward_video", enabled: true, position: "签到巡检" }]
      })
    });
    assert(patchedConfig.res.status === 200 && patchedConfig.body.deliveryFee === 4.5 && patchedConfig.body.purePointsNoCashTopup === true, "admin config patch failed");
    assert(patchedConfig.body.homeBannerTitle === "巡检首页标题" && patchedConfig.body.signinAdMaterials[0].name === "巡检激励视频", "admin ops config patch failed");

    const updatedHome = await request("/api/home");
    assert(updatedHome.body.banners[0].title === "巡检首页标题" && updatedHome.body.serviceBadges.includes("巡检服务"), "home API did not reflect admin ops config");

    const createdProduct = await request("/api/admin/products", {
      method: "POST",
      headers: { "x-admin-role": "product_admin" },
      body: JSON.stringify({ name: "测试新品蓝莓", category: "水果", cashPrice: 16.8, pointsPrice: 288, stock: 60, tag: "新品", image: "/assets/apple.jpg", status: "on" })
    });
    assert(createdProduct.res.status === 201 && createdProduct.body.id && createdProduct.body.status === "on" && createdProduct.body.supportsCash === true, "admin product create failed");

    const createdPureProduct = await request("/api/admin/products", {
      method: "POST",
      headers: { "x-admin-role": "product_admin" },
      body: JSON.stringify({ name: "测试纯积分商品", category: "纯积分", cashPrice: 99, pointsPrice: 99, stock: 20, purePointsOnly: true, status: "on" })
    });
    assert(createdPureProduct.res.status === 201 && createdPureProduct.body.cashPrice === null && createdPureProduct.body.supportsCash === false, "pure points product create failed");

    const patchedProduct = await request("/api/admin/products/p_apple", {
      method: "PATCH",
      headers: { "x-admin-role": "product_admin" },
      body: JSON.stringify({ stock: 155, status: "off" })
    });
    assert(patchedProduct.res.status === 200 && patchedProduct.body.stock === 155 && patchedProduct.body.status === "off", "admin product patch failed");

    const inventoryLedger = await request("/api/admin/inventory-ledger", { headers: { "x-admin-role": "product_admin" } });
    assert(
      inventoryLedger.res.status === 200
        && inventoryLedger.body.some((item) => item.productId === createdProduct.body.id && item.changeType === "initial_stock")
        && inventoryLedger.body.some((item) => item.productId === "p_apple" && item.stockAfter === 155)
        && inventoryLedger.body.some((item) => item.productId === "p_banana" && item.changeType === "order_deduct" && item.reason.includes(pureOrder.body.id))
        && inventoryLedger.body.some((item) => item.productId === "p_apple" && item.changeType === "order_restore" && item.reason.includes(timeoutCashOrder.body.id)),
      "admin inventory ledger API failed"
    );

    await request("/api/admin/products/p_apple", {
      method: "PATCH",
      headers: { "x-admin-role": "product_admin" },
      body: JSON.stringify({ status: "on" })
    });

    const adminPickupSites = await request("/api/admin/pickup-sites");
    assert(adminPickupSites.res.status === 200 && adminPickupSites.body.length >= 1, "admin pickup sites API failed");

    const adminDeliveryTeams = await request("/api/admin/delivery-teams");
    assert(adminDeliveryTeams.res.status === 200 && adminDeliveryTeams.body[0].staff.length >= 1, "admin delivery teams API failed");

    const adminWithdrawals = await request("/api/admin/withdrawals", { headers: { "x-admin-role": "finance_admin" } });
    assert(adminWithdrawals.res.status === 200 && adminWithdrawals.body.some((item) => item.id === withdrawal.body.id), "admin withdrawals API failed");

    const directWithdrawalApproval = await request(`/api/admin/withdrawals/${withdrawal.body.id}/approve`, {
      method: "POST",
      headers: { "x-admin-role": "finance_admin" },
      body: "{}"
    });
    assert(directWithdrawalApproval.res.status === 409, "direct withdrawal approval should require secondary approval");

    const withdrawalApprovalRequest = await request("/api/admin/approval-requests", {
      method: "POST",
      headers: { "x-admin-role": "finance_admin" },
      body: JSON.stringify({
        action: "withdrawal.approve",
        targetType: "withdrawal",
        targetId: withdrawal.body.id,
        reason: "smoke withdrawal approval"
      })
    });
    assert(withdrawalApprovalRequest.res.status === 201 && withdrawalApprovalRequest.body.status === "pending", "withdrawal secondary approval request failed");

    const approvedWithdrawal = await request(`/api/admin/approval-requests/${withdrawalApprovalRequest.body.id}/approve`, {
      method: "POST",
      headers: { "x-admin-role": "audit_ops" },
      body: JSON.stringify({ reason: "smoke approval review" })
    });
    assert(approvedWithdrawal.res.status === 200 && approvedWithdrawal.body.status === "executed", "withdrawal approve failed");

    const orderStatusLogs = await request("/api/admin/order-status-logs");
    assert(orderStatusLogs.res.status === 200 && orderStatusLogs.body.some((item) => item.orderId === pureOrder.body.id), "order status logs API failed");

    const operationLogs = await request("/api/admin/operation-logs");
    assert(operationLogs.res.status === 200 && operationLogs.body.some((item) => item.action === "config.update"), "operation logs missing admin writes");

    const ledger = await request("/api/admin/ledger");
    assert(ledger.body.pointLedger.some((item) => item.bizNo === pureOrder.body.id), "point ledger missing pure order entry");
    assert(ledger.body.withdrawableLedger.some((item) => item.bizNo === withdrawal.body.id), "withdrawable ledger missing withdrawal freeze");
    assert(ledger.body.paymentLedger.some((item) => item.status === "failed"), "payment ledger missing failed payment");

    const refundRequest = await request(`/api/orders/${pureOrder.body.id}/refunds`, {
      method: "POST",
      body: JSON.stringify({ reason: "测试退款" })
    });
    assert(refundRequest.res.status === 201, `refund request failed: ${JSON.stringify(refundRequest.body)}`);
    assert(refundRequest.body.status === "pending_review", "refund request should wait for review");

    const refunds = await request("/api/admin/refunds", { headers: { "x-admin-role": "finance_admin" } });
    assert(refunds.res.status === 200 && refunds.body.some((item) => item.id === refundRequest.body.id), "admin refunds list missing refund");

    const refundTicket = await request("/api/admin/tickets", { headers: { "x-admin-role": "customer_service" } });
    assert(refundTicket.res.status === 200 && refundTicket.body.some((item) => item.linkedType === "refund" && item.linkedId === refundRequest.body.id), "refund request should create linked customer ticket");

    const directRefundApproval = await request(`/api/admin/refunds/${refundRequest.body.id}/approve`, {
      method: "POST",
      headers: { "x-admin-role": "finance_admin" },
      body: "{}"
    });
    assert(directRefundApproval.res.status === 409, "direct refund approval should require secondary approval");

    const refundApprovalRequest = await request("/api/admin/approval-requests", {
      method: "POST",
      headers: { "x-admin-role": "finance_admin" },
      body: JSON.stringify({
        action: "refund.approve",
        targetType: "refund",
        targetId: refundRequest.body.id,
        reason: "smoke refund approval"
      })
    });
    assert(refundApprovalRequest.res.status === 201 && refundApprovalRequest.body.status === "pending", "refund secondary approval request failed");

    const approvedRefund = await request(`/api/admin/approval-requests/${refundApprovalRequest.body.id}/approve`, {
      method: "POST",
      headers: { "x-admin-role": "audit_ops" },
      body: JSON.stringify({ reason: "smoke refund review" })
    });
    assert(approvedRefund.res.status === 200 && approvedRefund.body.status === "executed", "refund approval failed");

    const resolvedRefundTicket = await request("/api/admin/tickets", { headers: { "x-admin-role": "customer_service" } });
    assert(resolvedRefundTicket.body.some((item) => item.linkedType === "refund" && item.linkedId === refundRequest.body.id && item.status === "resolved"), "approved refund should resolve linked customer ticket");

    const refundStockOrder = await request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        paymentMode: "pure_points",
        fulfillmentType: "pickup",
        pickupSiteId: "site_001",
        items: [{ productId: "p_banana", quantity: 1 }]
      })
    });
    assert(refundStockOrder.res.status === 201 && refundStockOrder.body.fulfillmentStatus === "pending_pickup", "refund stock order should wait for pickup");

    const refundStockRequest = await request(`/api/orders/${refundStockOrder.body.id}/refunds`, {
      method: "POST",
      body: JSON.stringify({ reason: "未核销订单退款回补库存" })
    });
    assert(refundStockRequest.res.status === 201, "refund stock request failed");

    const refundStockApprovalRequest = await request("/api/admin/approval-requests", {
      method: "POST",
      headers: { "x-admin-role": "finance_admin" },
      body: JSON.stringify({
        action: "refund.approve",
        targetType: "refund",
        targetId: refundStockRequest.body.id,
        reason: "smoke refund stock restore approval"
      })
    });
    assert(refundStockApprovalRequest.res.status === 201, "refund stock approval request failed");

    const approvedStockRefund = await request(`/api/admin/approval-requests/${refundStockApprovalRequest.body.id}/approve`, {
      method: "POST",
      headers: { "x-admin-role": "audit_ops" },
      body: JSON.stringify({ reason: "smoke refund stock restore review" })
    });
    assert(approvedStockRefund.res.status === 200 && approvedStockRefund.body.status === "executed", "refund stock approval failed");

    const inventoryLedgerAfterRefund = await request("/api/admin/inventory-ledger", { headers: { "x-admin-role": "product_admin" } });
    assert(
      inventoryLedgerAfterRefund.res.status === 200
        && inventoryLedgerAfterRefund.body.some((item) => item.changeType === "refund_restore" && item.reason.includes(refundStockOrder.body.id)),
      "refund approval should restore unfulfilled order stock"
    );

    const orderAdmin = await request("/api/admin/auth/me", { headers: { "x-admin-role": "order_admin" } });
    assert(orderAdmin.res.status === 200 && orderAdmin.body.id === "order_admin", "admin auth role failed");

    const customerOrders = await request("/api/admin/orders", { headers: { "x-admin-role": "customer_service" } });
    assert(customerOrders.res.status === 200, "customer service should read orders");

    const customerLedger = await request("/api/admin/ledger", { headers: { "x-admin-role": "customer_service" } });
    assert(customerLedger.res.status === 403, "customer service must not read ledger");

    const exception = await request("/api/admin/exceptions", {
      method: "POST",
      headers: { "x-admin-role": "finance_admin" },
      body: JSON.stringify({
        type: "manual_test_exception",
        bizNo: "SMOKE_TEST",
        action: "人工测试补偿",
        payload: { source: DRIVER }
      })
    });
    assert(exception.res.status === 201 && exception.body.status === "pending", "exception creation failed");

    const resolvedException = await request(`/api/admin/exceptions/${exception.body.id}/resolve`, {
      method: "POST",
      headers: { "x-admin-role": "finance_admin" },
      body: JSON.stringify({ action: "测试处理完成" })
    });
    assert(resolvedException.res.status === 200 && resolvedException.body.status === "resolved", "exception resolve failed");

    assertPersisted(pureOrder.body.id, refundRequest.body.id, exception.body.id, recreatedAddress.body.id, withdrawal.body.id, refundStockOrder.body.id);

    console.log(`Smoke tests passed (${DRIVER})`);
  } finally {
    child.kill();
    cleanupStoreFile();
    if (stderr.trim()) process.stderr.write(stderr);
  }
}

function cleanupStoreFile() {
  for (const file of [STORE_FILE, `${STORE_FILE}.tmp`, `${STORE_FILE}-shm`, `${STORE_FILE}-wal`]) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function assertPersisted(orderId, refundId, exceptionId, addressId, withdrawalId, stockRestoreOrderId) {
  assert(fs.existsSync(STORE_FILE), `${DRIVER} store file was not created`);
  if (DRIVER !== "sqlite") {
    const persisted = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    assert(persisted.orders.some((item) => item.id === orderId), "order was not persisted to JSON store file");
    assert(persisted.pointLedger.some((item) => item.bizNo === orderId), "point ledger was not persisted to JSON store file");
    assert(persisted.refundOrders.some((item) => item.id === refundId), "refund was not persisted to JSON store file");
    assert(persisted.exceptions.some((item) => item.id === exceptionId), "exception was not persisted to JSON store file");
    assert(persisted.addresses.some((item) => item.id === addressId), "address was not persisted to JSON store file");
    assert(persisted.withdrawRequests.some((item) => item.id === withdrawalId), "withdrawal was not persisted to JSON store file");
    assert(persisted.withdrawableLedger.some((item) => item.bizNo === withdrawalId), "withdrawable ledger was not persisted to JSON store file");
    assert(persisted.orderStatusLogs.some((item) => item.orderId === orderId), "order status log was not persisted to JSON store file");
    assert(persisted.inventoryLedger.some((item) => item.changeType === "order_deduct" && item.reason.includes(orderId)), "inventory deduct ledger was not persisted to JSON store file");
    assert(persisted.inventoryLedger.some((item) => item.changeType === "refund_restore" && item.reason.includes(stockRestoreOrderId)), "inventory refund restore ledger was not persisted to JSON store file");
    assert(persisted.operationTickets.some((item) => item.linkedType === "refund" && item.linkedId === refundId), "linked refund ticket was not persisted to JSON store file");
    return;
  }

  process.env.NODE_NO_WARNINGS = "1";
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(STORE_FILE, { readOnly: true });
  try {
    const order = db.prepare("SELECT COUNT(*) AS count FROM shop_order WHERE id = ?").get(orderId);
    const ledger = db.prepare("SELECT COUNT(*) AS count FROM point_ledger WHERE biz_no = ?").get(orderId);
    const refund = db.prepare("SELECT COUNT(*) AS count FROM refund_order WHERE id = ?").get(refundId);
    const exception = db.prepare("SELECT COUNT(*) AS count FROM exception_compensation WHERE id = ?").get(exceptionId);
    const address = db.prepare("SELECT COUNT(*) AS count FROM user_address WHERE id = ?").get(addressId);
    const withdrawal = db.prepare("SELECT COUNT(*) AS count FROM withdraw_request WHERE id = ?").get(withdrawalId);
    const withdrawLedger = db.prepare("SELECT COUNT(*) AS count FROM withdrawable_ledger WHERE biz_no = ?").get(withdrawalId);
    const statusLog = db.prepare("SELECT COUNT(*) AS count FROM order_status_log WHERE order_id = ?").get(orderId);
    const inventoryLedger = db.prepare("SELECT COUNT(*) AS count FROM inventory_ledger WHERE change_type = ? AND reason LIKE ?").get("order_deduct", `%${orderId}%`);
    const refundInventoryLedger = db.prepare("SELECT COUNT(*) AS count FROM inventory_ledger WHERE change_type = ? AND reason LIKE ?").get("refund_restore", `%${stockRestoreOrderId}%`);
    const linkedTicket = db.prepare("SELECT COUNT(*) AS count FROM operation_ticket WHERE linked_type = ? AND linked_id = ?").get("refund", refundId);
    assert(order.count === 1, "order was not persisted to SQLite store file");
    assert(ledger.count === 1, "point ledger was not persisted to SQLite store file");
    assert(refund.count === 1, "refund was not persisted to SQLite store file");
    assert(exception.count === 1, "exception was not persisted to SQLite store file");
    assert(address.count === 1, "address was not persisted to SQLite store file");
    assert(withdrawal.count === 1, "withdrawal was not persisted to SQLite store file");
    assert(withdrawLedger.count >= 1, "withdrawable ledger was not persisted to SQLite store file");
    assert(statusLog.count >= 1, "order status log was not persisted to SQLite store file");
    assert(inventoryLedger.count >= 1, "inventory deduct ledger was not persisted to SQLite store file");
    assert(refundInventoryLedger.count >= 1, "inventory refund restore ledger was not persisted to SQLite store file");
    assert(linkedTicket.count >= 1, "linked refund ticket was not persisted to SQLite store file");
  } finally {
    db.close();
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
