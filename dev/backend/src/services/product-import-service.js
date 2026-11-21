const crypto = require("node:crypto");
const XLSX = require("xlsx");
const { nextId, saveState } = require("../data/store");
const { prepareProduct } = require("./product-admin-service");
const inventory = require("../repositories/inventory-repository");
const { exclusive, isBusy } = require("./operation-lock");

const HEADERS = ["名称（必填）", "分类（必填）", "条码", "规格", "主单位", "库存量", "进货价（必填）", "销售价（必填）", "批发价", "会员价", "会员折扣", "库存上限", "库存下限", "品牌", "供货商", "生产日期", "保质期"];
const KEYS = ["name", "category", "barcode", "specification", "mainUnit", "stock", "costPrice", "salePrice", "wholesalePrice", "memberPrice", "memberDiscount", "stockMax", "stockMin", "brand", "supplier", "productionDate", "shelfLife"];
const REQUIRED = new Set(["name", "category", "costPrice", "salePrice"]);
const MAX_BYTES = 2 * 1024 * 1024, MAX_ROWS = 1000;
const NOTE = "如需会员价，会员折扣填“否”";
const previews = new WeakMap();
const normalizeHeader = value => String(value || "").trim().replace(/\s/g, "").replace(/[（(]必填[）)]/g, "");
const owner = actor => actor.adminId || actor.id || actor.role?.id;
const allowed = (actor, permission) => actor.role?.permissions?.some(p => p === "*" || p === permission);
const problem = (status, message) => Object.assign(new Error(message), { status });

