// Runs the mini-program product -> cart -> checkout page scripts against an isolated memory backend.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const baseUrl = process.env.MINIPROGRAM_TEST_BASE_URL || "http://127.0.0.1:5788";
const miniRoot = path.resolve(__dirname, "../../../wechat-miniprogram");
const storage = new Map();
const pages = [];
const navigation = [];
const modules = new Map();
const app = { globalData: {} };

const wx = {
  getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: key => storage.delete(key),
  getApp: () => app,
  request: options => {
    fetch(options.url, {
      method: options.method || "GET",
      headers: options.header,
      body: options.method && options.method !== "GET" ? JSON.stringify(options.data ?? {}) : undefined
    }).then(async response => {
      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await response.json() : await response.text();
      options.success?.({ statusCode: response.status, data });
    }).catch(error => options.fail?.({ errMsg: error.message }));
  },
  redirectTo: options => navigation.push(options.url),
  navigateTo: options => navigation.push(options.url),
  switchTab: options => navigation.push(options.url),
  showToast: () => {}
};

function resolveModule(from, request) {
  const candidate = path.resolve(path.dirname(from), request);
  if (fs.existsSync(candidate)) return candidate;
  if (fs.existsSync(candidate + ".js")) return candidate + ".js";
  throw new Error(`Cannot resolve mini-program module ${request} from ${from}`);
}

function load(file) {
  if (!file.endsWith(".js")) file += ".js";
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    module,
    exports: module.exports,
    wx,
    getApp: () => app,
    Page: page => pages.push(page),
    require: request => {
      if (!request.startsWith(".")) throw new Error(`Unexpected external module ${request}`);
      return load(resolveModule(file, request));
    }
  }, { filename: file });
  return module.exports;
}

function pageFor(relativePath) {
  const before = pages.length;
  load(path.join(miniRoot, relativePath));
  const page = pages[before];
  page.setData = (data, callback) => {
    Object.assign(page.data, data);
    callback?.();
  };
  return page;
}

async function waitFor(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for mini-program page state");
}

async function request(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body: options.data == null ? undefined : JSON.stringify(options.data)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${url} ${response.status}: ${body.error || "request failed"}`);
  return body;
}

(async () => {
  const login = await request("/api/auth/login", { method: "POST", data: { userId: "u_1002", password: "123456" } });
  storage.set("tgg_token", login.token);
  storage.set("tgg_user", login.user);
  storage.set("tgg_config", { tggApiUrl: baseUrl });
  app.globalData.token = login.token;
  app.globalData.user = login.user;

  const productPage = pageFor("pages/product/index.js");
  productPage.onLoad({ id: "p_banana" });
  await productPage.load();
  if (productPage.data.product?.id !== "p_banana") throw new Error(`Product page did not load p_banana: ${JSON.stringify({ data: productPage.data })}`);
  productPage.add();

  const cartPage = pageFor("pages/cart/index.js");
  await cartPage.load();
  if (cartPage.data.items.length !== 1 || cartPage.data.items[0].productId !== "p_banana") throw new Error("Cart page did not retain the selected product");
  cartPage.checkout();

  const checkoutPage = pageFor("pages/checkout/index.js");
  checkoutPage.onLoad();
  await waitFor(() => checkoutPage.data.loading === false);
  if (!checkoutPage.data.modes.some(mode => mode.id === "pure_points")) throw new Error("Checkout page did not expose pure-points payment");
  await checkoutPage.submit();
  const redirect = navigation.find(url => url.includes("/pages/order-detail/index?id="));
  if (!redirect) throw new Error("Checkout page did not redirect to order detail");
  const orderId = decodeURIComponent(new URL(`https://local.test${redirect}`).searchParams.get("id"));
  const order = await request(`/api/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Bearer ${login.token}` } });
  if (order.status !== "paid" || order.paymentMode !== "pure_points") throw new Error(`Unexpected order result: ${order.status}/${order.paymentMode}`);
  const user = await request("/api/me", { headers: { Authorization: `Bearer ${login.token}` } });
  console.log(JSON.stringify({ ok: true, flow: ["product", "cart", "checkout", "order"], productId: "p_banana", orderId, orderStatus: order.status, paymentMode: order.paymentMode, remainingPoints: user.points, navigation: redirect }));
})().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
