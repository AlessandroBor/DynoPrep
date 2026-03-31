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
  onClose: () => void;
  dataPointCount: number;
  filteredCount: number;
  channels: string[];
  hasThrottle: boolean;
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
  onClose,
  dataPointCount,
  filteredCount,
  channels,
  hasThrottle,
}: SidebarProps) {
  // Safe defaults in case filters state is stale from HMR
  const throttleCeiling = filters.throttleCeiling ?? 100;
  const throttleFloor = filters.throttleFloor ?? 0;
  const transitionEnabled = filters.transitionEnabled ?? false;
  const transitionDuration = filters.transitionDuration ?? 10;
  const transitionStartRpm = filters.transitionStartRpm ?? 4000;

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

          {/* Dyno Transition */}
          <div className="px-4 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                Dyno Transition
              </h2>
              <div className="flex items-center gap-2">
                <ResetButton
                  onClick={() =>
                    onFiltersChange({
                      ...filters,
                      transitionEnabled: DEFAULT_FILTERS.transitionEnabled,
                      transitionDuration: DEFAULT_FILTERS.transitionDuration,
                      transitionStartRpm: DEFAULT_FILTERS.transitionStartRpm,
                    })
                  }
                />
                <button
                  onClick={() =>
                    onFiltersChange({ ...filters, transitionEnabled: !transitionEnabled })
                  }
                  className={`relative w-9 h-5 rounded-full transition-colors ${
                    transitionEnabled ? "bg-red-600" : "bg-gray-300"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      transitionEnabled ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>
            {transitionEnabled && (
              <div>
                <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">
                  Smooth ramp {transitionStartRpm > 0 ? `${transitionStartRpm.toLocaleString()} RPM` : "0"} → first RPM. Throttle at 100%.
                </p>

                {/* Duration */}
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Duration</span>
                  <span className="text-[10px] text-gray-500 font-mono">{transitionDuration}s</span>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <input
                    type="range"
                    className="flex-1"
                    min={1}
                    max={30}
                    step={0.5}
                    value={transitionDuration}
                    onChange={(e) =>
                      onFiltersChange({ ...filters, transitionDuration: parseFloat(e.target.value) })
                    }
                  />
                  <input
                    type="number"
                    className="w-14 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={transitionDuration}
                    min={0.5}
                    max={60}
                    step={0.5}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v > 0)
                        onFiltersChange({ ...filters, transitionDuration: v });
                    }}
                  />
                </div>

                {/* Start RPM */}
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-gray-600">Start RPM</span>
                  <span className="text-[10px] text-gray-500 font-mono">{transitionStartRpm.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    className="flex-1"
                    min={0}
                    max={10000}
                    step={100}
                    value={transitionStartRpm}
                    onChange={(e) =>
                      onFiltersChange({ ...filters, transitionStartRpm: parseInt(e.target.value) })
                    }
                  />
                  <input
                    type="number"
                    className="w-16 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 text-right focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-100 transition-all"
                    value={transitionStartRpm}
                    min={0}
                    max={20000}
                    step={100}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v) && v >= 0)
                        onFiltersChange({ ...filters, transitionStartRpm: v });
                    }}
                  />
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
