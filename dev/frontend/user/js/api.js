const USER_TOKEN_KEY = "tggUserToken";
const USER_REFRESH_TOKEN_KEY = "tggUserRefreshToken";
const USER_ID_KEY = "tggUserId";
const DEMO_PASSWORD = "123456";

export async function api(path, options = {}) {
  const token = ["/api/auth/login", "/api/auth/refresh"].includes(path) ? "" : await ensureUserToken();
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
    return api(path, { ...options, __retried: true });
  }
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

export async function loginUser(userId = localStorage.getItem(USER_ID_KEY) || "u_1001") {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, password: DEMO_PASSWORD })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "登录失败");
  localStorage.setItem(USER_ID_KEY, userId);
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
  const result = await loginUser();
  return result.token;
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
