const { publicUser } = require("../http/http-utils");
const productRepository = require("../repositories/product-repository");
const siteRepository = require("../repositories/site-repository");

const HOME_CATEGORIES = [
  { name: "\u6c34\u679c", category: "\u6c34\u679c", key: "fruit", icon: "/assets/icons/category-fruit.png", enabled: true },
  { name: "\u852c\u83dc", category: "\u852c\u83dc", key: "vegetable", icon: "/assets/icons/category-vegetable.png", enabled: true },
  { name: "\u65e5\u7528", category: "\u65e5\u7528", key: "daily", icon: "/assets/icons/category-daily.png", enabled: true },
  { name: "\u96f6\u98df", category: "\u96f6\u98df", key: "snack", icon: "/assets/icons/category-snack.png", enabled: true },
  { name: "\u996e\u6599", category: "\u996e\u6599", key: "drink", icon: "/assets/icons/category-drink.png", enabled: true }
];

function categoryShortcuts(config) {
  const source = Array.isArray(config.homeCategoryShortcuts) ? config.homeCategoryShortcuts : HOME_CATEGORIES;
  return source.map((item, index) => ({
    key: String(item.key || `category-${index}`),
    category: String(item.category || item.name || "").trim(),
    name: String(item.name || item.category || "").trim(),
    icon: String(item.icon || "").trim(),
    enabled: item.enabled !== false,
    sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : index
  })).filter(item => item.enabled && item.name && item.category).sort((a, b) => a.sort - b.sort).slice(0, 8);
}

function getHome(state, user) {
  const config = state.config || {};
  return {
    user: publicUser(user),
    bannerProduct: productRepository.findActiveById(state, config.homeBannerProductId || "p_strawberry") || null,
    pickupSite: siteRepository.findEnabledPickupSite(state),
    categories: categoryShortcuts(config).map(item => item.name),
    categoryShortcuts: categoryShortcuts(config),
    deliveryPromise: config.homeDeliveryPromise || {
      title: "\u6700\u5feb 30 \u5206\u949f\u9001\u8fbe",
      subtitle: "TGG \u81ea\u5efa\u914d\u9001\u961f \u00b7 \u5e08\u5927\u5468\u8fb9 5km",
      cutoffText: "\u4eca\u65e5 18:00 \u524d\u53ef\u9001",
      deliveryFeeText: "\u6ee1 39 \u5143\u514d\u914d\u9001\u8d39",
      serviceAreaText: "\u5f53\u524d\u5730\u5740\u5728\u670d\u52a1\u8303\u56f4\u5185"
    },
    serviceBadges: config.homeServiceBadges || ["\u81ea\u5efa\u914d\u9001", "\u574f\u679c\u5305\u8d54", "\u4f4e\u4ef7\u4f1a\u5458\u8d2d"],
    promotionEntries: config.homePromotionEntries || [
      { title: "\u65b0\u4eba\u793c\u5305", text: "\u9996\u5355\u914d\u9001\u5238", tone: "green", page: "membership" },
      { title: "\u4f1a\u5458\u4e13\u4eab", text: "\u73b0\u91d1\u8d2d\u6743\u76ca", tone: "orange", page: "membership" },
      { title: "\u7eaf\u79ef\u5206\u5151", text: "\u65e0\u9700\u73b0\u91d1", tone: "blue", page: "pointsExchange" }
    ],
    banners: [{ title: config.homeBannerTitle || "\u65f6\u4ee4\u9c9c\u679c\u5b63", subtitle: config.homeBannerSubtitle || "\u65b0\u9c9c\u5230\u7ad9 \u4f4e\u81f3 5 \u6298", productId: config.homeBannerProductId || "p_strawberry" }],
    recommendProducts: productRepository.listRecommended(state),
    pointsExchangeEntry: { title: "\u7eaf\u79ef\u5206\u5151\u6362", path: "/api/points-exchange" },
    bannerImage: config.homeBannerImage || ""
  };
}

function listProducts(state, category) {
  return productRepository.listActive(state, category);
}

function getProduct(state, productId) {
  return productRepository.findActiveById(state, productId);
}

function listPointsExchangeProducts(state) {
  return productRepository.listPurePoints(state);
}

module.exports = {
  getHome,
  listProducts,
  getProduct,
  listPointsExchangeProducts
};
