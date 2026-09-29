const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const labels = { ambient: "常温", chilled: "冷藏", frozen: "冷冻", fresh: "生鲜" };

export function packageRow(item = {}) {
  return `<div class="package-row" data-package-row><label>存放类型<select name="packageType">${Object.entries(labels).map(([value, label]) => `<option value="${value}" ${item.storageType === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>提货位<input name="packageShelf" value="${esc(item.shelfCode || "")}" maxlength="40" placeholder="如 A-02-03；常温可自动分配"></label><label>袋数<input name="packageBags" type="number" min="1" max="99" step="1" value="${Number(item.bagCount || 1)}" required></label><button type="button" class="secondary" data-package-remove>移除</button></div>`;
}

export function storageEditor(order) {
  const rows = order?.packages?.length ? order.packages : [...new Set((order?.pickingItems || []).map(item => item.storageType || "ambient"))].map(storageType => ({ storageType }));
  return `<fieldset class="storage-editor"><legend>分袋存放</legend><p class="muted">每袋贴订单尾号和存放位标签；冷藏、冷冻、生鲜区必须填写实际位置。</p><div data-package-rows>${(rows.length ? rows : [{}]).map(packageRow).join("")}</div><button type="button" class="secondary" data-package-add>＋ 添加存放位置</button></fieldset>`;
}

export function pickupDialog(dialogState) {
  const preview = dialogState.preview;
  if (!preview) return `<div class="dialog"><section class="dialog-card"><h2>输入提货码找货</h2><p class="muted">查找只展示货物位置，取齐后再确认交付。</p><form class="form" id="actionForm"><label>提货码<div class="input-scan"><input name="pickupCode" required autofocus><button type="button" class="secondary" data-action="scan" data-scan-target="pickupCode">扫码</button></div></label><label>完整订单号（重码时填写）<input name="orderId" value="${esc(dialogState.order?.id || "")}"></label><div class="actions"><button class="primary">查找货物</button><button type="button" class="secondary" data-action="close">取消</button></div></form></section></div>`;
  const order = preview.order;
  return `<div class="dialog"><section class="dialog-card"><h2>找到货物后，再确认交付</h2><p>${esc(order.siteName)} · 订单 ${esc(order.id)}</p><strong class="pickup-total">共 ${order.bagCount} 袋 · ${order.itemCount} 件商品</strong><form class="form" id="actionForm">
    ${order.packages.map(item => `<label class="pickup-location"><span><span class="tag">${esc(item.storageLabel)}</span><strong class="pickup-shelf">${esc(item.shelfCode)}</strong><span>${item.bagCount} 袋${item.legacy ? "（历史订单，请现场核实袋数）" : ""}</span></span><span><input type="checkbox" name="confirmedPackageIds" value="${esc(item.id)}" required> 已取齐</span></label>`).join("")}
    <div>${order.items.map(item => `<p>${esc(item.title || item.name || item.productId)} × ${item.quantity}</p>`).join("")}</div>
    ${order.overdue ? '<p class="danger-text">已超过保管期限，请先检查商品状态。</p>' : ""}
    <p class="muted">逐项核对存放位置、包装标签、袋数及商品，交给用户后确认。</p>
    <div class="actions"><button class="primary" ${order.packages.length ? "" : "disabled"}>确认已交付</button><button type="button" class="secondary" data-action="close">返回找货</button></div>
    </form></section></div>`;
}
