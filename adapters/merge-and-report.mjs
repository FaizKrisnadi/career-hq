#!/usr/bin/env node
// Merge chunk-*.json extractions + application-history.csv into a
// reconciliation report. Dry-run by default; no writes to the API.
// Usage: node merge-and-report.mjs [--csv <path>]
// Reads: ./extract/chunk-*.json   Writes: ./reconciliation-report.json

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const csvIdx = args.indexOf("--csv");
const CSV_PATH =
  csvIdx >= 0
    ? args[csvIdx + 1]
    : join(homedir(), "Faiz-Atlas/memory/application-history.csv");

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const keyOf = (e) =>
  e.company && e.role
    ? `${norm(e.company)}|${norm(e.role)}`
    : e.role
      ? `x|${norm(e.role)}`
      : e.company
        ? `${norm(e.company)}|?`
        : null;

// ---------- load chunks ----------
const entities = [];
for (const f of readdirSync(join(here, "extract")).sort()) {
  if (!f.startsWith("chunk-") || !f.endsWith(".json")) continue;
  const arr = JSON.parse(readFileSync(join(here, "extract", f), "utf8"));
  for (const item of arr) {
    if (item && item.meta) continue; // meta object from chunk D
    entities.push({ ...item, _chunk: f });
  }
  if (arr.find((x) => x && x.meta)) {
    entities.__meta = arr.find((x) => x && x.meta).meta;
  }
}

// ---------- cross-chunk dedupe ----------
const byKey = new Map();
const dupMerges = [];
for (const e of entities) {
  const k = keyOf(e);
  if (!k) {
    dupMerges.push({ dropped: e, reason: "no company and no role" });
    continue;
  }
  if (!byKey.has(k)) {
    byKey.set(k, { ...e, flags: e.flags ?? [], _chunks: [e._chunk] });
    continue;
  }
  const prev = byKey.get(k);
  dupMerges.push({ merged: `${e.company ?? "?"} / ${e.role ?? "?"}`, kept: prev.company, dropped_chunk: e._chunk });
  // merge: prefer confirmed info, latest state, union flags/notes
  prev.application_state =
    prev.application_state === "submitted" ? "submitted" : e.application_state ?? prev.application_state;
  if (e.applied_date && (!prev.applied_date || e.date_confirmed)) {
    prev.applied_date = e.applied_date;
    prev.date_confirmed = e.date_confirmed || prev.date_confirmed;
  }
  if (e.deadline_at && !prev.deadline_at) prev.deadline_at = e.deadline_at;
  if (e.url && !prev.url) prev.url = e.url;
  if (e.location && !prev.location) prev.location = e.location;
  if ((e.priority ?? "") < (prev.priority ?? "") && e.priority) prev.priority = e.priority;
  prev.flags = [...new Set([...(prev.flags ?? []), ...(e.flags ?? [])])];
  prev._chunks.push(e._chunk);
  if (e.notes && !prev.notes?.includes(e.notes)) prev.notes = `${prev.notes ?? ""} | ${e.notes}`.slice(0, 500);
}
const merged = [...byKey.values()];

// ---------- CSV applications ----------
function parseCsv(text) {
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
  return rows;
}

let csvRows = [];
if (existsSync(CSV_PATH)) {
  const [header, ...data] = parseCsv(readFileSync(CSV_PATH, "utf8"));
  const H = header.map((h) => h.trim());
  csvRows = data
    .filter((r) => r.length >= 6)
    .map((r) => Object.fromEntries(H.map((h, i) => [h, r[i]?.trim() ?? ""])));
}

// ---------- match entities ↔ CSV ----------
const csvKeys = new Set(csvRows.map((r) => `${norm(r.company)}|${norm(r.role)}`));
const csvByCompany = new Map();
for (const r of csvRows) {
  const c = norm(r.company);
  if (!csvByCompany.has(c)) csvByCompany.set(c, []);
  csvByCompany.get(c).push(r);
}

