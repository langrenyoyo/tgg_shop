process.env.NODE_NO_WARNINGS = "1";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_PORT = 5200 + Math.floor(Math.random() * 400);
const CDP_PORT = 9300 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${APP_PORT}`;

test("user and admin frontends support core click flows", async (t) => {
  const chromePath = findChrome();
  if (!chromePath) {
    t.skip("Chrome executable not found; skipping browser E2E");
    return;
  }

  const server = startServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-cdp-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-extensions",
    "--remote-allow-origins=*",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: "ignore" });

  try {
    await waitForJson(`${BASE}/api/health`);
    await waitForJson(`http://127.0.0.1:${CDP_PORT}/json/version`);

    const userPage = await CDPPage.create(`${BASE}/user?skipSplash=1`);
    await userPage.waitForText("热门推荐");
    await userPage.click('button[data-tab="category"]');
    await userPage.waitForText("商品分类");
    await userPage.click('[data-category-name="纯积分"]');
    await userPage.waitForText("纯积分 · 综合");
    await userPage.waitForText("精品香蕉 2斤");
    await userPage.waitForExpression(`!document.body.innerText.includes("丹东草莓 500g")`);
    await userPage.click('[data-category-name="水果"]');
    await userPage.waitForText("水果 · 综合");
    await userPage.waitForText("丹东草莓 500g");
    await userPage.click('[data-category-mode="cash"]');
    await userPage.waitForText("水果 · 会员现金购");
    await userPage.waitForExpression(`document.querySelector('[data-category-mode="cash"]').classList.contains('active')`);
    await userPage.click('[data-category-name="全部"]');
    await userPage.click('[data-category-mode="pure"]');
    await userPage.waitForText("全部 · 纯积分兑");
    await userPage.waitForText("精品香蕉 2斤");
    await userPage.click('button[data-tab="home"]');
    await userPage.waitForText("热门推荐");
    await userPage.click('[data-page="pointsExchange"]');
    await userPage.waitForText("纯积分兑换专区");
    await userPage.click('[data-cart-product="p_banana"]');
    await userPage.waitForText("已加入购物车");
    await userPage.click('button[data-tab="cart"]');
    await userPage.waitForExpression(`Boolean(document.querySelector('[data-page="checkoutPickup"]'))`);
    await userPage.click('[data-page="checkoutPickup"]');
    await userPage.waitForText("确认订单");
    await userPage.click('[data-checkout-submit="pickup"]');
    await userPage.waitForText("我的订单");
    await userPage.waitForText("核销码");

    await userPage.evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'u_1002', password: '123456' }) })
      .then((res) => res.json())
      .then((data) => {
        localStorage.setItem('tggUserId', 'u_1002');
        localStorage.setItem('tggUserToken', data.token);
        localStorage.setItem('tggUserRefreshToken', data.refreshToken);
      })`);
    await userPage.goto(`${BASE}/user?skipSplash=1`);
    await userPage.waitForText("热门推荐");

    const normalUserBefore = await userPage.evaluate(`fetch('/api/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tggUserToken') } }).then((res) => res.json())`);
    assert.equal(normalUserBefore.isMember, false, "u_1002 should start as a normal user");

    await userPage.click('[data-page="pointsExchange"]');
    await userPage.waitForText("纯积分兑换专区");
    await userPage.click('[data-cart-product="p_bokchoy"]');
    await userPage.waitForText("已加入购物车");
    await userPage.click('button[data-tab="cart"]');
    await userPage.waitForExpression(`Boolean(document.querySelector('[data-page="checkoutPickup"]'))`);
    await userPage.click('[data-page="checkoutPickup"]');
    await userPage.waitForText("纯积分兑换订单");
    await userPage.click('[data-checkout-submit="pickup"]');
    await userPage.waitForText("我的订单");
    await userPage.waitForText("有机青菜 1份");

    const normalUserAfterExchange = await userPage.evaluate(`fetch('/api/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tggUserToken') } }).then((res) => res.json())`);
    const normalUserOrders = await userPage.evaluate(`fetch('/api/orders', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tggUserToken') } }).then((res) => res.json())`);
    const purePointsOrder = normalUserOrders.find((order) =>
      order.paymentMode === "pure_points"
      && order.items.some((item) => item.productId === "p_bokchoy")
    );
    assert.ok(purePointsOrder, "normal user should complete a pure-points order");
    assert.ok(purePointsOrder.pickupCode, "pure-points pickup order should generate a pickup code");
    assert.equal(normalUserAfterExchange.points, normalUserBefore.points - 99, "pure-points order should deduct points");
    assert.equal(normalUserAfterExchange.isMember, false, "pure-points exchange must not silently upgrade membership");

    await userPage.click('button[data-tab="home"]');
    await userPage.waitForText("热门推荐");
    await userPage.click('[data-buy="p_strawberry"]');
    await userPage.waitForText("会员开通");
    await userPage.waitForText("当前为普通用户");
    await userPage.waitForText("开通 1 个月会员");

    await userPage.click('[data-action="member"]');
    await userPage.waitForText("会员剩余");
    await userPage.waitForText("续费 1 个月会员");

    const openedMember = await userPage.evaluate(`fetch('/api/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tggUserToken') } }).then((res) => res.json())`);
    const openedMemberPayments = await userPage.evaluate(`fetch('/api/payments', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tggUserToken') } }).then((res) => res.json())`);
    assert.equal(openedMember.isMember, true, "member subscription should activate membership");
    assert.ok(openedMember.memberDaysLeft > 0, "activated member should have remaining days");
    assert.ok(
      openedMemberPayments.some((payment) => payment.payScene === "member_open" && payment.status === "paid"),
      "member subscription should create a paid membership ledger"
    );

    const firstMemberUntil = new Date(openedMember.memberUntil).getTime();
    await userPage.click('[data-action="member"]');
    await userPage.waitForExpression(`fetch('/api/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tggUserToken') } })
      .then((res) => res.json())
      .then((user) => new Date(user.memberUntil).getTime() > ${firstMemberUntil})`);

    const renewedMember = await userPage.evaluate(`fetch('/api/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tggUserToken') } }).then((res) => res.json())`);
    const renewedMemberPayments = await userPage.evaluate(`fetch('/api/payments', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tggUserToken') } }).then((res) => res.json())`);
    assert.ok(
      new Date(renewedMember.memberUntil).getTime() - firstMemberUntil >= 27 * 24 * 60 * 60 * 1000,
      "renewal should extend membership by about one month"
    );
    assert.ok(
      renewedMemberPayments.filter((payment) => payment.payScene === "member_open" && payment.status === "paid").length >= 2,
      "opening and renewing membership should create two paid membership ledgers"
    );

    await userPage.click('button[data-tab="home"]');
    await userPage.waitForText("热门推荐");
    await userPage.click('[data-buy="p_strawberry"]');
    await userPage.waitForText("我的订单");
    await userPage.waitForText("丹东草莓 500g");

    const memberOrders = await userPage.evaluate(`fetch('/api/orders', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tggUserToken') } }).then((res) => res.json())`);
    const memberPayments = await userPage.evaluate(`fetch('/api/payments', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tggUserToken') } }).then((res) => res.json())`);
    const cashOrder = memberOrders.find((order) =>
      order.paymentMode === "cash"
      && order.items.some((item) => item.productId === "p_strawberry")
    );
    assert.ok(cashOrder, "member should complete a cash order");
    assert.equal(cashOrder.status, "paid", "member cash order should complete payment callback");
    assert.ok(cashOrder.pickupCode, "paid member pickup order should generate a pickup code");
    assert.ok(
      memberPayments.some((payment) =>
        payment.orderId === cashOrder.id
        && payment.payScene === "goods_cash"
        && payment.status === "paid"
      ),
      "member cash order should create a paid goods payment ledger"
    );

    await runUserFlowPatrol(userPage);
    assert.deepEqual(userPage.runtimeErrors(), [], "user page should not emit runtime errors during browser patrol");

    await userPage.evaluate(`fetch('/api/withdrawals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('tggUserToken') },
      body: JSON.stringify({ amount: 1, channel: 'wechat' })
    })`);

    const adminPage = await CDPPage.create(`${BASE}/admin`);
    await adminPage.evaluate(`localStorage.setItem('tggAdminRole', 'super_admin'); localStorage.removeItem('tggAdminToken')`);
    await adminPage.goto(`${BASE}/admin`);
    await adminPage.waitForText("运营仪表盘");
    await adminPage.waitForText("最近订单");
    await runAdminConsistencyPatrol(adminPage);
    await adminPage.waitForExpression(`(() => {
      const button = document.querySelector('button[data-view="financeRefund"]');
      return Boolean(button && !button.disabled);
    })()`);
    await adminPage.click('button[data-view="financeRefund"]');
    await adminPage.waitForText("提现审批");
    await adminPage.waitForExpression(`Boolean(document.querySelector('[data-withdraw-action][data-action-type="approve"]'))`);
    await adminPage.click('[data-withdraw-action][data-action-type="approve"]');
    await adminPage.waitForText("复核中");
    await adminPage.waitForText("二级审批队列");

    const hasGarbledText = await userPage.evaluate(`/[璧鎴閫绉鍟姣浠濮鏀寰锟�]/.test(document.body.innerText)`);
    assert.equal(hasGarbledText, false, "user page should not show mojibake text");

    await userPage.close();
    await adminPage.close();
  } finally {
    await stopProcess(server);
    await stopProcess(chrome);
    removeDirBestEffort(userDataDir);
  }
});

