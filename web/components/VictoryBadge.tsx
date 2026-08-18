import { VICTORY_TYPE_STYLES, victoryTypeLabel } from "@/lib/scenario";

export function VictoryBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-muted-foreground">—</span>;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
        VICTORY_TYPE_STYLES[type] ?? "bg-drift-silver text-foreground"
      }`}
    >
      {victoryTypeLabel(type)}
    </span>
  );
}
