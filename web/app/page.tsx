import type { ReactNode } from "react";
import Link from "next/link";
import { getStages, getStats, getFilterOptions } from "@/lib/stages";
import { VictoryBadge } from "@/components/VictoryBadge";
import { victoryTypeLabel } from "@/lib/scenario";

const PAGE_SIZE = 25;

type SearchParams = {
  season?: string;
  race?: string;
  scenario?: string;
  page?: string;
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const filters = {
    season: sp.season ? Number(sp.season) : undefined,
    raceName: sp.race || undefined,
    victoryType: sp.scenario || undefined,
  };

  const [{ stages, total }, stats, options] = await Promise.all([
    getStages(filters, page, PAGE_SIZE),
    getStats(),
    getFilterOptions(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
        <form
          method="get"
          className="mb-6 flex flex-wrap items-end gap-4 rounded-xl border border-border bg-surface p-4"
        >
          <Field label="Saison">
            <select name="season" defaultValue={sp.season ?? ""} className="select-input">
              <option value="">Toutes</option>
              {options.seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Course">
            <select name="race" defaultValue={sp.race ?? ""} className="select-input">
              <option value="">Toutes</option>
              {options.races.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Scénario">
            <select name="scenario" defaultValue={sp.scenario ?? ""} className="select-input">
              <option value="">Tous</option>
              {options.victoryTypes.map((v) => (
                <option key={v} value={v}>
                  {victoryTypeLabel(v)}
                </option>
              ))}
            </select>
          </Field>

          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Filtrer
          </button>
          {(sp.season || sp.race || sp.scenario) && (
            <Link
              href="/"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              Réinitialiser
            </Link>
          )}
        </form>

        <p className="mb-3 text-sm text-muted-foreground">
          {total} étape{total > 1 ? "s" : ""}
        </p>

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
                    <Link
                      href={`/stages/${stage.id}`}
                      className="hover:text-primary hover:underline"
                    >
                      {stage.race_name ?? "—"}
                    </Link>{" "}
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
                    <VictoryBadge type={stage.victory_type} />
                  </td>
                </tr>
              ))}
              {stages.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    Aucune étape ne correspond à ces filtres.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} searchParams={sp} />
      </main>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  searchParams,
}: {
  page: number;
  totalPages: number;
  searchParams: SearchParams;
}) {
  if (totalPages <= 1) return null;

  const hrefFor = (targetPage: number) => {
    const params = new URLSearchParams();
    if (searchParams.season) params.set("season", searchParams.season);
    if (searchParams.race) params.set("race", searchParams.race);
    if (searchParams.scenario) params.set("scenario", searchParams.scenario);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };

  return (
    <div className="mt-6 flex items-center justify-between text-sm">
      <PageLink
        href={hrefFor(page - 1)}
        disabled={page <= 1}
        label="← Précédent"
      />
      <span className="text-muted-foreground">
        Page {page} / {totalPages}
      </span>
      <PageLink
        href={hrefFor(page + 1)}
        disabled={page >= totalPages}
        label="Suivant →"
      />
    </div>
  );
}

function PageLink({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return <span className="text-muted-foreground/50">{label}</span>;
  }
  return (
    <Link href={href} className="font-medium text-primary hover:underline">
      {label}
    </Link>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
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
