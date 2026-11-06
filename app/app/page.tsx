import Link from "next/link";
import { requireSession } from "@/lib/session";
import { countsByStatus, recentTransitions, upcomingDeadlines, STATUS_ORDER } from "@/lib/queries";

function heat(daysLeft: number | null, verified: number): string {
  if (daysLeft === null) return "text-zinc-500";
  if (daysLeft < 0) return "text-red-400 font-semibold";
  if (daysLeft <= 3) return "text-red-400";
  if (daysLeft <= 7) return "text-amber-400";
  if (daysLeft <= 30) return "text-sky-400";
  return "text-zinc-400";
}

function daysLabel(daysLeft: number | null, verified: number): string {
  if (daysLeft === null) return "no deadline";
  const v = verified ? "" : "?";
  if (daysLeft < 0) return `overdue ${-daysLeft}d${v}`;
  if (daysLeft === 0) return `today${v}`;
  return `${daysLeft}d left${v}`;
}

export default async function OverviewPage() {
  await requireSession();
  const [counts, deadlines, transitions] = await Promise.all([
    countsByStatus(),
    upcomingDeadlines(),
    recentTransitions(8),
  ]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const applied = counts["applied"] ?? 0;
  const interview = counts["interview"] ?? 0;
  const offer = counts["offer"] ?? 0;
  const urgent = deadlines.filter((d) => d.days_left !== null && d.days_left <= 7).slice(0, 6);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-xl font-semibold text-zinc-100 mb-4">Overview</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Tracked" value={total} />
          <Stat label="Applied" value={applied} />
          <Stat label="Interviews" value={interview} />
          <Stat label="Offers" value={offer} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-400 mb-2">Funnel</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {STATUS_ORDER.map((s, i) => (
            <span key={s} className="flex items-center gap-2">
              {i > 0 && <span className="text-zinc-700">→</span>}
              <span className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1">
                <span className="text-zinc-400">{s}</span>{" "}
                <span className="text-zinc-100 font-semibold">{counts[s] ?? 0}</span>
              </span>
            </span>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-zinc-400">Urgent deadlines (≤7 days)</h2>
          <Link href="/calendar" className="text-xs text-zinc-500 hover:text-zinc-300">all deadlines →</Link>
        </div>
        {urgent.length === 0 ? (
          <p className="text-sm text-zinc-600">Nothing urgent.</p>
        ) : (
          <ul className="divide-y divide-zinc-900 border border-zinc-900 rounded">
            {urgent.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>
                  <span className="text-zinc-200">{d.company}</span>
                  <span className="text-zinc-500"> — {d.role}</span>
                </span>
                <span className={heat(d.days_left, d.deadline_verified)}>
                  {daysLabel(d.days_left, d.deadline_verified)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-400 mb-2">Recent activity</h2>
        {transitions.length === 0 ? (
          <p className="text-sm text-zinc-600">No transitions logged yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {transitions.map((t, i) => (
              <li key={i} className="text-zinc-400">
                <span className="text-zinc-600">{t.date.slice(0, 10)}</span>{" "}
                <span className="text-zinc-200">{t.company}</span>
                <span className="text-zinc-600"> — {t.from_status} → {t.to_status}</span>
                {t.note && <span className="text-zinc-600"> · {t.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded p-4">
      <div className="text-2xl font-semibold text-zinc-100">{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{label}</div>
    </div>
  );
}
