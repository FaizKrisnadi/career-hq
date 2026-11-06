#!/usr/bin/env node
// career-hq lint gate — machine-checkable anti-slop pass for generated materials.
// Usage: node lint.mjs <file.md> [--config lint-config.json] [--cv-facts <cv-facts.json>]
// Exit 0 = pass, 1 = hard violations found. Warnings do not fail the gate.
// Output: JSON report on stdout.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error("usage: node lint.mjs <file.md> [--config p] [--cv-facts p]");
  process.exit(2);
}
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const config = JSON.parse(readFileSync(argOf("--config", join(here, "lint-config.json")), "utf8"));
const cvFactsPath = argOf(
  "--cv-facts",
  join(homedir(), "Documents/Codex/2026-09-16/sh/career-ops-data/config/cv-facts.json"),
);

const text = readFileSync(file, "utf8");
const violations = [];
const warnings = [];

// ---------- banned formulations ----------
for (const b of config.banned) {
  const re = b.regex ? new RegExp(b.pattern, "i") : new RegExp(b.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const m = text.match(re);
  if (m) {
    violations.push({ rule: b.rule, match: m[0], index: m.index });
  }
}

// ---------- cv-facts.json: forbidden (hard) + warn phrases ----------
try {
  const facts = JSON.parse(readFileSync(cvFactsPath, "utf8"));
  const lower = text.toLowerCase();
  for (const p of facts.forbidden_phrases ?? []) {
    if (lower.includes(p.toLowerCase())) {
      violations.push({ rule: "cv-facts-forbidden", match: p });
    }
  }
  for (const p of facts.warn_phrases ?? []) {
    if (lower.includes(p.toLowerCase())) {
      warnings.push({ rule: "cv-facts-warn", match: p });
    }
  }
} catch {
  warnings.push({ rule: "cv-facts-unavailable", match: cvFactsPath });
}

// ---------- stats ----------
const words = text.split(/\s+/).filter(Boolean);
const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
const lens = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
const variance = lens.length > 1 ? Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length) / (mean || 1) : 1;
const concrete = (text.match(/\b\d[\d.,%$€_rp]*\b|\b(?:19|20)\d{2}\b|\b[A-Z][a-z]+(?:ism|ation)\b/g) ?? []).length;
const per100 = words.length ? (concrete / words.length) * 100 : 0;

if (sentences.length >= 6 && variance < config.cadence.min_sentence_length_variance) {
  warnings.push({
    rule: "uniform-cadence",
    detail: `sentence-length CV ${variance.toFixed(2)} < ${config.cadence.min_sentence_length_variance}`,
  });
}
if (words.length > 80 && per100 < config.specificity.min_concrete_tokens_per_100_words) {
  warnings.push({
    rule: "low-specificity",
    detail: `${per100.toFixed(2)} concrete tokens/100w < ${config.specificity.min_concrete_tokens_per_100_words}`,
  });
}
const shortRuns = (text.match(/([A-Z][^.!?]{10,60}\.\s){3,}/g) ?? []).length;
if (shortRuns > 0) {
  warnings.push({ rule: "short-declarative-run", detail: `${shortRuns} run(s)` });
}

const report = {
  file,
  pass: violations.length === 0,
  violations,
  warnings,
  stats: {
    words: words.length,
    sentences: sentences.length,
    mean_sentence_length: Number(mean.toFixed(1)),
    length_cv: Number(variance.toFixed(2)),
    concrete_tokens: concrete,
    concrete_per_100w: Number(per100.toFixed(2)),
  },
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
