const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const permissions = [["station:receive", "收货 / 拣货"], ["station:pickup", "提货核验"], ["station:exception", "异常登记"]];

export function stationAccountsView(state) {
  if (state.stationAccountsError) return `<section class="panel" role="alert">${escape(state.stationAccountsError)}，请刷新重试。</section>`;
  const accounts = state.stationAccounts || [];
  const sites = state.stationAccountSites || [];
  const selected = accounts.find(item => item.id === state.editingStationId);
  const editing = state.editingStationId === "new" || selected;
  const reset = accounts.find(item => item.id === state.resetStationId);
  return `<section class="table-panel admin-accounts-panel">
    <div class="panel-head"><div><h2>站点工作人员</h2><p class="panel-caption">配置人员、所属站点和操作权限；首次使用需在小程序绑定微信</p></div><button class="action" data-station-edit="new">新增工作人员</button></div>
    ${state.stationAccountMessage ? `<p role="status">${escape(state.stationAccountMessage)}</p>` : ""}
    <div class="admin-account-table-wrap"><table class="admin-account-table"><thead><tr><th>账号 / 姓名</th><th>所属站点</th><th>操作权限</th><th>账号 / 微信状态</th><th>操作</th></tr></thead><tbody>
    ${accounts.map(item => `<tr><td>${escape(item.username)}<br>${escape(item.name)}</td><td>${item.siteIds.map(id => escape(sites.find(site => site.id === id)?.name || id)).join("<br>")}</td>
      <td>${permissions.filter(([key]) => item.permissions.includes(key)).map(([, label]) => label).join("<br>") || "仅查看"}</td>
      <td>${item.status === "active" ? "启用" : "停用"}<br>${item.wechatBound ? "微信已绑定" : "微信未绑定"}${item.passwordConfigured ? "" : "<br>旧账号，请设置独立密码"}</td><td>
      <button class="action" data-station-edit="${escape(item.id)}">编辑 / 授权</button>
      <button class="action" data-station-reset="${escape(item.id)}">重置密码</button>
      <button class="action" data-station-action="status" data-station-id="${escape(item.id)}" data-status="${item.status === "active" ? "disabled" : "active"}">${item.status === "active" ? "停用" : "启用"}</button>
      <button class="action danger-action" data-station-action="unbind-wechat" data-station-id="${escape(item.id)}" ${item.wechatBound ? "" : "disabled"}>解绑微信</button></td></tr>`).join("") || '<tr><td colspan="5">暂无工作人员，请新增账号。</td></tr>'}
    </tbody></table></div>
    ${editing ? `<form class="admin-form admin-account-form" data-station-form="${escape(selected?.id || "new")}"><h3>${selected ? "编辑工作人员与授权" : "新增工作人员"}</h3>
      <label>登录账号<input name="username" value="${escape(selected?.username || "")}" pattern="[a-zA-Z0-9_.-]{3,40}" autocomplete="off" ${selected ? "disabled" : "required"}></label>
      <label>姓名<input name="name" value="${escape(selected?.name || "")}" maxlength="50" required></label>
      ${selected ? "" : '<label>初始密码<input name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label>'}
      <fieldset class="admin-role-checks"><legend>所属站点（至少一个）</legend><div>${sites.map(site => `<label><input name="siteIds" type="checkbox" value="${escape(site.id)}" ${selected?.siteIds.includes(site.id) ? "checked" : ""}>${escape(site.name)}${site.enabled === false ? "（已停用）" : ""}</label>`).join("") || "请先在“代理与自提点”中创建站点。"}</div></fieldset>
      <fieldset class="admin-role-checks"><legend>操作权限（不勾选则仅可查看）</legend><div>${permissions.map(([key, label]) => `<label><input name="permissions" type="checkbox" value="${key}" ${selected ? selected.permissions.includes(key) ? "checked" : "" : "checked"}>${label}</label>`).join("")}</div></fieldset>
      <label>账号状态<select name="status"><option value="active" ${selected?.status !== "disabled" ? "selected" : ""}>启用</option><option value="disabled" ${selected?.status === "disabled" ? "selected" : ""}>停用</option></select></label>
      <label>操作原因<input name="reason" maxlength="200" required></label>
      <p>保存后该人员需重新登录，未完成的拣货任务会释放给其他工作人员。</p>
      <div class="admin-account-form-actions"><button class="action" type="submit" ${sites.length ? "" : "disabled"}>保存工作人员</button><button class="action muted-action" type="button" data-station-cancel>取消</button></div></form>` : ""}
    ${reset ? `<form class="admin-form admin-account-form" data-station-password="${escape(reset.id)}"><h3>重置 ${escape(reset.username)} 的密码</h3><p>重置后旧会话失效。微信绑定会保留，如需换人请同时解绑微信。</p><label>新密码<input name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label><label>操作原因<input name="reason" maxlength="200" required></label><div class="admin-account-form-actions"><button class="action" type="submit">确认重置</button><button class="action muted-action" type="button" data-station-cancel>取消</button></div></form>` : ""}
    </section>`;
}

