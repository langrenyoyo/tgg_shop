process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const XLSX = require("xlsx");
const { exportProducts } = require("../../src/services/product-export-service");
const { HEADERS } = require("../../src/services/product-import-service");
const { handleAdminRoutes } = require("../../src/routes/admin-routes");
const { createSeed } = require("../../src/data/seed");
const { issueToken } = require("../../src/domain/auth");
const data = buffer => {
  const book = XLSX.read(buffer, { type: "buffer" });
  return { book, rows: XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: "" }) };
};

test("XLS export matches the exact template headers, has no instruction or extra columns, and is read-only", () => {
  const state = createSeed();
  state.products = [
    { id: "late", name: "下架商品", category: "水果", unit: "500g", stock: 0, regularPrice: 0, cashPrice: 0, sortOrder: 2, status: "off", image: "/secret.png", pointsPrice: 50 },
    { id: "first", name: "上架商品", category: "日用", pospalBarcode: "000123", sortOrder: 1, status: "on" },
    { id: "deleted", name: "已删除", deletedAt: "2026-11-19" }
  ];
  const before = JSON.stringify(state), buffer = exportProducts(state), { book, rows } = data(buffer);
  assert.equal(buffer.subarray(0, 8).toString("hex"), "d0cf11e0a1b11ae1");
  assert.deepEqual(rows[0], HEADERS); assert.equal(book.SheetNames.length, 1);
  const suppliedTemplate = path.resolve(__dirname, "../../../../商品导入模板.xls");
  if (fs.existsSync(suppliedTemplate)) assert.deepEqual(rows[0], data(fs.readFileSync(suppliedTemplate)).rows[0]);
  assert.equal(rows.length, 3); assert.ok(rows.every(row => row.length === 17));
  assert.deepEqual(rows[1], ["上架商品", "日用", "000123", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  assert.deepEqual(rows[2], ["下架商品", "水果", "", "500g", "", 0, "", 0, "", 0, "", "", "", "", "", "", ""]);
  assert.equal(JSON.stringify(state), before);
});

test("current product data overrides import snapshots; only known purchasing fields and unchanged split units are exported", () => {
  const state = createSeed();
  state.products = [{ id: "imported", name: "新名称", category: "水果", barcode: "0009876543210", unit: "500g / 盒", stock: 9,
    regularPrice: 12.5, cashPrice: 8.8, status: "off" }];
  state.config.productImports = { metadata: { imported: { specification: "500g", mainUnit: "盒", costPrice: 0,
    salePrice: 10, memberPrice: 8, wholesalePrice: 6, memberDiscount: "否", stockMax: 100, stockMin: 0,
    brand: "果园", supplier: "供货商", productionDate: "2026-11-19", shelfLife: "30天", sourceRow: 3, importBatchId: "private" } } };
  assert.deepEqual(data(exportProducts(state)).rows[1], ["新名称", "水果", "0009876543210", "500g", "盒", 9, 0, 12.5, 6, 8.8, "否", 100, 0, "果园", "供货商", "2026-11-19", "30天"]);
  state.products[0].unit = "1kg / 袋"; state.products[0].regularPrice = null; state.products[0].cashPrice = null;
  const changed = data(exportProducts(state)).rows[1];
  assert.equal(changed[3], "1kg / 袋"); assert.equal(changed[4], ""); assert.equal(changed[7], ""); assert.equal(changed[9], "");
  state.products[0].unit = "";
  assert.deepEqual(data(exportProducts(state)).rows[1].slice(3, 5), ["", ""]);
});

test("empty exports contain just the template header, and formula-like text and leading zeros remain literal", () => {
  const state = { products: [], config: {} };
  assert.deepEqual(data(exportProducts(state)).rows, [HEADERS]);
  state.products = [{ id: "p", name: "=1+1", category: "+类别", barcode: "000000012345678901", unit: "@单位", regularPrice: "参考零售价 12 元" }];
  const { book, rows } = data(exportProducts(state)), sheet = book.Sheets[book.SheetNames[0]];
  assert.equal(sheet.A2.t, "s"); assert.equal(sheet.A2.f, undefined); assert.equal(rows[1][0], "=1+1");
  assert.equal(sheet.C2.t, "s"); assert.equal(rows[1][2], state.products[0].barcode); assert.equal(rows[1][7], "参考零售价 12 元");
  assert.equal(rows[1][10], "", "never manufacture a member discount flag");
});

async function request(state, role) {
  const req = { method: "GET", headers: {} };
  if (role) {
    const token = issueToken({ type: "admin", roleId: role });
    const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url"));
    state.authSessions.push({ subjectType: "admin", subjectId: role, tokenId: payload.tokenId, expiresAt: new Date(payload.exp * 1000).toISOString() });
    req.headers.authorization = `Bearer ${token}`;
  }
  let response;
  await handleAdminRoutes({ state, req, url: new URL("http://localhost/api/admin/products/export.xls"),
    send: (_, status, body, headers) => { response = { status, body, headers }; } });
  return response;
}

test("export endpoint requires product read permission and returns a private XLS attachment", async () => {
  const state = createSeed();
  assert.equal((await request(state)).status, 401);
  assert.equal((await request(state, "customer_service")).status, 403);
  const response = await request(state, "operation_admin");
  assert.equal(response.status, 200); assert.ok(Buffer.isBuffer(response.body));
  assert.equal(response.headers["Content-Type"], "application/vnd.ms-excel");
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.match(response.headers["Content-Disposition"], /attachment;.*products\.xls/);
  assert.equal(data(response.body).rows.length, state.products.filter(p => !p.deletedAt).length + 1);
});

test("export button downloads the authenticated XLS, blocks double clicks, reports failure and discards expired-session results", async () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../../frontend/admin/js/product-import.js"), "utf8").replace(/export /g, "");
  const links = [], pending = [];
  const ctx = vm.createContext({
    URL: { createObjectURL: () => "blob:export", revokeObjectURL() {} }, setTimeout: fn => fn(),
    document: { createElement: () => { const link = { click() { links.push({ name: this.download, href: this.href }); } }; return link; } }
  });
  vm.runInContext(source, ctx);
  const state = { identity: { permissions: ["product:read"] } };
  const controller = ctx.createProductImport(state, { api: (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })), render() {} });
  const click = () => controller.click({ target: { closest: selector => selector === "[data-product-export]" ? {} : null } });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  click(); click(); assert.equal(pending.length, 1); assert.equal(state.productExport.busy, true);
  assert.equal(pending[0].url, "/api/admin/products/export.xls"); assert.equal(pending[0].options.responseType, "blob");
  pending[0].resolve({}); await settle();
  assert.deepEqual(links, [{ name: "商品数据.xls", href: "blob:export" }]); assert.equal(state.productExport.busy, false);
  click(); pending[1].reject(new Error("导出暂不可用")); await settle();
  assert.equal(state.productExport.error, "导出暂不可用"); assert.equal(state.productExport.busy, false);
  click(); controller.invalidate(); pending[2].resolve({}); await settle(); assert.equal(links.length, 1);
  state.identity.permissions = []; click(); assert.equal(pending.length, 3);
});
