process.env.NODE_NO_WARNINGS = "1";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const APP_PORT = 5600 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const userTokens = new Map();
const adminTokens = new Map();

test("API closes member cash-shortfall and manual points approval flows", async () => {
  const server = startServer();
  try {
    await waitForJson("/api/health");

    const memberBefore = await request("/api/me", { headers: await userHeaders("u_1001") });
    assert.equal(memberBefore.res.status, 200);
    assert.equal(memberBefore.body.isMember, true);
    assert.equal(memberBefore.body.points, 2580);

    const pointsApproval = await request("/api/admin/approval-requests", {
      method: "POST",
      headers: await adminHeaders("finance_admin"),
      body: {
        action: "points.adjust",
        targetType: "user",
        targetId: "u_1001",
        payload: { pointsDelta: -2400 },
        reason: "E2E manual points debit before cash-shortfall order"
      }
    });
    assert.equal(pointsApproval.res.status, 201);
    assert.equal(pointsApproval.body.status, "pending");

    const memberAfterRequest = await request("/api/me", { headers: await userHeaders("u_1001") });
    assert.equal(memberAfterRequest.body.points, 2580, "approval request must not change points before review");

    const financeSelfReview = await request(`/api/admin/approval-requests/${pointsApproval.body.id}/approve`, {
      method: "POST",
      headers: await adminHeaders("finance_admin"),
      body: { reason: "finance self review should be blocked" }
    });
    assert.equal(financeSelfReview.res.status, 403, "finance role cannot review its own sensitive request");

    const approvedPoints = await request(`/api/admin/approval-requests/${pointsApproval.body.id}/approve`, {
      method: "POST",
      headers: await adminHeaders("audit_ops"),
      body: { reason: "E2E audit approved manual points debit" }
    });
    assert.equal(approvedPoints.res.status, 200);
    assert.equal(approvedPoints.body.status, "executed");
    assert.equal(approvedPoints.body.result.user.points, 180);

    const memberAfterApproval = await request("/api/me", { headers: await userHeaders("u_1001") });
    assert.equal(memberAfterApproval.body.points, 180);

    const ledgerAfterApproval = await request("/api/admin/ledger", { headers: await adminHeaders("finance_admin") });
    assert.equal(ledgerAfterApproval.res.status, 200);
    assert.ok(
      ledgerAfterApproval.body.pointLedger.some((entry) =>
        entry.bizNo === pointsApproval.body.id
        && entry.changeType === "manual_adjust"
        && entry.direction === "out"
        && entry.points === 2400
        && entry.balanceAfter === 180
      ),
      "manual points approval should write an outbound point ledger"
    );

    const shortfallOrder = await request("/api/orders", {
      method: "POST",
      headers: await userHeaders("u_1001"),
      body: {
        paymentMode: "points_plus_cash",
        fulfillmentType: "pickup",
        pickupSiteId: "site_001",
        items: [{ productId: "p_apple", quantity: 1 }]
      }
    });
    assert.equal(shortfallOrder.res.status, 201);
    assert.equal(shortfallOrder.body.status, "pending_payment");
    assert.equal(shortfallOrder.body.paymentMode, "points_plus_cash");
    assert.equal(shortfallOrder.body.pointAmount, 180);
    assert.equal(shortfallOrder.body.cashAmount, 18.8);

    const payment = await request(`/api/orders/${shortfallOrder.body.id}/payments`, {
      method: "POST",
      headers: await userHeaders("u_1001"),
      body: { channel: "mock_pay", idempotencyKey: "e2e_cash_diff_payment" }
    });
    assert.equal(payment.res.status, 201);
    assert.equal(payment.body.payScene, "cash_diff");
    assert.equal(payment.body.amount, 18.8);
    assert.equal(payment.body.pointAmount, 180);

    const paid = await request(`/api/payments/${payment.body.payNo}/mock-callback`, {
      method: "POST",
      headers: await userHeaders("u_1001"),
      body: { status: "paid", thirdTradeNo: "E2E_CASH_DIFF_001" }
    });
    assert.equal(paid.res.status, 200);
    assert.equal(paid.body.payment.status, "paid");
    assert.equal(paid.body.result.order.status, "paid");
    assert.equal(paid.body.result.order.fulfillmentStatus, "pending_pickup");
    assert.ok(paid.body.result.order.pickupCode);

    const memberAfterPayment = await request("/api/me", { headers: await userHeaders("u_1001") });
    assert.equal(memberAfterPayment.body.points, 0, "cash-shortfall payment should deduct the used points once");

    const finalLedger = await request("/api/admin/ledger", { headers: await adminHeaders("finance_admin") });
    assert.ok(
      finalLedger.body.pointLedger.some((entry) =>
        entry.bizNo === shortfallOrder.body.id
        && entry.changeType === "shopping_deduct"
        && entry.points === 180
        && entry.balanceAfter === 0
      ),
      "cash-shortfall payment should write shopping point deduction ledger"
    );
    assert.ok(
      finalLedger.body.paymentLedger.some((entry) =>
        entry.orderId === shortfallOrder.body.id
        && entry.payScene === "cash_diff"
        && entry.status === "paid"
        && entry.amount === 18.8
      ),
      "cash-shortfall payment should write paid cash_diff ledger"
    );

    const operationLogs = await request("/api/admin/operation-logs", { headers: await adminHeaders("super_admin") });
    assert.ok(operationLogs.body.some((entry) => entry.action === "points.adjust" && entry.targetId === "u_1001"));
    assert.ok(operationLogs.body.some((entry) =>
      entry.action === "approval.execute"
      && entry.targetId === pointsApproval.body.id
      && entry.detail?.targetId === "u_1001"
    ));
  } finally {
    await stopProcess(server);
  }
});

function startServer() {
  return spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(__dirname, "..", ".."),
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      TGG_STORE_MODE: "memory"
    },
    stdio: "ignore"
  });
}

async function userHeaders(userId) {
  return { Authorization: `Bearer ${await getUserToken(userId)}` };
}

async function adminHeaders(roleId) {
  return { Authorization: `Bearer ${await getAdminToken(roleId)}` };
}

async function request(apiPath, options = {}) {
  const body = options.body == null || typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  const res = await fetch(`${BASE}${apiPath}`, {
    ...options,
    body,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const contentType = res.headers.get("content-type") || "";
  const responseBody = contentType.includes("application/json") ? await res.json() : await res.text();
  return { res, body: responseBody };
}

async function getUserToken(userId) {
  if (userTokens.has(userId)) return userTokens.get(userId);
  const result = await request("/api/auth/login", {
    method: "POST",
    body: { userId, password: "123456" }
  });
  assert.equal(result.res.status, 200);
  userTokens.set(userId, result.body.token);
  return result.body.token;
}

async function getAdminToken(roleId) {
  if (adminTokens.has(roleId)) return adminTokens.get(roleId);
  const result = await request("/api/admin/auth/login", {
    method: "POST",
    body: { roleId, password: "123456" }
  });
  assert.equal(result.res.status, 200);
  adminTokens.set(roleId, result.body.token);
  return result.body.token;
}

async function waitForJson(apiPath, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await request(apiPath);
      if (result.res.ok) return result.body;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`Timed out waiting for ${apiPath}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopProcess(child) {
  if (!child || child.killed) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
    setTimeout(resolve, 1200);
  });
}
