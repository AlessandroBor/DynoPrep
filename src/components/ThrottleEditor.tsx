import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Wand2, Undo2, Trash2, Check, ZoomOut, ChevronUp } from "lucide-react";
import { DataPoint } from "../utils/csvParser";

interface ThrottleEditorProps {
  data: DataPoint[];
  hasExistingThrottle: boolean;
  onApplyThrottle: (data: DataPoint[]) => void;
  onHoverTime?: (time: number | null) => void;
  alwaysOpen?: boolean;
}

interface ThrottleMarker {
  time: number;
  throttle: number;
}

function lerp(markers: ThrottleMarker[], time: number): number {
  if (markers.length === 0) return 0;
  if (time <= markers[0].time) return markers[0].throttle;
  if (time >= markers[markers.length - 1].time) return markers[markers.length - 1].throttle;
  for (let i = 0; i < markers.length - 1; i++) {
    if (time >= markers[i].time && time <= markers[i + 1].time) {
      const frac = (time - markers[i].time) / (markers[i + 1].time - markers[i].time);
      return markers[i].throttle + (markers[i + 1].throttle - markers[i].throttle) * frac;
    }
  }
  return 0;
}

function autoDetectThrottle(data: DataPoint[]): ThrottleMarker[] {
  if (data.length < 20) return [];

  let startIdx = 0;
  for (let i = 1; i < data.length; i++) {
    const dist = Math.hypot(data[i].gpsLat - data[i - 1].gpsLat, data[i].gpsLon - data[i - 1].gpsLon);
    if (dist > 1e-7) { startIdx = Math.max(0, i - 1); break; }
  }

  const active = data.slice(startIdx);
  if (active.length < 20) return [];

  const dt = active.length > 1 ? active[1].time - active[0].time : 0.1;
  const lookAhead = Math.max(5, Math.round(1.0 / dt));

  const headings: number[] = [];
  for (let i = 0; i < active.length; i++) {
    const j = Math.min(active.length - 1, i + lookAhead);
    const dlat = active[j].gpsLat - active[i].gpsLat;
    const dlon = active[j].gpsLon - active[i].gpsLon;
    const dist = Math.hypot(dlat, dlon);
    headings.push(dist < 1e-9 ? (i > 0 ? headings[i - 1] : 0) : Math.atan2(dlon, dlat));
  }

  const turnRates: number[] = [];
  for (let i = 0; i < active.length; i++) {
    const j = Math.min(active.length - 1, i + lookAhead);
    let delta = headings[j] - headings[i];
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const timeDiff = active[j].time - active[i].time;
    turnRates.push(timeDiff > 0 ? Math.abs(delta) / timeDiff : 0);
  }

  const smoothWindow = Math.max(2, Math.round(0.5 / dt));
  const smoothed: number[] = [];
  for (let i = 0; i < turnRates.length; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - smoothWindow); j <= Math.min(turnRates.length - 1, i + smoothWindow); j++) {
      sum += turnRates[j]; count++;
    }
    smoothed.push(sum / count);
  }

  const TURN_THRESHOLD = 0.5;
  const isStraight = smoothed.map((r) => r < TURN_THRESHOLD);

  const minSamples = Math.max(3, Math.round(0.5 / dt));
  const debounced: boolean[] = [...isStraight];
  for (let i = 0; i < debounced.length; i++) {
    let allSame = true;
    for (let j = i; j < Math.min(i + minSamples, debounced.length); j++) {
      if (isStraight[j] !== isStraight[i]) { allSame = false; break; }
    }
    if (!allSame) debounced[i] = i > 0 ? debounced[i - 1] : true;
  }

  const transitions: { idx: number; toStraight: boolean }[] = [];
  let prevState = debounced[0];
  for (let i = 1; i < active.length; i++) {
    if (debounced[i] !== prevState) {
      transitions.push({ idx: i, toStraight: debounced[i] });
      prevState = debounced[i];
    }
  }

  const markers: ThrottleMarker[] = [];
  markers.push({ time: active[0].time, throttle: debounced[0] ? 100 : 0 });
  const holdOffset = dt * 2;

  for (const tr of transitions) {
    const transTime = active[tr.idx].time;
    const holdTime = Math.max(active[0].time, transTime - holdOffset);
    if (tr.toStraight) {
      markers.push({ time: holdTime, throttle: 0 });
      markers.push({ time: transTime, throttle: 100 });
    } else {
      markers.push({ time: holdTime, throttle: 100 });
      markers.push({ time: transTime, throttle: 0 });
    }
  }

  const lastTime = active[active.length - 1].time;
  if (markers[markers.length - 1].time < lastTime) {
    markers.push({ time: lastTime, throttle: debounced[debounced.length - 1] ? 100 : 0 });
  }
  if (startIdx > 0) markers.unshift({ time: data[0].time, throttle: 100 });

  return markers;
}

