/**
 * Run this app's real Hono server against node:sqlite, in-process.
 *
 * The app's storage layer (@clawnify/db) already abstracts its backend behind a
 * `StorageBinding` — a `query(sql, params)` call — so a third implementation
 * over node:sqlite needs no change to the server at all. That is what makes an
 * end-to-end check possible with no dev server, no hosted database and no
 * deploy: the real Hono app, the real schema, real SQL.
 *
 * Requires Node 22.5+ for node:sqlite. `pnpm test` bundles the server first.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(HERE, "..", "src", "server", "schema.sql"), "utf8");
const BUNDLE = join(HERE, ".server.mjs");

// A fresh module instance per scenario: the server holds module-level state
// (the db/credentials singletons), so scenarios would leak into each other if
// they shared one import. A cache-busting query gives each its own copy.
let instance = 0;

function storage(db) {
  return {
    async query(sql, params = []) {
      const head = sql.trim().slice(0, 6).toUpperCase();
      const stmt = db.prepare(sql);
      if (head === "SELECT" || head === "PRAGMA" || head.startsWith("WITH")) {
        return { rows: stmt.all(...params) };
      }
      const r = stmt.run(...params);
      return { rows: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  };
}

/**
 * Stand-in for the Clawnify credential broker. Every publish the app makes is
 * appended to `sends`, so "did this post go out twice" is a counted fact rather
 * than something inferred from the response.
 *
 * `plan.linkedinOk()` is read per call so a scenario can make LinkedIn fail and
 * then recover, which is how a partial post and its retry are reproduced.
 */
function broker(plan = {}) {
  const sends = [];
  const linkedinOk = plan.linkedinOk ?? (() => true);
  return {
    sends,
    binding: {
      async getToken() { return null; },
      async listConnected() { return []; },
      async getCredentials() { return null; },
      async executeTool(service, toolSlug, args) {
        switch (toolSlug) {
          case "TWITTER_USER_LOOKUP_ME":
            return { data: { data: { name: "Test", username: "test" } }, error: null, successful: true };
          case "LINKEDIN_GET_MY_INFO":
            return linkedinOk()
              ? { data: { id: "li-me", localizedFirstName: "Test", localizedLastName: "User" }, error: null, successful: true }
              : { data: null, error: "LinkedIn token expired", successful: false };
          case "TWITTER_CREATION_OF_A_POST":
            sends.push({ service, toolSlug, text: args.text });
            return { data: { data: { id: `tw-${sends.length}` } }, error: null, successful: true };
          case "LINKEDIN_CREATE_LINKED_IN_POST":
            sends.push({ service, toolSlug, text: args.commentary });
            return { data: { x_restli_id: `li-${sends.length}` }, error: null, successful: true };
          default:
            return { data: null, error: `harness has no stub for ${toolSlug}`, successful: false };
        }
      },
    },
  };
}

/** A running app with an empty database, plus helpers to drive it over HTTP. */
export async function boot(plan) {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const { default: app } = await import(`${BUNDLE}?${instance++}`);
  const b = broker(plan);
  const env = { STORAGE: storage(db), CREDENTIALS: b.binding, CLAWNIFY_ORG_ID: "org-test" };

  const send = async (method, path, body) => {
    const res = await app.request(
      path,
      body === undefined
        ? { method }
        : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      env,
    );
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  return {
    db,
    sends: b.sends,
    get: (path) => send("GET", path),
    post: (path, body) => send("POST", path, body ?? {}),
    put: (path, body) => send("PUT", path, body),
    del: (path) => send("DELETE", path),
    row: (sql, ...params) => db.prepare(sql).get(...params),
    rows: (sql, ...params) => db.prepare(sql).all(...params),
  };
}

// ── Assertions ──

const checks = [];

export function check(name, ok, detail = "") {
  checks.push({ name, ok });
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

export function section(title) {
  console.log(`\n${title}`);
}

export function report() {
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}
