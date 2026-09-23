const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

export function adminAccountsView(state) {
  const permissions = state.identity?.permissions || [];
  const manage = permissions.includes("*") || permissions.includes("admin:manage");
  if (!manage) return "";
  const roles = state.roles || [];
  const grantable = roles.filter(role => permissions.includes("*") || role.permissions.every(item => permissions.includes(item)));
  const selected = state.adminUsers.find(item => item.id === state.editingAdminId);
  const editing = state.editingAdminId === "new" || selected;
  const reset = state.resetAdminId && state.adminUsers.find(item => item.id === state.resetAdminId);
  return `<section class="table-panel admin-accounts-panel"><div class="panel-head"><div><h2>管理员账号</h2><p class="panel-caption">管理后台登录身份、角色授权和账号状态</p></div><button class="action" data-admin-edit="new">添加管理员</button></div>
    <div class="admin-account-table-wrap"><table class="admin-account-table"><thead><tr><th>账号 / 姓名</th><th>授权角色</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead><tbody>${state.adminUsers.map(item => `<tr>
      <td>${escape(item.username)} / ${escape(item.name)}</td><td>${item.roleIds.map(id => escape(roles.find(role => role.id === id)?.name || id)).join(" / ")}</td>
      <td>${item.status === "active" ? "启用" : "禁用"}</td><td>${escape(item.lastLoginAt || "尚未登录")}</td><td>
      <button class="action" data-admin-edit="${escape(item.id)}">编辑 / 授权角色</button><button class="action" data-admin-reset="${escape(item.id)}">重置密码</button>
      <button class="action" data-admin-toggle="${escape(item.id)}" data-admin-status="${item.status === "active" ? "disabled" : "active"}" ${item.id === state.identity.adminId ? "disabled" : ""}>${item.status === "active" ? "禁用" : "启用"}</button><button class="action danger-action" data-admin-delete="${escape(item.id)}" ${item.id === state.identity.adminId ? "disabled" : ""}>删除</button></td></tr>`).join("")}</tbody></table></div>
    ${editing ? `<form class="admin-form admin-account-form" data-admin-form="${escape(selected?.id || "new")}"><h3>${selected ? "编辑管理员 / 授权角色" : "添加管理员"}</h3>
      <label>账号<input name="username" value="${escape(selected?.username || "")}" pattern="[a-zA-Z0-9_.-]{3,40}" ${selected ? "disabled" : "required"} autocomplete="off"></label>
      <label>姓名<input name="name" value="${escape(selected?.name || "")}" maxlength="50" required></label>
      ${selected ? "" : '<label>初始密码<input name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label>'}
      <fieldset class="admin-role-checks"><legend>授权角色（可多选）</legend><div>${grantable.map(role => `<label><input type="checkbox" name="roleIds" value="${escape(role.id)}" ${selected?.roleIds.includes(role.id) ? "checked" : ""}>${escape(role.name)}</label>`).join("")}</div></fieldset>
      <label>操作原因<input name="reason" required></label><div class="admin-account-form-actions"><button class="action" type="submit">保存</button><button class="action muted-action" type="button" data-admin-cancel>取消</button></div></form>` : ""}
    ${reset ? `<form class="admin-form admin-account-form" data-admin-password="${escape(reset.id)}"><h3>重置 ${escape(reset.username)} 的密码</h3><p>保存后该账号全部已登录会话失效。</p><label>新密码<input name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label><label>操作原因<input name="reason" required></label><div class="admin-account-form-actions"><button class="action" type="submit">确认重置</button><button class="action muted-action" type="button" data-admin-cancel>取消</button></div></form>` : ""}
    </section>`;
}
