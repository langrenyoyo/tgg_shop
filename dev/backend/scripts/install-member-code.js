// Apply the membership endpoint without replacing unrelated deployed routes.
// Usage: node install-member-code.js /www/wwwroot/tgg_shop/dev/backend
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const backend = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const routePath = path.join(backend, "src/routes/auth-routes.js");
const servicePath = path.join(backend, "src/services/member-code-service.js");
const bundledService = path.join(__dirname, "member-code-service.js");
const sourceService = fs.existsSync(bundledService) ? bundledService : path.join(__dirname, "../src/services/member-code-service.js");
const source = fs.readFileSync(routePath, "utf8");
const endpoint = '"/api/me/member-code"';
if (source.includes(endpoint)) {
  if (!fs.existsSync(servicePath)) throw new Error("Route exists but service missing; inspect deployment before retrying");
  console.log("Endpoint already exists. Restart the service if it is still running the previous code.");
  process.exit(0);
}
const anchor = '  if (req.method === "GET" && url.pathname === "/api/me")';
if (!source.includes(anchor) || source.includes("getMemberCode")) throw new Error("Unrecognized route version; no files changed");
const route = 'const { getMemberCode } = require("../services/member-code-service");\n' + source.replace(anchor,
  '  if (req.method === "GET" && url.pathname === "/api/me/member-code") {\n' +
  '    const result = getMemberCode(state, user);\n' +
  '    return send(ctx.res, result.status, result.body, { "Cache-Control": "no-store" });\n' +
  '  }\n\n' + anchor);
const service = fs.readFileSync(sourceService, "utf8");
const temporary = routePath + ".member-code-check.js";
fs.writeFileSync(temporary, route, { flag: "wx" });
try {
  execFileSync(process.execPath, ["--check", temporary]);
  execFileSync(process.execPath, ["--check", sourceService]);
  const stamp = Date.now();
  const backup = routePath + ".backup-" + stamp;
  fs.copyFileSync(routePath, backup, fs.constants.COPYFILE_EXCL);
  if (fs.existsSync(servicePath)) fs.copyFileSync(servicePath, servicePath + ".backup-" + stamp, fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(servicePath, service);
  fs.writeFileSync(routePath, route);
  console.log("Installed member-code endpoint. Route backup: " + backup);
  console.log("Restart tgg-shop, then verify /api/health and the authenticated /api/me/member-code endpoint.");
} finally { fs.unlinkSync(temporary); }
