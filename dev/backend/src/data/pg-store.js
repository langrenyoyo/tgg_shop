const { Pool } = require("pg");
const { createSeed } = require("./seed");
const { normalizeState } = require("./state-normalizer");

const DEFAULT_STATE_ID = process.env.TGG_PG_STATE_ID || "main";
const DEFAULT_SCHEMA = process.env.TGG_PG_SCHEMA || "public";
const USE_LITERAL_SQL = process.env.TGG_PG_MEM === "1";

let pool;
let initialized = false;
let saveChain = Promise.resolve();
let expectedPayload = null;
let writeConflict = false;

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
      expectedPayload = USE_LITERAL_SQL ? result.rows[0].state_json : JSON.stringify(parseStateJson(result.rows[0].state_json));
      initialized = true;
      writeConflict = false;
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
    expectedPayload = JSON.stringify(seed);
    writeConflict = false;
    return normalizeState(seed);
  } finally {
    client.release();
  }
}

async function savePgState(state) {
  const payload = JSON.stringify(state);
  // Each caller observes its own failure; the next attempt must still execute.
  saveChain = saveChain.catch(() => {}).then(async () => {
    let client;
    try {
      client = await getPool().connect();
      let result;
      if (expectedPayload === null) {
        result = USE_LITERAL_SQL
          ? await client.query(`INSERT INTO ${qualifiedTable("app_state")} (state_id, state_json, updated_at) VALUES (${sqlLiteral(DEFAULT_STATE_ID)}, ${sqlLiteral(payload)}, NOW()) ON CONFLICT (state_id) DO NOTHING`)
          : await client.query(`INSERT INTO ${qualifiedTable("app_state")} (state_id, state_json, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (state_id) DO NOTHING`, [DEFAULT_STATE_ID, payload]);
      } else {
        result = USE_LITERAL_SQL
          ? await client.query(`UPDATE ${qualifiedTable("app_state")} SET state_json = ${sqlLiteral(payload)}, updated_at = NOW() WHERE state_id = ${sqlLiteral(DEFAULT_STATE_ID)} AND state_json = ${sqlLiteral(expectedPayload)}`)
          : await client.query(`UPDATE ${qualifiedTable("app_state")} SET state_json = $2::jsonb, updated_at = NOW() WHERE state_id = $1 AND state_json = $3::jsonb`, [DEFAULT_STATE_ID, payload, expectedPayload]);
      }
      if (result.rowCount !== 1) {
        writeConflict = true;
        const error = new Error("Stored state changed in another writer; reload and reconcile before retrying");
        error.code = "STATE_WRITE_CONFLICT";
        throw error;
      }
      expectedPayload = payload;
      initialized = true;
    } catch (error) {
      initialized = false;
      throw error;
    } finally {
      if (client) client.release();
    }
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
  expectedPayload = null;
}

function isPgReady() {
  return initialized;
}

function hasPgWriteConflict() { return writeConflict; }

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
  isPgReady,
  hasPgWriteConflict
};
