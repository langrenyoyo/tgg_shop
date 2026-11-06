const GROUPS = [
  {
    type: "orders", label: "订单", permission: "order:read",
    fields: item => [item.id, item.orderNo, item.userId, ...(item.items || []).flatMap(product => [product.productId, product.title, product.name])],
    project: item => ({ id: item.id, title: item.orderNo || item.id, description: [item.userId, ...(item.items || []).map(product => product.title || product.name || product.productId)].filter(Boolean).join(" · "), status: item.status })
  },
  {
    type: "users", label: "用户", permission: "customer:read",
    fields: item => [item.id, item.nickname, item.phone],
    project: item => ({ id: item.id, title: item.nickname || item.id, description: item.phone || "未绑定手机号", status: item.status || "active" })
  },
  {
    type: "products", label: "商品", permission: "product:read",
    fields: item => [item.id, item.name, item.title, item.category, item.locationCode],
    project: item => ({ id: item.id, title: item.name || item.title || item.id, description: [item.category, item.locationCode].filter(Boolean).join(" · "), status: item.status || "off" })
  }
];

function searchAdmin(state, query, permissions = []) {
  const allowed = GROUPS.filter(group => permissions.includes("*") || permissions.includes(group.permission));
  if (!allowed.length) return { ok: false, status: 403, error: "当前角色无订单、用户或商品查询权限" };
  const q = String(query || "").trim();
  if (!q || q.length > 100) return { ok: false, status: 400, error: "请输入 1–100 个字符的搜索关键词" };
  const keyword = q.toLocaleLowerCase();
  const limit = 20;
  const groups = allowed.map(group => {
    const matches = (state[group.type] || []).filter(item => group.fields(item).some(value => value != null && String(value).toLocaleLowerCase().includes(keyword)));
    // Exact identifiers come first, even when a broad query has more than 20 matches.
    matches.sort((a, b) => Number(String(b.id).toLocaleLowerCase() === keyword) - Number(String(a.id).toLocaleLowerCase() === keyword));
    return { type: group.type, label: group.label, total: matches.length, items: matches.slice(0, limit).map(group.project) };
  });
  return { ok: true, query: q, limit, total: groups.reduce((sum, group) => sum + group.total, 0), groups };
}

module.exports = { searchAdmin };
