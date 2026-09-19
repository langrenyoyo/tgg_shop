const fs = require("node:fs");
const path = require("node:path");
const { saveState } = require("../data/store");
const { publicUser } = require("../http/http-utils");

const uploadDir = path.resolve(__dirname, "../../data/uploads");

function isUploadedImage(value) {
  if (typeof value !== "string" || !/^\/uploads\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.(png|jpe?g|gif|webp)$/i.test(value)) return false;
  let fd;
  try {
    fd = fs.openSync(path.join(uploadDir, path.basename(value)), "r");
    const header = Buffer.alloc(12);
    const length = fs.readSync(fd, header, 0, header.length, 0);
    return length >= 12 && (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      header[0] === 255 && header[1] === 216 && header[2] === 255 ||
      ["GIF87a", "GIF89a"].includes(header.toString("ascii", 0, 6)) ||
      header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP");
  } catch { return false; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

async function updateProfile(user, input) {
  if (!user || user.status !== "active") return { ok: false, status: 401, error: "请先登录" };
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["nickname", "avatarUrl"].includes(key))) {
    return { ok: false, status: 400, error: "仅支持修改昵称和头像" };
  }
  const nickname = typeof input.nickname === "string" ? input.nickname.trim() : "";
  if (!nickname || [...nickname].length > 32 || /[\u0000-\u001f\u007f<>]/.test(nickname)) {
    return { ok: false, status: 400, error: "昵称须为 1 至 32 个字符，且不能包含控制字符或尖括号" };
  }
  if (!isUploadedImage(input.avatarUrl)) return { ok: false, status: 400, error: "请先上传有效头像" };
  user.nickname = nickname;
  user.avatarUrl = input.avatarUrl;
  await saveState();
  return { ok: true, user: publicUser(user) };
}

module.exports = { updateProfile };
