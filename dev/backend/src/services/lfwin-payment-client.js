const crypto = require("crypto");

const DEFAULT_BASE_URL = "https://api2uat.lfwin.com";
const SUCCESS_STATUS = "10000";

function createLfwinClient(options = {}) {
  const config = normalizeConfig(options.config || readConfig(process.env));
  const request = options.request || requestForm;

  return {
    isConfigured: () => Boolean(config.apiKey && (config.signType === "RSA" ? config.privateKey : config.signKey)),
    createPayment: (input) => createPayment(config, request, input),
    queryPayment: (input) => queryPayment(config, request, input),
    closePayment: (input) => closePayment(config, request, input),
    refundPayment: (input) => refundPayment(config, request, input),
    queryRefund: (input) => queryRefund(config, request, input),
    verifyNotification: (payload) => verifyPayload(config, payload)
  };
}

function readConfig(env) {
  return {
    baseUrl: env.LFWIN_BASE_URL || DEFAULT_BASE_URL,
    apiKey: env.LFWIN_API_KEY || "",
    signKey: env.LFWIN_SIGN_KEY || "",
    signType: env.LFWIN_SIGN_TYPE || "RSA",
    privateKey: env.LFWIN_RSA_PRIVATE_KEY || "",
    publicKey: env.LFWIN_RSA_PUBLIC_KEY || "",
    timeoutMs: env.LFWIN_TIMEOUT_MS || 10000
  };
}

