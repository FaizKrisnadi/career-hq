#!/usr/bin/env node
// career-hq API client for engine workflows. Run via world.run("node", [...]).
// Usage:
//   node api.mjs get-application <id>          → application + opportunity + posting JSON
//   node api.mjs get-profile                   → profile source pointers + settings
//   node api.mjs push-document '<json>'        → create document (+version, lint)
//   node api.mjs push-fit '<json>'             → record fit analysis
//   node api.mjs set-status <appId> <status> '<note>'
//   node api.mjs complete-task <taskId> '<resultJson>'
// Config: CAREER_HQ_URL, CAREER_HQ_API_KEY env or ../engine/.engine-env

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);

function baseUrl() {
  if (process.env.CAREER_HQ_URL) return process.env.CAREER_HQ_URL;
  try {
    // .api-url override (single line) — used to point the engine at a dev server.
    return readFileSync(join(here, ".api-url"), "utf8").trim() || "https://career-hq.2mpnxm9fdn.workers.dev";
  } catch {
    return "https://career-hq.2mpnxm9fdn.workers.dev";
  }
}
const BASE = baseUrl();
const IS_DEV = /localhost|127\.0\.0\.1/.test(BASE);
const KEY =
  process.env.CAREER_HQ_API_KEY ??
  readFileSync(join(here, IS_DEV ? ".engine-env-dev" : ".engine-env"), "utf8").match(
    /CAREER_HQ_API_KEY=(\S+)/,
  )?.[1];

if (!KEY) {
  console.error(JSON.stringify({ error: "no api key" }));
  process.exit(2);
}

async function call(path, method = "GET", body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(JSON.stringify({ error: res.status, detail: json }));
    process.exit(1);
  }
  return json;
}

switch (cmd) {
  case "get-application": {
    const id = rest[0];
    // The dashboard API exposes engine-scoped reads via profile + tasks; for
    // application+posting this uses a direct D1-backed endpoint if present,
    // otherwise composes from the generic sources. Minimal: fetch via health
    // endpoint is not enough — use the dedicated read below.
    const data = await call(`/api/engine/applications/${id}`);
    console.log(JSON.stringify(data));
    break;
  }
  case "get-profile": {
    console.log(JSON.stringify(await call("/api/engine/profile")));
    break;
  }
  case "push-document": {
    console.log(JSON.stringify(await call("/api/engine/documents", "POST", JSON.parse(rest[0]))));
    break;
  }
  case "push-fit": {
    console.log(JSON.stringify(await call("/api/engine/fit", "POST", JSON.parse(rest[0]))));
    break;
  }
  case "push-candidate": {
    console.log(JSON.stringify(await call("/api/engine/candidates", "POST", JSON.parse(rest[0]))));
    break;
  }
  case "set-status": {
    console.log(
      JSON.stringify(
        await call(`/api/engine/applications/${rest[0]}/status`, "POST", {
          status: rest[1],
          source: "engine",
          note: rest[2] ?? undefined,
        }),
      ),
    );
    break;
  }
  case "complete-task": {
    console.log(
      JSON.stringify(await call(`/api/engine/tasks/${rest[0]}/complete`, "POST", JSON.parse(rest[1] ?? "{}"))),
    );
    break;
  }
  default:
    console.error(JSON.stringify({ error: `unknown command: ${cmd}` }));
    process.exit(2);
}
