const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const storage = { tgg_user: { id: "alice" }, tgg_token: "token" };
  const pending = [], modals = [], paid = [];
  let page;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/order-detail/index.js"), "utf8"), {
    Page: value => { page = value; },
    require: name => name.endsWith("pickup-qr") ? require("../../../../wechat-miniprogram/utils/pickup-qr") : name.endsWith("payment") ? { pay: async value => paid.push(value) } : { request: (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })) },
    wx: { getStorageSync: key => storage[key], showModal: value => modals.push(value), showToast() {} }
  });
  page.setData = value => Object.assign(page.data, value);
  page.onLoad({ id: "order1" });
  return { page, storage, pending, modals, paid };
}
async function loaded(context) {
  const loading = context.page.load();
  context.pending.at(-1).resolve({ id: "order1", status: "pending_payment", refunds: [] });
  await loading;
}

test("order confirmations are locked before modal response and cannot act after account switch", async () => {
  const context = setup(); await loaded(context);
  const { page, modals, pending, storage } = context;
  const event = { currentTarget: { dataset: { action: "cancel" } } };
  const first = page.action(event);
  await page.action(event);
  assert.equal(modals.length, 1);
  assert.equal(page.data.busy, true);
  storage.tgg_user = { id: "bob" };
  modals[0].success({ confirm: true }); await first;
  assert.equal(pending.length, 1);
  assert.equal(page.data.busy, false);
});

test("cancelled confirmation releases lock, confirmed action sends once and reloads", async () => {
  const context = setup(); await loaded(context);
  const { page, modals, pending } = context;
  const event = { currentTarget: { dataset: { action: "cancel" } } };
  const cancelled = page.action(event); modals[0].success({ confirm: false }); await cancelled;
  assert.equal(page.data.busy, false); assert.equal(pending.length, 1);
  const action = page.action(event); modals[1].success({ confirm: true });
  await new Promise(setImmediate);
  assert.equal(pending[1].url, "/api/orders/order1/cancel");
  pending[1].resolve({}); await new Promise(setImmediate);
  pending[2].resolve({ id: "order1", status: "cancelled", refunds: [] }); await action;
  assert.equal(page.data.order.status, "cancelled"); assert.equal(page.data.busy, false);
});

test("old order requests cannot replace new results and failure removes cached order", async () => {
  const { page, pending } = setup();
  const old = page.load(), current = page.load();
  pending[1].resolve({ id: "order1", status: "paid" }); await current;
  pending[0].resolve({ id: "order1", status: "pending_payment" }); await old;
  assert.equal(page.data.order.status, "paid");
  const failed = page.load(); pending[2].reject(new Error("offline")); await failed;
  assert.equal(page.data.order, null); assert.equal(page.data.error, "offline");
  await page.refund(); assert.equal(pending.length, 3);
});

test("expired order session leaves an actionable error instead of a blank page", async () => {
  const context = setup();
  const loading = context.page.load();
  context.storage.tgg_user = null;
  context.storage.tgg_token = null;
  const error = new Error("登录已失效，请重新登录");
  error.statusCode = 401;
  context.pending[0].reject(error);

  await loading;

  assert.equal(context.page.data.loading, false);
  assert.equal(context.page.data.order, null);
  assert.equal(context.page.data.error, "登录已失效，请重新登录");
  assert.equal(context.page.data.needLogin, true);
});

test("account switch before payment response prevents native payment invocation", async () => {
  const context = setup(); await loaded(context);
  const { page, pending, storage, paid } = context;
  const payment = page.pay();
  storage.tgg_user = { id: "bob" };
  pending[1].resolve({ payNo: "alice-payment" }); await payment;
  assert.equal(paid.length, 0); assert.equal(page.data.busy, false);
});

const pickupOrder = { id: "order1", status: "paid", fulfillmentType: "pickup", fulfillmentStatus: "pending_pickup", pickupCode: "123456" };
test("pickup QR appears for a paid pickup order and disappears on refund, handover, delivery and failed refresh", async () => {
  const { page, pending } = setup();
  for (const change of [{}, { status: "refunding" }, { status: "refunded" }, { status: "completed", fulfillmentStatus: "picked_up" }, { status: "cancelled" }, { status: "pending_payment" }, { fulfillmentType: "delivery" }]) {
    const loading = page.load();
    assert.equal(page.data.pickupQr, null);
    pending.at(-1).resolve({ ...pickupOrder, ...change }); await loading;
    assert.equal(Boolean(page.data.pickupQr), Object.keys(change).length === 0);
  }
  const loading = page.load(); pending.at(-1).reject(new Error("offline")); await loading;
  assert.equal(page.data.pickupQr, null);
  const markup = fs.readFileSync(path.resolve(__dirname, "../../../../wechat-miniprogram/pages/order-detail/index.wxml"), "utf8");
  assert.match(markup, /wx:for="\{\{pickupQr.runs\}\}"/);
  assert.match(markup, /工作人员核对货物后确认提货/);
});

test("account switch, hidden page and stale responses cannot expose the previous pickup QR", async () => {
  const { page, pending, storage } = setup();
  let loading = page.load(); pending.at(-1).resolve(pickupOrder); await loading;
  assert.ok(page.data.pickupQr);
  page.onHide(); assert.equal(page.data.pickupQr, null);
  loading = page.load(); page.onHide(); pending.at(-1).resolve(pickupOrder); await loading;
  assert.equal(page.data.pickupQr, null);
  loading = page.load(); storage.tgg_user = { id: "bob" }; pending.at(-1).resolve(pickupOrder); await loading;
  assert.equal(page.data.pickupQr, null);
  storage.tgg_user = { id: "alice" };
  const old = page.load(), current = page.load();
  pending.at(-1).resolve({ ...pickupOrder, status: "refunding" }); await current;
  pending.at(-2).resolve(pickupOrder); await old;
  assert.equal(page.data.pickupQr, null);
});
