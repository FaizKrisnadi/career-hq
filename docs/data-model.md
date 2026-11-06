# career-hq — Data Model & API Contract

Canonical reference for the Career Command Center. The D1 database is the
**source of truth** for application state (decision 2026-11-06); Faiz-Atlas
files are mirrors updated via write-back (`sync_log` audits every write).

## Schema

Full DDL: [`app/migrations/0001_init.sql`](../app/migrations/0001_init.sql).

Mappings from the career-ops DATA_CONTRACT:

| D1 table | career-ops file | Notes |
|---|---|---|
| `applications` | `data/applications.md` tracker | tracker `#` is the row id; columns Date/Company/Role/Score/Status/PDF/Report/Notes/URL map 1:1 |
| `status_log` | `data/status-log.tsv` | append-only; `from_status='-'` = no prior state; `to_status='-'` = unknown target; source is a closed set |
| `candidates` | `data/scan-history.tsv` | SimHash col 8, posting date col 9, trust score/flags cols 10–11, normalized company key col 12 |
| `portal_health` | `data/portal-health.tsv` | same vocabulary: reachable/empty/slug_gone/network/auth/server/unknown |
| `postings` | `jds/*` | full JD snapshots |
| `documents`/`doc_versions` | `output/*`, `data/pdf-index.tsv` | text in D1, binaries (docx/pdf) in R2 under `r2_key` |
| `follow_ups` | `data/follow-ups.md` | |
| `interviews` | `data/active-interviews.md` | |
| `outcomes` | `data/outcomes/*` | |
| `salary_observations` | `data/salary-observations.tsv` | desired/advertised/actual |
| `opportunities` | `Faiz-Atlas/memory/opportunities.md` | heterogeneous prose → typed entities; `kind` covers jobs/fellowships/publications/PhDs/programs/events |

## Status model (applications)

`discovered → researching → drafting → ready → applied → interview → offer → outcome`
with exits `rejected`, `withdrawn`. Every transition appends to `status_log`
(manual | engine | import | sweep | sync | correction).

## Liveness & priority (career-opportunity-operations)

Liveness: `live | closed | uncertain | evergreen`.
Priority: `priority | credible | stretch | eligibility_check | monitor | skip_closed`.

## Fit scoring

Fit scores (0–10) live **only** in the dashboard DB. Atlas files stay
score-free. Evidence classes: `Direct / Adjacent / Gap / Unknown`
(career-application-pipeline). Materials respect `cv-facts.json`
(forbidden/warn phrases) and `voice-dna.md`.

## Engine ↔ App API

Base: the deployed Worker URL. All `/api/engine/*` routes require
`Authorization: Bearer <ENGINE_API_KEY>` (Worker secret; UI routes are
session-cookie protected separately).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/engine/health` | liveness probe (no secret required) |
| GET | `/api/engine/tasks?status=pending` | list queued tasks |
| POST | `/api/engine/tasks` | enqueue a task (UI or engine) |
| POST | `/api/engine/tasks/:id/claim` | claim (pending → claimed) |
| POST | `/api/engine/tasks/:id/complete` | finish with result or error |
| POST | `/api/engine/opportunities` | upsert opportunity (from sweep/import) |
| POST | `/api/engine/applications/:id/status` | status change (writes `status_log`, queues write-back) |
| POST | `/api/engine/documents` | push document text + lint results |
| POST | `/api/engine/sync-log` | report Atlas write-back outcome |
| GET | `/api/engine/profile` | read profile pointers (voice-dna, cv-facts, portals.yml paths) |

## Task kinds

`intake · fit · tailor_cv · cover_letter · interview_prep · sweep · writeback · export · import_parse`

The engine (ZCode dynamic workflows) polls `/api/engine/tasks`, claims work,
and pushes results. The UI enqueues tasks; automations enqueue `sweep` and
digest work on a schedule.
