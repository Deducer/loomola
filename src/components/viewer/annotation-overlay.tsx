"use client";

import { useEffect, useRef, useState } from "react";
import {
  CLIENT_POINTS_PER_STROKE,
  DEFAULT_STROKE_WIDTH,
  MAX_STROKES,
  simplifyStroke,
  type AnnotationStroke,
  type ReviewAnnotation,
} from "@/lib/review/annotation";
import { toFrameFraction, videoContentBox, type Box } from "@/lib/review/content-box";

export type DrawTool = "pin" | "pen" | "arrow" | "rect";

export type OverlayPin = { id: string; number: number; x: number; y: number };

type Props = {
  videoEl: HTMLVideoElement;
  /** The annotation to paint (a draft while drawing, or a selected comment). */
  annotation: ReviewAnnotation | null;
  /** Number drawn on the pin (or at the first stroke) of `annotation`. */
  label?: number | null;
  /** Active drawing tool; null = view only, pointer events pass through. */
  tool: DrawTool | null;
  color: string;
  accentColor: string;
  onChange?: (next: ReviewAnnotation) => void;
  /** Small numbered pins over the playing video. */
  pins?: OverlayPin[];
  onPinClick?: (id: string) => void;
};

/**
 * SVG layer over exactly the picture area of the <video> (letterbox bars
 * excluded, see videoContentBox), portaled by VideoPlayer into Plyr's video
 * wrapper so it follows the player into full screen. Coordinates are stored
 * as frame fractions and drawn in pixels, so a mark made on a small player
 * lands on the same spot of a full-screen one.
 */
