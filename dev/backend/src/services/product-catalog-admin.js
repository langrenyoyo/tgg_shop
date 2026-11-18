const { saveState } = require("../data/store");
const products = require("../repositories/product-repository");
const { GIFT_CATEGORY } = require("../domain/product-membership");
const DEFAULT_CATEGORIES = [GIFT_CATEGORY, "水果", "蔬菜", "肉禽", "乳品", "零食", "日用", "纯积分"];
const allowed = (actor, permission) => (actor.role?.permissions || []).some(value => value === "*" || value === permission);
const fail = (status, error) => ({ ok: false, status, error });

function listCategories(state) {
  const visible = products.listVisible(state);
  const deleted = state.config?.deletedProductCategories || [];
  return [...new Set([...DEFAULT_CATEGORIES, ...visible.map(item => item.category)])].filter(name => name && !deleted.includes(name)).map(name => ({
    name, productCount: visible.filter(item => item.category === name).length, protected: name === GIFT_CATEGORY
  }));
}

function checkProduct(state, id, input, actor) {
  if (!allowed(actor, "product:write")) return fail(403, "缺少商品管理权限");
  const product = state.products.find(item => item.id === id && !item.deletedAt);
  if (!product) return fail(404, "商品不存在或已删除");
  if (product.purePointsOnly && !allowed(actor, "points_product:write")) return fail(403, "缺少纯积分商品管理权限");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== (product.revision || 0)) return fail(409, "商品资料已更新，请刷新后重试");
  return { ok: true, product };
}

function deleteProduct(state, id, input, actor, logOperation) {
  const check = checkProduct(state, id, input, actor);
  if (!check.ok) return check;
  const product = check.product;
  const before = structuredClone(product);
  Object.assign(product, { deletedAt: new Date().toISOString(), status: "off", revision: (product.revision || 0) + 1 });
  product.updatedAt = product.deletedAt;
  logOperation(state, actor, "product.delete", "product", id, { before, after: structuredClone(product), reason: "后台确认删除商品" });
  saveState();
  return { ok: true, product };
}

function moveProduct(state, id, input, actor, logOperation) {
  const check = checkProduct(state, id, input, actor);
  if (!check.ok) return check;
  const ordered = products.listVisible(state);
  const before = ordered.map(item => item.id);
  if (!Array.isArray(input.expectedOrder) || JSON.stringify(input.expectedOrder) !== JSON.stringify(before)) return fail(409, "商品顺序或列表已变化，请刷新后重试");
  if (!Number.isSafeInteger(input.position) || input.position < 1 || input.position > ordered.length) return fail(400, "目标位置超出商品列表范围");
  ordered.splice(ordered.indexOf(check.product), 1);
  ordered.splice(input.position - 1, 0, check.product);
  ordered.forEach((item, index) => { item.sortOrder = index; });
  logOperation(state, actor, "product.reorder", "product", id, { before, after: ordered.map(item => item.id), position: input.position, reason: "后台调整商品展示顺序" });
  saveState();
  return { ok: true, products: ordered };
}

function deleteCategory(state, name, actor, logOperation) {
  if (!allowed(actor, "product:write")) return fail(403, "缺少商品管理权限");
  const category = listCategories(state).find(item => item.name === name);
  if (!category) return fail(404, "商品分类不存在或已删除");
  if (category.protected) return fail(400, "买商品送会员为业务专区，不可删除");
  if (category.productCount) return fail(409, `该分类仍有 ${category.productCount} 件商品，请先调整商品分类或删除商品`);
  state.config ||= {};
  state.config.deletedProductCategories = [...new Set([...(state.config.deletedProductCategories || []), name])];
  logOperation(state, actor, "category.delete", "category", name, { reason: "后台确认删除空分类" });
  saveState();
  return { ok: true, categories: listCategories(state) };
}

module.exports = { listCategories, deleteProduct, moveProduct, deleteCategory };
