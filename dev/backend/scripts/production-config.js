// Offline configuration preparation/check only: no database or provider requests.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readEnvFile } = require("../src/config/env-file");
const { validateRuntimeConfig, isPlaceholder } = require("../src/config/runtime-config");

const root = path.resolve(__dirname, "..");
const miniRoot = path.resolve(root, "../../wechat-miniprogram");
const target = path.join(root, ".env.production");

function initialize() {
  if (fs.existsSync(target)) throw new Error(".env.production already exists; existing credentials were preserved");
  const templateFile = path.join(root, ".env.example");
  const values = readEnvFile(templateFile);
  const localFile = path.join(root, ".env");
  const local = fs.existsSync(localFile) ? readEnvFile(localFile) : {};
  for (const key of Object.keys(values)) {
    if (key === "LFWIN_BASE_URL" && /uat|sandbox/i.test(local[key] || "")) continue;
    if (/^(TGG_TASK_PLATFORM_|WECHAT_|LFWIN_|HF_)/.test(key) && local[key] && !isPlaceholder(local[key])) values[key] = local[key];
  }
  for (const key of ["TGG_AUTH_SECRET", "TGG_TASK_CALLBACK_TOKEN", "HF_CALLBACK_TOKEN"]) values[key] = crypto.randomBytes(32).toString("hex");
  values.WECHAT_APPID ||= JSON.parse(fs.readFileSync(path.join(miniRoot, "project.config.json"), "utf8")).appid;
  const hosts = require(path.join(miniRoot, "config/environments.js"));
  values.LFWIN_NOTIFY_URL = hosts.release ? hosts.release + "/api/payment-providers/lfwin/notify" : "";
  values.LFWIN_REFUND_NOTIFY_URL = hosts.release ? hosts.release + "/api/payment/lfwin/refund-notify" : "";
  values.HF_CALLBACK_URL = hosts.release ? `${hosts.release}/api/providers/huifu/withdraw-callback?token=${values.HF_CALLBACK_TOKEN}` : "";
  const output = fs.readFileSync(templateFile, "utf8").replace(/^([A-Z][A-Z0-9_]*)=.*$/gm, (_, key) => `${key}=${values[key]}`);
  fs.writeFileSync(target, output, { flag: "wx", mode: 0o600 });
  console.log("Created ignored dev/backend/.env.production; generated three independent secrets and copied existing provider settings for verification. No values printed.");
}

function check() {
  const file = path.resolve(root, process.env.TGG_ENV_FILE || ".env.production");
  const env = { ...(fs.existsSync(file) ? readEnvFile(file) : {}), ...process.env };
  const report = validateRuntimeConfig(env, true);
  if (env.NODE_ENV !== "production") report.errors.push("NODE_ENV must be production");
  const project = JSON.parse(fs.readFileSync(path.join(miniRoot, "project.config.json"), "utf8"));
  const privateFile = path.join(miniRoot, "project.private.config.json");
  const privateConfig = fs.existsSync(privateFile) ? JSON.parse(fs.readFileSync(privateFile, "utf8")) : {};
  if (project.setting?.urlCheck !== true) report.errors.push("Enable mini-program urlCheck in project.config.json");
  if (env.WECHAT_APPID !== project.appid) report.errors.push("WECHAT_APPID must match mini-program project.config.json appid");
  const hosts = require(path.join(miniRoot, "config/environments.js"));
  for (const mode of ["trial", "release"]) {
    try {
      const url = new URL(hosts[mode]);
      if (url.protocol !== "https:" || url.origin !== hosts[mode] || /\.example$|\.invalid$/.test(url.hostname)) throw new Error();
    } catch { report.errors.push(`Mini-program ${mode} API must be an explicit HTTPS origin in config/environments.js`); }
  }
  for (const [key, endpoint] of [["LFWIN_NOTIFY_URL", "/api/payment-providers/lfwin/notify"], ["LFWIN_REFUND_NOTIFY_URL", "/api/payment/lfwin/refund-notify"]]) {
    if (hosts.release && env[key] !== hosts.release + endpoint) report.errors.push(`${key} must match the release API origin and callback route`);
  }
  report.ok = report.errors.length === 0;
  report.scope = "Offline configuration only; credentials, connectivity and business acceptance are not verified";
  report.remainingAcceptance = ["WeChat real-device login/payment", "Task submission/review/callback points", "Production cash refunds are still disabled", "Production ad rewards are still disabled", "Provider reconciliation and database recovery"];
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

try {
  if (process.argv[2] === "--init") initialize();
  else if (process.argv[2] === "--check") check();
  else throw new Error("Use --init or --check");
} catch (error) {
  console.error(error.code ? "Configuration file could not be read or written" : "Configuration command failed; check arguments and file format");
  process.exitCode = 1;
}
