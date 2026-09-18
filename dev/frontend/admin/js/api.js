const ADMIN_TOKEN_KEY = "tggAdminToken";
const ADMIN_REFRESH_TOKEN_KEY = "tggAdminRefreshToken";
const ADMIN_ROLE_KEY = "tggAdminRole";
const DEMO_PASSWORD = "123456";

export async function api(path, options = {}) {
  const token = ["/api/admin/auth/login", "/api/admin/auth/refresh"].includes(path) ? "" : await ensureAdminToken();
  if (path === "/api/admin/approval-requests" && options.method === "POST" && !options.__approvalIntent) {
    const payload = JSON.parse(options.body);
    if (!payload.idempotencyKey) {
      const key = "tggApprovalIntent:" + JSON.stringify([getAdminRole(), payload.action, payload.targetType, payload.targetId]);
      const original = JSON.stringify(payload);
      const saved = localStorage.getItem(key);
      const intent = saved ? JSON.parse(saved) : { original, idempotencyKey: crypto.randomUUID() };
      if (intent.original !== original) throw new Error("上次审批申请结果待确认，请使用原金额及原因重试，或先核对审批列表");
      const value = JSON.stringify(intent);
      localStorage.setItem(key, value);
      options = { ...options, body: JSON.stringify({ ...payload, idempotencyKey: intent.idempotencyKey }), __approvalIntent: { key, value } };
    }
  }
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (res.status === 401 && !["/api/admin/auth/login", "/api/admin/auth/refresh"].includes(path) && !options.__retried) {
    const refreshed = await refreshAdminToken();
    if (refreshed) return api(path, { ...options, __retried: true });
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    return api(path, { ...options, __retried: true });
  }
  const intent = options.__approvalIntent;
  if (intent && (res.ok || [400, 409].includes(res.status)) && localStorage.getItem(intent.key) === intent.value) localStorage.removeItem(intent.key);
  if (!res.ok) throw Object.assign(new Error(data.error || "请求失败"), { statusCode: res.status });
  return data;
}

export async function safeApi(path, fallback) {
  try {
    return { ok: true, data: await api(path) };
  } catch (error) {
    return { ok: false, data: fallback, error };
  }
}

export function pendingApprovalIntents() {
  const role = getAdminRole(), intents = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith("tggApprovalIntent:")) continue;
    try {
      const identity = JSON.parse(key.slice("tggApprovalIntent:".length));
      if (identity[0] !== role) continue;
      const saved = JSON.parse(localStorage.getItem(key));
      const payload = JSON.parse(saved.original);
      if (typeof saved.idempotencyKey !== "string" || !saved.idempotencyKey || identity[1] !== payload.action || identity[2] !== payload.targetType || identity[3] !== payload.targetId) continue;
      intents.push({ id: saved.idempotencyKey, payload });
    } catch { /* Invalid browser records cannot be submitted as financial instructions. */ }
  }
  return intents;
}

export function retryApprovalIntent(id) {
  const intent = pendingApprovalIntents().find(item => item.id === id);
  if (!intent) return Promise.reject(new Error("原申请不存在或已切换角色，请刷新后核对审批列表"));
  return api("/api/admin/approval-requests", { method: "POST", body: JSON.stringify(intent.payload) });
}

export function getAdminRole() {
  return localStorage.getItem(ADMIN_ROLE_KEY) || "super_admin";
}

export async function loginAdmin(roleId = getAdminRole()) {
  const res = await fetch("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roleId, password: DEMO_PASSWORD })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "后台登录失败");
  localStorage.setItem(ADMIN_ROLE_KEY, roleId);
  storeTokens(data);
  return data;
}

export async function logoutAdmin() {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (token) {
    await fetch("/api/admin/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    }).catch(() => {});
  }
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_REFRESH_TOKEN_KEY);
}

async function ensureAdminToken() {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (token) return token;
  if (await refreshAdminToken()) return localStorage.getItem(ADMIN_TOKEN_KEY);
  const result = await loginAdmin();
  return result.token;
}

async function refreshAdminToken() {
  const refreshToken = localStorage.getItem(ADMIN_REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;
  try {
    const res = await fetch("/api/admin/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });
    const data = await res.json();
    if (!res.ok || !data.token) return false;
    storeTokens(data);
    return true;
  } catch {
    return false;
  }
}

function storeTokens(data) {
  localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
  if (data.refreshToken) localStorage.setItem(ADMIN_REFRESH_TOKEN_KEY, data.refreshToken);
}
