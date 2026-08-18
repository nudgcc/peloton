import type { ReactNode } from "react";
import { getStages, getStats } from "@/lib/stages";

const VICTORY_TYPE_LABELS: Record<string, string> = {
  bunch_sprint: "Sprint massif",
  reduced_group_sprint: "Sprint groupe réduit",
  solo_or_breakaway: "Solo / échappée",
};

const VICTORY_TYPE_STYLES: Record<string, string> = {
  bunch_sprint: "bg-royal-blue/10 text-royal-blue",
  reduced_group_sprint: "bg-drift-silver text-foreground",
  solo_or_breakaway: "bg-ion-blue/15 text-ion-blue",
};

export default async function Home() {
  const [stages, stats] = await Promise.all([getStages(40), getStats()]);

  return (
    <div className="min-h-screen bg-background font-sans">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <p className="text-sm font-medium tracking-wide text-accent uppercase">
            peloton.cc
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
            Étapes suivies
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Profils d&apos;étapes et scénarios de course synchronisés depuis
            procyclingstats.com, base du moteur de similarité k-NN.
          </p>

          <dl className="mt-8 grid grid-cols-3 gap-4 max-w-md">
            <Stat label="Étapes" value={stats.stage_count} />
            <Stat label="Courses" value={stats.race_count} />
            <Stat
              label="Saisons"
              value={
                stats.season_min === stats.season_max
                  ? `${stats.season_min}`
                  : `${stats.season_min}–${stats.season_max}`
              }
            />
          </dl>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-muted-foreground">
                <Th>Course</Th>
                <Th>Étape</Th>
                <Th align="right">Distance</Th>
                <Th align="right">D+</Th>
                <Th align="right">Profil</Th>
                <Th>Scénario</Th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stage) => (
                <tr
                  key={stage.pcs_url}
                  className="border-b border-border last:border-0 hover:bg-surface"
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {stage.race_name ?? "—"}{" "}
                    <span className="text-muted-foreground">
                      {stage.season}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {stage.stage_number}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {stage.distance_km != null
                      ? `${Number(stage.distance_km).toFixed(1)} km`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {stage.vertical_meters != null
                      ? `${stage.vertical_meters} m`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {stage.profile_score ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {stage.victory_type ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                          VICTORY_TYPE_STYLES[stage.victory_type] ??
                          "bg-drift-silver text-foreground"
                        }`}
                      >
                        {VICTORY_TYPE_LABELS[stage.victory_type] ??
                          stage.victory_type}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold text-primary">{value}</dd>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-4 py-3 text-xs font-medium uppercase tracking-wide ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}
