// Explicit, read-only provider probe. Never registers tasks or queries user reviews.
const fs = require("node:fs");
const path = require("node:path");
const client = require("../src/services/task-platform-client");

const envFile = path.resolve(__dirname, "../.env");
if (process.env.TGG_LOAD_DOTENV !== "0" && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!(key in process.env)) process.env[key] = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

(async () => {
  if (!client.isConfigured()) throw new Error("任务平台配置不完整");
  const report = { checkedAt: new Date().toISOString(), readOnly: true };
  const types = await client.post("index/index/task_type");
  if (!Array.isArray(types)) throw new Error("任务分类返回格式不是数组");
  report.categoryCount = types.length;
  const rows = await client.post("index/index/task_list", { page: 1, count: 10 });
  if (!Array.isArray(rows)) throw new Error("任务列表返回格式不是数组");
  report.firstPageCount = rows.length;
  if (rows.length) {
    if (rows[0]?.id == null) throw new Error("任务列表缺少任务 ID");
    const detail = await client.post("index/index/task_info", { id: rows[0].id });
    if (!detail || typeof detail !== "object" || Array.isArray(detail) || String(detail.id) !== String(rows[0].id)) throw new Error("任务详情未返回匹配的任务 ID");
    const normalized = client.normalizeTaskDetail(detail);
    report.detailChecked = true;
    report.requiredFields = normalized.submitFields;
    report.rewardValid = Number.isSafeInteger(normalized.rewardPoints) && normalized.rewardPoints >= 0;
    report.stepCount = normalized.content.length;
    report.rawImageStepCount = detail.content.filter(block => block && (block.img || block.img_list?.length)).length;
    report.normalizedImageCount = normalized.content.reduce((total, block) => total + block.img_list.length, 0);
  } else report.detailChecked = false;
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
})().catch(error => {
  // Never print provider response bodies, URLs with credentials or request data.
  process.stderr.write(JSON.stringify({ ok: false, message: error.message, status: error.status || null }) + "\n");
  process.exitCode = 1;
});
