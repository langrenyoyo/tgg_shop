const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

export function confirmCatalogAction(message, { position, max } = {}) {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "catalog-confirm-dialog";
    dialog.innerHTML = `<form method="dialog"><h2>${position ? "调整商品位置" : "确认删除"}</h2><p>${escape(message)}</p>${position ? `<label>目标位置（1–${max}）<input name="position" type="number" min="1" max="${max}" step="1" value="${position}" required></label>` : ""}<div class="table-actions"><button class="action ${position ? "" : "danger-action"}" value="confirm">确定</button><button class="action muted-action" value="cancel" formnovalidate autofocus>取消</button></div></form>`;
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      const result = dialog.returnValue === "confirm" ? { position: position ? Number(dialog.querySelector("input").value) : undefined } : null;
      dialog.remove(); resolve(result);
    }, { once: true });
    dialog.showModal();
  });
}

export function createCatalogControls(state, { api, render, reload, confirm = confirmCatalogAction }) {
  let busy = false, dragging = null;
  function writable(product) {
    const can = permission => (state.identity?.permissions || []).some(value => value === "*" || value === permission);
    return can("product:write") && (!product?.purePointsOnly || can("points_product:write"));
  }
  async function move(id, position, expectedOrder) {
    const product = state.products.find(item => item.id === id);
    if (busy || !product || !writable(product)) return;
    const snapshot = { expectedRevision: product.revision || 0, expectedOrder: expectedOrder || state.products.map(item => item.id), position };
    busy = true;
    try {
      await api(`/api/admin/products/${encodeURIComponent(id)}/position`, { method: "PATCH", body: JSON.stringify(snapshot) });
      state.productMessage = `“${product.name}”已移到第 ${position} 位`;
      await reload();
    } catch (error) { state.productMessage = error.message; render(state); }
    finally { busy = false; }
  }
  async function click(event) {
    const button = event.target.closest("[data-product-delete], [data-product-position], [data-category-delete]");
    if (!button) return false;
    if (busy || button.disabled) return true;
    const category = button.dataset.categoryDelete;
    const id = button.dataset.productDelete || button.dataset.productPosition;
    const product = state.products.find(item => item.id === id);
    if (!writable(product) || (!category && !product)) return true;
    const expectedRevision = product?.revision || 0;
    const expectedOrder = state.products.map(item => item.id);
    const moving = button.hasAttribute("data-product-position");
    busy = true;
    const result = await confirm(moving ? `将“${product.name}”移到全部商品中的指定位置。` : category ? `确定删除分类“${category}”？分类下有商品时须先调整商品分类。` : `确定删除商品“${product.name}”？删除后停止销售，历史订单和退款记录保留。`, moving ? { position: expectedOrder.indexOf(id) + 1, max: expectedOrder.length } : {});
    busy = false;
    if (!result) return true;
    if (moving) { await move(id, result.position, expectedOrder); return true; }
    busy = true;
    try {
      await api(category ? "/api/admin/product-categories" : `/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify(category ? { name: category } : { expectedRevision }) });
      if (state.editingProductId === id) state.editingProductId = null;
      state.productMessage = category ? `分类“${category}”已删除` : `商品“${product.name}”已删除`;
      await reload();
    } catch (error) { state.productMessage = error.message; render(state); }
    finally { busy = false; }
    return true;
  }
  function dragstart(event) {
    const row = event.target.closest("[data-product-row]");
    const product = state.products.find(item => item.id === row?.dataset.productRow);
    if (busy || !product || !writable(product)) { event.preventDefault(); return; }
    dragging = { id: product.id, expectedOrder: state.products.map(item => item.id) };
    event.dataTransfer.setData("text/plain", product.id);
    event.dataTransfer.effectAllowed = "move";
    row.classList.add("dragging");
  }
  function dragover(event) {
    if (dragging && event.target.closest("[data-product-row]")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
  }
  function dragend() { dragging = null; document.querySelectorAll(".dragging").forEach(row => row.classList.remove("dragging")); }
  async function drop(event) {
    const row = event.target.closest("[data-product-row]");
    if (!dragging || !row) return;
    event.preventDefault();
    const { id, expectedOrder } = dragging;
    const target = row.dataset.productRow;
    const rect = row.getBoundingClientRect();
    const remaining = expectedOrder.filter(value => value !== id);
    const position = remaining.indexOf(target) + 1 + (event.clientY >= rect.top + rect.height / 2 ? 1 : 0);
    dragend();
    if (target !== id) await move(id, position, expectedOrder);
  }
  return { click, dragstart, dragover, dragend, drop };
}
