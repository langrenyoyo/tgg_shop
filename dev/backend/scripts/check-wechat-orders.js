require('../src/config/env-file').loadEnv();
const { createOrderClient } = require('../src/integrations/wechat/order-client');
const client = createOrderClient();
(async () => {
  const report = { appId: client.appId(), configured: client.configured(), enabled: process.env.WECHAT_ORDER_MANAGEMENT_ENABLED === '1' };
  if (report.configured) {
    try { Object.assign(report, await client.managementStatus(), { checkedAt: new Date().toISOString() }); }
    catch (error) { report.errorCode = /^-?\d+$/.test(String(error.code)) ? error.code : 'provider_error'; process.exitCode = 1; }
  } else process.exitCode = 1;
  // This script never imports the business store or uploads shipping.
  console.log(JSON.stringify(report, null, 2));
})().catch(() => { console.error('WeChat order status check failed'); process.exitCode = 1; });
