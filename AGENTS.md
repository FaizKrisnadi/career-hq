# AGENTS.md — operating guide for AI agents

This repo is a Career Command Center. Any agent (Codex, Claude Code, Cursor,
Gemini CLI, or a human) can operate it. Read this file plus
`docs/data-model.md` before doing anything.

## Components

- `app/` — vinext (Next.js API on Vite) dashboard deployed to Cloudflare
  Workers. D1 database is the source of truth. UI + `/api/engine/*` REST API.
- `engine/` — agent-side Node scripts (no dependencies, Node >= 20):
  - `cover-letter-engine.mjs` — **single-file cover-letter capability**: lint gate, fact-loss diff, all four LLM phase prompts, API client. Self-contained; copy anywhere.
  - `api.mjs` — API client (all commands: `node engine/api.mjs` prints usage)
  - `lint.mjs` — anti-slop gate for generated documents (exit 0 = pass)
  - `writeback.mjs` — mirrors status changes into the user's local note files
  - `read-portals.mjs` — parses job-sweep search configuration to JSON
  - `paths.mjs` — resolves machine paths (`engine/.paths.json`, gitignored;
    copy from `paths.example.json`)
  - `workflows/*.dwf.ts` — ZCode dynamic-workflow scripts; treat them as the
    executable spec of the pipelines below on any other agent
- `adapters/` — one-shot bootstrap importers

## Environment

- API base: `https://career-hq.<subdomain>.workers.dev` (or localhost:5173 in
  dev). Override with `.api-url` (single line) next to `api.mjs`.
- Key: `ENGINE_API_KEY` Worker secret = dashboard login key = the value in
  `engine/.engine-env` (gitignored). All `/api/engine/*` calls need
  `Authorization: Bearer <key>`.
- Never commit or print the key. Never commit anything under
  `adapters/extract/`, `engine/out/`, or the report JSONs — they carry the
  user's private career data.

## Pipeline: tailor an application (cover letter)

Given an application id:

1. `node engine/api.mjs get-application <id>` → application + opportunity +
   posting text.
2. **Fit analysis** — read the CV sources from `paths.mjs` (`files.cv`,
   `files.cv_bank`) and the posting. Every claim classified Direct / Adjacent /
   Gap / Unknown with a source citation. Never invent experience. Record via
   `node engine/api.mjs push-fit '<json>'`.
3. **Draft** the cover letter (EN, ≤380 words) constrained by:
   - `files.voice_dna` — voice rules
   - `files.cv_facts` — forbidden claims (absolute) + warn phrases
   - Only Direct/Adjacent evidence. Open on the most concrete relevant point.
   - Banned: staged importance ("It is important to note"), not-X-but-Y,
     inflation words (pivotal/transformative/groundbreaking), vague authority
     ("research shows" without a named source), "delve", assistant residue,
     filler ("in order to"). Write to a local `out/letter-<id>.md`.
4. **Gate**: `node engine/lint.mjs out/letter-<id>.md` must exit 0. On
   violations, revise formulation only — every fact, number and name is
   preserved verbatim — and re-lint (max 4 rounds).
5. **Cold read**: a separate pass with fresh context checks every factual
   claim against the CV sources and flags anything unsupported. Fix or remove.
6. **Push**: `node engine/api.mjs push-document '<json>'` with the final text
   and lint results.

## Pipeline: opportunity sweep

1. `node engine/read-portals.mjs` → search queries + hard filters (title
   positive/negative, location allow-list, max posting age).
2. For each query: web-search, **fetch and read the actual posting page** —
   only postings whose URL you verified count. Apply the filters, dedupe.
3. Score each survivor against the CV (one calibrated pass across the batch).
4. `node engine/api.mjs push-candidate '<json>'` — the API dedupes by simhash
   and company key. Candidates wait in the inbox for human promotion.

## Hard rules

- The dashboard DB is canonical. Atlas/note files are mirrors, updated only
  through `engine/writeback.mjs` (append-only, never edit prose in place).
- Status changes go through the API (`set-status`) so the ledger and
  write-back queue stay consistent.
- **Never submit an application anywhere without explicit human confirmation
  at the submit step.** Drafting, files, portal entry are separate gates.
- Do not fabricate deadlines, salaries, or requirements absent from the
  posting text. Mark unverifiable fields, never guess.

## Dev & deploy

```sh
cd app && npm install
npm run dev        # local (Miniflare-simulated D1 + R2)
npm run build && npx cf deploy --prebuilt
npx cf d1 migrations apply <db-uuid> [--local]   # migrations in app/migrations/
```
