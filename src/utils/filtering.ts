import { DataPoint } from "./csvParser";

export interface FilterSettings {
  interpolationSteps: Record<string, number>; // per-channel step in seconds
  transitionEnabled: boolean;
  transitionDuration: number; // seconds
  transitionStartRpm: number; // RPM to start the ramp from
  throttleCeiling: number; // sensor ceiling % — values at this level become 100%
  throttleFloor: number; // minimum throttle % — values below are clamped up
  throttleDecimals: boolean; // use decimal precision for throttle output
}

export const DEFAULT_FILTERS: FilterSettings = {
  interpolationSteps: {},
  transitionEnabled: false,
  transitionDuration: 10,
  transitionStartRpm: 4000,
  throttleCeiling: 100,
  throttleFloor: 0,
  throttleDecimals: false,
};

export function defaultInterpolationSteps(channels: string[], sampleRate: number): Record<string, number> {
  const step = sampleRate > 0 ? 1 / sampleRate : 0.1;
  const steps: Record<string, number> = {};
  for (const ch of channels) {
    if (ch === "Time") continue;
    steps[ch] = step;
  }
  return steps;
}

/**
 * Interpolate data with per-channel steps.
 * Each channel is first resampled at its own step (smoothing it),
 * then linearly interpolated to the finest output grid.
 */
export function interpolateData(data: DataPoint[], steps: Record<string, number>): DataPoint[] {
  if (data.length < 2) return data;

  const stepValues = Object.values(steps);
  if (stepValues.length === 0) return data;

  const minStep = Math.max(Math.min(...stepValues), 0.001);
  const start = data[0].time;
  const end = data[data.length - 1].time;

  // Helper: binary search interpolation from raw data at a given time
  function lerpRaw(t: number, key: (d: DataPoint) => number): number {
    let lo = 0;
    let hi = data.length - 1;
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (data[mid].time <= t) lo = mid;
      else hi = mid;
    }
    const p0 = data[lo];
    const p1 = data[hi];
    if (p0.time === p1.time || t <= p0.time) return key(p0);
    if (t >= p1.time) return key(p1);
    const frac = (t - p0.time) / (p1.time - p0.time);
    return key(p0) + (key(p1) - key(p0)) * frac;
  }

  // For each channel, build a coarse grid at that channel's step, then we'll interpolate from it
  type CoarseGrid = { times: number[]; values: number[] };

  function buildCoarseGrid(step: number, key: (d: DataPoint) => number): CoarseGrid {
    const times: number[] = [];
    const values: number[] = [];
    for (let t = start; t <= end + step * 0.001; t = Math.round((t + step) * 1000) / 1000) {
      times.push(t);
      values.push(lerpRaw(t, key));
    }
    return { times, values };
  }

  function lerpCoarse(grid: CoarseGrid, t: number): number {
    const { times, values } = grid;
    if (t <= times[0]) return values[0];
    if (t >= times[times.length - 1]) return values[times.length - 1];
    // Binary search
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }
    const frac = (t - times[lo]) / (times[hi] - times[lo]);
    return values[lo] + (values[hi] - values[lo]) * frac;
  }

  // Build coarse grids per channel
  const rpmGrid = buildCoarseGrid(steps["RPM"] ?? minStep, (d) => d.rpm);
  const throttleGrid = buildCoarseGrid(steps["Throttle"] ?? minStep, (d) => d.throttle ?? 0);
  const hasThrottle = data.some((d) => d.throttle !== null);

  // GPS channels - try multiple possible names
  const gpsLatStep = steps["GPS_LatAcc"] ?? steps["GPS_Latitude"] ?? steps["GPS_Lat"] ?? minStep;
  const gpsLonStep = steps["GPS_LonAcc"] ?? steps["GPS_Longitude"] ?? steps["GPS_Lon"] ?? minStep;
  const gpsLatGrid = buildCoarseGrid(gpsLatStep, (d) => d.gpsLat);
  const gpsLonGrid = buildCoarseGrid(gpsLonStep, (d) => d.gpsLon);

  // Build output at finest grid
  const result: DataPoint[] = [];
  for (let t = start; t <= end; t = Math.round((t + minStep) * 1000) / 1000) {
    result.push({
      time: t,
      rpm: lerpCoarse(rpmGrid, t),
      throttle: hasThrottle ? lerpCoarse(throttleGrid, t) : null,
      gpsLat: lerpCoarse(gpsLatGrid, t),
      gpsLon: lerpCoarse(gpsLonGrid, t),
    });
  }

  return result;
}

/**
 * Prepend a smooth RPM ramp from 0 to the first data point's RPM.
 * Throttle is held at 100% during the transition.
 * GPS values are held constant at the first point's position.
 */
export function applyTransition(data: DataPoint[], duration: number, step: number, startRpm: number = 0): DataPoint[] {
  if (data.length === 0 || duration <= 0) return data;

  const first = data[0];
  const targetRpm = first.rpm;
  const ramp: DataPoint[] = [];

  const timeStep = Math.max(step, 0.01);

  for (let t = 0; t < duration; t = Math.round((t + timeStep) * 1000) / 1000) {
    const frac = t / duration;
    const smooth = (1 - Math.cos(frac * Math.PI)) / 2; // 0 → 1 smoothly
    ramp.push({
      time: t,
      rpm: startRpm + smooth * (targetRpm - startRpm),
      throttle: 100,
      gpsLat: first.gpsLat,
      gpsLon: first.gpsLon,
    });
  }

  // Shift original data times
  const shifted = data.map((d) => ({
    ...d,
    time: Math.round((d.time + duration) * 1000) / 1000,
  }));

  return [...ramp, ...shifted];
}

/**
 * Remap throttle so that `ceiling` becomes 100%.
 * Values 0–ceiling are scaled proportionally to 0–100%.
 * Values above ceiling are clamped to 100%.
 */
/**
 * Remap throttle: ceiling stretches top end, floor clamps bottom end.
 * Ceiling: 0–ceiling → 0–100% (proportional stretch, above ceiling = 100%)
 * Floor: anything below floor gets clamped up to floor (no stretch, just a hard minimum)
 */
export function remapThrottle(data: DataPoint[], ceiling: number, floor: number): DataPoint[] {
  if (ceiling >= 100 && floor <= 0) return data;
  return data.map((d) => {
    if (d.throttle === null) return d;
    let t = d.throttle;
    // Apply ceiling remap first (stretch)
    if (ceiling < 100 && ceiling > 0) {
      t = Math.min(100, (t / ceiling) * 100);
    }
    // Then apply floor (hard clamp up)
    if (floor > 0 && t < floor) {
      t = floor;
    }
    return { ...d, throttle: t };
  });
}
