/**
 * cache-owners.js (robust + SSL)
 * - No pg Pool (avoids lingering sockets)
 * - Retries transient DB errors
 * - Forces SSL for Render Postgres
 */
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL;

function need(name, v) {
  if (!v) throw new Error(`Missing ${name}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withDb(fn, attempt = 1) {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60000,
    query_timeout: 60000,
    keepAlive: true,
  });

  try {
    await client.connect();
    const res = await fn(client);
    await client.end();
    return res;
  } catch (e) {
    try { await client.end(); } catch {}
    const code = e?.code || "";
    const msg = String(e?.message || "");
    const transient =
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      msg.includes("ECONNRESET") ||
      msg.includes("timeout") ||
      msg.includes("Connection terminated unexpectedly");

    if (transient && attempt <= 6) {
      const backoff = 1000 * attempt;
      console.error(`DB transient error (${code || "?"}). Retry ${attempt}/6 in ${backoff}ms...`);
      await sleep(backoff);
      return withDb(fn, attempt + 1);
    }
    throw e;
  }
}

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      Accept: "application/json",
    },
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${text.slice(0, 800)}`);
  return JSON.parse(text);
}

async function main() {
  need("HUBSPOT_PRIVATE_APP_TOKEN", HUBSPOT_TOKEN);
  need("DATABASE_URL (or RENDER_DATABASE_URL)", DATABASE_URL);

  await withDb(async (db) => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS owner_cache (
        owner_id BIGINT PRIMARY KEY,
        email TEXT,
        first_name TEXT,
        last_name TEXT,
        full_name TEXT,
        is_active BOOLEAN,
        user_id BIGINT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        raw JSONB
      );
    `);
  });

  let after = undefined;
  let total = 0;
  const owners = [];

  while (true) {
    const url =
      "https://api.hubapi.com/crm/v3/owners/?" +
      new URLSearchParams({
        limit: "500",
        archived: "false",
        ...(after ? { after: String(after) } : {}),
      }).toString();

    const json = await fetchJson(url);
    const results = json.results || [];
    total += results.length;
    for (const o of results) owners.push(o);

    const paging = json.paging?.next;
    if (!paging?.after) break;
    after = paging.after;
  }

  let upserts = 0;

  for (const o of owners) {
    const ownerId = Number(o.id);
    const email = o.email || null;
    const first = o.firstName || null;
    const last = o.lastName || null;
    const full = o.fullName || [first, last].filter(Boolean).join(" ") || null;
    const active = o.active ?? null;
    const userId = o.userId != null ? Number(o.userId) : null;

    await withDb(async (db) => {
      await db.query(
        `
        INSERT INTO owner_cache (owner_id, email, first_name, last_name, full_name, is_active, user_id, updated_at, raw)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8::jsonb)
        ON CONFLICT (owner_id) DO UPDATE SET
          email = EXCLUDED.email,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          full_name = EXCLUDED.full_name,
          is_active = EXCLUDED.is_active,
          user_id = EXCLUDED.user_id,
          updated_at = NOW(),
          raw = EXCLUDED.raw
        `,
        [ownerId, email, first, last, full, active, userId, JSON.stringify(o)]
      );
    });

    upserts += 1;
  }

  const finalCount = await withDb(async (db) => {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM owner_cache;`);
    return rows?.[0]?.n ?? null;
  });

  console.log("=== OWNER CACHE ===");
  console.log("Owners fetched from HubSpot:", total);
  console.log("Rows upserted:", upserts);
  console.log("Rows in owner_cache:", finalCount);
}

main()
  .then(() => console.log("STEP15A_OK"))
  .catch((e) => {
    console.error(e);
    console.log("STEP15A_FAILED");
    process.exit(1);
  });
