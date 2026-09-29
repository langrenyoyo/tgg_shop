const { nextId, saveState } = require("../data/store");
const { hashAdminPassword } = require("../domain/admin-accounts");
const { STATION_PERMISSIONS, publicStationAccount } = require("../domain/station-accounts");
const { logOperation } = require("./admin-service");

const invalid = error => ({ ok: false, status: 400, error });
const validPassword = value => typeof value === "string" && value.length >= 8 && value.length <= 128;

function list(state) {
  return { accounts: (state.stationAccounts || []).map(publicStationAccount),
    sites: (state.pickupSites || []).map(({ id, name, enabled }) => ({ id, name, enabled })) };
}

function revokeAccess(state, account) {
  account.authVersion = Number(account.authVersion || 0) + 1;
  const now = new Date().toISOString();
  for (const session of state.authSessions || []) {
    if (session.subjectType === "station" && session.subjectId === account.id && !session.revokedAt) session.revokedAt = now;
  }
  const releasedOrders = [];
  for (const record of state.stationOrders || []) {
    if (record.pickerId !== account.id || !["picking", "exception"].includes(record.stationStatus)) continue;
    record.pickerId = "";
    if (record.stationStatus === "picking") record.stationStatus = record.exceptionType ? "exception" : "expected";
    const order = (state.orders || []).find(item => item.id === record.orderId);
    if (order?.status === "paid") order.stationStatus = record.stationStatus;
    releasedOrders.push(record.orderId);
  }
  return releasedOrders;
}

async function mutate(state, id, action, input, actor) {
  if (!actor?.role?.permissions?.some(permission => ["*", "admin:manage"].includes(permission))) return { ok: false, status: 403, error: "没有工作人员管理权限" };
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid("请求内容无效");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > 200) return invalid("请填写 1 至 200 字的操作原因");
  const account = id ? (state.stationAccounts || []).find(item => item.id === id) : null;
  if (id && !account) return { ok: false, status: 404, error: "站点工作人员不存在" };
  const changes = {};
  if (action === "create" || action === "update") {
    if (action === "create") {
      const username = typeof input.username === "string" ? input.username.trim() : "";
      if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) return invalid("账号需为 3 至 40 位字母、数字或 _ . -");
      if ((state.stationAccounts || []).some(item => item.username.toLowerCase() === username.toLowerCase())) return { ok: false, status: 409, error: "站点账号已存在" };
      if (!validPassword(input.password)) return invalid("密码需为 8 至 128 个字符");
      changes.username = username;
    } else if (input.username !== undefined && input.username !== account.username) return invalid("站点账号不可修改");
    for (const key of ["name", "siteIds", "permissions", "status"]) {
      if (action === "update" && input[key] === undefined) continue;
      const value = input[key];
      if (key === "name") {
        if (typeof value !== "string" || !value.trim() || value.trim().length > 50) return invalid("请填写 1 至 50 字的姓名");
        changes.name = value.trim();
      } else if (key === "siteIds") {
        if (!Array.isArray(value) || !value.length || value.some(siteId => typeof siteId !== "string" || !(state.pickupSites || []).some(site => site.id === siteId))) return invalid("请选择有效的所属站点");
        changes.siteIds = [...new Set(value)];
      } else if (key === "permissions") {
        if (!Array.isArray(value) || value.some(permission => !STATION_PERMISSIONS.includes(permission))) return invalid("站点操作权限无效");
        changes.permissions = [...new Set(value)];
      } else {
        if (value !== undefined && !["active", "disabled"].includes(value)) return invalid("账号状态无效");
        changes.status = value || "active";
      }
    }
  } else if (action === "reset-password") {
    if (!validPassword(input.password)) return invalid("密码需为 8 至 128 个字符");
  } else if (action !== "unbind-wechat") return invalid("不支持的操作");

  const before = account ? publicStationAccount(account) : {};
  const now = new Date().toISOString();
  const target = account || { id: nextId("station"), role: "station_worker", wechatOpenid: "", createdAt: now, authVersion: 0 };
  Object.assign(target, changes, { updatedAt: now });
  if (action === "create" || action === "reset-password") target.passwordHash = hashAdminPassword(input.password);
  if (action === "unbind-wechat") target.wechatOpenid = "";
  const releasedOrders = account ? revokeAccess(state, target) : [];
  if (!account) { state.stationAccounts ||= []; state.stationAccounts.push(target); }
  if (action === "reset-password") state.authLoginAttempts = (state.authLoginAttempts || []).filter(item => !(item.subjectType === "station" && item.subjectId === target.id));
  logOperation(state, actor, `station_account.${action}`, "station_account", target.id, { before, after: publicStationAccount(target), reason, releasedOrders });
  await saveState();
  return { ok: true, account: publicStationAccount(target) };
}

module.exports = { list, mutate };