const submittedEntities = merged.filter((e) => e.application_state === "submitted");
const matches = [];
const unmatchedCsv = [];
const usedCsv = new Set();
function findCsvMatch(e) {
  const k = `${norm(e.company)}|${norm(e.role)}`;
  if (csvKeys.has(k)) return { key: k, note: "exact" };
  const pool = csvByCompany.get(norm(e.company)) ?? [];
  if (pool.length >= 1) {
    // same normalized company (exact) even if role differs
    return { key: `${norm(pool[0].company)}|${norm(pool[0].role)}`, note: "company-exact, role differs" };
  }
  // prefix containment: "singaporeethcentre" ⊂ "singaporeethcentrefuturecitieslabglobal"
  const ec = norm(e.company);
  if (ec && ec.length >= 6) {
    for (const [c, rows] of csvByCompany) {
      if ((c.startsWith(ec) || ec.startsWith(c)) && Math.min(c.length, ec.length) >= 6) {
        return { key: `${norm(rows[0].company)}|${norm(rows[0].role)}`, note: "company-prefix, role differs" };
      }
    }
  }
  return null;
}
for (const e of submittedEntities) {
  const hit = findCsvMatch(e);
  if (hit) {
    usedCsv.add(hit.key);
    matches.push({ entity: `${e.company} / ${e.role}`, csv: hit.key, note: hit.note });
    if (hit.note !== "exact") e._match_note = hit.note;
  }
}
for (const r of csvRows) {
  const k = `${norm(r.company)}|${norm(r.role)}`;
  if (!usedCsv.has(k)) unmatchedCsv.push(r);
}

// ---------- report ----------
const report = {
  generated_at: new Date().toISOString(),
  entities: {
    total: merged.length,
    merged_duplicates: dupMerges.filter((d) => d.merged).length,
    dropped: dupMerges.filter((d) => d.dropped).length,
    by_kind: countBy(merged, "kind"),
    by_state: countBy(merged, "application_state"),
    submitted_confirmed: merged.filter((e) => e.date_confirmed).length,
    submitted_unconfirmed: merged.filter((e) => e.application_state === "submitted" && !e.date_confirmed).length,
    closed: merged.filter((e) => e.liveness === "closed").length,
    flagged: merged.filter((e) => (e.flags ?? []).length > 0).length,
    deadline_verified: merged.filter((e) => e.deadline_verified).length,
    with_url: merged.filter((e) => e.url).length,
  },
  csv: {
    total_rows: csvRows.length,
    unknown_company_rows: csvRows.filter((r) => norm(r.company) === "unknown").length,
    matched_to_entities: matches.length,
    unmatched_rows: unmatchedCsv.length,
  },
  reconciliation: {
    entity_csv_matches: matches,
    csv_rows_not_in_opportunities: unmatchedCsv.map((r) => `${r.company} / ${r.role} (${r.application_date})`),
    submitted_entities_without_csv_row: submittedEntities
      .filter((e) => !matches.some((m) => m.entity === `${e.company} / ${e.role}`))
      .map((e) => `${e.company ?? "?"} / ${e.role ?? "?"}${e._match_note ? ` [${e._match_note}]` : ""}`),
    flagged_entities: merged
      .filter((e) => (e.flags ?? []).length > 0)
      .map((e) => ({ who: `${e.company ?? "?"} / ${e.role ?? "?"}`, flags: e.flags })),
  },
  meta: entities.__meta ?? null,
  full_entities: merged,
};

function countBy(arr, field) {
  const out = {};
  for (const e of arr) {
    const k = e[field] ?? "unknown";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

writeFileSync(join(here, "reconciliation-report.json"), JSON.stringify(report, null, 2));

// ---------- console summary ----------
console.log("=== RECONCILIATION SUMMARY ===");
console.log(`entities:            ${report.entities.total} (merged dupes: ${report.entities.merged_duplicates}, dropped: ${report.entities.dropped})`);
console.log(`by kind:             ${JSON.stringify(report.entities.by_kind)}`);
console.log(`by state:            ${JSON.stringify(report.entities.by_state)}`);
console.log(`submitted:           confirmed ${report.entities.submitted_confirmed}, unconfirmed ${report.entities.submitted_unconfirmed}`);
console.log(`closed / flagged:    ${report.entities.closed} / ${report.entities.flagged}`);
console.log(`csv rows:            ${report.csv.total_rows} (unknown-company: ${report.csv.unknown_company_rows})`);
console.log(`entity↔csv matches:  ${matches.length}`);
console.log(`csv rows w/o entity: ${report.csv.unmatched_rows}`);
console.log(`entities w/o csv:    ${report.reconciliation.submitted_entities_without_csv_row.length}`);
console.log(`flagged:             ${report.reconciliation.flagged_entities.length}`);
console.log("\nfull report → adapters/reconciliation-report.json");
