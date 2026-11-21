process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { Readable } = require("node:stream");
const XLSX = require("xlsx");
const service = require("../../src/services/product-import-service");
const admin = require("../../src/services/admin-service");
const { createSeed } = require("../../src/data/seed");
const { issueToken } = require("../../src/domain/auth");
const { activeConfig } = require("../../src/config/active-config");
const { handleProductImportRoutes } = require("../../src/routes/product-import-routes");
const { handleAdminRoutes } = require("../../src/routes/admin-routes");
const { saveSQLiteState, loadSQLiteState } = require("../../src/data/sqlite-store");
const actor = { adminId: "importer", role: { id: "product_admin", permissions: ["product:write", "stock:write"] } };
const row = (extra = {}) => Object.assign({ name: "导入苹果", category: "水果", barcode: "0001234567890", specification: "500g", mainUnit: "盒", stock: 10,
  costPrice: 3.5, salePrice: 10, wholesalePrice: 6, memberPrice: 8, memberDiscount: "否", stockMax: 100, stockMin: 5,
  brand: "果园", supplier: "水果供货商", productionDate: "2026-11-19", shelfLife: "30天" }, extra);
const keys = ["name", "category", "barcode", "specification", "mainUnit", "stock", "costPrice", "salePrice", "wholesalePrice", "memberPrice", "memberDiscount", "stockMax", "stockMin", "brand", "supplier", "productionDate", "shelfLife"];
function workbook(rows, { headers = service.HEADERS, sheetEdit, extraSheet, note = true } = {}) {
  const data = [headers];
  if (note) data.push(Array(9).fill("").concat("如需会员价，会员折扣填“否”"));
  for (const item of rows) data.push(Array.isArray(item) ? item : keys.map(key => item[key] ?? ""));
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet(data);
  if (sheetEdit) sheetEdit(sheet);
  XLSX.utils.book_append_sheet(book, sheet, "商品");
  if (extraSheet) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["额外数据"]]), "其他");
  return XLSX.write(book, { type: "buffer", bookType: "biff8" });
}
const analyze = (rows, options, state = createSeed(), staff = actor) => service.analyze(state, workbook(rows, options), "商品.xls", staff).report;
const preview = (state, rows, staff = actor) => service.previewImport(state, workbook(rows), "商品.xls", staff);
const commit = (state, report, save = async () => {}, extra = {}, staff = actor) => service.commitImport(state,
  { previewId: report.previewId, reason: "首批资料导入", acknowledgeWarnings: true, ...extra }, staff, admin.logOperation, save);

test("the supplied 17-column template and generated download are recognized; instruction row is not a product", t => {
  const filename = path.resolve(__dirname, "../../../../商品导入模板.xls");
  if (fs.existsSync(filename)) {
    const report = service.analyze(createSeed(), fs.readFileSync(filename), "商品.xls", actor).report;
    assert.equal(report.total, 0); assert.equal(report.errors.length, 1); assert.match(report.errors[0].message, /没有商品/);
  } else t.diagnostic("User-supplied workbook absent; generated template still verified");
  const report = service.analyze(createSeed(), service.template(), "模板.xls", actor).report;
  assert.equal(report.total, 0); assert.equal(report.errors[0].row, 2);
});

test("preview is read-only and reports original Excel row numbers and preserved barcode", () => {
  const state = createSeed(), before = JSON.stringify(state);
  const report = preview(state, [row()]);
  assert.equal(report.valid, true); assert.equal(report.total, 1); assert.equal(report.rows[0].row, 3);
  assert.equal(report.rows[0].barcode, "0001234567890"); assert.ok(report.previewId);
  assert.equal(JSON.stringify(state), before);
});

test("all missing required cells are reported together and invalid workbook cannot be committed", async () => {
  const state = createSeed(), before = JSON.stringify(state);
  const report = preview(state, [row({ name: "", category: "", costPrice: "", salePrice: "" }), row({ barcode: "other", stock: -1, memberPrice: "a".repeat(121), productionDate: "2026-02-30" })]);
  assert.equal(report.valid, false); assert.equal(report.previewId, undefined);
  for (const field of ["名称（必填）", "分类（必填）", "进货价（必填）", "销售价（必填）"]) assert.ok(report.errors.some(e => e.row === 3 && e.field === field), field);
  for (const field of ["库存量", "会员价", "生产日期"]) assert.ok(report.errors.some(e => e.row === 4 && e.field === field), field);
  await assert.rejects(commit(state, report), /预览/); assert.equal(JSON.stringify(state), before);
});

