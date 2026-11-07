#!/usr/bin/env node
// cover-letter-engine.mjs — EVERY capability needed to process a cover letter
// in ONE file: the anti-slop lint gate, the fact-loss diff, the four LLM
// phase prompts (fit → draft → revise → cold read), and the career-hq API
// client. Zero dependencies, Node >= 20. Copy this file anywhere.
//
// Commands:
//   lint <file.md> [--cv-facts <path>]        anti-slop gate (exit 0 = pass)
//   factdiff <before> <after>                 fail if fact tokens were lost
//   prompts [strategy|fit|draft|editor|reader|all]  the LLM phase prompts
//   api get-application <id>                  career-hq read
//   api push-document <json>                  career-hq write
//   api push-fit <json>                       career-hq write
//   api set-status <appId> <status> [note]    career-hq write (queues mirror)
//   help
//
// The PIPELINE (what any agent does with this file):
//   1. api get-application <id>            → posting + context
//   2. `prompts strategy`                  → the design logic (fear, thesis, map)
//   3. `prompts fit`                       → evidence-disciplined fit analysis
//   4. `prompts draft`                     → voice-true draft (≤380 words)
//   5. lint draft.md                       → must exit 0 (revise ≤4 rounds)
//   6. after every revision: factdiff prev.md draft.md   → must exit 0
//   7. `prompts reader`                    → cold read; fix or remove flags
//   8. api push-document '<json>'          → into the dashboard
//   9. HUMAN confirms before anything is submitted anywhere. Non-negotiable.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);

// ─────────────────────────────────────────────────────────────────────────────
// 1. LINT — banned formulations, cadence, specificity
// ─────────────────────────────────────────────────────────────────────────────

const BANNED = [
  { pattern: "it is important to note", rule: "staged-importance" },
  { pattern: "it is worth noting", rule: "staged-importance" },
  { pattern: "notably,", rule: "staged-importance" },
  { pattern: "not merely", rule: "not-x-but-y" },
  { pattern: "not just .{1,40}, but", rule: "not-x-but-y", regex: true },
  { pattern: "not only .{1,40}, but", rule: "not-x-but-y", regex: true },
  { pattern: "pivotal", rule: "inflation" },
  { pattern: "transformative", rule: "inflation" },
  { pattern: "groundbreaking", rule: "inflation" },
  { pattern: "seamless", rule: "inflation" },
  { pattern: "tapestry", rule: "abstract-substitution" },
  { pattern: "\\brealm of\\b", rule: "abstract-substitution", regex: true },
  { pattern: "vibrant", rule: "inflation" },
  { pattern: "paves the way", rule: "inflation" },
  { pattern: "experts (?:argue|say|agree)", rule: "vague-authority", regex: true },
  { pattern: "research (?:shows|suggests)\\b(?!\\s+that\\s+[^.]{0,80}\\b\\(?(?:[A-Z][a-z]+ et al|OECD|World Bank|ILO|IRENA|IEA))", rule: "vague-authority", regex: true },
  { pattern: "critics (?:say|argue|claim)", rule: "vague-authority", regex: true },
  { pattern: "serves as a testament", rule: "inflation", regex: true },
  { pattern: "stands as", rule: "copula-avoidance" },
  { pattern: "in order to", rule: "filler" },
  { pattern: "due to the fact that", rule: "filler" },
  { pattern: "certainly,", rule: "assistant-residue" },
  { pattern: "i hope this helps", rule: "assistant-residue" },
  { pattern: "here is an overview", rule: "assistant-residue" },
  { pattern: "delve into", rule: "inflation" },
  { pattern: "in today'?s (?:rapidly )?(?:evolving|changing)", rule: "canned-arc", regex: true },
  { pattern: "at the forefront of", rule: "inflation" },
  { pattern: "the harder test", rule: "stock-verdict" },
  { pattern: "the real question is", rule: "stock-verdict" },
  { pattern: "that distinction matters", rule: "stock-verdict" },
];

const GENERIC_CV_FACTS = {
  forbidden_phrases: [],
  warn_phrases: ["world-class", "industry-leading", "extensive experience", "proven leader"],
};

