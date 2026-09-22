const test = require("node:test");
const assert = require("node:assert/strict");
process.env.TGG_STORE_MODE = "memory";
const { resetState } = require("../../src/data/store");
const auth = require("../../src/services/auth-service");

test("station WeChat authorization only logs in a bound active station account", async (t) => {
  const previous = { appid: process.env.WECHAT_APPID, secret: process.env.WECHAT_APPSECRET, fetch: global.fetch };
  t.after(() => {
    if (previous.appid === undefined) delete process.env.WECHAT_APPID; else process.env.WECHAT_APPID = previous.appid;
    if (previous.secret === undefined) delete process.env.WECHAT_APPSECRET; else process.env.WECHAT_APPSECRET = previous.secret;
    global.fetch = previous.fetch;
  });
  process.env.WECHAT_APPID = "test-app";
  process.env.WECHAT_APPSECRET = "test-secret";
  global.fetch = async () => ({ json: async () => ({ openid: "station-openid-1" }) });
  const state = resetState();
  const account = state.stationAccounts[0];
  account.wechatOpenid = "station-openid-1";
  const login = await auth.stationWechatLogin(state, { code: "wx-code" });
  assert.equal(login.ok, true);
  assert.equal(login.station.id, account.id);
  assert.match(login.token, /^ey/);

  account.status = "disabled";
  const disabled = await auth.stationWechatLogin(state, { code: "wx-code" });
  assert.equal(disabled.status, 403);
  account.status = "active";
  account.wechatOpenid = "";
  const unbound = await auth.stationWechatLogin(state, { code: "wx-code" });
  assert.equal(unbound.status, 403);
});

test("station password session can bind one WeChat identity once", async (t) => {
  const previous = { appid: process.env.WECHAT_APPID, secret: process.env.WECHAT_APPSECRET, fetch: global.fetch };
  t.after(() => {
    if (previous.appid === undefined) delete process.env.WECHAT_APPID; else process.env.WECHAT_APPID = previous.appid;
    if (previous.secret === undefined) delete process.env.WECHAT_APPSECRET; else process.env.WECHAT_APPSECRET = previous.secret;
    global.fetch = previous.fetch;
  });
  process.env.WECHAT_APPID = "test-app";
  process.env.WECHAT_APPSECRET = "test-secret";
  global.fetch = async () => ({ json: async () => ({ openid: "station-openid-bind" }) });
  const state = resetState();
  const account = state.stationAccounts[0];
  const bound = await auth.bindStationWechat(state, account, { code: "wx-code" });
  assert.equal(bound.ok, true);
  assert.equal(account.wechatOpenid, "station-openid-bind");
  const repeated = await auth.bindStationWechat(state, account, { code: "wx-code-2" });
  assert.equal(repeated.ok, true);

  const other = { ...state.stationAccounts[0], id: "station_002", username: "station002", wechatOpenid: "" };
  state.stationAccounts.push(other);
  const conflict = await auth.bindStationWechat(state, other, { code: "wx-code-3" });
  assert.equal(conflict.status, 409);
});
