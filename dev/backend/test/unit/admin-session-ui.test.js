const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../../../frontend/admin/js/api.js"), "utf8").replace(/export /g, "");
function setup(entries, fetch, pathname = "/admin") {
  const storage = new Map(entries), events = [], replacements = [];
  const context = {
    localStorage: { getItem: key => storage.get(key), setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key) },
    fetch,
    Event: class { constructor(type) { this.type = type; } },
    window: { dispatchEvent: event => events.push(event.type), location: { pathname, replace: value => replacements.push(value) } }
  };
  vm.createContext(context); vm.runInContext(source, context);
  return { context, storage, events, replacements };
}
test("missing session opens login without default password attempts or protected requests", async () => {
  let calls = 0;
  const { context, events, replacements } = setup([], async () => { calls++; });
  await assert.rejects(context.api("/api/admin/products"), /重新登录/);
  assert.equal(calls, 0);
  assert.deepEqual(events, ["tgg-admin-auth-expired"]);
  assert.deepEqual(replacements, ["/admin/login"]);
});
test("failed refresh clears session and notifies the current screen", async () => {
  const { context, storage, events, replacements } = setup([["tggAdminToken","old"],["tggAdminRefreshToken","refresh"]], async () => ({ status:401, ok:false, json:async()=>({}) }));
  await assert.rejects(context.api("/api/admin/products"), /重新登录/);
  assert.equal(storage.size,0);
  assert.equal(events.length,1);
  assert.deepEqual(replacements, ["/admin/login"]);
});
test("expired session on the login page does not redirect repeatedly", async () => {
  const { context, replacements, events } = setup([], async () => { throw new Error("protected request should not run"); }, "/admin/login");
  await assert.rejects(context.api("/api/admin/products"), /重新登录/);
  assert.deepEqual(replacements, []);
  assert.deepEqual(events, ["tgg-admin-auth-expired"]);
});
test("successful refresh retries protected request with renewed credentials", async () => {
  const calls=[];
  const { context } = setup([["tggAdminToken","old"],["tggAdminRefreshToken","refresh"]], async (url, options) => {
    calls.push(url);
    if(url.endsWith("/refresh")) return {ok:true,status:200,json:async()=>({token:"new",refreshToken:"next"})};
    const ok=options.headers.Authorization === "Bearer new";
    return {ok,status:ok?200:401,json:async()=>ok?[{id:"p1"}]:{}};
  });
  assert.equal((await context.api("/api/admin/products"))[0].id,"p1");
  assert.equal(calls.length,3);
});
test("listed product editor has an explicit unpublish action outside disabled fields", () => {
  const context={};vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,"../../../frontend/admin/js/product-editor.js"),"utf8").replace(/export /g,""),context);
  const html=context.productEditor({id:"p1",status:"on"},{escapeHtml:String,can:()=>true});
  assert.ok(html.indexOf('data-product-action="p1"') < html.indexOf('<fieldset'));
  assert.match(html, /下架并开始编辑/);
  assert.match(html, /fieldset class="editor-fields" disabled/);
});
