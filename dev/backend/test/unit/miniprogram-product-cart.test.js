const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "../../../../wechat-miniprogram");
function setup() {
  const storage = new Map(), messages = [], cache = {};
  const wx = { getStorageSync: key => structuredClone(storage.get(key)), setStorageSync: (key, value) => storage.set(key, structuredClone(value)), showToast: value => messages.push(value.title) };
  function load(file) {
    if (cache[file]) return cache[file];
    const context = { wx, module: { exports: {} }, require: name => load(path.resolve(path.dirname(file), name + ".js")) };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), context);
    return cache[file] = context.module.exports;
  }
  return { storage, wx, messages, cart: load(path.join(root,"utils/cart.js")), controls: load(path.join(root,"utils/product-cart.js")) };
}
const product = { id: "p", name: "Product", status: "on", stock: 2 };
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