function loadCvFacts(explicit) {
  const candidates = explicit
    ? [explicit]
    : [
        join(here, ".cv-facts.json"),
        join(homedir(), "Documents/Codex/2026-09-16/sh/career-ops-data/config/cv-facts.json"),
      ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return { path: p, facts: JSON.parse(readFileSync(p, "utf8")) };
    } catch {}
  }
  return { path: null, facts: GENERIC_CV_FACTS };
}

function lint(text, facts) {
  const violations = [];
  const warnings = [];
  for (const b of BANNED) {
    const re = b.regex ? new RegExp(b.pattern, "i") : new RegExp(b.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const m = text.match(re);
    if (m) violations.push({ rule: b.rule, match: m[0], index: m.index });
  }
  const lower = text.toLowerCase();
  for (const p of facts.forbidden_phrases ?? []) {
    if (p && lower.includes(p.toLowerCase())) violations.push({ rule: "cv-facts-forbidden", match: p });
  }
  for (const p of facts.warn_phrases ?? []) {
    if (p && lower.includes(p.toLowerCase())) warnings.push({ rule: "cv-facts-warn", match: p });
  }
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const lens = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const cv = lens.length > 1 ? Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length) / (mean || 1) : 1;
  const concrete = (text.match(/\b\d[\d.,%$€_rp]*\b|\b(?:19|20)\d{2}\b/g) ?? []).length;
  const per100 = words.length ? (concrete / words.length) * 100 : 0;
  if (sentences.length >= 6 && cv < 0.35) warnings.push({ rule: "uniform-cadence", detail: `length CV ${cv.toFixed(2)} < 0.35` });
  if (words.length > 80 && per100 < 1.2) warnings.push({ rule: "low-specificity", detail: `${per100.toFixed(2)} concrete tokens/100w < 1.2` });
  const shortRuns = (text.match(/([A-Z][^.!?]{10,60}\.\s){3,}/g) ?? []).length;
  if (shortRuns > 0) warnings.push({ rule: "short-declarative-run", detail: `${shortRuns} run(s)` });
  return {
    pass: violations.length === 0,
    violations,
    warnings,
    stats: {
      words: words.length,
      sentences: sentences.length,
      mean_sentence_length: Number(mean.toFixed(1)),
      length_cv: Number(cv.toFixed(2)),
      concrete_per_100w: Number(per100.toFixed(2)),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. FACTDIFF — a revision may rephrase, never lose a fact token
// ─────────────────────────────────────────────────────────────────────────────

function factTokens(text) {
  const tokens = new Set();
  for (const m of text.matchAll(/https?:\/\/[^\s)\]>"]+/g)) tokens.add(m[0]);
  for (const m of text.matchAll(/\b(?:19|20)\d{2}\b/g)) tokens.add(m[0]);
  for (const m of text.matchAll(/\b\d[\d.,]*(?:\s?(?:%|billion|million|thousand|bn|mn|yrs?|years?|projects?|markets?|records?))?\b/gi)) {
    tokens.add(m[0].trim().toLowerCase());
  }
  return tokens;
}

function factdiff(beforeText, afterText) {
  const before = factTokens(beforeText);
  const after = factTokens(afterText);
  const lost = [...before].filter((t) => !after.has(t) && ![...after].some((a) => a.includes(t) || t.includes(a)));
  return { ok: lost.length === 0, before: before.size, after: after.size, lost };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. PROMPTS — the four LLM phases. An agent prints these and follows them,
//    substituting the <...> placeholders with real paths and posting text.
// ─────────────────────────────────────────────────────────────────────────────

const PROMPTS = {
  strategy: `COVER LETTER DESIGN LOGIC — the reasoning before the writing. Apply ALL eight rules, in order, before drafting a word.

1. Find the anxiety behind the posting. Listed requirements are the surface. Ask: why does this role exist, what does the hiring manager fear getting wrong? Write ONE sentence naming that fear. (Example: a commodity-markets practice hiring early-career means "we need client-safe rigor and credible energy-transition fluency on day one.")
2. Positioning is who the candidate is FOR THIS EMPLOYER — one sentence, not a biography. Every paragraph serves that thesis; anything impressive-but-off-thesis gets cut. Selectivity signals judgment.
3. Map each need to the candidate's closest TRUE asset, at honest distance: Direct needs are load-bearing (cite their numbers); Adjacent needs get converted, not stretched — name the bridge yourself ("investment-flow analysis, not corporate valuation"); Gaps get rule 4. Never let Adjacent masquerade as Direct.
4. The disclosure move — for a real gap: [honest statement] + [transferable substrate] + [specific commitment]. Example: "I have not used Power BI yet; the data work underneath is the hard part, and I am ready to build the client dashboards in it." Volunteered weakness is a credibility asset; discovered weakness is a rejection.
5. Open on the intersection: the first paragraph is the single most concrete overlap between their anxiety and the candidate's evidence, carrying its number. Never "I am writing to apply."
6. Every claim carries its number. "52 projects across 10 markets" beats "extensive experience" — numbers persuade, adjectives hide.
7. Sound like the author of the CV: their rhythm, their hedges ("that is methods, not commodity experience"), plain verbs. The reader should recognize the person behind the CV.
8. Close on proof, not eagerness: live dashboards, published work — offer to walk through evidence. Enthusiasm offers nothing.

Output before drafting: the fear sentence (rule 1), the positioning sentence (rule 2), and the need→asset map with distances (rule 3).`,
  fit: `You are a fit analyst with evidence discipline. Read the candidate's CV and CV bank, plus the posting text below.
For EVERY meaningful posting requirement, classify candidate evidence as Direct / Adjacent / Gap / Unknown, each with a source citation (file + line/section).
Never invent experience. Absent facts are null; unverifiable caveats go to notes, never into claims.
Also read BEYOND the listed requirements: infer the anxiety behind the posting — why the role exists and what the hiring manager fears getting wrong — and assess the candidate against that too.
Output JSON: {"score": 0-10, "summary": "two-sentence positioning angle (who the candidate is FOR THIS employer)", "evidence": [{"claim","cls","source"}], "gaps": [..], "notes": "forbidden-claim boundaries, location/visa caveats"}.
Score honestly — do not inflate. Posting: <POSTING_TEXT>`,
  draft: `You write cover letters that read like one specific human, not like AI.
First apply the design logic: name the anxiety behind the posting (one sentence), fix the positioning thesis (who the candidate is FOR THIS employer), map needs to evidence at honest distance, then draft.
HARD RULES — concise, factual English; natural, confident, direct, evidence-bounded; every claim traceable to the CV or CV bank; no invented facts.
Banned: staged importance ("It is important to note"), not-X-but-Y constructions, inflation words (pivotal/transformative/groundbreaking/seamless), vague authority ("research shows" without a named source), "delve", assistant residue, filler ("in order to"), canned arcs ("In today's rapidly evolving...").
Open on the most concrete relevant point — the intersection of their anxiety and the candidate's strongest number. Use ONLY evidence the fit analysis marked Direct or Adjacent; convert Adjacent by naming the bridge; never stretch Adjacent into Direct. Address what the posting actually asks for. EN, max 380 words.
Gaps: use the disclosure move — [honest statement] + [transferable substrate] + [specific commitment]. Volunteered weakness ("I have not used X yet; the underlying skill is the hard part") is a credibility asset; glossing is not.
Close on proof, not eagerness — live work the reader can open.
Forbidden claims list at <CV_FACTS_PATH> is absolute. Write the letter to <OUT_PATH>. Return the file path.`,
  editor: `You revise a cover letter to pass the lint gate WITHOUT losing a single fact.
Preserve every number, date, name, URL and claim verbatim; change only formulation. After each revision run: factdiff <previous> <revised> (must pass) and lint <revised> (must exit 0).
If the gate demands something impossible, escalate plainly instead of faking a pass.`,
  reader: `You read the letter COLD, with only the candidate's source documents in hand. You have seen no earlier draft.
Find what would embarrass the candidate: claims the CV does not support, numbers absent from every source, tone slipping into AI cadence, vagueness where a fact should be, an Adjacent claim dressed up as Direct.
Also verify posting-dependent statements against the actual posting text if provided. Do not edit any file.
Output: {"issues": [...], "mustFix": true|false}. Specific and evidence-cited, or nothing.`,
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. API CLIENT — career-hq (D1-backed, Bearer key)
// ─────────────────────────────────────────────────────────────────────────────

function apiConfig() {
  let base = process.env.CAREER_HQ_URL ?? "https://career-hq.2mpnxm9fdn.workers.dev";
  try {
    const override = readFileSync(join(here, ".api-url"), "utf8").trim();
    if (override) base = override;
  } catch {}
  let key = process.env.CAREER_HQ_API_KEY ?? null;
  if (!key) {
    for (const f of [".engine-env", ".engine-env-dev"]) {
      try {
        const m = readFileSync(join(here, f), "utf8").match(/CAREER_HQ_API_KEY=(\S+)/);
        if (m && ((f === ".engine-env-dev") === /localhost|127\.0\.0\.1/.test(base))) {
          key = m[1];
          break;
        }
      } catch {}
    }
  }
  return { base, key };
}

async function api(path, method = "GET", body) {
  const { base, key } = apiConfig();
  if (!key) {
    console.error(JSON.stringify({ error: "no api key (engine/.engine-env or CAREER_HQ_API_KEY)" }));
    process.exit(2);
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(JSON.stringify({ error: res.status, detail: json }));
    process.exit(1);
  }
  return json;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const argOf = (name, def) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : def;
};

switch (cmd) {
  case "lint": {
    const file = rest[0];
    if (!file) { console.error("usage: lint <file.md> [--cv-facts <path>]"); process.exit(2); }
    const { path: factsPath, facts } = loadCvFacts(argOf("--cv-facts"));
    const report = lint(readFileSync(file, "utf8"), facts);
    console.log(JSON.stringify({ ...report, cv_facts_source: factsPath ?? "embedded-generic" }, null, 2));
    process.exit(report.pass ? 0 : 1);
    break;
  }
  case "factdiff": {
    const [b, a] = rest;
    if (!b || !a) { console.error("usage: factdiff <before> <after>"); process.exit(2); }
    const r = factdiff(readFileSync(b, "utf8"), readFileSync(a, "utf8"));
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
    break;
  }
  case "prompts": {
    const which = rest[0] ?? "all";
    if (which === "all") {
      for (const [k, v] of Object.entries(PROMPTS)) console.log(`\n═══ ${k.toUpperCase()} ═══\n${v}`);
    } else if (PROMPTS[which]) {
      console.log(PROMPTS[which]);
    } else {
      console.error("phases: fit | draft | editor | reader | all");
      process.exit(2);
    }
    break;
  }
  case "api": {
    const sub = rest[0];
    if (sub === "get-application") console.log(JSON.stringify(await api(`/api/engine/applications/${rest[1]}`)));
    else if (sub === "push-document") console.log(JSON.stringify(await api("/api/engine/documents", "POST", JSON.parse(rest[1]))));
    else if (sub === "push-fit") console.log(JSON.stringify(await api("/api/engine/fit", "POST", JSON.parse(rest[1]))));
    else if (sub === "set-status") console.log(JSON.stringify(await api(`/api/engine/applications/${rest[1]}/status`, "POST", { status: rest[2], source: "engine", note: rest[3] })));
    else { console.error("api: get-application | push-document | push-fit | set-status"); process.exit(2); }
    break;
  }
  case "help":
  default:
    console.log(String.raw`cover-letter-engine — single-file cover-letter capability

  lint <file.md> [--cv-facts <path>]     anti-slop gate; exit 0 = pass
  factdiff <before> <after>              fail if fact tokens were lost
  prompts [fit|draft|editor|reader|all]  LLM phase prompts
  api get-application <id>               read application + posting
  api push-document <json>               store final letter (+lint report)
  api push-fit <json>                    store fit analysis
  api set-status <appId> <status> [note] status change (queues Atlas mirror)

Pipeline: api get-application → prompts fit → prompts draft → lint (exit 0)
  → factdiff after every revision → prompts reader → api push-document.
  A HUMAN confirms before any real submission.`);
    process.exit(cmd ? 0 : 2);
}
