const fs = require("fs");
const path = require("path");

const UPLOAD_DIR = path.resolve(__dirname, "..", "..", "data", "uploads");

async function handleCommonRoutes(ctx) {
  const { req, url, send } = ctx;

  if (req.method === "POST" && url.pathname === "/api/common/upload") {
    const result = await handleUpload(req);
    return send(ctx.res, result.ok ? 200 : result.status, result.ok ? result.body : { error: result.error });
  }

  return false;
}

async function handleUpload(req) {
  const contentType = String(req.headers["content-type"] || "");
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!contentType.toLowerCase().includes("multipart/form-data") || !boundaryMatch) {
    return { ok: false, status: 400, error: "上传接口需要 multipart/form-data" };
  }

  const raw = await readBuffer(req);
  const filePart = parseMultipartFile(raw, boundaryMatch[1]);
  if (!filePart) return { ok: false, status: 400, error: "未找到上传文件" };

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const safeName = sanitizeFilename(filePart.filename || "upload.bin");
  const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
  const storedPath = path.join(UPLOAD_DIR, storedName);
  fs.writeFileSync(storedPath, filePart.buffer);

  const publicPath = `/uploads/${storedName}`;
  return {
    ok: true,
    body: {
      code: 0,
      msg: "上传成功",
      time: String(Math.floor(Date.now() / 1000)),
      data: [
        {
          url: publicPath,
          path: publicPath
        }
      ]
    }
  };
}

async function readBuffer(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function parseMultipartFile(buffer, boundary) {
  const raw = buffer.toString("latin1");
  const marker = `--${boundary}`;
  const segments = raw.split(marker).slice(1, -1);

  for (const segment of segments) {
    const cleaned = segment.replace(/^\r\n/, "").replace(/\r\n--$/, "").replace(/\r\n$/, "");
    const separator = cleaned.indexOf("\r\n\r\n");
    if (separator < 0) continue;
    const headerText = cleaned.slice(0, separator);
    let bodyText = cleaned.slice(separator + 4);
    if (bodyText.endsWith("\r\n")) bodyText = bodyText.slice(0, -2);

    const headers = Object.fromEntries(
      headerText.split("\r\n").map((line) => {
        const index = line.indexOf(":");
        if (index < 0) return ["", ""];
        return [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()];
      }).filter(([key]) => key)
    );

    const disposition = headers["content-disposition"] || "";
    if (!/name="file"/i.test(disposition)) continue;
    const filenameMatch = disposition.match(/filename="([^"]*)"/i);
    return {
      filename: filenameMatch ? filenameMatch[1] : "upload.bin",
      buffer: Buffer.from(bodyText, "latin1")
    };
  }

  return null;
}

function sanitizeFilename(filename) {
  const base = path.basename(String(filename || "upload.bin"));
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return safe || "upload.bin";
}

module.exports = {
  handleCommonRoutes
};
