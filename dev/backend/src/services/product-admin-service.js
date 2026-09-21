const { nextId, saveState } = require("../data/store");
const inventory = require("../repositories/inventory-repository");

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const fail = (status, error) => ({ ok: false, status, error });
const allowed = (actor, permission) => (actor.role?.permissions || []).some(value => value === "*" || value === permission);
const editable = ["name", "category", "tag", "image", "description", "unit", "cashPrice", "pointsPrice", "supportsCash", "supportsPoints"];

function imageUrlValid(value) {
  if (!value || /[<>"'\\\s]/.test(value)) return false;
  if (/^\/(assets|uploads)\/[\w.%/-]+$/.test(value)) return !value.includes("..");
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}

function prepareProduct(input, previous = {}) {
  const product = { name: "", category: "", tag: "", image: "", unit: "", description: "", cashPrice: 0, pointsPrice: 0, stock: 0, status: "off", supportsCash: true, supportsPoints: true, purePointsOnly: false, ...previous };
  for (const [key, limit] of Object.entries({ name: 120, category: 40, tag: 80, image: 2000, description: 5000, unit: 40 })) {
    if (!own(input, key)) continue;
    if (typeof input[key] !== "string" || input[key].trim().length > limit) return fail(400, `${key} 字段格式或长度不正确`);
    product[key] = input[key].trim();
    if (key !== "description" && /[<>]/.test(product[key])) return fail(400, "商品资料不支持 HTML 标签");
  }
  for (const key of ["supportsCash", "supportsPoints", "purePointsOnly"]) {
    if (!own(input, key)) continue;
    if (typeof input[key] !== "boolean") return fail(400, "销售方式必须为有效选项");
    product[key] = input[key];
  }
  if (previous.id && product.purePointsOnly !== previous.purePointsOnly) return fail(400, "已建商品不能切换销售类型，请新建商品");
  if (own(input, "status")) {
    if (!["on", "off"].includes(input.status)) return fail(400, "上下架状态无效");
    product.status = input.status;
  }
  for (const key of ["stock", "pointsPrice", "cashPrice"]) {
    if (!own(input, key)) continue;
    if (key === "cashPrice" && product.purePointsOnly) continue;
    const value = input[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100000000
      || (key !== "cashPrice" && !Number.isSafeInteger(value)) || (key === "cashPrice" && Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)) {
      return fail(400, key === "cashPrice" ? "现金价格须为非负金额，最多两位小数" : "库存和积分价须为非负整数");
    }
    product[key] = value;
  }
  if (!product.name) return fail(400, "请填写商品名称");
  if (product.image && !imageUrlValid(product.image)) return fail(400, "请使用有效商品图片地址或上传图片");
  if (product.purePointsOnly) Object.assign(product, { cashPrice: null, supportsCash: false, supportsPoints: true });
  if (product.status === "on") {
    const missing = [];
    if (!product.category) missing.push("商品分类");
    if (!product.image) missing.push("商品主图");
    if (product.stock <= 0) missing.push("可售库存（大于 0）");
    if (!product.purePointsOnly && (!product.supportsCash || !(product.cashPrice > 0))) missing.push("现金售价（大于 0）");
    if (product.supportsPoints && !(product.pointsPrice > 0)) missing.push("积分价（大于 0）");
    if (missing.length) return fail(400, `暂不能上架，请完善：${missing.join("、")}`);
  }
  return { ok: true, product };
}

function createProduct(state, input, actor, logOperation) {
  if (!allowed(actor, "product:write")) return fail(403, "缺少商品管理权限");
  const result = prepareProduct(input);
  if (!result.ok) return result;
  const product = result.product;
  if (product.purePointsOnly && !allowed(actor, "points_product:write")) return fail(403, "缺少纯积分商品管理权限");
  if (product.stock > 0 && !allowed(actor, "stock:write")) return fail(403, "缺少库存管理权限");
  if (!String(input.reason || "").trim()) return fail(400, "请填写操作原因");
  Object.assign(product, { id: nextId("p"), revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  if (product.status === "on") product.publishedAt = product.updatedAt;
  state.products.unshift(product);
  inventory.addEntry(state, { product, changeType: "initial_stock", quantityDelta: product.stock, stockBefore: 0, stockAfter: product.stock, batchNo: input.batchNo, reason: input.reason, actor });
  logOperation(state, actor, "product.create", "product", product.id, { after: structuredClone(product), reason: input.reason });
  saveState();
  return { ok: true, product };
}

function updateProduct(state, productId, input, actor, logOperation) {
  const product = state.products.find(item => item.id === productId);
  if (!product) return fail(404, "商品不存在");
  const changes = [...editable, "status", "purePointsOnly"].filter(key => own(input, key));
  const stockChange = own(input, "stock");
  if (!changes.length && !stockChange) return fail(400, "没有可保存的商品变更");
  if (changes.length && !allowed(actor, "product:write")) return fail(403, "缺少商品管理权限");
  if (product.purePointsOnly && changes.length && !allowed(actor, "points_product:write")) return fail(403, "缺少纯积分商品管理权限");
  if (stockChange && !allowed(actor, "stock:write")) return fail(403, "缺少库存管理权限");
  if (!String(input.reason || "").trim()) return fail(400, "请填写操作原因");
  if (own(input, "expectedRevision") && input.expectedRevision !== (product.revision || 0)) return fail(409, "商品资料已更新，请刷新后重新编辑");
  if (stockChange && input.expectedStock !== product.stock) return fail(409, "库存已变化，请刷新后重新核对库存");
  if (product.status === "on" && editable.some(key => own(input, key) && input[key] !== product[key])) return fail(409, "请先下架商品，再修改商品资料或售价");
  // Sold-out goods may stay listed; stock changes must not fail publication validation.
  const validationInput = stockChange && !changes.length ? { ...input, status: "off" } : input;
  const result = prepareProduct(validationInput, product);
  if (!result.ok) return result;
  const next = result.product;
  if (stockChange && !changes.length) next.status = product.status;
  const before = structuredClone(product);
  next.revision = (product.revision || 0) + 1;
  next.updatedAt = new Date().toISOString();
  if (next.status === "on" && product.status !== "on") next.publishedAt = next.updatedAt;
  Object.assign(product, next);
  if (product.stock !== before.stock) inventory.addEntry(state, { product, changeType: inventory.inferAdminChangeType(before.stock, product.stock, input.inventoryChangeType), quantityDelta: product.stock - before.stock, stockBefore: before.stock, stockAfter: product.stock, batchNo: input.batchNo, reason: input.reason, actor });
  logOperation(state, actor, input.status && input.status !== before.status ? `product.${input.status === "on" ? "publish" : "unpublish"}` : "product.update", "product", product.id, { before, after: structuredClone(product), reason: input.reason });
  saveState();
  return { ok: true, product };
}

module.exports = { createProduct, updateProduct, imageUrlValid };