async function runAdminConsistencyPatrol(adminPage) {
  const views = [
    ["dashboard", "最近订单"],
    ["orders", "订单列表"],
    ["stateMachine", "订单状态流转"],
    ["deliveryTeam", "配送员"],
    ["products", "商品上架与销售设置"],
    ["pointsExchange", "纯积分兑换设置"],
    ["users", "用户列表"],
    ["customerTickets", "客服/反馈/合作/招聘工单"],
    ["agentsPickup", "自提点与代理"],
    ["taskReview", "任务提交审核"],
    ["signinAds", "广告组规则"],
    ["financeRefund", "提现审批"],
    ["ledger", "支付单流水"],
    ["ranking", "月榜规则"],
    ["permissions", "角色权限矩阵"],
    ["exceptions", "异常补偿"],
    ["settings", "会员与支付设置"]
  ];

  for (const [view, text] of views) {
    await adminPage.click(`button[data-view="${view}"]`);
    await adminPage.waitForText(text);
  }

  await adminPage.click('button[data-view="orders"]');
  await adminPage.waitForText("山东京富士苹果");
  await adminPage.waitForText("待配送");
  await adminPage.click('button[data-view="products"]');
  await adminPage.waitForText("丹东草莓 500g");
  await adminPage.click('button[data-view="pointsExchange"]');
  await adminPage.waitForText("精品香蕉 2斤");
  await adminPage.click('button[data-view="taskReview"]');
  await adminPage.waitForText("审核中");
  await adminPage.click('button[data-view="customerTickets"]');
  await adminPage.waitForText("巡检客服工单");
  await adminPage.waitForText("巡检反馈");
  await adminPage.click('[data-ticket-action][data-action-type="resolved"]');
  await adminPage.waitForText("已处理完成");
  await adminPage.click('button[data-view="users"]');
  await adminPage.waitForText("续 1 月");
  await adminPage.click('[data-user-action][data-action-type="extend"]');
  await adminPage.waitForText("月会员");
  await adminPage.click('button[data-view="agentsPickup"]');
  await adminPage.fillFormAndSubmit("[data-pickup-create-form]", {
    name: "巡检自提站",
    address: "师大南门巡检点",
    contactName: "巡检代理",
    contactPhone: "13800003333",
    enabled: true
  });
  await adminPage.waitForText("巡检自提站");
  await adminPage.click('button[data-view="deliveryTeam"]');
  await adminPage.fillFormAndSubmit("[data-delivery-team-create-form]", {
    name: "巡检配送队",
    serviceArea: "师大南区 3km",
    enabled: true
  });
  await adminPage.waitForText("巡检配送队");
  await adminPage.click('button[data-view="financeRefund"]');
  await adminPage.waitForText("退款审批");
  await adminPage.waitForText("提现审批");
  await adminPage.click('button[data-view="ledger"]');
  await adminPage.waitForText("会员开通");
  await adminPage.waitForText("现金购物");
  await adminPage.click('button[data-view="settings"]');
  await adminPage.waitForText("纯积分兑换不允许现金补差");
}

