const USER_TOKEN_KEY = "tggUserToken";
const USER_REFRESH_TOKEN_KEY = "tggUserRefreshToken";
const USER_ID_KEY = "tggUserId";

const PUBLIC_USER_PATHS = new Set([
  "/api/config",
  "/api/home",
  "/api/products",
  "/api/points-exchange",
  "/api/task-types",
  "/api/tasks",
  "/api/task-platform/status",
  "/api/pickup-sites",
  "/api/delivery/teams"
]);

export function hasUserSession() {
  return Boolean(localStorage.getItem(USER_TOKEN_KEY) || localStorage.getItem(USER_REFRESH_TOKEN_KEY));
}

function isPublicUserPath(path) {
  const pathname = String(path).split("?", 1)[0];
  return PUBLIC_USER_PATHS.has(pathname)
    || /^\/api\/products\/[^/]+$/.test(pathname)
    || /^\/api\/tasks\/[^/]+$/.test(pathname);
}

export async function api(path, options = {}) {
  const token = ["/api/auth/login", "/api/auth/refresh"].includes(path) ? "" : await ensureUserToken();
  if (!token && !isPublicUserPath(path)) {
    const error = new Error("请先登录");
    error.statusCode = 401;
    error.code = "AUTH_REQUIRED";
    throw error;
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
  if (res.status === 401 && !["/api/auth/login", "/api/auth/refresh"].includes(path) && !options.__retried) {
    const refreshed = await refreshUserToken();
    if (refreshed) return api(path, { ...options, __retried: true });
    localStorage.removeItem(USER_TOKEN_KEY);
    localStorage.removeItem(USER_REFRESH_TOKEN_KEY);
    const error = new Error(data.error || "登录已失效，请重新登录");
    error.statusCode = 401;
    error.code = "SESSION_EXPIRED";
    throw error;
  }
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

export async function loginUser(userId, password) {
  const identity = String(userId || localStorage.getItem(USER_ID_KEY) || "").trim();
  if (!identity || typeof password !== "string" || !password) throw new Error("请输入账号和密码");
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: identity, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "登录失败");
  localStorage.setItem(USER_ID_KEY, identity);
  storeTokens(data);
  return data;
}

export async function logoutUser() {
  const token = localStorage.getItem(USER_TOKEN_KEY);
  if (token) {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    }).catch(() => {});
  }
  localStorage.removeItem(USER_TOKEN_KEY);
  localStorage.removeItem(USER_REFRESH_TOKEN_KEY);
}

async function ensureUserToken() {
  const token = localStorage.getItem(USER_TOKEN_KEY);
  if (token) return token;
  if (await refreshUserToken()) return localStorage.getItem(USER_TOKEN_KEY);
  return "";
}

async function refreshUserToken() {
  const refreshToken = localStorage.getItem(USER_REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;
  try {
    const res = await fetch("/api/auth/refresh", {
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
  localStorage.setItem(USER_TOKEN_KEY, data.token);
  if (data.refreshToken) localStorage.setItem(USER_REFRESH_TOKEN_KEY, data.refreshToken);
}