export default function ThrottleEditor({ data, hasExistingThrottle, onApplyThrottle, onHoverTime, alwaysOpen }: ThrottleEditorProps) {
  const [markers, setMarkers] = useState<ThrottleMarker[]>([]);
  const [history, setHistory] = useState<ThrottleMarker[][]>([]);
  const [isOpen, setIsOpen] = useState(!hasExistingThrottle);
  const [dragging, setDragging] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; idx: number } | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [zoomDomain, setZoomDomain] = useState<[number, number] | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 300 });

  const margin = { top: 15, right: 15, bottom: 30, left: 45 };

  useEffect(() => {
    const el = containerRef.current;
    if (!el || (!isOpen && !alwaysOpen)) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    };
    update();
    const obs = new ResizeObserver(() => update());
    obs.observe(el);
    return () => obs.disconnect();
  }, [isOpen, alwaysOpen]);

  // Save history for undo
  const pushHistory = useCallback(() => {
    setHistory((h) => [...h.slice(-30), markers]);
  }, [markers]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setMarkers(prev);
      return h.slice(0, -1);
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undo();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected !== null) {
        e.preventDefault();
        pushHistory();
        setMarkers((m) => m.filter((_, i) => i !== selected));
        setSelected(null);
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }
  }, [isOpen, selected, undo, pushHistory]);

  const tMin = data.length > 0 ? data[0].time : 0;
  const tMax = data.length > 0 ? data[data.length - 1].time : 1;
  const fullRange = tMax - tMin || 1;
  const viewMin = zoomDomain ? zoomDomain[0] : tMin;
  const viewMax = zoomDomain ? zoomDomain[1] : tMax;
  const viewRange = viewMax - viewMin || 1;

  const plotW = size.w - margin.left - margin.right;
  const plotH = size.h - margin.top - margin.bottom;

  const rpmMax = useMemo(() => {
    let m = 0;
    for (const d of data) if (d.rpm > m) m = d.rpm;
    return m || 1;
  }, [data]);

  const toX = (t: number) => margin.left + ((t - viewMin) / viewRange) * plotW;
  const toY = (throttle: number) => margin.top + ((100 - throttle) / 100) * plotH;
  const fromX = (px: number) => viewMin + ((px - margin.left) / plotW) * viewRange;
  const fromY = (py: number) => Math.max(0, Math.min(100, 100 - ((py - margin.top) / plotH) * 100));
  const rpmToY = (rpm: number) => margin.top + ((rpmMax - rpm) / rpmMax) * plotH;

  // Scroll wheel zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el || (!isOpen && !alwaysOpen)) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseTime = fromX(mouseX);
      const zoomFactor = e.deltaY > 0 ? 1.3 : 0.7;
      const curMin = viewMin;
      const curMax = viewMax;
      const range = curMax - curMin;
      const newRange = Math.min(range * zoomFactor, fullRange);
      if (newRange < 0.5) return;
      const ratio = (mouseTime - curMin) / range;
      const newMin = Math.max(tMin, mouseTime - newRange * ratio);
      const newMax = Math.min(tMax, newMin + newRange);
      if (newMax - newMin >= fullRange * 0.98) {
        setZoomDomain(null);
      } else {
        setZoomDomain([newMin, newMax]);
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [isOpen, viewMin, viewMax, fullRange, tMin, tMax]);

  const rpmPath = useMemo(() => {
    if (data.length === 0) return "";
    const step = data.length > 500 ? Math.ceil(data.length / 500) : 1;
    let d = "";
    for (let i = 0; i < data.length; i += step) {
      const x = toX(data[i].time);
      const y = rpmToY(data[i].rpm);
      d += i === 0 ? `M${x},${y}` : `L${x},${y}`;
    }
    return d;
  }, [data, size, viewMin, viewMax]);

  const throttlePath = useMemo(() => {
    if (markers.length === 0) return "";
    const steps = 300;
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const t = viewMin + (i / steps) * viewRange;
      d += i === 0 ? `M${toX(t)},${toY(lerp(markers, t))}` : `L${toX(t)},${toY(lerp(markers, t))}`;
    }
    return d;
  }, [markers, size, viewMin, viewMax]);

  const existingThrottlePath = useMemo(() => {
    if (!hasExistingThrottle || markers.length > 0) return "";
    const step = data.length > 500 ? Math.ceil(data.length / 500) : 1;
    let d = "";
    for (let i = 0; i < data.length; i += step) {
      d += i === 0 ? `M${toX(data[i].time)},${toY(data[i].throttle ?? 0)}` : `L${toX(data[i].time)},${toY(data[i].throttle ?? 0)}`;
    }
    return d;
  }, [data, hasExistingThrottle, markers.length, size, viewMin, viewMax]);

  const interpolateThrottle = useCallback((): DataPoint[] => {
    if (markers.length === 0) return data.map((d) => ({ ...d }));
    return data.map((d) => ({ ...d, throttle: lerp(markers, d.time) }));
  }, [data, markers]);

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dragging !== null) return;
    setContextMenu(null);
    const rect = svgRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < margin.left || px > size.w - margin.right || py < margin.top || py > size.h - margin.bottom) return;

    // Check if clicking near an existing point
    for (let i = 0; i < markers.length; i++) {
      const mx = toX(markers[i].time);
      const my = toY(markers[i].throttle);
      if (Math.hypot(px - mx, py - my) < 15) {
        setSelected(i);
        return;
      }
    }

    // Add new point
    pushHistory();
    const t = Math.round(fromX(px) * 100) / 100;
    const throttle = Math.round(fromY(py));
    const newMarkers = [...markers, { time: t, throttle }].sort((a, b) => a.time - b.time);
    setMarkers(newMarkers);
    const idx = newMarkers.findIndex((m) => m.time === t && m.throttle === throttle);
    setSelected(idx >= 0 ? idx : null);
  };

  const handlePointMouseDown = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.button === 2) return;
    pushHistory();
    setDragging(idx);
    setSelected(idx);
    setContextMenu(null);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (dragging !== null) {
      const throttle = Math.round(fromY(py));
      const time = Math.round(Math.max(tMin, Math.min(tMax, fromX(px))) * 100) / 100;
      const updated = markers.map((m, i) => (i === dragging ? { time, throttle } : m));
      updated.sort((a, b) => a.time - b.time);
      const newIdx = updated.findIndex((m) => m.time === time && m.throttle === throttle);
      setDragging(newIdx >= 0 ? newIdx : dragging);
      setSelected(newIdx >= 0 ? newIdx : dragging);
      setMarkers(updated);
    }

    const t = Math.max(tMin, Math.min(tMax, fromX(px)));
    onHoverTime?.(t);
  };

  const handleMouseUp = () => setDragging(null);

  const handleContextMenu = (idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Keep menu in viewport
    const menuW = 180, menuH = 180;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 10);
    setContextMenu({ x, y, idx });
    setEditValue(markers[idx].throttle.toString());
    setSelected(idx);
  };

  const deletePoint = (idx: number) => {
    pushHistory();
    setMarkers(markers.filter((_, i) => i !== idx));
    setContextMenu(null);
    setSelected(null);
  };

  const setPointValue = (idx: number, value: number) => {
    pushHistory();
    setMarkers(markers.map((m, i) => (i === idx ? { ...m, throttle: Math.max(0, Math.min(100, value)) } : m)));
    setContextMenu(null);
  };

  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-ctx-menu]")) setContextMenu(null);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  const yTicks = [0, 25, 50, 75, 100];
  const xTickCount = Math.max(2, Math.floor(plotW / 100));
  const xTicks: number[] = [];
  for (let i = 0; i <= xTickCount; i++) xTicks.push(viewMin + (i / xTickCount) * viewRange);

  if (!isOpen && !alwaysOpen) {
    return (
      <div className="flex items-center justify-between py-2">
        <div>
          <span className="text-sm font-semibold text-gray-800">Throttle Editor</span>
          <span className="text-[11px] text-gray-500 ml-2">{hasExistingThrottle ? "Applied" : "No data"}</span>
        </div>
        <button onClick={() => setIsOpen(true)} className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold py-2 px-4 rounded-lg transition-all">
          {hasExistingThrottle ? "Edit" : "Open"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-1 py-1.5 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Throttle Editor</span>
          <span className="text-[10px] text-gray-500">
            {markers.length} pts{selected !== null ? ` · #${selected + 1} selected` : ""}{zoomDomain ? " · zoomed" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => { pushHistory(); setMarkers(autoDetectThrottle(data)); setSelected(null); }}
            className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-900 hover:bg-gray-100 px-2.5 py-1.5 rounded transition-colors" title="Auto-detect straights and turns">
            <Wand2 size={13} /> Auto
          </button>
          {zoomDomain && (
            <button onClick={() => setZoomDomain(null)}
              className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900 hover:bg-gray-100 px-2 py-1.5 rounded transition-colors" title="Reset zoom">
              <ZoomOut size={13} />
            </button>
          )}
          <button onClick={undo} disabled={history.length === 0}
            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900 hover:bg-gray-100 disabled:text-gray-300 disabled:hover:bg-transparent px-2 py-1.5 rounded transition-colors" title="Undo (Ctrl+Z)">
            <Undo2 size={13} />
          </button>
          <button onClick={() => { pushHistory(); setMarkers([]); setSelected(null); }}
            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-red-600 hover:bg-red-50 px-2 py-1.5 rounded transition-colors" title="Clear all points">
            <Trash2 size={13} />
          </button>
          {!alwaysOpen && (
            <button onClick={() => setIsOpen(false)}
              className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900 hover:bg-gray-100 px-2 py-1.5 rounded transition-colors" title="Collapse">
              <ChevronUp size={13} />
            </button>
          )}
          <div className="w-px h-4 bg-gray-200 mx-1" />
          <button onClick={() => onApplyThrottle(interpolateThrottle())} disabled={markers.length === 0 && !hasExistingThrottle}
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-[11px] font-medium py-1.5 px-3 rounded transition-colors" title="Apply throttle data">
            <Check size={13} /> Apply
          </button>
        </div>
      </div>

      {/* Chart — fills all remaining space */}
      <div ref={containerRef} className="flex-1 min-h-0" tabIndex={0}>
        <svg
          ref={svgRef}
          width={size.w}
          height={size.h}
          className="select-none outline-none"
          style={{ cursor: dragging !== null ? "grabbing" : "crosshair" }}
          onClick={handleSvgClick}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { setDragging(null); onHoverTime?.(null); setHovered(null); }}
        >
          {/* Plot background */}
          <rect x={margin.left} y={margin.top} width={plotW} height={plotH} fill="#fafafa" stroke="#d1d5db" strokeWidth={1} />

          {/* Grid */}
          {yTicks.map((v) => (
            <g key={`y-${v}`}>
              <line x1={margin.left} y1={toY(v)} x2={margin.left + plotW} y2={toY(v)} stroke="#e5e7eb" strokeWidth={0.5} />
              <text x={margin.left - 6} y={toY(v) + 3} textAnchor="end" fontSize={9} fill="#9ca3af">{v}%</text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <g key={`x-${i}`}>
              <line x1={toX(t)} y1={margin.top} x2={toX(t)} y2={margin.top + plotH} stroke="#e5e7eb" strokeWidth={0.5} />
              <text x={toX(t)} y={size.h - margin.bottom + 14} textAnchor="middle" fontSize={9} fill="#9ca3af">{t.toFixed(1)}s</text>
            </g>
          ))}

          {/* Axis labels */}
          <text x={size.w / 2} y={size.h - 2} textAnchor="middle" fontSize={10} fill="#9ca3af">Time (s)</text>
          <text x={10} y={size.h / 2} textAnchor="middle" fontSize={10} fill="#9ca3af" transform={`rotate(-90, 10, ${size.h / 2})`}>Throttle (%)</text>

          {/* RPM background */}
          <path d={rpmPath} fill="none" stroke="#e5e7eb" strokeWidth={1} />

          {/* Existing throttle (dashed) */}
          {existingThrottlePath && <path d={existingThrottlePath} fill="none" stroke="#93c5fd" strokeWidth={1.5} strokeDasharray="4 2" />}

          {/* Throttle fill */}
          {markers.length > 0 && (
            <path d={`${throttlePath}L${toX(viewMax)},${toY(0)}L${toX(viewMin)},${toY(0)}Z`} fill="#2563eb" fillOpacity={0.05} />
          )}

          {/* Throttle line */}
          {throttlePath && <path d={throttlePath} fill="none" stroke="#2563eb" strokeWidth={2} />}

          {/* Points */}
          {markers.map((m, i) => {
            const cx = toX(m.time);
            const cy = toY(m.throttle);
            if (cx < margin.left - 10 || cx > size.w - margin.right + 10) return null;
            const isSel = selected === i;
            const isHov = hovered === i;
            const isDrag = dragging === i;
            return (
              <g key={i}>
                {(isSel || isHov || isDrag) && (
                  <>
                    <line x1={cx} y1={margin.top} x2={cx} y2={margin.top + plotH} stroke={isSel ? "#dc2626" : "#9ca3af"} strokeWidth={0.5} strokeDasharray="3 3" />
                    <line x1={margin.left} y1={cy} x2={margin.left + plotW} y2={cy} stroke={isSel ? "#dc2626" : "#9ca3af"} strokeWidth={0.5} strokeDasharray="3 3" />
                  </>
                )}
                <circle cx={cx} cy={cy} r={14} fill="transparent" style={{ cursor: "grab" }}
                  onMouseDown={(e) => handlePointMouseDown(i, e)}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => { if (dragging !== i) setHovered(null); }}
                  onContextMenu={(e) => handleContextMenu(i, e)}
                />
                <circle cx={cx} cy={cy} r={isSel ? 7 : isDrag ? 6 : isHov ? 5 : 4}
                  fill={isSel ? "#dc2626" : "#2563eb"} stroke="white" strokeWidth={2} style={{ pointerEvents: "none" }} />
                {(isHov || isDrag) && (
                  <text x={cx} y={cy - 10} textAnchor="middle" fontSize={9} fill="#374151" fontWeight={600}>
                    {m.time.toFixed(1)}s • {Math.round(m.throttle)}%
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div data-ctx-menu className="fixed bg-white border border-gray-200 rounded shadow-lg py-1 z-50 w-40"
          style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div className="px-2.5 py-2 border-b border-gray-100">
            <div className="text-[10px] text-gray-500 mb-1.5">Throttle %</div>
            <div className="flex items-center gap-1">
              <input type="number" className="w-14 bg-gray-50 border border-gray-200 rounded px-2 py-1 text-[11px] focus:border-gray-400 focus:outline-none"
                value={editValue} min={0} max={100} autoFocus
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setPointValue(contextMenu.idx, parseInt(editValue) || 0); }} />
              <button onClick={() => setPointValue(contextMenu.idx, parseInt(editValue) || 0)}
                className="text-[11px] font-medium text-white bg-red-600 hover:bg-red-700 px-2 py-1 rounded transition-colors">Set</button>
            </div>
          </div>
          <button onClick={() => setPointValue(contextMenu.idx, 100)} className="w-full text-left px-2.5 py-1.5 text-[11px] text-gray-600 hover:bg-gray-50 transition-colors">Set to 100%</button>
          <button onClick={() => setPointValue(contextMenu.idx, 0)} className="w-full text-left px-2.5 py-1.5 text-[11px] text-gray-600 hover:bg-gray-50 transition-colors">Set to 0%</button>
          <div className="border-t border-gray-100 mt-0.5 pt-0.5">
            <button onClick={() => deletePoint(contextMenu.idx)} className="w-full text-left px-2.5 py-1.5 text-[11px] text-red-600 hover:bg-red-50 flex items-center gap-1.5 transition-colors">
              <Trash2 size={12} /> Delete point
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
