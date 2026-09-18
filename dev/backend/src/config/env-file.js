const fs = require("node:fs");
const path = require("node:path");

// Match the server's existing single-line .env format, including escaped PEM newlines.
function readEnvFile(file) {
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    values[key] = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

function loadEnv(env = process.env) {
  if (env.TGG_LOAD_DOTENV === "0") return;
  const file = path.resolve(__dirname, "../..", env.TGG_ENV_FILE || ".env");
  if (!fs.existsSync(file) && !env.TGG_ENV_FILE) return;
  for (const [key, value] of Object.entries(readEnvFile(file))) {
    if (!(key in env)) env[key] = value;
  }
}

module.exports = { readEnvFile, loadEnv };
