const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../../../../wechat-miniprogram");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const registered = new Set(manifest.pages);
const tabs = new Set(manifest.tabBar.list.map(item => item.pagePath));

function assertBalancedWxml(markup, page) {
  const stack = [];
  let cursor = 0;
  while ((cursor = markup.indexOf("<", cursor)) >= 0) {
    if (markup.startsWith("<!--", cursor)) {
      const end = markup.indexOf("-->", cursor + 4);
      assert.notEqual(end, -1, `${page}: unclosed WXML comment`);
      cursor = end + 3;
      continue;
    }
    let end = cursor + 1;
    let quote = "";
    for (; end < markup.length; end += 1) {
      const character = markup[end];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    assert.notEqual(end, markup.length, `${page}: unterminated WXML tag`);
    const token = markup.slice(cursor + 1, end).trim();
    cursor = end + 1;
    if (!token || token.startsWith("!") || token.startsWith("?")) continue;
    const closing = token.startsWith("/");
    const name = (closing ? token.slice(1) : token).match(/^[\w:-]+/)?.[0];
    if (!name) continue;
    if (closing) assert.equal(stack.pop(), name, `${page}: mismatched </${name}>`);
    else if (!token.endsWith("/") && name !== "input") stack.push(name);
  }
  assert.deepEqual(stack, [], `${page}: unclosed WXML tags`);
}

test("mini manifest keeps component injection enabled for the WeChat quality audit", () => {
  assert.equal(manifest.lazyCodeLoading, "requiredComponents");
});

test("mini manifest excludes retired bounty pages and references existing page files", () => {
  assert.equal(manifest.pages.some(page => page.includes("bounty")), false);
  for (const page of manifest.pages) {
    for (const extension of [".js", ".json", ".wxml"]) {
      assert.equal(fs.existsSync(path.join(root, page + extension)), true, `${page}${extension} is missing`);
    }
  }
});

// Check the components actually referenced by templates. A syntactically valid
// WXML tag can still fail at runtime when it has no native/custom registration.
const nativeTags = new Set([
  "ad", "ad-custom",
  "view", "text", "image", "scroll-view", "button", "input", "textarea",
  "navigator", "picker", "radio", "radio-group", "checkbox", "checkbox-group",
  "label", "form", "rich-text", "block", "template", "import", "include", "wxs", "swiper", "swiper-item"
]);

for (const page of manifest.pages) {
  test(`mini page ${page}: registration, handlers and literal navigation`, () => {
    const source = fs.readFileSync(path.join(root, page + ".js"), "utf8");
    const markup = fs.readFileSync(path.join(root, page + ".wxml"), "utf8");
    assertBalancedWxml(markup, page);
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
