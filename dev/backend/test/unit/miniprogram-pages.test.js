const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../../../../wechat-miniprogram");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const registered = new Set(manifest.pages);
const tabs = new Set(manifest.tabBar.list.map(item => item.pagePath));

// Check the components actually referenced by templates. A syntactically valid
// WXML tag can still fail at runtime when it has no native/custom registration.
const nativeTags = new Set([
  "view", "text", "image", "scroll-view", "button", "input", "textarea",
  "navigator", "picker", "radio", "radio-group", "checkbox", "checkbox-group",
  "label", "form", "rich-text", "block", "template", "import", "include", "wxs"
]);

for (const page of manifest.pages) {
  test(`mini page ${page}: registration, handlers and literal navigation`, () => {
    const source = fs.readFileSync(path.join(root, page + ".js"), "utf8");
    const markup = fs.readFileSync(path.join(root, page + ".wxml"), "utf8");
    const config = JSON.parse(fs.readFileSync(path.join(root, page + ".json"), "utf8"));
    const customTags = new Set(Object.keys({ ...manifest.usingComponents, ...config.usingComponents }));
    for (const [, tag] of markup.matchAll(/<([a-zA-Z][\w:-]*)\b/g)) {
      assert.ok(nativeTags.has(tag) || customTags.has(tag), `${page}: unregistered component <${tag}>`);
    }
    let definition;
    vm.runInNewContext(source, { Page(value) { definition = value; }, require(moduleName) {
      assert.ok(moduleName.startsWith("."), "unsupported dependency");
      const filename = path.resolve(root, path.dirname(page), moduleName) + ".js";
      assert.ok(fs.existsSync(filename), filename);
      return {};
    } }, { filename: page });
    assert.ok(definition?.data);
    for (const match of markup.matchAll(/(?:bind|catch):?[\w-]+\s*=\s*["']([\w$]+)["']/g)) {
      assert.equal(typeof definition[match[1]], "function", `${page}: missing ${match[1]}`);
    }
    for (const match of source.matchAll(/wx\.(navigateTo|redirectTo|switchTab|reLaunch)\(\s*\{\s*url:\s*["'`]\/([^?"'`$]+)(?:[?"'`])/g)) {
      const [, method, target] = match;
      assert.ok(registered.has(target), `unregistered destination ${target}`);
      if (method === "switchTab") assert.ok(tabs.has(target), `${target} is not a tab`);
      if (["navigateTo", "redirectTo"].includes(method)) assert.ok(!tabs.has(target), `${target} requires switchTab`);
    }
  });
}
