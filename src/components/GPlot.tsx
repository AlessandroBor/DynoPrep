import { useMemo, useRef, useState, useEffect } from "react";
import { DataPoint } from "../utils/csvParser";

interface TrackMapProps {
  data: DataPoint[];
  selectedTime: number | null;
  hoveredTime: number | null;
  onSelectTime: (time: number | null) => void;
}

export default function TrackMap({ data, selectedTime, hoveredTime, onSelectTime }: TrackMapProps) {
  const padding = 20;
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 280, h: 280 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setContainerSize({ w: width, h: height });
    };
    update();
    const obs = new ResizeObserver(() => update());
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const bounds = useMemo(() => {
    if (data.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const d of data) {
      if (d.gpsLon < minX) minX = d.gpsLon;
      if (d.gpsLon > maxX) maxX = d.gpsLon;
      if (d.gpsLat < minY) minY = d.gpsLat;
      if (d.gpsLat > maxY) maxY = d.gpsLat;
    }
    const rangeX = maxX - minX || 0.001;
    const rangeY = maxY - minY || 0.001;
    return {
      minX: minX - rangeX * 0.05, maxX: maxX + rangeX * 0.05,
      minY: minY - rangeY * 0.05, maxY: maxY + rangeY * 0.05,
    };
  }, [data]);

  const findPointAtTime = (time: number | null) => {
    if (time === null || data.length === 0) return null;
    return data.reduce((prev, curr) =>
      Math.abs(curr.time - time) < Math.abs(prev.time - time) ? curr : prev
    );
  };

  if (data.length === 0) return null;

  // Compute SVG size preserving track aspect ratio within container
  const trackW = bounds.maxX - bounds.minX;
  const trackH = bounds.maxY - bounds.minY;
  const trackAspect = trackW / trackH;

  const availW = containerSize.w;
  const availH = containerSize.h - 24; // leave room for legend
  const availAspect = availW / Math.max(availH, 1);

  let svgW: number, svgH: number;
  if (trackAspect > availAspect) {
    // Track is wider than container — fit to width
    svgW = availW;
    svgH = availW / trackAspect;
  } else {
    // Track is taller — fit to height
    svgH = Math.max(availH, 50);
    svgW = svgH * trackAspect;
  }

  const plotW = svgW - 2 * padding;
  const plotH = svgH - 2 * padding;
  const rangeX = bounds.maxX - bounds.minX;
  const rangeY = bounds.maxY - bounds.minY;

  const toX = (lon: number) => padding + ((lon - bounds.minX) / rangeX) * plotW;
  const toY = (lat: number) => padding + ((bounds.maxY - lat) / rangeY) * plotH;

  const step = data.length > 1000 ? Math.ceil(data.length / 1000) : 1;
  let path = "";
  for (let i = 0; i < data.length; i += step) {
    const d = data[i];
    path += i === 0 ? `M${toX(d.gpsLon).toFixed(1)},${toY(d.gpsLat).toFixed(1)}` : `L${toX(d.gpsLon).toFixed(1)},${toY(d.gpsLat).toFixed(1)}`;
  }

  const selectedPoint = findPointAtTime(selectedTime);
  const hoveredPoint = findPointAtTime(hoveredTime);

  return (
    <div className="h-full flex flex-col" ref={containerRef}>
      <div className="flex items-center justify-between mb-1 shrink-0 px-1">
        <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Track Map</span>
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" /> Start</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full border-2 border-red-500 inline-block" /> Position</span>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center min-h-0">
        <svg
          width={svgW}
          height={svgH}
          className="cursor-crosshair"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            const clickLon = bounds.minX + ((cx - padding) / plotW) * rangeX;
            const clickLat = bounds.maxY - ((cy - padding) / plotH) * rangeY;
            let minDist = Infinity;
            let closestTime = 0;
            for (const d of data) {
              const dist = Math.hypot(d.gpsLon - clickLon, d.gpsLat - clickLat);
              if (dist < minDist) { minDist = dist; closestTime = d.time; }
            }
            onSelectTime(closestTime);
          }}
        >
          <path d={path} fill="none" stroke="#d1d5db" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          <path d={path} fill="none" stroke="#dc2626" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />

          {/* Start marker — blue */}
          <circle cx={toX(data[0].gpsLon)} cy={toY(data[0].gpsLat)} r={5} fill="#2563eb" stroke="white" strokeWidth={2} />

          {/* Current position — red outline white fill (hovered or selected) */}
          {hoveredPoint && (
            <>
              <circle cx={toX(hoveredPoint.gpsLon)} cy={toY(hoveredPoint.gpsLat)} r={10} fill="rgba(220,38,38,0.08)" />
              <circle cx={toX(hoveredPoint.gpsLon)} cy={toY(hoveredPoint.gpsLat)} r={6} fill="white" stroke="#dc2626" strokeWidth={2.5} />
            </>
          )}

          {selectedPoint && !hoveredPoint && (
            <>
              <circle cx={toX(selectedPoint.gpsLon)} cy={toY(selectedPoint.gpsLat)} r={10} fill="rgba(220,38,38,0.08)" />
              <circle cx={toX(selectedPoint.gpsLon)} cy={toY(selectedPoint.gpsLat)} r={6} fill="white" stroke="#dc2626" strokeWidth={2.5} />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
