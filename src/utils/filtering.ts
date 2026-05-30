import { DataPoint } from "./csvParser";

export interface FilterSettings {
  interpolationSteps: Record<string, number>; // per-channel step in seconds
  transitionEnabled: boolean;
  transitionDuration: number; // start transition duration (seconds)
  transitionStartRpm: number; // RPM to start the ramp from
  endTransitionEnabled: boolean;
  endTransitionDuration: number; // end transition duration (seconds)
  endTransitionRpm: number; // RPM to ramp down to
  throttleCeiling: number; // sensor ceiling % — values at this level become 100%
  throttleFloor: number; // minimum throttle % — values below are clamped up
  throttleDecimals: boolean; // use decimal precision for throttle output
  breakInEnabled: boolean; // break-in load/unload cycle on/off
  breakInLimitRpm: number; // max allowed RPM — reaching it triggers a lift-off
  breakInFloorRpm: number; // absolute RPM floor — a decay never drops below this
  breakInDecayRate: number; // RPM per second the engine sheds during lift-off
  breakInDecayDuration: number; // how long each lift-off lasts (seconds)
  breakInResumeRate: number; // RPM per second it climbs back to the lap data
  breakInSmoothing: number; // rounds the lift-off→resume corner (seconds, 0 = off)
  breakInThrottleResume: number; // seconds for throttle to ramp back to data on resume
  lapTimeCorrectionEnabled: boolean; // stretch the timeline so lift-offs take realistically longer
}

