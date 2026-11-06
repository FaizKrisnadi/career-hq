#!/usr/bin/env node
// Commit the reconciled import to the career-hq API. Run ONLY after the
// reconciliation report has been reviewed and approved.
// Usage: node commit-import.mjs [--url <base>] [--key <api key>]
// Key defaults to CAREER_HQ_API_KEY in ../engine/.engine-env

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};

const BASE = argOf("--url", "https://career-hq.2mpnxm9fdn.workers.dev");
const KEY =
  argOf("--key") ??
  (readFileSync(join(here, "../engine/.engine-env"), "utf8").match(/CAREER_HQ_API_KEY=(\S+)/)?.[1]);

if (!KEY) {
  console.error("no API key (pass --key or create engine/.engine-env)");
  process.exit(1);
}

const report = JSON.parse(readFileSync(join(here, "reconciliation-report.json"), "utf8"));
const entities = report.full_entities;
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

async function api(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

const created = { opportunities: 0, deduped: 0, applications: 0, app_deduped: 0, csv_apps: 0, errors: [] };
const entityOpportunityIds = new Map();

// 1) upsert all entities as opportunities
for (const e of entities) {
  const simhash =
    e.simhash ??
    (e.company && e.role ? `atlas-${norm(e.company)}-${norm(e.role)}` : e.role ? `atlas-pub-${norm(e.role)}` : null);
  try {
    const r = await api("/api/engine/opportunities", {
      kind: e.kind ?? "other",
      company: e.company ?? null,
      role: e.role ?? null,
      location: e.location ?? null,
      url: e.url ?? null,
      source: e.source === "muse" ? "muse" : e.source === "chrome-audit" ? "chrome-audit" : "import",
      description: e.notes ?? null,
      deadline_at: e.deadline_at ?? null,
      deadline_tz: e.deadline_tz ?? null,
      deadline_verified: e.deadline_verified ? 1 : 0,
      liveness: e.liveness ?? "uncertain",
      priority: e.priority ?? null,
      simhash,
      company_key: e.company ? norm(e.company) : null,
      verification_note: e.verification_note ?? null,
      notes: (e.flags ?? []).length ? `flags: ${e.flags.join("; ")}` : null,
    });
    entityOpportunityIds.set(`${norm(e.company)}|${norm(e.role)}`, r.opportunity.id);
    r.deduped ? created.deduped++ : created.opportunities++;
  } catch (err) {
    created.errors.push(String(err));
  }
}

// 2) confirmed/unconfirmed submissions → applications linked to their opportunity
for (const e of entities) {
  if (e.application_state !== "submitted") continue;
  const oid = entityOpportunityIds.get(`${norm(e.company)}|${norm(e.role)}`);
  try {
    const r = await api("/api/engine/applications", {
      company: e.company ?? "unknown",
      role: e.role ?? "unknown",
      url: e.url ?? null,
      applied_date: e.applied_date ?? null,
      status: "applied",
      source: "import",
      opportunity_id: oid ?? undefined,
      notes: [e.date_confirmed ? "submission confirmed in Atlas" : "submission date unverified", e.verification_note]
        .filter(Boolean)
        .join(" · "),
    });
    r.deduped ? created.app_deduped++ : created.applications++;
  } catch (err) {
    created.errors.push(String(err));
  }
}

// 3) CSV rows that had no matching entity → applications
for (const row of report.reconciliation.csv_rows_not_in_opportunities ?? []) {
  // rows are rendered strings; the raw CSV is re-parsed here for fields
}
let csvRaw = [];
try {
  const { existsSync } = await import("node:fs");
  const csvPath = join(homedir(), "Faiz-Atlas/memory/application-history.csv");
  if (existsSync(csvPath)) {
    const text = readFileSync(csvPath, "utf8");
    const rows = parseCsvLoose(text);
    const entityKeys = new Set(entities.map((e) => `${norm(e.company)}|${norm(e.role)}`));
    for (const r of rows) {
      const k = `${norm(r.company)}|${norm(r.role)}`;
      if (entityKeys.has(k)) continue;
      const fuzzy = entities.some(
        (e) => norm(e.company) === norm(r.company) && e.role && norm(e.role) !== norm(r.role),
      );
      if (fuzzy) continue; // already covered by a fuzzy-matched entity
      try {
        const r2 = await api("/api/engine/applications", {
          company: r.company || "unknown",
          role: r.role || "unknown",
          url: r.job_url || null,
          applied_date: r.application_date || null,
          status: "applied",
          source: "linkedin-export",
          notes:
            norm(r.company) === "unknown"
              ? "imported from LinkedIn export; company/role unknown"
              : "imported from LinkedIn export; no opportunities.md entry",
        });
        r2.deduped ? created.app_deduped++ : created.csv_apps++;
      } catch (err) {
        created.errors.push(String(err));
      }
    }
  }
} catch (err) {
  created.errors.push(String(err));
}

// 4) audit entry
try {
  await api("/api/engine/sync-log", {
    target_file: "opportunities.md + application-history.csv",
    action: "import",
    status: "done",
    diff_summary: `import: ${created.opportunities} new + ${created.deduped} deduped opportunities; ${created.applications} new + ${created.app_deduped} deduped applications; ${created.csv_apps} csv-only applications`,
  });
} catch (err) {
  created.errors.push(String(err));
}

function parseCsvLoose(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  const H = header.map((h) => h.trim());
  return data.filter((r) => r.length >= 6).map((r) => Object.fromEntries(H.map((h, i) => [h, r[i]?.trim() ?? ""])));
}

writeFileSync(join(here, "commit-result.json"), JSON.stringify(created, null, 2));
console.log("=== COMMIT RESULT ===");
console.log(JSON.stringify(created, null, 2));