function normalizeConfig(config) {
  const baseUrl = String(config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  if (!baseUrl.startsWith("https://")) throw new Error("LFWIN_BASE_URL must use HTTPS");
  const signType = String(config.signType || "RSA").toUpperCase();
  if (!["MD5", "RSA"].includes(signType)) throw new Error("LFWIN_SIGN_TYPE must be MD5 or RSA");
  return {
    baseUrl,
    apiKey: String(config.apiKey || ""),
    signKey: String(config.signKey || ""),
    signType,
    privateKey: String(config.privateKey || "").replace(/\\n/g, "\n"),
    publicKey: String(config.publicKey || "").replace(/\\n/g, "\n"),
    timeoutMs: Math.max(1000, Number(config.timeoutMs || 10000))
  };
}

async function createPayment(config, request, input = {}) {
  const method = input.method || "qrcode";
  const methods = {
    qrcode: { path: "/payapi/pay/qrcode", service: "wxpay.comm.qrcode" },
    wechat_qrcode: { path: "/payapi/pay/qrcode", service: "wxpay.comm.qrcode" },
    alipay_qrcode: { path: "/payapi/pay/qrcode", service: "alipay.comm.qrcode" },
    h5: { path: "/payapi/trade/h5", service: "pay.comm.h5" },
    wechat_mini: { path: "/payapi/mini/wxpay", service: "comm.mini.pay" },
    alipay_mini: { path: "/payapi/trade/alipay", service: "comm.mini.pay" }
  };
  const target = methods[method];
  if (!target) throw new Error("Unsupported LFWin payment method");
  assertHttpsUrl(input.notifyUrl, "LFWin payment notification URL");
  assertPlatformFields(method, input);

  const payload = {
    service: input.service || target.service,
    apikey: config.apiKey,
    money: formatMoney(input.amount),
    nonce_str: input.nonce || createNonce(),
    mch_orderid: input.merchantOrderNo,
    notify_url: input.notifyUrl,
    attach: input.attach,
    remarks: input.description,
    good_name: input.description,
    time_expire: input.expireAt ? toUnixSeconds(input.expireAt) : undefined,
    ...platformFields(method, input)
  };
  return call(config, request, target.path, payload);
}

async function queryPayment(config, request, input = {}) {
  return call(config, request, "/payapi/pay/query_order", {
    service: "pay.comm.query_order",
    apikey: config.apiKey,
    nonce_str: input.nonce || createNonce(),
    orderid: input.providerOrderNo,
    mch_orderid: input.merchantOrderNo,
    order_time: input.orderTime ? toUnixSeconds(input.orderTime) : undefined
  });
}

async function closePayment(config, request, input = {}) {
  return call(config, request, "/payapi/pay/close_order", {
    service: "pay.comm.close_order",
    apikey: config.apiKey,
    nonce_str: input.nonce || createNonce(),
    orderid: input.providerOrderNo,
    mch_orderid: input.merchantOrderNo,
    order_time: input.orderTime ? toUnixSeconds(input.orderTime) : undefined
  });
}

async function refundPayment(config, request, input = {}) {
  assertHttpsUrl(input.notifyUrl, "LFWin refund notification URL");
  return call(config, request, "/payapi/pay/refund_order", {
    service: "pay.comm.refund_order",
    version: "4.0",
    apikey: config.apiKey,
    nonce_str: input.nonce || createNonce(),
    orderid: input.providerOrderNo,
    mch_orderid: input.merchantOrderNo,
    order_time: input.orderTime ? toUnixSeconds(input.orderTime) : undefined,
    refundmoney: formatMoney(input.amount),
    mch_refund_no: input.merchantRefundNo,
    reason: input.reason,
    notify_url: input.notifyUrl
  });
}

async function queryRefund(config, request, input = {}) {
  return call(config, request, "/payapi/pay/query_refund", {
    service: "pay.comm.query_refund",
    version: "4.0",
    apikey: config.apiKey,
    nonce_str: input.nonce || createNonce(),
    orderid: input.providerOrderNo,
    mch_orderid: input.merchantOrderNo,
    order_time: input.orderTime ? toUnixSeconds(input.orderTime) : undefined,
    refund_no: input.providerRefundNo,
    mch_refund_no: input.merchantRefundNo
  });
}

async function call(config, request, path, payload) {
  ensureConfigured(config);
  const signed = signPayload(config, payload);
  const response = await request(`${config.baseUrl}${path}`, signed, config.timeoutMs);
  if (!response || String(response.status) !== SUCCESS_STATUS) {
    const error = new Error(response?.message || "LFWin request failed");
    error.providerResponse = response;
    throw error;
  }
  if (!response.sign || !verifyPayload(config, response)) throw new Error("LFWin response signature verification failed");
  return response;
}

function signPayload(config, payload) {
  const fields = compact(payload);
  fields.sign_type = config.signType === "RSA" ? "rsa" : "MD5";
  fields.sign = sign(config, fields);
  return fields;
}

function verifyPayload(config, payload) {
  const fields = incomingFields(payload);
  const received = fields.sign;
  delete fields.sign;
  if (!received) return false;
  const type = String(fields.sign_type || config.signType).toUpperCase();
  if (type === "RSA") {
    if (!config.publicKey) return false;
    return crypto.verify("RSA-SHA256", Buffer.from(canonicalize(fields), "utf8"), config.publicKey, Buffer.from(received, "base64"));
  }
  if (!config.signKey) return false;
  const expected = Buffer.from(md5(`${canonicalize(fields)}&signkey=${config.signKey}`));
  const actual = Buffer.from(String(received).toLowerCase());
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function sign(config, fields) {
  const content = canonicalize(fields);
  if (config.signType === "RSA") return crypto.sign("RSA-SHA256", Buffer.from(content, "utf8"), config.privateKey).toString("base64");
  return md5(`${content}&signkey=${config.signKey}`);
}

function canonicalize(payload) {
  return Object.keys(payload)
    .filter((key) => key !== "sign" && payload[key] !== undefined && payload[key] !== null)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join("&");
}

async function requestForm(url, fields, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      signal: controller.signal
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`LFWin returned non-JSON response (${response.status})`); }
    if (!response.ok) throw new Error(body.message || `LFWin HTTP ${response.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function platformFields(method, input) {
  if (method === "wechat_mini") return { sub_appid: input.appId, sub_openid: input.openId };
  if (method === "alipay_mini") return { buyer_id: input.buyerId, buyer_open_id: input.buyerOpenId, sub_appid: input.appId };
  return {};
}

function assertPlatformFields(method, input) {
  if (method === "wechat_mini" && (!input.appId || !input.openId)) throw new Error("WeChat mini-program payments require appId and openId");
  if (method === "alipay_mini" && (!input.buyerId && !input.buyerOpenId)) throw new Error("Alipay mini-program payments require buyerId or buyerOpenId");
}

function assertHttpsUrl(value, name) {
  if (!value || !String(value).startsWith("https://")) throw new Error(`${name} must use HTTPS`);
}

function ensureConfigured(config) {
  if (!config.apiKey) throw new Error("LFWin API key is not configured");
  if (config.signType === "RSA" && !config.privateKey) throw new Error("LFWin RSA private key is not configured");
  if (config.signType === "MD5" && !config.signKey) throw new Error("LFWin signing key is not configured");
}

function compact(input) {
  return Object.fromEntries(Object.entries(input || {}).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function incomingFields(input) {
  return Object.fromEntries(Object.entries(input || {}).filter(([, value]) => value !== undefined && value !== null));
}

function createNonce() { return crypto.randomBytes(16).toString("hex"); }
function md5(value) { return crypto.createHash("md5").update(value, "utf8").digest("hex"); }
function formatMoney(value) { return (Math.round(Number(value || 0) * 100) / 100).toFixed(2); }
function toUnixSeconds(value) { return Math.floor(new Date(value).getTime() / 1000); }

module.exports = { createLfwinClient, canonicalize, signPayload, verifyPayload, formatMoney };
