// Build a reviewable inventory from saved, sanitized audit evidence.
const fs = require("node:fs");
const path = require("node:path");
const artifacts = path.join(__dirname, "artifacts");
const comparison = require("./artifacts/server-comparison-2026-10-13.json");
const publicChecks = require("./artifacts/server-public-2026-10-13.json").checks;
const http = fs.readFileSync(path.join(artifacts, "server-http-2026-10-13.jsonl"), "utf8").trim().split(/\r?\n/).map(JSON.parse);
const extra = [
  ["PUT", "/api/addresses/{addressId}", "更新收货地址（PATCH 同处理分支）"],
  ["GET", "/api/admin/admin-users", "管理员账号列表"],
  ["POST", "/api/admin/admin-users", "创建管理员"],
  ["PATCH", "/api/admin/admin-users/{adminId}", "编辑管理员"],
  ["DELETE", "/api/admin/admin-users/{adminId}", "删除管理员"],
  ["POST", "/api/admin/admin-users/{adminId}/reset-password", "重置管理员密码"],
  ["POST", "/api/admin/roles", "创建角色"],
  ["GET", "/api/admin/ranking", "后台月榜"],
  ["GET", "/api/withdrawals/{withdrawalId}", "用户提现详情"],
  ["POST", "/api/admin/withdrawals/{withdrawalId}/query-provider", "查询提现服务商并同步状态"]
].map(([method, endpoint, summary]) => ({ method, path: endpoint, summary, extra: true }));
const ops = [...comparison.serverOperations, ...extra];
const local = new Map(comparison.localOperations.map(o => [o.method + " " + o.path, o]));
function evidence(op) {
  const records = http.filter(r => r.endpoint === op.path);
  if (op.method === "POST" && /auth\/login$/.test(op.path) && op.path.startsWith("/api/admin/")) return "线上登录 200；会话已撤销";
  if (op.method === "POST" && op.path === "/api/admin/auth/logout") return "线上退出 200；旧 Token 401";
  if (op.method === "POST" && records.some(r => r.name === "disabled-callback-guard")) return "线上缺少回调配置，503";
  if (op.method !== "GET") return "未在真实数据执行；按模块隔离测试/待外部验收";
  if (records.some(r => r.name === "admin-http" && r.status === 200)) return "线上管理员查询 200；不代表数据/写入规则全部正确";
  const p = publicChecks.find(r => r.endpoint === op.path && r.kind === "api");
  if (p?.status === 200) return "线上匿名读取 200";
  if (op.path === "/api/products/{productId}") return "线上全部 8 个商品详情 200，缺失商品 404";
  if (op.path === "/api/tasks/{taskId}") return "线上抽查 1 个真实任务详情 200";
  return "线上匿名访问 401；授权业务读取未单独线上执行";
}
function delta(op) {
  if (op.path.startsWith("/api/signin/")) return "服务器仍启用；本地鉴权后返回 410";
  if (["/api/config", "/api/home", "/api/admin/config"].includes(op.path)) return "本地过滤广告字段/入口，拒绝旧广告配置";
  if (op.extra) return "两端实现存在，OpenAPI 均漏列";
  const other = local.get(op.method + " " + op.path);
  return other ? "接口契约相同；具体模块差异见主报告" : "本地文档未列";
}
function cell(s) { return String(s).replaceAll("|", "\\|").replaceAll("\n", " "); }
const lines = ["# 服务器接口与文件差异明细", "", "日期：2026-10-13。由保存的脱敏实测结果生成；与《服务器全功能测试与本地差异_2026-10-13.md》配套。", "", "## 接口清单", "", `OpenAPI 列出 ${comparison.serverOperations.length} 个方法与路径组合，路由审阅另补 ${extra.length} 项，共 ${ops.length} 项。参数化 action（打印等）按一个路由模板计数。此数不等于业务功能数量，也不声称对任意运行时组合穷尽证明。`, "", "未在真实数据执行的写入接口统一保留待验收状态，不能因同模块单元测试通过就视为该线上接口通过。匿名 401 只验证鉴权保护。", "", "| 方法 | 路径 | 功能 | 本次线上证据 | 本地差异 |", "|---|---|---|---|---|"];
for (const op of ops.sort((a,b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))) lines.push(`| ${op.method} | \`${op.path}\` | ${cell(op.summary)} | ${cell(evidence(op))} | ${cell(delta(op))} |`);
lines.push("", "## 内容差异文件", "", "以下只比对 Git 跟踪文件；JSON 中保留双方 SHA256。未下载或比较客户数据、上传素材、数据库及私密环境文件内容。换行差异单独计数。", "", "| 路径 | 差异 |", "|---|---|");
for (const d of comparison.differences) lines.push(`| \`${d.path}\` | ${{ changed: "两端内容不同", "server-only": "服务器存在、本地最新已删除", "local-only": "本地新增、服务器不存在" }[d.kind]} |`);
lines.push("", "## 小程序页面", "", "页面清单来自两端源码的 app.json，不代表微信线上发布包已同步。", "", "| 页面 | 服务器源码 | 本地源码 |", "|---|---|---|");
for (const p of [...new Set([...comparison.serverMiniPages, ...comparison.localMiniPages])].sort()) lines.push(`| \`${p}\` | ${comparison.serverMiniPages.includes(p) ? "存在" : "无"} | ${comparison.localMiniPages.includes(p) ? "存在" : "已删除"} |`);
fs.writeFileSync(path.resolve(__dirname, "../../../../服务器接口与文件差异明细_2026-10-13.md"), lines.join("\n") + "\n");
console.log(JSON.stringify({ inventoriedOperations: ops.length, differingFiles: comparison.differences.length }));