function template() {
  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, Array(9).fill("").concat(NOTE)]);
  sheet["!cols"] = HEADERS.map(() => ({ wch: 22 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "商品导入");
  return XLSX.write(book, { type: "buffer", bookType: "biff8" });
}

function analyze(state, buffer, filename, actor) {
  if (!allowed(actor, "product:write")) throw problem(403, "缺少商品管理权限");
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw problem(400, "请选择商品导入模板 .xls 文件");
  if (buffer.length > MAX_BYTES) throw problem(413, "导入文件不能超过 2 MB");
  if (typeof filename !== "string" || filename.length > 200 || !/\.xls$/i.test(filename)) throw problem(400, "仅支持 Excel 97–2003 格式的 .xls 文件，请另存为 .xls 后上传");
  if (!buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) throw problem(400, "文件内容不是有效的 .xls 工作簿，请勿只修改扩展名");
  let book;
  try { book = XLSX.read(buffer, { type: "buffer", cellFormula: true, cellNF: true, sheetRows: MAX_ROWS + 3 }); }
  catch { throw problem(400, "无法读取工作簿，文件可能已损坏、加密或格式不受支持"); }
  const report = { filename, valid: false, total: 0, validRows: 0, errors: [], warnings: [], rows: [] };
  const issue = (row, field, message, warning = false) => (warning ? report.warnings : report.errors).push({ row, field, message });
  const sheets = book.SheetNames.map(name => book.Sheets[name]).filter(sheet => sheet["!ref"]);
  if (sheets.length !== 1) { issue(1, "工作表", "请保留一个有内容的商品工作表，避免遗漏其他工作表的数据"); return { report, products: [] }; }
  const sheet = sheets[0];
  const range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"]);
  if (range.e.r >= MAX_ROWS + 2 || range.e.c > 63) {
    issue(1, "文件范围", "最多导入 1000 行商品、64 列；请删除超出的行列或拆分文件"); return { report, products: [] };
  }
  const cell = (r, c) => sheet[XLSX.utils.encode_cell({ r, c })];
  const text = value => value == null ? "" : String(value).trim();
  const columns = new Map();
  for (let c = 0; c <= range.e.c; c++) {
    const header = cell(0, c);
    if (header?.f) { issue(1, "表头", "表头不能使用公式"); continue; }
    const label = normalizeHeader(header?.v);
    if (!label) {
      if (Array.from({ length: range.e.r }, (_, i) => cell(i + 1, c)).some(value => text(value?.v) || value?.f)) {
        issue(1, `第 ${c + 1} 列表头`, "该列有数据但没有字段名称，请补齐模板表头或删除该列");
      }
      continue;
    }
    const index = HEADERS.findIndex(h => normalizeHeader(h) === label);
    if (index < 0) { issue(1, label.slice(0, 80), "不是模板字段，请删除该列或改成模板中的字段名称"); continue; }
    const key = KEYS[index];
    if (columns.has(key)) issue(1, HEADERS[index], "表头重复，请只保留一列");
    else columns.set(key, c);
  }
  for (const key of REQUIRED) if (!columns.has(key)) issue(1, HEADERS[KEYS.indexOf(key)], "缺少必填列，请恢复模板表头");
  for (const key of KEYS) if (!REQUIRED.has(key) && !columns.has(key)) issue(1, HEADERS[KEYS.indexOf(key)], "缺少可选列，将按空值处理", true);
  if (report.errors.length) return { report, products: [] };
  const products = [], barcodes = new Map(), identities = new Map();
  for (let r = 1; r <= range.e.r; r++) {
    const cells = [...columns].map(([key, col]) => [key, cell(r, col)]);
    if (cells.every(([, c]) => !text(c?.v) && !c?.f)) continue;
    if (r === 1 && cells.every(([key, c]) => !text(c?.v) || (key === "memberPrice" && c?.v === NOTE)) && !cells.some(([, c]) => c?.f)) continue;
    const row = r + 1, startErrors = report.errors.length;
    const values = Object.fromEntries(cells.map(([key, c]) => [key, text(c?.v)]));
    const source = Object.fromEntries(cells);
    const label = key => HEADERS[KEYS.indexOf(key)];
    const error = (key, message) => issue(row, label(key), message);
    const warn = (key, message) => issue(row, label(key), message, true);
    const matches = state.products.filter(p => !p.deletedAt && p.name?.trim() === values.name && p.category?.trim() === values.category);
    const previous = matches.length === 1 ? matches[0] : null;
    if (matches.length > 1) error("name", "后台有多个同名同分类商品，无法确定覆盖对象，请先合并或更名");
    const identity = JSON.stringify([values.name, values.category]);
    if (identities.has(identity)) error("name", `与第 ${identities.get(identity)} 行名称和分类相同，请只保留一行`);
    else identities.set(identity, row);
    if (previous?.purePointsOnly) error("category", "不能用现金商品模板覆盖纯积分商品");
    if (previous && isBusy(previous)) error("name", "商品正在处理中，请稍后重新预览");
    if (previous) warn("name", "名称和分类已存在，将覆盖模板字段并保存为下架草稿；原商品编号、图片及非模板配置保留");
    for (const [key, c] of cells) {
      if (c?.f) error(key, "不能使用公式，请复制并粘贴为数值或文本");
      if (c?.t === "e") error(key, "单元格包含 Excel 错误值，请修正");
      if (c?.t === "b") error(key, "不支持布尔单元格，请按模板填写文本或数字");
    }
    for (const key of REQUIRED) if (!values[key]) error(key, "必填项不能为空");
    for (const [key, limit] of Object.entries({ name: 120, category: 40, barcode: 80, specification: 40, mainUnit: 40, brand: 80, supplier: 120, shelfLife: 40 })) {
      if ((values[key] || "").length > limit) error(key, `不能超过 ${limit} 个字符`);
      if (/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(values[key] || "")) error(key, "不能含 HTML 标签或控制字符");
    }
    function number(key, integer = false) {
      const raw = values[key];
      if (!raw) return null;
      if (!(integer ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/).test(raw) || !Number.isFinite(Number(raw)) || Number(raw) > 100000000 || (integer && !Number.isSafeInteger(Number(raw)))) {
        error(key, integer ? "请填写 0～100000000 的非负整数" : "请填写 0～100000000 的非负金额，最多两位小数"); return null;
      }
      return Number(raw);
    }
    function displayPrice(key) {
      const raw = values[key] || "";
      if (!raw) return null;
      if (raw.length > 120 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(raw)) error(key, "价格文本最多 120 个字符，不能包含控制字符");
      return /^\d+(?:\.\d{1,2})?$/.test(raw) && Number(raw) <= 100000000 ? Number(raw) : raw;
    }
    const costPrice = number("costPrice"), salePrice = displayPrice("salePrice"), wholesalePrice = number("wholesalePrice"), memberPrice = displayPrice("memberPrice");
    const stock = number("stock", true), stockMax = number("stockMax", true), stockMin = number("stockMin", true);
    if (stockMax != null && stockMin != null && stockMin > stockMax) error("stockMin", "库存下限不能大于库存上限");
    if (!values.stock) warn("stock", "未填写库存，将以 0 导入，补齐库存后才能上架");
    if (!values.memberPrice) warn("memberPrice", "未填写会员价，实际结算价将留为 0，需补齐后才能上架（不会自动套用销售价）");
    if (memberPrice === 0) warn("memberPrice", "会员价为 0，需设置大于 0 的会员价后才能上架");
    if (typeof memberPrice === "string") warn("memberPrice", "会员价按展示文字保存，不从文字推算收款金额；须补齐数字结算价后才能上架");
    if (salePrice === 0) warn("salePrice", "销售价为 0，需补齐零售价后才能上架");
    if (values.memberDiscount && !["是", "否"].includes(values.memberDiscount)) error("memberDiscount", "请填写“是”或“否”，不接受数字折扣");
    if (values.memberPrice && values.memberDiscount !== "否") error("memberDiscount", "已填写会员价时，会员折扣必须填写“否”");
    if (values.memberDiscount === "是") warn("memberDiscount", "商城不自动计算银豹会员折扣；需手动设置实际会员结算价后上架");
    let barcode = values.barcode || "";
    if (source.barcode?.t === "n") {
      if (!Number.isSafeInteger(source.barcode.v) || source.barcode.v < 0 || String(source.barcode.v).length > 15) error("barcode", "数字条码可能丢失精度，请将该列设为文本并重新填写原条码");
      else {
        barcode = text(source.barcode.w || source.barcode.v);
        if (!/^\d+$/.test(barcode)) error("barcode", "条码不能使用科学计数法或小数格式，请改为文本");
        else warn("barcode", "条码原为数字，已按显示值读取；请核对前导零，建议使用文本格式");
      }
    }
    if (barcode) {
      if (state.products.some(p => !p.deletedAt && p.id !== previous?.id && [p.barcode, p.pospalBarcode].filter(Boolean).map(String).includes(barcode))) error("barcode", "该条码已存在于其他商品，请核对名称、分类或条码");
      if (barcodes.has(barcode)) {
        error("barcode", `与第 ${barcodes.get(barcode)} 行条码重复，请修改或删除重复行`);
        issue(barcodes.get(barcode), label("barcode"), `与第 ${row} 行条码重复，请修改或删除重复行`);
      } else barcodes.set(barcode, row);
    } else warn("barcode", "条码为空，无法按条码识别重复商品，请核对是否已导入");
    let productionDate = values.productionDate || "";
    if (productionDate) {
      if (source.productionDate?.t === "n") {
        const date = XLSX.SSF.parse_date_code(source.productionDate.v, { date1904: Boolean(book.Workbook?.WBProps?.date1904) });
        productionDate = date ? `${String(date.y).padStart(4, "0")}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}` : "invalid";
      }
      const match = productionDate.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
      const date = match && new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      if (!match || date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() + 1 !== Number(match[2]) || date.getUTCDate() !== Number(match[3])) error("productionDate", "请填写有效日期，例如 2026-11-19");
      else productionDate = date.toISOString().slice(0, 10);
    }
    let shelfLife = values.shelfLife || "";
    if (/^\d+$/.test(shelfLife)) { shelfLife += "天"; warn("shelfLife", "纯数字保质期按天保存，请确认单位"); }
    if (shelfLife && !/^(?:[1-9]\d{0,5}(?:天|日|个月|月|年)|长期|永久)$/.test(shelfLife)) error("shelfLife", "请填写带单位的正整数，如 30天、12个月，或填写“长期”");
    const unit = [values.specification, values.mainUnit].filter(Boolean).join(" / ");
    if (unit.length > 40) error("specification", "规格与主单位合并后不能超过 40 个字符");
    if (values.category === "纯积分") error("category", "此模板没有积分价，不能导入纯积分商品；请使用后台纯积分商品编辑功能");
    if ((state.config?.deletedProductCategories || []).includes(values.category)) error("category", "该分类已删除，请选择其他分类");
    if (values.category === "买商品送会员") warn("category", "专区商品按现有规则每件默认赠送 30 天会员，请在上架前核对");
    if ((stock || 0) !== (previous?.stock || 0) && !allowed(actor, "stock:write")) error("stock", "当前账号没有库存管理权限，不能导入或覆盖库存");
    const result = prepareProduct({ name: values.name || "", category: values.category || "", barcode, unit, stock: stock || 0,
      regularPrice: salePrice, cashPrice: typeof memberPrice === "number" ? memberPrice : 0,
      cashPriceText: typeof memberPrice === "string" ? memberPrice : "", supportsPoints: previous?.supportsPoints ?? false, status: "off" }, previous || {});
    if (!result.ok && report.errors.length === startErrors) error("name", result.error);
    const metadata = { specification: values.specification || "", mainUnit: values.mainUnit || "", costPrice, salePrice, wholesalePrice, memberPrice,
      memberDiscount: values.memberDiscount || "", stockMax, stockMin, brand: values.brand || "", supplier: values.supplier || "", productionDate, shelfLife };
    report.rows.push({ row, name: values.name || "", category: values.category || "", barcode, unit, stock: stock || 0, salePrice, memberPrice, action: previous ? "update" : "create" });
    products.push({ row, product: result.product, metadata, existingId: previous?.id || null });
  }
  report.total = report.rows.length;
  if (report.total > MAX_ROWS) issue(1, "商品行数", "最多导入 1000 行商品，请拆分文件");
  // Duplicate errors may also refer back to an earlier row.
  const invalidRows = new Set(report.errors.filter(e => e.row > 1).map(e => e.row));
  report.validRows = report.total - invalidRows.size;
  if (!report.total) issue(2, "商品数据", "文件中没有商品，请从表头下方填写商品；模板提示行不属于商品");
  report.valid = report.errors.length === 0 && report.total > 0;
  report.createCount = products.filter(p => !p.existingId).length;
  report.updateCount = products.length - report.createCount;
  report.guidance = "按名称和分类匹配，存在则覆盖模板字段，不存在则新增，全部保存为下架草稿。批发价可空，销售价和会员价支持文本；文字会员价须另设数字结算价，不自动推算金额。";
  return { report, products };
}

function previewImport(state, buffer, filename, actor, now = Date.now()) {
  const result = analyze(state, buffer, filename, actor);
  if (!result.report.valid) return result.report;
  let cache = previews.get(state);
  if (!cache) { cache = new Map(); previews.set(state, cache); }
  for (const [id, item] of cache) if (item.expiresAt <= now) cache.delete(id);
  if (cache.size >= 20) throw problem(429, "待确认导入过多，请稍后重试（预览有效期 30 分钟）");
  const previewId = crypto.randomUUID();
  const targets = result.products.map(item => ({ existingId: item.existingId,
    snapshot: item.existingId ? JSON.stringify(state.products.find(p => p.id === item.existingId)) : null }));
  cache.set(previewId, { buffer: Buffer.from(buffer), filename, actorId: owner(actor), targets, expiresAt: now + 30 * 60000 });
  return { ...result.report, previewId, expiresAt: new Date(now + 30 * 60000).toISOString() };
}

async function commitImport(state, input, actor, logOperation, save = saveState) {
  if (!allowed(actor, "product:write")) throw problem(403, "缺少商品管理权限");
  if (!input || typeof input.previewId !== "string" || !/^[0-9a-f-]{36}$/.test(input.previewId)) throw problem(400, "请先上传文件并完成预览校验");
  if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 200) throw problem(400, "请填写 1～200 字的导入原因");
  return exclusive(state, async () => {
    const previous = state.config?.productImports?.batches?.[input.previewId];
    if (previous) {
      if (previous.actorId !== owner(actor) || previous.reason !== input.reason.trim()) throw problem(409, "该导入标识已被其他账号或其他导入原因使用");
      return { ok: true, idempotent: true, batch: previous };
    }
    const cache = previews.get(state), pending = cache?.get(input.previewId);
    if (!pending || pending.actorId !== owner(actor)) throw problem(409, "导入预览不存在或账号已变更，请重新上传校验");
    if (pending.expiresAt <= Date.now()) { cache.delete(input.previewId); throw problem(409, "导入预览已过期，请重新上传校验"); }
    const { report, products } = analyze(state, pending.buffer, pending.filename, actor);
    if (!report.valid) return { ok: false, report, error: "商品或权限已变化，请按提示修改后重新上传；本批次未导入任何商品" };
    if (products.some((item, i) => item.existingId !== pending.targets[i]?.existingId
      || (item.existingId && JSON.stringify(state.products.find(p => p.id === item.existingId)) !== pending.targets[i].snapshot))) {
      throw problem(409, "覆盖对象、库存或商品资料已变化，请重新上传预览后确认");
    }
    if (report.warnings.length && input.acknowledgeWarnings !== true) throw problem(400, "请先核对并确认导入提醒");
    const now = new Date().toISOString(), ids = [], ledgerIds = [], createdIds = [], updates = [];
    const firstSort = Math.min(0, ...state.products.map(p => p.sortOrder || 0));
    state.config.productImports ||= { metadata: {}, batches: {} };
    const store = state.config.productImports;
    store.metadata ||= {}; store.batches ||= {};
    for (const [index, item] of products.entries()) {
      const previous = item.existingId ? state.products.find(p => p.id === item.existingId) : null;
      const product = previous || { ...item.product, id: nextId("p"), revision: 1, createdAt: now, updatedAt: now, sortOrder: firstSort - products.length + index };
      const stockBefore = previous?.stock || 0;
      if (previous) {
        updates.push({ product, before: structuredClone(previous), metadata: store.metadata[product.id] ? structuredClone(store.metadata[product.id]) : null });
        Object.assign(product, item.product, { revision: (previous.revision || 0) + 1, updatedAt: now });
        updates[updates.length - 1].after = structuredClone(product);
      } else { createdIds.push(product.id); state.products.push(product); }
      ids.push(product.id);
      store.metadata[product.id] = { ...item.metadata, importBatchId: input.previewId, sourceRow: item.row };
      if (!previous || stockBefore !== product.stock) ledgerIds.push(inventory.addEntry(state, { product, changeType: previous ? "stocktake" : "initial_stock", quantityDelta: product.stock - stockBefore, stockBefore,
        stockAfter: product.stock, batchNo: input.previewId, reason: input.reason.trim(), actor }).id);
    }
    const batch = { id: input.previewId, filename: pending.filename, actorId: owner(actor), reason: input.reason.trim(), count: ids.length, productIds: ids,
      createdCount: createdIds.length, updatedCount: updates.length,
      fileHash: crypto.createHash("sha256").update(pending.buffer).digest("hex"), createdAt: now };
    store.batches[input.previewId] = batch;
    logOperation(state, actor, "product.import", "product_import", batch.id, { reason: batch.reason, filename: batch.filename, count: batch.count, productIds: ids,
      createdCount: batch.createdCount, updatedCount: batch.updatedCount, updates: updates.map(entry => ({ before: entry.before, after: entry.after })) });
    try { await save(); }
    catch (error) {
      // Remove only this failed batch; preserve changes made by other requests.
      const imported = new Set(createdIds), entries = new Set(ledgerIds);
      state.products = state.products.filter(p => !imported.has(p.id));
      for (const entry of updates) {
        for (const key of Object.keys(entry.after)) {
          if (JSON.stringify(entry.after[key]) === JSON.stringify(entry.before[key])) continue;
          if (key === "stock") { entry.product.stock += entry.before.stock - entry.after.stock; continue; }
          if (JSON.stringify(entry.product[key]) !== JSON.stringify(entry.after[key])) continue;
          if (Object.hasOwn(entry.before, key)) entry.product[key] = entry.before[key];
          else delete entry.product[key];
        }
        if (entry.metadata) store.metadata[entry.product.id] = entry.metadata;
        else delete store.metadata[entry.product.id];
      }
      state.inventoryLedger = state.inventoryLedger.filter(entry => !entries.has(entry.id));
      state.adminOperationLogs = state.adminOperationLogs.filter(log => !(log.action === "product.import" && log.targetId === batch.id));
      for (const id of createdIds) delete store.metadata[id];
      delete store.batches[batch.id];
      throw problem(503, "导入保存失败，未确认导入成功；请使用当前预览重试或核对后台商品列表");
    }
    cache.delete(input.previewId);
    return { ok: true, batch };
  });
}

module.exports = { HEADERS, MAX_BYTES, MAX_ROWS, template, analyze, previewImport, commitImport };
