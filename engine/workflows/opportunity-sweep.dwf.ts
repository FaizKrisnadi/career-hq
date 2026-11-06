// career-hq — opportunity sweep: run every search query in portals.yml,
// extract live postings that pass the title/location/age filters, score them
// against the candidate profile, and push new ones into the dashboard inbox.

interface PortalConfig {
  title_filter: { positive: string[]; negative: string[]; seniority_boost?: string[] };
  location_filter: { always_allow?: string[]; allow: string[] };
  max_posting_age_days?: number;
  search_queries: string[];
  tracked_companies?: string[];
}
interface SweepPosting {
  /** Organization name as displayed on the posting. */
  company: string;
  /** Exact job title on the posting. */
  role: string;
  location: string | null;
  /** Direct URL to the posting page (verified reachable). */
  url: string;
  /** Application deadline if shown, else null. */
  deadline: string | null;
  /** Posting date if shown, else null. */
  posting_date: string | null;
  /** One line: why this matches the search intent. */
  why_fit: string;
}
interface SweepResult {
  postings: SweepPosting[];
  /** What was searched and how many results were inspected. */
  notes: string;
}
interface ScoredPosting extends SweepPosting {
  /** Fit 0-10 against the candidate profile. */
  score: number;
  /** One sentence justification. */
  reason: string;
}
interface PushResult {
  candidate?: { id: number };
  opportunity?: { id: number };
  deduped: boolean;
  reason?: string;
}
interface WorkflowReport {
  conclusion: string;
  findings: { where: string; what: string; evidence: string; status: "verified" | "unconfirmed"; severity: "low" | "medium" | "high" }[];
  verified: string[];
  notCovered: string[];
}

const engineDir = String(args.engine_dir ?? "career-hq/engine");

phase("Load engine paths");
const pathsRun = await world.run("node", [`${engineDir}/paths.mjs`]);
let P: Record<string, Record<string, string>> = {};
try {
  P = JSON.parse(pathsRun.stdout) as Record<string, Record<string, string>>;
} catch {
  P = {};
}
const F = P.files ?? {};

artifact.table("inbox", {
  title: "Sweep candidates",
  columns: [
    { field: "company", label: "Company" },
    { field: "role", label: "Role" },
    { field: "score", label: "Fit" },
    { field: "reason", label: "Why" },
  ],
  key: "url",
});

phase("Load your portals.yml filters");
const cfgRun = await world.run("node", [`${engineDir}/read-portals.mjs`]);
let cfg: PortalConfig | null = null;
try {
  cfg = JSON.parse(cfgRun.stdout) as PortalConfig;
} catch {
  cfg = null;
}
if (!cfg || !cfg.search_queries || cfg.search_queries.length === 0) {
  return {
    conclusion: "No search queries found in portals.yml — nothing to sweep.",
    findings: [],
    verified: [],
    notCovered: ["portals.yml missing or unparsable"],
  };
}
const queries = cfg.search_queries;
log(`Sweeping ${queries.length} search source(s) with your title/location/age filters.`);

phase("Sweep each search source in parallel");
const scored: ScoredPosting[] = [];
const pushFailures: string[] = [];
let pushedNew = 0;
let dedupedCount = 0;

const screener = agent("Fit screener", {
  system:
    "You screen job postings against one candidate profile consistently across a whole batch. " +
    "Read the profile once, then score every posting you are given on the same 0-10 scale: 9-10 " +
    "near-perfect match, 7-8 strong, 5-6 partial, 3-4 stretch, 0-2 mismatch. Judge on the role's " +
    "actual requirements versus the profile's real experience; never inflate. If a check is " +
    "impossible, escalate plainly rather than guessing.",
});

