const { Pool } = require("pg");
const { createSeed } = require("./seed");
const { normalizeState } = require("./state-normalizer");

const DEFAULT_STATE_ID = process.env.TGG_PG_STATE_ID || "main";
const DEFAULT_SCHEMA = process.env.TGG_PG_SCHEMA || "public";
const USE_LITERAL_SQL = process.env.TGG_PG_MEM === "1";

let pool;
let initialized = false;
let saveChain = Promise.resolve();

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.TGG_PG_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing TGG_PG_URL or DATABASE_URL");
  }
  pool = new Pool({ connectionString, max: Number(process.env.TGG_PG_POOL_SIZE || 5) });
  return pool;
}

async function initPgState() {
  const database = getPool();
  const client = await database.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(DEFAULT_SCHEMA)}`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${qualifiedTable("app_state")} (
        state_id TEXT PRIMARY KEY,
        state_json ${USE_LITERAL_SQL ? "TEXT" : "JSONB"} NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const result = USE_LITERAL_SQL
      ? await client.query(`SELECT state_json FROM ${qualifiedTable("app_state")} WHERE state_id = ${sqlLiteral(DEFAULT_STATE_ID)}`)
      : await client.query(`SELECT state_json FROM ${qualifiedTable("app_state")} WHERE state_id = $1`, [DEFAULT_STATE_ID]);
    if (result.rowCount) {
      initialized = true;
      return normalizeState(parseStateJson(result.rows[0].state_json));
    }
    const seed = createSeed();
    if (USE_LITERAL_SQL) {
      await client.query(
        `INSERT INTO ${qualifiedTable("app_state")} (state_id, state_json, updated_at) VALUES (${sqlLiteral(DEFAULT_STATE_ID)}, ${sqlLiteral(JSON.stringify(seed))}, NOW())`
      );
    } else {
      await client.query(
        `INSERT INTO ${qualifiedTable("app_state")} (state_id, state_json, updated_at) VALUES ($1, $2::jsonb, NOW())`,
        [DEFAULT_STATE_ID, JSON.stringify(seed)]
      );
    }
    initialized = true;
    return normalizeState(seed);
  } finally {
    client.release();
  }
}

async function savePgState(state) {
  const payload = JSON.stringify(state);
  saveChain = saveChain.then(async () => {
    const client = await getPool().connect();
    try {
      if (USE_LITERAL_SQL) {
        await client.query(`
          INSERT INTO ${qualifiedTable("app_state")} (state_id, state_json, updated_at)
          VALUES (${sqlLiteral(DEFAULT_STATE_ID)}, ${sqlLiteral(payload)}, NOW())
          ON CONFLICT (state_id)
          DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()
        `);
      } else {
        await client.query(`
          INSERT INTO ${qualifiedTable("app_state")} (state_id, state_json, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (state_id)
          DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()
        `, [DEFAULT_STATE_ID, payload]);
      }
      initialized = true;
    } finally {
      client.release();
    }
  }).catch((error) => {
    console.error(`Failed to persist PG state: ${error.message}`);
  });
  return saveChain;
}

async function flushPgState() {
  await saveChain;
}

async function closePgPool() {
  if (!pool) return;
  await pool.end();
  pool = null;
  initialized = false;
}

function isPgReady() {
  return initialized;
}

function qualifiedTable(tableName) {
  return `${quoteIdentifier(DEFAULT_SCHEMA)}.${quoteIdentifier(tableName)}`;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function cloneState(value) {
  return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
}

function parseStateJson(value) {
  if (value && typeof value === "string") return JSON.parse(value);
  return cloneState(value);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

module.exports = {
  initPgState,
  savePgState,
  flushPgState,
  closePgPool,
  isPgReady
};