test("missing, duplicate and unknown headers report actionable column errors", () => {
  for (const headers of [service.HEADERS.map((h, i) => i === 0 ? "未知列" : h), service.HEADERS.map((h, i) => i === 2 ? service.HEADERS[0] : h)]) {
    const report = analyze([row()], { headers });
    assert.equal(report.valid, false); assert.ok(report.errors.every(e => e.row === 1));
  }
  const headers = service.HEADERS.filter((_, i) => i !== 6);
  assert.ok(analyze([], { headers }).errors.some(e => e.field === "进货价（必填）"));
  const unnamed = analyze([row()], { headers: service.HEADERS.map((h, i) => i === 2 ? "" : h) });
  assert.equal(unnamed.valid, false); assert.ok(unnamed.errors.some(e => /没有字段名称/.test(e.message)));
});

test("optional omissions warn, remain drafts, and never silently copy sale price to member price", async () => {
  const state = createSeed(), item = row({ barcode: "", stock: "", memberPrice: "", memberDiscount: "", shelfLife: 30 });
  const report = preview(state, [item]);
  assert.equal(report.valid, true); assert.ok(report.warnings.length >= 4);
  await assert.rejects(commit(state, report, undefined, { acknowledgeWarnings: false }), /核对/);
  const result = await commit(state, report);
  const product = state.products.find(p => p.id === result.batch.productIds[0]);
  assert.equal(product.cashPrice, 0); assert.equal(product.regularPrice, 10); assert.equal(product.stock, 0); assert.equal(product.status, "off");
  assert.equal(state.config.productImports.metadata[product.id].shelfLife, "30天");
  assert.equal(admin.updateProduct(state, product.id, { status: "on", reason: "尝试上架" }, actor).ok, false);
});

test("invalid optional fields, fractions, excess precision, limits and discount conflicts all block imports", () => {
  const cases = [
    ["stock", 1.5], ["costPrice", -1], ["salePrice", "a".repeat(121)], ["memberPrice", "a".repeat(121)], ["wholesalePrice", 100000001],
    ["memberDiscount", "是"], ["memberDiscount", "85"], ["stockMax", -1], ["stockMin", 101], ["productionDate", "1900-02-29"],
    ["shelfLife", "随便"], ["name", "a".repeat(121)], ["category", "纯积分"], ["supplier", "<script>"]
  ];
  for (const [key, value] of cases) assert.equal(analyze([row({ [key]: value })]).valid, false, `${key}=${value}`);
});

test("repeated and existing barcodes are blocking on all affected rows, including POS barcodes", () => {
  const duplicate = analyze([row(), row()]);
  assert.equal(duplicate.valid, false); assert.equal(duplicate.validRows, 0);
  assert.ok(duplicate.errors.some(e => e.row === 3)); assert.ok(duplicate.errors.some(e => e.row === 4));
  const state = createSeed(); state.products[0].pospalBarcode = row().barcode;
  assert.match(analyze([row()], undefined, state).errors[0].message, /已存在/);
});

test("numeric barcode formatting is preserved with a warning; unsafe numeric barcodes are rejected", () => {
  const report = analyze([row({ barcode: 123 })], { sheetEdit: sheet => { sheet.C3.z = "000000"; } });
  assert.equal(report.valid, true); assert.equal(report.rows[0].barcode, "000123");
  assert.ok(report.warnings.some(e => e.field === "条码"));
  assert.equal(analyze([row({ barcode: 1234567890123456 })]).valid, false);
});