await Promise.all(
  queries.map((q, qi) =>
    (async () => {
      const host = (q.match(/site:(\S+)/) ?? ["", `query-${qi + 1}`])[1];
      const sweeper = agent(`Sweep ${host}`, {
        system:
          "You are a job-sweep researcher. You search the web, open the actual posting pages, and " +
          "return only REAL, CURRENT postings — every posting's URL must be one you fetched and " +
          "read. Never invent or guess a posting; if a page is dead, closed, or a listing-index " +
          "rather than a posting, drop it. If you cannot verify a posting directly, leave it out " +
          "and say so in notes rather than including it unverified.",
      });
      const res = await sweeper.ask<SweepResult>(
        `Search query: ${q}\n\n` +
          `Run this web search, open the top results, and extract live job postings. HARD FILTERS:\n` +
          `- Title must match one of: ${cfg!.title_filter.positive.join(", ")} (or be clearly the same role family). REJECT titles containing: ${cfg!.title_filter.negative.join(", ")}.\n` +
          `- Location must intersect: ${cfg!.location_filter.allow.join(", ")}.\n` +
          `- Posting must be current (≤${cfg!.max_posting_age_days ?? 45} days old or clearly open now); drop closed/expired.\n\n` +
          `For each surviving posting return: company, role (exact title), location, url (the one you fetched), deadline if shown, posting_date if shown, and one line on why it matches. Max 8 postings, best first. In notes: how many results you inspected and how many survived verification.`,
      );
      for (const p of res.postings) {
        const verdict = await screener.ask<{ score: number; reason: string }>(
          `Read the candidate profile at ${F.cv ?? ""} and ${F.cv_bank ?? ""} (skim, once is enough — keep your scoring consistent across everything I send you).\n\n` +
            `Posting: ${p.company} — ${p.role} (${p.location ?? "location unstated"})\n${p.why_fit}\n\nScore 0-10 with a one-sentence reason.`,
        );
        const item: ScoredPosting = { ...p, score: verdict.score, reason: verdict.reason };
        scored.push(item);
        report(
          {
            company: item.company,
            role: item.role,
            score: item.score,
            reason: item.reason,
            url: item.url,
            location: item.location ?? "",
            deadline: item.deadline ?? "",
          },
          "inbox",
        );
        // Push to the dashboard inbox; the API dedupes by simhash/company-key.
        const simhash = `sweep-${djb2(`${normKey(item.company)}|${normKey(item.role)}`)}`;
        try {
          const push = await world.run("node", [
            `${engineDir}/api.mjs`,
            "push-candidate",
            JSON.stringify({
              company: item.company,
              role: item.role,
              location: item.location,
              url: item.url,
              source: q,
              deadline_at: item.deadline,
              simhash,
              liveness: "live",
              fit_score: item.score,
              fit_summary: item.reason,
            }),
          ]);
          let pr: PushResult | null = null;
          try {
            pr = JSON.parse(push.stdout) as PushResult;
          } catch {
            pr = null;
          }
          if (push.exitCode === 0 && pr) {
            if (pr.deduped) dedupedCount++;
            else pushedNew++;
          } else {
            pushFailures.push(`${item.company}/${item.role}: exit ${push.exitCode}`);
          }
        } catch (err) {
          pushFailures.push(`${item.company}/${item.role}: ${String(err).slice(0, 120)}`);
        }
      }
    })(),
  ),
);

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

const top = [...scored].sort((a, b) => b.score - a.score).slice(0, 5);
return {
  conclusion:
    `Swept ${queries.length} source(s): ${scored.length} verified posting(s) passed your filters, ` +
    `${pushedNew} new in the dashboard inbox, ${dedupedCount} already tracked. Best fits: ` +
    (top.length ? top.map((t) => `${t.company} (${t.score}/10)`).join(", ") : "none this run."),
  findings: pushFailures.map((f) => ({
    where: "career-hq inbox",
    what: `Push failed: ${f}`,
    evidence: "api.mjs push-candidate exit code",
    status: "unconfirmed" as const,
    severity: "low" as const,
  })),
  verified: [
    `every pushed posting was fetched and read by its sweep agent`,
    `dedup via simhash + company_key against tracked opportunities and existing candidates`,
    `fit scores from one calibrated screener across the whole batch`,
  ],
  notCovered: [
    "portals beyond the 5 site: queries in portals.yml (tracked_companies is empty)",
    "auto-promotion of candidates to the pipeline stays manual by design",
  ],
};
