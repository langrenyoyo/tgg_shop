const { isMember } = require("../domain/rules");

function send(res, status, data, headers = {}) {
  const body = typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": headers["Content-Type"] || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    ...headers
  });
  res.end(body);
  return true;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function publicUser(user) {
  if (!user) return null;
  return {
    ...user,
    isMember: isMember(user),
    memberDaysLeft: user.memberUntil
      ? Math.max(0, Math.ceil((new Date(user.memberUntil).getTime() - Date.now()) / 86400000))
      : 0
  };
}

module.exports = {
  send,
  readBody,
  publicUser
};