test("Excel errors, formulas, impossible dates, multiple sheets and oversized workbooks are rejected", () => {
  // BIFF8 writer requires compiled formula tokens: 5, 5, addition.
  const formula = analyze([row()], { sheetEdit: sheet => { sheet.H3 = { t: "n", v: 10, f: "5+5", bf: Buffer.from([7, 0, 0x1e, 5, 0, 0x1e, 5, 0, 0x03]) }; } });
  assert.ok(formula.errors.some(e => /公式/.test(e.message)));
  const error = analyze([row()], { sheetEdit: sheet => { sheet.F3 = { t: "e", v: 7 }; } });
  assert.equal(error.valid, false);
  assert.equal(analyze([row()], { extraSheet: true }).valid, false);
  assert.throws(() => service.analyze(createSeed(), Buffer.alloc(service.MAX_BYTES + 1), "a.xls", actor), /2 MB/);
  assert.throws(() => service.analyze(createSeed(), Buffer.from("csv content"), "a.xls", actor), /不是有效/);
  assert.throws(() => service.analyze(createSeed(), workbook([row()]), "a.xlsx", actor), /仅支持/);
  assert.equal(analyze(Array.from({ length: 1001 }, (_, i) => row({ barcode: String(i) })), { note: false }).valid, false);
});

test("Excel serial dates and regular date text normalize without host timezone shifts", () => {
  const result = service.analyze(createSeed(), workbook([row({ productionDate: 46345 })]), "a.xls", actor);
  assert.equal(result.report.valid, true);
  assert.match(result.products[0].metadata.productionDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(service.analyze(createSeed(), workbook([row({ productionDate: "2026/11/9" })]), "a.xls", actor).products[0].metadata.productionDate, "2026-11-09");
});

test("successful batch persists all products, metadata and initial stock once; retries are idempotent", async () => {
  const state = createSeed(), before = state.products.length;
  const report = preview(state, [row(), row({ barcode: "0002", name: "导入梨" })]);
  let saves = 0;
  const result = await commit(state, report, async () => { saves++; });
  assert.equal(result.ok, true); assert.equal(result.batch.count, 2); assert.equal(saves, 1);
  assert.equal(state.products.length, before + 2);
  const product = state.products.find(p => p.id === result.batch.productIds[0]);
  assert.equal(product.cashPrice, 8); assert.equal(product.regularPrice, 10); assert.equal(product.supportsPoints, false); assert.equal(product.status, "off");
  assert.equal(product.costPrice, undefined); assert.equal(product.importDetails, undefined);
  const metadata = state.config.productImports.metadata[product.id];
  assert.equal(metadata.costPrice, 3.5); assert.equal(metadata.supplier, "水果供货商"); assert.equal(metadata.sourceRow, 3);
  assert.equal(state.inventoryLedger.filter(e => e.batchNo === report.previewId).length, 2);
  assert.equal(state.adminOperationLogs.filter(e => e.action === "product.import").length, 1);
  assert.equal((await commit(state, report)).idempotent, true);
  assert.equal(state.products.length, before + 2);
  assert.equal(activeConfig(state.config).productImports, undefined);
});

test("permissions, actor ownership and changed stock rights are checked again on commit", async () => {
  const state = createSeed();
  assert.throws(() => preview(state, [row()], { role: { permissions: [] } }), /权限/);
  const staff = { adminId: actor.adminId, role: { permissions: ["product:write"] } };
  assert.equal(preview(state, [row()], staff).valid, false);
  const report = preview(state, [row()]);
  await assert.rejects(commit(state, report, undefined, {}, { ...actor, adminId: "other" }), /账号/);
  const result = await commit(state, report, undefined, {}, staff);
  assert.equal(result.ok, false); assert.ok(result.report.errors.some(e => /权限/.test(e.message)));
});

test("a conflicting product or deleted category created after preview prevents the entire batch", async () => {
  for (const mode of ["barcode", "category"]) {
    const state = createSeed(); const report = preview(state, [row(), row({ barcode: "other", name: "另一商品" })]);
    if (mode === "barcode") state.products[0].barcode = row().barcode;
    else state.config.deletedProductCategories = ["水果"];
    const before = JSON.stringify(state), result = await commit(state, report);
    assert.equal(result.ok, false); assert.equal(JSON.stringify(state), before);
  }
});

test("concurrent commit cannot import twice, and persistence failure rolls back only this batch", async () => {
  const state = createSeed(), before = state.products.length;
  const report = preview(state, [row()]);
  let release; const pendingSave = new Promise(resolve => { release = resolve; });
  const first = commit(state, report, () => pendingSave);
  assert.equal((await commit(state, report)).status, 409);
  release(); assert.equal((await first).ok, true); assert.equal(state.products.length, before + 1);
  const again = preview(state, [row({ barcode: "second" })]);
  await assert.rejects(commit(state, again, async () => { state.products[0].tag = "unrelated-edit"; throw new Error("disk"); }), /保存失败/);
  assert.equal(state.products.length, before + 1); assert.equal(state.products[0].tag, "unrelated-edit");
  assert.equal(state.config.productImports.batches[again.previewId], undefined);
  assert.equal((await commit(state, again)).ok, true);
});

test("import metadata, draft contents and receipt survive SQLite reload; replay remains idempotent", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-import-"));
  const db = path.join(dir, "state.sqlite"), state = createSeed(), report = preview(state, [row()]);
  const result = await commit(state, report, async () => saveSQLiteState(state, db));
  const restored = loadSQLiteState(db), id = result.batch.productIds[0];
  assert.equal(restored.products.find(p => p.id === id).barcode, row().barcode);
  assert.equal(restored.config.productImports.metadata[id].supplier, row().supplier);
  assert.equal((await commit(restored, report)).idempotent, true);
});

