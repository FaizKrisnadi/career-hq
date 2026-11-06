import { requireSession } from "@/lib/session";
import { pipelineBoard, STATUS_ORDER, type BoardRow } from "@/lib/queries";

const EXIT_STATUSES = ["outcome", "rejected", "withdrawn"] as const;

function heatClass(daysLeft: number | null): string {
  if (daysLeft === null) return "";
  if (daysLeft < 0) return "border-l-red-500";
  if (daysLeft <= 3) return "border-l-red-400";
  if (daysLeft <= 7) return "border-l-amber-400";
  if (daysLeft <= 30) return "border-l-sky-500";
  return "border-l-zinc-700";
}

export default async function PipelinePage() {
  await requireSession();
  const board = await pipelineBoard();

  return (
    <div>
      <h1 className="text-xl font-semibold text-zinc-100 mb-4">Pipeline</h1>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {STATUS_ORDER.map((status) => (
          <Column key={status} title={status} rows={board[status] ?? []} />
        ))}
        {EXIT_STATUSES.map((status) => (
          <Column key={status} title={status} rows={board[status] ?? []} exit />
        ))}
      </div>
    </div>
  );
}

function Column({ title, rows, exit }: { title: string; rows: BoardRow[]; exit?: boolean }) {
  return (
    <div className={`min-w-[240px] w-[240px] shrink-0 ${exit ? "opacity-70" : ""}`}>
      <div className="flex items-center justify-between mb-2 px-1">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</h2>
        <span className="text-xs text-zinc-600">{rows.length}</span>
      </div>
      <div className="space-y-2">
        {rows.length === 0 && (
          <div className="border border-dashed border-zinc-900 rounded p-3 text-xs text-zinc-700">
            empty
          </div>
        )}
        {rows.map((r) => (
          <div
            key={r.id}
            className={`bg-zinc-900 border border-zinc-800 border-l-2 rounded p-3 text-sm ${heatClass(
              r.days_left,
            )}`}
          >
            <div className="text-zinc-100 leading-snug">{r.company}</div>
            <div className="text-zinc-500 text-xs mt-0.5 leading-snug">{r.role}</div>
            <div className="flex items-center gap-2 mt-2 text-xs">
              {r.score !== null && (
                <span className="text-zinc-400">score {r.score.toFixed(1)}</span>
              )}
              {r.priority && <span className="text-zinc-600">{r.priority}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
