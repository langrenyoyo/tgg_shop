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
  return `<section class="table-panel"><div class="panel-head"><h2>管理员账号</h2><button class="action" data-admin-edit="new">添加管理员</button></div>
    <table><thead><tr><th>账号 / 姓名</th><th>授权角色</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead><tbody>${state.adminUsers.map(item => `<tr>
      <td>${escape(item.username)} / ${escape(item.name)}</td><td>${item.roleIds.map(id => escape(roles.find(role => role.id === id)?.name || id)).join(" / ")}</td>
      <td>${item.status === "active" ? "启用" : "禁用"}</td><td>${escape(item.lastLoginAt || "尚未登录")}</td><td>
      <button class="action" data-admin-edit="${escape(item.id)}">编辑 / 授权角色</button><button class="action" data-admin-reset="${escape(item.id)}">重置密码</button>
      <button class="action" data-admin-toggle="${escape(item.id)}" data-admin-status="${item.status === "active" ? "disabled" : "active"}" ${item.id === state.identity.adminId ? "disabled" : ""}>${item.status === "active" ? "禁用" : "启用"}</button></td></tr>`).join("")}</tbody></table>
    ${editing ? `<form class="admin-form" data-admin-form="${escape(selected?.id || "new")}"><h3>${selected ? "编辑管理员 / 授权角色" : "添加管理员"}</h3>
      <label>账号<input name="username" value="${escape(selected?.username || "")}" pattern="[a-zA-Z0-9_.-]{3,40}" ${selected ? "disabled" : "required"} autocomplete="off"></label>
      <label>姓名<input name="name" value="${escape(selected?.name || "")}" maxlength="50" required></label>
      ${selected ? "" : '<label>初始密码<input name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label>'}
      <fieldset><legend>授权角色（可多选）</legend>${grantable.map(role => `<label><input type="checkbox" name="roleIds" value="${escape(role.id)}" ${selected?.roleIds.includes(role.id) ? "checked" : ""}>${escape(role.name)}</label>`).join("")}</fieldset>
      <label>操作原因<input name="reason" required></label><button class="action" type="submit">保存</button><button class="action" type="button" data-admin-cancel>取消</button></form>` : ""}
    ${reset ? `<form class="admin-form" data-admin-password="${escape(reset.id)}"><h3>重置 ${escape(reset.username)} 的密码</h3><p>保存后该账号全部已登录会话失效。</p><label>新密码<input name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label><label>操作原因<input name="reason" required></label><button class="action" type="submit">确认重置</button><button class="action" type="button" data-admin-cancel>取消</button></form>` : ""}
    </section>`;
}
