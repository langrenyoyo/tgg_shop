const fs = require("fs");
const path = require("path");
const { send } = require("./http-utils");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const USER_DIR = path.join(ROOT, "frontend", "user");
const ADMIN_DIR = path.join(ROOT, "frontend", "admin");
const ASSETS_DIR = path.resolve(ROOT, "..", "ui", "v17", "assets");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function routeStatic(req, res, url) {
  if (url.pathname === "/" || url.pathname === "/user" || url.pathname === "/user/") return serveFile(res, path.join(USER_DIR, "index.html"));
  if (url.pathname === "/admin" || url.pathname === "/admin/") return serveFile(res, path.join(ADMIN_DIR, "index.html"));
  if (url.pathname.startsWith("/user/")) return serveFile(res, path.join(USER_DIR, url.pathname.replace("/user/", "")));
  if (url.pathname.startsWith("/admin/")) return serveFile(res, path.join(ADMIN_DIR, url.pathname.replace("/admin/", "")));
  if (url.pathname.startsWith("/assets/")) return serveFile(res, path.join(ASSETS_DIR, url.pathname.replace("/assets/", "")));
  return false;
}

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return send(res, 404, { error: "Not found" });
  }
  const ext = path.extname(filePath);
  return send(res, 200, fs.readFileSync(filePath), { "Content-Type": contentTypes[ext] || "application/octet-stream" });
}

module.exports = {
  routeStatic
};
