const permissions = { orders: "order:read", users: "customer:read", products: "product:read" };

export function createAdminSearch(state, { api, render, reload }) {
  let sequence = 0;
  let returnView = "dashboard";
  const can = type => {
    const values = state.identity?.permissions || [];
    return Boolean(permissions[type] && (values.includes("*") || values.includes(permissions[type])));
  };
  return {
    async submit(value) {
      if (!state.identity) return;
      const current = ++sequence;
      const adminId = state.identity.adminId;
      const query = String(value || "").trim();
      if (state.view !== "search") returnView = state.view;
      state.view = "search";
      state.searchTarget = null;
      state.globalSearch = { query, status: "loading", groups: [] };
      if (!query || query.length > 100) {
        state.globalSearch.status = "error";
        state.globalSearch.error = "请输入 1–100 个字符的搜索关键词";
        render(state);
        return;
      }
      render(state);
      try {
        const result = await api(`/api/admin/search?q=${encodeURIComponent(query)}`);
        if (current !== sequence || !state.identity || state.identity.adminId !== adminId) return;
        state.globalSearch = { ...result, query, status: "ready" };
      } catch (error) {
        if (current !== sequence || !state.identity || state.identity.adminId !== adminId) return;
        state.globalSearch = { query, status: "error", error: error.message || "搜索失败，请重试", groups: [] };
      }
      if (state.view === "search") render(state);
    },
    async open(type, id) {
      if (!can(type) || !state.globalSearch?.groups?.some(group => group.type === type && group.items.some(item => item.id === id))) return;
      state.searchTarget = { view: type, id };
      state.view = type;
      if (type === "products") {
        state.productSearch = "";
        state.productStatus = "";
        state.editingProductId = null;
        state.newProductPure = false;
        state.newProductGift = false;
      }
      render(state);
      await reload();
    },
    back() {
      state.searchTarget = null;
      state.view = "search";
      render(state);
    },
    reset() {
      this.invalidate();
      if (state.view === "search") state.view = returnView;
      render(state);
    },
    invalidate() {
      sequence += 1;
      state.globalSearch = null;
      state.searchTarget = null;
    }
  };
}

export function searchRecords(state, view, records) {
  return state.searchTarget?.view === view ? records.filter(item => item.id === state.searchTarget.id) : records;
}

export function renderSearchTarget(state, escapeHtml) {
  if (!state.searchTarget || state.searchTarget.view !== state.view) return "";
  const missing = !(state[state.view] || []).some(item => item.id === state.searchTarget.id);
  return `<section class="note search-target-note">当前定位：${escapeHtml(state.searchTarget.id)}${missing ? "（记录已不存在或暂时无法读取，请刷新重试）" : ""} <button class="action" type="button" data-admin-search-back>返回搜索结果</button> <button class="action" type="button" data-admin-search-show-all>显示全部</button></section>`;
}

export function renderGlobalSearch(state, { escapeHtml, escapeAttr, simpleTable, trustedHtml, badge, can }) {
  const search = state.globalSearch;
  if (!search) return '<section class="panel" role="status">请输入订单编号、用户昵称或手机号、商品名称等关键词进行搜索。</section>';
  if (search.status === "loading") return '<section class="panel" role="status" aria-live="polite">正在搜索，请稍候…</section>';
  if (search.status === "error") return `<section class="panel" role="alert">${escapeHtml(search.error)} <button class="action" type="button" data-admin-search-retry>重试</button></section>`;
  const groups = (search.groups || []).filter(group => permissions[group.type] && can(permissions[group.type]));
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  return `<section class="panel" role="status" aria-live="polite">“${escapeHtml(search.query)}”找到 ${total} 条结果。仅搜索当前账号有权查看的数据。${total ? "" : "未找到匹配记录，请更换关键词。"}</section>` + groups.map(group => `<section class="table-panel">${simpleTable(`${group.label}（${group.total}）`, ["编号", "名称 / 单号", "相关信息", "状态", "操作"], group.items.map(item => [
    item.id, item.title, item.description || "-", badge(item.status),
    trustedHtml(`<button class="action" type="button" data-admin-search-open="${escapeAttr(item.id)}" data-search-type="${escapeAttr(group.type)}">查看${escapeHtml(group.label)}</button>`)
  ]))}${group.total > group.items.length ? `<p class="note">仅展示前 ${group.items.length} 条，共 ${group.total} 条，请输入更具体的关键词。</p>` : ""}</section>`).join("");
}
