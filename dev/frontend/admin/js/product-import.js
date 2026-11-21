const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function productImportView(state) {
  if (!state.identity?.permissions?.some(p => p === "*" || p === "product:write")) return "";
  const view = state.productImport || {}, report = view.report;
  const issues = (items, title) => !items?.length ? "" : `<details open><summary>${title}（${items.length} 项）</summary><div class="product-import-scroll"><table><thead><tr><th>Excel 行号</th><th>字段</th><th>修改提示</th></tr></thead><tbody>${items.slice(0, 200).map(item => `<tr><td>第 ${item.row} 行</td><td>${esc(item.field)}</td><td>${esc(item.message)}</td></tr>`).join("")}</tbody></table></div>${items.length > 200 ? '<p>页面显示前 200 项，可下载完整校验结果查看全部问题。</p>' : ""}</details>`;
  return `<section class="panel product-import" aria-label="商品文档导入"><div class="panel-head"><h2>Excel 批量导入商品</h2><button type="button" class="action muted-action" data-product-import-template ${view.busy ? "disabled" : ""}>下载导入模板</button></div>
    <p>使用《商品导入模板.xls》，支持 Excel 97–2003 的 .xls 文件，最大 2 MB、每次最多 1000 个商品。必填：名称、分类、进货价、销售价。填写会员价时，“会员折扣”须填“否”。条码建议设为文本。</p>
    <p class="note">按“商品名称＋分类”匹配，存在则覆盖模板字段，不存在则新增；均保存为下架草稿。批发价非必填，销售价和会员价支持数字、中文、符号和英文。文字会员价仅展示，须补齐数字结算价才能上架；不自动提取或推算金额。覆盖保留原商品编号、图片及其他非模板配置，条码冲突会提醒。</p>
    <form class="admin-form" data-product-import-preview><label>选择商品文件<input type="file" name="workbook" accept=".xls,application/vnd.ms-excel" required ${view.busy ? "disabled" : ""}></label><button class="action" type="submit" ${view.busy ? "disabled" : ""}>上传并检查</button></form>
    ${view.busy ? '<p role="status">正在处理，请稍候…</p>' : ""}
    ${view.error ? `<p class="product-form-error" role="alert">${esc(view.error)}</p>` : ""}
    ${view.message ? `<p class="note" role="status">${esc(view.message)}</p>` : ""}
    ${report ? `<div class="product-import-result" aria-live="polite"><h3>${esc(report.filename)}</h3><p>识别 ${report.total} 个商品 · ${report.validRows} 行通过 · ${report.errors.length} 项错误 · ${report.warnings.length} 项提醒</p>
      ${!report.valid ? '<p class="product-form-error" role="alert">本批次未导入任何商品，请按以下提示修改文件，再重新上传。</p>' : ""}
      ${issues(report.errors, "必须修改的错误")}${issues(report.warnings, "请核对的提醒")}
      <button class="action muted-action" type="button" data-product-import-feedback>下载完整校验结果</button>
      <p>预计新增 ${report.createCount ?? report.total} 个，覆盖 ${report.updateCount || 0} 个。请核对覆盖对象、库存及价格。</p>
      <details><summary>商品预览（显示前 50 行）</summary><div class="product-import-scroll"><table><thead><tr><th>行号</th><th>操作</th><th>名称</th><th>分类</th><th>条码</th><th>规格/单位</th><th>库存</th><th>销售价</th><th>会员价</th></tr></thead><tbody>${report.rows.slice(0, 50).map(row => `<tr><td>${row.row}</td><td>${row.action === "update" ? "覆盖" : "新增"}</td><td>${esc(row.name)}</td><td>${esc(row.category)}</td><td>${esc(row.barcode)}</td><td>${esc(row.unit)}</td><td>${row.stock}</td><td>${esc(row.salePrice ?? "未填写")}</td><td>${esc(row.memberPrice ?? "未填写")}</td></tr>`).join("")}</tbody></table></div></details>
      ${report.valid && report.previewId && !view.committed ? `<form class="admin-form" data-product-import-commit><label>导入原因<input name="reason" required maxlength="200" value="${esc(view.reason || "")}" placeholder="例如：首批商品资料导入" ${view.busy ? "disabled" : ""}></label>
      ${report.warnings.length ? `<label class="check"><input type="checkbox" name="acknowledgeWarnings" required ${view.acknowledged ? "checked" : ""} ${view.busy ? "disabled" : ""}>我已核对以上提醒</label>` : ""}
      <button class="action" type="submit" ${view.busy ? "disabled" : ""}>确认导入 ${report.total} 个下架草稿</button><p>预览有效期 30 分钟，确认时会再次检查条码、字段及权限。</p></form>` : ""}
    </div>` : ""}</section>`;
}

