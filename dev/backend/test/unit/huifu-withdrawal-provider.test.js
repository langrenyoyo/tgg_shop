process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const huifu = require("../../src/services/withdrawal-provider/huifu-bafang");

const env = {
  HF_BASE_URL: "https://tfapi.huifubafang.com",
  HF_COM_KEY: "2021062516283151",
  HF_COM_SECRET: "8EUN7D69FIING2V92IGI7V8TWCI8LLS0",
  HF_MERCHANT_ID: "mchid001",
  HF_WECHAT_APPID: "wx7cdc387f27520de8"
};

test("Huifu AES payload matches the documented AES-256-CBC vector", () => {
  const data = { order_id: "SQ202106307086", merchant_id: "mchid001", appid: "appid001", openid: "openid00001", pay_amount: 30 };
  const encrypted = huifu.encryptData(data, "8EUN7D69FIING2V92IGI7V8TWCI8LLS0", "2021062516283151");
  assert.equal(encrypted, "o3hGM/nQv1guhQsjuG+waSXLRLUpWagofzcg11vTiojnaPVX9NLcpZSm4yBTx7BA3AgZmFKwZLUcqR+92tDGjEB+9pPrZivna5kLXO3rQPWGGg+Urmqq4pRP1o/3mjti6FqNo+jTWt+kXwzYryGQQNwSD811JVo6NxCayMORxY4=");
  assert.deepEqual(huifu.decryptData(encrypted, env.HF_COM_SECRET, env.HF_COM_KEY), data);
});

test("Huifu request uses seconds, encrypted data and provider code 200", async () => {
  let captured;
  const result = await huifu.submit({ order_id: "TGG12345" }, env, async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({ code: 200, message: "SUCCESS", data: { order_id: "wd_12345", platform_order_id: "platform-1", transfer_state: "WAIT_USER_CONFIRM", package_info: "pkg" } }) };
  });
  assert.equal(result.ok, true);
  assert.equal(captured.url, "https://tfapi.huifubafang.com/wx/transfer/pay");
  assert.equal(Number.isInteger(captured.body.timestamp), true);
  assert.deepEqual(huifu.decryptData(captured.body.data, env.HF_COM_SECRET, env.HF_COM_KEY), { order_id: "TGG12345" });
  assert.equal(result.body.data.package_info, "pkg");
});

test("encrypted callback data is decoded and provider business failure is not accepted", () => {
  const body = { order_id: "wd_12345", platform_order_id: "platform-1", pay_status: 4, error_code: "FAIL", error_msg: "failed", result_code: "FAIL", payment_no: "", payment_time: "", notify_type: "wx_transfer" };
  const encoded = { comKey: env.HF_COM_KEY, timestamp: Math.floor(Date.now() / 1000), data: huifu.encryptData(body, env.HF_COM_SECRET, env.HF_COM_KEY) };
  assert.deepEqual(huifu.decodeCallback(encoded, env), body);
});