export function stationAccountClick(event, state, { api, render, reload }) {
  const edit = event.target.closest("[data-station-edit], [data-station-reset], [data-station-cancel]");
  if (edit) {
    state.editingStationId = edit.dataset.stationEdit || null;
    state.resetStationId = edit.dataset.stationReset || null;
    render(state); return true;
  }
  const button = event.target.closest("[data-station-action]");
  if (!button) return false;
  if (button.disabled) return true;
  const reason = window.prompt("填写操作原因（此操作会使该人员旧登录失效，并释放未完成拣货任务）");
  if (!reason?.trim()) return true;
  if (!window.confirm(button.dataset.stationAction === "status" ? "确认调整工作人员状态？" : "确认解绑微信？解绑后需使用账号密码重新绑定。")) return true;
  button.disabled = true;
  const statusAction = button.dataset.stationAction === "status";
  api(`/api/admin/station-accounts/${encodeURIComponent(button.dataset.stationId)}${statusAction ? "" : "/unbind-wechat"}`, { method: statusAction ? "PATCH" : "POST", body: JSON.stringify({ reason, ...(statusAction ? { status: button.dataset.status } : {}) }) })
    .then(() => { state.stationAccountMessage = "工作人员配置已更新"; return reload(); })
    .catch(error => window.alert(error.message)).finally(() => { button.disabled = false; });
  return true;
}

export function stationAccountSubmit(event, state, { api, render, reload }) {
  const form = event.target.closest("[data-station-form], [data-station-password]");
  if (!form) return false;
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  if (button.disabled) return true;
  const fields = new FormData(form), reset = form.dataset.stationPassword, id = form.dataset.stationForm;
  const body = reset ? { password: fields.get("password"), reason: fields.get("reason") } : {
    name: fields.get("name"), siteIds: fields.getAll("siteIds"), permissions: fields.getAll("permissions"), status: fields.get("status"), reason: fields.get("reason"),
    ...(id === "new" ? { username: fields.get("username"), password: fields.get("password") } : {})
  };
  if (!reset && !body.siteIds.length) { window.alert("请至少选择一个所属站点"); return true; }
  if (!window.confirm(reset ? "确认重置密码并退出该账号全部会话？" : "确认保存工作人员及授权？已有会话将失效，未完成拣货任务会释放。")) return true;
  button.disabled = true;
  const path = reset ? `/api/admin/station-accounts/${encodeURIComponent(reset)}/reset-password` : id === "new" ? "/api/admin/station-accounts" : `/api/admin/station-accounts/${encodeURIComponent(id)}`;
  api(path, { method: reset || id === "new" ? "POST" : "PATCH", body: JSON.stringify(body) })
    .then(() => { state.editingStationId = state.resetStationId = null; state.stationAccountMessage = "工作人员配置已保存"; return reload(); })
    .catch(error => window.alert(error.message)).finally(() => { button.disabled = false; });
  return true;
}