async function runUserFlowPatrol(userPage) {
  await userPage.click('button[data-tab="profile"]');
  await userPage.waitForText("我的订单");
  await userPage.click('[data-page="address"]');
  await userPage.waitForText("新增地址");
  await userPage.fillFormAndSubmit("[data-address-form]", {
    receiverName: "测试收货人",
    mobile: "13900001111",
    province: "江苏省",
    city: "南京市",
    district: "栖霞区",
    detail: "师大测试宿舍 8 栋 808",
    isDefault: true
  });
  await userPage.waitForText("地址已新增");
  await userPage.waitForText("测试收货人");

  await userPage.click('button[data-tab="home"]');
  await userPage.waitForText("热门推荐");
  await userPage.click('[data-page="signin"]');
  await userPage.waitForText("今日任务");
  await userPage.click('[data-action="signin"]');
  await userPage.waitForText("抽奖结果");

  await userPage.click('button[data-tab="earn"]');
  await userPage.waitForText("做任务");
  await userPage.click("[data-task]");
  await userPage.waitForText("任务详情");
  await userPage.click('[data-page="taskSubmit"]');
  await userPage.waitForText("确认提交");
  await userPage.fillFormAndSubmit("[data-submit-task]", {
    name: "测试用户",
    mobile: "13900001111",
    images: "https://example.com/proof.png",
    text1: "浏览器巡检任务提交"
  });
  await userPage.waitForText("任务已提交");
  await userPage.waitForText("审核中");

  await userPage.click('button[data-tab="home"]');
  await userPage.waitForText("热门推荐");
  await userPage.click('[data-page="invite"]');
  await userPage.waitForText("我的邀请码");
  await userPage.click('button[data-tab="home"]');
  await userPage.waitForText("热门推荐");
  await userPage.click('[data-page="pickupSite"]');
  await userPage.waitForText("师大自提站");

  await userPage.click('button[data-tab="home"]');
  await userPage.waitForText("热门推荐");
  await userPage.click('img[data-product-open="p_apple"]');
  await userPage.waitForText("商品保障");
  await userPage.click('[data-cart-product="p_apple"]');
  await userPage.waitForText("已加入购物车");
  await userPage.click('button[data-tab="cart"]');
  await userPage.waitForExpression(`Boolean(document.querySelector('[data-page="checkoutPickup"]'))`);
  await userPage.click('[data-page="checkoutPickup"]');
  await userPage.waitForText("确认订单");
  await userPage.click('[data-page="checkoutDelivery"]');
  await userPage.waitForText("送货上门");
  await userPage.waitForText("师大测试宿舍 8 栋 808");
  await userPage.click('[data-checkout-submit="delivery"]');
  await userPage.waitForText("我的订单");
  await userPage.waitForText("山东京富士苹果");
  await userPage.waitForText("待配送");

  await userPage.click("[data-order-open]");
  await userPage.waitForText("订单详情");
  await userPage.click("[data-refund]");
  await userPage.waitForText("退款申请已提交");
  await userPage.waitForText("退款处理中");

  await userPage.click('button[data-tab="profile"]');
  await userPage.waitForText("我的订单");
  await userPage.click('[data-page="membership"]');
  await userPage.waitForText("会员剩余");
  await userPage.click('button[data-tab="profile"]');
  await userPage.click('[data-page="pointsLedger"]');
  await userPage.waitForText("积分明细");
  await userPage.click('button[data-tab="profile"]');
  await userPage.click('[data-page="payments"]');
  await userPage.waitForText("支付记录");
  await userPage.click('button[data-tab="profile"]');
  await userPage.click('[data-page="withdraw"]');
  await userPage.waitForText("可提现余额");
  await userPage.click('[data-action="withdraw"]');
  await userPage.waitForText("提现申请已提交");
  await userPage.click('button[data-tab="profile"]');
  await userPage.click('[data-page="ranking"]');
  await userPage.waitForText("积分排行榜");
  await userPage.click('button[data-tab="profile"]');
  await userPage.click('[data-page="agentScan"]');
  await userPage.waitForText("代理核销");
  await userPage.click('button[data-tab="profile"]');
  await userPage.click('[data-page="refund"]');
  await userPage.waitForText("退款规则");
  await userPage.click('button[data-tab="profile"]');
  await userPage.click('[data-page="customerService"]');
  await userPage.waitForText("在线客服");
  await userPage.fillFormAndSubmit("[data-ticket-form]", {
    subject: "巡检客服工单",
    contactName: "巡检用户",
    contactPhone: "13900002222",
    content: "巡检客服工单：订单配送咨询"
  });
  await userPage.waitForText("已提交，后台客服会跟进处理");
  await userPage.waitForText("巡检客服工单");
  await userPage.click('button[data-tab="profile"]');
  await userPage.click('[data-page="feedback"]');
  await userPage.waitForText("提交反馈");
  await userPage.fillFormAndSubmit("[data-ticket-form]", {
    subject: "巡检反馈",
    contactName: "巡检用户",
    contactPhone: "13900002222",
    content: "巡检反馈：页面体验建议"
  });
  await userPage.waitForText("巡检反馈");
  await userPage.click('button[data-tab="profile"]');
  await userPage.click('[data-page="business"]');
  await userPage.waitForText("合作申请");
  await userPage.click('button[data-tab="profile"]');
  await userPage.click('[data-page="recruiting"]');
  await userPage.waitForText("招聘岗位");
}