test("name and category upsert preserves identity, image and settings, clears optional template data, and records stock delta once", async () => {
  const state = createSeed();
  const existing = state.products[0];
  Object.assign(existing, { name: row().name, category: row().category, barcode: row().barcode, image: "/assets/apple.png", stock: 15, status: "on", locationCode: "A-1" });
  const before = structuredClone(existing), count = state.products.length;
  const report = preview(state, [row({ stock: 4, wholesalePrice: "", brand: "" }), row({ name: "新增商品", barcode: "new" })]);
  assert.equal(report.valid, true); assert.equal(report.updateCount, 1); assert.equal(report.createCount, 1);
  const result = await commit(state, report);
  assert.equal(state.products.length, count + 1);
  assert.equal(result.batch.productIds[0], existing.id); assert.equal(result.batch.updatedCount, 1);
  assert.equal(existing.image, before.image); assert.equal(existing.locationCode, "A-1");
  assert.equal(existing.supportsPoints, before.supportsPoints); assert.equal(existing.status, "off");
  assert.equal(existing.stock, 4); assert.equal(existing.revision, (before.revision || 0) + 1);
  const entry = state.inventoryLedger.find(e => e.batchNo === report.previewId && e.productId === existing.id);
  assert.equal(entry.changeType, "stocktake"); assert.equal(entry.quantityDelta, -11);
  assert.equal(state.config.productImports.metadata[existing.id].wholesalePrice, null);
  assert.equal(state.config.productImports.metadata[existing.id].brand, "");
  assert.equal((await commit(state, report)).idempotent, true);
  assert.equal(state.inventoryLedger.filter(e => e.batchNo === report.previewId).length, 2);
});

