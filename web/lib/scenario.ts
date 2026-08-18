export const VICTORY_TYPE_LABELS: Record<string, string> = {
  bunch_sprint: "Sprint massif",
  reduced_group_sprint: "Sprint groupe réduit",
  solo_or_breakaway: "Solo / échappée",
};

export const VICTORY_TYPE_STYLES: Record<string, string> = {
  bunch_sprint: "bg-royal-blue/10 text-royal-blue",
  reduced_group_sprint: "bg-drift-silver text-foreground",
  solo_or_breakaway: "bg-ion-blue/15 text-ion-blue",
};

export function victoryTypeLabel(type: string | null): string {
  if (!type) return "—";
  return VICTORY_TYPE_LABELS[type] ?? type;
}
