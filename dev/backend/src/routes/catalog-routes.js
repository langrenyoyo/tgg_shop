const catalogService = require("../services/catalog-service");
const { activeConfig } = require("../config/active-config");
const { mockOperationsEnabled, cashPaymentsEnabled } = require("../config/runtime-safety");

async function handleCatalogRoutes(ctx) {
  const { req, url, state, user, send, publicUser } = ctx;

  if (req.method === "GET" && url.pathname === "/api/config") return send(ctx.res, 200, {
    ...activeConfig(state.config),
    withdrawChannelMaxAmount: require("../services/withdrawal-provider/huifu-bafang").maxTransferAmount(),
    // Compatibility for released clients; this is the channel limit, not an admin setting.
    withdrawMaxAmount: require("../services/withdrawal-provider/huifu-bafang").maxTransferAmount(),
    testBypassEnabled: mockOperationsEnabled(),
    cashEnabled: cashPaymentsEnabled()
  });

  if (req.method === "GET" && url.pathname === "/api/home") {
    return send(ctx.res, 200, catalogService.getHome(state, user));
  }

  if (req.method === "GET" && url.pathname === "/api/products") {
    if (url.searchParams.has("page")) {
      const page = Number(url.searchParams.get("page"));
      const pageSize = Number(url.searchParams.get("pageSize") || 10);
      if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isSafeInteger(page * pageSize)) {
        return send(ctx.res, 400, { error: "分页参数无效" });
      }
      return send(ctx.res, 200, catalogService.listProductPage(state, { page, pageSize, category: url.searchParams.get("category") || "", search: url.searchParams.get("search") || "" }));
    }
    return send(ctx.res, 200, catalogService.listProducts(state, url.searchParams.get("category")));
  }

  const productMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
  if (req.method === "GET" && productMatch) {
    const product = catalogService.getProduct(state, productMatch[1]);
    return product ? send(ctx.res, 200, product) : send(ctx.res, 404, { error: "商品不存在" });
  }

  if (req.method === "GET" && url.pathname === "/api/points-exchange") {
    return send(ctx.res, 200, catalogService.listPointsExchangeProducts(state));
  }

  return false;
}

module.exports = {
  handleCatalogRoutes
};
