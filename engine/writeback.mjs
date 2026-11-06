#!/usr/bin/env node
// career-hq → Atlas write-back mirror (P5).
// Processes pending writeback tasks: claims each from the dashboard API,
// appends an append-only status line to Faiz-Atlas files, reports via sync-log.
//
// Design: never edits prose in opportunities.md — appends to a dedicated
// "## career-hq Sync" section (append-only, matching status-log.tsv semantics)
// and to changelog.md. Atlas stays the mirror; the dashboard DB is canonical.
//
// Usage: node writeback.mjs [--dry-run] [--max N]
// Env/file config: .api-url override + .engine-env key (same as api.mjs)

import { readFileSync, appendFileSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const maxIdx = args.indexOf("--max");
const MAX = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 20;

const BASE =
  process.env.CAREER_HQ_URL ??
  (() => {
    try {
      return readFileSync(join(here, ".api-url"), "utf8").trim();
    } catch {
      return "https://career-hq.2mpnxm9fdn.workers.dev";
    }
  })();
const IS_DEV = /localhost|127\.0\.0\.1/.test(BASE);
const KEY =
  process.env.CAREER_HQ_API_KEY ??
  readFileSync(join(here, IS_DEV ? ".engine-env-dev" : ".engine-env"), "utf8").match(
    /CAREER_HQ_API_KEY=(\S+)/,
  )?.[1];

const OPPS = join(homedir(), "Faiz-Atlas/memory/opportunities.md");
const CHANGELOG = join(homedir(), "Faiz-Atlas/memory/changelog.md");
const HISTORY = join(homedir(), "Faiz-Atlas/memory/application-history.csv");
const MARKER = "## career-hq Sync";

async function api(path, method = "GET", body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return json;
}

function ensureSyncSection(content) {
  if (content.includes(MARKER)) return content;
  const sep = content.endsWith("\n") ? "" : "\n";
  return `${content}${sep}\n${MARKER}\n\nStatus lines appended by career-hq (dashboard is canonical; this section is the mirror). Format: YYYY-MM-DD | application <id> | <company> — <role> | <from> → <to> | note.\n`;
}

function appendStatusLine(task) {
  const p = task.payload_json ? JSON.parse(task.payload_json) : {};
  const date = new Date().toISOString().slice(0, 10);
  const line = `${date} | application ${p.application_id ?? "?"} | ${p.company ?? "?"} — ${p.role ?? "?"} | ${p.from ?? "-"} → ${p.to ?? "-"} | ${p.note ?? "no note"} (career-hq)\n`;
  if (DRY) return line;
  const content = readFileSync(OPPS, "utf8");
  const updated = ensureSyncSection(content);
  if (updated !== content) writeAtomic(OPPS, updated);
  appendFileSync(OPPS, line);
  return line;
}

function writeAtomic(path, content) {
  const tmp = `${path}.career-hq-tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

async function main() {
  const { tasks } = await api("/api/engine/tasks?status=pending");
  const writebacks = tasks.filter((t) => t.kind === "writeback").slice(0, MAX);
  console.log(`pending writeback tasks: ${writebacks.length}`);

  let done = 0;
  for (const t of writebacks) {
    try {
      const app = await api(`/api/engine/applications/${JSON.parse(t.payload_json).application_id}`);
      const line = appendStatusLine({
        payload_json: JSON.stringify({
          ...JSON.parse(t.payload_json),
          company: app.application?.company ?? "?",
          role: app.application?.role ?? "?",
        }),
      });
      // CSV history: confirmed 'applied' transitions gain a row if the URL is new
      const payload = JSON.parse(t.payload_json);
      if (payload.to === "applied" && existsSync(HISTORY)) {
        const content = readFileSync(HISTORY, "utf8");
        const url = app.application?.url ?? "";
        if (url && !content.includes(url)) {
          if (!DRY) {
            appendFileSync(HISTORY, `${payload.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)},${app.application.company},${app.application.role},applied,${url},career-hq-sync\n`);
          }
        }
      }
      if (!DRY) {
        if (existsSync(CHANGELOG)) {
          appendFileSync(CHANGELOG, `\n- ${new Date().toISOString().slice(0, 10)}: career-hq status sync — application ${payload.application_id} (${app.application?.company ?? "?"}) ${payload.from} → ${payload.to}.\n`);
        }
        await api("/api/engine/sync-log", "POST", {
          application_id: payload.application_id,
          target_file: "opportunities.md",
          action: "append_status_line",
          diff_summary: line.trim(),
          status: "done",
        });
        await api(`/api/engine/tasks/${t.id}/complete`, "POST", { result: { mirrored: true } });
      }
      console.log(`  ✓ task ${t.id}: ${line.trim()}`);
      done++;
    } catch (err) {
      console.error(`  ✗ task ${t.id}: ${String(err).slice(0, 200)}`);
      if (!DRY) {
        await api(`/api/engine/tasks/${t.id}/complete`, "POST", { error: String(err).slice(0, 500) }).catch(() => {});
      }
    }
  }
  console.log(DRY ? `dry-run: would mirror ${done} status change(s)` : `mirrored ${done} status change(s)`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
