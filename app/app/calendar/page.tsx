import { requireSession } from "@/lib/session";
import { upcomingDeadlines, type DeadlineRow } from "@/lib/queries";

function bucket(d: DeadlineRow): string {
  if (d.days_left === null) return "unknown";
  if (d.days_left < 0) return "overdue";
  if (d.days_left <= 3) return "≤3 days";
  if (d.days_left <= 7) return "≤7 days";
  if (d.days_left <= 30) return "≤30 days";
  return "later";
}

const ORDER = ["overdue", "≤3 days", "≤7 days", "≤30 days", "later"] as const;

function color(b: string): string {
  switch (b) {
    case "overdue": return "text-red-400";
    case "≤3 days": return "text-red-300";
    case "≤7 days": return "text-amber-400";
    case "≤30 days": return "text-sky-400";
    default: return "text-zinc-400";
  }
}

export default async function CalendarPage() {
  await requireSession();
  const rows = await upcomingDeadlines();
  const groups = new Map<string, DeadlineRow[]>();
  for (const r of rows) {
    const b = bucket(r);
    (groups.get(b) ?? groups.set(b, []).get(b)!).push(r);
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-100 mb-1">Deadlines</h1>
      <p className="text-xs text-zinc-600 mb-5">
        Application statuses with a tracked deadline. "?" = deadline not verified in source.
      </p>
      <div className="space-y-6">
        {ORDER.map((b) => {
          const items = groups.get(b) ?? [];
          if (items.length === 0) return null;
          return (
            <section key={b}>
              <h2 className={`text-sm font-medium mb-2 ${color(b)}`}>
                {b} <span className="text-zinc-600">({items.length})</span>
              </h2>
              <ul className="divide-y divide-zinc-900 border border-zinc-900 rounded">
                {items.map((d) => (
                  <li key={d.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span>
                      <span className="text-zinc-200">{d.company}</span>
                      <span className="text-zinc-500"> — {d.role}</span>
                      <span className="text-zinc-700 text-xs ml-2">{d.status}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-zinc-600">{d.deadline_at?.slice(0, 16)}</span>
                      <span className={color(b)} style={{ minWidth: "5.5rem", textAlign: "right" }}>
                        {d.days_left !== null && (d.days_left < 0 ? `overdue ${-d.days_left}d` : d.days_left === 0 ? "today" : `${d.days_left}d`)}
                        {!d.deadline_verified ? "?" : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {rows.length === 0 && (
          <p className="text-sm text-zinc-600">No tracked deadlines yet — import pending.</p>
        )}
      </div>
    </div>
  );
}