export function AnnotationOverlay({
  videoEl,
  annotation,
  label,
  tool,
  color,
  accentColor,
  onChange,
  pins = [],
  onPinClick,
}: Props) {
  const [box, setBox] = useState<Box & { left: number; top: number }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    left: 0,
    top: 0,
  });
  const [live, setLive] = useState<AnnotationStroke | null>(null);
  const liveRef = useRef<AnnotationStroke | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);

  // Plyr toggles playback on any click in its video wrapper, and its
  // listener is native, so React's stopPropagation would run too late.
  // A native listener here stops clicks that land on the layer (only
  // possible while drawing, or on a pin) before they reach the wrapper.
  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const swallow = (e: Event) => e.stopPropagation();
    el.addEventListener("click", swallow);
    el.addEventListener("dblclick", swallow);
    return () => {
      el.removeEventListener("click", swallow);
      el.removeEventListener("dblclick", swallow);
    };
  });

  useEffect(() => {
    const measure = () => {
      const b = videoContentBox(
        videoEl.clientWidth,
        videoEl.clientHeight,
        videoEl.videoWidth,
        videoEl.videoHeight
      );
      setBox({ ...b, left: videoEl.offsetLeft, top: videoEl.offsetTop });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(videoEl);
    videoEl.addEventListener("loadedmetadata", measure);
    videoEl.addEventListener("resize", measure);
    document.addEventListener("fullscreenchange", measure);
    return () => {
      ro.disconnect();
      videoEl.removeEventListener("loadedmetadata", measure);
      videoEl.removeEventListener("resize", measure);
      document.removeEventListener("fullscreenchange", measure);
    };
  }, [videoEl]);

  const drawing = tool !== null;
  const strokes = annotation?.strokes ?? [];

  function fractionAt(e: React.PointerEvent): [number, number] {
    const rect = svgRef.current!.getBoundingClientRect();
    return toFrameFraction(e.clientX - rect.left, e.clientY - rect.top, {
      x: 0,
      y: 0,
      width: rect.width,
      height: rect.height,
    });
  }

  function stop(e: React.SyntheticEvent) {
    // Plyr toggles playback on any click in its video wrapper.
    e.stopPropagation();
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!tool || !onChange) return;
    stop(e);
    e.preventDefault();
    const p = fractionAt(e);
    if (tool === "pin") {
      onChange({ ...annotation, pin: { x: round(p[0]), y: round(p[1]) } });
      return;
    }
    if (strokes.length >= MAX_STROKES) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    const stroke: AnnotationStroke = {
      tool,
      color: color as AnnotationStroke["color"],
      width: DEFAULT_STROKE_WIDTH,
      points: tool === "pen" ? [p] : [p, p],
    };
    liveRef.current = stroke;
    setLive(stroke);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const cur = liveRef.current;
    if (!cur) return;
    stop(e);
    const p = fractionAt(e);
    const next: AnnotationStroke =
      cur.tool === "pen"
        ? { ...cur, points: [...cur.points, p] }
        : { ...cur, points: [cur.points[0], p] };
    liveRef.current = next;
    setLive(next);
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const cur = liveRef.current;
    liveRef.current = null;
    setLive(null);
    if (!cur || !onChange) return;
    stop(e);
    let finished: AnnotationStroke;
    if (cur.tool === "pen") {
      const points = simplifyStroke(cur.points, 0.004, CLIENT_POINTS_PER_STROKE);
      if (points.length < 2) return;
      finished = { ...cur, points };
    } else {
      const [a, b] = cur.points;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01) return; // a click, not a drag
      finished = {
        ...cur,
        points: [
          [round(a[0]), round(a[1])],
          [round(b[0]), round(b[1])],
        ],
      };
    }
    onChange({ ...annotation, strokes: [...strokes, finished] });
  }

  const anchor = annotation?.pin ?? (strokes[0] ? { x: strokes[0].points[0][0], y: strokes[0].points[0][1] } : null);
  const w = box.width;
  const h = box.height;
  if (w <= 0 || h <= 0) return null;

  return (
    <div
      ref={layerRef}
      aria-hidden={!drawing}
      style={{
        position: "absolute",
        left: box.left + box.x,
        top: box.top + box.y,
        width: w,
        height: h,
        zIndex: 2,
        pointerEvents: drawing ? "auto" : "none",
        cursor: drawing ? "crosshair" : undefined,
        touchAction: drawing ? "none" : undefined,
      }}
    >
      <svg
        ref={svgRef}
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          <filter id="review-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#000" floodOpacity="0.6" />
          </filter>
        </defs>
        <g filter="url(#review-shadow)">
          {strokes.map((s, i) => (
            <StrokeShape key={i} stroke={s} w={w} h={h} />
          ))}
          {live && <StrokeShape stroke={live} w={w} h={h} />}
        </g>
        {anchor && label != null && !annotation?.pin && (
          <PinBadge x={anchor.x * w} y={anchor.y * h} number={label} color={accentColor} small />
        )}
        {annotation?.pin && (
          <PinBadge x={annotation.pin.x * w} y={annotation.pin.y * h} number={label ?? null} color={accentColor} />
        )}
        {pins.map((p) => (
          <g
            key={p.id}
            style={{ pointerEvents: onPinClick ? "auto" : "none", cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              onPinClick?.(p.id);
            }}
          >
            <PinBadge x={p.x * w} y={p.y * h} number={p.number} color={accentColor} small />
          </g>
        ))}
      </svg>
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function StrokeShape({ stroke, w, h }: { stroke: AnnotationStroke; w: number; h: number }) {
  const sw = Math.max(2, stroke.width * w);
  const pts = stroke.points.map(([x, y]) => [x * w, y * h] as const);
  const common = {
    stroke: stroke.color,
    strokeWidth: sw,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (stroke.tool === "pen") {
    return <polyline points={pts.map((p) => p.join(",")).join(" ")} {...common} />;
  }
  const [[x1, y1], [x2, y2]] = [pts[0], pts[pts.length - 1]];
  if (stroke.tool === "rect") {
    return (
      <rect
        x={Math.min(x1, x2)}
        y={Math.min(y1, y2)}
        width={Math.abs(x2 - x1)}
        height={Math.abs(y2 - y1)}
        rx={2}
        {...common}
      />
    );
  }
  // Arrow: shaft plus a filled head at the end point.
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(10, sw * 3.5);
  const spread = Math.PI / 7;
  const hx1 = x2 - head * Math.cos(angle - spread);
  const hy1 = y2 - head * Math.sin(angle - spread);
  const hx2 = x2 - head * Math.cos(angle + spread);
  const hy2 = y2 - head * Math.sin(angle + spread);
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2 - (head / 2) * Math.cos(angle)} y2={y2 - (head / 2) * Math.sin(angle)} {...common} />
      <polygon points={`${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`} fill={stroke.color} stroke={stroke.color} strokeWidth={1} strokeLinejoin="round" />
    </g>
  );
}

function PinBadge({
  x,
  y,
  number,
  color,
  small = false,
}: {
  x: number;
  y: number;
  number: number | null;
  color: string;
  small?: boolean;
}) {
  const r = small ? 10 : 13;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle r={r} fill={color} stroke="#fff" strokeWidth={2} filter="url(#review-shadow)" />
      {number != null && (
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fff"
          fontSize={small ? 10 : 12}
          fontWeight={700}
          style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
        >
          {number}
        </text>
      )}
    </g>
  );
}
