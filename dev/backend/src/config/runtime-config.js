function validateRuntimeConfig(env = process.env, strict = env.NODE_ENV === "production") {
  const errors = [];
  const warnings = [];

  const port = Number(env.PORT || 5177);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push("PORT must be an integer between 1 and 65535");
  }

  const authSecret = String(env.TGG_AUTH_SECRET || "").trim();
  if (strict && authSecret.length < 16) {
    errors.push("TGG_AUTH_SECRET must be at least 16 characters in production");
  }
  if (strict && /^(tgg-shop-dev-auth-secret|replace-with-a-long-random-secret|changeme|secret)$/i.test(authSecret)) {
    errors.push("TGG_AUTH_SECRET must not use a default placeholder in production");
  }

  const ttlSeconds = Number(env.TGG_AUTH_TOKEN_TTL_SECONDS || 60 * 60 * 8);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    errors.push("TGG_AUTH_TOKEN_TTL_SECONDS must be a positive number");
  }

  const driver = String(env.TGG_STORE_DRIVER || "json");
  if (!["json", "sqlite", "pg"].includes(driver)) {
    errors.push(`Unsupported TGG_STORE_DRIVER: ${driver}`);
  }

  if (driver === "pg") {
    const pgUrl = String(env.TGG_PG_URL || env.DATABASE_URL || "").trim();
    if (!pgUrl) {
      errors.push("TGG_PG_URL or DATABASE_URL is required when TGG_STORE_DRIVER=pg");
    }
    const schema = String(env.TGG_PG_SCHEMA || "public").trim();
    if (!schema) {
      errors.push("TGG_PG_SCHEMA cannot be empty when TGG_STORE_DRIVER=pg");
    }
  }

  if (strict && driver !== "pg") {
    warnings.push("Production is configured to run without PostgreSQL; set TGG_STORE_DRIVER=pg for deployment");
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = {
  validateRuntimeConfig
};
