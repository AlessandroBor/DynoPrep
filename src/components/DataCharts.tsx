import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { ZoomOut } from "lucide-react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { DataPoint } from "../utils/csvParser";

interface DataChartsProps {
  data: DataPoint[];
  hasThrottle: boolean;
  selectedTime: number | null;
  onSelectTime: (time: number | null) => void;
  onHoverTime?: (time: number | null) => void;
  breakInEnabled?: boolean;
  breakInLimitRpm?: number;
  breakInFloorRpm?: number;
}

interface ChannelConfig {
  id: string;
  label: string;
  dataKey: keyof DataPoint;
  color: string;
  unit: string;
  yAxisId: string;
  available: boolean;
}

export default function DataCharts({
  data,
  hasThrottle: _hasThrottle,
  selectedTime,
  onSelectTime,
  onHoverTime,
  breakInEnabled = false,
  breakInLimitRpm = 13500,
  breakInFloorRpm = 7000,
}: DataChartsProps) {
  const allChannels: ChannelConfig[] = [
    { id: "rpm", label: "RPM", dataKey: "rpm", color: "#dc2626", unit: "rpm", yAxisId: "rpm", available: true },
    { id: "throttle", label: "Throttle", dataKey: "throttle", color: "#2563eb", unit: "%", yAxisId: "pct", available: true },
    { id: "gpsLat", label: "GPS Lat", dataKey: "gpsLat", color: "#8b5cf6", unit: "", yAxisId: "gps", available: false },
    { id: "gpsLon", label: "GPS Lon", dataKey: "gpsLon", color: "#d97706", unit: "", yAxisId: "gps", available: false },
  ];

  const availableChannels = allChannels.filter((c) => c.available);

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const ch of allChannels) {
      init[ch.id] = ch.id === "rpm" || ch.id === "throttle";
    }
    return init;
  });

  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [zoomDomain, setZoomDomain] = useState<[number, number] | null>(null);
  const justZoomed = useRef(false);
  const chartWrapperRef = useRef<HTMLDivElement>(null);

  const toggleChannel = (id: string) => {
    setEnabled((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const visibleChannels = availableChannels.filter((c) => enabled[c.id]);
  const activeAxes = new Set(visibleChannels.map((c) => c.yAxisId));

  const fullMin = data.length > 0 ? data[0].time : 0;
  const fullMax = data.length > 0 ? data[data.length - 1].time : 1;
  const fullRange = fullMax - fullMin;

  const chartData = useMemo(() => {
    if (data.length === 0) return [];
    let visible = data;
    if (zoomDomain) {
      visible = data.filter((d) => d.time >= zoomDomain[0] && d.time <= zoomDomain[1]);
    }
    return visible.length > 2500
      ? visible.filter((_, i) => i % Math.ceil(visible.length / 2500) === 0)
      : visible;
  }, [data, zoomDomain]);

  // Scroll wheel zoom
  useEffect(() => {
    const el = chartWrapperRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 1.3 : 0.7;
      const currentMin = zoomDomain ? zoomDomain[0] : fullMin;
      const currentMax = zoomDomain ? zoomDomain[1] : fullMax;
      const range = currentMax - currentMin;
      const center = (currentMin + currentMax) / 2;
      const newRange = Math.min(range * zoomFactor, fullRange);
      if (newRange < 0.5) return;
      const newMin = Math.max(fullMin, center - newRange / 2);
      const newMax = Math.min(fullMax, newMin + newRange);
      if (newMax - newMin >= fullRange * 0.98) {
        setZoomDomain(null);
      } else {
        setZoomDomain([newMin, newMax]);
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [zoomDomain, fullMin, fullMax, fullRange]);

  const handleMouseDown = useCallback((e: any) => {
    if (e?.activeLabel !== undefined) {
      setDragStart(Number(e.activeLabel));
      setDragEnd(null);
      justZoomed.current = false;
    }
  }, []);

  const handleMouseMove = useCallback((e: any) => {
    if (dragStart !== null && e?.activeLabel !== undefined) {
      setDragEnd(Number(e.activeLabel));
    }
    if (onHoverTime && e?.activePayload?.[0]) {
      onHoverTime(e.activePayload[0].payload.time);
    }
  }, [dragStart, onHoverTime]);

  const handleMouseUp = useCallback(() => {
    if (dragStart !== null && dragEnd !== null) {
      const left = Math.min(dragStart, dragEnd);
      const right = Math.max(dragStart, dragEnd);
      if (right - left > 1.0) {
        setZoomDomain([left, right]);
        justZoomed.current = true;
      }
    }
    setDragStart(null);
    setDragEnd(null);
  }, [dragStart, dragEnd]);

  const handleClick = useCallback((e: any) => {
    if (justZoomed.current) { justZoomed.current = false; return; }
    if (e?.activePayload?.[0]) onSelectTime(e.activePayload[0].payload.time);
  }, [onSelectTime]);

  const resetZoom = () => setZoomDomain(null);

  if (data.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-gray-400">Import a CSV file to preview data</p>
        </div>
      </div>
    );
  }

  // Measure chart container
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartDim, setChartDim] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setChartDim({ w: Math.floor(r.width), h: Math.floor(r.height) });
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Channel toggles */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0">
        <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider mr-1">Channels</span>
        {availableChannels.map((ch) => (
          <button
            key={ch.id}
            onClick={() => toggleChannel(ch.id)}
            className={`flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded border transition-colors ${
              enabled[ch.id]
                ? "border-gray-300 bg-white text-gray-800"
                : "border-transparent bg-gray-100 text-gray-400 hover:bg-gray-200"
            }`}
          >
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ch.color, opacity: enabled[ch.id] ? 1 : 0.3 }} />
            {ch.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {zoomDomain && (
            <button onClick={resetZoom} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900 hover:bg-gray-100 px-2 py-1 rounded transition-colors" title="Reset zoom (double-click)">
              <ZoomOut size={13} /> Reset
            </button>
          )}
          <span className="text-[10px] text-gray-500">{chartData.length.toLocaleString()} pts</span>
        </div>
      </div>

      {/* Chart */}
      <div ref={(el) => { (chartWrapperRef as any).current = el; (chartContainerRef as any).current = el; }} className="flex-1 min-h-0 overflow-hidden bg-white">
        {chartDim.w > 0 && chartDim.h > 0 && (
          <ComposedChart
            width={chartDim.w}
            height={chartDim.h}
            data={chartData}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onDoubleClick={resetZoom}
            onClick={handleClick}
            onMouseLeave={() => { onHoverTime?.(null); setDragStart(null); setDragEnd(null); }}
            margin={{ top: 10, right: 10, bottom: 25, left: 10 }}
          >
            <CartesianGrid stroke="#d1d5db" strokeWidth={0.5} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: "#6b7280" }}
              tickFormatter={(v) => `${Number(v).toFixed(1)}`}
              axisLine={{ stroke: "#9ca3af" }}
              tickLine={{ stroke: "#9ca3af" }}
              type="number"
              domain={zoomDomain ? [zoomDomain[0], zoomDomain[1]] : ["dataMin", "dataMax"]}
              allowDataOverflow
              label={{ value: "Time (s)", position: "bottom", offset: 10, style: { fontSize: 12, fill: "#6b7280", fontWeight: 700 } }}
            />

            {activeAxes.has("rpm") && (
              <YAxis yAxisId="rpm" orientation="left"
                tick={{ fontSize: 10, fill: "#6b7280" } as any}
                width={60} tickFormatter={(v) => `${Math.round(Number(v))}`}
                axisLine={{ stroke: "#9ca3af" }} tickLine={{ stroke: "#9ca3af" }}
                label={{ value: "RPM", angle: -90, position: "insideLeft", offset: 0, style: { fontSize: 12, fill: "#6b7280", fontWeight: 700 } }}
              />
            )}
            {activeAxes.has("pct") && (
              <YAxis yAxisId="pct" orientation="right"
                tick={{ fontSize: 10, fill: "#6b7280" } as any}
                width={60} domain={[0, 100]} tickFormatter={(v) => `${Math.round(Number(v))}`}
                axisLine={{ stroke: "#9ca3af" }} tickLine={{ stroke: "#9ca3af" }}
                label={{ value: "Throttle (%)", angle: 90, position: "insideRight", offset: 0, style: { fontSize: 12, fill: "#6b7280", fontWeight: 700 } }}
              />
            )}
            {activeAxes.has("gps") && (
              <YAxis yAxisId="gps" orientation="right"
                tick={{ fontSize: 9, fill: "#6b7280" } as any}
                width={65} tickFormatter={(v) => Number(v).toFixed(3)}
                axisLine={{ stroke: "#9ca3af" }} tickLine={{ stroke: "#9ca3af" }}
                label={{ value: "GPS", angle: 90, position: "insideRight", offset: 5, style: { fontSize: 11, fill: "#6b7280", fontWeight: 600 } }}
              />
            )}
            {!activeAxes.has("rpm") && <YAxis yAxisId="rpm" hide />}
            {!activeAxes.has("pct") && <YAxis yAxisId="pct" hide />}
            {!activeAxes.has("gps") && <YAxis yAxisId="gps" hide />}

            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 4, padding: "8px 12px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)", fontSize: 12 }}>
                    <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 6 }}>{Number(label).toFixed(2)}s</div>
                    {payload.map((entry: any, i: number) => {
                      const v = Number(entry.value);
                      const formatted = entry.name === "RPM" ? `${Math.round(v).toLocaleString()}`
                        : entry.name === "Throttle" ? `${Math.round(v)}%`
                        : v.toFixed(6);
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                          <div style={{ width: 8, height: 3, borderRadius: 1, backgroundColor: entry.color }} />
                          <span style={{ color: "#374151", fontWeight: 500 }}>{formatted}</span>
                          <span style={{ color: "#9ca3af", fontSize: 10 }}>{entry.name}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />

            {visibleChannels.map((ch) => (
              <Line key={ch.id} yAxisId={ch.yAxisId} type="monotone" dataKey={ch.dataKey}
                stroke={ch.color} strokeWidth={1.5} dot={false} isAnimationActive={false} name={ch.label} />
            ))}

            {selectedTime !== null && (
              <ReferenceLine x={selectedTime} stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="6 3" yAxisId="rpm" />
            )}

            {/* Break-in cycle bounds: limit (lift-off trigger) + floor (decay never goes below) */}
            {breakInEnabled && activeAxes.has("rpm") && (
              <ReferenceLine y={breakInLimitRpm} yAxisId="rpm" stroke="#dc2626" strokeWidth={1} strokeDasharray="5 4"
                label={{ value: `Limit ${breakInLimitRpm.toLocaleString()}`, position: "insideTopRight", fontSize: 9, fill: "#dc2626" }} />
            )}
            {breakInEnabled && activeAxes.has("rpm") && (
              <ReferenceLine y={breakInFloorRpm} yAxisId="rpm" stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 4"
                label={{ value: `Floor ${breakInFloorRpm.toLocaleString()}`, position: "insideBottomRight", fontSize: 9, fill: "#9ca3af" }} />
            )}

            {dragStart !== null && dragEnd !== null && Math.abs(dragEnd - dragStart) > 0.5 && (
              <ReferenceArea x1={dragStart} x2={dragEnd} yAxisId="rpm" fill="#dc2626" fillOpacity={0.1} stroke="#dc2626" strokeOpacity={0.3} />
            )}
          </ComposedChart>
        )}
      </div>
    </div>
  );
}
