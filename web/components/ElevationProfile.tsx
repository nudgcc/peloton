import type { Climb } from "@/lib/stages";

type Point = { km: number; elevation: number };

function buildProfile(distanceKm: number, climbs: Climb[]): Point[] {
  // Truthy, not just non-null: PCS's climbs table occasionally lists a
  // climb with some fields present and top_elevation_m recorded as 0
  // (missing, not an actual sea-level summit) - treating 0 as valid would
  // draw a false valley into the profile at that point.
  const usable = climbs.filter(
    (c) => c.top_elevation_m && c.length_km != null && c.km_before_finish != null
  ) as Required<Pick<Climb, "top_elevation_m" | "length_km" | "km_before_finish">>[] &
    Climb[];

  if (usable.length === 0) {
    return [
      { km: 0, elevation: 0 },
      { km: distanceKm, elevation: 0 },
    ];
  }

  const peak = Math.max(...usable.map((c) => c.top_elevation_m as number));
  const valley = peak * 0.22;

  const points: Point[] = [{ km: 0, elevation: valley }];
  for (const c of usable) {
    const summitKm = distanceKm - (c.km_before_finish as number);
    const startKm = Math.max(0, summitKm - (c.length_km as number));
    points.push({ km: startKm, elevation: valley });
    points.push({ km: summitKm, elevation: c.top_elevation_m as number });
  }
  points.push({ km: distanceKm, elevation: valley });

  return points.sort((a, b) => a.km - b.km);
}

export function ElevationProfile({
  distanceKm,
  climbs,
  height = 120,
}: {
  distanceKm: number;
  climbs: Climb[];
  height?: number;
}) {
  const width = 1000;
  const points = buildProfile(distanceKm, climbs);
  const maxElevation = Math.max(...points.map((p) => p.elevation), 1);
  const pad = 8;

  const toXY = (p: Point) => {
    const x = distanceKm > 0 ? (p.km / distanceKm) * width : 0;
    const y = height - pad - (p.elevation / maxElevation) * (height - pad * 2);
    return [x, y] as const;
  };

  const linePath = points
    .map((p, i) => {
      const [x, y] = toXY(p);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const [firstX] = toXY(points[0]);
  const [lastX] = toXY(points[points.length - 1]);
  const areaPath = `${linePath} L${lastX.toFixed(1)},${height} L${firstX.toFixed(1)},${height} Z`;

  const topSummit = points.reduce((a, b) => (b.elevation > a.elevation ? b : a), points[0]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height, display: "block", overflow: "visible" }}
      role="img"
      aria-label={`Profil altimétrique sur ${distanceKm.toFixed(1)} km`}
    >
      <defs>
        <linearGradient id="elevation-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-royal-blue)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--color-royal-blue)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#elevation-fill)" />
      <path d={linePath} fill="none" stroke="var(--color-royal-blue)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {topSummit.elevation > 0 && (
        <circle
          cx={toXY(topSummit)[0]}
          cy={toXY(topSummit)[1]}
          r={4}
          fill="var(--color-ion-blue)"
          stroke="var(--background)"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}
