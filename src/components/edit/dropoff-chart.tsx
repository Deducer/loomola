"use client";

import { useMemo, useState } from "react";

export function buildDropoffPath(
  buckets: number[],
  width: number,
  height: number
): string {
  if (buckets.length === 0) return "";
  const max = Math.max(1, ...buckets);
  const stepX = width / (buckets.length - 1 || 1);
  const points = buckets.map((v, i) => {
    const x = i * stepX;
    const y = height - (v / max) * height;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  // Filled area: M(0,height) L(p0) L(p1) ... L(width,height) Z
  return `M 0 ${height} L ${points.join(" L ")} L ${width.toFixed(1)} ${height} Z`;
}

export function buildDropoffLine(
  buckets: number[],
  width: number,
  height: number
): string {
  if (buckets.length === 0) return "";
  const max = Math.max(1, ...buckets);
  const stepX = width / (buckets.length - 1 || 1);
  const points = buckets.map((v, i) => {
    const x = i * stepX;
    const y = height - (v / max) * height;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return `M ${points.join(" L ")}`;
}

export function DropoffChart({ buckets }: { buckets: number[] }) {
  const total = buckets.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...buckets);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 600;
  const H = 80;
  const pathArea = useMemo(() => buildDropoffPath(buckets, W, H), [buckets]);
  const pathLine = useMemo(() => buildDropoffLine(buckets, W, H), [buckets]);

  if (total === 0) {
    return (
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
          Viewer drop-off
        </h3>
        <div className="mt-3 flex h-20 items-center justify-center rounded-lg border border-border bg-bg-subtle">
          <p className="text-xs text-text-subtle">No views yet.</p>
        </div>
      </div>
    );
  }

  const stepX = W / (buckets.length - 1 || 1);
  const hoverPct =
    hoverIdx == null
      ? null
      : Math.round((hoverIdx / (buckets.length - 1)) * 100);

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
        Viewer drop-off{" "}
        <span className="text-text-subtle normal-case tracking-normal">
          ({total} views)
        </span>
      </h3>
      <div className="mt-3 rounded-lg border border-border bg-bg-subtle p-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-20 w-full"
          preserveAspectRatio="none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <path d={pathArea} fill="var(--accent)" fillOpacity="0.18" />
          <path
            d={pathLine}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          {buckets.map((_, i) => (
            <rect
              key={i}
              x={Math.max(0, i * stepX - stepX / 2)}
              y={0}
              width={stepX}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          ))}
          {hoverIdx != null && (
            <line
              x1={hoverIdx * stepX}
              x2={hoverIdx * stepX}
              y1={0}
              y2={H}
              stroke="var(--text-subtle)"
              strokeWidth="0.5"
              strokeDasharray="2 2"
            />
          )}
        </svg>
        <div className="mt-2 flex items-center justify-between text-[11px] text-text-subtle">
          <span>0%</span>
          {hoverIdx != null && (
            <span className="text-text-muted">
              At {hoverPct}% — {buckets[hoverIdx]} viewer
              {buckets[hoverIdx] === 1 ? "" : "s"} (peak {max})
            </span>
          )}
          <span>100%</span>
        </div>
      </div>
    </div>
  );
}