test("display prices accept Chinese, English and symbols and export as literal text, without deriving a payment amount", async () => {
  const state = createSeed(), sale = "参考 <优惠> ¥12/kg ABC", member = "会员专享 ¥8/盒 & VIP";
  const report = preview(state, [row({ salePrice: sale, memberPrice: member, wholesalePrice: "" })]);
  assert.equal(report.valid, true); assert.ok(report.warnings.some(e => /不从文字推算/.test(e.message)));
  const result = await commit(state, report), product = state.products.find(p => p.id === result.batch.productIds[0]);
  assert.equal(product.regularPrice, sale); assert.equal(product.cashPriceText, member); assert.equal(product.cashPrice, 0);
  assert.equal(require("../../src/services/product-admin-service").prepareProduct({ status: "on", image: "/assets/apple.png" }, product).ok, false);
  const book = XLSX.read(require("../../src/services/product-export-service").exportProducts(state), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
  const exported = rows.find(r => r[0] === row().name); assert.equal(exported[7], sale); assert.equal(exported[9], member);
});

test("upsert refuses ambiguous identities, duplicate pairs, pure points targets and unauthorized stock decreases", () => {
  const state = createSeed(), existing = state.products[0];
  Object.assign(existing, { name: row().name, category: row().category, barcode: row().barcode, stock: 15 });
  const staff = { ...actor, role: { permissions: ["product:write"] } };
  assert.equal(preview(state, [row({ stock: 0 })], staff).valid, false);
  assert.equal(preview(state, [row({ stock: 15 })], staff).valid, true);
  const duplicate = preview(state, [row(), row({ barcode: "different" })]);
  assert.equal(duplicate.valid, false); assert.ok(duplicate.errors.some(e => /名称和分类相同/.test(e.message)));
  existing.purePointsOnly = true;
  assert.equal(preview(state, [row()]).valid, false);
  existing.purePointsOnly = false;
  state.products.push({ ...existing, id: "ambiguous" });
  assert.ok(preview(state, [row()]).errors.some(e => /多个同名同分类/.test(e.message)));
});

test("upsert revalidates target snapshots and restores existing data and metadata on persistence failure", async () => {
  const state = createSeed(), existing = state.products[0];
  Object.assign(existing, { name: row().name, category: row().category, barcode: row().barcode });
  const stale = preview(state, [row()]); existing.stock++;
  const afterChange = JSON.stringify(state);
  await assert.rejects(commit(state, stale), /已变化/); assert.equal(JSON.stringify(state), afterChange);
  state.config.productImports = { metadata: { [existing.id]: { brand: "原品牌" } }, batches: {} };
  const report = preview(state, [row(), row({ name: "新增", barcode: "new" })]), before = JSON.stringify(state);
  await assert.rejects(commit(state, report, async () => { throw new Error("disk"); }), /保存失败/);
  assert.equal(JSON.stringify(state), before);
  await assert.rejects(commit(state, report, async () => { existing.tag = "并发修改"; existing.stock += 2; throw new Error("disk"); }), /保存失败/);
  assert.equal(existing.tag, "并发修改");
  assert.equal(existing.stock, JSON.parse(before).products[0].stock + 2);
  const retry = preview(state, [row()]);
  assert.equal((await commit(state, retry)).ok, true);
});

function authorized(state, role, method, buffer) {
  const req = Readable.from(buffer ? [buffer] : []); req.method = method; req.headers = {};
  if (role) {
    const token = issueToken({ type: "admin", roleId: role });
    const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url"));
    state.authSessions.push({ subjectType: "admin", subjectId: role, tokenId: payload.tokenId, expiresAt: new Date(payload.exp * 1000).toISOString() });
    req.headers.authorization = `Bearer ${token}`;
  }
  return req;
}
async function request(state, role, method, endpoint, buffer, input = {}) {
  let response;
  await handleProductImportRoutes({ state, req: authorized(state, role, method, buffer), url: new URL(endpoint, "http://localhost"),
    readBody: async () => input, send: (_, status, body, headers) => { response = { status, body, headers }; } });
  return response;
}
test("HTTP routes protect template/upload/commit, return row feedback and keep purchase data admin-only", async () => {
  const state = createSeed();
  for (const route of ["template", "preview", "commit"]) {
    assert.equal((await request(state, null, route === "template" ? "GET" : "POST", `/api/admin/product-import/${route}`)).status, 401);
    assert.equal((await request(state, "customer_service", "POST", `/api/admin/product-import/${route}`)).status, 403);
  }
  const template = await request(state, "super_admin", "GET", "/api/admin/product-import/template");
  assert.equal(template.status, 200); assert.ok(Buffer.isBuffer(template.body)); assert.equal(template.headers["Content-Type"], "application/vnd.ms-excel");
  const bad = await request(state, "super_admin", "POST", "/api/admin/product-import/preview?filename=bad.xls", workbook([row({ name: "" })]));
  assert.equal(bad.status, 200); assert.equal(bad.body.valid, false); assert.equal(bad.body.errors[0].row, 3);
  const good = await request(state, "super_admin", "POST", "/api/admin/product-import/preview?filename=good.xls", workbook([row()]));
  const saved = await request(state, "super_admin", "POST", "/api/admin/product-import/commit", null, { previewId: good.body.previewId, reason: "测试", acknowledgeWarnings: true });
  assert.equal(saved.status, 200); assert.equal(saved.body.ok, true);
  let response;
  await handleAdminRoutes({ state, req: authorized(state, "super_admin", "GET"), url: new URL("http://localhost/api/admin/products"), send: (_, status, body) => { response = body; } });
  assert.equal(response.find(p => p.id === saved.body.batch.productIds[0]).importDetails.costPrice, 3.5);
  assert.equal(state.products.find(p => p.id === saved.body.batch.productIds[0]).importDetails, undefined);
});
