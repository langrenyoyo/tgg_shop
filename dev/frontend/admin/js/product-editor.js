export function productEditor(product, { escapeHtml: e, can }) {
  const existing = Boolean(product.id);
  const pure = Boolean(product.purePointsOnly);
  const editable = can("product:write") && (!pure || can("points_product:write")) && product.status !== "on";
  const field = (label, name, value = "", type = "text", attributes = "") => `<label>${label}<input name="${name}" type="${type}" value="${e(value ?? "")}" ${attributes}></label>`;
  return `<section class="panel product-editor" id="product-editor"><div class="panel-head"><h2>${existing ? "编辑商品" : "新增商品"}</h2>${existing ? '<button class="action muted-action" type="button" data-product-edit-cancel>取消编辑</button>' : ""}</div>
    <p class="muted-text">填写资料 → 保存草稿或预览 → 校验上架。已上架商品须先下架后修改资料；库存可单独调整。</p>
    <form class="admin-form" data-product-create-form data-product-id="${e(product.id || "")}" data-revision="${product.revision || 0}"><fieldset class="editor-fields" ${editable ? "" : "disabled"}>
      <div class="editor-grid">${field("商品名称", "name", product.name, "text", 'required maxlength="120"')}
        <label>销售类型<select name="productType" ${existing ? "disabled" : ""}><option value="cash" ${pure ? "" : "selected"}>会员现金商品</option><option value="pure" ${pure ? "selected" : ""} ${can("points_product:write") ? "" : "disabled"}>纯积分兑换（无需会员）</option></select></label>
        ${field("商品分类", "category", product.category, "text", 'list="product-categories" maxlength="40"')}
        ${field("规格 / 单位", "unit", product.unit, "text", 'placeholder="例如：500g / 盒" maxlength="40"')}
        ${field("现金价（元）", "cashPrice", product.cashPrice ?? 0, "number", `min="0" max="100000000" step="0.01" ${pure ? "disabled" : ""}`)}
        <label class="check"><input name="supportsPoints" type="checkbox" ${product.supportsPoints !== false ? "checked" : ""} ${pure ? "disabled" : ""}>支持积分兑换 / 积分补差（纯积分商品禁止补差）</label>
        ${field("积分价", "pointsPrice", product.pointsPrice || 0, "number", 'min="0" max="100000000" step="1"')}
        ${existing ? `<label>可售库存<strong>${product.stock ?? 0}</strong><span>请使用列表中的“调整库存”</span></label>` : field("初始可售库存", "stock", product.stock || 0, "number", `min="0" max="100000000" step="1" ${can("stock:write") ? "" : "disabled"}`)}
        ${field("展示标签", "tag", product.tag, "text", 'maxlength="80"')}
      </div>
      <label>商品主图地址<input name="image" value="${e(product.image || "")}" placeholder="上传图片或填写 https 图片地址 / 本地图片路径"></label>
      <div class="product-upload"><label>上传商品图片<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-product-image-upload></label><span data-product-upload-message role="status">支持 PNG / JPEG / GIF / WebP，最大 10 MB</span></div>
      <label>商品介绍<textarea name="description" rows="5" maxlength="5000" placeholder="产地、规格、储存方式、食用说明等">${e(product.description || "")}</textarea></label>
      ${field("操作原因", "reason", "", "text", 'required placeholder="填写本次新增或修改的原因"')}
      <div class="table-actions product-editor-actions"><button class="action muted-action" type="button" data-product-preview-form>预览商品</button><button class="action" type="submit" name="intent" value="off">${existing ? "保存修改（不上架）" : "保存草稿"}</button><button class="action" type="submit" name="intent" value="on">保存并上架</button></div>
      <p class="product-form-error" data-product-form-error role="alert"></p>
    </fieldset></form>
    ${editable ? "" : '<p class="muted-text">当前商品不可编辑，请检查上下架状态及商品管理权限。</p>'}</section>`;
}

export function productPreview(product, e) {
  return `<dialog class="product-preview-dialog" data-product-preview-dialog><div class="panel-head"><h2>商品预览</h2><button class="action muted-action" data-product-preview-close>关闭</button></div>
    ${product.image ? `<img src="${e(product.image)}" alt="${e(product.name || "商品主图")}">` : '<p class="muted-text">尚未设置主图</p>'}
    <h2>${e(product.name || "未填写商品名称")}</h2><p>${e(product.category || "未填写分类")} · ${e(product.unit || "未填写规格")}</p><p>${e(product.tag || "")}</p>
    <strong>${product.purePointsOnly ? `${product.pointsPrice || 0} 积分` : `会员价 ¥${Number(product.cashPrice || 0).toFixed(2)}`}</strong>
    <p>${product.purePointsOnly ? "无需会员 · 不支持现金补差" : "现金购买需要月会员"} · 库存 ${product.stock || 0}</p>
    <p class="product-description">${e(product.description || "暂无商品介绍")}</p><p class="muted-text">预览不会保存或上架商品。</p></dialog>`;
}
