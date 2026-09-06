const catalogService = require("../services/catalog-service");

async function handleCatalogRoutes(ctx) {
  const { req, url, state, user, send, publicUser } = ctx;

  if (req.method === "GET" && url.pathname === "/api/config") return send(ctx.res, 200, state.config);

  if (req.method === "GET" && url.pathname === "/api/home") {
    return send(ctx.res, 200, catalogService.getHome(state, user));
  }

  if (req.method === "GET" && url.pathname === "/api/products") {
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
