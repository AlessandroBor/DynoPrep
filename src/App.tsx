import { useState, useMemo, useCallback, useEffect } from "react";
import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { listen } from "@tauri-apps/api/event";
import { parseMyChronCSV, ParsedSession, DataPoint } from "./utils/csvParser";
import {
  FilterSettings,
  DEFAULT_FILTERS,
  defaultInterpolationSteps,
  interpolateData,
  applyTransition,
  remapThrottle,
} from "./utils/filtering";
import Sidebar from "./components/Sidebar";
import DataCharts from "./components/DataCharts";
import TrackMap from "./components/GPlot";
import ThrottleEditor from "./components/ThrottleEditor";

export default function App() {
  const [session, setSession] = useState<ParsedSession | null>(null);
  const [filters, setFilters] = useState<FilterSettings>(DEFAULT_FILTERS);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"data" | "throttle">("data");

  const transitionEnabled = filters.transitionEnabled ?? false;
  const transitionDuration = filters.transitionDuration ?? 10;
  const timeOffset = transitionEnabled ? transitionDuration : 0;

  const handleImport = useCallback(async () => {
    try {
      const path = await open({ multiple: false, filters: [{ name: "CSV Files", extensions: ["csv"] }] });
      if (!path) return;
      const content = await readTextFile(path as string);
      const parsed = parseMyChronCSV(content);
      setSession(parsed);
      setError(null);
      const steps = defaultInterpolationSteps(parsed.channels, parsed.metadata.sampleRate);
      setFilters({ ...DEFAULT_FILTERS, interpolationSteps: steps });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import CSV");
    }
  }, []);

  const handleApplyThrottle = useCallback(
    (dataWithThrottle: DataPoint[]) => {
      if (!session) return;
      const channels = session.channels.includes("Throttle")
        ? session.channels
        : [...session.channels.slice(0, 2), "Throttle", ...session.channels.slice(2)];
      setSession({ ...session, data: dataWithThrottle, hasThrottle: true, channels });
      if (!filters.interpolationSteps["Throttle"]) {
        const defaultStep = session.metadata.sampleRate > 0 ? 1 / session.metadata.sampleRate : 0.1;
        setFilters({ ...filters, interpolationSteps: { ...filters.interpolationSteps, Throttle: defaultStep } });
      }
      setToast("Throttle applied successfully");
      setTimeout(() => setToast(null), 3000);
      setActiveTab("data");
    },
    [session, filters]
  );

  const processedData = useMemo(() => {
    if (!session) return [];
    let data = interpolateData(session.data, filters.interpolationSteps);
    data = remapThrottle(data, filters.throttleCeiling ?? 100, filters.throttleFloor ?? 0);
    if (transitionEnabled && data.length > 0) {
      const minStep = Math.min(...Object.values(filters.interpolationSteps).filter((v) => v > 0), 0.1);
      data = applyTransition(data, transitionDuration, minStep, filters.transitionStartRpm ?? 4000);
    }
    return data;
  }, [session, filters, transitionEnabled, transitionDuration]);

  const handleThrottleHover = useCallback(
    (time: number | null) => { setHoveredTime(time !== null ? time + timeOffset : null); },
    [timeOffset]
  );

  const handleExport = useCallback(async () => {
    if (!session || !processedData.length) return;
    try {
      const safeName = `${session.metadata.user}_${session.metadata.segment}`.replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, "_");
      const path = await save({ filters: [{ name: "CSV Files", extensions: ["csv"] }], defaultPath: `${safeName}.csv` });
      if (!path) return;
      const channelNames = ["Time", "RPM", ...(session.hasThrottle ? ["Throttle"] : []), session.gpsLatChannel, session.gpsLonChannel];
      const parts: string[] = [];
      if (session.rawHeader) {
        parts.push(session.rawHeader, "");
        const qh = channelNames.map(n => `"${n}"`).join(",");
        parts.push(qh, qh);
        const units: Record<string, string> = { Time: "sec", RPM: "rpm", Throttle: "%" };
        parts.push(channelNames.map(n => `"${units[n] ?? ""}"`).join(","));
        parts.push(channelNames.map((_, i) => `"${i === 0 ? "" : i}"`).join(","), "");
      } else { parts.push(channelNames.join(",")); }
      for (const d of processedData) {
        const row = [d.time.toFixed(3), Math.round(d.rpm).toString()];
        if (session.hasThrottle) {
          const t = d.throttle ?? 0;
          row.push((filters.throttleDecimals ?? false) ? t.toFixed(1) : Math.round(t).toString());
        }
        row.push(d.gpsLat.toFixed(6), d.gpsLon.toFixed(6));
        parts.push(row.join(","));
      }
      await writeTextFile(path, parts.join("\n"));
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to export CSV"); }
  }, [session, processedData]);

  const handleClose = useCallback(async () => {
    const yes = await confirm("Close the current file? Any unsaved changes will be lost.", {
      title: "DynoPrep",
      kind: "warning",
    });
    if (!yes) return;
    setSession(null);
    setFilters(DEFAULT_FILTERS);
    setSelectedTime(null);
    setHoveredTime(null);
    setError(null);
    setToast(null);
    setActiveTab("data");
  }, []);

  // Listen for native menu events
  useEffect(() => {
    const unlisten = listen<string>("menu-action", (event) => {
      switch (event.payload) {
        case "open": handleImport(); break;
        case "close": handleClose(); break;
        case "export": handleExport(); break;
        case "tab-data": setActiveTab("data"); break;
        case "tab-throttle": setActiveTab("throttle"); break;
        case "about":
          setToast("DynoPrep v1.0.0 — by American Dynos");
          setTimeout(() => setToast(null), 3000);
          break;
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [handleImport, handleClose, handleExport]);

  if (!session) {
    return (
      <div className="flex h-screen w-screen bg-white">
        {/* Left branding panel */}
        <div className="w-1/2 bg-slate-950 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-5" style={{ backgroundImage: "url('/ad.svg')", backgroundSize: "60%", backgroundPosition: "center", backgroundRepeat: "no-repeat" }} />
          <div className="relative z-10 text-center">
            <img src="/ad.svg" alt="American Dynos" className="w-32 h-32 mx-auto mb-6" />
            <h1 className="text-5xl text-white tracking-tight mb-2 italic" style={{ fontFamily: "'Instrument Serif', serif" }}>DynoPrep</h1>
            <p className="text-sm text-gray-500">by American Dynos</p>
          </div>
          <div className="absolute bottom-6 text-[10px] text-gray-700">v1.0.0</div>
        </div>

        {/* Right action panel */}
        <div className="w-1/2 flex flex-col items-center justify-center px-12">
          <div className="w-full max-w-xs">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Get started</h2>
            <p className="text-sm text-gray-500 mb-8">Import a data file from Race Studio or any compatible CSV export.</p>

            <button
              onClick={handleImport}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-6 rounded text-sm transition-colors flex items-center justify-center gap-2 mb-4"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Import CSV
            </button>

            <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-6">
              <div className="h-px flex-1 bg-gray-200" />
              <span>Supported formats</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>
            <div className="flex gap-3 mt-3">
              <div className="flex-1 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-700 mb-1">Race Studio 2/3</div>
                <div className="text-[10px] text-gray-400">MyChron CSV exports with metadata</div>
              </div>
              <div className="flex-1 border border-gray-200 rounded p-3">
                <div className="text-[11px] font-semibold text-gray-700 mb-1">Plain CSV</div>
                <div className="text-[10px] text-gray-400">Time, RPM, GPS columns</div>
              </div>
            </div>

            {error && (
              <div className="mt-6 p-3 bg-red-50 border border-red-100 rounded text-xs text-red-600">
                {error}<button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const meta = session.metadata;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white">
      <Sidebar
        metadata={meta} filters={filters}
        defaultSteps={defaultInterpolationSteps(session.channels, meta.sampleRate)}
        onFiltersChange={setFilters} onImport={handleImport} onExport={handleExport} onClose={handleClose}
        dataPointCount={session.data.length} filteredCount={processedData.length}
        channels={session.channels} hasThrottle={session.hasThrottle}
      />

      <main className="flex-1 flex flex-col overflow-hidden relative min-h-0 min-w-0">
        {/* Tab bar */}
        <div className="flex items-center border-b border-gray-200 px-4 shrink-0">
          {(["data", "throttle"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab ? "border-red-600 text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600"
              }`}>
              {tab === "data" ? "Data" : "Throttle"}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {error && (
              <div className="flex items-center gap-2 text-xs text-red-600">
                <span>{error}</span><button onClick={() => setError(null)} className="underline">Dismiss</button>
              </div>
            )}
            <button
              onClick={handleClose}
              className="w-6 h-6 flex items-center justify-center rounded-full border border-gray-300 text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors"
              title="Close file"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* DATA TAB — flex col: top=chart (flex-1), bottom=session+track (fixed) */}
        {activeTab === "data" && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0 p-2 overflow-hidden">
              <DataCharts
                data={processedData} hasThrottle={session.hasThrottle}
                selectedTime={selectedTime} onSelectTime={setSelectedTime} onHoverTime={setHoveredTime}
              />
            </div>
            <div className="shrink-0 bg-white border-t border-gray-200 flex" style={{ height: 300 }}>
              <div className="w-1/2 border-r border-gray-200 p-4 overflow-y-auto">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider mb-3">Session</div>
                <div className="space-y-2">
                  {[
                    ["Driver", meta.user], ["Venue", meta.venue], ["Segment", meta.segment],
                    ["Date", meta.date], ["Sample Rate", `${meta.sampleRate} Hz`],
                    ["Duration", `${meta.duration?.toFixed(1) ?? "—"}s`],
                    ["Points", `${session.data.length} raw / ${processedData.length} output`],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-xs text-gray-500">{label}</span>
                      <span className="text-xs font-medium text-gray-700 font-mono">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="w-1/2 p-2 overflow-hidden">
                {processedData.length > 0 && (
                  <TrackMap data={processedData} selectedTime={selectedTime} hoveredTime={hoveredTime} onSelectTime={setSelectedTime} />
                )}
              </div>
            </div>
          </div>
        )}

        {/* THROTTLE TAB — flex col: top=editor (flex-1), bottom=track (fixed) */}
        {activeTab === "throttle" && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0 overflow-hidden px-3 py-2">
              <ThrottleEditor
                data={session.data} hasExistingThrottle={session.hasThrottle}
                onApplyThrottle={handleApplyThrottle} onHoverTime={handleThrottleHover} alwaysOpen
              />
            </div>
            <div className="shrink-0 bg-white border-t border-gray-200 p-2" style={{ height: 300 }}>
              {processedData.length > 0 && (
                <TrackMap data={processedData} selectedTime={selectedTime} hoveredTime={hoveredTime} onSelectTime={setSelectedTime} />
              )}
            </div>
          </div>
        )}
        {/* Toast */}
        {toast && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs font-medium px-4 py-2.5 rounded shadow-lg flex items-center gap-2 animate-fade-in z-50">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            {toast}
          </div>
        )}
      </main>
    </div>
  );
}
