const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateRuntimeConfig } = require("../../src/config/runtime-config");
const { loadEnv, readEnvFile } = require("../../src/config/env-file");

const valid = {
  NODE_ENV: "production", TGG_STORE_DRIVER: "pg", TGG_PG_URL: "postgres://user:pwd@db.internal/tgg",
  TGG_AUTH_SECRET: "a".repeat(64), TGG_TASK_CALLBACK_TOKEN: "b".repeat(64),
  TGG_TASK_PLATFORM_BASE_URL: "https://tasks.vendor.com", TGG_TASK_PLATFORM_APPID: "1234", TGG_TASK_PLATFORM_KEY: "c".repeat(32),
  WECHAT_APPID: "wx7cdc387f27520de8", WECHAT_APPSECRET: "d".repeat(32),
  LFWIN_BASE_URL: "https://pay.vendor.com", LFWIN_API_KEY: "merchant-key", LFWIN_SIGN_TYPE: "MD5", LFWIN_SIGN_KEY: "e".repeat(32),
  LFWIN_NOTIFY_URL: "https://shop.taoguoguo.cc/api/payment-providers/lfwin/notify",
  LFWIN_REFUND_NOTIFY_URL: "https://shop.taoguoguo.cc/api/payment/lfwin/refund-notify"
};

test("production requires real storage, authentication and payment configuration", () => {
  assert.deepEqual(validateRuntimeConfig(valid).errors, []);
  for (const key of ["TGG_AUTH_SECRET", "TGG_TASK_CALLBACK_TOKEN", "TGG_TASK_PLATFORM_KEY", "WECHAT_APPSECRET", "LFWIN_API_KEY", "LFWIN_SIGN_KEY"]) {
    for (const value of ["", "replace-with-at-least-24-random-characters"]) {
      assert.equal(validateRuntimeConfig({ ...valid, [key]: value }).ok, false, key);
    }
  }
  for (const overrides of [
    { TGG_STORE_DRIVER: "json" }, { TGG_PG_URL: "https://db.internal/tgg" }, { TGG_PG_URL: "" },
    { LFWIN_BASE_URL: "https://api2uat.lfwin.com" }, { LFWIN_NOTIFY_URL: "https://user:secret@pay.vendor.com" },
    { LFWIN_REFUND_NOTIFY_URL: "https://" }, { LFWIN_SIGN_TYPE: "unknown" }, { WECHAT_APPID: "wx-your-appid" },
    { HF_BASE_URL: "https://withdraw.vendor.com" }, { LFWIN_TIMEOUT_MS: "NaN" }
  ]) assert.equal(validateRuntimeConfig({ ...valid, ...overrides }).ok, false);
  assert.equal(validateRuntimeConfig({}, false).ok, true);
});

test("RSA production setup requires both signing and verification PEMs without exposing their contents", () => {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const rsa = { ...valid, LFWIN_SIGN_TYPE: "RSA", LFWIN_RSA_PRIVATE_KEY: pair.privateKey.replace(/\n/g, "\\n"), LFWIN_RSA_PUBLIC_KEY: pair.publicKey.replace(/\n/g, "\\n") };
  assert.equal(validateRuntimeConfig(rsa).ok, true);
  const report = validateRuntimeConfig({ ...rsa, LFWIN_RSA_PUBLIC_KEY: "sensitive-broken-pem" });
  assert.equal(report.ok, false);
  assert.ok(!JSON.stringify(report).includes("sensitive-broken-pem"));
});

test("explicit environment files preserve process overrides and missing explicit files fail", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-env-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, ".env");
  fs.writeFileSync(file, '# comment\nKEY="file-value"\nOTHER=other-value\nPEM="line1\\nline2"\n');
  const env = { TGG_ENV_FILE: file, KEY: "process-value" };
  loadEnv(env);
  assert.equal(env.KEY, "process-value");
  assert.equal(env.OTHER, "other-value");
  assert.equal(env.PEM, "line1\\nline2");
  assert.throws(() => loadEnv({ TGG_ENV_FILE: path.join(root, "missing") }), /ENOENT/);
});

test("production initialization generates distinct secrets once and never prints or overwrites them", t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-config-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const backend = path.join(temp, "dev/backend");
  for (const file of ["scripts/production-config.js", "src/config/env-file.js", "src/config/runtime-config.js", ".env.example"]) {
    const target = path.join(backend, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, "../..", file), target);
  }
  const mini = path.join(temp, "wechat-miniprogram");
  fs.mkdirSync(path.join(mini, "config"), { recursive: true });
  fs.writeFileSync(path.join(mini, "project.config.json"), JSON.stringify({ appid: valid.WECHAT_APPID }));
  fs.writeFileSync(path.join(mini, "config/environments.js"), 'module.exports = ' + JSON.stringify({ release: "https://shop.taoguoguo.cc" }) + ';\n');
  fs.writeFileSync(path.join(backend, ".env"), "LFWIN_BASE_URL=https://api2uat.lfwin.com\nTGG_TASK_PLATFORM_KEY=private-provider-key\n");
  const args = [path.join(backend, "scripts/production-config.js"), "--init"];
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const file = path.join(backend, ".env.production");
  const before = fs.readFileSync(file, "utf8");
  const env = readEnvFile(file);
  const secrets = [env.TGG_AUTH_SECRET, env.TGG_TASK_CALLBACK_TOKEN, env.HF_CALLBACK_TOKEN];
  assert.equal(new Set(secrets).size, 3);
  for (const secret of [...secrets, env.TGG_TASK_PLATFORM_KEY]) {
    assert.ok(!result.stdout.includes(secret));
    assert.ok(!result.stderr.includes(secret));
  }
  for (const secret of secrets) assert.match(secret, /^[a-f0-9]{64}$/);
  assert.equal(env.LFWIN_BASE_URL, "https://api2.lfwin.com");
  assert.equal(env.WECHAT_APPID, valid.WECHAT_APPID);
  assert.equal(env.LFWIN_NOTIFY_URL, valid.LFWIN_NOTIFY_URL);
  assert.equal(spawnSync(process.execPath, args).status, 1);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});