export const DEFAULT_FILTERS: FilterSettings = {
  interpolationSteps: {},
  transitionEnabled: false,
  transitionDuration: 10,
  transitionStartRpm: 4000,
  endTransitionEnabled: false,
  endTransitionDuration: 5,
  endTransitionRpm: 2000,
  throttleCeiling: 100,
  throttleFloor: 0,
  throttleDecimals: false,
  breakInEnabled: false,
  breakInLimitRpm: 13500,
  breakInFloorRpm: 7000,
  breakInDecayRate: 1000,
  breakInDecayDuration: 2,
  breakInResumeRate: 2000,
  breakInSmoothing: 0.25,
  breakInThrottleResume: 0.5,
  lapTimeCorrectionEnabled: false,
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
 * Append a smooth RPM ramp down from the last data point's RPM to endRpm.
 * Throttle is set to 0% during the ramp down.
 * GPS values are held constant at the last point's position.
 */
export function applyEndTransition(data: DataPoint[], duration: number, step: number, endRpm: number = 0): DataPoint[] {
  if (data.length === 0 || duration <= 0) return data;

  const last = data[data.length - 1];
  const lastTime = last.time;
  const startRpm = last.rpm;
  const ramp: DataPoint[] = [];
  const timeStep = Math.max(step, 0.01);

  for (let t = timeStep; t <= duration; t = Math.round((t + timeStep) * 1000) / 1000) {
    const frac = t / duration;
    const smooth = (1 - Math.cos(frac * Math.PI)) / 2; // 0 → 1 smoothly
    ramp.push({
      time: Math.round((lastTime + t) * 1000) / 1000,
      rpm: startRpm + smooth * (endRpm - startRpm),
      throttle: 0,
      gpsLat: last.gpsLat,
      gpsLon: last.gpsLon,
    });
  }

  return [...data, ...ramp];
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

export interface BreakInSettings {
  limitRpm: number; // max allowed RPM — reaching it triggers a lift-off
  floorRpm: number; // absolute RPM floor — a decay never drops below this
  decayRate: number; // RPM/s shed during a lift-off
  decayDuration: number; // lift-off length in seconds
  resumeRate: number; // RPM/s climbed back up to the lap data on resume
  smoothing: number; // seconds of corner-rounding at the decay→resume turn (0 = off)
  throttleResume: number; // seconds for throttle to ease back to the data value on resume
}

/**
 * Resolve the effective decay for one lift-off that starts at `startRpm`.
 *
 * The engine sheds `decayRate` RPM/s for `decayDuration` seconds, landing at
 * `startRpm - decayRate * decayDuration`. If that natural landing point is below
 * the floor, the rate is automatically lowered so the drop instead interpolates
 * smoothly down to *exactly* the floor over the same duration — it never
 * undershoots and never clips flat at the bottom.
 *
 * Returns the rate actually used and the RPM the decay ends on.
 */
export function resolveDecay(
  startRpm: number,
  floorRpm: number,
  decayRate: number,
  decayDuration: number
): { rate: number; endRpm: number; floorLimited: boolean } {
  const naturalEnd = startRpm - decayRate * decayDuration;
  if (naturalEnd < floorRpm) {
    const rate = decayDuration > 0 ? (startRpm - floorRpm) / decayDuration : decayRate;
    return { rate: Math.max(0, rate), endRpm: floorRpm, floorLimited: true };
  }
  return { rate: decayRate, endRpm: naturalEnd, floorLimited: false };
}

/**
 * Break-in load/unload cycle.
 *
 * Walks the (time-ordered) lap data and overlays a repeating break-in pattern,
 * preserving the original time grid (touches RPM + Throttle only):
 *
 *  - FOLLOW: output tracks the lap RPM, capped so it never exceeds `limitRpm`.
 *  - DECAY:  the instant RPM reaches `limitRpm`, the throttle lifts to 0 and RPM
 *            falls at `decayRate` RPM/s for `decayDuration` s (auto-slowed by
 *            resolveDecay so it never drops below `floorRpm`).
 *  - RESUME: throttle ramps back in and RPM climbs at `resumeRate` RPM/s until it
 *            rejoins the lap data, then FOLLOW resumes — re-triggering at the limit.
 */
export function applyBreakInCycle(data: DataPoint[], s: BreakInSettings): DataPoint[] {
  if (data.length === 0) return data;

  const limit = Math.max(0, s.limitRpm);
  const floor = Math.min(Math.max(0, s.floorRpm), limit); // floor can't exceed the limit
  const decayDuration = Math.max(0, s.decayDuration);
  const decayRate = Math.max(0, s.decayRate);
  const resumeRate = Math.max(0, s.resumeRate);
  const throttleResume = Math.max(0, s.throttleResume);

  const out = data.map((d) => ({ ...d }));

  type Phase = "follow" | "decay" | "resume";
  let phase: Phase = "follow";
  let liftOffTime = 0;
  let liftOffRpm = limit;
  let effRate = decayRate; // decay rate after any floor override
  let prevRpm = out[0].rpm; // previous emitted RPM, for resume integration
  let resumeStartTime = 0; // time the current resume began, for the throttle ramp
  const corners: number[] = []; // sample indices where a lift-off hands off to resume

  for (let i = 0; i < out.length; i++) {
    const dataRpm = data[i].rpm;
    const dataThrottle = data[i].throttle;
    const t = data[i].time;

    // DECAY may finish mid-iteration and hand off to RESUME, so this isn't an else-if chain.
    if (phase === "decay") {
      const elapsed = t - liftOffTime;
      if (elapsed < decayDuration) {
        const rpm = Math.max(floor, liftOffRpm - effRate * elapsed);
        out[i].rpm = rpm;
        if (out[i].throttle !== null) out[i].throttle = 0;
        prevRpm = rpm;
        continue;
      }
      phase = "resume"; // duration elapsed — fall through and rejoin this sample
      resumeStartTime = t; // start the throttle ramp from here
      corners.push(i); // remember the lift-off→resume turn for optional smoothing
    }

    if (phase === "resume") {
      const dt = i > 0 ? data[i].time - data[i - 1].time : 0;
      // Rejoin target is capped at the limit so we never climb past the ceiling.
      const target = Math.min(dataRpm, limit);

      // Throttle eases back to the lap value over `throttleResume` seconds with a
      // cosine ramp (smooth, no kink) — independent of how fast RPM recovers.
      const lin = throttleResume > 0 ? Math.min(1, (t - resumeStartTime) / throttleResume) : 1;
      const throttleFrac = (1 - Math.cos(lin * Math.PI)) / 2;

      if (prevRpm > target) {
        // The lap data is BELOW where the decay left us — keep coasting down
        // (throttle still lifted) at the decay rate until we meet it, rather than
        // snapping straight down.
        const dropped = prevRpm - decayRate * dt;
        if (decayRate <= 0 || dropped <= target) {
          out[i].rpm = target;
          prevRpm = target;
          phase = "follow";
          continue;
        }
        out[i].rpm = dropped;
        if (out[i].throttle !== null) out[i].throttle = throttleFrac * (dataThrottle ?? 0);
        prevRpm = dropped;
        continue;
      }

      // The lap data is at/above us — climb back up into it at the resume rate.
      // Capping target at the limit means we stop at the ceiling and FOLLOW
      // re-triggers a clean lift-off on the next sample.
      const climbed = prevRpm + resumeRate * dt;
      if (resumeRate <= 0 || climbed >= target) {
        out[i].rpm = target;
        prevRpm = target;
        phase = "follow";
        continue;
      }
      out[i].rpm = climbed;
      if (out[i].throttle !== null) out[i].throttle = throttleFrac * (dataThrottle ?? 0);
      prevRpm = climbed;
      continue;
    }

    // FOLLOW
    if (dataRpm >= limit) {
      // Reached the ceiling — begin a lift-off at exactly the limit.
      phase = "decay";
      liftOffTime = t;
      liftOffRpm = limit;
      effRate = resolveDecay(limit, floor, decayRate, decayDuration).rate;
      out[i].rpm = limit;
      if (out[i].throttle !== null) out[i].throttle = 0;
      prevRpm = limit;
    } else {
      out[i].rpm = dataRpm;
      prevRpm = dataRpm;
    }
  }

  // Optional corner rounding: the decay (falling) meeting the resume (rising)
  // leaves a sharp V. Blend the RPM around each turn with a triangular kernel so
  // the reversal eases instead of kinking. The kernel tapers to zero at the window
  // edges, so straight sections stay straight — only the corner rounds.
  if (s.smoothing > 0 && corners.length > 0 && out.length > 2) {
    const dt = data[1].time - data[0].time || 0.02;
    const w = Math.max(1, Math.round(s.smoothing / dt));
    const src = out.map((d) => d.rpm); // read from a snapshot so passes don't cascade
    for (const c of corners) {
      const lo = Math.max(0, c - w);
      const hi = Math.min(out.length - 1, c + w);
      for (let p = lo; p <= hi; p++) {
        let acc = 0;
        let wsum = 0;
        for (let k = -w; k <= w; k++) {
          const j = p + k;
          if (j < 0 || j >= src.length) continue;
          const weight = w + 1 - Math.abs(k);
          acc += weight * src[j];
          wsum += weight;
        }
        if (wsum > 0) out[p].rpm = acc / wsum;
      }
    }
  }

  return out;
}

/** Time a lap actually takes, given how far its RPM was pulled below the original. */
export function correctedLapTime(original: DataPoint[], limited: DataPoint[], maxStretch = 8): number {
  const n = Math.min(original.length, limited.length);
  let total = 0;
  for (let i = 1; i < n; i++) {
    const dt = original[i].time - original[i - 1].time;
    total += Math.max(0, dt) * stretchFactor(original[i].rpm, limited[i].rpm, maxStretch);
  }
  return total;
}

/** Per-step time-stretch: how much longer a chunk takes at the lowered RPM (≥ 1). */
function stretchFactor(originalRpm: number, limitedRpm: number, maxStretch: number): number {
  if (!(limitedRpm > 0) || !(originalRpm > 0)) return 1;
  const f = originalRpm / limitedRpm;
  if (!isFinite(f) || f < 1) return 1; // break-in only lowers RPM, so time only grows
  return f > maxStretch ? maxStretch : f;
}

/**
 * Lap-time correction.
 *
 * The dyno replays the lap on the CSV's time base, so a break-in lift-off would
 * otherwise flash past in the same time the *fast* lap took it. On a direct-drive
 * kart (solid axle, clutch locked at speed, no wheel slip) ground speed is rigidly
 * proportional to engine RPM, so covering a fixed chunk of track at a lower RPM
 * takes proportionally longer — each step's duration scales by
 * `RPM_original / RPM_limited`. Gear ratio and absolute speed cancel out.
 *
 * `original` and `limited` must be the same length on the same time grid (the pre-
 * and post-break-in lap). Returns the lap resampled onto a uniform grid at `outStep`
 * seconds spanning the new (longer) duration — uniform sample rate AND correct
 * timestamps, so it plays back right whether the dyno honours the time column or
 * detects the sample rate.
 */
export function applyLapTimeCorrection(
  original: DataPoint[],
  limited: DataPoint[],
  outStep: number,
  maxStretch = 8
): DataPoint[] {
  const n = limited.length;
  if (n < 2 || original.length !== n) return limited;

  // 1. Build the stretched timeline: each original step grows by its RPM ratio.
  const newTimes = new Array<number>(n);
  newTimes[0] = limited[0].time;
  for (let i = 1; i < n; i++) {
    const dt = Math.max(0, original[i].time - original[i - 1].time);
    newTimes[i] = newTimes[i - 1] + dt * stretchFactor(original[i].rpm, limited[i].rpm, maxStretch);
  }

  // 2. Resample onto a uniform grid over the corrected span (linear interpolation).
  const step = Math.max(outStep, 0.001);
  const start = newTimes[0];
  const end = newTimes[n - 1];
  const out: DataPoint[] = [];
  let lo = 0;
  for (let t = start; t <= end + step * 0.001; t = Math.round((t + step) * 1000) / 1000) {
    while (lo < n - 2 && newTimes[lo + 1] < t) lo++;
    const t0 = newTimes[lo];
    const t1 = newTimes[lo + 1];
    const frac = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
    const a = limited[lo];
    const b = limited[lo + 1];
    const lerp = (x: number, y: number) => x + (y - x) * frac;
    const throttle =
      a.throttle === null || b.throttle === null ? a.throttle ?? b.throttle : lerp(a.throttle, b.throttle);
    out.push({
      time: Math.round(t * 1000) / 1000,
      rpm: lerp(a.rpm, b.rpm),
      throttle,
      gpsLat: lerp(a.gpsLat, b.gpsLat),
      gpsLon: lerp(a.gpsLon, b.gpsLon),
    });
  }
  return out;
}
