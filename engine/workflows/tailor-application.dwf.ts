// career-hq — tailor one application: fit analysis, voice-true cover letter,
// anti-slop lint gate, independent read, push results to the dashboard.

interface Application {
  id: number;
  company: string;
  role: string;
  status: string;
  url: string | null;
}
interface Opportunity {
  company: string | null;
  role: string | null;
  location: string | null;
  url: string | null;
  description: string | null;
}
interface Posting {
  content: string | null;
  title: string | null;
  company: string | null;
  fetched_url: string | null;
}
interface Pulled {
  application: Application | null;
  opportunity: Opportunity | null;
  posting: Posting | null;
}

interface FitResult {
  /** Fit score 0-10 for this candidate against this posting. */
  score: number;
  /** Two sentences: the positioning angle this application should take. */
  summary: string;
  evidence: {
    /** The candidate fact being used. */
    claim: string;
    /** Direct / Adjacent / Gap / Unknown per the career-application-pipeline classes. */
    cls: "Direct" | "Adjacent" | "Gap" | "Unknown";
    /** Which CV source supports it. */
    source: string;
  }[];
  gaps: string[];
}
interface LintReport {
  pass: boolean;
  violations: { rule: string; match: string }[];
  warnings: { rule: string; match?: string; detail?: string }[];
}
interface ReaderVerdict {
  issues: string[];
  /** True when any factual claim lacks support in the CV sources. */
  mustFix: boolean;
}
interface WorkflowReport {
  conclusion: string;
  findings: { where: string; what: string; evidence: string; status: "verified" | "unconfirmed"; severity: "low" | "medium" | "high" }[];
  verified: string[];
  notCovered: string[];
}

const appId = String(args.application_id ?? "1");
const engineDir = String(args.engine_dir ?? "career-hq/engine");
const letterPath = `out/letter-${appId}.md`;

phase("Load engine paths");
const pathsRun = await world.run("node", [`${engineDir}/paths.mjs`]);
let P: Record<string, Record<string, string>> = {};
try {
  P = JSON.parse(pathsRun.stdout) as Record<string, Record<string, string>>;
} catch {
  P = {};
}
const F = P.files ?? {};
const CV = F.cv ?? "";
const CV_BANK = F.cv_bank ?? "";
const VOICE = F.voice_dna ?? "";
const CV_FACTS = F.cv_facts ?? "";
const PROFILE = F.profile_yml ?? "";

phase("Pull the application from career-hq");
const pulled = await world.run("node", [`${engineDir}/api.mjs`, "get-application", appId]);
let data: Pulled | null = null;
try {
  data = JSON.parse(pulled.stdout) as Pulled;
} catch {
  data = null;
}
if (!data || !data.application) {
  const result: WorkflowReport = {
    conclusion: `Could not load application ${appId} from career-hq — nothing was generated.`,
    findings: [],
    verified: [],
    notCovered: [`application ${appId} not found or API unreachable`],
  };
  return result;
}
const app = data.application;
const postingText =
  data.posting?.content ?? data.opportunity?.description ?? "(no posting text stored)";

phase("Score the fit against the CV");
const fitter = agent("Fit analyst", {
  system:
    "You score candidate-role fit with evidence discipline. Every claim must come from the " +
    "candidate's real documents; classify each as Direct, Adjacent, Gap or Unknown. Never invent " +
    "experience. If the posting text is empty or unreadable, say so in the summary rather than guessing.",
});
const fit = await fitter.ask<FitResult>(
  `Read these files:\n- CV: ${CV}\n- CV bank: ${CV_BANK}\n- Profile: ${PROFILE}\n\n` +
    `Application: ${app.company} — ${app.role}${app.url ? ` (${app.url})` : ""}\n` +
    `Location: ${data.opportunity?.location ?? "unspecified"}\n` +
    `Posting text:\n${postingText.slice(0, 6000)}\n\n` +
    `Produce the fit analysis as JSON: score (0-10), summary (the positioning angle), evidence ` +
    `(every meaningful requirement mapped to candidate facts with Direct/Adjacent/Gap/Unknown), ` +
    `gaps (what the posting wants that the CV does not show).`,
);

phase("Draft the cover letter in the candidate's voice");
const drafter = agent("Letter drafter", {
  system:
    "You write job-application cover letters that read like a specific human, not like AI. " +
    "Hard rules from the candidate's voice profile: concise, factual English; natural, confident, " +
    "direct, evidence-bounded; every claim traceable to the CV or CV bank; no invented facts; " +
    "no formulaic AI cadence — no 'It is important to note', no 'not merely X but Y', no " +
    "'pivotal/transformative/groundbreaking', no vague authority like 'research shows' without " +
    "a named source, no 'delve', no staged importance, no assistant residue. Open on the most " +
    "concrete relevant point. Forbidden claim list in cv-facts.json is absolute. If a check is " +
    "impossible to satisfy, escalate and say so plainly rather than working around it.",
});
await drafter.ask<string>(
  `Read:\n- Voice rules: ${VOICE}\n- Forbidden claims: ${CV_FACTS}\n- CV: ${CV}\n- CV bank: ${CV_BANK}\n\n` +
    `Application: ${app.company} — ${app.role}. Posting text:\n${postingText.slice(0, 6000)}\n\n` +
    `Fit analysis to build on: ${JSON.stringify(fit)}\n\n` +
    `Write the cover letter (EN, max 380 words) to the file ${letterPath}. Address what the ` +
    `posting actually asks for; use only evidence the fit analysis marked Direct or Adjacent; ` +
    `name concrete projects and numbers from the CV. Return just the file path.`,
);

