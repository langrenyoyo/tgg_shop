const crypto = require("node:crypto");
const { taskCallbackToken } = require("./runtime-safety");

function isPlaceholder(value) {
  return /^(replace[-_ ]|your[-_ ]|wx-your|server-only-secret|changeme|secret$|test(?:[-_]|$)|smoke|tgg-shop-dev-auth-secret)/i.test(String(value || "").trim());
}

function validateRuntimeConfig(env = process.env, strict) {
  const errors = [];
  const warnings = [];
  const driver = String(env.TGG_STORE_DRIVER || "json");
  // A PostgreSQL deployment is a shared/persistent environment even when an
  // operator accidentally leaves NODE_ENV at staging. Treat it as production
  // for safety checks so missing payment and credential configuration fails
  // before the process starts.
  const strictMode = strict === undefined
    ? env.NODE_ENV === "production" || driver === "pg"
    : strict;

  const port = Number(env.PORT || 5177);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push("PORT must be an integer between 1 and 65535");
  }

  const authSecret = String(env.TGG_AUTH_SECRET || "").trim();
  if (strictMode && authSecret.length < 16) {
    errors.push("TGG_AUTH_SECRET must be at least 16 characters in production");
  }
  if (strictMode && isPlaceholder(authSecret)) {
    errors.push("TGG_AUTH_SECRET must not use a default placeholder in production");
  }
  if (strictMode && String(env.TGG_TEST_BYPASS_ENABLED || "") === "1") errors.push("TGG_TEST_BYPASS_ENABLED must be 0 or unset in production");
  if ((strictMode || driver === "pg") && String(env.TGG_DEMO_PASSWORD || "").trim()) errors.push("TGG_DEMO_PASSWORD must not be configured with PostgreSQL; provision hashed administrator credentials");
  if (strictMode && !String(env.TGG_ADMIN_PASSWORD_HASH || env.TGG_DEMO_PASSWORD_HASH || "").trim()) errors.push("TGG_ADMIN_PASSWORD_HASH or TGG_DEMO_PASSWORD_HASH is required in production");

  const ttlSeconds = Number(env.TGG_AUTH_TOKEN_TTL_SECONDS || 60 * 60 * 8);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    errors.push("TGG_AUTH_TOKEN_TTL_SECONDS must be a positive number");
  }

  const bodyLimit = Number(env.TGG_MAX_BODY_BYTES || 1024 * 1024);
  if (!Number.isSafeInteger(bodyLimit) || bodyLimit < 1024 || bodyLimit > 16 * 1024 * 1024) {
    errors.push("TGG_MAX_BODY_BYTES must be an integer between 1024 and 16777216");
  }
  const uploadLimit = Number(env.TGG_UPLOAD_MAX_BYTES || 10 * 1024 * 1024);
  if (!Number.isSafeInteger(uploadLimit) || uploadLimit < 1024 || uploadLimit > 50 * 1024 * 1024) {
    errors.push("TGG_UPLOAD_MAX_BYTES must be an integer between 1024 and 52428800");
  }

  if (String(env.TGG_TEST_BYPASS_ENABLED || "") === "1" && driver === "pg") errors.push("TGG_TEST_BYPASS_ENABLED cannot be enabled with PostgreSQL storage");
  if (!["json", "sqlite", "pg"].includes(driver)) {
    errors.push(`Unsupported TGG_STORE_DRIVER: ${driver}`);
  }

  if (driver === "pg") {
    const pgUrl = String(env.TGG_PG_URL || env.DATABASE_URL || "").trim();
    if (!pgUrl) {
      errors.push("TGG_PG_URL or DATABASE_URL is required when TGG_STORE_DRIVER=pg");
    } else {
      try {
        const url = new URL(pgUrl);
        if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || (strictMode && /\.example$|\.invalid$/.test(url.hostname))) throw new Error();
      } catch { errors.push("TGG_PG_URL or DATABASE_URL must be a PostgreSQL connection URL with a database name"); }
    }
    const schema = String(env.TGG_PG_SCHEMA || "public").trim();
    if (!schema) {
      errors.push("TGG_PG_SCHEMA cannot be empty when TGG_STORE_DRIVER=pg");
    }
  }

  if (strictMode && driver !== "pg") {
    errors.push("TGG_STORE_DRIVER must be pg in production");
  }

  const corsOrigins = String(env.TGG_CORS_ORIGIN || "").split(",").map(item => item.trim()).filter(Boolean);
  if (strictMode && corsOrigins.length === 0) errors.push("TGG_CORS_ORIGIN must contain at least one HTTPS origin in production");
  if (strictMode && corsOrigins.includes("*")) errors.push("TGG_CORS_ORIGIN must list explicit HTTPS origins in production");
  for (const origin of corsOrigins) {
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    } catch { errors.push("TGG_CORS_ORIGIN must contain explicit HTTPS origins without paths or credentials"); break; }
  }
  if (strictMode && String(env.TGG_ENFORCE_HTTPS || "1") !== "1") errors.push("TGG_ENFORCE_HTTPS must be 1 in production");
  if (strictMode) {
    try {
      const publicOrigin = new URL(String(env.TGG_PUBLIC_ORIGIN || corsOrigins[0] || ""));
      if (publicOrigin.protocol !== "https:" || publicOrigin.pathname !== "/" || publicOrigin.search || publicOrigin.hash) throw new Error();
    } catch { errors.push("TGG_PUBLIC_ORIGIN must be an HTTPS origin in production"); }
  }

  const callbackToken = taskCallbackToken(env);
  if (env.TGG_TASK_CALLBACK_TOKEN && env.TGG_TASK_CALLBACK_SECRET && env.TGG_TASK_CALLBACK_TOKEN !== env.TGG_TASK_CALLBACK_SECRET) {
    errors.push("TGG_TASK_CALLBACK_TOKEN and TGG_TASK_CALLBACK_SECRET must match during migration");
  }
  const taskKeys = ["TGG_TASK_PLATFORM_BASE_URL", "TGG_TASK_PLATFORM_APPID", "TGG_TASK_PLATFORM_KEY"];
  const taskConfigured = taskKeys.map(key => Boolean(String(env[key] || "").trim()));
  if (strictMode || taskConfigured.some(Boolean)) {
    for (let index = 0; index < taskKeys.length; index++) if (!taskConfigured[index]) errors.push(`${taskKeys[index]} is required for the task platform; production must not fall back to local mock tasks`);
  }
  if (taskConfigured[0]) {
    try {
      const taskUrl = new URL(env.TGG_TASK_PLATFORM_BASE_URL);
      if (!["http:", "https:"].includes(taskUrl.protocol) || taskUrl.username || taskUrl.password || taskUrl.search || taskUrl.hash) throw new Error("Invalid URL");
    } catch { errors.push("TGG_TASK_PLATFORM_BASE_URL must be an HTTP(S) URL without credentials, query or fragment"); }
  }
  const taskTimeout = Number(env.TGG_TASK_PLATFORM_TIMEOUT_MS || 10000);
  if (env.TGG_TASK_SWEEP_ENABLED !== undefined && !["0", "1"].includes(env.TGG_TASK_SWEEP_ENABLED)) errors.push("TGG_TASK_SWEEP_ENABLED must be 0 or 1");
  if (!Number.isSafeInteger(taskTimeout) || taskTimeout < 100 || taskTimeout > 60000) errors.push("TGG_TASK_PLATFORM_TIMEOUT_MS must be an integer between 100 and 60000");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: env.TGG_TASK_PLATFORM_TIME_ZONE || "Asia/Shanghai" });
  } catch {
    errors.push("TGG_TASK_PLATFORM_TIME_ZONE must be a valid IANA time zone");
  }
  if (strictMode && callbackToken.length < 24) errors.push("TGG_TASK_CALLBACK_TOKEN must be at least 24 characters in production");
  if (strictMode && isPlaceholder(callbackToken)) errors.push("TGG_TASK_CALLBACK_TOKEN must not use a placeholder in production");
  if (!strictMode && !callbackToken) warnings.push("Task callback endpoint is disabled until TGG_TASK_CALLBACK_TOKEN is configured");

  if (strictMode) {
    const required = key => {
      if (!String(env[key] || "").trim() || isPlaceholder(env[key])) errors.push(`${key} requires a real production value`);
    };
    const https = key => {
      try {
        const url = new URL(env[key]);
        if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash || /replace|\.example$|\.invalid$/.test(url.hostname)) throw new Error();
      } catch { errors.push(`${key} must be an HTTPS URL without credentials, query or fragment`); }
    };
    const callbackUrl = key => {
      try {
        const url = new URL(env[key]);
        if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash || url.pathname !== "/api/providers/huifu/withdraw-callback" || url.searchParams.get("token") !== env.HF_CALLBACK_TOKEN || Array.from(url.searchParams.keys()).some(name => name !== "token")) throw new Error();
      } catch { errors.push(`${key} must be the HTTPS Huifu callback URL with the configured token`); }
    };
    for (const key of [...taskKeys, "WECHAT_APPSECRET", "LFWIN_API_KEY"]) required(key);
    if (!/^wx[0-9a-f]{16}$/.test(env.WECHAT_APPID || "")) errors.push("WECHAT_APPID must be a valid mini-program AppID");
    for (const key of ["LFWIN_BASE_URL", "LFWIN_NOTIFY_URL", "LFWIN_REFUND_NOTIFY_URL"]) https(key);
    if (/uat|sandbox/i.test(env.LFWIN_BASE_URL || "")) errors.push("LFWIN_BASE_URL must use the provider's production endpoint, not UAT/sandbox");
    const signType = String(env.LFWIN_SIGN_TYPE || "RSA").toUpperCase();
    if (signType === "MD5") required("LFWIN_SIGN_KEY");
    else if (signType === "RSA") {
      for (const [key, parse] of [["LFWIN_RSA_PRIVATE_KEY", crypto.createPrivateKey], ["LFWIN_RSA_PUBLIC_KEY", crypto.createPublicKey]]) {
        try {
          const parsed = parse(String(env[key] || "").replace(/\\n/g, "\n"));
          if (parsed.asymmetricKeyType !== "rsa") throw new Error();
        } catch { errors.push(`${key} must contain a valid RSA PEM key`); }
      }
    } else errors.push("LFWIN_SIGN_TYPE must be MD5 or RSA");
    const timeout = Number(env.LFWIN_TIMEOUT_MS || 10000);
    if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 60000) errors.push("LFWIN_TIMEOUT_MS must be an integer between 1000 and 60000");
    if (["HF_BASE_URL", "HF_COM_KEY", "HF_COM_SECRET", "HF_MERCHANT_ID"].some(key => env[key])) {
      for (const key of ["HF_COM_KEY", "HF_COM_SECRET", "HF_CALLBACK_TOKEN", "HF_MERCHANT_ID", "HF_CALLBACK_URL"]) required(key);
      https("HF_BASE_URL");
      callbackUrl("HF_CALLBACK_URL");
      if (Buffer.byteLength(String(env.HF_COM_KEY || ""), "utf8") !== 16) errors.push("HF_COM_KEY must be exactly 16 UTF-8 bytes");
      if (Buffer.byteLength(String(env.HF_COM_SECRET || ""), "utf8") !== 32) errors.push("HF_COM_SECRET must be exactly 32 UTF-8 bytes");
      const hfAppId = env.HF_WECHAT_APPID || env.WECHAT_APPID;
      if (!hfAppId) errors.push("HF_WECHAT_APPID or WECHAT_APPID is required when production withdrawal provider is configured");
      if (env.HF_TRANSFER_MODE && !["CONFIRM", "CONFIRM_AUTH", "AUTH"].includes(env.HF_TRANSFER_MODE)) errors.push("HF_TRANSFER_MODE must be CONFIRM, CONFIRM_AUTH or AUTH");
      if (env.HF_USER_RECV_TYPE && !["CONFIRM_PAGE", "RED_PACKET"].includes(env.HF_USER_RECV_TYPE)) errors.push("HF_USER_RECV_TYPE must be CONFIRM_PAGE or RED_PACKET");
      if (String(env.HF_CALLBACK_TOKEN || "").trim().length < 24) errors.push("HF_CALLBACK_TOKEN must be at least 24 characters when production withdrawal provider is configured");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = {
  validateRuntimeConfig,
  isPlaceholder
};
