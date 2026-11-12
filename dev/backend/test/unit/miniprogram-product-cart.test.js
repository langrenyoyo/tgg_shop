const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "../../../../wechat-miniprogram");
function setup() {
  const storage = new Map(), messages = [], cache = {}, navigation = [];
  const wx = { getStorageSync: key => structuredClone(storage.get(key)), setStorageSync: (key, value) => storage.set(key, structuredClone(value)), removeStorageSync: key => storage.delete(key), showToast: value => messages.push(value.title), navigateTo: value => navigation.push(value) };
  function load(file) {
    if (cache[file]) return cache[file];
    const context = { wx, module: { exports: {} }, require: name => load(path.resolve(path.dirname(file), name + ".js")) };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), context);
    return cache[file] = context.module.exports;
  }
  return { storage, wx, messages, navigation, cart: load(path.join(root,"utils/cart.js")), controls: load(path.join(root,"utils/product-cart.js")) };
}
const product = { id: "p", name: "Product", status: "on", stock: 2 };
const gift = { ...product, category: "买商品送会员", membershipGiftDays: 30, supportsCash: true, supportsPoints: false, cashPrice: 19.8 };

for (const name of ["home", "shop", "product"]) test(`${name} gift cash button creates an isolated checkout for a nonmember and never changes cart`, async () => {
  const h = setup(); let page;
  h.storage.set("tgg_user", { id: "alice", isMember: false });
  h.storage.set("tgg_token", "token");
  h.cart.add({ ...product, id: "ordinary" });
  const before = JSON.stringify(h.cart.read());
  vm.runInNewContext(fs.readFileSync(path.join(root, `pages/${name}/index.js`), "utf8"), {
    Page: value => { page = value; }, wx: h.wx,
    require: file => file.endsWith("product-cart") ? h.controls : file.endsWith("cart") ? h.cart : {
      request: async () => name === "home" ? { recommendProducts: [gift] } : name === "shop" ? [gift] : gift
    }
  });
  page.setData = (value, callback) => { Object.assign(page.data, value); callback?.(); };
  if (name === "product") page.onLoad({ id: gift.id });
  await page.load();
  const tap = () => name === "product" ? page.buy() : page.buyGift({ currentTarget: { dataset: { id: gift.id } } });
  page.changeCart({ currentTarget: { dataset: { id: gift.id, delta: 1 } } });
  assert.equal(JSON.stringify(h.cart.read()), before);
  tap(); tap();
  assert.equal(h.navigation.length, 1);
  assert.equal(h.navigation[0].url, "/pages/checkout/index");
  assert.deepEqual(JSON.parse(JSON.stringify(h.cart.readCheckout())), [{ productId: gift.id, quantity: 1 }]);
  assert.equal(h.storage.get("tgg_checkout_alice").fromCart, false);
  h.navigation[0].fail();
  tap();
  assert.equal(h.navigation.length, 2);
  h.cart.completeCheckout(h.cart.checkoutIdempotencyKey());
  assert.equal(JSON.stringify(h.cart.read()), before);
  page.onShow();
  assert.equal(page.data.navigating, false);
});

test("gift purchase requires login, current stock and valid cash activity configuration", () => {
  const h = setup(), page = { data: {}, setData(value) { Object.assign(this.data, value); } };
  h.controls.buyGift(page, gift);
  assert.equal(h.navigation[0].url, "/pages/login/index");
  assert.equal(h.cart.readCheckout().length, 0);
  h.storage.set("tgg_user", { id: "alice", isMember: false }); h.storage.set("tgg_token", "token");
  page.data.navigating = false;
  for (const invalid of [{ stock: 0 }, { status: "off" }, { supportsCash: false }, { purePointsOnly: true }, { membershipGiftDays: 0 }]) {
    h.controls.buyGift(page, { ...gift, ...invalid });
  }
  assert.equal(h.navigation.length, 1);
  assert.equal(h.cart.readCheckout().length, 0);
  assert.equal(h.messages.length, 5);
  for (const flag of ["loading", "error", "navigating"]) {
    page.data[flag] = true; h.controls.buyGift(page, gift); page.data[flag] = false;
  }
  page.disposed = true; h.controls.buyGift(page, gift);
  assert.equal(h.navigation.length, 1);
  assert.equal(h.cart.readCheckout().length, 0);
});
test("stepper adds up to stock, decrements and removes the last unit without touching other products", () => {
  const h = setup(), page = { data: {}, setData(value) { Object.assign(this.data, value); } };
  h.cart.add({ ...product, id: "other" });
  h.controls.change(page, product, 1); h.controls.change(page, product, 1); h.controls.change(page, product, 1);
  assert.equal(page.data.cartQuantities.p,2);
  assert.equal(h.messages.length,1);
  h.controls.change(page,product,-1); assert.equal(page.data.cartQuantities.p,1);
  h.controls.change(page,product,-1); assert.equal(h.cart.read().length,1);
  assert.equal(h.cart.read()[0].productId,"other");
  h.controls.change(page,product,-1); assert.equal(h.cart.read().length,1);
});
test("stepper reads active account and blocks unavailable additions but permits removal", () => {
  const h = setup(), page = { data: {}, setData(value) { Object.assign(this.data,value); } };
  h.controls.change(page,product,1);
  h.storage.set("tgg_user",{id:"alice"});
  h.controls.change(page,product,-1); assert.equal(h.cart.read().length,0);
  assert.equal(h.storage.get("tgg_cart_guest")[0].quantity,1);
  h.controls.change(page,{...product,status:"off"},1); assert.equal(h.cart.read().length,0);
  h.controls.change(page,product,1);
  h.controls.change(page,{...product,status:"off",stock:0},-1); assert.equal(h.cart.read().length,0);
});
for (const name of ["home", "shop", "product"]) test(`${name} page stepper persists quantity and refreshes when returning`, async () => {
  const h=setup();let page;
  vm.runInNewContext(fs.readFileSync(path.join(root,`pages/${name}/index.js`),"utf8"), {
    Page: value=>{page=value;}, wx:h.wx,
    require: file=>file.endsWith("product-cart")?h.controls:file.endsWith("cart")?h.cart:{ request:async()=>name==="home"?{recommendProducts:[product]}:name==="shop"?[{...product,name:"Product"}]:product }
  });
  page.setData=(value,callback)=>{Object.assign(page.data,value);callback?.();};
  if(name==="product")page.onLoad({id:"p"});
  await page.load();
  page.changeCart({currentTarget:{dataset:{id:"p",delta:1}}});
  assert.equal(h.cart.read()[0].quantity,1);
  assert.equal(page.data.cartQuantities.p,1);
  page.changeCart({currentTarget:{dataset:{id:"p",delta:-1}}});
  assert.equal(h.cart.read().length,0);
  h.cart.add(product);
  if(name==="home")page.onShow();else await page.load();
  assert.equal(page.data.cartQuantities.p,1);
});
