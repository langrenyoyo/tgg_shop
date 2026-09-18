// Local compilation only: no developer-tool login, upload or publication.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const argument = process.argv.indexOf("--compiler-dir");
const compilerDir = argument >= 0 ? process.argv[argument + 1] : process.env.WECHAT_COMPILER_DIR;
if (!compilerDir) throw new Error("Provide --compiler-dir pointing to the developer tool's node_modules/wcc-exec directory, or set WECHAT_COMPILER_DIR");
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-mini-compile-"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
function files(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (["node_modules", ".git"].includes(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file, extension) : file.endsWith(extension) ? [path.relative(root, file).replaceAll("\\", "/")] : [];
  }).sort();
}
const templates = files(root, ".wxml");
const styles = files(root, ".wxss");
for (const page of manifest.pages) {
  if (!templates.includes(page + ".wxml")) throw new Error(`Missing page template: ${page}`);
}
function compile(name, args, output) {
  const executable = path.join(compilerDir, name + (process.platform === "win32" ? ".exe" : ""));
  if (!fs.existsSync(executable)) throw new Error(`Compiler missing: ${executable}`);
  const result = spawnSync(executable, [...args, "-o", output], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} exited ${result.status}: ${result.stderr || result.stdout}`);
  if (!fs.existsSync(output) || !fs.statSync(output).size) throw new Error(`${name} produced no output`);
  return { executable, exitCode: result.status, output, bytes: fs.statSync(output).size, diagnostics: result.stderr || "" };
}
const report = {
  generatedAt: new Date().toISOString(), root, pages: manifest.pages.length,
  templates, styles,
  wxml: compile("wcc", templates, path.join(outputDir, "wxml.js")),
  wxss: compile("wcsc", ["-pc", String(styles.length), "-js", ...styles], path.join(outputDir, "wxss.js")),
  scope: "Template and stylesheet compiler checks only; does not verify simulator rendering, native SDK behavior or real-device payment."
};
const reportPath = path.join(outputDir, "report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`Compiled ${report.pages} pages, ${templates.length} templates and ${styles.length} stylesheets. Report: ${reportPath}`);
