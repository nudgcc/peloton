import type { RadarAxis } from "@/lib/knn";

const AXIS_LABELS: Record<string, string> = {
  distance_km: "Distance",
  vertical_meters: "Dénivelé",
  climb_ratio: "D+/km",
  nb_hard_climbs: "Cols durs",
  max_altitude: "Altitude max",
  avg_steepness_pct: "Pente moy.",
};

function formatValue(feature: string, value: number): string {
  switch (feature) {
    case "distance_km":
      return `${value.toFixed(0)} km`;
    case "vertical_meters":
      return `${Math.round(value)} m`;
    case "climb_ratio":
      return `${value.toFixed(0)} m/km`;
    case "nb_hard_climbs":
      return `${Math.round(value)}`;
    case "max_altitude":
      return `${Math.round(value)} m`;
    case "avg_steepness_pct":
      return `${value.toFixed(1)}%`;
    default:
      return `${value}`;
  }
}

export function RadarChart({ axes }: { axes: RadarAxis[] }) {
  const size = 280;
  const center = size / 2;
  const maxRadius = size / 2 - 46;
  const n = axes.length;

  const pointFor = (index: number, radiusFraction: number) => {
    const angle = -Math.PI / 2 + index * ((2 * Math.PI) / n);
    return [
      center + Math.cos(angle) * maxRadius * radiusFraction,
      center + Math.sin(angle) * maxRadius * radiusFraction,
    ] as const;
  };

  const rings = [0.25, 0.5, 0.75, 1];
  const polygonPoints = axes
    .map((a, i) => pointFor(i, Math.max(a.percentile / 100, 0.04)).join(","))
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      style={{ width: "100%", maxWidth: 320, height: "auto", display: "block" }}
      role="img"
      aria-label="Position de l'étape par rapport à l'ensemble des étapes suivies, par dimension de profil"
    >
      {rings.map((r) => (
        <polygon
          key={r}
          points={axes.map((_, i) => pointFor(i, r).join(",")).join(" ")}
          fill="none"
          stroke="var(--border)"
          strokeWidth={1}
        />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pointFor(i, 1);
        return (
          <line key={i} x1={center} y1={center} x2={x} y2={y} stroke="var(--border)" strokeWidth={1} />
        );
      })}
      <polygon
        points={polygonPoints}
        fill="var(--color-ion-blue)"
        fillOpacity={0.22}
        stroke="var(--color-ion-blue)"
        strokeWidth={2}
      />
      {axes.map((a, i) => {
        const [x, y] = pointFor(i, Math.max(a.percentile / 100, 0.04));
        return <circle key={i} cx={x} cy={y} r={3} fill="var(--color-ion-blue)" />;
      })}
      {axes.map((a, i) => {
        const [labelX, labelY] = pointFor(i, 1.28);
        return (
          <text
            key={i}
            x={labelX}
            y={labelY}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={11}
            fill="var(--muted-foreground)"
          >
            <tspan x={labelX} dy="-0.3em" fontWeight={600} fill="var(--foreground)">
              {AXIS_LABELS[a.feature] ?? a.feature}
            </tspan>
            <tspan x={labelX} dy="1.3em">
              {formatValue(a.feature, a.value)}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
