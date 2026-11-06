process.env.TGG_STORE_MODE = "memory";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeed } = require("../../src/data/seed");
const { searchAdmin } = require("../../src/services/admin-search-service");
const { handleAdminRoutes } = require("../../src/routes/admin-routes");
const { issueToken } = require("../../src/domain/auth");

function fixture() {
  const state = createSeed();
  state.orders = [{ id: "order_ABC", userId: "user_1", status: "paid", items: [{ productId: "product_1", title: "鲜苹果" }], pickupCode: "secret-pickup" }];
  state.users = [{ id: "user_1", nickname: "Alice小鹿", phone: "13800138000", passwordHash: "secret-password", wechatOpenid: "secret-openid" }];
  state.products = [{ id: "product_1", name: "鲜苹果", category: "水果", locationCode: "A-001", status: "on", supplierSecret: "secret-supplier" }];
  return state;
}

async function request(state, query, roleId) {
  const headers = {};
  if (roleId) {
    const token = issueToken({ type: "admin", roleId });
    const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url"));
    state.authSessions.push({ subjectType: "admin", subjectId: roleId, tokenId: payload.tokenId, expiresAt: new Date(payload.exp * 1000).toISOString() });
    headers.authorization = `Bearer ${token}`;
  }
  let response;
  await handleAdminRoutes({ state, req: { method: "GET", headers }, url: new URL(`http://localhost/api/admin/search?q=${encodeURIComponent(query)}`), send: (_, status, body) => { response = { status, body }; } });
  return response;
}

test("global search matches trimmed case-insensitive identifiers, Chinese item names, nicknames, phones and categories", () => {
  const state = fixture();
  assert.equal(searchAdmin(state, "  ORDER_abc  ", ["*"]).groups[0].items[0].id, "order_ABC");
  const apple = searchAdmin(state, "苹果", ["*"]);
  assert.equal(apple.total, 2);
  assert.deepEqual(apple.groups.map(group => group.total), [1, 0, 1]);
  for (const query of ["alice", "小鹿", "1380013", "USER_1"]) {
    assert.equal(searchAdmin(state, query, ["customer:read"]).groups[0].items[0].id, "user_1");
  }
  for (const query of ["水果", "a-001", "PRODUCT_1"]) {
    assert.equal(searchAdmin(state, query, ["product:read"]).total, 1);
  }
});

test("search uses literal matching, rejects blank/oversized keywords and never enumerates all records for an empty query", () => {
  const state = fixture();
  for (const query of [undefined, "", "  ", "a".repeat(101)]) {
    assert.equal(searchAdmin(state, query, ["*"]).status, 400);
  }
  assert.equal(searchAdmin(state, ".*", ["*"]).total, 0);
  assert.equal(searchAdmin(state, "不存在", ["*"]).total, 0);
});

test("search neither matches nor returns pickup codes, credentials or provider metadata", () => {
  const state = fixture();
  assert.equal(searchAdmin(state, "secret", ["*"]).total, 0);
  for (const query of ["order_", "user_", "product_"]) {
    const result = searchAdmin(state, query, ["*"]);
    assert.doesNotMatch(JSON.stringify(result), /secret|pickupCode|passwordHash|wechatOpenid|supplierSecret/);
    for (const group of result.groups) for (const item of group.items) {
      assert.deepEqual(Object.keys(item).sort(), ["description", "id", "status", "title"]);
    }
  }
});

test("search caps each group, preserves full counts and prioritizes exact identifiers", () => {
  const state = fixture();
  state.products = Array.from({ length: 32 }, (_, i) => ({ id: `product_${i}`, name: "product needle" }));
  state.products.push({ id: "product", name: "exact identifier" });
  const result = searchAdmin(state, "PRODUCT", ["product:read"]);
  assert.equal(result.total, 33);
  assert.equal(result.groups[0].items.length, 20);
  assert.equal(result.groups[0].items[0].id, "product");
});

test("route requires a valid admin session and enforces current per-resource permissions", async () => {
  const state = fixture();
  assert.equal((await request(state, "product", null)).status, 401);
  const productOnly = await request(state, "苹果", "product_admin");
  assert.equal(productOnly.status, 200);
  assert.deepEqual(productOnly.body.groups.map(group => group.type), ["products"]);
  assert.equal(productOnly.body.total, 1);
  const superAdmin = await request(state, "苹果", "super_admin");
  assert.equal(superAdmin.status, 200);
  assert.deepEqual(superAdmin.body.groups.map(group => group.type), ["orders", "users", "products"]);
  assert.equal(superAdmin.body.total, 2);
  state.roles.find(role => role.id === "product_admin").permissions = [];
  assert.equal((await request(state, "苹果", "product_admin")).status, 403);
  assert.equal((await request(state, " ", "super_admin")).status, 400);
});
