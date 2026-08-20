import Link from "next/link";
import { notFound } from "next/navigation";
import { getStageById, getStageClimbs } from "@/lib/stages";
import { findTwinStages, scenarioBaseRates, type Neighbor } from "@/lib/knn";
import { VictoryBadge } from "@/components/VictoryBadge";
import { victoryTypeLabel } from "@/lib/scenario";
import { ElevationProfile } from "@/components/ElevationProfile";
import { RadarChart } from "@/components/RadarChart";

export default async function StagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const stageId = Number(id);
  if (!Number.isInteger(stageId)) notFound();

  const stage = await getStageById(stageId);
  if (!stage) notFound();

  const [climbs, twins] = await Promise.all([
    getStageClimbs(stageId),
    findTwinStages(stageId, 8),
  ]);

  const isRun = stage.victory_type != null;

  return (
    <div className="min-h-screen bg-background font-sans">
      <header className="relative overflow-hidden border-b border-border">
        <div
          className="pointer-events-none absolute -inset-x-10 -top-40 h-72"
          style={{
            background:
              "radial-gradient(ellipse at 25% 0%, color-mix(in srgb, var(--color-royal-blue) 24%, transparent), transparent 60%), radial-gradient(ellipse at 85% 30%, color-mix(in srgb, var(--color-ion-blue) 26%, transparent), transparent 55%)",
          }}
        />
        <div className="relative mx-auto max-w-5xl px-6 pb-8 pt-10">
          <Link href="/" className="text-sm font-medium text-accent hover:underline">
            ← Toutes les étapes
          </Link>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                isRun
                  ? "bg-drift-silver text-foreground"
                  : "bg-ion-blue/15 text-ion-blue"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${isRun ? "bg-muted-foreground" : "bg-ion-blue"}`}
                style={!isRun ? { boxShadow: "0 0 6px var(--color-ion-blue)" } : undefined}
              />
              {isRun ? "Étape courue" : "À venir"}
            </span>
          </div>

          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
            {stage.race_name} {stage.season} · Étape {stage.stage_number}
          </h1>

          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm text-muted-foreground">
            <span>
              <strong className="tabular-nums text-foreground">
                {stage.distance_km != null ? Number(stage.distance_km).toFixed(1) : "—"}
              </strong>{" "}
              km
            </span>
            <span>
              <strong className="tabular-nums text-foreground">{stage.vertical_meters ?? "—"}</strong> m D+
            </span>
            <span>
              Profil <strong className="tabular-nums text-foreground">{stage.profile_score ?? "—"}</strong>
            </span>
            {isRun && (
              <span className="flex items-center gap-2">
                Résultat réel <VictoryBadge type={stage.victory_type} />
              </span>
            )}
          </div>

          {stage.distance_km != null && (
            <div className="mt-8">
              <ElevationProfile distanceKm={Number(stage.distance_km)} climbs={climbs} height={130} />
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 space-y-10">
        {!twins ? (
          <p className="text-muted-foreground">Données insuffisantes pour calculer des étapes jumelles.</p>
        ) : (
          <>
            <section className="grid gap-8 md:grid-cols-[280px_1fr]">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Lecture du profil</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Position de l&apos;étape par rapport aux autres étapes suivies, dimension par
                  dimension.
                </p>
                <div className="mt-4 flex justify-center">
                  <RadarChart axes={twins.radar} />
                </div>
              </div>

              <div>
                <h2 className="text-lg font-semibold text-foreground">Taux de base sur les jumelles</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Répartition des scénarios observés sur les {twins.neighbors.length} étapes au profil le plus
                  proche.
                </p>
                <BaseRates neighbors={twins.neighbors} />
              </div>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">Étapes jumelles</h2>
              <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface text-left text-muted-foreground">
                      <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Course</th>
                      <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Profil</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide">
                        Distance
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide">D+</th>
                      <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Scénario</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide">
                        Distance k-NN
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {twins.neighbors.map((n) => (
                      <tr key={n.id} className="border-b border-border last:border-0 hover:bg-surface">
                        <td className="px-4 py-3 font-medium text-foreground">
                          <Link href={`/stages/${n.id}`} className="hover:text-primary hover:underline">
                            {n.race_name}
                          </Link>{" "}
                          <span className="text-muted-foreground">
                            {n.season} · ét. {n.stage_number}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <MiniSpark verticalMeters={n.vertical_meters} climbRatio={n.climb_ratio} />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{n.distance_km.toFixed(1)} km</td>
                        <td className="px-4 py-3 text-right tabular-nums">{n.vertical_meters} m</td>
                        <td className="px-4 py-3">
                          <VictoryBadge type={n.victory_type} />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {n.distance.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function MiniSpark({ verticalMeters, climbRatio }: { verticalMeters: number; climbRatio: number }) {
  const w = 64;
  const h = 22;
  const intensity = Math.min(climbRatio / 40, 1);
  const peakY = h - 2 - intensity * (h - 6);
  const path = `M0,${h - 2} L${w * 0.3},${h - 2 - intensity * (h - 8)} L${w * 0.55},${peakY} L${w * 0.8},${h - 2 - intensity * (h - 10)} L${w},${h - 3}`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`${path} L${w},${h} L0,${h} Z`} fill="var(--color-royal-blue)" fillOpacity={0.18} />
      <path d={path} fill="none" stroke="var(--color-royal-blue)" strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  );
}

function BaseRates({ neighbors }: { neighbors: Neighbor[] }) {
  const rates = scenarioBaseRates(neighbors);

  if (rates.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">Aucune jumelle classifiée (résultats manquants).</p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      {rates.map(({ victory_type, rate, count }) => (
        <div key={victory_type}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground">{victoryTypeLabel(victory_type)}</span>
            <span className="tabular-nums text-muted-foreground">
              {Math.round(rate * 100)}% ({count})
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-drift-silver">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${rate * 100}%`,
                boxShadow: "0 0 10px -2px var(--color-ion-blue)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