phase("Run the anti-slop lint gate and fix violations");
const editor = agent("Letter editor", {
  system:
    "You revise cover letters to pass a lint gate without losing a single fact. Preserve every " +
    "number, date, name, URL and claim; change only formulation. If the gate demands something " +
    "impossible, escalate plainly instead of faking a pass.",
});
let lint: LintReport | undefined;
for (let round = 1; round <= 4; round++) {
  const check = await world.run("node", [`${engineDir}/lint.mjs`, letterPath]);
  try {
    lint = JSON.parse(check.stdout) as LintReport;
  } catch {
    lint = undefined;
  }
  if (check.exitCode === 0 && lint?.pass) break;
  const detail = lint
    ? JSON.stringify({ violations: lint.violations, warnings: lint.warnings })
    : (check.stderr || check.stdout || "lint produced no output").slice(0, 1500);
  await editor.ask<string>(
    `Round ${round}: the lint gate rejected ${letterPath}.\n${detail}\n\n` +
      `Rewrite the flagged formulations. Keep every fact, number and claim exactly as they are.`,
  );
}
const finalLint = await world.run("node", [`${engineDir}/lint.mjs`, letterPath]);
let finalReport: LintReport | undefined;
try {
  finalReport = JSON.parse(finalLint.stdout) as LintReport;
} catch {
  finalReport = undefined;
}

phase("Fresh read for unsupported claims");
const reader = agent("Independent reader", {
  system:
    "You read cover letters cold, with only the candidate's source documents in hand. Your job " +
    "is to find what would embarrass the candidate: claims the CV does not support, numbers that " +
    "do not appear in any source, tone that slips into AI cadence, anything vague where a fact " +
    "should be. Do not edit any file.",
});
const verdict = await reader.ask<ReaderVerdict>(
  `Read the letter at ${letterPath} and these sources:\n- ${CV}\n- ${CV_BANK}\n- forbidden claims: ${CV_FACTS}\n\n` +
    `List every issue: unsupported or invented-sounding claims, wrong numbers, AI-cadence slips, ` +
    `vagueness. Set mustFix=true if any factual claim lacks support in the sources. Be specific.`,
);
if (verdict.mustFix && verdict.issues.length > 0) {
  await editor.ask<string>(
    `The independent reader flagged:\n${verdict.issues.map((i) => `- ${i}`).join("\n")}\n\n` +
      `Fix each issue in ${letterPath}. Facts stay facts: if a claim cannot be supported by the ` +
      `sources, remove or soften it — never keep an unsupported claim.`,
  );
  const recheck = await world.run("node", [`${engineDir}/lint.mjs`, letterPath]);
  if (recheck.exitCode !== 0) {
    await editor.ask<string>(`The revision re-triggered the lint gate:\n${(recheck.stdout || recheck.stderr).slice(0, 1500)}\nFix without touching facts.`);
  }
}

phase("Push the letter and fit score to career-hq");
const letterText = await files.read(letterPath);
const docBody = JSON.stringify({
  application_id: Number(appId),
  kind: "cover_letter",
  language: "en",
  title: `Cover letter — ${app.company} (${app.role})`,
  text_content: letterText,
  lint: finalReport ?? null,
  meta: { fit_score: fit.score, fit_summary: fit.summary, workflow: run.id },
});
const pushDoc = await world.run("node", [`${engineDir}/api.mjs`, "push-document", docBody]);
const pushFit = await world.run("node", [
  `${engineDir}/api.mjs`,
  "push-fit",
  JSON.stringify({
    application_id: Number(appId),
    score: fit.score,
    summary: fit.summary,
    evidence: fit.evidence,
    gaps: fit.gaps,
  }),
]);

await artifact.markdown("letter", letterText, {
  title: `Cover letter — ${app.company}`,
  description: `Fit ${fit.score}/10. Lint ${finalReport?.pass ? "passed" : "with warnings"}.`,
  primary: true,
});

const lintClean = finalLint.exitCode === 0;
return {
  conclusion:
    `Application ${appId} (${app.company} — ${app.role}): fit ${fit.score}/10, cover letter drafted ` +
    `and ${lintClean ? "passed the lint gate" : "needs manual lint review"}, pushed to career-hq.`,
  findings: verdict.issues.map((i) => ({
    where: letterPath,
    what: i,
    evidence: "independent cold read against CV sources",
    status: "unconfirmed" as const,
    severity: "medium" as const,
  })),
  verified: [
    `lint gate exit ${finalLint.exitCode} (banned formulations + cv-facts forbidden claims)`,
    `document push: ${pushDoc.exitCode === 0 ? "ok" : "FAILED"}`,
    `fit push: ${pushFit.exitCode === 0 ? "ok" : "FAILED"}`,
  ],
  notCovered: [
    "humanizer check_facts.js fact-loss diff between revisions (reader phase covers factual support instead)",
    "PDF/docx export (R2 pending enablement)",
  ],
};
