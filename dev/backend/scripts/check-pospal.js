// Read-only provider checks. Never create orders or modify balances/stock.
const { loadEnv } = require("../src/config/env-file");
const { createPospalClient, isConfigured } = require("../src/integrations/pospal/pospal-client");

async function checkPospal(client, report = row => console.log(JSON.stringify(row))) {
  if (!isConfigured(client.config)) {
    report({ ok: false, code: "POSPAL_NOT_CONFIGURED", message: "请配置 POSPAL_APP_ID、POSPAL_APP_KEY、POSPAL_ACCOUNT" });
    return false;
  }
  const checks = [
    ["products", "queryProducts"], ["stores", "queryStores"],
    ["inventory", "queryInventory"], ["customers", "queryCustomers"],
    ["tickets", "queryTickets"], ["orders", "queryProductOrders"],
    ["paymentMethods", "queryPaymentMethods"]
  ];
  let ok = true;
  for (const [resource, method] of checks) {
    try {
      const response = await client[method]({ lastId: 0, limit: 1 });
      const rows = Array.isArray(response.result) ? response.result : response.result?.list;
      report({ resource, ok: true, count: Array.isArray(rows) ? rows.length : null, hasMore: Boolean(response.result?.hasMore) });
    } catch (error) {
      ok = false;
      report({ resource, ok: false, code: error.code, errorCode: error.errorCode,
        message: String(error.errorCode) === "4021" ? "银豹开放平台 Token 余额不足，请充值后重试" : "查询失败，请核对配置、接口权限和网络" });
      // An account-wide quota failure cannot be resolved by querying more resources.
      if (String(error.errorCode) === "4021" || error.code === "POSPAL_NETWORK_ERROR") break;
    }
  }
  return ok;
}

if (require.main === module) {
  loadEnv();
  checkPospal(createPospalClient()).then(ok => { process.exitCode = ok ? 0 : 1; });
}

module.exports = { checkPospal };
