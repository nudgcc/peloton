import Link from "next/link";
import { notFound } from "next/navigation";
import { getStageById } from "@/lib/stages";
import { findTwinStages, scenarioBaseRates } from "@/lib/knn";
import { VictoryBadge } from "@/components/VictoryBadge";
import { victoryTypeLabel } from "@/lib/scenario";

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

  const twins = await findTwinStages(stageId, 8);

  return (
    <div className="min-h-screen bg-background font-sans">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <Link
            href="/"
            className="text-sm font-medium text-accent hover:underline"
          >
            ← Toutes les étapes
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            {stage.race_name} {stage.season} · Étape {stage.stage_number}
          </h1>
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm text-muted-foreground">
            <span>
              <strong className="text-foreground">
                {stage.distance_km != null
                  ? Number(stage.distance_km).toFixed(1)
                  : "—"}
              </strong>{" "}
              km
            </span>
            <span>
              <strong className="text-foreground">
                {stage.vertical_meters ?? "—"}
              </strong>{" "}
              m D+
            </span>
            <span>
              Profil{" "}
              <strong className="text-foreground">
                {stage.profile_score ?? "—"}
              </strong>
            </span>
            <span className="flex items-center gap-2">
              Résultat réel <VictoryBadge type={stage.victory_type} />
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 space-y-10">
        {!twins ? (
          <p className="text-muted-foreground">
            Données insuffisantes pour calculer des étapes jumelles.
          </p>
        ) : (
          <>
            <section>
              <h2 className="text-lg font-semibold text-foreground">
                Taux de base sur les jumelles
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Répartition des scénarios observés sur les {twins.neighbors.length}{" "}
                étapes au profil le plus proche.
              </p>
              <BaseRates neighbors={twins.neighbors} />
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">
                Étapes jumelles
              </h2>
              <div className="mt-4 overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface text-left text-muted-foreground">
                      <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">
                        Course
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide">
                        Distance
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide">
                        D+
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide">
                        Profil
                      </th>
                      <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">
                        Scénario
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide">
                        Distance k-NN
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {twins.neighbors.map((n) => (
                      <tr
                        key={n.id}
                        className="border-b border-border last:border-0 hover:bg-surface"
                      >
                        <td className="px-4 py-3 font-medium text-foreground">
                          <Link
                            href={`/stages/${n.id}`}
                            className="hover:text-primary hover:underline"
                          >
                            {n.race_name}
                          </Link>{" "}
                          <span className="text-muted-foreground">
                            {n.season} · ét. {n.stage_number}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {n.distance_km.toFixed(1)} km
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {n.vertical_meters} m
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {n.profile_score}
                        </td>
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

function BaseRates({
  neighbors,
}: {
  neighbors: NonNullable<
    Awaited<ReturnType<typeof findTwinStages>>
  >["neighbors"];
}) {
  const rates = scenarioBaseRates(neighbors);

  if (rates.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        Aucune jumelle classifiée (résultats manquants).
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3 max-w-md">
      {rates.map(({ victory_type, rate, count }) => (
        <div key={victory_type}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground">
              {victoryTypeLabel(victory_type)}
            </span>
            <span className="text-muted-foreground">
              {Math.round(rate * 100)}% ({count})
            </span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-drift-silver">
            <div
              className="h-full bg-primary"
              style={{ width: `${rate * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
