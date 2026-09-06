const ADMIN_TOKEN_KEY = "tggAdminToken";
const ADMIN_REFRESH_TOKEN_KEY = "tggAdminRefreshToken";
const ADMIN_ROLE_KEY = "tggAdminRole";
const DEMO_PASSWORD = "123456";

export async function api(path, options = {}) {
  const token = ["/api/admin/auth/login", "/api/admin/auth/refresh"].includes(path) ? "" : await ensureAdminToken();
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
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

export async function safeApi(path, fallback) {
  try {
    return { ok: true, data: await api(path) };
  } catch (error) {
    return { ok: false, data: fallback, error };
  }
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