class CDPPage {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.loadResolvers = [];
    this.logs = [];
    ws.onmessage = (event) => this.handleMessage(JSON.parse(event.data));
  }

  static async create(url) {
    const target = await createTarget(url);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const page = new CDPPage(ws);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Log.enable").catch(() => {});
    page.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Page.javascriptDialogOpening") {
        page.send("Page.handleJavaScriptDialog", { accept: true, promptText: "E2E 自动确认" }).catch(() => {});
      }
    });
    await page.goto(url);
    return page;
  }

  handleMessage(message) {
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === "Page.loadEventFired") {
      const resolvers = this.loadResolvers.splice(0);
      for (const resolve of resolvers) resolve();
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails || {};
      const exception = details.exception || {};
      const location = [details.url, details.lineNumber != null ? details.lineNumber + 1 : null, details.columnNumber != null ? details.columnNumber + 1 : null].filter(Boolean).join(":");
      this.logs.push(`exception: ${exception.description || details.text || "Runtime exception"}${location ? ` @ ${location}` : ""}`);
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const args = message.params?.args?.map((arg) => arg.value || arg.description).filter(Boolean).join(" ");
      this.logs.push(`console.${message.params?.type || "log"}: ${args}`);
    }
    if (message.method === "Log.entryAdded") {
      this.logs.push(`log.${message.params?.entry?.level || "info"}: ${message.params?.entry?.text || ""}`);
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 8000);
    });
  }

  async goto(url) {
    const loaded = new Promise((resolve) => this.loadResolvers.push(resolve));
    await this.send("Page.navigate", { url });
    await loaded;
  }

  async click(selector) {
    await this.waitForExpression(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Missing selector: ${selector}');
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`);
  }

  async fillFormAndSubmit(selector, values) {
    await this.evaluate(`(() => {
      const form = document.querySelector(${JSON.stringify(selector)});
      if (!form) throw new Error('Missing form: ${selector}');
      const values = ${JSON.stringify(values)};
      for (const [name, value] of Object.entries(values)) {
        const field = form.querySelector('[name="' + name + '"]');
        if (!field) continue;
        if (field.type === 'checkbox') field.checked = Boolean(value);
        else field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }
      form.requestSubmit();
      return true;
    })()`);
  }

  async waitForText(text, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = await this.evaluate(`document.body && document.body.innerText.includes(${JSON.stringify(text)})`);
      if (found) return;
      await sleep(100);
    }
    const body = await this.evaluate(`document.body ? document.body.innerText.slice(0, 1000) : ''`);
    throw new Error(`Timed out waiting for text: ${text}\n${body}\nBrowser logs:\n${this.logs.slice(-10).join("\n")}`);
  }

  async waitForExpression(expression, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await this.evaluate(expression);
      if (result) return;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for expression: ${expression}`);
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
    }
    return result.result?.value;
  }

  runtimeErrors() {
    return this.logs.filter((entry) =>
      entry.startsWith("exception:")
      || entry.startsWith("console.error:")
    );
  }

  close() {
    this.ws.close();
  }
}

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

async function createTarget(url) {
  const endpoint = `http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`;
  const res = await fetch(endpoint, { method: "PUT" });
  if (!res.ok) throw new Error(`Failed to create CDP target: ${res.status}`);
  return res.json();
}

async function waitForJson(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
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

function removeDirBestEffort(dir) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      // Chrome may release profile files a moment after process exit on Windows.
    }
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}
