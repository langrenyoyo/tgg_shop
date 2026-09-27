const crypto = require("node:crypto");

const DEFAULT_BASE_URL = "https://platform.pospal.cn";

class PospalApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PospalApiError";
    Object.assign(this, details);
  }
}

function md5(value) {
  return crypto.createHash("md5").update(String(value), "utf8").digest("hex").toUpperCase();
}

function createRequestId() {
  return crypto.randomUUID();
}

function readConfig(env = process.env) {
  return {
    baseUrl: String(env.POSPAL_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    appId: String(env.POSPAL_APP_ID || "").trim(),
    appKey: String(env.POSPAL_APP_KEY || "").trim(),
    account: String(env.POSPAL_ACCOUNT || "").trim(),
    timeoutMs: Math.min(60000, Math.max(1000, Number(env.POSPAL_TIMEOUT_MS || 10000)))
  };
}

function isConfigured(config) {
  return Boolean(config?.baseUrl && config.appId && config.appKey && config.account);
}

function createPospalClient(options = {}) {
  const config = { ...readConfig(options.env || process.env), ...(options.config || {}) };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("POSPAL integration requires a fetch implementation");

  async function request(path, body = {}, requestOptions = {}) {
    if (!config.appId || !config.appKey) throw new PospalApiError("POSPAL credentials are not configured", { code: "POSPAL_NOT_CONFIGURED" });
    const requestId = requestOptions.requestId || createRequestId();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sign = md5(`${config.appId}|${requestId}|${timestamp}|${config.appKey}`);
    const payload = { account: config.account, ...body };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestOptions.timeoutMs || config.timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json;charset=UTF-8",
          "X-App-Id": config.appId,
          "X-Timestamp": timestamp,
          "X-Request-Id": requestId,
          "X-Sign": sign
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      throw new PospalApiError(`POSPAL request failed: ${error.message}`, { code: "POSPAL_NETWORK_ERROR", cause: error, requestId, path });
    } finally {
      clearTimeout(timeout);
    }

    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new PospalApiError("POSPAL returned invalid JSON", { code: "POSPAL_INVALID_RESPONSE", httpStatus: response.status, requestId, path, cause: error });
    }
    if (!response.ok || result?.status !== "success") {
      throw new PospalApiError(result?.messages?.join(" | ") || `POSPAL returned HTTP ${response.status}`, {
        code: "POSPAL_API_ERROR",
        errorCode: result?.errorCode,
        httpStatus: response.status,
        messages: result?.messages || [],
        requestId,
        path,
        response: result
      });
    }
    return { ...result, requestId };
  }

  return {
    config,
    request,
    queryStores: body => request("/openapi/v3/user/page", body),
    queryProducts: body => request("/openapi/v3/product/increment-page", body),
    createProduct: body => request("/openapi/v3/product/create", body),
    updateProduct: body => request("/openapi/v3/product/update", body),
    queryInventory: body => request("/openapi/v3/product/stock-page", body),
    setInventory: body => request("/openapi/v3/product/stock-batch-set", body),
    adjustInventory: body => request("/openapi/v3/product/stock-batch-adjust", body),
    queryCustomers: body => request("/openapi/v3/customer/increment-page", body),
    addCustomer: body => request("/openapi/v3/customer/add", body),
    updateCustomer: body => request("/openapi/v3/customer/update", body),
    adjustCustomerBalancePoint: body => request("/openapi/v3/customer/balance-point/adjust", body),
    queryTickets: body => request("/openapi/v3/ticket/increment-page", body),
    createProductOrder: body => request("/openapi/v3/product-order/create", body),
    queryProductOrders: body => request("/openapi/v3/product-order/increment-page", body),
    refundProductOrder: body => request("/openapi/v3/product-order/refund/apply", body),
    queryPaymentMethods: body => request("/openapi/v3/pay-method/my", body)
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  PospalApiError,
  md5,
  readConfig,
  isConfigured,
  createPospalClient
};