function download(blob, filename) {
  const link = document.createElement("a"), url = URL.createObjectURL(blob);
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createProductImport(state, { api, render, reload }) {
  let generation = 0;
  let exportGeneration = 0;
  const current = () => state.productImport ||= {};
  const fail = (view, error) => { view.error = error.message || "导入失败，请重试"; if (error.details?.report) view.report = error.details.report; };
  return {
    invalidate() { generation++; exportGeneration++; state.productImport = {}; state.productExport = {}; },
    input(event) {
      if (!event.target.closest("[data-product-import-commit]")) return;
      if (event.target.name === "reason") current().reason = event.target.value;
      if (event.target.name === "acknowledgeWarnings") current().acknowledged = event.target.checked;
    },
    click(event) {
      if (event.target.closest("[data-product-export]")) {
        if (!state.identity?.permissions?.some(p => p === "*" || p === "product:read")) return true;
        const view = state.productExport ||= {};
        if (view.busy) return true;
        const seq = ++exportGeneration;
        view.busy = true; view.error = ""; render(state);
        api("/api/admin/products/export.xls", { responseType: "blob" })
          .then(blob => { if (seq === exportGeneration) download(blob, "商品数据.xls"); })
          .catch(error => { if (seq === exportGeneration) view.error = error.message || "商品导出失败，请重试"; })
          .finally(() => { if (seq === exportGeneration) { view.busy = false; render(state); } });
        return true;
      }
      if (event.target.closest("[data-product-import-feedback]")) {
        const report = current().report;
        if (report) download(new Blob([`${report.filename}\n识别 ${report.total} 行，错误 ${report.errors.length} 项，提醒 ${report.warnings.length} 项\n\n` +
          [["错误", report.errors], ["提醒", report.warnings]].flatMap(([kind, rows]) => rows.map(row => `${kind}：第 ${row.row} 行 / ${row.field} / ${row.message}`)).join("\n")], { type: "text/plain;charset=utf-8" }), "商品导入校验结果.txt");
        return true;
      }
      const button = event.target.closest("[data-product-import-template]");
      if (!button) return false;
      if (button.disabled) return true;
      button.disabled = true;
      const seq = generation;
      api("/api/admin/product-import/template", { responseType: "blob" }).then(blob => { if (seq === generation) download(blob, "商品导入模板.xls"); })
        .catch(error => { if (seq === generation) { fail(current(), error); render(state); } }).finally(() => { button.disabled = false; });
      return true;
    },
    submit(event) {
      const form = event.target.closest("[data-product-import-preview], [data-product-import-commit]");
      if (!form) return false;
      event.preventDefault();
      const view = current();
      if (view.busy) return true;
      const fields = new FormData(form), seq = ++generation;
      view.error = ""; view.message = "";
      let promise;
      if (form.hasAttribute("data-product-import-preview")) {
        const file = fields.get("workbook");
        view.report = null; view.committed = false; view.acknowledged = false;
        if (!file?.size || !/\.xls$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
          view.error = "请选择不超过 2 MB 的 .xls 文件（Excel 97–2003 格式）"; render(state); return true;
        }
        promise = api(`/api/admin/product-import/preview?filename=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file })
          .then(report => { if (seq === generation) view.report = report; });
      } else {
        if (!view.report?.valid || !view.report.previewId) return true;
        view.reason = String(fields.get("reason") || "").trim();
        view.acknowledged = fields.get("acknowledgeWarnings") === "on";
        if (!view.reason || (view.report.warnings.length && !view.acknowledged)) { view.error = "请填写导入原因并核对所有提醒"; render(state); return true; }
        promise = api("/api/admin/product-import/commit", { method: "POST", body: JSON.stringify({ previewId: view.report.previewId, reason: view.reason, acknowledgeWarnings: view.acknowledged }) })
          .then(async result => {
            if (seq !== generation) return;
            view.committed = true;
            view.message = `成功导入 ${result.batch.count} 个商品（新增 ${result.batch.createdCount ?? result.batch.count} 个，覆盖 ${result.batch.updatedCount || 0} 个），均已保存为下架草稿。请核对价格及库存后上架。`;
            try { await reload(); } catch { view.message += " 商品列表刷新失败，请手动刷新核对，勿重复上传。"; }
          });
      }
      view.busy = true; render(state);
      promise.catch(error => { if (seq === generation) fail(view, error); }).finally(() => {
        if (seq === generation) { view.busy = false; render(state); }
      });
      return true;
    }
  };
}
