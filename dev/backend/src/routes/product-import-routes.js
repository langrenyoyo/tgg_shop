const admin = require("../services/admin-service");
const service = require("../services/product-import-service");

async function readWorkbook(req) {
  if (Number(req.headers["content-length"]) > service.MAX_BYTES) {
    req.resume?.();
    throw Object.assign(new Error("导入文件不能超过 2 MB"), { status: 413 });
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= service.MAX_BYTES) chunks.push(Buffer.from(chunk));
  }
  if (size > service.MAX_BYTES) throw Object.assign(new Error("导入文件不能超过 2 MB"), { status: 413 });
  return Buffer.concat(chunks);
}

async function handleProductImportRoutes(ctx) {
  const { req, url, state, send } = ctx;
  if (!url.pathname.startsWith("/api/admin/product-import/")) return false;
  const check = admin.requirePermission(req, state, "product:write");
  if (!check.ok) return send(ctx.res, check.status, { error: check.error });
  try {
    if (req.method === "GET" && url.pathname === "/api/admin/product-import/template") {
      return send(ctx.res, 200, service.template(), {
        "Content-Type": "application/vnd.ms-excel", "Content-Disposition": "attachment; filename=product-import-template.xls",
        "Cache-Control": "no-store"
      });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/product-import/preview") {
      const body = await readWorkbook(req);
      return send(ctx.res, 200, service.previewImport(state, body, url.searchParams.get("filename"), check));
    }
    if (req.method === "POST" && url.pathname === "/api/admin/product-import/commit") {
      const result = await service.commitImport(state, await ctx.readBody(req), check, admin.logOperation);
      return send(ctx.res, result.ok ? 200 : result.report ? 422 : result.status || 409, result);
    }
    return send(ctx.res, 405, { error: "不支持的商品导入操作" });
  } catch (error) {
    const status = Number(error.status);
    if (status >= 400 && status <= 503) return send(ctx.res, status, { error: error.message });
    throw error;
  }
}

module.exports = { handleProductImportRoutes };
