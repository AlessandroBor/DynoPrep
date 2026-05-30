import { Upload, Download, RotateCcw } from "lucide-react";
import { SessionMetadata } from "../utils/csvParser";
import { FilterSettings, DEFAULT_FILTERS } from "../utils/filtering";

interface SidebarProps {
  metadata: SessionMetadata | null;
  filters: FilterSettings;
  defaultSteps: Record<string, number>;
  onFiltersChange: (filters: FilterSettings) => void;
  onImport: () => void;
  onExport: () => void;
  onClose?: () => void;
  dataPointCount: number;
  filteredCount: number;
  channels: string[];
  hasThrottle: boolean;
  rpmPeakOriginal: number;
  rpmPeakLimited: number;
  breakInBottomRpm: number;
  breakInFloorLimited: boolean;
  breakInCycles: number;
  lapTimeOriginal: number;
  lapTimeCorrected: number;
  sessionDuration: number;
}

/** Format seconds as m:ss.mmm (matching the MyChron segment style). */
function formatLapTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, "0")}` : `${s.toFixed(3)}s`;
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-gray-400 hover:text-red-500 transition-colors"
      title="Reset to default"
    >
      <RotateCcw size={12} />
    </button>
  );
}

export default function Sidebar({
  metadata,
  filters,
  defaultSteps,
  onFiltersChange,
  onImport,
  onExport,
  onClose: _onClose,
  dataPointCount,
  filteredCount,
  channels,
  hasThrottle,
  rpmPeakOriginal,
  rpmPeakLimited,
  breakInBottomRpm,
  breakInFloorLimited,
  breakInCycles,
  lapTimeOriginal,
  lapTimeCorrected,
  sessionDuration,
}: SidebarProps) {
  // Safe defaults in case filters state is stale from HMR
  const throttleCeiling = filters.throttleCeiling ?? 100;
  const throttleFloor = filters.throttleFloor ?? 0;
  const transitionEnabled = filters.transitionEnabled ?? false;
  const transitionDuration = filters.transitionDuration ?? 10;
  const transitionStartRpm = filters.transitionStartRpm ?? 4000;
  const breakInEnabled = filters.breakInEnabled ?? false;
  const breakInLimitRpm = filters.breakInLimitRpm ?? 13500;
  const breakInFloorRpm = filters.breakInFloorRpm ?? 7000;
  const breakInDecayRate = filters.breakInDecayRate ?? 1000;
  const breakInDecayDuration = filters.breakInDecayDuration ?? 2;
  const breakInResumeRate = filters.breakInResumeRate ?? 2000;
  const breakInSmoothing = filters.breakInSmoothing ?? 0.25;
  const breakInThrottleResume = filters.breakInThrottleResume ?? 0.5;
  const lapTimeCorrectionEnabled = filters.lapTimeCorrectionEnabled ?? false;
  const loopEnabled = filters.loopEnabled ?? false;
  const loopCount = filters.loopCount ?? 5;
  const loopBridgeDuration = filters.loopBridgeDuration ?? 1.5;

  const updateChannelStep = (channel: string, value: number) => {
    if (isNaN(value) || value <= 0) return;
    onFiltersChange({
      ...filters,
      interpolationSteps: { ...filters.interpolationSteps, [channel]: value },
    });
  };

  const dataChannels = channels.filter((ch) => ch !== "Time");

  return (
    <aside className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Brand + actions */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/ad.svg" alt="" className="w-5 h-5 opacity-80" />
          <span className="text-[13px] text-gray-900 tracking-tight italic" style={{ fontFamily: "'Instrument Serif', serif" }}>DynoPrep</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onImport}
            className="text-gray-500 hover:text-gray-900 transition-colors p-1 rounded hover:bg-gray-100"
            title="Import CSV"
          >
            <Upload size={14} />
          </button>
          <button
            onClick={onExport}
            className="text-gray-500 hover:text-gray-900 transition-colors p-1 rounded hover:bg-gray-100"
            title="Export CSV"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {/* Session Info
      {metadata && (
        <div className="px-4 py-4 border-y border-gray-200">
          <h2 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider mb-3">
            Session
          </h2>
          <div className="space-y-2">
            {[
              ["Driver", metadata.user],
              ["Venue", metadata.venue],
              ["Segment", metadata.segment],
              ["Date", metadata.date],
              ["Sample Rate", `${metadata.sampleRate} Hz`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between items-center">
                <span className="text-xs text-gray-500">{label}</span>
                <span className="text-xs font-medium text-gray-700">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )} */}

      {/* Scrollable settings area */}
      {metadata && (
        <div className="overflow-y-auto flex-1">
          {/* Per-channel interpolation */}
          {dataChannels.length > 0 && (
            <div className="px-4 py-4 border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                  Interpolation
                </h2>
                <ResetButton
                  onClick={() =>
                    onFiltersChange({ ...filters, interpolationSteps: { ...defaultSteps } })
                  }
                />
              </div>

              {dataChannels.map((ch) => {
                const val = filters.interpolationSteps[ch] ?? 0.1;
                const def = defaultSteps[ch] ?? 0.1;
                const isModified = Math.abs(val - def) > 0.001;
                return (
                  <div key={ch} className="mb-4">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs font-medium text-gray-600">{ch}</span>
                      <div className="flex items-center gap-1.5">
                        {isModified && (
                          <button
                            onClick={() => updateChannelStep(ch, def)}
                            className="text-gray-400 hover:text-red-500 transition-colors"
                            title={`Reset to ${def.toFixed(2)}s`}
                          >
                            <RotateCcw size={10} />
                          </button>
                        )}
                        <span className="text-[10px] text-gray-500 font-mono">{val.toFixed(2)}s</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        className="flex-1"
                        min={0.01}
                        max={2}
                        step={0.01}
                        value={val}
                        onChange={(e) => updateChannelStep(ch, parseFloat(e.target.value))}
                      />
                      <input
                        type="number"
                        className="w-16 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                        value={val}
                        min={0.001}
                        max={10}
                        step={0.01}
                        onChange={(e) => updateChannelStep(ch, parseFloat(e.target.value))}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Decimal Precision */}
          <div className="px-4 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h2 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                  Decimal Precision
                </h2>
                <span className="text-[8px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1 py-px rounded uppercase">
                  Beta
                </span>
              </div>
              <button
                onClick={() => onFiltersChange({ ...filters, throttleDecimals: !(filters.throttleDecimals ?? false) })}
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  (filters.throttleDecimals ?? false) ? "bg-red-600" : "bg-gray-300"
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  (filters.throttleDecimals ?? false) ? "translate-x-4" : "translate-x-0.5"
                }`} />
              </button>
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Exports throttle values with 0.1% precision instead of whole numbers. Useful for servos that support fine-grained control.
            </p>
          </div>

          {/* Export Metadata */}
          <div className="px-4 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                Export Metadata
              </h2>
              <button
                onClick={() => onFiltersChange({ ...filters, exportMetadata: !(filters.exportMetadata ?? false) })}
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  (filters.exportMetadata ?? false) ? "bg-red-600" : "bg-gray-300"
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  (filters.exportMetadata ?? false) ? "translate-x-4" : "translate-x-0.5"
                }`} />
              </button>
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              {(filters.exportMetadata ?? false)
                ? "Includes the session header and column names at the top of the exported CSV."
                : "Exports raw comma-separated values only — no header, units, or column names."}
            </p>
          </div>

          {/* Throttle Range */}
          {hasThrottle && (
            <div className="px-4 py-4 border-t border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                  Throttle Ceiling
                </h2>
                <ResetButton
                  onClick={() =>
                    onFiltersChange({ ...filters, throttleCeiling: 100, throttleFloor: 0 })
                  }
                />
              </div>
              <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">
                If sensor reads {throttleCeiling}% at full throttle, values are remapped so {throttleCeiling}% → 100%.
              </p>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-medium text-gray-600">Sensor max</span>
                <span className="text-[10px] text-gray-500 font-mono">{throttleCeiling.toFixed(1)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  className="flex-1"
                  min={50}
                  max={100}
                  step={0.1}
                  value={throttleCeiling}
                  onChange={(e) =>
                    onFiltersChange({ ...filters, throttleCeiling: parseFloat(e.target.value) })
                  }
                />
                <input
                  type="number"
                  className="w-16 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                  value={throttleCeiling}
                  min={1}
                  max={100}
                  step={0.1}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v > 0) onFiltersChange({ ...filters, throttleCeiling: v });
                  }}
                />
              </div>

              {/* Throttle Floor */}
              <div className="mt-4">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Min throttle</span>
                  <span className="text-[10px] text-gray-500 font-mono">{throttleFloor.toFixed(1)}%</span>
                </div>
                <p className="text-[10px] text-gray-500 mb-2 leading-relaxed">
                  Values below {throttleFloor.toFixed(1)}% are raised to {throttleFloor.toFixed(1)}%.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    className="flex-1"
                    min={0}
                    max={20}
                    step={0.1}
                    value={throttleFloor}
                    onChange={(e) =>
                      onFiltersChange({ ...filters, throttleFloor: parseFloat(e.target.value) })
                    }
                  />
                  <input
                    type="number"
                    className="w-16 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={throttleFloor}
                    min={0}
                    max={50}
                    step={0.1}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v >= 0) onFiltersChange({ ...filters, throttleFloor: v });
                    }}
                  />
                </div>
              </div>

            </div>
          )}

          {/* Break-In Cycle */}
          <div className="px-4 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                Break-In Cycle
              </h2>
              <div className="flex items-center gap-2">
                <ResetButton onClick={() => onFiltersChange({ ...filters,
                  breakInEnabled: DEFAULT_FILTERS.breakInEnabled,
                  breakInLimitRpm: DEFAULT_FILTERS.breakInLimitRpm,
                  breakInFloorRpm: DEFAULT_FILTERS.breakInFloorRpm,
                  breakInDecayRate: DEFAULT_FILTERS.breakInDecayRate,
                  breakInDecayDuration: DEFAULT_FILTERS.breakInDecayDuration,
                  breakInResumeRate: DEFAULT_FILTERS.breakInResumeRate,
                  breakInSmoothing: DEFAULT_FILTERS.breakInSmoothing,
                  breakInThrottleResume: DEFAULT_FILTERS.breakInThrottleResume,
                  lapTimeCorrectionEnabled: DEFAULT_FILTERS.lapTimeCorrectionEnabled })} />
                <button onClick={() => onFiltersChange({ ...filters, breakInEnabled: !breakInEnabled })}
                  className={`relative w-9 h-5 rounded-full transition-colors ${breakInEnabled ? "bg-red-600" : "bg-gray-300"}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${breakInEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
              </div>
            </div>
            {breakInEnabled && (
              <div>
                <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">
                  At the limit the throttle lifts and RPM falls at the decay rate for the set duration, then climbs back into the lap data — repeating to seat the rings. A drop that would pass the floor is auto-slowed to land on it.
                </p>

                {/* Cycle readout — preview what these settings produce */}
                <div className="mb-4 rounded border border-gray-200 bg-gray-50 px-3 py-2 space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-500">Raw peak</span>
                    <span className="text-[11px] font-mono text-gray-500">{Math.round(rpmPeakOriginal).toLocaleString()} rpm</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-semibold text-gray-700">Lift-off at</span>
                    <span className="text-[12px] font-mono font-semibold text-red-600">{Math.round(rpmPeakLimited).toLocaleString()} rpm</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-500">Drops to</span>
                    <span className="text-[11px] font-mono text-gray-700">
                      {Math.round(breakInBottomRpm).toLocaleString()} rpm{breakInFloorLimited ? " (floor)" : ""}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-500">Lift-offs this lap</span>
                    <span className="text-[11px] font-mono text-gray-700">{breakInCycles.toLocaleString()}</span>
                  </div>
                </div>

                {/* Limit RPM */}
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Limit RPM</span>
                  <span className="text-[10px] text-gray-500 font-mono">{breakInLimitRpm.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <input type="range" className="flex-1" min={6000} max={16000} step={100} value={breakInLimitRpm}
                    onChange={(e) => onFiltersChange({ ...filters, breakInLimitRpm: parseInt(e.target.value) })} />
                  <input type="number" className="w-16 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={breakInLimitRpm} min={0} max={25000} step={100}
                    onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) onFiltersChange({ ...filters, breakInLimitRpm: v }); }} />
                </div>

                {/* Floor RPM */}
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Floor RPM</span>
                  <span className="text-[10px] text-gray-500 font-mono">{breakInFloorRpm.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <input type="range" className="flex-1" min={2000} max={12000} step={100} value={breakInFloorRpm}
                    onChange={(e) => onFiltersChange({ ...filters, breakInFloorRpm: parseInt(e.target.value) })} />
                  <input type="number" className="w-16 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={breakInFloorRpm} min={0} max={20000} step={100}
                    onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) onFiltersChange({ ...filters, breakInFloorRpm: v }); }} />
                </div>

                {/* Decay rate */}
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Decay rate</span>
                  <span className="text-[10px] text-gray-500 font-mono">{breakInDecayRate.toLocaleString()} rpm/s</span>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <input type="range" className="flex-1" min={100} max={5000} step={50} value={breakInDecayRate}
                    onChange={(e) => onFiltersChange({ ...filters, breakInDecayRate: parseInt(e.target.value) })} />
                  <input type="number" className="w-16 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={breakInDecayRate} min={1} max={20000} step={50}
                    onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) onFiltersChange({ ...filters, breakInDecayRate: v }); }} />
                </div>

                {/* Decay duration */}
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Decay duration</span>
                  <span className="text-[10px] text-gray-500 font-mono">{breakInDecayDuration}s</span>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <input type="range" className="flex-1" min={0.5} max={15} step={0.5} value={breakInDecayDuration}
                    onChange={(e) => onFiltersChange({ ...filters, breakInDecayDuration: parseFloat(e.target.value) })} />
                  <input type="number" className="w-14 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={breakInDecayDuration} min={0.1} max={60} step={0.5}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) onFiltersChange({ ...filters, breakInDecayDuration: v }); }} />
                </div>

                {/* Resume rate */}
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Resume rate</span>
                  <span className="text-[10px] text-gray-500 font-mono">{breakInResumeRate.toLocaleString()} rpm/s</span>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <input type="range" className="flex-1" min={100} max={5000} step={50} value={breakInResumeRate}
                    onChange={(e) => onFiltersChange({ ...filters, breakInResumeRate: parseInt(e.target.value) })} />
                  <input type="number" className="w-16 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={breakInResumeRate} min={1} max={20000} step={50}
                    onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) onFiltersChange({ ...filters, breakInResumeRate: v }); }} />
                </div>

                {/* Smoothing — rounds the harsh decay→resume corner */}
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Smoothing</span>
                  <span className="text-[10px] text-gray-500 font-mono">{breakInSmoothing > 0 ? `${breakInSmoothing.toFixed(2)}s` : "off"}</span>
                </div>
                <p className="text-[10px] text-gray-500 mb-2 leading-relaxed">
                  Rounds the corner where the lift-off coast-down turns back into the climb. 0 = sharp.
                </p>
                <div className="flex items-center gap-2 mb-4">
                  <input type="range" className="flex-1" min={0} max={1} step={0.05} value={breakInSmoothing}
                    onChange={(e) => onFiltersChange({ ...filters, breakInSmoothing: parseFloat(e.target.value) })} />
                  <input type="number" className="w-14 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={breakInSmoothing} min={0} max={3} step={0.05}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) onFiltersChange({ ...filters, breakInSmoothing: v }); }} />
                </div>

                {/* Throttle return — how fast throttle eases back to the lap data on resume */}
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Throttle return</span>
                  <span className="text-[10px] text-gray-500 font-mono">{breakInThrottleResume > 0 ? `${breakInThrottleResume.toFixed(2)}s` : "instant"}</span>
                </div>
                <p className="text-[10px] text-gray-500 mb-2 leading-relaxed">
                  Time for throttle to ease (cosine) from 0 back to the lap value once the lift-off ends.
                </p>
                <div className="flex items-center gap-2">
                  <input type="range" className="flex-1" min={0} max={2} step={0.05} value={breakInThrottleResume}
                    onChange={(e) => onFiltersChange({ ...filters, breakInThrottleResume: parseFloat(e.target.value) })} />
                  <input type="number" className="w-14 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={breakInThrottleResume} min={0} max={5} step={0.05}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) onFiltersChange({ ...filters, breakInThrottleResume: v }); }} />
                </div>

                {/* Lap-time correction — stretch the timeline so the lifts take realistically longer */}
                <div className="mt-5 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-700">Correct lap time</span>
                    <button onClick={() => onFiltersChange({ ...filters, lapTimeCorrectionEnabled: !lapTimeCorrectionEnabled })}
                      className={`relative w-9 h-5 rounded-full transition-colors ${lapTimeCorrectionEnabled ? "bg-red-600" : "bg-gray-300"}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${lapTimeCorrectionEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">
                    The kart is slower wherever RPM is pulled down (speed tracks RPM through the axle), so the timeline is stretched to match — the lift sections take longer and the lap time grows.
                  </p>
                  <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-gray-500">Lap time</span>
                      <span className="text-[11px] font-mono text-gray-500">{formatLapTime(lapTimeOriginal)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-semibold text-gray-700">Corrected</span>
                      <span className="text-[12px] font-mono font-semibold text-red-600">{formatLapTime(lapTimeCorrected)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-gray-500">Added</span>
                      <span className="text-[11px] font-mono text-gray-700">+{Math.max(0, lapTimeCorrected - lapTimeOriginal).toFixed(2)}s</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Start Transition */}
          <div className="px-4 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                Start Transition
              </h2>
              <div className="flex items-center gap-2">
                <ResetButton onClick={() => onFiltersChange({ ...filters, transitionEnabled: DEFAULT_FILTERS.transitionEnabled, transitionDuration: DEFAULT_FILTERS.transitionDuration, transitionStartRpm: DEFAULT_FILTERS.transitionStartRpm })} />
                <button onClick={() => onFiltersChange({ ...filters, transitionEnabled: !transitionEnabled })}
                  className={`relative w-9 h-5 rounded-full transition-colors ${transitionEnabled ? "bg-red-600" : "bg-gray-300"}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${transitionEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
              </div>
            </div>
            {transitionEnabled && (
              <div>
                <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">
                  Ramp up {transitionStartRpm > 0 ? `${transitionStartRpm.toLocaleString()}` : "0"} → first RPM. Throttle at 100%.
                </p>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Duration</span>
                  <span className="text-[10px] text-gray-500 font-mono">{transitionDuration}s</span>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <input type="range" className="flex-1" min={1} max={30} step={0.5} value={transitionDuration}
                    onChange={(e) => onFiltersChange({ ...filters, transitionDuration: parseFloat(e.target.value) })} />
                  <input type="number" className="w-14 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={transitionDuration} min={0.5} max={60} step={0.5}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) onFiltersChange({ ...filters, transitionDuration: v }); }} />
                </div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Start RPM</span>
                  <span className="text-[10px] text-gray-500 font-mono">{transitionStartRpm.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input type="range" className="flex-1" min={0} max={10000} step={100} value={transitionStartRpm}
                    onChange={(e) => onFiltersChange({ ...filters, transitionStartRpm: parseInt(e.target.value) })} />
                  <input type="number" className="w-16 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={transitionStartRpm} min={0} max={20000} step={100}
                    onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) onFiltersChange({ ...filters, transitionStartRpm: v }); }} />
                </div>
              </div>
            )}
          </div>

          {/* End Transition */}
          <div className="px-4 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                End Transition
              </h2>
              <div className="flex items-center gap-2">
                <ResetButton onClick={() => onFiltersChange({ ...filters, endTransitionEnabled: DEFAULT_FILTERS.endTransitionEnabled, endTransitionDuration: DEFAULT_FILTERS.endTransitionDuration, endTransitionRpm: DEFAULT_FILTERS.endTransitionRpm })} />
                <button onClick={() => onFiltersChange({ ...filters, endTransitionEnabled: !(filters.endTransitionEnabled ?? false) })}
                  className={`relative w-9 h-5 rounded-full transition-colors ${(filters.endTransitionEnabled ?? false) ? "bg-red-600" : "bg-gray-300"}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${(filters.endTransitionEnabled ?? false) ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
              </div>
            </div>
            {(filters.endTransitionEnabled ?? false) && (
              <div>
                <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">
                  Ramp down last RPM → {(filters.endTransitionRpm ?? 2000).toLocaleString()}. Throttle at 0%.
                </p>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Duration</span>
                  <span className="text-[10px] text-gray-500 font-mono">{(filters.endTransitionDuration ?? 5)}s</span>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <input type="range" className="flex-1" min={1} max={30} step={0.5} value={filters.endTransitionDuration ?? 5}
                    onChange={(e) => onFiltersChange({ ...filters, endTransitionDuration: parseFloat(e.target.value) })} />
                  <input type="number" className="w-14 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={filters.endTransitionDuration ?? 5} min={0.5} max={60} step={0.5}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) onFiltersChange({ ...filters, endTransitionDuration: v }); }} />
                </div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">End RPM</span>
                  <span className="text-[10px] text-gray-500 font-mono">{(filters.endTransitionRpm ?? 2000).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input type="range" className="flex-1" min={0} max={10000} step={100} value={filters.endTransitionRpm ?? 2000}
                    onChange={(e) => onFiltersChange({ ...filters, endTransitionRpm: parseInt(e.target.value) })} />
                  <input type="number" className="w-16 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={filters.endTransitionRpm ?? 2000} min={0} max={20000} step={100}
                    onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) onFiltersChange({ ...filters, endTransitionRpm: v }); }} />
                </div>
              </div>
            )}
          </div>

          {/* Loop */}
          <div className="px-4 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                Loop
              </h2>
              <div className="flex items-center gap-2">
                <ResetButton onClick={() => onFiltersChange({ ...filters, loopEnabled: DEFAULT_FILTERS.loopEnabled, loopCount: DEFAULT_FILTERS.loopCount, loopBridgeDuration: DEFAULT_FILTERS.loopBridgeDuration })} />
                <button onClick={() => onFiltersChange({ ...filters, loopEnabled: !loopEnabled })}
                  className={`relative w-9 h-5 rounded-full transition-colors ${loopEnabled ? "bg-red-600" : "bg-gray-300"}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${loopEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
              </div>
            </div>
            {loopEnabled && (
              <div>
                <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">
                  Repeats the lap {loopCount}× to build a longer session{loopBridgeDuration > 0 ? `, with a ${loopBridgeDuration}s smooth bridge between laps` : " (hard seam)"}.
                </p>

                {/* Total session time readout */}
                <div className="mb-4 rounded border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-semibold text-gray-700">Total session</span>
                    <span className="text-[12px] font-mono font-semibold text-red-600">{formatLapTime(sessionDuration)}</span>
                  </div>
                </div>

                {/* Repeats */}
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Repeats</span>
                  <span className="text-[10px] text-gray-500 font-mono">{loopCount}×</span>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <input type="range" className="flex-1" min={2} max={100} step={1} value={loopCount}
                    onChange={(e) => onFiltersChange({ ...filters, loopCount: parseInt(e.target.value) })} />
                  <input type="number" className="w-16 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={loopCount} min={2} max={1000} step={1}
                    onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 2) onFiltersChange({ ...filters, loopCount: v }); }} />
                </div>

                {/* Bridge */}
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Bridge</span>
                  <span className="text-[10px] text-gray-500 font-mono">{loopBridgeDuration.toFixed(1)}s</span>
                </div>
                <div className="flex items-center gap-2">
                  <input type="range" className="flex-1" min={0} max={10} step={0.5} value={loopBridgeDuration}
                    onChange={(e) => onFiltersChange({ ...filters, loopBridgeDuration: parseFloat(e.target.value) })} />
                  <input type="number" className="w-16 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={loopBridgeDuration} min={0} max={30} step={0.5}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) onFiltersChange({ ...filters, loopBridgeDuration: v }); }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats & Export */}
      {metadata && (
        <div className="px-4 py-3 border-t border-gray-200 mt-auto">
          <div className="flex justify-between mb-3">
            <span className="text-[10px] text-gray-500">{dataPointCount.toLocaleString()} raw</span>
            <span className="text-[10px] text-gray-500">{filteredCount.toLocaleString()} output</span>
          </div>
          <button
            onClick={onExport}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded text-xs transition-colors flex items-center justify-center gap-1.5"
          >
            <Download size={13} /> Export CSV
          </button>
        </div>
      )}
    </aside>
  );
}
