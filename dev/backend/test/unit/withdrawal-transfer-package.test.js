const test = require("node:test");
const assert = require("node:assert/strict");
const account = require("../../src/services/account-service");

test("transfer package is available only to its owner while withdrawal is processing", () => {
  const previous = process.env.HF_WECHAT_MCH_ID;
  process.env.HF_WECHAT_MCH_ID = "1900000001";
  try {
    const row = { id: "wd-1", userId: "user-1", status: "processing", transferPackage: "provider-package", transferState: "WAIT_USER_CONFIRM" };
    const state = { withdrawRequests: [row] };
    assert.deepEqual(account.getWithdrawalTransferPackage(state, "user-1", "wd-1"), {
      id: "wd-1", package: "provider-package", mchId: "1900000001", transferState: "WAIT_USER_CONFIRM"
    });
    assert.equal(account.getWithdrawalTransferPackage(state, "user-2", "wd-1"), null);
    row.status = "success";
    assert.equal(account.getWithdrawalTransferPackage(state, "user-1", "wd-1"), null);
  } finally {
    if (previous === undefined) delete process.env.HF_WECHAT_MCH_ID;
    else process.env.HF_WECHAT_MCH_ID = previous;
  }
});
