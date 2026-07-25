const http = require("http");
const { send } = require("./src/http/http-utils");
const { routeStatic } = require("./src/http/static-router");
const { routeApi } = require("./src/routes/api-router");

const PORT = Number(process.env.PORT || 5177);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return routeApi(req, res, url);

    const staticHandled = routeStatic(req, res, url);
    if (staticHandled !== false) return staticHandled;

    return send(res, 404, { error: "Not found" });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`TGG Shop dev server: http://localhost:${PORT}`);
  console.log(`User app: http://localhost:${PORT}/user`);
  console.log(`Admin app: http://localhost:${PORT}/admin`);
});
